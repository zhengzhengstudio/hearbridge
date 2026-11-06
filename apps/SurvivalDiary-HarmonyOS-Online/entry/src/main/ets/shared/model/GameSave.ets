import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';

export enum PlayMode { GUIDED = 'guided', FREE = 'free' }

export interface Coordinates { x: number; y: number }
export interface WeatherState { kind: string; intensity: number; wetness: number; wind: number }
export interface RegionState extends Coordinates {
  id: string;
  biomeId: string;
  elevation: number;
  moisture: number;
  temperature: number;
  resources: string[];
}
export interface EntityState { id: string; type: string; coordinates: Coordinates; durability: number; maxDurability: number }
export interface JournalState { text: string }
export interface VitalState { health: number; stamina: number; hunger: number; hydration: number; bodyTemperature: number }
export enum FacilityStatus { IDLE = 'idle', WORKING = 'working', READY = 'ready' }
export interface FacilityProcess {
  recipeId: string; input: Inventory; fuel: Inventory; output: Inventory;
  progressMinutes: number; durationMinutes: number; outputItemId: string; outputAmount: number; status: FacilityStatus;
}
export interface GroundItem { id: string; itemId: string; amount: number; x: number; y: number }
export interface CropSlot { cropId: string; seedId: string; progressMinutes: number; durationMinutes: number; stage: string }
export interface CropPlot { water: number; waterUsageMinutes: number; slots: Array<CropSlot | null> }
export type Inventory = Record<string, number>;
export type RegionMap = Record<string, RegionState>;
export type EntityMap = Record<string, EntityState>;
export type JournalMap = Record<string, JournalState>;
export type BooleanMap = Record<string, boolean>;

function quote(value: string): string { return JSON.stringify(value); }
function sortedKeys<T>(value: Record<string, T>): string[] { return Object.keys(value).sort(); }
function mapNumbers(value: Inventory): string {
  return `{${sortedKeys(value).map((key: string) => `${quote(key)}:${value[key]}`).join(',')}}`;
}
function cloneInventory(value: Inventory): Inventory {
  const copy: Inventory = {};
  for (const key of Object.keys(value)) copy[key] = value[key];
  return copy;
}
function mapBooleans(value: BooleanMap): string {
  return `{${sortedKeys(value).map((key: string) => `${quote(key)}:${value[key]}`).join(',')}}`;
}
function mapJournals(value: JournalMap): string {
  return `{${sortedKeys(value).map((key: string) => `${quote(key)}:{"text":${quote(value[key].text)}}`).join(',')}}`;
}
function mapRegions(value: RegionMap): string {
  return `{${sortedKeys(value).map((key: string) => {
    const region = value[key];
    return `${quote(key)}:{"biomeId":${quote(region.biomeId)},"elevation":${region.elevation},"id":${quote(region.id)},"moisture":${region.moisture},"resources":${JSON.stringify(region.resources)},"temperature":${region.temperature},"x":${region.x},"y":${region.y}}`;
  }).join(',')}}`;
}
function mapEntities(value: EntityMap): string {
  return `{${sortedKeys(value).map((key: string) => {
    const entity = value[key];
    return `${quote(key)}:{"coordinates":{"x":${entity.coordinates.x},"y":${entity.coordinates.y}},"durability":${entity.durability},"id":${quote(entity.id)},"maxDurability":${entity.maxDurability},"type":${quote(entity.type)}}`;
  }).join(',')}}`;
}

export function utf8(value: string): Uint8Array {
  return new util.TextEncoder().encodeInto(value);
}

export function sha256Bytes(value: string): Uint8Array {
  const digest = cryptoFramework.createMd('SHA256');
  digest.updateSync({ data: utf8(value) });
  return new Uint8Array(digest.digestSync().data);
}

export function sha256Hex(value: string): string {
  return Array.from(sha256Bytes(value)).map((byte: number) => byte.toString(16).padStart(2, '0')).join('');
}

export class GameSave {
  readonly schemaVersion: number = 2;
  readonly productVersion: string = '0.5.5';
  readonly build: number = 18;
  seed: string;
  playMode: PlayMode;
  day: number = 1;
  time: number = 360;
  weather: WeatherState = { kind: 'clear', intensity: 0, wetness: 0, wind: 0.15 };
  regions: RegionMap = {};
  entities: EntityMap = {};
  players: Record<string, object> = {};
  journals: JournalMap = {};
  milestones: BooleanMap = {};
  inventory: Inventory = {};
  containerInventories: Record<string, Inventory> = {};
  facilityProcesses: Record<string, FacilityProcess> = {};
  vitals: VitalState = { health: 100, stamina: 100, hunger: 100, hydration: 100, bodyTemperature: 37 };
  recoveryBlockers: string[] = [];
  groundItems: Record<string, GroundItem> = {};
  plots: Record<string, CropPlot> = {};

