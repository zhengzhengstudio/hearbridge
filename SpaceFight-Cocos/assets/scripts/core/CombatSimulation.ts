import { normalizeFlightCommand } from './FlightCommand';
import type { FlightCommand, FlightCommandInput } from './FlightCommand';
import { ExpeditionDirector } from './ExpeditionDirector';
import type { ExpeditionEventKind, ExpeditionSnapshot } from './ExpeditionDirector';
import { EnemyBehaviorSystem } from './EnemyBehaviorSystem';
import type { EnemyIntentMode, EnemyRole } from './EnemyBehaviorSystem';
import { LootAndCargoSystem } from './LootAndCargoSystem';
import type { CargoItem, CargoSnapshot } from './LootAndCargoSystem';
import { resolvePlayerShip } from './ShipCatalog';
import type { PlayerShipDefinition } from './ShipCatalog';
import {
  AIM_CONVERGENCE_DISTANCE,
  PRIMARY_MUZZLE_LOCAL_POSITION,
  SECONDARY_MUZZLE_LOCAL_POSITION,
  computeAimRay,
  computeConvergencePoint,
  computeMuzzleDirection,
  computeMuzzlePosition,
} from './AimConvergence';
import { neutralAttitude, stepFlightAttitude } from './FlightAttitude';
import type { FlightAttitudeState } from './FlightAttitude';
import { COMBAT_FEEL, COMBAT_UPGRADES, CombatUpgradeDefinition, ENEMY_TUNING, FLIGHT_TUNING, PICKUP_KINDS, PLAYER_HIT_TUNING, REGION_RULES } from './FlightTuning';
import type { RegionId, RegionRule } from './FlightTuning';
import {
  FRAME_CORES,
  BOOST_MODULES,
  ENGINE_MODULES,
  PRIMARY_WEAPONS,
  SECONDARY_WEAPONS,
  SHIELD_MODULES,
  TACTICAL_DEVICES,
  UTILITY_MODULES,
  WEAPON_CATALOG,
  behaviorForWeaponId,
  resolveLoadout,
} from './WeaponCatalog';
import type { CombatLoadout, ResolvedCombatLoadout, WeaponDefinition, WeaponSlot } from './WeaponCatalog';

/**
 * 决策窗口超过该秒数后，HUD 提示玩家尽快决定。
 * 注意：这里只影响提示，不会自动推进波次——推进必须由玩家主动操作。
 */
const DECISION_URGE_SECONDS = 12;

/** survive 目标：增援间隔（秒）。太短会瞬间淹没，太长则压力不足。 */
const REINFORCEMENT_INTERVAL = 7;
/** survive 目标：同屏敌人上限，防止增援把玩家直接压死（体验崩塌）。 */
const SURVIVE_ENEMY_CAP = 11;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface MissionEnemyDefinition {
  id: string;
  kind?: string;
  position: Vector3;
  health?: number;
}

export interface MissionPickupDefinition {
  id: string;
  kind: string;
  position: Vector3;
  value: number;
  /** 局内强化模块的 id（kind === 'upgrade' 时有效，精英 / Boss 掉落） */
  upgradeId?: string;
}

/**
 * 任务目标类型。
 *
 * 此前 objective 只允许 `eliminate`，三个任务预设（salvage/assault/hunt）虽然
 * 敌人配置不同，**玩法循环完全相同**：打够 N 个敌人就只剩「继续深入 / 返航」的
 * 文本选择。玩家打完第一批就没事可做，长期留存归零。
 *
 * 现在拆成四种目标，让「深入下一波」变成真正的玩法推进而不是流程按钮：
 * - `eliminate` 歼灭：清光本波敌人（经典推进，仍作为默认值向后兼容）
 * - `collect`   采集：本波必须在**携带货舱占满比例**达标的前提下清敌，
 *               逼玩家在「贪战」与「带货」之间取舍（血量/能量是真正代价）
 * - `survive`   存活：本波有倒计时，不要求清敌 —— 敌人持续增援撑过即可，
 *               给玩家喘息与「苟住也是策略」的选项
 * - `hunt`      猎杀：只有击杀**指定精英**才算进度，杂兵无限刷。
 *               把「优先处理威胁」变成必须主动决策的事
 * - `defense`   守点：守住一个坐标，敌人靠近核心就掉进度，逼玩家「留在原地」
 *               而不是一味往前冲 —— 与 eliminate 完全相反的行动方向
 * - `escort`    护送：一具要保护的运输船跟着你走，它挨打你的进度就掉，
 *               逼玩家在「清场」和「护住它」之间做取舍
 */
export type MissionObjectiveType = 'eliminate' | 'collect' | 'survive' | 'hunt' | 'defense' | 'escort';

export interface MissionObjectiveDefinition {
  type: MissionObjectiveType;
  /** eliminate / hunt：需要击杀的数量；survive：无意义 */
  requiredKills?: number;
  /** collect：需要装满的货舱槽位比例（0~1） */
  cargoRatio?: number;
  /** survive：撑住的秒数 */
  surviveSeconds?: number;
  /** hunt：精英敌人的 kind */
  eliteKind?: string;
  /** defense：需要守住的坐标（世界单位） */
  defensePoint?: Vector3;
  /** defense：敌人靠近核心多少距离开始掉进度 */
  defenseRadius?: number;
  /** escort：运输船的初始位置 */
  escortStart?: Vector3;
  /** escort：运输船跟随玩家时的落后距离（超过即视为被甩开） */
  escortFollowDistance?: number;
}

export interface MissionDefinition {
  id: string;
  seed?: number;
  primaryEvent?: ExpeditionEventKind;
  enemies?: MissionEnemyDefinition[];
  pickups?: MissionPickupDefinition[];
  objective?: MissionObjectiveDefinition;
}

export interface CombatSimulationOptions {
  mission: MissionDefinition;
  seed?: number;
  loadout?: CombatLoadout;
  worldEvents?: {
    enabled?: boolean;
    firstDelay?: number;
    forcedSequence?: WorldEventKind[];
  };
  cargoCapacityBonus?: number;
  pickupRadiusBonus?: number;
  shieldCapacityBonus?: number;
  /**
   * 星港服务经济端口。core 层不能依赖 `cc`（PlayerEconomy 用 sys.localStorage），
   * 由外层用 PlayerEconomy 现有 API 注入；未注入时退回到内置券，保证服务仍可用。
   */
  economy?: OutpostServiceEconomy;
}

export type OutpostService = 'repair' | 'resupply' | 'refit';

export interface OutpostServiceEconomy {
  /** 读取当前星港券余额 */
  getTickets(): number;
  /** 扣券成功返回 true；余额不足返回 false */
  spendTickets(amount: number, receipt: string): boolean;
}

/** 三项站内服务的星港券价格（合理常数，与商城 120~420 档位错开）。 */
export const OUTPOST_SERVICE_PRICES: Readonly<Record<OutpostService, number>> = {
  repair: 40,
  resupply: 30,
  refit: 90,
};

/** 未注入经济端口时的内置券额度，与 PlayerEconomy 默认余额对齐。 */
const OUTPOST_DEFAULT_TICKETS = 360;
/** refit 每次永久提升的护盾上限。 */
const REFIT_SHIELD_BONUS = 8;

export type EnemyFaction = 'raider' | 'corsair';
export type WorldEventKind = 'rivalry' | 'ion-storm' | 'supply-drop';

export const PRIMARY_OUTPOST_POSITION: Readonly<Vector3> = { x: 22, y: -6, z: -72 };
// 停靠半径（原 24）。放宽到 60：手机端惯性飞行下，原先必须飞进距基地 24 单位内的
// 精确点（且被 18 的碰撞墙弹回，可用壳层只剩 18–24 这 6 单位薄环）才能停靠，
// 玩家一旦飘远（outpostRange 很大）几乎不可能戳中，表现为「无法停靠 / 定住 XXm」。
// 放宽后「往基地方向飞回去」即触发停靠。注意：出生点距离 = 本值 + 12（见 departOutpost），
// 会随本值自动外移，故不会一出生就误停靠。
export const OUTPOST_DOCKING_RADIUS = 60;

interface PlayerState {
  position: Vector3;
  attitude: FlightAttitudeState;
  health: number;
  shield: number;
  energy: number;
  score: number;
  pickupsCollected: number;
  maxHealth: number;
  maxShield: number;
  maxEnergy: number;
  speedMultiplier: number;
  strafeMultiplier: number;
  boostMultiplier: number;
  damageMultiplier: number;
  pickupRadius: number;
  healthRegen: number;
  energyRechargeMultiplier: number;
  shieldRecharge: number;
  spawnProtection: number;
  /** 受击后附带的短暂无敌帧，防止同一波齐射瞬间掉光血 */
  hitGrace: number;
  /**
   * 当前纵向速度倍率（0..1 相对 cruise/boost）。
   * 由一阶追赶积分得到，是「有惯性」的关键状态，勿改成瞬时值。
   */
  speedScale: number;
}

interface EnemyState {
  id: string;
  kind: string;
  position: Vector3;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  radius: number;
  score: number;
  fireCooldown: number;
  ramCooldown: number;
  role: EnemyRole;
  telegraphElapsed: number;
  intent: EnemyIntentMode;
  faction: EnemyFaction;
  lastDamagedBy: CombatEventSource;
  /** 被离子类武器命中后的干扰状态：到 jammedUntil 之前位移与开火都变慢 */
  jammedUntil?: number;
  jamSpeedScale?: number;
  jamFireRateScale?: number;
}

interface AimSolution {
  readonly point: Vector3;
  readonly target: EnemyState | null;
}

interface ProjectileState {
  id: string;
  weapon: string;
  origin: Vector3;
  position: Vector3;
  velocity: Vector3;
  damage: number;
  radius: number;
  life: number;
  owner: 'player' | 'enemy';
  sourceId?: string;
  targetId?: string;
  /** 武器行为字段（见 WeaponCatalog.behaviorForWeaponId）；缺省即常规单发直线弹。 */
  pierceLeft?: number;
  pierceDamageScale?: number;
  splashRadius?: number;
  splashDamageScale?: number;
  jamSeconds?: number;
  jamSpeedScale?: number;
  jamFireRateScale?: number;
  /** 穿透弹已命中的目标，避免同一发反复打同一个敌人 */
  hitIds?: string[];
}

export type CombatEventSource = 'player' | 'enemy' | 'world';
export type CombatEventType = 'hit' | 'destroyed' | 'player-hit' | 'shield-break' | 'wave-start'
  | 'rivalry-start' | 'rivalry-end' | 'ion-storm' | 'supply-drop' | 'weapon-fired' | 'outpost-serviced'
  | 'outpost-service' | 'upgrade-activated' | 'weapons-swapped';

export interface CombatEvent {
  readonly id: number;
  readonly type: CombatEventType;
  readonly position: Vector3;
  readonly targetId?: string;
  readonly weapon?: string;
  readonly damage?: number;
  readonly lethal?: boolean;
  readonly wave?: number;
  readonly threatTier?: number;
  readonly enemyCount?: number;
  readonly source?: CombatEventSource;
  readonly duration?: number;
  /** 受击强度分级（light / medium / heavy），供 HUD 做差异化反馈 */
  readonly intensity?: 'light' | 'medium' | 'heavy';
  readonly cargoValue?: number;
  /** 星港改装累计次数（outpost-service 事件携带，供 HUD 提示） */
  readonly refitCount?: number;
}

interface PickupState {
  id: string;
  kind: string;
  position: Vector3;
  value: number;
  cargoItem?: CargoItem;
  /** 局内强化模块的 id（kind === 'upgrade' 时有效） */
  upgradeId?: string;
}

/**
 * 残骸带里的漂浮残骸（区域规则 debris）。
 *
 * 之前小行星只是 WorldStreamer 里的视觉摆设，撞上去一点事没有，
 * 玩家感觉不到「战场有物理」。现在残骸会持续向玩家漂移，
 * 撞上按区域规则扣血 —— 想安全通过就得绕开或把它打掉。
 */
interface DebrisState {
  id: string;
  position: Vector3;
  velocity: Vector3;
  radius: number;
  health: number;
  maxHealth: number;
  /** 已经造成过伤害，避免同一帧反复结算 */
  hitGrace: number;
}

export interface CombatSnapshot {
  seed: number;
  tick: number;
  elapsed: number;
  paused: boolean;
  cameraMode: 'chase' | 'cockpit';
  /** 主副武器是否已互换（true 时主开火键打副武器） */
  weaponsSwapped: boolean;
  aimPoint: Vector3;
  loadout: ResolvedCombatLoadout;
  player: {
    id: string;
    position: Vector3;
    aimYaw: number;
    aimPitch: number;
    yaw: number;
    pitch: number;
    health: number;
    shield: number;
    energy: number;
    score: number;
    pickupsCollected: number;
    maxHealth: number;
    maxShield: number;
    maxEnergy: number;
    speedMultiplier: number;
    damageMultiplier: number;
    pickupRadius: number;
    spawnProtection: number;
    /** 当前纵向速度比例 0..1（相对 cruise/boost），HUD 速度表用 */
    speedScale: number;
    /** 受击无敌帧剩余秒数，HUD 受击闪白用 */
    hitGrace: number;
  };
  /**
   * 连击：连续击杀累积，分数随倍率放大。
   * 之前一局里连杀和慢慢打得分完全一样，「一口气打掉一队」没有奖励，
   * 战斗节奏因此很平。现在连击给分数倍率和 HUD 提示。
   */
  combo: {
    count: number;
    multiplier: number;
    /** 剩余连击时间（秒），归零即断连击 */
    remaining: number;
    /** 本局最高连击 */
    best: number;
  };
  /** 当前生效的局内强化模块（精英 / Boss 掉落） */
  upgrades: Array<{
    id: string;
    name: string;
    description: string;
    remaining: number;
  }>;
  target: {
    id: string;
    kind: string;
    health: number;
    maxHealth: number;
    range: number;
    role: EnemyRole;
    intent: EnemyIntentMode;
    telegraph: number;
    locked: boolean;
    leadPoint: Vector3;
    leadSeconds: number;
  } | null;
  enemies: Array<{
    id: string;
    kind: string;
    position: Vector3;
    velocity: Vector3;
    health: number;
    maxHealth: number;
    role: EnemyRole;
    intent: EnemyIntentMode;
    telegraph: number;
    faction: EnemyFaction;
  }>;
  projectiles: Array<{
    id: string;
    weapon: string;
    origin: Vector3;
    position: Vector3;
    velocity: Vector3;
    owner: 'player' | 'enemy';
    sourceId?: string;
    targetId?: string;
    pierceLeft?: number;
    splashRadius?: number;
    jamSeconds?: number;
  }>;
  combatEvents: CombatEvent[];
  worldEvent: {
    kind: WorldEventKind | null;
    remaining: number;
  };
  pickups: Array<{
    id: string;
    kind: string;
    position: Vector3;
    value: number;
    category?: string;
    rarity?: string;
    upgradeId?: string;
  }>;
  cargo: CargoSnapshot;
  navigation: {
    outpostRange: number;
    canDock: boolean;
    docked: boolean;
    securedCargoValue: number;
  };
  mission: {
    id: string;
    status: 'active' | 'complete' | 'failed';
    kills: number;
    requiredKills: number;
    /**
     * 统一进度：按目标类型给出「已完成 / 目标量」。
     * 旧字段 kills/requiredKills 保留向后兼容，HUD 优先读 progress。
     */
    objectiveType: MissionObjectiveType;
    progress: number;
    progressTarget: number;
    /** survive 目标专用：剩余秒数（其他目标为 0） */
    surviveRemaining: number;
    /** defense 目标：核心坐标（其他目标为 null） */
    defensePoint: Vector3 | null;
    /** defense 目标：核心半径（其他目标为 0） */
    defenseRadius: number;
    /** escort 目标：运输船位置（其他目标为 null） */
    escortPosition: Vector3 | null;
    /** escort 目标：运输船完好度 0..100（其他目标为 0） */
    escortHealth: number;
    /** 本波开始时的击杀数，用于把全局 kills 换算成「本波进度」 */
    waveKillBaseline: number;
    wave: number;
    sector: number;
    sectorName: string;
    eventName: string;
    /** 当前区域规则（扇区决定的战场约束），HUD 用来提示「这里要注意什么」 */
    region: {
      id: RegionId;
      name: string;
      brief: string;
    };
    /** 残骸带里剩余的残骸数量（其他区域为 0） */
    debrisCount: number;
  };
  expedition: ExpeditionSnapshot;
}

