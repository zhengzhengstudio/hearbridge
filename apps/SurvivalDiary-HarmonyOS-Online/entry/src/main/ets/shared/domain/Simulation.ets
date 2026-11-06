import { Coordinates, EntityState, GameSave, PlayMode, RegionState, WeatherState, sha256Bytes } from '../model/GameSave';

export interface DiscoverRegionCommand { type: 'discover_region'; coordinates: Coordinates }
export interface AdvanceTimeCommand { type: 'advance_time'; minutes: number }
export interface GatherCommand { type: 'gather'; itemId: string; amount: number }
export interface CraftCommand { type: 'craft'; recipeId: string }
export interface SetPlayModeCommand { type: 'set_play_mode'; playMode: PlayMode }
export interface PlaceCommand { type: 'place'; entityId: string; itemId: string; coordinates: Coordinates }
export interface RepairCommand { type: 'repair'; entityId: string; amount: number }
export interface DismantleCommand { type: 'dismantle'; entityId: string }
export interface WriteDiaryCommand { type: 'write_diary'; entryId: string; text: string }
export type GameCommand = DiscoverRegionCommand | AdvanceTimeCommand | GatherCommand | CraftCommand | SetPlayModeCommand | PlaceCommand | RepairCommand | DismantleCommand | WriteDiaryCommand;

interface Biome { id: string; resources: string[] }
interface WeatherKind { id: string; min: number; max: number; wetness: number; wind: number }
class Recipe {
  ingredients: Record<string, number> = {};
  itemId: string;
  amount: number;
  constructor(itemId: string, amount: number) { this.itemId = itemId; this.amount = amount; }
}

const BIOMES: Biome[] = [
  { id: 'lagoon', resources: ['shell', 'reef-fish', 'fresh-water'] },
  { id: 'palm-grove', resources: ['driftwood', 'palm-fiber', 'fresh-water'] },
  { id: 'basalt-ridge', resources: ['stone', 'palm-fiber'] },
  { id: 'mangrove', resources: ['driftwood', 'palm-fiber', 'reef-fish'] },
  { id: 'ruins', resources: ['stone', 'shell'] }
];
const starterResources: string[] = ['stone', 'branch', 'palm-fiber', 'fresh-water', 'coconut'];
const WEATHER: WeatherKind[] = [
  { id: 'clear', min: 0, max: 1, wetness: 0, wind: 0.15 },
  { id: 'cloudy', min: 0, max: 1, wetness: 0.05, wind: 0.25 },
  { id: 'fog', min: 0.2, max: 0.8, wetness: 0.2, wind: 0.08 },
  { id: 'rain', min: 0.25, max: 1, wetness: 0.8, wind: 0.45 },
  { id: 'storm', min: 0.3, max: 1, wetness: 1, wind: 0.9 },
  { id: 'snow', min: 0, max: 0.35, wetness: 0.5, wind: 0.3 },
  { id: 'blizzard', min: 0, max: 0.2, wetness: 0.85, wind: 1 }
];
const RECIPES: Record<string, Recipe> = {};
const rope = new Recipe('rope', 1);
rope.ingredients['palm-fiber'] = 4;
RECIPES['craft-rope'] = rope;
const stoneAxe = new Recipe('stone-axe', 1);
stoneAxe.ingredients['driftwood'] = 2; stoneAxe.ingredients['stone'] = 2; stoneAxe.ingredients['palm-fiber'] = 1;
RECIPES['craft-stone-axe'] = stoneAxe;
const stonePickaxe = new Recipe('stone-pickaxe', 1);
stonePickaxe.ingredients['branch'] = 2; stonePickaxe.ingredients['stone'] = 3; stonePickaxe.ingredients['rope'] = 1;
RECIPES['craft-stone-pickaxe'] = stonePickaxe;
const fishingRod = new Recipe('fishing-rod', 1);
fishingRod.ingredients['driftwood'] = 2; fishingRod.ingredients['palm-fiber'] = 3;
RECIPES['craft-fishing-rod'] = fishingRod;
const campfire = new Recipe('campfire', 1);
campfire.ingredients['driftwood'] = 3; campfire.ingredients['stone'] = 4;
RECIPES['build-campfire'] = campfire;
const storageCrate = new Recipe('storage-crate', 1);
storageCrate.ingredients['driftwood'] = 6; storageCrate.ingredients['rope'] = 2;
RECIPES['build-storage-crate'] = storageCrate;
const furnace = new Recipe('furnace', 1);
furnace.ingredients['stone'] = 8; furnace.ingredients['clay'] = 4;
RECIPES['build-furnace'] = furnace;
const roadSegment = new Recipe('road-segment', 4);
roadSegment.ingredients['branch'] = 1; roadSegment.ingredients['stone'] = 1;
RECIPES['build-road-segment'] = roadSegment;