  constructor(seed: string, playMode: PlayMode) {
    this.seed = seed;
    this.playMode = playMode;
  }

  clone(): GameSave {
    const copy = new GameSave(this.seed, this.playMode);
    copy.day = this.day;
    copy.time = this.time;
    copy.weather = { kind: this.weather.kind, intensity: this.weather.intensity, wetness: this.weather.wetness, wind: this.weather.wind };
    for (const key of Object.keys(this.regions)) {
      const value = this.regions[key];
      copy.regions[key] = { id: value.id, biomeId: value.biomeId, x: value.x, y: value.y, elevation: value.elevation,
        moisture: value.moisture, temperature: value.temperature, resources: value.resources.slice() };
    }
    for (const key of Object.keys(this.entities)) {
      const value = this.entities[key];
      copy.entities[key] = { id: value.id, type: value.type, coordinates: { x: value.coordinates.x, y: value.coordinates.y },
        durability: value.durability, maxDurability: value.maxDurability };
    }
    for (const key of Object.keys(this.players)) copy.players[key] = this.players[key];
    for (const key of Object.keys(this.journals)) copy.journals[key] = { text: this.journals[key].text };
    for (const key of Object.keys(this.milestones)) copy.milestones[key] = this.milestones[key];
    for (const key of Object.keys(this.inventory)) copy.inventory[key] = this.inventory[key];
    for (const key of Object.keys(this.containerInventories)) {
      copy.containerInventories[key] = {};
      for (const item of Object.keys(this.containerInventories[key])) copy.containerInventories[key][item] = this.containerInventories[key][item];
    }
    for (const key of Object.keys(this.facilityProcesses)) {
      const process = this.facilityProcesses[key];
      copy.facilityProcesses[key] = { recipeId: process.recipeId, input: cloneInventory(process.input), fuel: cloneInventory(process.fuel),
        output: cloneInventory(process.output), progressMinutes: process.progressMinutes, durationMinutes: process.durationMinutes,
        outputItemId: process.outputItemId, outputAmount: process.outputAmount, status: process.status };
    }
    copy.vitals = { health: this.vitals.health, stamina: this.vitals.stamina, hunger: this.vitals.hunger,
      hydration: this.vitals.hydration, bodyTemperature: this.vitals.bodyTemperature };
    copy.recoveryBlockers = this.recoveryBlockers.slice();
    for (const key of Object.keys(this.groundItems)) { const item = this.groundItems[key]; copy.groundItems[key] = { id: item.id, itemId: item.itemId, amount: item.amount, x: item.x, y: item.y }; }
    for (const key of Object.keys(this.plots)) copy.plots[key] = { water: this.plots[key].water, waterUsageMinutes: this.plots[key].waterUsageMinutes ?? 0,
      slots: this.plots[key].slots.map((slot: CropSlot | null) => slot === null ? null : { cropId: slot.cropId, seedId: slot.seedId, progressMinutes: slot.progressMinutes, durationMinutes: slot.durationMinutes, stage: slot.stage } as CropSlot) };
    return copy;
  }

  stableJSON(): string {
    const players = Object.keys(this.players).sort().length === 0 ? '{}' : JSON.stringify(this.players);
    const inventory = Object.keys(this.inventory).length > 0 ? `,"inventory":${mapNumbers(this.inventory)}` : '';
    return `{"build":${this.build},"day":${this.day},"entities":${mapEntities(this.entities)}${inventory},"journals":${mapJournals(this.journals)},"milestones":${mapBooleans(this.milestones)},"playMode":${quote(this.playMode)},"players":${players},"productVersion":${quote(this.productVersion)},"regions":${mapRegions(this.regions)},"schemaVersion":${this.schemaVersion},"seed":${quote(this.seed)},"time":${this.time},"weather":{"intensity":${this.weather.intensity},"kind":${quote(this.weather.kind)},"wetness":${this.weather.wetness},"wind":${this.weather.wind}}}`;
  }

  stableDigest(): string { return sha256Hex(this.stableJSON()); }
}
