import { DEFAULT_ATTITUDE_TUNING } from './FlightAttitude';

export const FLIGHT_TUNING = {
  fixedStep: 1 / 60,
  maxCatchUpDelta: 0.25,
  attitude: DEFAULT_ATTITUDE_TUNING,
  player: {
    startPosition: { x: 0, y: 0, z: 8 },
    maxHealth: 100,
    maxShield: 80,
    maxEnergy: 100,
    cruiseSpeed: 9,
    boostSpeed: 15,
    strafeMultiplier: 0.86,
    yawRate: Math.PI * 2.4,
    pitchRate: Math.PI * 1.5,
    maxPitch: Math.PI * 0.4,
    boostEnergyDrain: 34,
    energyRecharge: 20,
    pickupRadius: 2.2,
    muzzleOffset: 1.4,
    spawnProtection: 10,
    /**
     * 纵向速度积分（手感核心）。
     *
     * 之前速度是**无状态瞬时值**：`position += dir * speed * dt`，
     * 松开摇杆速度立刻归零 → 表现为「像在冰面上滑」「飘不起来」，
     * 完全没有飞船该有的惯性。
     *
     * 现在改成「当前速度 → 目标速度」的一阶追赶：
     *  - 推油门时向 maxSpeed 逼近，耗时`throttleResponse`（越小越跟手）
     *  - 松手时目标速度为 **0**，按`coastDrag` 衰减 → 先滑一段再停住
     *
     * ⚠️ 松手目标速度必须是 0，不能是某个「保底比例」。
     * 曾经用 idleSpeedFloor(0.22) 做保底，结果玩家不操作时会以22% 速度
     * **永远匀速飘走**（实测无输入 20 秒从 z=8飘到 z=-32，
     * 按住后退飘到 z=721），既无法悬停也会慢慢飞出战场。
     * 惯性的价值在于「松手后滑行一段」，而不是「永远在动」。
     */
    throttleResponse: 0.28,
    coastDrag: 0.5,
  },
  projectile: {
    cullDistance: 180,
  },
};

/**
 * 受击反馈：玩家挨打时给一层短暂的无敌帧 + 明显的视觉提示。
 *
 * 之前 `spawnProtection` 只在开局和复活后生效，被弹幕连续命中时会瞬间掉光血，
 * 玩家完全来不及反应（实测一梭子能吃掉 60+ 血）。
 */
export const PLAYER_HIT_TUNING = {
  /** 每次受击后附带的短暂无敌时间，防止被同一次齐射瞬间打死 */
  hitGraceSeconds: 0.42,
  /** 受击时视觉/音效的强度分级阈值（按单次伤害占最大血量的比例） */
  lightHitRatio: 0.08,
  heavyHitRatio: 0.22,
  /** 受击后屏幕震动幅度（世界单位） */
  shakeLight: 0.16,
  shakeHeavy: 0.42,
  /** 护盾被击破时的额外震动 */
  shakeShieldBreak: 0.55,
} as const;

export const ENEMY_TUNING = {
  scout: {
    health: 24,
    radius: 0.92,
    score: 60,
  },
  fighter: {
    health: 38,
    radius: 1.08,
    score: 110,
  },
  bomber: {
    health: 64,
    radius: 1.32,
    score: 190,
  },
  gunship: {
    health: 86,
    radius: 1.55,
    score: 280,
  },
  boss: {
    health: 168,
    radius: 2.05,
    score: 620,
  },
  /**
   * 压制机 / 精英机此前直接复用 gunship / fighter 的血量半径，
   * 结果 6 种外形只有 5 套数值 —— 「换了个样子但手感没变」，
   * 玩家没有理由优先处理谁。这里给它们独立数值。
   */
  suppressor: {
    health: 72,
    radius: 1.42,
    score: 240,
  },
  elite: {
    health: 62,
    radius: 1.58,
    score: 380,
  },
  support: {
    health: 74,
    radius: 1.34,
    score: 250,
  },
};

/**
 * 战斗手感总表（2026-10-23 新增）。
 *
 * 之前这些值散落在 CombatBootstrap 的硬编码里，且大部分**根本没接上**：
 *  - `hitStopRemaining` 只被递减，从未用来暂停模拟 → 「打到了」完全没有实感
 *  - `PLAYER_HIT_TUNING.shakeLight/shakeHeavy/shakeShieldBreak` 三个常量定义了却没人引用
 *  - 屏幕震动真正用的是 triggerCameraFeel 里写死的 0.045/0.09/0.16/0.2/0.26
 *
 * 现在统一放这里，代码里只有一处真值。
 */