function round4(value: number): number { return Math.round(value * 10000) / 10000; }
function requirePositiveInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(message);
}
function hashNumber(parts: string[]): number {
  const digest = sha256Bytes(parts.join(':'));
  const integer = ((((digest[0] * 256) + digest[1]) * 256 + digest[2]) * 256 + digest[3]);
  return integer / 4294967295;
}
function climate(seed: string, coordinates: Coordinates): number[] {
  return ['elevation', 'moisture', 'temperature'].map((name: string) => round4(hashNumber([seed, `${coordinates.x}`, `${coordinates.y}`, name])));
}
function regionFor(seed: string, coordinates: Coordinates): RegionState {
  if (!Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) throw new Error('region coordinates must be integers');
  const values = climate(seed, coordinates);
  const biome = BIOMES[Math.floor(hashNumber([seed, `${coordinates.x}`, `${coordinates.y}`, 'biome']) * BIOMES.length) % BIOMES.length];
  let resources = biome.resources.filter((item: string, index: number) => hashNumber([seed, `${coordinates.x}`, `${coordinates.y}`, item]) > 0.32 || index === 0);
  if (coordinates.x === 0 && coordinates.y === 0) {
    for (const item of starterResources) if (!resources.includes(item)) resources.push(item);
    resources.sort();
  }
  return { id: `${coordinates.x},${coordinates.y}`, x: coordinates.x, y: coordinates.y, biomeId: biome.id, elevation: values[0], moisture: values[1], temperature: values[2], resources };
}
function weatherFor(seed: string, day: number, time: number, values: number[]): WeatherState {
  const bucket = Math.floor(time / 120);
  const eligible = WEATHER.filter((kind: WeatherKind) => values[2] >= kind.min && values[2] <= kind.max);
  const candidates = eligible.length > 0 ? eligible : WEATHER.filter((kind: WeatherKind) => kind.id === 'clear');
  const parts = [seed, `${day}`, `${bucket}`, `${values[0]}`, `${values[1]}`, `${values[2]}`];
  const kind = candidates[Math.floor(hashNumber(parts.concat(['weather-kind'])) * candidates.length) % candidates.length];
  const intensity = round4(hashNumber(parts.concat(['intensity'])));
  return { kind: kind.id, intensity, wetness: round4(kind.wetness * intensity), wind: round4(kind.wind * (0.5 + intensity / 2)) };
}
function add(state: GameSave, itemId: string, amount: number): void {
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) + amount;
  if (state.inventory[itemId] < 0) state.inventory[itemId] = 0;
}

function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }

export class Simulation {
  static create(seed: string, mode: PlayMode): GameSave {
    if (seed.length === 0) throw new Error('seed must be non-empty');
    const save = new GameSave(seed, mode); save.inventory['taro-seed'] = 1; save.milestones['nativeFarmBootstrapVersion:1'] = true; return save;
  }

