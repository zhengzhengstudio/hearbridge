import { DEFAULT_PLAYER_SHIP, isPlayerShipId } from './ShipCatalog';
import type { PlayerShipId } from './ShipCatalog';

export type WeaponSlot = 'primary' | 'secondary';
export type PrimaryWeaponId = 'pulse' | 'scatter' | 'missile' | 'rail' | 'plasma' | 'ion' | 'beam' | 'rotary';
export type SecondaryWeaponId = 'missile' | 'torpedo' | 'flak' | 'swarm' | 'mine' | 'rocket';
export type TacticalDeviceId = 'targeter' | 'repair' | 'fabricator' | 'collector' | 'aegis' | 'jammer' | 'overclock' | 'decoy';
export type FrameCoreId = 'balanced' | 'vector' | 'bastion' | 'reactor' | 'phantom' | 'dreadnought' | 'vanguard' | 'specter';
export type EngineId = 'vector-drive' | 'afterburner' | 'cruise-drive' | 'inertial-drive' | 'ion-drive';
export type ShieldId = 'pulse-screen' | 'aegis-screen' | 'reflector' | 'phase-screen' | 'kinetic-screen';
export type UtilityId = 'scanner' | 'tractor' | 'repair-drone' | 'decoy-drone' | 'survey-probe';
export type BoostId = 'overdrive' | 'coolant' | 'capacitor' | 'stabilizer' | 'emergency-cell';
export type SkinId = 'graphite' | 'rescue' | 'void' | 'hazard' | 'azure' | 'desert';

export interface CombatLoadout {
  /** 玩家机型。缺省时回退到基线截击机，旧存档/旧 launcher 无需迁移。 */
  ship?: PlayerShipId;
  weapon: PrimaryWeaponId;
  device: TacticalDeviceId;
  core: FrameCoreId;
  secondary?: SecondaryWeaponId;
  engine?: EngineId;
  shield?: ShieldId;
  utility?: UtilityId;
  boost?: BoostId;
  skin?: SkinId;
}

export type ResolvedCombatLoadout = Required<CombatLoadout>;

export interface WeaponDefinition {
  id: string;
  name: string;
  cooldown: number;
  damage: number;
  energyCost: number;
  speed: number;
  life: number;
  radius: number;
}

export interface TacticalDeviceDefinition {
  id: TacticalDeviceId;
  damageMultiplier?: number;
  pickupRadius?: number;
  healthRegen?: number;
  energyRechargeMultiplier?: number;
  shieldRegenMultiplier?: number;
}

export interface FrameCoreDefinition {
  id: FrameCoreId;
  maxHealth: number;
  maxShield: number;
  speedMultiplier: number;
  damageMultiplier?: number;
  energyCapacityMultiplier?: number;
}

export const DEFAULT_LOADOUT: CombatLoadout = {
  ship: DEFAULT_PLAYER_SHIP,
  weapon: 'pulse',
  device: 'targeter',
  core: 'balanced',
  secondary: 'missile',
  engine: 'vector-drive',
  shield: 'pulse-screen',
  utility: 'scanner',
  boost: 'overdrive',
  skin: 'graphite',
};

export const PRIMARY_WEAPONS: Record<PrimaryWeaponId, WeaponDefinition> = {
  pulse: { id: 'pulse', name: '脉冲炮', cooldown: 0.13, damage: 12, energyCost: 5, speed: 48, life: 3.8, radius: 0.58 },
  scatter: { id: 'scatter', name: '散射炮', cooldown: 0.3, damage: 24, energyCost: 9, speed: 42, life: 3.1, radius: 1.05 },
  missile: { id: 'missile-primary', name: '追踪导弹', cooldown: 0.58, damage: 34, energyCost: 12, speed: 28, life: 5.2, radius: 0.86 },
  rail: { id: 'rail', name: '磁轨炮', cooldown: 0.72, damage: 62, energyCost: 18, speed: 86, life: 1.8, radius: 0.38 },
  plasma: { id: 'plasma', name: '等离子炮', cooldown: 0.24, damage: 19, energyCost: 8, speed: 36, life: 3.6, radius: 1.02 },
  ion: { id: 'ion', name: '离子连炮', cooldown: 0.18, damage: 16, energyCost: 7, speed: 54, life: 2.8, radius: 0.68 },
  beam: { id: 'beam', name: '聚焦束炮', cooldown: 0.92, damage: 86, energyCost: 24, speed: 112, life: 1.35, radius: 0.3 },
  rotary: { id: 'rotary', name: '旋转机炮', cooldown: 0.08, damage: 7, energyCost: 3, speed: 68, life: 2.2, radius: 0.38 },
};

