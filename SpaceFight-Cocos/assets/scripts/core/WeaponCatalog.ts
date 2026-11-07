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