  static step(state: GameSave, command: GameCommand): GameSave {
    const next = state.clone();
    switch (command.type) {
      case 'discover_region': {
        const region = regionFor(next.seed, command.coordinates);
        next.regions[region.id] = region;
        next.weather = weatherFor(next.seed, next.day, next.time, [region.elevation, region.moisture, region.temperature]);
        return next;
      }
      case 'advance_time': {
        requirePositiveInteger(command.minutes, 'minutes must be positive');
        const elapsed = next.time + command.minutes;
        next.day += Math.floor(elapsed / 1440);
        next.time = elapsed % 1440;
        next.weather = weatherFor(next.seed, next.day, next.time, climate(next.seed, { x: 0, y: 0 }));
        return next;
      }
      case 'gather': requirePositiveInteger(command.amount, 'amount must be positive'); add(next, command.itemId, command.amount); return next;
      case 'craft': {
        const recipe = RECIPES[command.recipeId];
        if (recipe === undefined) throw new Error('unknown recipe');
        for (const itemId of Object.keys(recipe.ingredients)) if ((next.inventory[itemId] ?? 0) < recipe.ingredients[itemId]) throw new Error('insufficient ingredients');
        for (const itemId of Object.keys(recipe.ingredients)) add(next, itemId, -recipe.ingredients[itemId]);
        add(next, recipe.itemId, recipe.amount);
        return next;
      }
      case 'set_play_mode': next.playMode = command.playMode; return next;
      case 'place': {
        if (next.entities[command.entityId] !== undefined) throw new Error('entity exists');
        if ((next.inventory[command.itemId] ?? 0) < 1) throw new Error('missing placeable item');
        add(next, command.itemId, -1);
        const entity: EntityState = { id: command.entityId, type: command.itemId,
          coordinates: { x: command.coordinates.x, y: command.coordinates.y }, durability: 10, maxDurability: 10 };
        next.entities[command.entityId] = entity;
        return next;
      }
      case 'repair': {
        const entity = next.entities[command.entityId];
        if (entity === undefined) throw new Error('entity not found');
        requirePositiveInteger(command.amount, 'amount must be positive');
        entity.durability = Math.min(entity.maxDurability, entity.durability + command.amount);
        return next;
      }
      case 'dismantle': {
        const entity = next.entities[command.entityId];
        if (entity === undefined) throw new Error('entity not found');
        const remaining: Record<string, EntityState> = {};
        for (const id of Object.keys(next.entities)) if (id !== command.entityId) remaining[id] = next.entities[id];
        next.entities = remaining; add(next, entity.type, 1); return next;
      }
      case 'write_diary': next.journals[command.entryId] = { text: command.text }; return next;
    }
  }

  static advanceSurvival(state: GameSave, elapsedRealMs: number, activity: string): GameSave {
    if (!Number.isFinite(elapsedRealMs) || elapsedRealMs < 0) throw new Error('elapsedRealMs must be non-negative');
    const next = state.clone();
    const minutes = elapsedRealMs * 1440 / 1800000;
    const total = next.time + minutes;
    next.day += Math.floor(total / 1440);
    next.time = Math.floor(total % 1440);
    const hunger = clamp(next.vitals.hunger - minutes * (activity === 'running' ? 0.026 : 0.015));
    const hydration = clamp(next.vitals.hydration - minutes * (activity === 'running' ? 0.038 : 0.022));
    const fedForHealing = hunger >= 80;
    const hydratedForHealing = hydration >= 70;
    const blockers: string[] = [];
    if (!fedForHealing) blockers.push('needs-food');
    if (!hydratedForHealing) blockers.push('needs-water');
    if (next.vitals.bodyTemperature < 36 || next.vitals.bodyTemperature > 38) blockers.push('temperature');
    const nutritionFactor = fedForHealing && hydratedForHealing ? 1.6 : hunger >= 45 && hydration >= 45 ? 1 : hunger > 10 && hydration > 10 ? 0.35 : 0;
    let staminaRate = 0.14 * nutritionFactor;
    if (activity === 'walking') staminaRate = -0.08;
    if (activity === 'running') staminaRate = -0.28;
    if (activity === 'sleeping') staminaRate = 0.36 * nutritionFactor;
    const crisisDamage = (hunger <= 10 ? 0.035 : 0) + (hydration <= 10 ? 0.05 : 0) + (blockers.includes('temperature') ? 0.025 : 0);
    const canHeal = fedForHealing && hydratedForHealing && !blockers.includes('temperature') && activity !== 'running';
    const healthDelta = crisisDamage > 0 ? -crisisDamage * minutes : canHeal ? 0.02 * minutes : 0;
    next.vitals = {
      health: Math.round(clamp(next.vitals.health + healthDelta) * 10) / 10,
      stamina: Math.round(clamp(next.vitals.stamina + staminaRate * minutes) * 10) / 10,
      hunger: Math.round(hunger * 10) / 10,
      hydration: Math.round(hydration * 10) / 10,
      bodyTemperature: next.vitals.bodyTemperature
    };
    next.recoveryBlockers = blockers;
    next.weather = weatherFor(next.seed, next.day, next.time, climate(next.seed, { x: 0, y: 0 }));
    return next;
  }
}