export const EXPEDITION_SECTORS = [
  '碎光航道',
  '寂静船坞',
  '离子风暴眼',
  '赤晶裂谷',
] as const;

function cloneVector(vector: Vector3): Vector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finiteNumber(value, fallback)));
}

function missionVector(vector: Vector3 | undefined, fallback: Vector3): Vector3 {
  return {
    x: finiteNumber(vector?.x, fallback.x),
    y: finiteNumber(vector?.y, fallback.y),
    z: finiteNumber(vector?.z, fallback.z),
  };
}

function distance(left: Vector3, right: Vector3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function segmentDistanceToPoint(start: Vector3, end: Vector3, point: Vector3): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= 0.0000001) return distance(start, point);
  const projection = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx
    + (point.y - start.y) * dy
    + (point.z - start.z) * dz
  ) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * projection),
    point.y - (start.y + dy * projection),
    point.z - (start.z + dz * projection),
  );
}

function closestPointOnSegment(start: Vector3, end: Vector3, point: Vector3): Vector3 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= 0.0000001) return cloneVector(start);
  const projection = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx
    + (point.y - start.y) * dy
    + (point.z - start.z) * dz
  ) / lengthSquared));
  return {
    x: start.x + dx * projection,
    y: start.y + dy * projection,
    z: start.z + dz * projection,
  };
}

export function predictInterceptPoint(
  origin: Vector3,
  target: Vector3,
  targetVelocity: Vector3,
  projectileSpeed: number,
  maxLeadTime = 1.35,
): { point: Vector3; seconds: number } {
  const offset = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
  const speedSquared = projectileSpeed * projectileSpeed;
  const velocitySquared = targetVelocity.x ** 2 + targetVelocity.y ** 2 + targetVelocity.z ** 2;
  const a = velocitySquared - speedSquared;
  const b = 2 * (offset.x * targetVelocity.x + offset.y * targetVelocity.y + offset.z * targetVelocity.z);
  const c = offset.x ** 2 + offset.y ** 2 + offset.z ** 2;
  let seconds = Math.sqrt(c) / Math.max(0.001, projectileSpeed);
  const discriminant = b * b - 4 * a * c;
  if (Math.abs(a) > 0.000001 && discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((value) => value > 0);
    if (candidates.length > 0) seconds = Math.min(...candidates);
  }
  seconds = Math.max(0, Math.min(maxLeadTime, seconds));
  return {
    point: {
      x: target.x + targetVelocity.x * seconds,
      y: target.y + targetVelocity.y * seconds,
      z: target.z + targetVelocity.z * seconds,
    },
    seconds,
  };
}

function rounded(value: number): number {
  const result = Math.round(value * 1000000) / 1000000;
  return Object.is(result, -0) ? 0 : result;
}

function snapshotVector(vector: Vector3): Vector3 {
  return {
    x: rounded(vector.x),
    y: rounded(vector.y),
    z: rounded(vector.z),
  };
}

export class CombatSimulation {
  private readonly seed: number;
  private readonly missionId: string;
  private requiredKills: number;
  private readonly objectiveType: MissionObjectiveType;
  /** collect 目标：需要装满的货舱比例（0~1） */
  private readonly objectiveCargoRatio: number;
  /** survive 目标：需要撑住的秒数 */
  private readonly objectiveSurviveSeconds: number;
  /** hunt 目标：算作进度的精英敌人 kind */
  private readonly objectiveEliteKind: string;
  /** 本波开始时的击杀数基准（把全局 kills 换算为波内进度） */
  private waveKillBaseline = 0;
  /** 本波已击杀的精英数（hunt 目标进度） */
  private eliteKills = 0;
  /** 本波存活计时（survive 目标进度） */
  private surviveElapsed = 0;
  /** hunt 波内固定目标：等于开波时本波精英投放数，不随全局 kills 膨胀 */
  private huntTargetKills = 1;
  /** defense 已守住秒数：从 0 起递增，敌人压制时倒扣 */
  private defenseHeldSeconds = 0;
  /** escort 已护送进度 0..100：从 0 起递增，不再拿满血当完成量 */
  private escortProgress = 0;
  /** 开局目标量，离港重开战局时恢复（避免沿用上一局膨胀后的 requiredKills） */
  private readonly baseRequiredKills: number;
  private readonly loadout: ResolvedCombatLoadout;
  /** 机型倍率。基线 interceptor 全为 1，保证默认装配的确定性数值不变。 */
  private readonly shipDefinition: PlayerShipDefinition;
  private accumulator = 0;
  private tick = 0;
  private elapsed = 0;
  private nextProjectileId = 1;
  private nextCombatEventId = 1;
  private kills = 0;
  private paused = false;
  private pauseHeld = false;
  private cameraHeld = false;
  /** 主副武器互换的按下一拍状态（边沿触发，长按不反复切换） */
  private swapHeld = false;
  /** 是否已互换主副武器：true 时主开火键打副武器、副开火键打主武器 */
  private weaponsSwapped = false;
  private cameraMode: 'chase' | 'cockpit' = 'chase';
  private wave = 1;
  private sector = 1;
  private waveTransition = 0;
  private failed = false;
  private primaryCompleted = false;
  private decisionElapsed = 0;
  /** 决策窗口已超过建议时长：只用于 UI 提示，不再自动推进波次。 */
  private decisionUrged = false;
  private damagedThisStep = false;
  /**
   * 本步内累积的玩家伤害，步末由 flushPlayerDamage() 一次性结算。
   * 这样「同一帧多颗子弹齐射」只扣一次血（防瞬秒），
   * 而跨步的持续伤害（撞击）仍然逐步生效（否则玩家会永远不死）。
   */
  private pendingPlayerDamage = 0;
  /**
   * 本步累积的**环境伤害**（峡谷岩壁 / 残骸撞击）。
   * 环境伤害不受出生保护与受击无敌帧豁免 —— 持续贴墙时每步都在累积，会稳定掉血。
   */
  private pendingEnvironmentDamage = 0;
  private expedition: ExpeditionDirector;
  private readonly enemyBehavior: EnemyBehaviorSystem;
  private readonly cargo: LootAndCargoSystem;
  private readonly primaryEvent: ExpeditionEventKind;
  private readonly player: PlayerState;
  private enemies: EnemyState[];
  private projectiles: ProjectileState[] = [];
  private combatEvents: CombatEvent[] = [];
  private pickups: PickupState[];
  private cooldowns: Record<WeaponSlot, number> = { primary: 0, secondary: 0 };

  /** 连击：连续击杀计数 + 剩余时间（见 COMBAT_FEEL.comboWindowSeconds） */
  private comboCount = 0;
  private comboTimer = 0;
  private comboBest = 0;

  /** 当前生效的局内强化模块 */
  private activeUpgrades: Array<{ id: string; remaining: number }> = [];

  /** 连击分数倍率：达到 COMBAT_FEEL.comboTiers 的阶梯就跳档 */
  private comboMultiplier(): number {
    let multiplier = 1;
    for (const tier of COMBAT_FEEL.comboTiers) {
      if (this.comboCount >= tier.count) multiplier = Math.max(multiplier, tier.multiplier);
    }
    return multiplier;
  }

  /** 局内强化的合成效果倍率（射速 / 伤害 / 航速 / 护盾 / 能耗） */
  private upgradeEffects(): {
    fireRate: number;
    damage: number;
    speed: number;
    shield: number;
    energy: number;
  } {
    let fireRate = 1;
    let damage = 1;
    let speed = 1;
    let shield = 1;
    let energy = 1;
    for (const active of this.activeUpgrades) {
      const definition = COMBAT_UPGRADES.find(entry => entry.id === active.id);
      if (!definition) continue;
      if (definition.fireRateMultiplier) fireRate *= definition.fireRateMultiplier;
      if (definition.damageMultiplier) damage *= definition.damageMultiplier;
      if (definition.speedMultiplier) speed *= definition.speedMultiplier;
      if (definition.shieldMultiplier) shield *= definition.shieldMultiplier;
      if (definition.energyMultiplier) energy *= definition.energyMultiplier;
    }
    return { fireRate, damage, speed, shield, energy };
  }

  /** 强化模块计时推进；顺带让过期的模块消失 */
  private updateUpgrades(dt: number): void {
    if (!this.activeUpgrades.length) return;
    this.activeUpgrades = this.activeUpgrades.filter((active) => {
      active.remaining -= dt;
      return active.remaining > 0;
    });
  }

  /**
   * 把 shield 增益倍率真正作用到护盾上限（此前 upgradeEffects() 算出的倍率无人读取）。
   * 每帧按当前增益重算，倍率到期后自动复原到 baseMaxShield；生效时当前护盾按上限增量补足。
   */
  private syncUpgradeShieldCapacity(): void {
    const nextMax = this.baseMaxShield * this.upgradeEffects().shield;
    const delta = nextMax - this.player.maxShield;
    this.player.maxShield = nextMax;
    if (delta > 0) {
      this.player.shield = Math.min(nextMax, this.player.shield + delta);
    } else if (delta < 0) {
      this.player.shield = Math.min(nextMax, this.player.shield);
    }
  }

  /** hunt 目标固定为开波时本波精英数，避免用全局累计 kills 导致越往后越不可达。 */
  private syncHuntTarget(): void {
    if (this.objectiveType !== 'hunt') return;
    this.huntTargetKills = Math.max(1, this.enemies.filter(
      (enemy) => enemy.role === 'elite' || enemy.kind === this.objectiveEliteKind,
    ).length);
  }

  private readonly worldEventsEnabled: boolean;
  private readonly forcedWorldEvents: WorldEventKind[];
  private worldEventSequence = 0;
  private nextWorldEventAt: number;
  private activeWorldEvent: WorldEventKind | null = null;
  private worldEventRemaining = 0;
  private docked = false;
  private securedCargoValue = 0;
  /** 护盾容量基准（不含局内增益倍率），增益到期/离港据此复原；refit 永久提升累加在此 */
  private baseMaxShield: number;
  /** 累计改装次数（refit），供 HUD 事件提示 */
  private refitCount = 0;
  /** 未注入经济端口时使用的内置星港券 */
  private fallbackTickets = OUTPOST_DEFAULT_TICKETS;
  private readonly economy: OutpostServiceEconomy;
  private assistedTargetId: string | null = null;
  private aimAssistGrace = 0;

  /**
   * 当前区域规则（见 FlightTuning.REGION_RULES）。
   *
   * 之前扇区号只用来显示名字，四个扇区打法完全一样 —— 玩家推得再远也只是
   * 看 HUD 换个字。现在扇区决定区域规则：峡谷 / 风暴 / 残骸带 / 开阔 轮换，
   * 每种区域给玩家不同的约束（撞墙掉血、锁定变短、残骸压过来）。
   */
  private regionId: RegionId = 'open';
  /**
   * 本步是否正在「蹭峡谷壁」。
   * 位置会被推回航道内，所以下一帧的坐标判定会认为玩家已经在航道里 → 不再扣血。
   * 用这个状态记住「上一帧还在墙外」，让贴墙飞行持续付出代价。
   */
  private canyonScraping = false;
  /** 残骸带里的漂浮残骸 */
  private debris: DebrisState[] = [];
  private nextDebrisId = 1;

  /**
   * defense（守点）目标状态。
   * 敌人靠近核心 → 进度倒扣；玩家要守住一个地方，而不是一味往前冲。
   */
  private defensePoint: Vector3 = { x: 0, y: 0, z: 0 };
  private defenseRadius = 34;
  /** defense 累计扣掉的进度（秒） */
  private defenseLostSeconds = 0;

  /**
   * escort（护送）目标状态。
   * 运输船跟在玩家身后，挨打或被甩开都会掉进度。
   */
  private escortPosition: Vector3 = { x: 0, y: 0, z: 0 };
  /** 运输船起始位置，离港重开战局时恢复 */
  private escortStart: Vector3 = { x: 0, y: 0, z: 0 };
  private escortHealth = 100;
  private escortFollowDistance = 46;

  /**
   * 由扇区号推导区域规则：1 峡谷 / 2 风暴 / 3 残骸带 / 4 开阔，循环。
   * 用扇区而不是随机数，是让玩家能预期「再推一个扇区会遇到什么」。
   */
  private regionForSector(sector: number): RegionId {
    const order: RegionId[] = ['canyon', 'storm', 'debris', 'open'];
    const index = (Math.max(1, Math.floor(sector)) - 1) % order.length;
    return order[index];
  }

  private regionRule(): RegionRule {
    return REGION_RULES[this.regionId];
  }

  /** 当前区域规则（供 HUD / 快照读） */
  public currentRegion(): { id: RegionId; name: string; brief: string } {
    const rule = this.regionRule();
    return { id: rule.id, name: rule.name, brief: rule.brief };
  }