export const TACTICAL_DEVICES: Record<TacticalDeviceId, TacticalDeviceDefinition> = {
  targeter: { id: 'targeter', damageMultiplier: 1.12 },
  repair: { id: 'repair', healthRegen: 2.2 },
  fabricator: { id: 'fabricator', energyRechargeMultiplier: 1.3 },
  collector: { id: 'collector', pickupRadius: 11 },
  aegis: { id: 'aegis', shieldRegenMultiplier: 1.3 },
  jammer: { id: 'jammer', damageMultiplier: 1.04, shieldRegenMultiplier: 1.08 },
  overclock: { id: 'overclock', damageMultiplier: 1.18, energyRechargeMultiplier: 0.86 },
  decoy: { id: 'decoy', healthRegen: 0.8, pickupRadius: 7 },
};

export const FRAME_CORES: Record<FrameCoreId, FrameCoreDefinition> = {
  balanced: { id: 'balanced', maxHealth: 100, maxShield: 80, speedMultiplier: 1 },
  vector: { id: 'vector', maxHealth: 90, maxShield: 70, speedMultiplier: 1.18 },
  bastion: { id: 'bastion', maxHealth: 125, maxShield: 100, speedMultiplier: 0.9 },
  reactor: { id: 'reactor', maxHealth: 100, maxShield: 80, speedMultiplier: 1, energyCapacityMultiplier: 1.25 },
  phantom: { id: 'phantom', maxHealth: 85, maxShield: 65, speedMultiplier: 1.28 },
  dreadnought: { id: 'dreadnought', maxHealth: 140, maxShield: 110, speedMultiplier: 0.82, damageMultiplier: 1.15 },
  vanguard: { id: 'vanguard', maxHealth: 118, maxShield: 94, speedMultiplier: 1.04, damageMultiplier: 1.06 },
  specter: { id: 'specter', maxHealth: 78, maxShield: 58, speedMultiplier: 1.36, damageMultiplier: 1.12 },
};

export const SECONDARY_WEAPONS: Record<SecondaryWeaponId, WeaponDefinition> = {
  missile: { id: 'missile', name: '追踪导弹', cooldown: 0.58, damage: 34, energyCost: 2, speed: 34, life: 2.4, radius: 0.7 },
  torpedo: { id: 'torpedo', name: '重型鱼雷', cooldown: 1.15, damage: 78, energyCost: 12, speed: 24, life: 3.2, radius: 0.95 },
  flak: { id: 'flak', name: '近防震爆弹', cooldown: 0.34, damage: 21, energyCost: 5, speed: 44, life: 1.1, radius: 1.25 },
  swarm: { id: 'swarm', name: '蜂群导弹', cooldown: 0.74, damage: 46, energyCost: 8, speed: 42, life: 2.2, radius: 0.62 },
  mine: { id: 'mine', name: '反航空雷', cooldown: 1.3, damage: 92, energyCost: 14, speed: 18, life: 3.8, radius: 1.4 },
  rocket: { id: 'rocket', name: '无导航火箭', cooldown: 0.22, damage: 28, energyCost: 4, speed: 58, life: 1.65, radius: 0.52 },
};

export const ENGINE_MODULES = {
  'vector-drive': { speedMultiplier: 1, strafeMultiplier: 1 },
  afterburner: { speedMultiplier: 1.14, strafeMultiplier: 0.92 },
  'cruise-drive': { speedMultiplier: 0.96, strafeMultiplier: 1.18 },
  'inertial-drive': { speedMultiplier: 1.06, strafeMultiplier: 1.14 },
  'ion-drive': { speedMultiplier: 1.2, strafeMultiplier: 0.86 },
} as const;

export const SHIELD_MODULES = {
  'pulse-screen': { capacityMultiplier: 1, rechargePerSecond: 1.6 },
  'aegis-screen': { capacityMultiplier: 1.28, rechargePerSecond: 0.8 },
  reflector: { capacityMultiplier: 0.86, rechargePerSecond: 3.1 },
  'phase-screen': { capacityMultiplier: 1.08, rechargePerSecond: 2.2 },
  'kinetic-screen': { capacityMultiplier: 1.42, rechargePerSecond: 0.55 },
} as const;

