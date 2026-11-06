import { sys } from 'cc';

const KEY = 'spacefight.economy.v1';

export interface PlayerEconomySnapshot {
  readonly starportTickets: number;
  readonly cargoExpansion: number;
  readonly tractorCalibration: number;
  readonly shieldExpansion: number;
  readonly ownedSkins: readonly string[];
  readonly receipts: readonly string[];
}

const DEFAULT_PROFILE: PlayerEconomySnapshot = {
  starportTickets: 360,
  cargoExpansion: 0,
  tractorCalibration: 0,
  shieldExpansion: 0,
  ownedSkins: ['graphite', 'rescue', 'void', 'azure', 'desert'],
  receipts: [],
};

export type StoreItemId = 'cargo-expansion' | 'tractor-calibration' | 'frontier-livery' | 'shield-expansion';

export function loadEconomy(): PlayerEconomySnapshot {
  try {
    const parsed = JSON.parse(sys.localStorage.getItem(KEY) || '{}') as Partial<PlayerEconomySnapshot>;
    return {
      starportTickets: Math.max(0, Math.floor(parsed.starportTickets ?? DEFAULT_PROFILE.starportTickets)),
      cargoExpansion: Math.max(0, Math.min(2, Math.floor(parsed.cargoExpansion || 0))),
      tractorCalibration: Math.max(0, Math.min(3, Math.floor(parsed.tractorCalibration || 0))),
      shieldExpansion: Math.max(0, Math.min(3, Math.floor(parsed.shieldExpansion || 0))),
      ownedSkins: Array.from(new Set([...(parsed.ownedSkins || []), ...DEFAULT_PROFILE.ownedSkins])),
      receipts: (parsed.receipts || []).slice(-24),
    };
  } catch (_) {
    return { ...DEFAULT_PROFILE, ownedSkins: [...DEFAULT_PROFILE.ownedSkins], receipts: [] };
  }
}

export function awardStarportTickets(value: number, receipt: string): PlayerEconomySnapshot {
  const profile = loadEconomy();
  if (!receipt || profile.receipts.includes(receipt) || value <= 0) return profile;
  return save({
    ...profile,
    starportTickets: profile.starportTickets + Math.max(1, Math.round(value / 5)),
    receipts: [...profile.receipts, receipt].slice(-24),
  });
}

export function buyStoreItem(item: StoreItemId): { ok: boolean; profile: PlayerEconomySnapshot } {
  const profile = loadEconomy();
  const price = storePrice(item, profile);
  if (price < 0 || profile.starportTickets < price) return { ok: false, profile };
  let next: PlayerEconomySnapshot = { ...profile, starportTickets: profile.starportTickets - price };
  if (item === 'cargo-expansion') next = { ...next, cargoExpansion: profile.cargoExpansion + 1 };
  if (item === 'tractor-calibration') next = { ...next, tractorCalibration: profile.tractorCalibration + 1 };
  if (item === 'shield-expansion') next = { ...next, shieldExpansion: profile.shieldExpansion + 1 };
  if (item === 'frontier-livery') next = { ...next, ownedSkins: [...profile.ownedSkins, 'hazard'] };
  return { ok: true, profile: save(next) };
}

export function storePrice(item: StoreItemId, profile = loadEconomy()): number {
  if (item === 'cargo-expansion') return profile.cargoExpansion >= 2 ? -1 : [180, 320][profile.cargoExpansion];
  if (item === 'tractor-calibration') return profile.tractorCalibration >= 3 ? -1 : [120, 220, 360][profile.tractorCalibration];
  if (item === 'shield-expansion') return profile.shieldExpansion >= 3 ? -1 : [140, 260, 420][profile.shieldExpansion];
  return profile.ownedSkins.includes('hazard') ? -1 : 260;
}

function save(profile: PlayerEconomySnapshot): PlayerEconomySnapshot {
  sys.localStorage.setItem(KEY, JSON.stringify(profile));
  return profile;
}