  constructor(options: CombatSimulationOptions) {
    this.seed = finiteNumber(options.seed, finiteNumber(options.mission.seed, 1));
    this.worldEventsEnabled = options.worldEvents?.enabled !== false;
    this.forcedWorldEvents = [...(options.worldEvents?.forcedSequence || [])];
    this.nextWorldEventAt = Math.max(0.05, finiteNumber(
      options.worldEvents?.firstDelay,
      20 + this.seededUnit(1701) * 14,
    ));
    this.missionId = options.mission.id;
    // 开局即处于扇区 1 对应的区域（峡谷），让规则从第一秒就生效
    this.regionId = this.regionForSector(this.sector);
    this.primaryEvent = options.mission.primaryEvent || 'intercept';
    this.expedition = new ExpeditionDirector({
      seed: this.seed,
      primaryEvent: this.primaryEvent,
    });
    this.enemyBehavior = new EnemyBehaviorSystem(this.seed);
    this.cargo = new LootAndCargoSystem(8 + Math.max(0, Math.floor(options.cargoCapacityBonus || 0)), this.seed);
    const objective = options.mission.objective;
    this.objectiveType = objective?.type === 'collect'
      || objective?.type === 'survive'
      || objective?.type === 'hunt'
      || objective?.type === 'defense'
      || objective?.type === 'escort'
      ? objective.type
      : 'eliminate';
    this.objectiveCargoRatio = clampFinite(objective?.cargoRatio, 0.55, 0.2, 1);
    this.objectiveSurviveSeconds = Math.max(6, Math.floor(clampFinite(objective?.surviveSeconds, 45, 6, 240)));
    this.objectiveEliteKind = objective?.eliteKind || 'gunship';
    this.requiredKills = Math.max(1, Math.floor(objective?.requiredKills || 1));
    // survive 目标不靠清敌推进，用存活秒数作为编队规模的依据（给够撑时间的杂兵）
    if (this.objectiveType === 'survive') {
      this.requiredKills = Math.max(4, Math.round(this.objectiveSurviveSeconds / 5));
    }
    // defense：守点目标。需要一个核心坐标与「敌人靠近就开始掉进度」的半径。
    this.defensePoint = cloneVector(objective?.defensePoint || PRIMARY_OUTPOST_POSITION);
    this.defenseRadius = Math.max(8, clampFinite(objective?.defenseRadius, 34, 8, 120));
    // defense 的进度基准 = 需要守住的秒数（敌人靠近核心就倒扣）
    if (this.objectiveType === 'defense') {
      this.requiredKills = Math.max(12, Math.floor(clampFinite(objective?.surviveSeconds, 60, 12, 240)));
    }
    // escort：护送目标。运输船跟在玩家身后，被甩太远或挨打都会掉进度。
    this.escortPosition = cloneVector(objective?.escortStart || FLIGHT_TUNING.player.startPosition);
    this.escortStart = cloneVector(this.escortPosition);
    this.escortHealth = 100;
    this.escortFollowDistance = Math.max(6, clampFinite(objective?.escortFollowDistance, 46, 6, 140));
    if (this.objectiveType === 'escort') {
      this.requiredKills = Math.max(12, Math.floor(clampFinite(objective?.surviveSeconds, 60, 12, 240)));
    }
    // 记录开局目标量与经济端口：离港重开战局时据此恢复，不沿用上一局膨胀后的值。
    this.baseRequiredKills = this.requiredKills;
    this.economy = options.economy ?? {
      getTickets: () => this.fallbackTickets,
      spendTickets: (amount: number) => {
        if (this.fallbackTickets < amount) return false;
        this.fallbackTickets -= amount;
        return true;
      },
    };
    this.loadout = resolveLoadout(options.loadout);
    this.shipDefinition = resolvePlayerShip(this.loadout.ship);
    const ship = this.shipDefinition;
    const core = FRAME_CORES[this.loadout.core];
    const device = TACTICAL_DEVICES[this.loadout.device];
    const engine = ENGINE_MODULES[this.loadout.engine];
    const shield = SHIELD_MODULES[this.loadout.shield];
    const utility = UTILITY_MODULES[this.loadout.utility];
    const boost = BOOST_MODULES[this.loadout.boost];
    const maxEnergy = FLIGHT_TUNING.player.maxEnergy
      * (core.energyCapacityMultiplier || 1)
      * boost.energyCapacityMultiplier
      * ship.energyMultiplier;
    const maxShield = core.maxShield * shield.capacityMultiplier * ship.shieldMultiplier
      + Math.max(0, Math.floor(finiteNumber(options.shieldCapacityBonus, 0)));
    // 基准护盾上限不含局内增益倍率，增益到期后据此复原；refit 的永久提升也累加在此。
    this.baseMaxShield = maxShield;
    const maxHealth = Math.round(core.maxHealth * ship.healthMultiplier);
    this.player = {
      position: cloneVector(FLIGHT_TUNING.player.startPosition),
      attitude: neutralAttitude(),
      health: maxHealth,
      shield: maxShield,
      energy: maxEnergy,
      score: 0,
      pickupsCollected: 0,
      maxHealth,
      maxShield,
      maxEnergy,
      speedMultiplier: core.speedMultiplier * engine.speedMultiplier * ship.speedMultiplier,
      strafeMultiplier: engine.strafeMultiplier * ship.strafeMultiplier,
      boostMultiplier: boost.boostMultiplier,
      damageMultiplier: (core.damageMultiplier || 1)
        * (device.damageMultiplier || 1)
        * utility.damageMultiplier
        * ship.damageMultiplier,
      pickupRadius: Math.max(
        device.pickupRadius || FLIGHT_TUNING.player.pickupRadius,
        FLIGHT_TUNING.player.pickupRadius + utility.pickupRadius,
      ) + Math.max(0, finiteNumber(options.pickupRadiusBonus, 0))
        + ship.pickupRadiusBonus,
      healthRegen: (device.healthRegen || 0) + utility.healthRegen,
      energyRechargeMultiplier: device.energyRechargeMultiplier || 1,
      shieldRecharge: shield.rechargePerSecond * (device.shieldRegenMultiplier || 1),
      spawnProtection: FLIGHT_TUNING.player.spawnProtection,
      hitGrace: 0,
      speedScale: 0,
    };
    this.enemies = (options.mission.enemies || []).map((enemy) => {
      const kind = enemy.kind || 'scout';
      const tuning = this.enemyTuning(kind);
      const health = Math.max(1, finiteNumber(enemy.health, tuning.health));
      return {
        id: enemy.id,
        kind,
        position: missionVector(enemy.position, { x: 0, y: 0, z: 0 }),
        velocity: { x: 0, y: 0, z: 0 },
        health,
        maxHealth: health,
        radius: tuning.radius,
        score: tuning.score,
        fireCooldown: 0.65 + (this.seededUnit(enemy.id.length) * 0.7),
        ramCooldown: 0,
        role: this.enemyRole(kind),
        telegraphElapsed: 0,
        intent: 'close',
        faction: 'raider',
        lastDamagedBy: 'world',
      };
    });
    this.pickups = (options.mission.pickups || []).map((pickup) => ({
      id: pickup.id,
      kind: pickup.kind,
      position: missionVector(pickup.position, { x: 0, y: 0, z: 0 }),
      value: Math.max(0, finiteNumber(pickup.value, 0)),
      upgradeId: pickup.upgradeId,
    }));
    if (this.enemies.length === 0) this.spawnWave(1);
    // 猎杀目标开局也要有精英可杀，否则第一波目标天然不可达。
    if (this.objectiveType === 'hunt') this.spawnElite(1);
    this.syncHuntTarget();
  }

  step(input: FlightCommandInput = {}, delta = FLIGHT_TUNING.fixedStep): CombatSnapshot {
    this.combatEvents = [];
    if (this.docked) return this.snapshot();
    const command = normalizeFlightCommand(input);
    if (this.failed) {
      return this.snapshot();
    }
    this.updateToggles(command);
    if (this.paused) {
      return this.snapshot();
    }

    this.applyLookPulse(command);
    const fixedCommand = command.yaw === 0 && command.pitch === 0
      ? command
      : { ...command, yaw: 0, pitch: 0 };
    const safeDelta = Math.max(0, Math.min(
      FLIGHT_TUNING.maxCatchUpDelta,
      finiteNumber(delta, 0),
    ));
    this.accumulator += safeDelta;
    while (this.accumulator + 0.000000001 >= FLIGHT_TUNING.fixedStep) {
      this.accumulator -= FLIGHT_TUNING.fixedStep;
      this.simulateFixedStep(fixedCommand);
    }
    return this.snapshot();
  }

  private applyLookPulse(command: FlightCommand): void {
    const aimed = stepFlightAttitude(
      this.player.attitude,
      command,
      FLIGHT_TUNING.fixedStep,
      FLIGHT_TUNING.attitude,
    );
    this.player.attitude = {
      ...this.player.attitude,
      aimYaw: aimed.aimYaw,
      aimPitch: aimed.aimPitch,
    };
  }

  private updateToggles(command: FlightCommand): void {
    // pause 边沿始终要处理（用于进入/解除暂停）。
    if (command.pause && !this.pauseHeld) {
      this.paused = !this.paused;
    }
    // 暂停态（含本帧刚按下暂停）只维护 held 位，不处理切镜头/换武器，
    // 否则暂停时也会偷偷改状态并派发 weapons-swapped 事件。
    if (this.paused) {
      this.pauseHeld = command.pause;
      this.cameraHeld = command.cameraToggle;
      this.swapHeld = command.swapWeapons;
      return;
    }
    if (command.cameraToggle && !this.cameraHeld) {
      this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    }
    // 主副武器互换：边沿触发，按一次切换一次，长按不会反复切换。
    if (command.swapWeapons && !this.swapHeld) {
      this.weaponsSwapped = !this.weaponsSwapped;
      this.combatEvents.push({
        id: this.nextCombatEventId++,
        type: 'weapons-swapped',
        position: cloneVector(this.player.position),
        source: 'player',
      });
    }
    this.pauseHeld = command.pause;
    this.cameraHeld = command.cameraToggle;
    this.swapHeld = command.swapWeapons;
  }

  /**
   * 把「物理开火键」映射到「实际武器」。
   *
   * 机库选定的主炮 / 副武器存在 `loadout.weapon` / `loadout.secondary` 里，
   * 是固定真值。战斗中按下互换后，`weaponsSwapped` 为真，
   * 主开火键改打副武器、副开火键改打主武器 —— 但冷却仍挂在物理键上，
   * 所以换过去不会瞬间又开火，也不会继承对方键的冷却，手感公平。
   */
  private resolveWeaponForSlot(slot: WeaponSlot): WeaponDefinition {
    const effective = this.weaponsSwapped
      ? (slot === 'primary' ? 'secondary' : 'primary')
      : slot;
    return effective === 'primary'
      ? PRIMARY_WEAPONS[this.loadout.weapon]
      : SECONDARY_WEAPONS[this.loadout.secondary];
  }

  private simulateFixedStep(command: FlightCommand): void {
    const dt = FLIGHT_TUNING.fixedStep;
    this.damagedThisStep = false;
    this.pendingPlayerDamage = 0;
    this.tick += 1;
    this.elapsed += dt;
    this.updateCooldowns(dt);
    this.updateUpgrades(dt);
    this.syncUpgradeShieldCapacity();
    this.updateCombo(dt);
    this.updatePlayer(command, dt);
    this.applyRegionRules(dt);
    this.updateWorldEvents(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    // 步末统一结算本步累积的伤害，再开启短暂无敌帧。
    this.flushPlayerDamage();
    this.collectPickups();
    this.updateAimAssist();
    this.fireWeapons(command);
    // 增援要在敌人结算之后判定：本步刚清完的敌人才不会被立刻补回来。
    this.updateReinforcements(dt);
    this.updateObjectiveSpecials(dt);
    this.updateMission(command, dt);
  }

  /** 连击计时：窗口内继续杀就续上，超时断连击 */
  private updateCombo(dt: number): void {
    if (this.comboTimer <= 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.comboTimer = 0;
      this.comboCount = 0;
    }
  }

  /**
   * survive 目标的增援：定期补充杂兵，让「撑时间」不是无聊的挂机。
   *
   * 此前所有目标都是「清光敌人就完成」，只要打得快就瞬间结束，
   * 战斗过程被压缩到十几秒，玩家来不及进入状态。
   * survive 目标靠持续压力把单波战斗拉回到可接受的节奏。
   */
  private updateReinforcements(dt: number): void {
    if (this.objectiveType !== 'survive' || this.primaryCompleted || this.docked || this.failed) return;
    this.waveTransition += dt;
    if (this.waveTransition < REINFORCEMENT_INTERVAL) return;
    // 场上敌人越多增援越少，避免玩家被瞬间淹没
    const headroom = Math.max(0, SURVIVE_ENEMY_CAP - this.enemies.length);
    // 敌满时保留计时：空位一出现就能立刻增援，不必再等满 7 秒。
    if (headroom <= 0) return;
    const count = Math.min(headroom, 1 + Math.floor(this.expedition.snapshot().threat / 2));
    this.spawnReinforcement(count);
    // 只有真正投放增援后才清零计时。
    this.waveTransition = 0;
  }

  private spawnReinforcement(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const kind = this.seededUnit(this.tick * 7 + index * 13) < 0.35 ? 'scout' : 'fighter';
      const tuning = this.enemyTuning(kind);
      const angle = this.seededUnit(this.tick * 11 + index * 29) * Math.PI * 2;
      const radius = 52;
      this.enemies.push({
        id: `reinforcement-${this.tick}-${index}`,
        kind,
        position: {
          x: this.player.position.x + Math.cos(angle) * radius,
          y: this.player.position.y + (this.seededUnit(index * 19 + this.tick) - 0.5) * 10,
          z: this.player.position.z + Math.sin(angle) * radius,
        },
        velocity: { x: 0, y: 0, z: 0 },
        health: tuning.health,
        maxHealth: tuning.health,
        radius: tuning.radius,
        score: tuning.score,
        fireCooldown: 1.1,
        ramCooldown: 0,
        role: this.enemyRole(kind),
        telegraphElapsed: 0,
        intent: 'close',
        faction: 'raider',
        lastDamagedBy: 'world',
      });
    }
  }

  private updateCooldowns(dt: number): void {
    this.cooldowns.primary = Math.max(0, this.cooldowns.primary - dt);
    this.cooldowns.secondary = Math.max(0, this.cooldowns.secondary - dt);
  }

  private movementForwardVector(): Vector3 {
    const cosPitch = Math.cos(this.player.attitude.aimPitch);
    return {
      x: Math.sin(this.player.attitude.aimYaw) * cosPitch,
      y: Math.sin(this.player.attitude.aimPitch),
      z: -Math.cos(this.player.attitude.aimYaw) * cosPitch,
    };
  }