export const COMBAT_FEEL = {
  /** 命中停顿（秒）：玩家命中 / 破盾 / 击毁时的模拟冻结时长 */
  hitStopOnHit: 0.045,
  hitStopOnShieldBreak: 0.075,
  hitStopOnKill: 0.085,
  hitStopOnKillBoss: 0.16,

  /** 连击：两次击杀间隔超过这个秒数就断连击 */
  comboWindowSeconds: 4.5,
  /** 连击倍率阶梯（达到 count 连时得分乘以 multiplier） */
  comboTiers: [
    { count: 2, multiplier: 1.2 },
    { count: 4, multiplier: 1.5 },
    { count: 6, multiplier: 2.0 },
    { count: 8, multiplier: 2.6 },
    { count: 12, multiplier: 3.4 },
  ],

  /** 受击震动随伤害占比缩放的上限倍率 */
  shakeDamageScale: 1.8,
  /** 击毁敌人的震动强度（比命中更重） */
  shakeOnKill: 0.14,
  shakeOnKillDuration: 0.26,

  /** 相机 FOV 冲击（度）：开火 / 受击 / 击毁 / 加速 */
  fovBase: 62,
  fovPunchOnFire: 0.35,
  fovPunchOnHitTaken: 0.8,
  fovPunchOnKill: 0.7,
  /** 战斗中主副武器切换时给一点轻微 FOV 冲击，强化"换枪"的反馈感 */
  fovPunchOnWeaponSwap: 0.3,
  fovBoost: 2.0,
  /** FOV 冲击回落速度（每秒） */
  fovPunchDecay: 9,
} as const;

/**
 * 拾取物类型表。
 *
 * 之前任务里摆的 `scrap` / `data` / `loot` 三种拾取物**完全没有效果**：
 * `collectPickups` 只认 `energy`（回能）和 `upgrade`（强化模块），
 * 玩家飞过去把这些东西捡起来，什么都没发生 —— 白摆。
 *
 * 现在每种拾取物都有明确收益：
 *  - energy 回能量
 *  - repair  修复船体（当前血量上限内回复）
 *  - shield  补充护盾
 *  - loot/scrap/data 进入货舱（可被「采集」目标计入进度）
 */
export interface PickupKindDefinition {
  readonly id: string;
  /** 货舱类别：loot/scrap/data 都是可装货的实体战利品 */
  readonly cargoCategory?: 'equipment' | 'material' | 'currency' | 'intel' | 'cosmetic';
  readonly cargoRarity?: 'common' | 'uncommon' | 'rare' | 'epic';
  /** 修复的血量（repair 专用） */
  readonly repairAmount?: number;
  /** 补充的护盾（shield 专用） */
  readonly shieldAmount?: number;
}

export const PICKUP_KINDS: Readonly<Record<string, PickupKindDefinition>> = {
  energy: { id: 'energy' },
  repair: { id: 'repair', repairAmount: 28 },
  shield: { id: 'shield', shieldAmount: 34 },
  loot: { id: 'loot', cargoCategory: 'equipment', cargoRarity: 'uncommon' },
  scrap: { id: 'scrap', cargoCategory: 'material', cargoRarity: 'common' },
  data: { id: 'data', cargoCategory: 'intel', cargoRarity: 'rare' },
  // 新增四类：把货舱的 currency / cosmetic 两类补齐，并让 4 档稀有度都能在任务里出现。
  credit: { id: 'credit', cargoCategory: 'currency', cargoRarity: 'common' },
  alloy: { id: 'alloy', cargoCategory: 'material', cargoRarity: 'uncommon' },
  core: { id: 'core', cargoCategory: 'equipment', cargoRarity: 'epic' },
  relic: { id: 'relic', cargoCategory: 'cosmetic', cargoRarity: 'rare' },
};

/**
 * 区域规则：让「扇区」不只是换个名字。
 *
 * 之前 `EXPEDITION_SECTORS` 只有 4 个中文字符串，扇区号每 3 波 +1，
 * 但**没有任何机制跟着扇区变**——四个扇区打法完全一样，
 * 玩家推进得再远也只是看 HUD 上的名字换个字。
 *
 * 现在每个区域有自己的规则表：
 *  - `canyon`（峡谷）：狭窄航道，两侧有障碍墙，撞墙掉血 + 转向受限
 *  - `storm`（风暴）：能见度差、锁定距离变短、能量恢复变慢
 *  - `debris`（残骸带）：小行星带持续推进，撞上掉血
 *  - `open`（开阔）：无特殊规则，标准战场
 *
 * 区域按扇区循环（sector 1..4 → canyon/storm/debris/open），远行会不断换规则，
 * 玩家需要为不同区域调整打法，这就是「玩法不单一」的最直接来源。
 */
