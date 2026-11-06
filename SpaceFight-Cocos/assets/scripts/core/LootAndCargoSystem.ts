import type { EnemyRole } from './EnemyBehaviorSystem';
import type { ExpeditionEventKind } from './ExpeditionDirector';

export type LootCategory = 'equipment' | 'material' | 'currency' | 'intel' | 'cosmetic';
export type LootRarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type ExpeditionOutcome = 'returned' | 'failed';

export interface CargoItem {
  readonly id: string;
  readonly category: LootCategory;
  readonly rarity: LootRarity;
  readonly insured: boolean;
  readonly equipped?: boolean;
  readonly key?: boolean;
  readonly keyItem?: boolean;
  readonly firstDiscovery?: boolean;
  readonly slots?: number;
  readonly value?: number;
}

export interface LootDrop extends CargoItem {
  readonly sourceEnemyId: string;
  readonly sourceRole: EnemyRole;
  readonly eventKind: ExpeditionEventKind;
}

export interface LootDropRequest {
  readonly enemyId: string;
  readonly role: EnemyRole;
  readonly eventKind: ExpeditionEventKind;
  readonly sequence?: number;
  readonly threat?: number;
}

export interface CargoSnapshot {
  readonly capacity: number;
  readonly usedSlots: number;
  readonly remainingSlots: number;
  readonly full: boolean;
  readonly items: readonly CargoItem[];
}

export interface ExpeditionSettlement {
  readonly outcome: ExpeditionOutcome;
  readonly kept: readonly CargoItem[];
  readonly lost: readonly CargoItem[];
  readonly keptValue: number;
  readonly lostValue: number;
}

const ROLE_CATEGORIES: Readonly<Record<EnemyRole, readonly LootCategory[]>> = {
  interceptor: ['material', 'currency', 'equipment'],
  suppressor: ['equipment', 'material', 'intel'],
  bomber: ['material', 'equipment', 'currency'],
  support: ['intel', 'equipment', 'material'],
  elite: ['equipment', 'cosmetic', 'intel'],
};

const EVENT_CATEGORY: Readonly<Record<ExpeditionEventKind, LootCategory>> = {
  intercept: 'currency',
  signal: 'intel',
  breach: 'equipment',
  surge: 'material',
  hunt: 'cosmetic',
};

const RARITY_VALUE: Readonly<Record<LootRarity, number>> = {
  common: 20,
  uncommon: 50,
  rare: 120,
  epic: 300,
};

export class LootAndCargoSystem {
  private readonly items: CargoItem[] = [];

  public constructor(
    private readonly capacity: number,
    private readonly seed = 0,
  ) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError('Cargo capacity must be a non-negative integer.');
    }
  }

  public add(item: CargoItem): boolean {
    const normalized = normalizeItem(item);
    if (this.items.some((current) => current.id === normalized.id)) return false;
    if (this.usedSlots() + itemSlots(normalized) > this.capacity) return false;
    this.items.push(normalized);
    return true;
  }

  public remove(itemId: string): CargoItem | null {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index < 0) return null;
    const removed = this.items.splice(index, 1)[0];
    return cloneItem(removed);
  }

  public snapshot(): CargoSnapshot {
    const usedSlots = this.usedSlots();
    return {
      capacity: this.capacity,
      usedSlots,
      remainingSlots: this.capacity - usedSlots,
      full: usedSlots >= this.capacity,
      items: this.items.map(cloneItem),
    };
  }

  public createDrops(request: LootDropRequest): readonly LootDrop[] {
    const sequence = integerAtLeast(request.sequence, 0);
    const threat = clamp(integerAtLeast(request.threat, 1), 1, 10);
    const baseCount = request.role === 'elite' ? 3 : request.role === 'support' ? 2 : 1;
    const eventBonus = request.eventKind === 'hunt' || request.eventKind === 'breach' ? 1 : 0;
    const count = Math.min(4, baseCount + eventBonus);
    const roleCategories = ROLE_CATEGORIES[request.role];
    const drops: LootDrop[] = [];

    for (let index = 0; index < count; index += 1) {
      const hash = hash32(`${this.seed | 0}:${request.enemyId}:${request.role}:${request.eventKind}:${sequence}:${index}`);
      const category = index === count - 1 && eventBonus > 0
        ? EVENT_CATEGORY[request.eventKind]
        : roleCategories[hash % roleCategories.length];
      const rarity = rarityFor(hash >>> 8, threat, request.role === 'elite');
      drops.push({
        id: `loot-${hash.toString(16).padStart(8, '0')}-${sequence}-${index}`,
        category,
        rarity,
        insured: false,
        firstDiscovery: category === 'cosmetic' && rarity !== 'common',
        slots: category === 'equipment' ? 2 : 1,
        value: RARITY_VALUE[rarity] * (category === 'currency' ? 2 : 1),
        sourceEnemyId: request.enemyId,
        sourceRole: request.role,
        eventKind: request.eventKind,
      });
    }
    return drops;
  }

  public dropsFor(
    enemy: { readonly id: string; readonly role: EnemyRole },
    eventKind: ExpeditionEventKind,
    sequence = 0,
    threat = 1,
  ): readonly LootDrop[] {
    return this.createDrops({ enemyId: enemy.id, role: enemy.role, eventKind, sequence, threat });
  }

  public settleExpedition(outcome: ExpeditionOutcome): ExpeditionSettlement {
    const kept: CargoItem[] = [];
    const lost: CargoItem[] = [];
    for (const item of this.items) {
      const destination = outcome === 'returned' || isProtected(item) ? kept : lost;
      destination.push(cloneItem(item));
    }
    return {
      outcome,
      kept,
      lost,
      keptValue: totalValue(kept),
      lostValue: totalValue(lost),
    };
  }

  private usedSlots(): number {
    return this.items.reduce((total, item) => total + itemSlots(item), 0);
  }
}

function normalizeItem(item: CargoItem): CargoItem {
  if (!item.id) throw new TypeError('Cargo item id must not be empty.');
  return {
    id: item.id,
    category: item.category,
    rarity: item.rarity,
    insured: item.insured === true,
    equipped: item.equipped === true,
    key: item.key === true,
    keyItem: item.keyItem === true,
    firstDiscovery: item.firstDiscovery === true,
    slots: itemSlots(item),
    value: Math.max(0, finite(item.value, RARITY_VALUE[item.rarity])),
  };
}

function cloneItem(item: CargoItem): CargoItem {
  return { ...item };
}

function itemSlots(item: CargoItem): number {
  return Math.max(1, integerAtLeast(item.slots, 1));
}

function isProtected(item: CargoItem): boolean {
  return item.insured === true
    || item.equipped === true
    || item.key === true
    || item.keyItem === true
    || item.firstDiscovery === true;
}

function totalValue(items: readonly CargoItem[]): number {
  return items.reduce((total, item) => total + Math.max(0, finite(item.value, 0)), 0);
}

function rarityFor(hash: number, threat: number, elite: boolean): LootRarity {
  const roll = (hash % 1000) + (threat - 1) * 24 + (elite ? 90 : 0);
  if (roll >= 970) return 'epic';
  if (roll >= 790) return 'rare';
  if (roll >= 430) return 'uncommon';
  return 'common';
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function integerAtLeast(value: number | undefined, fallback: number): number {
  const safe = finite(value, fallback);
  return Math.max(fallback, Math.floor(safe));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}