  private updatePlayer(command: FlightCommand, dt: number): void {
    this.player.attitude = stepFlightAttitude(
      this.player.attitude,
      command,
      dt,
      FLIGHT_TUNING.attitude,
    );

    const inputLength = Math.hypot(command.throttle, command.strafe);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const throttle = command.throttle * inputScale;
    const strafe = command.strafe * inputScale;
    const boosting = command.boost && this.player.energy > 1;
    const hasThrust = Math.abs(throttle) > 0.02 || Math.abs(strafe) > 0.02 || boosting;

    // ⚠️ 纵向速度是一阶追赶，不是瞬时值。
    //    之前直接用 `cruiseSpeed * dt` 积分 → 松开摇杆速度瞬间归零，
    //    玩家反馈是「像在冰上滑」「飘不起来」，完全没有飞船该有的惯性。
    //
    //    现在按「推油门 / 松手滑行」两种模式分别追赶：
    //     - 推油门：目标 = cruise 或 boost，用 throttleResponse 逼近
    //     - 松手：目标 = **0**，用 coastDrag 衰减 → 先滑行一段再停住
    //
    // ⚠️ 两个都踩过的坑：
    //  1. 松手目标若仍取 maxSpeed → 追赶目标=当前速度 → 速度永不下降。
    //  2. 松手目标若取某个「保底比例」(idleSpeedFloor) → 玩家不操作时
    //     会以该速度**永远匀速飘走**（实测无输入 20 秒飘过 40 个单位，
    //     按住后退飘到 z=721），无法悬停还会飞出战场。
    //     惯性的价值是「松手后滑一段」，不是「永远在动」。
    const maxSpeed = (boosting
      ? FLIGHT_TUNING.player.boostSpeed * this.player.boostMultiplier
      : FLIGHT_TUNING.player.cruiseSpeed) * this.player.speedMultiplier * this.upgradeEffects().speed;
    const targetSpeed = hasThrust ? maxSpeed : 0;
    const response = hasThrust
      ? Math.max(0.05, FLIGHT_TUNING.player.throttleResponse)
      : Math.max(0.05, FLIGHT_TUNING.player.coastDrag);
    const speedStep = dt / response;
    if (this.player.speedScale < targetSpeed) {
      this.player.speedScale = Math.min(targetSpeed, this.player.speedScale + speedStep);
    } else if (this.player.speedScale > targetSpeed) {
      this.player.speedScale = Math.max(targetSpeed, this.player.speedScale - speedStep);
    }
    const speed = this.player.speedScale;

    const forward = this.movementForwardVector();
    const aimYaw = this.player.attitude.aimYaw;
    const right = { x: Math.cos(aimYaw), y: 0, z: Math.sin(aimYaw) };
    // ⚠️ 松手滑行必须**独立于输入**驱动位移。
    //    若位移继续乘 throttle/strafe，松手后输入为 0 → 位移恒为 0，
    //    coastDrag 与 idleSpeedFloor 会变成完全不起作用的装饰参数
    //    （仿真实测：推 1 秒松手后总位移 6.690，与瞬时旧模型完全相同）。
    //    正确做法是：有推力时由输入决定方向，无推力时沿当前朝向继续滑行。
    const driveX = hasThrust ? forward.x * throttle : forward.x;
    const driveZ = hasThrust ? forward.z * throttle : forward.z;
    const sideScale = FLIGHT_TUNING.player.strafeMultiplier * this.player.strafeMultiplier;
    this.player.position.x += (
      driveX + right.x * strafe * sideScale
    ) * speed * dt;
    this.player.position.y += forward.y * throttle * speed * dt;
    this.player.position.z += (
      driveZ + right.z * strafe * sideScale
    ) * speed * dt;
    const outpostDistance = distance(this.player.position, PRIMARY_OUTPOST_POSITION);
    // 碰撞墙 = **站体视觉外壳半径**，必须远小于停靠半径（60）。
    //
    // ⚠️ 这里曾经写的是「停靠半径 + 6」，逻辑是倒的：
    //   停靠判定 = 距离 ≤ 60；碰撞墙 = 距离 < 66 时把玩家推回 66。
    //   玩家在 66 处就被弹开 → 永远进不了 60 的圈 → canDock 永远 false。
    //   这就是用户报的「无法返航 / 定住 XXm 停不下来」，
    //   也让 outpost navigation exposes a usable docking radius 这条测试长期失败。
    //
    // 站体视觉半径 ≈ 5.8（环）× 1.42（出生块缩放）≈ 8.3，停靠臂伸到 z+7.2，
    // 取 15 既不会穿模站体，又远小于 60 → 玩家能进圈、能停靠、也能真的贴到站边。
    const collisionRadius = 15;
    if (outpostDistance < collisionRadius) {
      const scale = collisionRadius / Math.max(0.001, outpostDistance);
      this.player.position.x = PRIMARY_OUTPOST_POSITION.x + (this.player.position.x - PRIMARY_OUTPOST_POSITION.x) * scale;
      this.player.position.y = PRIMARY_OUTPOST_POSITION.y + (this.player.position.y - PRIMARY_OUTPOST_POSITION.y) * scale;
      this.player.position.z = PRIMARY_OUTPOST_POSITION.z + (this.player.position.z - PRIMARY_OUTPOST_POSITION.z) * scale;
    }
    const energyRate = command.boost
      ? -FLIGHT_TUNING.player.boostEnergyDrain
      : FLIGHT_TUNING.player.energyRecharge
        * this.player.energyRechargeMultiplier
        // 风暴区域：能量恢复变慢，逼玩家更谨慎地用加速
        * (this.regionRule().stormEnergyRecoveryScale ?? 1);
    this.player.energy = Math.max(0, Math.min(
      this.player.maxEnergy,
      this.player.energy + energyRate * dt,
    ));
    this.player.health = Math.min(
      this.player.maxHealth,
      this.player.health + this.player.healthRegen * dt,
    );
    this.player.shield = Math.min(
      this.player.maxShield,
      this.player.shield + this.player.shieldRecharge * dt,
    );
    this.player.spawnProtection = Math.max(0, this.player.spawnProtection - dt);
    // 受击无敌帧倒计时
    this.player.hitGrace = Math.max(0, this.player.hitGrace - dt);
  }

  /**
   * 区域规则结算：峡谷壁 / 风暴 / 残骸带。
   *
   * 这是「玩法不单一」的核心来源。之前扇区只是换了个名字，
   * 战场规则完全一致；现在每个扇区有自己的物理约束：
   *  - 峡谷：横向超出航道宽度会被推回并持续掉血
   *  - 风暴：敌人开火距离变短（见 updateEnemies），玩家能量恢复变慢（见 updatePlayer）
   *  - 残骸带：残骸持续漂向玩家，撞上掉血，可以打掉
   */
  private applyRegionRules(dt: number): void {
    const rule = this.regionRule();
    // 上一帧是否在墙外（用于判断本步是否「仍需继续扣血」）
    const wasScraping = this.canyonScraping;
    this.canyonScraping = false;
    if (rule.id === 'canyon') {
      this.applyCanyonRule(rule, dt, wasScraping);
      return;
    }
    if (rule.id === 'debris') {
      this.updateDebris(dt, rule);
      return;
    }
    // 非残骸带区域要把残留的残骸清掉（跨扇区时残留）
    if (this.debris.length) this.debris = [];
  }

  /** 峡谷：航道外的位置会被推回航道中心并持续掉血 */
  private applyCanyonRule(rule: RegionRule, dt: number, wasScraping: boolean): void {
    const halfWidth = rule.canyonHalfWidth ?? 0;
    if (halfWidth <= 0) return;
    const boundary = PRIMARY_OUTPOST_POSITION.x + halfWidth;
    const beyondRight = this.player.position.x - boundary;
    const beyondLeft = PRIMARY_OUTPOST_POSITION.x - halfWidth - this.player.position.x;
    const over = Math.max(beyondRight, beyondLeft);
    if (over <= 0) {
      // 玩家已经在航道内（或正好贴在边界上）。
      // ⚠️ 但如果上一帧还在墙外，说明玩家是想贴着岩壁飞 → 继续扣血。
      //    没有这一条的话：位置被推回后 `over` 立刻变成 ≤0，
      //    玩家贴着岩壁飞就完全不掉血，规则形同虚设（实测 health 100→100）。
      if (!wasScraping) return;
      // 还在边界上（没飞回航道内）→ 继续蹭墙，持续扣血
      const stillAtWall = Math.abs(this.player.position.x - boundary) < 0.5
        || Math.abs(this.player.position.x - (PRIMARY_OUTPOST_POSITION.x - halfWidth)) < 0.5;
      if (!stillAtWall) return;
      this.canyonScraping = true;
      this.damagePlayerFromEnvironment((rule.canyonWallDamage ?? 0) * dt);
      return;
    }
    const direction = beyondRight >= beyondLeft ? 1 : -1;
    this.player.position.x = PRIMARY_OUTPOST_POSITION.x + direction * halfWidth;
    this.canyonScraping = true;
    this.damagePlayerFromEnvironment((rule.canyonWallDamage ?? 0) * dt);
  }

  /**
   * 残骸带：残骸朝玩家漂移，撞上扣血；玩家可以把残骸打掉。
   */
  private updateDebris(dt: number, rule: RegionRule): void {
    const driftSpeed = rule.debrisDriftSpeed ?? 0;
    // 按密度补生成残骸（用 seededUnit 保证同一局可复现）
    const expected = (rule.debrisDensity ?? 0) * (this.wave + 1);
    while (this.debris.length < expected) {
      this.spawnDebris(rule);
    }
    for (const debris of this.debris) {
      debris.hitGrace = Math.max(0, debris.hitGrace - dt);
      const offset = {
        x: this.player.position.x - debris.position.x,
        y: this.player.position.y - debris.position.y,
        z: this.player.position.z - debris.position.z,
      };
      const range = Math.max(0.001, Math.hypot(offset.x, offset.y, offset.z));
      debris.velocity = {
        x: (offset.x / range) * driftSpeed,
        y: (offset.y / range) * driftSpeed * 0.35,
        z: (offset.z / range) * driftSpeed,
      };
      debris.position.x += debris.velocity.x * dt;
      debris.position.y += debris.velocity.y * dt;
      debris.position.z += debris.velocity.z * dt;
      const collision = range < debris.radius + 1.1;
      if (collision && debris.hitGrace <= 0) {
        debris.hitGrace = 0.8;
        this.damagePlayerFromEnvironment(rule.debrisImpactDamage ?? 10);
        // 撞上后残骸弹开，避免贴脸持续掉血
        debris.position.x -= (offset.x / range) * (debris.radius + 1.6);
        debris.position.z -= (offset.z / range) * (debris.radius + 1.6);
      }
    }
    this.debris = this.debris.filter((debris) => debris.health > 0);
  }

  /** 在玩家周围生成一块残骸 */
  private spawnDebris(rule: RegionRule): void {
    const angle = this.seededUnit(this.nextDebrisId * 37 + this.wave * 11) * Math.PI * 2;
    const radius = 42 + this.seededUnit(this.nextDebrisId * 53) * 38;
    const health = 24 + this.wave * 4;
    this.debris.push({
      id: `debris-${this.nextDebrisId++}`,
      position: {
        x: this.player.position.x + Math.cos(angle) * radius,
        y: this.player.position.y + (this.seededUnit(this.nextDebrisId * 17) - 0.5) * 16,
        z: this.player.position.z + Math.sin(angle) * radius,
      },
      velocity: { x: 0, y: 0, z: 0 },
      radius: 2.2 + this.seededUnit(this.nextDebrisId * 29) * 1.8,
      health,
      maxHealth: health,
      hitGrace: 0,
    });
  }

  private fireWeapons(command: FlightCommand): void {
    if (command.primaryFire) {
      this.fireWeapon('primary');
    }
    if (command.secondaryFire) {
      this.fireWeapon('secondary');
    }
  }