export interface RegionRule {
  readonly id: RegionId;
  readonly name: string;
  readonly brief: string;
  /** 航道半宽（世界单位）：小于该值即视为撞上峡谷壁 */
  readonly canyonHalfWidth?: number;
  /** 撞峡谷壁的持续伤害（每秒） */
  readonly canyonWallDamage?: number;
  /** 峡谷内转向惩罚倍率（>1 转向更迟钝） */
  readonly canyonTurnPenalty?: number;
  /** 风暴中敌方锁定距离缩短比例（0..1） */
  readonly stormLockRangeScale?: number;
  /** 风暴中玩家能量恢复倍率（<1 更慢） */
  readonly stormEnergyRecoveryScale?: number;
  /** 残骸带中陨石的推进速度（世界单位/秒） */
  readonly debrisDriftSpeed?: number;
  /** 残骸带中每 100 波平均生成的陨石数量 */
  readonly debrisDensity?: number;
  /** 撞击陨石伤害（每次） */
  readonly debrisImpactDamage?: number;
}

export type RegionId = 'open' | 'canyon' | 'storm' | 'debris';

export const REGION_RULES: Readonly<Record<RegionId, RegionRule>> = {
  open: {
    id: 'open',
    name: '开阔航道',
    brief: '标准战场，无特殊规则。',
  },
  canyon: {
    id: 'canyon',
    name: '狭窄峡谷',
    brief: '航道两侧有岩壁，撞上会持续掉血，机身转向也会变迟钝。',
    canyonHalfWidth: 46,
    canyonWallDamage: 9,
    canyonTurnPenalty: 1.8,
  },
  storm: {
    id: 'storm',
    name: '离子风暴',
    brief: '风暴干扰雷达，敌人锁定距离变短，你的能量恢复也变慢。',
    stormLockRangeScale: 0.62,
    stormEnergyRecoveryScale: 0.55,
  },
  debris: {
    id: 'debris',
    name: '残骸带',
    brief: '漂浮的残骸持续压过来，撞上立刻掉血，得绕着飞或把它打掉。',
    debrisDriftSpeed: 6.5,
    debrisDensity: 2.4,
    debrisImpactDamage: 14,
  },
};

/**
 * 局内强化模块：精英 / Boss 掉落，捡起来短时间改变手感。
 *
 * 之前一局里玩家的操作深度只有「瞄准 + 按住射击」，
 * 局外商店买的东西不影响局内手感，所以战斗过程本身很平。
 * 强化模块让「先打谁 / 什么时候冒险去捡」成为局内决策。
 */
export interface CombatUpgradeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 持续时间（秒） */
  readonly durationSeconds: number;
  /** 射速倍率（乘在武器冷却上，<1 更快） */
  readonly fireRateMultiplier?: number;
  /** 伤害倍率 */
  readonly damageMultiplier?: number;
  /** 航速倍率 */
  readonly speedMultiplier?: number;
  /** 护盾倍率 */
  readonly shieldMultiplier?: number;
  /** 能耗倍率 */
  readonly energyMultiplier?: number;
  /** 普通敌人掉落权重 */
  readonly weight: number;
  /** 精英 / Boss 掉落权重 */
  readonly eliteWeight: number;
}

export const COMBAT_UPGRADES: readonly CombatUpgradeDefinition[] = [
  {
    id: 'overclock',
    name: '超频弹链',
    description: '射速 +35%',
    durationSeconds: 14,
    fireRateMultiplier: 0.65,
    weight: 10,
    eliteWeight: 18,
  },
  {
    id: 'armor-pierce',
    name: '穿甲弹头',
    description: '伤害 +30%',
    durationSeconds: 14,
    damageMultiplier: 1.3,
    weight: 10,
    eliteWeight: 18,
  },
  {
    id: 'afterburner',
    name: '后燃推进',
    description: '航速 +25%，能耗 -20%',
    durationSeconds: 12,
    speedMultiplier: 1.25,
    energyMultiplier: 0.8,
    weight: 8,
    eliteWeight: 14,
  },
  {
    id: 'ablative',
    name: '烧蚀护盾',
    description: '护盾上限 +40%',
    durationSeconds: 16,
    shieldMultiplier: 1.4,
    weight: 8,
    eliteWeight: 14,
  },
];