export const UTILITY_MODULES = {
  scanner: { damageMultiplier: 1.06, pickupRadius: 0, healthRegen: 0 },
  tractor: { damageMultiplier: 1, pickupRadius: 7, healthRegen: 0 },
  'repair-drone': { damageMultiplier: 1, pickupRadius: 0, healthRegen: 1.35 },
  'decoy-drone': { damageMultiplier: 1.04, pickupRadius: 2, healthRegen: 0.6 },
  'survey-probe': { damageMultiplier: 1.09, pickupRadius: 5, healthRegen: 0 },
} as const;

export const BOOST_MODULES = {
  overdrive: { boostMultiplier: 1.2, energyCapacityMultiplier: 1 },
  coolant: { boostMultiplier: 1.08, energyCapacityMultiplier: 1.18 },
  capacitor: { boostMultiplier: 1.12, energyCapacityMultiplier: 1.32 },
  stabilizer: { boostMultiplier: 1.16, energyCapacityMultiplier: 1.12 },
  'emergency-cell': { boostMultiplier: 1.06, energyCapacityMultiplier: 1.46 },
} as const;

export const SKINS: Readonly<Record<SkinId, { readonly id: SkinId }>> = {
  graphite: { id: 'graphite' }, rescue: { id: 'rescue' }, void: { id: 'void' },
  hazard: { id: 'hazard' }, azure: { id: 'azure' }, desert: { id: 'desert' },
};

