import type { PrimaryWeaponId } from '../core/WeaponCatalog';

export type WeaponResourcePath = `ui/weapons/${PrimaryWeaponId}`;
export type WeaponProjectileVisualFamily =
  | 'pulse-bolt'
  | 'scatter-pellet'
  | 'homing-warhead'
  | 'rail-slug'
  | 'plasma-orb';

export interface WeaponVisualDefinition {
  readonly lowResourcePath: WeaponResourcePath;
  readonly highBundle: 'spacefight-high';
  readonly highResourcePath: WeaponResourcePath;
  readonly accent: string;
  readonly projectileVisualFamily: WeaponProjectileVisualFamily;
}

// Low assets load from the built-in resources bundle; high assets load from spacefight-high.
export const WeaponVisualCatalog = {
  pulse: {
    lowResourcePath: 'ui/weapons/pulse',
    highBundle: 'spacefight-high',
    highResourcePath: 'ui/weapons/pulse',
    accent: 'cyan',
    projectileVisualFamily: 'pulse-bolt',
  },
  scatter: {
    lowResourcePath: 'ui/weapons/scatter',
    highBundle: 'spacefight-high',
    highResourcePath: 'ui/weapons/scatter',
    accent: 'amber',
    projectileVisualFamily: 'scatter-pellet',
  },
  missile: {
    lowResourcePath: 'ui/weapons/missile',
    highBundle: 'spacefight-high',
    highResourcePath: 'ui/weapons/missile',
    accent: 'red',
    projectileVisualFamily: 'homing-warhead',
  },
  rail: {
    lowResourcePath: 'ui/weapons/rail',
    highBundle: 'spacefight-high',
    highResourcePath: 'ui/weapons/rail',
    accent: 'ice-blue',
    projectileVisualFamily: 'rail-slug',
  },
  plasma: {
    lowResourcePath: 'ui/weapons/plasma',
    highBundle: 'spacefight-high',
    highResourcePath: 'ui/weapons/plasma',
    accent: 'teal',
    projectileVisualFamily: 'plasma-orb',
  },
} as const satisfies Record<PrimaryWeaponId, WeaponVisualDefinition>;
