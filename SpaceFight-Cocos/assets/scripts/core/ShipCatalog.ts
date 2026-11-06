/**
 * 玩家可驾驶机型目录。
 *
 * 设计约束（2026-11-04）：
 * - `interceptor` 是基线机型，所有倍率恒为 1；这样既有的确定性模拟测试
 *   （护盾/血量/速度/伤害的具体数值）在默认装配下完全不变。
 * - 倍率只作用在 CombatSimulation 构造玩家的那一处，不碰敌人数值表，
 *   也不碰渲染管线；机型外形沿用 ShipPresenter 里同名的 GLB 模型。
 */

export type PlayerShipId = 'interceptor' | 'scout' | 'fighter' | 'bomber' | 'gunship';

export interface PlayerShipDefinition {
  readonly id: PlayerShipId;
  /** 机身编号，launcher 与 HUD 上显示。 */
  readonly code: string;
  /** 本地化键，指向 Localization 的 ship.<id>。 */
  readonly nameKey: string;
  readonly roleKey: string;
  readonly healthMultiplier: number;
  readonly shieldMultiplier: number;
  readonly speedMultiplier: number;
  readonly strafeMultiplier: number;
  readonly damageMultiplier: number;
  readonly fireRateMultiplier: number;
  readonly energyMultiplier: number;
  readonly lockRangeMultiplier: number;
  readonly pickupRadiusBonus: number;
  /** 三段状态条的 0-100 展示值，仅用于 launcher/HUD 的静态档案卡。 */
  readonly displayShield: number;
  readonly displayArmor: number;
  readonly displayEnergy: number;
}

export const PLAYER_SHIPS: Readonly<Record<PlayerShipId, PlayerShipDefinition>> = {
  interceptor: {
    id: 'interceptor', code: 'SF-09', nameKey: 'ship.interceptor', roleKey: 'ship.role.interceptor',
    healthMultiplier: 1, shieldMultiplier: 1, speedMultiplier: 1, strafeMultiplier: 1,
    damageMultiplier: 1, fireRateMultiplier: 1, energyMultiplier: 1,
    lockRangeMultiplier: 1, pickupRadiusBonus: 0,
    displayShield: 80, displayArmor: 100, displayEnergy: 100,
  },
  scout: {
    id: 'scout', code: 'SF-12', nameKey: 'ship.scout', roleKey: 'ship.role.scout',
    healthMultiplier: 0.85, shieldMultiplier: 0.85, speedMultiplier: 1.22, strafeMultiplier: 1.28,
    damageMultiplier: 0.85, fireRateMultiplier: 1.15, energyMultiplier: 1,
    lockRangeMultiplier: 1.25, pickupRadiusBonus: 8,
    displayShield: 68, displayArmor: 85, displayEnergy: 100,
  },
  fighter: {
    id: 'fighter', code: 'SF-21', nameKey: 'ship.fighter', roleKey: 'ship.role.fighter',
    healthMultiplier: 1.05, shieldMultiplier: 1, speedMultiplier: 1.08, strafeMultiplier: 1.1,
    damageMultiplier: 1.1, fireRateMultiplier: 1.05, energyMultiplier: 1,
    lockRangeMultiplier: 1.08, pickupRadiusBonus: 0,
    displayShield: 80, displayArmor: 105, displayEnergy: 100,
  },
  bomber: {
    id: 'bomber', code: 'SF-33', nameKey: 'ship.bomber', roleKey: 'ship.role.bomber',
    healthMultiplier: 1.35, shieldMultiplier: 1.2, speedMultiplier: 0.82, strafeMultiplier: 0.78,
    damageMultiplier: 1.35, fireRateMultiplier: 0.72, energyMultiplier: 1.15,
    lockRangeMultiplier: 0.95, pickupRadiusBonus: 0,
    displayShield: 96, displayArmor: 135, displayEnergy: 115,
  },
  gunship: {
    id: 'gunship', code: 'SF-47', nameKey: 'ship.gunship', roleKey: 'ship.role.gunship',
    healthMultiplier: 1.2, shieldMultiplier: 1.35, speedMultiplier: 0.9, strafeMultiplier: 0.88,
    damageMultiplier: 1.22, fireRateMultiplier: 1, energyMultiplier: 1.2,
    lockRangeMultiplier: 1.12, pickupRadiusBonus: 4,
    displayShield: 108, displayArmor: 120, displayEnergy: 120,
  },
};

export const PLAYER_SHIP_IDS: readonly PlayerShipId[] = [
  'interceptor', 'scout', 'fighter', 'bomber', 'gunship',
];

export const DEFAULT_PLAYER_SHIP: PlayerShipId = 'interceptor';

export function isPlayerShipId(value: unknown): value is PlayerShipId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(PLAYER_SHIPS, value);
}

export function resolvePlayerShip(value?: unknown): PlayerShipDefinition {
  return isPlayerShipId(value) ? PLAYER_SHIPS[value] : PLAYER_SHIPS[DEFAULT_PLAYER_SHIP];
}