/** 只认表上自有键：`in` 会把 toString/constructor 等原型链属性误判为合法 id。 */
function owns(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

export function resolveLoadout(value?: Partial<CombatLoadout>): ResolvedCombatLoadout {
  const candidateShip = value?.ship;
  const ship: PlayerShipId = isPlayerShipId(candidateShip) ? candidateShip : DEFAULT_PLAYER_SHIP;
  return {
    ship,
    weapon: value?.weapon && owns(PRIMARY_WEAPONS, value.weapon) ? value.weapon : DEFAULT_LOADOUT.weapon,
    device: value?.device && owns(TACTICAL_DEVICES, value.device) ? value.device : DEFAULT_LOADOUT.device,
    core: value?.core && owns(FRAME_CORES, value.core) ? value.core : DEFAULT_LOADOUT.core,
    secondary: value?.secondary && owns(SECONDARY_WEAPONS, value.secondary) ? value.secondary : DEFAULT_LOADOUT.secondary!,
    engine: value?.engine && owns(ENGINE_MODULES, value.engine) ? value.engine : DEFAULT_LOADOUT.engine!,
    shield: value?.shield && owns(SHIELD_MODULES, value.shield) ? value.shield : DEFAULT_LOADOUT.shield!,
    utility: value?.utility && owns(UTILITY_MODULES, value.utility) ? value.utility : DEFAULT_LOADOUT.utility!,
    boost: value?.boost && owns(BOOST_MODULES, value.boost) ? value.boost : DEFAULT_LOADOUT.boost!,
    skin: value?.skin && owns(SKINS, value.skin) ? value.skin : 'graphite',
  };
}

export const WEAPON_CATALOG: Record<WeaponSlot, WeaponDefinition> = {
  primary: PRIMARY_WEAPONS.pulse,
  secondary: SECONDARY_WEAPONS.missile,
};

/**
 * 武器行为表（玩法差异化第一阶段）。
 *
 * 此前 `WeaponDefinition` 只有数值字段，`fireWeapon()` 永远只发一发直线弹丸：
 * 「散射炮」不散射、「蜂群导弹」只发一发、「磁轨炮 / 束炮」不穿透、
 * 「等离子炮」不溅射、「离子炮」不干扰 —— 换枪只是换数字，玩家感觉不到打法区别。
 *
 * `kind` 只用于装配台 / HUD 的行为标签，具体参数彼此独立、可组合
 * （例如蜂群导弹 = 多弹扇形 + 制导；等离子炮 = 溅射 + 轻度制导）。
 *
 * ⚠️ 基线约束：`pulse` 与默认副武器 `missile` 必须保持原有数值与单发路径完全不变，
 * 否则既有确定性模拟测试（弹丸数量、枪口位置、初速方向）会全线漂移。
 */
export type WeaponBehaviorKind =
  | 'standard' | 'spread' | 'pierce' | 'splash' | 'homing' | 'jam';

export interface WeaponBehavior {
  readonly kind: WeaponBehaviorKind;
  /** 装配台 / HUD 行为标签的本地化键 */
  readonly labelKey: string;
  /** 一次开火发射的弹丸数（spread） */
  readonly pelletCount?: number;
  /** 扇形总张角（度） */
  readonly spreadDegrees?: number;
  /** 多弹时每发伤害系数，用于把总输出拉回可控区间 */
  readonly pelletDamageScale?: number;
  /** 首次命中后还能继续命中的目标数（pierce） */
  readonly pierceCount?: number;
  /** 每穿透一个目标后的伤害保留系数 */
  readonly pierceDamageScale?: number;
  /** 溅射半径与溅射伤害系数（splash） */
  readonly splashRadius?: number;
  readonly splashDamageScale?: number;
  /** 制导转向率；缺省沿用 guidePlayerProjectile 的默认 2.4 */
  readonly homingTurnRate?: number;
  /** 命中后让目标减速 / 开火变慢的时长与倍率（jam） */
  readonly jamSeconds?: number;
  readonly jamSpeedScale?: number;
  readonly jamFireRateScale?: number;
}

const STANDARD_BEHAVIOR: WeaponBehavior = {
  kind: 'standard',
  labelKey: 'behavior.standard',
};

export const PRIMARY_WEAPON_BEHAVIORS: Readonly<Record<PrimaryWeaponId, WeaponBehavior>> = {
  pulse: STANDARD_BEHAVIOR,
  scatter: {
    kind: 'spread',
    labelKey: 'behavior.spread',
    pelletCount: 3,
    spreadDegrees: 13,
    pelletDamageScale: 0.46,
  },
  missile: {
    kind: 'homing',
    labelKey: 'behavior.homing',
    homingTurnRate: 7.5,
  },
  rail: {
    kind: 'pierce',
    labelKey: 'behavior.pierce',
    pierceCount: 3,
    pierceDamageScale: 0.78,
  },
  plasma: {
    kind: 'splash',
    labelKey: 'behavior.splash',
    splashRadius: 3.4,
    splashDamageScale: 0.45,
    homingTurnRate: 3.8,
  },
  ion: {
    kind: 'jam',
    labelKey: 'behavior.jam',
    jamSeconds: 2.6,
    jamSpeedScale: 0.55,
    jamFireRateScale: 0.6,
  },
  beam: {
    kind: 'pierce',
    labelKey: 'behavior.pierce',
    pierceCount: 4,
    pierceDamageScale: 0.86,
  },
  rotary: STANDARD_BEHAVIOR,
};

export const SECONDARY_WEAPON_BEHAVIORS: Readonly<Record<SecondaryWeaponId, WeaponBehavior>> = {
  missile: {
    kind: 'homing',
    labelKey: 'behavior.homing',
    homingTurnRate: 7.5,
  },
  torpedo: {
    kind: 'splash',
    labelKey: 'behavior.splash',
    splashRadius: 4.4,
    splashDamageScale: 0.55,
  },
  flak: {
    kind: 'splash',
    labelKey: 'behavior.splash',
    splashRadius: 3.6,
    splashDamageScale: 0.5,
  },
  swarm: {
    kind: 'spread',
    labelKey: 'behavior.spread',
    pelletCount: 3,
    spreadDegrees: 17,
    pelletDamageScale: 0.62,
    homingTurnRate: 5,
  },
  mine: {
    kind: 'splash',
    labelKey: 'behavior.splash',
    splashRadius: 5.2,
    splashDamageScale: 0.62,
  },
  rocket: STANDARD_BEHAVIOR,
};

/**
 * 弹丸携带的是 `WeaponDefinition.id`，不是 catalog key：
 * 主炮 missile 的 id 是 `'missile-primary'`，副武器才是 `'missile'`。
 * 这里按真实 id 建索引，调用方不必记两套命名。
 */
const BEHAVIOR_BY_PROJECTILE_ID: Readonly<Record<string, WeaponBehavior>> = (() => {
  const table: Record<string, WeaponBehavior> = {};
  const primaryIds = Object.keys(PRIMARY_WEAPONS) as PrimaryWeaponId[];
  for (const key of primaryIds) {
    table[PRIMARY_WEAPONS[key].id] = PRIMARY_WEAPON_BEHAVIORS[key];
  }
  const secondaryIds = Object.keys(SECONDARY_WEAPONS) as SecondaryWeaponId[];
  for (const key of secondaryIds) {
    table[SECONDARY_WEAPONS[key].id] = SECONDARY_WEAPON_BEHAVIORS[key];
  }
  return table;
})();

export function behaviorForWeaponId(id: string): WeaponBehavior {
  return owns(BEHAVIOR_BY_PROJECTILE_ID, id)
    ? BEHAVIOR_BY_PROJECTILE_ID[id]
    : STANDARD_BEHAVIOR;
}

/**
 * 战术设备主动技能表（玩法差异化第二阶段）。
 *
 * 此前 8 个战术设备全是被动倍率：装上就常驻，玩家在战斗中没有任何可按的东西，
 * 「带哪个设备」只影响数值，不影响打法。现在每个设备保留原有被动加成，
 * 另外获得一个独立冷却、边沿触发、效果彼此完全不同的主动技能。
 *
 * ⚠️ 基线约束：不按技能键时模拟行为逐值不变；技能只在 `deviceAbility` 的
 * 上升沿触发一次，长按不会连发；冷却与能量任一不足都静默失败（不改变任何状态）。
 */
export type DeviceAbilityKind =
  | 'fire-control'    // 火控锁定：短时伤害放大
  | 'field-repair'    // 应急抢修：立即回血 + 持续再生
  | 'energy-injection'// 能量灌注：立即回满 + 短时能耗减半
  | 'tractor-pulse'   // 牵引脉冲：把半径内货物一次性拉进舱
  | 'shield-surge'    // 护盾过载：立即补盾 + 短时减伤
  | 'ecm-burst'       // 全域干扰：敌人减速、开火变慢
  | 'overclock'       // 极限超频：射速 / 移速暴涨，代价是护盾停充
  | 'phantom-decoy';  // 幻影诱饵：敌人丢失目标，停追停火

export interface DeviceAbilityDefinition {
  readonly id: TacticalDeviceId;
  readonly kind: DeviceAbilityKind;
  /** 装配台 / HUD 技能名的本地化键 */
  readonly labelKey: string;
  /** 冷却秒数（从按下瞬间开始计） */
  readonly cooldown: number;
  /** 触发所需能量 */
  readonly energyCost: number;
  /** 持续效果秒数；0 表示一次性脉冲 */
  readonly duration: number;
  /** 主效果参数，含义由 kind 决定 */
  readonly magnitude: number;
  /** 立即结算量（回血 / 回盾 / 回能）；0 表示没有立即结算 */
  readonly immediate: number;
}

export const DEVICE_ABILITIES: Readonly<Record<TacticalDeviceId, DeviceAbilityDefinition>> = {
  targeter: {
    id: 'targeter', kind: 'fire-control', labelKey: 'ability.targeter',
    cooldown: 11, energyCost: 14, duration: 6, magnitude: 1.55, immediate: 0,
  },
  repair: {
    id: 'repair', kind: 'field-repair', labelKey: 'ability.repair',
    cooldown: 14, energyCost: 16, duration: 5, magnitude: 3.2, immediate: 26,
  },
  fabricator: {
    id: 'fabricator', kind: 'energy-injection', labelKey: 'ability.fabricator',
    cooldown: 12, energyCost: 0, duration: 5, magnitude: 0.5, immediate: 999,
  },
  collector: {
    id: 'collector', kind: 'tractor-pulse', labelKey: 'ability.collector',
    cooldown: 10, energyCost: 12, duration: 0, magnitude: 28, immediate: 0,
  },
  aegis: {
    id: 'aegis', kind: 'shield-surge', labelKey: 'ability.aegis',
    cooldown: 15, energyCost: 18, duration: 5, magnitude: 0.45, immediate: 42,
  },
  jammer: {
    id: 'jammer', kind: 'ecm-burst', labelKey: 'ability.jammer',
    cooldown: 13, energyCost: 16, duration: 6, magnitude: 0.45, immediate: 0,
  },
  overclock: {
    id: 'overclock', kind: 'overclock', labelKey: 'ability.overclock',
    cooldown: 12, energyCost: 10, duration: 6, magnitude: 1.7, immediate: 0,
  },
  decoy: {
    id: 'decoy', kind: 'phantom-decoy', labelKey: 'ability.decoy',
    cooldown: 14, energyCost: 15, duration: 5, magnitude: 0, immediate: 0,
  },
};

/** 未知 / 损坏的存档 id 一律回落到默认设备，避免 undefined 传播到模拟层。 */
export function deviceAbilityFor(id: TacticalDeviceId): DeviceAbilityDefinition {
  return owns(DEVICE_ABILITIES, id)
    ? DEVICE_ABILITIES[id]
    : DEVICE_ABILITIES[DEFAULT_LOADOUT.device];
}