  private fireWeapon(slot: WeaponSlot): void {
    const weapon = this.resolveWeaponForSlot(slot);
    const behavior = behaviorForWeaponId(weapon.id);
    // 能耗强化倍率乘在本武器能耗上；倍率随增益生效/到期动态读取，无需复原状态。
    const energyCost = weapon.energyCost * this.upgradeEffects().energy;
    if (this.cooldowns[slot] > 0 || this.player.energy < energyCost) {
      return;
    }
    this.cooldowns[slot] = weapon.cooldown * this.upgradeEffects().fireRate
      / this.shipDefinition.fireRateMultiplier;
    this.player.energy -= energyCost;
    const aim = this.aimSolution();
    const origin = computeMuzzlePosition(
      this.player.position,
      {
        yaw: this.player.attitude.hullYaw,
        pitch: this.player.attitude.hullPitch,
      },
      slot === 'primary'
        ? PRIMARY_MUZZLE_LOCAL_POSITION
        : SECONDARY_MUZZLE_LOCAL_POSITION,
    );
    const lead = aim.target
      ? predictInterceptPoint(origin, aim.target.position, aim.target.velocity, weapon.speed)
      : { point: aim.point, seconds: 0 };
    const convergencePoint = lead.point;
    const direction = computeMuzzleDirection(origin, convergencePoint);
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: 'weapon-fired',
      position: cloneVector(origin),
      weapon: weapon.id,
      targetId: aim.target?.id,
      source: 'player',
    });

    const baseDamage = weapon.damage * this.player.damageMultiplier * this.upgradeEffects().damage;
    const pelletCount = behavior.pelletCount ?? 1;
    const spreadRadians = ((behavior.spreadDegrees ?? 0) * Math.PI) / 180;
    for (let index = 0; index < pelletCount; index += 1) {
      // 单发武器（含默认 pulse / missile）走原路径：方向、伤害都与改造前逐值一致。
      // 多弹武器绕世界 Y 轴做扇形偏转，中间那发仍指向收敛点。
      const angle = pelletCount > 1
        ? (index / (pelletCount - 1) - 0.5) * spreadRadians
        : 0;
      const heading = angle === 0
        ? direction
        : {
          x: direction.x * Math.cos(angle) + direction.z * Math.sin(angle),
          y: direction.y,
          z: -direction.x * Math.sin(angle) + direction.z * Math.cos(angle),
        };
      this.projectiles.push({
        id: `projectile-${this.nextProjectileId++}`,
        weapon: weapon.id,
        origin,
        position: cloneVector(origin),
        velocity: {
          x: heading.x * weapon.speed,
          y: heading.y * weapon.speed,
          z: heading.z * weapon.speed,
        },
        damage: baseDamage * (behavior.pelletDamageScale ?? 1),
        radius: weapon.radius,
        life: weapon.life,
        owner: 'player',
        targetId: aim.target?.id,
        pierceLeft: behavior.pierceCount,
        pierceDamageScale: behavior.pierceDamageScale,
        splashRadius: behavior.splashRadius,
        splashDamageScale: behavior.splashDamageScale,
        jamSeconds: behavior.jamSeconds,
        jamSpeedScale: behavior.jamSpeedScale,
        jamFireRateScale: behavior.jamFireRateScale,
      });
    }
  }

  private updateWorldEvents(dt: number): void {
    if (!this.worldEventsEnabled) return;
    if (this.worldEventRemaining > 0) {
      this.worldEventRemaining = Math.max(0, this.worldEventRemaining - dt);
      if (this.worldEventRemaining === 0) {
        if (this.activeWorldEvent === 'rivalry') {
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'rivalry-end',
            position: cloneVector(this.player.position),
            source: 'world',
          });
        }
        this.activeWorldEvent = null;
      }
      return;
    }
    if (this.elapsed < this.nextWorldEventAt) return;

    const event = this.nextWorldEvent();
    this.worldEventSequence += 1;
    this.nextWorldEventAt = this.elapsed + 22 + this.seededUnit(1801 + this.worldEventSequence * 29) * 14;
    if (event === 'supply-drop') {
      const angle = this.seededUnit(1901 + this.worldEventSequence * 17) * Math.PI * 2;
      this.pickups.push({
        id: `field-supply-${this.worldEventSequence}`,
        kind: 'energy',
        position: {
          x: this.player.position.x + Math.cos(angle) * 8,
          y: this.player.position.y,
          z: this.player.position.z + Math.sin(angle) * 8,
        },
        value: Math.max(24, this.player.maxEnergy * 0.35),
      });
      this.combatEvents.push({
        id: this.nextCombatEventId++,
        type: 'supply-drop',
        position: cloneVector(this.player.position),
        source: 'world',
      });
      return;
    }

    const duration = event === 'rivalry' ? 9 : 8;
    this.activeWorldEvent = event;
    this.worldEventRemaining = duration;
    if (event === 'rivalry') {
      [...this.enemies]
        .sort((left, right) => left.id.localeCompare(right.id))
        .forEach((enemy, index) => { enemy.faction = index % 2 === 0 ? 'raider' : 'corsair'; });
    }
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: event === 'rivalry' ? 'rivalry-start' : 'ion-storm',
      position: cloneVector(this.player.position),
      source: 'world',
      duration,
    });
  }

  private nextWorldEvent(): WorldEventKind {
    const forced = this.forcedWorldEvents.shift();
    if (forced) return forced === 'rivalry' && this.enemies.length < 2 ? 'supply-drop' : forced;
    const roll = this.seededUnit(1751 + this.worldEventSequence * 43);
    if (roll < 0.14 && this.enemies.length >= 2) return 'rivalry';
    return roll < 0.55 ? 'ion-storm' : 'supply-drop';
  }

  private updateEnemies(dt: number): void {
    const simultaneousAttackers = Math.min(3, 2 + Math.floor(this.wave / 4));
    const playerAttackers = new Set(
      this.enemies
        .filter((enemy) => enemy.health > 0)
        .sort((left, right) => (
          distance(left.position, this.player.position) - distance(right.position, this.player.position)
        ))
        .slice(0, simultaneousAttackers)
        .map((enemy) => enemy.id),
    );
    for (const enemy of this.enemies) {
      const previousPosition = cloneVector(enemy.position);
      const rival = this.activeWorldEvent === 'rivalry'
        ? this.closestRival(enemy)
        : null;
      // 任务目标会改写敌人的攻击对象：
      //  - defense：部分敌人绕过玩家直扑核心（守点目标才有意义）
      //  - escort ：部分敌人转向运输船（逼玩家回防）
      const objectiveTarget = this.objectiveTargetFor(enemy);
      const target = rival || objectiveTarget || this.player;
      const offset = {
        x: target.position.x - enemy.position.x,
        y: target.position.y - enemy.position.y,
        z: target.position.z - enemy.position.z,
      };
      const range = Math.max(0.001, Math.hypot(offset.x, offset.y, offset.z));
      const trainingProtected = this.player.spawnProtection > 0;
      const approachRange = trainingProtected ? 84 : 24;
      const behavior = this.enemyBehavior.intent({
        id: enemy.id,
        role: enemy.role,
        position: enemy.position,
        telegraphElapsed: enemy.telegraphElapsed,
        attackReady: enemy.fireCooldown <= 0,
      }, target, {
        threat: this.expedition.snapshot().threat,
        // 把当前波次喂给敌机行为系统，让速度与预警时间随波次递进
        wave: this.wave,
        allies: this.enemies.map((ally) => ({
          id: ally.id,
          role: ally.role,
          position: ally.position,
        })),
      });
      enemy.intent = behavior.mode;
      // 离子类武器命中后的干扰：位移与开火都变慢，到时自动失效，不需要额外清理。
      const jammed = (enemy.jammedUntil ?? 0) > this.elapsed;
      const jamSpeed = jammed ? (enemy.jamSpeedScale ?? 1) : 1;
      const jamFireRate = jammed ? (enemy.jamFireRateScale ?? 1) : 1;
      if (trainingProtected && range > approachRange) {
        const speed = 4.2 * jamSpeed;
        enemy.position.x += (offset.x / range) * speed * dt;
        enemy.position.y += (offset.y / range) * speed * dt;
        enemy.position.z += (offset.z / range) * speed * dt;
      } else if (!trainingProtected) {
        const eventSpeed = (this.activeWorldEvent === 'ion-storm' ? 0.68 : 1) * jamSpeed;
        enemy.position.x += behavior.desiredVelocity.x * eventSpeed * dt;
        enemy.position.y += behavior.desiredVelocity.y * eventSpeed * dt;
        enemy.position.z += behavior.desiredVelocity.z * eventSpeed * dt;
      }
      enemy.velocity = dt > 0 ? {
        x: (enemy.position.x - previousPosition.x) / dt,
        y: (enemy.position.y - previousPosition.y) / dt,
        z: (enemy.position.z - previousPosition.z) / dt,
      } : { x: 0, y: 0, z: 0 };

      enemy.fireCooldown -= dt * jamFireRate;
      enemy.ramCooldown = Math.max(0, enemy.ramCooldown - dt);
      enemy.telegraphElapsed += dt;
      if (trainingProtected && !rival) continue;
      if (!rival && range < 4.2) {
        const push = (4.2 - range) * 0.55;
        const direction = range > 0.02
          ? { x: -offset.x / range, y: -offset.y / range, z: -offset.z / range }
          : { x: 0, y: 0, z: -1 };
        enemy.position.x += direction.x * push;
        enemy.position.y += direction.y * push;
        enemy.position.z += direction.z * push;
        if (enemy.ramCooldown <= 0) {
          this.damagePlayer(12 + Math.min(12, this.wave));
          enemy.ramCooldown = 0.72;
        }
      }
      const attackSlotAvailable = Boolean(rival) || playerAttackers.has(enemy.id);
      // 风暴区域：雷达受干扰，敌人锁定距离缩短（更近才敢开火 → 更难被远程压制）
      const lockRange = 140 * (this.regionRule().stormLockRangeScale ?? 1);
      if (attackSlotAvailable && range <= lockRange && enemy.fireCooldown <= 0 && behavior.canFire) {
        // 子弹的 targetId 必须与真正的攻击对象一致，否则会打错人：
        // 冲向核心的敌人打的是核心（hit-defenses），打运输船的打运输船。
        const projectileTargetId = rival
          ? rival.id
          : objectiveTarget
            ? (this.objectiveType === 'defense' ? 'defense-core' : 'escort-convoy')
            : 'player';
        this.fireEnemyProjectile(enemy, offset, range, projectileTargetId);
        const stormCadence = this.activeWorldEvent === 'ion-storm' ? 1.65 : 1;
        enemy.fireCooldown = Math.max(0.9, 1.7 - this.expedition.snapshot().threat * 0.045) * stormCadence;
        enemy.telegraphElapsed = 0;
      }
    }
  }

  /**
   * 任务目标决定的敌人攻击对象。
   *
   * - defense（守点）：约一半敌人绕过玩家直扑核心。
   *   如果敌机全都只打玩家，玩家一路往前冲就能「赢」，守点目标就退化成歼灭。
   * - escort（护送）：一部分敌人转向运输船，逼玩家回防。
   *
   * 用 id 哈希稳定分配（而不是随机），保证同一局里同一架敌人的行为可预期、可复现。
   */
  private objectiveTargetFor(enemy: EnemyState): { position: Vector3 } | null {
    if (this.objectiveType === 'defense') {
      const assigned = this.stableUnit(enemy.id) < 0.5;
      return assigned ? { position: this.defensePoint } : null;
    }
    if (this.objectiveType === 'escort') {
      const assigned = this.stableUnit(enemy.id) < 0.4;
      return assigned ? { position: this.escortPosition } : null;
    }
    return null;
  }

  /** 稳定哈希：同一 id 永远得到同一个 [0,1) 值（用于稳定分配敌人职责） */
  private stableUnit(id: string): number {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0x100000000;
  }

  private closestRival(enemy: EnemyState): EnemyState | null {
    return this.enemies.reduce<EnemyState | null>((nearest, candidate) => {
      if (candidate.id === enemy.id || candidate.faction === enemy.faction || candidate.health <= 0) return nearest;
      if (!nearest) return candidate;
      return distance(enemy.position, candidate.position) < distance(enemy.position, nearest.position)
        ? candidate : nearest;
    }, null);
  }

  private fireEnemyProjectile(enemy: EnemyState, offset: Vector3, range: number, targetId: string): void {
    const direction = {
      x: offset.x / range,
      y: offset.y / range,
      z: offset.z / range,
    };
    const muzzleDistance = Math.min(1.4, Math.max(0.2, range * 0.42));
    const origin = {
      x: enemy.position.x + direction.x * muzzleDistance,
      y: enemy.position.y + direction.y * muzzleDistance,
      z: enemy.position.z + direction.z * muzzleDistance,
    };
    this.projectiles.push({
      id: `enemy-projectile-${this.nextProjectileId++}`,
      weapon: 'enemy-pulse',
      owner: 'enemy',
      sourceId: enemy.id,
      targetId,
      origin,
      position: cloneVector(origin),
      velocity: {
        x: direction.x * 18,
        y: direction.y * 18,
        z: direction.z * 18,
      },
      damage: 7 + Math.min(9, this.wave * 0.65),
      radius: 0.34,
      life: 5.5,
    });
  }

  private updateProjectiles(dt: number): void {
    const survivors: ProjectileState[] = [];
    for (const projectile of this.projectiles) {
      if (projectile.owner === 'player' && projectile.targetId) {
        this.guidePlayerProjectile(projectile, dt);
      }
      const previousPosition = cloneVector(projectile.position);
      projectile.position.x += projectile.velocity.x * dt;
      projectile.position.y += projectile.velocity.y * dt;
      projectile.position.z += projectile.velocity.z * dt;
      projectile.life -= dt;
      if (projectile.owner === 'enemy') {
        if (projectile.targetId === 'player'
          && segmentDistanceToPoint(previousPosition, projectile.position, this.player.position) <= projectile.radius + 1.15) {
          this.damagePlayer(projectile.damage);
          continue;
        }
        // 守点目标：子弹命中核心 → 核心受损（进度倒扣）
        if (projectile.targetId === 'defense-core'
          && segmentDistanceToPoint(previousPosition, projectile.position, this.defensePoint) <= projectile.radius + 2.4) {
          this.defenseLostSeconds += 1.6;
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'hit',
            position: closestPointOnSegment(previousPosition, projectile.position, this.defensePoint),
            targetId: 'defense-core',
            weapon: projectile.weapon,
            damage: projectile.damage,
            lethal: false,
          });
          continue;
        }
        // 护送目标：子弹命中运输船 → 运输船受损
        if (projectile.targetId === 'escort-convoy'
          && segmentDistanceToPoint(previousPosition, projectile.position, this.escortPosition) <= projectile.radius + 2.4) {
          this.escortHealth = Math.max(0, this.escortHealth - projectile.damage * 0.45);
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'hit',
            position: closestPointOnSegment(previousPosition, projectile.position, this.escortPosition),
            targetId: 'escort-convoy',
            weapon: projectile.weapon,
            damage: projectile.damage,
            lethal: this.escortHealth <= 0,
          });
          continue;
        }
        const rivalTarget = projectile.targetId && projectile.targetId !== 'player'
          ? this.enemies.find((enemy) => enemy.id === projectile.targetId)
          : null;
        if (rivalTarget
          && segmentDistanceToPoint(previousPosition, projectile.position, rivalTarget.position)
            <= projectile.radius + rivalTarget.radius) {
          const damage = Math.min(rivalTarget.health, projectile.damage);
          rivalTarget.health -= projectile.damage;
          rivalTarget.lastDamagedBy = 'enemy';
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'hit',
            position: closestPointOnSegment(previousPosition, projectile.position, rivalTarget.position),
            targetId: rivalTarget.id,
            weapon: projectile.weapon,
            damage,
            lethal: rivalTarget.health <= 0,
            source: 'enemy',
          });
          continue;
        }
      } else {
        const target = this.enemies.find((enemy) => {
          // 穿透弹不能在同一目标上反复结算，否则一发能瞬间打空整队。
          if (projectile.hitIds && projectile.hitIds.indexOf(enemy.id) >= 0) return false;
          const lockAssist = enemy.id === projectile.targetId
            ? Math.min(2.4, 0.7 + distance(previousPosition, enemy.position) * 0.012)
            : 0;
          return segmentDistanceToPoint(previousPosition, projectile.position, enemy.position)
            <= projectile.radius + enemy.radius + lockAssist;
        });
        if (target) {
          this.applyPlayerProjectileHit(projectile, target, previousPosition);
          if ((projectile.pierceLeft ?? 0) > 0) {
            // 穿透：记录已命中目标、按系数衰减伤害，本帧直接续飞（跳过残骸碰撞）。
            projectile.pierceLeft = (projectile.pierceLeft ?? 0) - 1;
            projectile.damage *= projectile.pierceDamageScale ?? 1;
            projectile.hitIds = [...(projectile.hitIds ?? []), target.id];
            // 清掉锁定，否则制导会带着穿透弹绕回刚打过的目标，永远够不到后排。
            projectile.targetId = undefined;
            if (
              projectile.life > 0
              && distance(projectile.position, this.player.position) <= FLIGHT_TUNING.projectile.cullDistance
            ) {
              survivors.push(projectile);
            }
          }
          continue;
        }
        // 残骸带：玩家子弹命中残骸扣血，扣到 0 后由 updateDebris 清除（此前 health 从不减少）。
        const debrisHit = this.debris.find((debris) =>
          segmentDistanceToPoint(previousPosition, projectile.position, debris.position)
            <= projectile.radius + debris.radius);
        if (debrisHit) {
          debrisHit.health -= projectile.damage;
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'hit',
            position: closestPointOnSegment(previousPosition, projectile.position, debrisHit.position),
            targetId: debrisHit.id,
            weapon: projectile.weapon,
            damage: projectile.damage,
            lethal: debrisHit.health <= 0,
            source: 'player',
          });
          continue;
        }
      }
      if (
        projectile.life > 0
        && distance(projectile.position, this.player.position) <= FLIGHT_TUNING.projectile.cullDistance
      ) {
        survivors.push(projectile);
      }
    }
    this.projectiles = survivors;
    const destroyed = this.enemies.filter((enemy) => enemy.health <= 0);
    for (const enemy of destroyed) {
      const source = enemy.lastDamagedBy;
      this.combatEvents.push({
        id: this.nextCombatEventId++,
        type: 'destroyed',
        position: cloneVector(enemy.position),
        targetId: enemy.id,
        lethal: true,
        source,
      });
      if (source !== 'player') continue;
      this.kills += 1;
      // 猎杀目标只认精英：杂兵照常计分，但只有击落精英才推进目标进度，
      // 这样「先打谁」才成为必须主动做的决策，而不是顺手清场。
      if (enemy.kind === this.objectiveEliteKind || enemy.role === 'elite') this.eliteKills += 1;
      // 连击：连续击杀累积，连击窗口内再杀就续上；分数随倍率放大。
      // 之前连杀和慢慢打得分完全一样，战斗节奏很平。
      this.comboCount += 1;
      this.comboTimer = COMBAT_FEEL.comboWindowSeconds;
      if (this.comboCount > this.comboBest) this.comboBest = this.comboCount;
      this.player.score += Math.round(enemy.score * this.comboMultiplier());
      const drops = this.cargo.createDrops({
        enemyId: enemy.id,
        role: enemy.role,
        eventKind: this.primaryEvent,
        sequence: this.kills,
        threat: this.expedition.snapshot().threat,
      });
      drops.forEach((drop, index) => {
        this.pickups.push({
          id: drop.id,
          kind: 'loot',
          position: {
            x: enemy.position.x + (index - ((drops.length - 1) / 2)) * 1.4,
            y: enemy.position.y,
            z: enemy.position.z,
          },
          value: drop.value || 0,
          cargoItem: drop,
        });
      });
      // 精英 / Boss 掉落局内强化模块：让「先打谁、什么时候冒险去捡」成为局内决策
      const isElite = enemy.role === 'elite' || enemy.kind === 'elite';
      const isBoss = enemy.kind === 'boss';
      if (isElite || isBoss) {
        const upgrade = this.rollUpgrade(isElite);
        if (upgrade) {
          this.pickups.push({
            id: `${enemy.id}-upgrade-${this.kills}`,
            kind: 'upgrade',
            position: {
              x: enemy.position.x,
              y: enemy.position.y,
              z: enemy.position.z,
            },
            value: 0,
            upgradeId: upgrade.id,
          });
        }
      }
    }
    this.enemies = this.enemies.filter((enemy) => enemy.health > 0);
  }

  /** 按权重抽一个局内强化模块（精英权重更高） */
  private rollUpgrade(elite: boolean): CombatUpgradeDefinition | null {
    const pool = COMBAT_UPGRADES.filter(definition => (
      elite ? definition.eliteWeight > 0 : definition.weight > 0
    ));
    if (!pool.length) return null;
    const total = pool.reduce((sum, definition) => (
      sum + (elite ? definition.eliteWeight : definition.weight)
    ), 0);
    let roll = this.seededUnit(this.kills * 7919 + pool.length) * total;
    for (const definition of pool) {
      roll -= elite ? definition.eliteWeight : definition.weight;
      if (roll <= 0) return definition;
    }
    return pool[pool.length - 1];
  }

  /**
   * 玩家弹丸命中目标：基础伤害 + 武器行为（溅射 / 干扰）。
   *
   * 击杀、连击与掉落统一由 `updateProjectiles` 末尾的 destroyed 过滤处理，
   * 所以溅射打死的敌人也会正常计分、进连击、掉货，不需要在这里重复一遍。
   */
  private applyPlayerProjectileHit(
    projectile: ProjectileState,
    target: EnemyState,
    previousPosition: Vector3,
  ): void {
    const damage = Math.min(target.health, projectile.damage);
    target.health -= projectile.damage;
    target.lastDamagedBy = 'player';
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: 'hit',
      position: closestPointOnSegment(previousPosition, projectile.position, target.position),
      targetId: target.id,
      weapon: projectile.weapon,
      damage,
      lethal: target.health <= 0,
      source: 'player',
    });
    if (projectile.splashRadius && projectile.splashDamageScale) {
      const splashDamage = projectile.damage * projectile.splashDamageScale;
      for (const other of this.enemies) {
        if (other.id === target.id || other.health <= 0) continue;
        if (distance(target.position, other.position) > projectile.splashRadius + other.radius) continue;
        const dealt = Math.min(other.health, splashDamage);
        other.health -= splashDamage;
        other.lastDamagedBy = 'player';
        this.combatEvents.push({
          id: this.nextCombatEventId++,
          type: 'hit',
          position: cloneVector(other.position),
          targetId: other.id,
          weapon: projectile.weapon,
          damage: dealt,
          lethal: other.health <= 0,
          source: 'player',
        });
      }
    }
    if (projectile.jamSeconds) {
      target.jammedUntil = Math.max(
        target.jammedUntil ?? 0,
        this.elapsed + projectile.jamSeconds,
      );
      target.jamSpeedScale = projectile.jamSpeedScale ?? 1;
      target.jamFireRateScale = projectile.jamFireRateScale ?? 1;
    }
  }

  private guidePlayerProjectile(projectile: ProjectileState, dt: number): void {
    const target = this.enemies.find((enemy) => enemy.id === projectile.targetId);
    if (!target) return;
    const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
    const range = distance(projectile.position, target.position);
    if (speed <= 0.001 || range <= 0.001) return;
    const desired = {
      x: (target.position.x - projectile.position.x) / range,
      y: (target.position.y - projectile.position.y) / range,
      z: (target.position.z - projectile.position.z) / range,
    };
    const current = {
      x: projectile.velocity.x / speed,
      y: projectile.velocity.y / speed,
      z: projectile.velocity.z / speed,
    };
    // 转向率统一由武器行为表给出。副武器 missile(7.5) / plasma(3.8) 与改造前一致；
    // 顺带修正主炮 missile-primary 此前被当成普通弹（只给 2.4）的不一致。
    const turnRate = behaviorForWeaponId(projectile.weapon).homingTurnRate ?? 2.4;
    const blend = Math.min(1, turnRate * dt);
    const steered = {
      x: current.x + (desired.x - current.x) * blend,
      y: current.y + (desired.y - current.y) * blend,
      z: current.z + (desired.z - current.z) * blend,
    };
    const length = Math.hypot(steered.x, steered.y, steered.z) || 1;
    projectile.velocity.x = steered.x / length * speed;
    projectile.velocity.y = steered.y / length * speed;
    projectile.velocity.z = steered.z / length * speed;
  }

  /**
   * 玩家受伤入口：只**累积**本步伤害，不立即扣血。
   *
   * ⚠️ 无敌帧的**原始目的是「同一帧的齐射不要一次打空」**，不是让玩家免疫持续伤害。
   * 之前直接 `if (hitGrace > 0) return` 会产生两个副作用：
   *  1. 持续接触伤害（撞击）也被挡 → 玩家可能永远不死（实测护盾在 4~21 之间
   *     反复回充，60 秒挂机都不会失败）。
   *  2. 每一次受击都会刷新 0.42s，等于无限续期。
   *
   * 现在改成「同一步内累加、步末一次性结算」：
   *  - 一步内多颗子弹/撞击的伤害先累加到 pendingPlayerDamage，只扣一次血 → 齐射不会瞬秒
   *  - 步末才应用伤害并开启无敌帧 → 跨步的持续伤害仍然生效，玩家依然会死
   */
  /**
   * 目标类型的专属每帧结算：defense（守点）与 escort（护送）。
   *
   * 这两个目标是「行动方向」和前三类不同的玩法：
   *  - eliminate / hunt / collect 都鼓励玩家**往前推进**
   *  - defense 要求玩家**留在核心附近**，冲太远就守不住
   *  - escort 要求玩家**带着运输船走**，清场太远运输船会挨打
   */
  private updateObjectiveSpecials(dt: number): void {
    if (this.objectiveType === 'defense') {
      this.updateDefenseObjective(dt);
      return;
    }
    if (this.objectiveType === 'escort') {
      this.updateEscortObjective(dt);
    }
  }

  /** 守点：敌人进入核心半径就开始倒扣进度 */
  private updateDefenseObjective(dt: number): void {
    let threat = 0;
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      const gap = distance(enemy.position, this.defensePoint);
      if (gap < this.defenseRadius) {
        // 越靠近核心，扣得越快
        threat += (1 - gap / this.defenseRadius) + 0.35;
      }
    }
    if (threat > 0) {
      this.defenseLostSeconds += threat * dt * 2.2;
      // 敌人压制核心时倒扣已守住秒数
      this.defenseHeldSeconds = Math.max(0, this.defenseHeldSeconds - threat * dt * 2.2);
    } else {
      // 已守住秒数从 0 起递增；此前进度初值就等于目标，首帧即判通关。
      this.defenseHeldSeconds += dt;
    }
  }

  /** 护送：运输船跟在玩家身后，敌人打它或被甩太远都会掉血 */
  private updateEscortObjective(dt: number): void {
    let underThreat = false;
    const gap = distance(this.player.position, this.escortPosition);
    if (gap > this.escortFollowDistance) {
      // 被甩开：运输船跟不上，开始持续受损
      underThreat = true;
      this.escortHealth = Math.max(0, this.escortHealth - (gap - this.escortFollowDistance) * 0.22 * dt);
    } else {
      // 跟得上：运输船慢慢追上来（朝玩家方向移动）
      const direction = {
        x: this.player.position.x - this.escortPosition.x,
        y: this.player.position.y - this.escortPosition.y,
        z: this.player.position.z - this.escortPosition.z,
      };
      const range = Math.max(0.001, Math.hypot(direction.x, direction.y, direction.z));
      const followSpeed = Math.min(range, 16);
      this.escortPosition.x += (direction.x / range) * followSpeed * dt;
      this.escortPosition.y += (direction.y / range) * followSpeed * dt;
      this.escortPosition.z += (direction.z / range) * followSpeed * dt;
    }
    // 敌人靠近运输船就会攻击它
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      const gap = distance(enemy.position, this.escortPosition);
      if (gap < 6) {
        underThreat = true;
        this.escortHealth = Math.max(0, this.escortHealth - 6 * dt);
      }
    }
    // 已护送进度从 0 起递增，被甩开/挨打时倒扣；不再拿满血 100 当完成量。
    this.escortProgress = Math.max(0, Math.min(100,
      this.escortProgress + (underThreat ? -dt * 3 : dt * 4)));
  }

  private damagePlayer(damage: number): void {
    if (this.player.spawnProtection > 0 || this.failed) return;
    this.pendingPlayerDamage += Math.max(0, damage);
  }

  /**
   * 环境伤害入口（峡谷岩壁 / 残骸撞击）。
   *
   * 与 `damagePlayer` 的区别：**不受出生保护豁免**。
   * 出生保护是给「敌人齐射」的缓冲，撞墙撞残骸是玩家自己的操作失误，
   * 如果也被豁免，玩家在开局 10 秒内可以毫无代价地贴着岩壁飞 —— 规则形同虚设。
   * 环境伤害仍然走同一套累积-步末结算，且不吃受击无敌帧
   * （持续贴墙时每一步都在累积伤害，会稳定掉血而不是被无敌帧挡掉）。
   */
  private damagePlayerFromEnvironment(damage: number): void {
    if (this.failed) return;
    this.pendingPlayerDamage += Math.max(0, damage);
    this.pendingEnvironmentDamage += Math.max(0, damage);
  }

  /** 步末统一应用累积伤害，并开启短暂无敌帧。 */
  private flushPlayerDamage(): void {
    const damage = this.pendingPlayerDamage;
    const environmentDamage = this.pendingEnvironmentDamage;
    this.pendingPlayerDamage = 0;
    this.pendingEnvironmentDamage = 0;
    if (damage <= 0 || this.failed) {
      return;
    }
    // 拆出环境伤害与敌人伤害：环境伤害始终结算，无敌帧/出生保护只豁免敌人部分。
    // 旧逻辑只在「全部是环境伤害」时才放行，混合伤害会把环境部分一起吞掉。
    const environment = Math.min(damage, Math.max(0, environmentDamage));
    const enemyDamage = damage - environment;
    const immune = this.player.hitGrace > 0 || this.player.spawnProtection > 0;
    const appliedDamage = environment + (immune ? 0 : enemyDamage);
    if (appliedDamage <= 0) return;
    this.damagedThisStep = true;
    const shieldBefore = this.player.shield;
    const shieldDamage = Math.min(this.player.shield, appliedDamage);
    this.player.shield -= shieldDamage;
    const hullDamage = Math.min(this.player.health, appliedDamage - shieldDamage);
    this.player.health = Math.max(0, this.player.health - hullDamage);
    this.player.hitGrace = PLAYER_HIT_TUNING.hitGraceSeconds;
    // 受伤强度分级，供 HUD 做差异化反馈（轻擦 / 重击 / 破盾）
    const ratio = (shieldDamage + hullDamage) / Math.max(1, this.player.maxHealth);
    const intensity = ratio >= PLAYER_HIT_TUNING.heavyHitRatio
      ? 'heavy'
      : ratio >= PLAYER_HIT_TUNING.lightHitRatio ? 'medium' : 'light';
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: 'player-hit',
      position: cloneVector(this.player.position),
      targetId: 'player',
      damage: shieldDamage + hullDamage,
      lethal: this.player.health <= 0,
      source: 'enemy',
      intensity,
    });
    if (shieldBefore > 0 && this.player.shield <= 0) {
      this.combatEvents.push({
        id: this.nextCombatEventId++,
        type: 'shield-break',
        position: cloneVector(this.player.position),
        targetId: 'player',
        damage: shieldDamage,
        source: 'enemy',
      });
    }
    if (this.player.health <= 0) {
      this.failed = true;
      this.paused = false;
      this.pauseHeld = false;
      this.projectiles = [];
    }
  }

  private collectPickups(): void {
    const survivors: PickupState[] = [];
    for (const pickup of this.pickups) {
      const pickupDistance = distance(this.player.position, pickup.position);
      if (pickupDistance > this.player.pickupRadius) {
        if (pickup.cargoItem && pickupDistance <= this.player.pickupRadius + 12) {
          const pull = Math.min(0.22, (this.player.pickupRadius + 12 - pickupDistance) * 0.018);
          pickup.position.x += (this.player.position.x - pickup.position.x) * pull;
          pickup.position.y += (this.player.position.y - pickup.position.y) * pull;
          pickup.position.z += (this.player.position.z - pickup.position.z) * pull;
        }
        survivors.push(pickup);
        continue;
      }
      if (pickup.kind === 'energy') {
        this.player.energy = Math.min(
          this.player.maxEnergy,
          this.player.energy + pickup.value,
        );
      }
      // 修复包：回血。之前任务里从没出现过，属于新增补给类型。
      if (pickup.kind === 'repair') {
        const definition = PICKUP_KINDS.repair;
        // 优先用任务下发的 value，常量仅作缺省回退，与 energy 分支一致。
        const amount = pickup.value > 0 ? pickup.value : (definition.repairAmount ?? 0);
        this.player.health = Math.min(this.player.maxHealth, this.player.health + amount);
      }
      // 护盾包：补盾。
      if (pickup.kind === 'shield') {
        const definition = PICKUP_KINDS.shield;
        const amount = pickup.value > 0 ? pickup.value : (definition.shieldAmount ?? 0);
        this.player.shield = Math.min(this.player.maxShield, this.player.shield + amount);
      }
      // 实体战利品（loot / scrap / data）：进货舱。
      // ⚠️ 之前这三种拾取物**完全没有效果** —— collectPickups 只认 energy 和 upgrade，
      //    玩家飞过去把任务里摆的 scrap/data 捡起来，什么都没发生。
      //    现在它们会变成货舱里的货物，「采集」目标的进度也就能真正被玩家推进。
      if (!pickup.cargoItem) {
        const definition = PICKUP_KINDS[pickup.kind];
        if (definition?.cargoCategory) {
          pickup.cargoItem = {
            id: `${pickup.id}-cargo`,
            category: definition.cargoCategory,
            rarity: definition.cargoRarity || 'common',
            insured: false,
            value: pickup.value,
            firstDiscovery: false,
            slots: 1,
          };
        }
      }
      if (pickup.kind === 'upgrade' && pickup.upgradeId) {
        const definition = COMBAT_UPGRADES.find(entry => entry.id === pickup.upgradeId);
        if (definition) {
          const existing = this.activeUpgrades.find(entry => entry.id === definition.id);
          if (existing) {
            // 同名强化刷新时长而不是叠加，避免叠成无限时长
            existing.remaining = Math.max(existing.remaining, definition.durationSeconds);
          } else {
            this.activeUpgrades.push({ id: definition.id, remaining: definition.durationSeconds });
          }
          this.combatEvents.push({
            id: this.nextCombatEventId++,
            type: 'upgrade-activated',
            position: cloneVector(pickup.position),
            targetId: definition.id,
            duration: definition.durationSeconds,
          });
        }
      }
      if (pickup.cargoItem && !this.cargo.add(pickup.cargoItem)) {
        survivors.push(pickup);
        continue;
      }
      this.player.pickupsCollected += 1;
    }
    this.pickups = survivors;
  }

  /**
   * 目标进度（按目标类型给出「已完成 / 目标量」）。
   * 集中在这一处计算，HUD 只读结果，不各自复算逻辑。
   */
  private objectiveProgress(): { progress: number; target: number } {
    switch (this.objectiveType) {
      case 'survive':
        return { progress: Math.min(this.surviveElapsed, this.objectiveSurviveSeconds), target: this.objectiveSurviveSeconds };
      case 'hunt': {
        // 波内固定目标（本波精英投放数），不再由全局累计 requiredKills 派生，
        // 否则第 2 波起目标无限膨胀而每波只投 1 架精英，永远不可达。
        const target = Math.max(1, this.huntTargetKills);
        return { progress: Math.min(this.eliteKills, target), target };
      }
      case 'collect': {
        // 采集双条件：货舱装满比例达标 **且** 本波敌人清光。
        // 只看装货会让玩家丢下敌人就跑，只看清敌又回到老玩法。
        const cargo = this.cargo.snapshot();
        const need = Math.max(1, Math.ceil(cargo.capacity * this.objectiveCargoRatio));
        return { progress: Math.min(cargo.usedSlots, need), target: need };
      }
      case 'defense': {
        // 守点：进度 = 已守住秒数，从 0 起递增，敌人压制核心时倒扣。
        // 失败判定仍看 defenseLostSeconds（见 updateMission）。
        const target = Math.max(1, this.requiredKills);
        return { progress: Math.min(Math.max(0, this.defenseHeldSeconds), target), target };
      }
      case 'escort': {
        // 护送：进度 = 已护送进度，从 0 起递增，被甩开/挨打时倒扣。
        const target = 100;
        return { progress: Math.min(Math.max(0, Math.round(this.escortProgress)), target), target };
      }
      case 'eliminate':
      default: {
        // 用波内击杀而非全局击杀：否则第 3 波一进场就天然"完成"
        const target = Math.max(1, this.requiredKills - this.waveKillBaseline);
        return { progress: Math.min(Math.max(0, this.kills - this.waveKillBaseline), target), target };
      }
    }
  }

  /** 目标是否达成。survive 看时间，collect 要货舱+清场双达标，其余看进度。 */
  private objectiveReached(): boolean {
    const { progress, target } = this.objectiveProgress();
    if (this.objectiveType === 'survive') return progress >= target;
    if (progress < target) return false;
    if (this.objectiveType === 'collect') return this.enemies.length === 0;
    return true;
  }

  private updateMission(command: FlightCommand, dt: number): void {
    if (this.failed) {
      this.expedition.fail();
      return;
    }
    // survive 目标需要持续计时推进进度
    if (this.objectiveType === 'survive' && !this.primaryCompleted && !this.docked) {
      this.surviveElapsed += dt;
    }
    // defense：守点进度是「守住的秒数」，随时间自然累积，被敌人靠近时倒扣
    if (this.objectiveType === 'defense' && !this.primaryCompleted && !this.docked) {
      this.defenseLostSeconds = Math.max(0, this.defenseLostSeconds - dt);
    }
    // defense / escort 的失败条件：核心失守 / 运输船被毁
    if (!this.primaryCompleted && !this.docked) {
      if (this.objectiveType === 'defense' && this.defenseLostSeconds >= this.requiredKills) {
        this.failed = true;
        this.paused = false;
      }
      if (this.objectiveType === 'escort' && this.escortHealth <= 0) {
        this.failed = true;
        this.paused = false;
      }
    }
    if (this.objectiveReached() && !this.primaryCompleted) {
      this.primaryCompleted = true;
      this.projectiles = [];
      this.expedition.completeEvent('primary');
      this.decisionElapsed = 0;
      // survive：撑满即算过，本波残余敌人随之清除（不给「时间到了但还在挨打」的挫败）
      if (this.objectiveType === 'survive') this.enemies = [];
    } else {
      const expedition = this.expedition.snapshot();
      if (expedition.phase === 'deep-zone' && this.enemies.length === 0) {
        const completedEvent = expedition.availableEvents[0];
        if (completedEvent) this.expedition.completeEvent(completedEvent.id);
        this.projectiles = [];
        this.decisionElapsed = 0;
      }
    }
    this.expedition.step({
      delta: dt,
      returnRequested: command.returnRequested,
      insideReturnZone: true,
      damaged: this.damagedThisStep,
    });
    const expedition = this.expedition.snapshot();
    if (expedition.phase === 'decision') {
      this.decisionElapsed += dt;
      // 决策窗口不再自动推进下一波。原先 9 秒后强制 continue，
      // 玩家根本没有真正的选择权，"继续深入 / 带货返航"只是文案承诺，
      // 实际体验是被倒计时推着走。
      // 现在：倒计时只用于提示紧迫感，推进波次必须由玩家主动操作。
      const urged = this.decisionElapsed >= DECISION_URGE_SECONDS;
      if (urged !== this.decisionUrged) {
        this.decisionUrged = urged;
      }
      if (command.advanceRequested) {
        this.beginNextWave();
        return;
      }
    } else if (expedition.phase !== 'returning') {
      this.decisionElapsed = 0;
      this.decisionUrged = false;
    }
  }

  /** 玩家主动确认深入：推进波次并生成新编队。 */
  private beginNextWave(): void {
    const next = this.expedition.continueExpedition();
    this.wave += 1;
    if ((this.wave - 1) % 3 === 0) this.sector += 1;
    // 扇区决定区域规则（峡谷 / 风暴 / 残骸带 / 开阔），跨扇区时战场规则真的会变
    this.regionId = this.regionForSector(this.sector);
    // 编队规模：随威胁阶梯增长，6 架封顶改为 9 架封顶，避免中后期只剩"血牛海绵"
    const encounterSize = Math.min(9, 2 + Math.ceil(next.threat * 0.8));
    // 进度基准重置：所有目标类型的进度都是「本波内」计的
    this.waveKillBaseline = this.kills;
    this.eliteKills = 0;
    this.surviveElapsed = 0;
    // survive 需要靠「敌人持续存在」制造压力，清场即无意义；
    // 故把目标量设为编队规模的 2 倍，逼迫玩家在死之前尽量换效率。
    this.requiredKills = this.objectiveType === 'survive'
      ? this.kills + encounterSize * 2
      : this.kills + encounterSize;
    this.spawnWave(encounterSize);
    // hunt 目标必须真的有精英可杀，否则进度永远卡住 —— 补投一架
    if (this.objectiveType === 'hunt') this.spawnElite(next.threat);
    // survive 目标周期性增援：不增援就只是清怪，撑时间没有意义
    if (this.objectiveType === 'survive') {
      this.waveTransition = 0;
    }
    // 本波精英投放完毕，固定本波猎杀目标
    this.syncHuntTarget();
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: 'wave-start',
      position: cloneVector(this.player.position),
      wave: this.wave,
      threatTier: Math.max(1, Math.ceil(next.threat)),
      enemyCount: encounterSize,
    });
    this.decisionElapsed = 0;
    this.decisionUrged = false;
  }

  /** 投放一架精英：猎杀目标的进度来源，血量随威胁阶梯增长。 */
  private spawnElite(threat: number): void {
    const kind = this.objectiveEliteKind;
    const tuning = this.enemyTuning(kind);
    const angle = this.seededUnit(this.wave * 53 + 7) * Math.PI * 2;
    const radius = 42;
    const health = tuning.health * 1.35 + Math.min(tuning.health, threat * 5);
    this.enemies.push({
      id: `wave-${this.wave}-elite`,
      kind,
      position: {
        x: this.player.position.x + Math.cos(angle) * radius,
        y: this.player.position.y + 6,
        z: this.player.position.z + Math.sin(angle) * radius,
      },
      velocity: { x: 0, y: 0, z: 0 },
      health,
      maxHealth: health,
      radius: tuning.radius * 1.25,
      // 精英给足分数奖励，让「优先猎杀」在收益上也成立
      score: Math.round(tuning.score * 1.8),
      fireCooldown: 0.9,
      ramCooldown: 0,
      role: 'elite',
      telegraphElapsed: 0,
      intent: 'close',
      faction: 'corsair',
      lastDamagedBy: 'world',
    });
  }

  private spawnWave(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const kind = this.waveEnemyKind(index, count);
      const tuning = this.enemyTuning(kind);
      const angle = this.seededUnit(this.wave * 31 + index * 17) * Math.PI * 2;
      const radius = 28 + this.seededUnit(this.wave * 47 + index * 13) * 34;
      const health = tuning.health + Math.min(tuning.health * 0.8, (this.wave - 1) * 6);
      this.enemies.push({
        id: `wave-${this.wave}-enemy-${index}`,
        kind,
        position: {
          x: this.player.position.x + Math.cos(angle) * radius,
          y: this.player.position.y + (this.seededUnit(index * 23 + this.wave) - 0.5) * 12,
          z: this.player.position.z + Math.sin(angle) * radius,
        },
        velocity: { x: 0, y: 0, z: 0 },
        health,
        maxHealth: health,
        radius: tuning.radius,
        score: tuning.score + this.wave * 12,
        fireCooldown: 0.5 + this.seededUnit(index * 19 + this.wave) * 1.1,
        ramCooldown: 0,
        role: this.enemyRole(kind),
        telegraphElapsed: 0,
        intent: 'close',
        faction: 'raider',
        lastDamagedBy: 'world',
      });
    }
  }

  private waveEnemyKind(index: number, count: number): keyof typeof ENEMY_TUNING | 'elite' | 'support' {
    const last = index === count - 1;
    if (last && this.wave % 6 === 0) return 'boss';
    if (last && this.wave % 3 === 0) return 'gunship';
    // 精英护卫：每 4 波带一台 elite 压阵，让 5 种敌人 AI 都有出场机会
    if (this.wave >= 3 && index === count - 2) return 'elite';
    // 支援机：第 2 波起偶发，逼迫玩家优先处理回血/增益位
    if (this.wave >= 2 && (index + this.wave) % 5 === 0) return 'support';
    if (this.wave >= 2 && (index + this.wave) % 4 === 0) return 'bomber';
    if ((index + this.wave) % 2 === 0) return 'fighter';
    return 'scout';
  }

  private enemyTuning(kind: string): typeof ENEMY_TUNING.scout {
    // 精英 / 压制机 / 支援机此前直接复用 fighter / gunship / bomber，
    // 6 种外形只有 5 套数值，玩家没有理由优先处理谁。现在各自独立。
    if (kind === 'elite') return ENEMY_TUNING.elite;
    if (kind === 'suppressor') return ENEMY_TUNING.suppressor;
    if (kind === 'support') return ENEMY_TUNING.support;
    return Object.prototype.hasOwnProperty.call(ENEMY_TUNING, kind)
      ? ENEMY_TUNING[kind as keyof typeof ENEMY_TUNING]
      : ENEMY_TUNING.scout;
  }

  private seededUnit(salt: number): number {
    let value = Math.imul((this.seed | 0) ^ salt, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0xffffffff;
  }

  private snapshot(): CombatSnapshot {
    const expedition = this.expedition.snapshot();
    const status = this.failed || expedition.phase === 'failed'
      ? 'failed'
      : expedition.phase === 'complete' ? 'complete' : 'active';
    const sectorIndex = (this.sector - 1) % EXPEDITION_SECTORS.length;
    const progress = this.objectiveProgress();
    return {
      seed: this.seed,
      tick: this.tick,
      elapsed: rounded(this.elapsed),
      paused: this.paused,
      cameraMode: this.cameraMode,
      weaponsSwapped: this.weaponsSwapped,
      aimPoint: snapshotVector(this.aimPoint()),
      loadout: { ...this.loadout },
      player: {
        id: 'player',
        position: snapshotVector(this.player.position),
        aimYaw: rounded(this.player.attitude.aimYaw),
        aimPitch: rounded(this.player.attitude.aimPitch),
        yaw: rounded(this.player.attitude.hullYaw),
        pitch: rounded(this.player.attitude.hullPitch),
        health: rounded(this.player.health),
        shield: rounded(this.player.shield),
        energy: rounded(this.player.energy),
        score: this.player.score,
        pickupsCollected: this.player.pickupsCollected,
        maxHealth: rounded(this.player.maxHealth),
        maxShield: rounded(this.player.maxShield),
        maxEnergy: rounded(this.player.maxEnergy),
        speedMultiplier: rounded(this.player.speedMultiplier),
        damageMultiplier: rounded(this.player.damageMultiplier),
        pickupRadius: rounded(this.player.pickupRadius),
  spawnProtection: rounded(this.player.spawnProtection),
        // HUD 用：当前速度比例（做速度表）与受击无敌剩余时间（做受击闪白）
        speedScale: rounded(this.player.speedScale),
        hitGrace: rounded(this.player.hitGrace),
      },
      combo: {
        count: this.comboCount,
        multiplier: rounded(this.comboMultiplier()),
        remaining: rounded(Math.max(0, this.comboTimer)),
        best: this.comboBest,
      },
      upgrades: this.activeUpgrades.map((active) => {
        const definition = COMBAT_UPGRADES.find(entry => entry.id === active.id);
        return {
          id: active.id,
          name: definition?.name || active.id,
          description: definition?.description || '',
          remaining: rounded(Math.max(0, active.remaining)),
        };
      }),
      target: this.targetSnapshot(),
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        kind: enemy.kind,
        position: snapshotVector(enemy.position),
        velocity: snapshotVector(enemy.velocity),
        health: rounded(enemy.health),
        maxHealth: rounded(enemy.maxHealth),
        role: enemy.role,
        intent: enemy.intent,
        telegraph: rounded(enemy.telegraphElapsed),
        faction: enemy.faction,
      })),
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        weapon: projectile.weapon,
        origin: snapshotVector(projectile.origin),
        position: snapshotVector(projectile.position),
        velocity: snapshotVector(projectile.velocity),
        owner: projectile.owner,
        sourceId: projectile.sourceId,
        targetId: projectile.targetId,
        // 行为字段只在对应武器上存在，常规弹的快照结构与改造前逐键一致。
        ...(projectile.pierceLeft !== undefined ? { pierceLeft: projectile.pierceLeft } : {}),
        ...(projectile.splashRadius !== undefined ? { splashRadius: projectile.splashRadius } : {}),
        ...(projectile.jamSeconds !== undefined ? { jamSeconds: projectile.jamSeconds } : {}),
      })),
      combatEvents: this.combatEvents.map((event) => ({
        ...event,
        position: snapshotVector(event.position),
      })),
      worldEvent: {
        kind: this.activeWorldEvent,
        remaining: rounded(this.worldEventRemaining),
      },
      pickups: this.pickups.map((pickup) => ({
        id: pickup.id,
        kind: pickup.kind,
        position: snapshotVector(pickup.position),
        value: rounded(pickup.value),
        category: pickup.cargoItem?.category,
        rarity: pickup.cargoItem?.rarity,
        upgradeId: pickup.upgradeId,
      })),
      cargo: this.cargo.snapshot(),
      navigation: {
        outpostRange: rounded(distance(this.player.position, PRIMARY_OUTPOST_POSITION)),
        canDock: !this.docked && distance(this.player.position, PRIMARY_OUTPOST_POSITION) <= OUTPOST_DOCKING_RADIUS,
        docked: this.docked,
        securedCargoValue: rounded(this.securedCargoValue),
      },
      mission: {
        id: this.missionId,
        status,
        kills: this.kills,
        requiredKills: this.requiredKills,
        objectiveType: this.objectiveType,
        progress: rounded(progress.progress),
        progressTarget: rounded(progress.target),
        surviveRemaining: rounded(Math.max(0, this.objectiveSurviveSeconds - this.surviveElapsed)),
        defensePoint: this.objectiveType === 'defense' ? cloneVector(this.defensePoint) : null,
        defenseRadius: this.objectiveType === 'defense' ? rounded(this.defenseRadius) : 0,
        escortPosition: this.objectiveType === 'escort' ? cloneVector(this.escortPosition) : null,
        escortHealth: this.objectiveType === 'escort' ? rounded(Math.max(0, this.escortHealth)) : 0,
        waveKillBaseline: this.waveKillBaseline,
        wave: this.wave,
        sector: this.sector,
        sectorName: EXPEDITION_SECTORS[sectorIndex],
        region: {
          id: this.regionId,
          name: this.regionRule().name,
          brief: this.regionRule().brief,
        },
        debrisCount: this.debris.length,
        eventName: expedition.phase,
      },
      expedition,
    };
  }

  private aimPoint(): Vector3 {
    return this.aimSolution().point;
  }

  private enemyRole(kind: string): EnemyRole {
    if (kind === 'bomber') return 'bomber';
    if (kind === 'gunship' || kind === 'suppressor') return 'suppressor';
    if (kind === 'support') return 'support';
    if (kind === 'elite' || kind === 'boss') return 'elite';
    return 'interceptor';
  }

  private aimTarget(retaining = false, onlyId?: string): EnemyState | null {
    const ray = computeAimRay({
      position: this.player.position,
      aimYaw: this.player.attitude.aimYaw,
      aimPitch: this.player.attitude.aimPitch,
    });
    let selected: EnemyState | null = null;
    let selectedScore = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (onlyId && enemy.id !== onlyId) continue;
      const offset = {
        x: enemy.position.x - ray.origin.x,
        y: enemy.position.y - ray.origin.y,
        z: enemy.position.z - ray.origin.z,
      };
      const depth = offset.x * ray.direction.x
        + offset.y * ray.direction.y
        + offset.z * ray.direction.z;
      if (depth <= 3 || depth > AIM_CONVERGENCE_DISTANCE * this.shipDefinition.lockRangeMultiplier) continue;
      const closest = computeConvergencePoint(ray, depth);
      const missDistance = distance(enemy.position, closest);
      const assistRadius = retaining
        ? enemy.radius + Math.min(18, Math.max(3.4, depth * 0.1))
        : enemy.radius + Math.min(12, Math.max(2.1, depth * 0.052));
      if (missDistance > assistRadius) continue;
      const score = missDistance / assistRadius + depth * 0.0002;
      if (score < selectedScore) {
        selected = enemy;
        selectedScore = score;
      }
    }
    return selected;
  }

  private updateAimAssist(): void {
    const retained = this.assistedTargetId
      ? this.aimTarget(true, this.assistedTargetId)
      : null;
    const acquired = this.aimTarget(false);
    if (acquired) {
      this.assistedTargetId = acquired.id;
      this.aimAssistGrace = 0.4;
      return;
    }
    if (retained) {
      this.assistedTargetId = retained.id;
      this.aimAssistGrace = 0.4;
      return;
    }
    this.aimAssistGrace = Math.max(0, this.aimAssistGrace - FLIGHT_TUNING.fixedStep);
    if (this.aimAssistGrace <= 0) this.assistedTargetId = null;
  }

  private aimSolution(): AimSolution {
    const ray = computeAimRay({
      position: this.player.position,
      aimYaw: this.player.attitude.aimYaw,
      aimPitch: this.player.attitude.aimPitch,
    });
    const assisted = this.assistedTargetId
      ? this.enemies.find((enemy) => enemy.id === this.assistedTargetId) || null
      : null;
    const selected = (assisted && (this.aimAssistGrace > 0 || this.aimTarget(true, assisted.id)))
      ? assisted
      : this.aimTarget(false);
    return {
      point: selected
        ? cloneVector(selected.position)
        : computeConvergencePoint(ray, AIM_CONVERGENCE_DISTANCE),
      target: selected,
    };
  }

  private targetSnapshot(): CombatSnapshot['target'] {
    const aimedTarget = this.aimSolution().target;
    const selected = aimedTarget || this.enemies.reduce<EnemyState | null>((nearest, enemy) => {
      if (!nearest) return enemy;
      return distance(this.player.position, enemy.position)
        < distance(this.player.position, nearest.position) ? enemy : nearest;
    }, null);
    if (!selected) return null;
    const weapon = this.resolveWeaponForSlot('primary');
    const lead = predictInterceptPoint(this.player.position, selected.position, selected.velocity, weapon.speed);
    return {
      id: selected.id,
      kind: selected.kind,
      health: rounded(selected.health),
      maxHealth: rounded(selected.maxHealth),
      range: rounded(distance(this.player.position, selected.position)),
      role: selected.role,
      intent: selected.intent,
      telegraph: rounded(selected.telegraphElapsed),
      locked: selected === aimedTarget,
      leadPoint: snapshotVector(lead.point),
      leadSeconds: rounded(lead.seconds),
    };
  }

  /**
   * 外层直接驱动暂停/恢复。面板打开时主循环会整体 return，
   * 不能依赖 step() 的 pause 按键边沿（那会让「继续战斗」永远消费不到）。
   */
  public setPaused(paused: boolean): CombatSnapshot {
    this.paused = paused;
    this.pauseHeld = false;
    return this.snapshot();
  }

  public serviceAtOutpost(): CombatSnapshot {
    // 幂等守卫：已停靠时不再重复结算货物/派发事件/清空状态。
    if (this.docked) return this.snapshot();
    this.combatEvents = [];
    this.docked = true;
    // 保留战斗损耗：三量不再写回 max，回满改为站内主动购买服务（serviceStation）。
    // 只清弹幕/冷却/连击/升级/速度等临时战斗状态。
    this.projectiles = [];
    this.cooldowns = { primary: 0, secondary: 0 };
    this.comboCount = 0;
    this.comboTimer = 0;
    this.weaponsSwapped = false;
    this.swapHeld = false;
    this.activeUpgrades = [];
    this.player.speedScale = 0;
    // 增益已清空，护盾上限复原到基准（含 refit 永久提升）。
    this.player.maxShield = this.baseMaxShield;
    this.player.shield = Math.min(this.player.shield, this.player.maxShield);
    this.assistedTargetId = null;
    this.aimAssistGrace = 0;
    this.activeWorldEvent = null;
    this.worldEventRemaining = 0;
    // 触发一次货物结算（settle 后货舱清空，重复返航不会重复计入/发券）。
    const settlement = this.cargo.settleExpedition('returned');
    this.securedCargoValue = settlement.keptValue;
    this.combatEvents.push({
      id: this.nextCombatEventId++,
      type: 'outpost-serviced',
      position: cloneVector(PRIMARY_OUTPOST_POSITION),
      source: 'world',
      cargoValue: settlement.keptValue,
    });
    return this.snapshot();
  }

  /**
   * 站内主动购买服务：返航保留损伤，回满需付费。
   * 只在停靠时生效；星港券不足时不生效并返回当前状态。
   */
  public serviceStation(service: OutpostService): CombatSnapshot {
    if (!this.docked) return this.snapshot();
    const price = OUTPOST_SERVICE_PRICES[service];
    const receipt = `outpost-${service}-${this.seed}-${this.tick}-${this.nextCombatEventId}-${this.refitCount}`;
    if (this.economy.getTickets() < price || !this.economy.spendTickets(price, receipt)) {
      return this.snapshot();
    }
    if (service === 'repair') {
      this.player.health = this.player.maxHealth;
    } else if (service === 'resupply') {
      this.player.energy = this.player.maxEnergy;
    } else {
      // refit：永久小幅提升护盾上限并回满护盾，记录改装次数。
      this.refitCount += 1;
      this.baseMaxShield += REFIT_SHIELD_BONUS;
      this.player.maxShield = this.baseMaxShield * this.upgradeEffects().shield;
      this.player.shield = this.player.maxShield;
    }
    // 派发事件供 HUD 提示（替换事件数组，保证返回值只含本次服务事件）。
    this.combatEvents = [{
      id: this.nextCombatEventId++,
      type: 'outpost-service',
      position: cloneVector(PRIMARY_OUTPOST_POSITION),
      targetId: service,
      source: 'world',
      cargoValue: price,
      refitCount: this.refitCount,
    }];
    return this.snapshot();
  }

  public departOutpost(): CombatSnapshot {
    this.combatEvents = [];
    this.docked = false;
    // 完整重置战局：否则离港首帧沿用上一局 wave/kills，会「立刻通关」并再次自动入港。
    this.wave = 1;
    this.kills = 0;
    this.waveKillBaseline = 0;
    this.eliteKills = 0;
    this.surviveElapsed = 0;
    this.defenseLostSeconds = 0;
    this.defenseHeldSeconds = 0;
    this.escortHealth = 100;
    this.escortProgress = 0;
    this.escortPosition = cloneVector(this.escortStart);
    this.decisionElapsed = 0;
    this.decisionUrged = false;
    this.primaryCompleted = false;
    this.failed = false;
    this.paused = false;
    this.pauseHeld = false;
    this.cameraHeld = false;
    this.swapHeld = false;
    this.weaponsSwapped = false;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboBest = 0;
    this.activeUpgrades = [];
    this.projectiles = [];
    this.debris = [];
    this.canyonScraping = false;
    this.pickups = [];
    this.waveTransition = 0;
    this.sector = 1;
    this.regionId = this.regionForSector(this.sector);
    this.requiredKills = this.baseRequiredKills;
    this.cargo.clear();
    this.securedCargoValue = 0;
    this.activeWorldEvent = null;
    this.worldEventRemaining = 0;
    this.worldEventSequence = 0;
    this.nextWorldEventAt = this.elapsed + 20 + this.seededUnit(1701) * 14;
    this.assistedTargetId = null;
    this.aimAssistGrace = 0;
    this.pendingPlayerDamage = 0;
    this.pendingEnvironmentDamage = 0;
    this.damagedThisStep = false;
    this.accumulator = 0;
    this.cooldowns = { primary: 0, secondary: 0 };
    // 保留 player 的 health/shield/energy/maxShield、score、loadout：
    // 站内买没买服务决定下一局开局状态。增益已清空，护盾上限复原到基准。
    this.player.maxShield = this.baseMaxShield;
    this.player.shield = Math.min(this.player.shield, this.player.maxShield);
    this.player.speedScale = 0;
    // 重建远征并重新投放第一波敌人。
    this.expedition = new ExpeditionDirector({
      seed: (this.seed ^ Math.floor(this.elapsed * 1000 + this.tick + 1)) >>> 0,
      primaryEvent: this.primaryEvent,
    });
    this.enemies = [];
    this.spawnWave(1);
    if (this.objectiveType === 'hunt') this.spawnElite(1);
    this.syncHuntTarget();
    this.player.position = {
      x: PRIMARY_OUTPOST_POSITION.x,
      y: PRIMARY_OUTPOST_POSITION.y,
      z: PRIMARY_OUTPOST_POSITION.z + OUTPOST_DOCKING_RADIUS + 12,
    };
    this.player.spawnProtection = Math.max(this.player.spawnProtection, 3);
    return this.snapshot();
  }
}
