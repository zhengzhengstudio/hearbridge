import { common } from '@kit.AbilityKit';
import { GameCanvas, GroundItemVisual, RoadTile, WorldEntityVisual } from '../game/GameCanvas';
import { GameHud } from '../ui/GameHud';
import { SaveRepository, HarmonyEdition } from '../shared/data/SaveRepository';
import { Simulation } from '../shared/domain/Simulation';
import { FacilityRules, TransferDirection } from '../shared/domain/FacilityRules';
import { Coordinates, CropSlot, GameSave, GroundItem, PlayMode } from '../shared/model/GameSave';

import { PublicIsland, SurvivalOnlineClient } from '../services/SurvivalOnlineClient';
import { RealtimeChatMessage, SurvivalRealtimeClient } from '../services/SurvivalRealtimeClient';
import { TapFriendService } from '../services/TapFriendService';
import { UpdateService } from '../services/UpdateService';

interface GatherOption {
  id: string;
  label: string;
}

@Entry
@Component
struct Index {
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private repository: SaveRepository = new SaveRepository(this.context, HarmonyEdition.ONLINE);
  private client: SurvivalOnlineClient = new SurvivalOnlineClient();
  @State state: GameSave = Simulation.create(`${Date.now()}`, PlayMode.GUIDED);
  @State zoom: number = 0.72;
  @State offsetX: number = 0;
  @State offsetY: number = 0;
  @State rotation: number = 0;
  @State entered: boolean = false;
  @State hasExistingSave: boolean = false;
  @State loadingWorld: boolean = false;
  @State confirmingNewFromLauncher: boolean = false;
  @State showDiary: boolean = false;
  @State showFriends: boolean = false;
  @State showInventory: boolean = false;
  @State showCrafting: boolean = false;
  @State showFacilities: boolean = false;
  @State showCompendium: boolean = false;
  @State showMap: boolean = false;
  @State showVillager: boolean = false;
  @State villagerQuestion: string = '';
  @State villagerReply: string = '阿拓：先把营火和住处安顿好，我们再扩建营地。';
  @State villagerReplySource: string = '岛民本地回应';
  @State villagerTalking: boolean = false;
  @State unlockText: string = '';
  @State diaryText: string = '';
  @State notice: string = '';
  @State sessionToken: string = '';
  @State onlineState: string = 'local';
  @State onlineIslandId: string = '';
  @State onlineRevision: number = 0;
  @State publicIslands: PublicIsland[] = [];
  @State chatMessages: RealtimeChatMessage[] = [];
  @State chatDraft: string = '';
  @State confirmingRestart: boolean = false;
  private clockTimer: number = -1;
  private clockTicks: number = 0;
  private realtime: SurvivalRealtimeClient = new SurvivalRealtimeClient(
    (state: string, message: string): void => { this.onlineState = state; if (message.length > 0) this.notice = message; },
    (islandId: string, revision: number, _world: object): void => { this.onlineIslandId = islandId; this.onlineRevision = revision; this.onlineState = 'online'; },
    (message: RealtimeChatMessage): void => { this.chatMessages = this.chatMessages.concat([message]).slice(-80); }
  );

  aboutToAppear(): void {
    this.load();
    this.clockTimer = setInterval(() => this.advanceClock(), 1250);
  }

  aboutToDisappear(): void {
    if (this.clockTimer >= 0) clearInterval(this.clockTimer);
    this.repository.save(this.state);
    this.realtime.leave(false);
  }

  private async refreshPublicIslands(): Promise<void> {
    try { this.publicIslands = await this.client.listPublicIslands(); }
    catch (_) { this.notice = '公共岛读取失败，本地进度不受影响'; }
  }

  private async createPublicIsland(): Promise<void> {
    if (this.sessionToken.length === 0) { this.notice = '联机会话尚未建立'; return; }
    try {
      const island = await this.client.ensurePublicIsland(this.sessionToken, this.state.seed);
      await this.joinPublicIsland(island.id);
    } catch (_) { this.notice = '公共岛创建失败，请检查网络'; }
  }

  private async joinPublicIsland(islandId: string): Promise<void> {
    if (this.sessionToken.length === 0) { this.notice = '联机会话尚未建立'; return; }
    try {
      await this.client.visitIsland(this.sessionToken, islandId);
      this.onlineIslandId = islandId;
      this.realtime.join(this.sessionToken, islandId);
    } catch (_) { this.notice = '加入公共岛失败'; }
  }

  private sendIslandChat(): void {
    const text = this.chatDraft.trim();
    if (text.length === 0) return;
    this.realtime.sendChat(text).then(() => this.chatDraft = '').catch(() => this.notice = '消息没有发出，正在重连');
  }

  private leavePublicIsland(): void {
    this.realtime.leave();
    this.onlineIslandId = '';
    this.chatMessages = [];
  }

  private advanceClock(): void {
    if (!this.entered) return;
    const next = this.advanceFarms(FacilityRules.advance(Simulation.advanceSurvival(this.state, 1250, 'idle'), 1), 1);
    this.state = next;
    this.clockTicks += 1;
    if (this.clockTicks >= 12) {
      this.clockTicks = 0;
      this.repository.save(next);
    }
  }

  private async load(): Promise<void> {
    this.hasExistingSave = await this.repository.hasSave();
    this.entered = false;
    this.state = await this.repository.load();
    if (this.state.milestones['nativeFarmBootstrapVersion:1'] !== true) {
      const migrated = this.state.clone();
      migrated.inventory['taro-seed'] = (migrated.inventory['taro-seed'] ?? 0) + 1;
      migrated.milestones['nativeFarmBootstrapVersion:1'] = true;
      this.state = migrated;
      await this.repository.save(migrated);
    }
    this.state = this.ensureNativeWorldStarters(this.state);
    await this.repository.save(this.state);
    if (Object.keys(this.state.regions).length === 0) {
      this.state = Simulation.step(this.state, { type: 'discover_region', coordinates: { x: 0, y: 0 } });
      await this.repository.save(this.state);
    }
    try {
      this.sessionToken = await this.client.createGuestSession(this.state.seed);
    } catch (_) {
      this.notice = '当前离线，进度仍会保存在本机';
    }
  }

  private async restartWorld(): Promise<void> {
    await this.repository.reset();
    let fresh = Simulation.create(`local-${Date.now()}`, PlayMode.GUIDED);
    fresh = this.ensureNativeWorldStarters(Simulation.step(fresh, { type: 'discover_region', coordinates: { x: 0, y: 0 } }));
    await this.repository.save(fresh);
    this.state = fresh; this.confirmingRestart = false; this.showFriends = false;
    this.notice = '新世界已经建立';
    this.hasExistingSave = true;
  }

  private beginIsland(): void {
    this.loadingWorld = true;
    setTimeout(() => { this.loadingWorld = false; this.entered = true; }, 760);
  }

  private quickGather(): void {
    if (this.inventory('driftwood') < 3) { this.gather('driftwood', '漂流木'); return; }
    if (this.inventory('palm-fiber') < 4) { this.gather('palm-fiber', '棕榈纤维'); return; }
    this.gather('stone', '海蚀石');
  }

  private async apply(next: GameSave, message: string): Promise<void> {
    this.state = next;
    this.notice = message;
    await this.repository.save(next);
  }

  private inventory(item: string): number { return this.state.inventory[item] ?? 0; }
  private guideText(): string {
    const owns = (type: string): boolean => Object.keys(this.state.entities).some((id: string) => this.state.entities[id].type === type);
    const firstTool = ['stone-machete', 'stone-axe', 'stone-pickaxe'].some((id: string) => this.inventory(id) > 0 || this.state.milestones[`item:${id}`] === true);
    if (this.state.milestones['tutorial:moved'] !== true) return '第一章 1/8 · 潮退之后｜拖动岛屿确认方向，再点“采集附近”';
    if (!firstTool && (this.inventory('branch') < 1 || this.inventory('stone') < 2 || this.inventory('palm-fiber') < 4)) return `第一章 2/8 · 眼下能用的东西｜树枝 ${Math.min(1, this.inventory('branch'))}/1 · 海蚀石 ${Math.min(2, this.inventory('stone'))}/2 · 纤维 ${Math.min(4, this.inventory('palm-fiber'))}/4`;
    if (this.inventory('fresh-water') < 1 && this.state.milestones['item:fresh-water'] !== true) return '第一章 3/8 · 先解决口渴｜采集一份淡水';
    if (!firstTool) return '第一章 4/8 · 第一把工具｜制作砍刀、石斧或石镐中的任意一种';
    if (this.state.milestones['consumed:any'] !== true) return '第一章 5/8 · 给黑夜留些体力｜在背包吃下一份食物';
    if (!owns('campfire')) return '第一章 6/8 · 天黑前点起火｜制作并放置一座营火';
    if (!['shelter', 'bed', 'straw-mat', 'hammock', 'simple-bed'].some(owns)) return '第一章 7/8 · 搭好住处｜放置庇护所或床铺';
    if (this.state.milestones['slept:any'] !== true) return '第一章 8/8 · 熬过第一夜｜靠近住处休息到清晨';
    return '岛屿传闻｜清晨雾后出现炊烟，去寻找村落、动物与矿脉';
  }
  private ensureNativeWorldStarters(source: GameSave): GameSave {
    return this.ensureAnimalStarter(this.ensureRailStarter(this.ensureTransportStarter(source)));
  }
  private ensureTransportStarter(source: GameSave): GameSave {
    if (source.milestones['nativeTransportBootstrapVersion:1'] === true) return source;
    const next = source.clone();
    next.entities['starter-rail-1'] = { id: 'starter-rail-1', type: 'rail-segment', coordinates: { x: 1, y: 0 }, durability: 10, maxDurability: 10 };
    next.entities['starter-rail-2'] = { id: 'starter-rail-2', type: 'rail-segment', coordinates: { x: 2, y: 0 }, durability: 10, maxDurability: 10 };
    next.entities['starter-minecart'] = { id: 'starter-minecart', type: 'minecart', coordinates: { x: 1, y: 0 }, durability: 10, maxDurability: 10 };
    next.entities['starter-rowboat'] = { id: 'starter-rowboat', type: 'rowboat', coordinates: { x: -1, y: 2 }, durability: 10, maxDurability: 10 };
    next.milestones['nativeTransportBootstrapVersion:1'] = true;
    return next;
  }
  private ensureRailStarter(source: GameSave): GameSave {
    if (source.milestones['nativeRailStarterVersion:1'] === true) return source;
    const next = source.clone();
    next.milestones['nativeRailStarterVersion:1'] = true; return next;
  }
  private ensureAnimalStarter(source: GameSave): GameSave {
    if (source.milestones['nativeAnimalBootstrapVersion:1'] === true) return source;
    const next = source.clone();
    next.entities['starter-animal-crab'] = { id: 'starter-animal-crab', type: 'animal-land-crab', coordinates: { x: -2, y: 0 }, durability: 10, maxDurability: 10 };
    next.entities['starter-animal-turtle'] = { id: 'starter-animal-turtle', type: 'animal-sea-turtle', coordinates: { x: -1, y: 3 }, durability: 10, maxDurability: 10 };
    next.entities['starter-animal-boar'] = { id: 'starter-animal-boar', type: 'animal-wild-boar', coordinates: { x: 4, y: 2 }, durability: 10, maxDurability: 10 };
    next.milestones['nativeAnimalBootstrapVersion:1'] = true; return next;
  }
  private playerGrid(): Coordinates {
    const scale = Math.max(0.35, this.zoom) * 52;
    return { x: Math.round(-this.offsetX / scale), y: Math.round(-this.offsetY / scale) } as Coordinates;
  }
  private worldEntities(): WorldEntityVisual[] {
    const railCoordinates = new Set<string>(Object.keys(this.state.entities)
      .map((id: string) => this.state.entities[id])
      .filter(entity => entity.type === 'rail-segment')
      .map(entity => `${entity.coordinates.x},${entity.coordinates.y}`));
    return Object.keys(this.state.entities)
      .map((id: string) => this.state.entities[id])
      .filter(entity => entity.type !== 'road-segment')
      .map(entity => {
        const x = entity.coordinates.x; const y = entity.coordinates.y;
        const neighbors: string[] = [];
        if (railCoordinates.has(`${x},${y - 1}`)) neighbors.push('n');
        if (railCoordinates.has(`${x + 1},${y}`)) neighbors.push('e');
        if (railCoordinates.has(`${x},${y + 1}`)) neighbors.push('s');
        if (railCoordinates.has(`${x - 1},${y}`)) neighbors.push('w');
        let railKind = 'terminal'; let railRotation = 0;
        if (neighbors.length === 4) railKind = 'crossing';
        else if (neighbors.length === 3) {
          railKind = 'junction';
          const missing = ['n', 'e', 's', 'w'].find((value: string) => !neighbors.includes(value)) ?? 'n';
          railRotation = ({ 'n': 0, 'e': 90, 's': 180, 'w': 270 } as Record<string, number>)[missing];
        } else if (neighbors.length === 2 && neighbors.includes('n') && neighbors.includes('s')) railKind = 'ns';
        else if (neighbors.length === 2 && neighbors.includes('e') && neighbors.includes('w')) railKind = 'ew';
        else if (neighbors.length === 2) {
          railKind = 'curve';
          const corner = neighbors.slice().sort().join('');
          railRotation = ({ 'es': 0, 'sw': 90, 'nw': 180, 'en': 270 } as Record<string, number>)[corner] ?? 0;
        } else railKind = neighbors.includes('n') || neighbors.includes('s') ? 'ns' : 'ew';
        return { id: entity.id, type: entity.type, x: x, y: y, railKind: railKind, railRotation: railRotation } as WorldEntityVisual;
      });
  }
  private worldGroundItems(): GroundItemVisual[] {
    return Object.keys(this.state.groundItems).map((id: string) => {
      const item = this.state.groundItems[id];
      return { id: item.id, itemId: item.itemId, amount: item.amount, x: item.x, y: item.y } as GroundItemVisual;
    });
  }
  private placementPoint(): Coordinates {
    const player = this.playerGrid();
    const occupied = new Set<string>(Object.keys(this.state.entities).map((id: string) => {
      const point = this.state.entities[id].coordinates; return `${point.x},${point.y}`;
    }));
    const candidates: Coordinates[] = [
      { x: player.x + 1, y: player.y } as Coordinates, { x: player.x, y: player.y + 1 } as Coordinates,
      { x: player.x - 1, y: player.y } as Coordinates, { x: player.x, y: player.y - 1 } as Coordinates,
      { x: player.x + 1, y: player.y + 1 } as Coordinates, { x: player.x - 1, y: player.y + 1 } as Coordinates
    ];
    return candidates.find((point: Coordinates) => !occupied.has(`${point.x},${point.y}`)) ?? { x: player.x + 2, y: player.y } as Coordinates;
  }
  private nearbyEntityId(): string {
    const player = this.playerGrid();
    const nearby = Object.keys(this.state.entities).filter((id: string) => {
      const entity = this.state.entities[id];
      return entity.type !== 'road-segment' && Math.abs(entity.coordinates.x - player.x) <= 2 && Math.abs(entity.coordinates.y - player.y) <= 2;
    });
    nearby.sort((left: string, right: string) => {
      const a = this.state.entities[left].coordinates; const b = this.state.entities[right].coordinates;
      return Math.abs(a.x - player.x) + Math.abs(a.y - player.y) - Math.abs(b.x - player.x) - Math.abs(b.y - player.y);
    });
    return nearby[0] ?? '';
  }
  private nearbyGroundItemId(): string {
    const player = this.playerGrid();
    return Object.keys(this.state.groundItems).find((id: string) => {
      const item = this.state.groundItems[id];
      return Math.abs(item.x - player.x) <= 1 && Math.abs(item.y - player.y) <= 1;
    }) ?? '';
  }
  private villageNearby(): boolean {
    const player = this.playerGrid();
    return Math.abs(player.x - 3) <= 2 && Math.abs(player.y) <= 2;
  }
  private itemName(item: string): string {
    const names: Record<string, string> = {
      'driftwood': '漂流木', 'branch': '树枝', 'stone': '海蚀石', 'palm-fiber': '棕榈纤维', 'fresh-water': '淡水',
      'berry': '浆果', 'coconut': '椰子', 'clay': '黏土', 'copper-ore': '铜矿石', 'charcoal': '木炭',
      'rope': '绳索', 'stone-axe': '石斧', 'stone-pickaxe': '石镐', 'fishing-rod': '钓竿', 'campfire': '营火',
      'storage-crate': '储物箱', 'furnace': '石砌熔炉', 'road-segment': '道路组件', 'taro-seed': '芋种',
      'millet-seed': '粟种', 'herb-seed': '药草种子', 'taro': '海岛芋', 'millet': '粟米', 'herb': '药草',
      'rail-segment': '窄轨轨段', 'minecart': '轨道矿车', 'rowboat': '划桨木船'
    };
    return names[item] ?? item;
  }
  private isFood(item: string): boolean { return ['coconut', 'berry', 'taro', 'millet'].includes(item); }
  private contextActionLabel(): string {
    const id = this.nearbyEntityId();
    if (id.length > 0) {
      const type = this.state.entities[id].type;
      if (type === 'shelter' || type === 'bed') return '休息到清晨';
      if (type === 'storage-crate') return '打开储物箱';
      if (type === 'furnace') return '使用熔炉';
      if (type === 'campfire') return '查看营火';
      if (type === 'rowboat') return this.state.milestones[`transport:aboard:${id}`] === true ? '靠岸离开木船' : '登上划桨木船';
      if (type === 'minecart') return '推动轨道矿车';
      if (type === 'rail-segment') return '检查连续轨道';
      if (type.startsWith('animal-')) return '观察岛上动物';
      return '使用设施';
    }
    if (this.villageNearby()) return '与幸存者交谈';
    return this.nearbyGroundItemId().length > 0 ? '拾取脚边物品' : '采集附近';
  }
  private contextualAction(): void {
    if (this.state.milestones['tutorial:moved'] !== true) {
      const observed = this.state.clone(); observed.milestones['tutorial:moved'] = true; this.state = observed;
    }
    const entityId = this.nearbyEntityId();
    if (entityId.length > 0) { this.useEntity(entityId); return; }
    if (this.villageNearby()) { this.showVillager = true; this.notice = '潮生村的幸存者愿意与你交谈和交易'; return; }
    const groundId = this.nearbyGroundItemId();
    if (groundId.length > 0) { this.pickup(groundId); return; }
    const neededOptions: GatherOption[] = [];
    if (this.inventory('branch') < 1) neededOptions.push({ id: 'branch', label: '树枝' });
    if (this.inventory('stone') < 2) neededOptions.push({ id: 'stone', label: '海蚀石' });
    if (this.inventory('palm-fiber') < 4) neededOptions.push({ id: 'palm-fiber', label: '棕榈纤维' });
    if (this.inventory('fresh-water') < 1) neededOptions.push({ id: 'fresh-water', label: '淡水' });
    const needed: GatherOption | undefined = neededOptions[0];
    if (needed !== undefined) { this.gather(needed.id, needed.label); return; }
    const nearby: GatherOption[] = [
      { id: 'branch', label: '树枝' }, { id: 'coconut', label: '椰子' }, { id: 'berry', label: '浆果' },
      { id: 'clay', label: '黏土' }, { id: 'copper-ore', label: '铜矿石' }, { id: 'charcoal', label: '木炭' }
    ];
    const selected = nearby[Math.floor(this.state.time / 30) % nearby.length];
    this.gather(selected.id, selected.label);
  }
  private consume(item: string, amount: number = 1): GameSave { const next = this.state.clone(); next.inventory[item] = Math.max(0, (next.inventory[item] ?? 0) - amount); return next; }
  private eat(item: string, label: string): void {
    if (this.inventory(item) < 1) { this.notice = `没有${label}`; return; }
    const next = this.consume(item);
    next.milestones['consumed:any'] = true;
    next.milestones[`consumed:${item}`] = true;
    if (item === 'coconut') { next.vitals.hunger = Math.min(100, next.vitals.hunger + 10); next.vitals.hydration = Math.min(100, next.vitals.hydration + 12); next.vitals.stamina = Math.min(100, next.vitals.stamina + 4); next.vitals.health = Math.min(100, next.vitals.health + 1); }
    if (item === 'berry') { next.vitals.hunger = Math.min(100, next.vitals.hunger + 6); next.vitals.hydration = Math.min(100, next.vitals.hydration + 4); next.vitals.stamina = Math.min(100, next.vitals.stamina + 3); next.vitals.health = Math.min(100, next.vitals.health + 1); }
    if (item === 'taro') { next.vitals.hunger = Math.min(100, next.vitals.hunger + 12); next.vitals.stamina = Math.min(100, next.vitals.stamina + 4); next.vitals.health = Math.min(100, next.vitals.health + 2); }
    if (item === 'millet') { next.vitals.hunger = Math.min(100, next.vitals.hunger + 8); next.vitals.stamina = Math.min(100, next.vitals.stamina + 3); next.vitals.health = Math.min(100, next.vitals.health + 1); }
    this.apply(next, `已食用${label}`);
  }
  private drop(item: string, label: string): void {
    if (this.inventory(item) < 1) { this.notice = `没有可丢弃的${label}`; return; }
    const next = this.consume(item); const id = `ground-${Date.now()}`; const point = this.playerGrid(); next.groundItems[id] = { id: id, itemId: item, amount: 1, x: point.x, y: point.y };
    this.apply(next, `已将${label}丢到脚边`);
  }
  private pickup(id: string): void { const item = this.state.groundItems[id]; if (item === undefined) return; const next = this.state.clone(); next.inventory[item.itemId] = (next.inventory[item.itemId] ?? 0) + item.amount; const remaining: Record<string, GroundItem> = {}; for (const key of Object.keys(next.groundItems)) if (key !== id) remaining[key] = next.groundItems[key]; next.groundItems = remaining; this.apply(next, '已拾取地面物品'); }
  private farmId(): string { return this.facilityId('garden-plot') || 'starter-garden'; }
  private ensureFarm(source: GameSave): GameSave { const next = source.clone(); const id = this.farmId(); if (next.plots[id] === undefined) next.plots[id] = { water: 0, waterUsageMinutes: 0, slots: Array<CropSlot | null>(9).fill(null) }; return next; }
  private plant(seed: string): void {
    if (this.inventory(seed) < 1) { this.notice = '背包里没有这种种子'; return; }
    const next = this.ensureFarm(this.state); const plot = next.plots[this.farmId()]; const index = plot.slots.findIndex((slot: CropSlot | null) => slot === null); if (index < 0) { this.notice = '九格田已经种满'; return; }
    const cropId = seed === 'taro-seed' ? 'taro' : seed === 'millet-seed' ? 'millet' : 'herb'; const duration = cropId === 'taro' ? 720 : cropId === 'millet' ? 960 : 480;
    next.inventory[seed] -= 1; plot.slots[index] = { cropId: cropId, seedId: seed, progressMinutes: 0, durationMinutes: duration, stage: 'seeded' }; this.apply(next, '种子已经播下');
  }
  private waterFarm(): void { if (this.inventory('fresh-water') < 1) { this.notice = '需要淡水'; return; } const next = this.ensureFarm(this.state); const plot = next.plots[this.farmId()]; if (!plot.slots.some((slot: CropSlot | null) => slot !== null && slot.stage !== 'ripe')) { this.notice = '先播种再浇水'; return; } next.inventory['fresh-water'] -= 1; plot.water = Math.min(12, plot.water + 1); this.apply(next, '农田已经浇水'); }
  private harvestFarm(): void { const next = this.ensureFarm(this.state); const plot = next.plots[this.farmId()]; const index = plot.slots.findIndex((slot: CropSlot | null) => slot?.stage === 'ripe'); if (index < 0) { this.notice = '还没有成熟作物'; return; } const crop = plot.slots[index] as CropSlot; next.inventory[crop.cropId] = (next.inventory[crop.cropId] ?? 0) + (crop.cropId === 'millet' ? 3 : 2); plot.slots[index] = null; this.apply(next, '收获完成'); }
  private advanceFarms(source: GameSave, minutes: number): GameSave { const next = source.clone(); for (const id of Object.keys(next.plots)) { const plot = next.plots[id]; if (plot.water <= 0) continue; let active = false; plot.slots = plot.slots.map((slot: CropSlot | null) => { if (slot === null || slot.stage === 'ripe') return slot; active = true; const progress = Math.min(slot.durationMinutes, slot.progressMinutes + minutes); return { cropId: slot.cropId, seedId: slot.seedId, progressMinutes: progress, durationMinutes: slot.durationMinutes, stage: progress >= slot.durationMinutes ? 'ripe' : 'growing' } as CropSlot; }); if (active) { const usage = (plot.waterUsageMinutes ?? 0) + minutes; const spent = Math.min(plot.water, Math.floor(usage / 60)); plot.water -= spent; plot.waterUsageMinutes = plot.water === 0 ? 0 : usage - spent * 60; } } return next; }
  private countEntity(type: string): number {
    return Object.keys(this.state.entities).filter((id: string) => this.state.entities[id].type === type).length;
  }
  private useEntity(id: string): void {
    const type = this.state.entities[id]?.type ?? '';
    if (type === 'shelter' || type === 'bed') { this.restAtShelter(); return; }
    if (type === 'workbench') { this.showCrafting = true; this.notice = '已靠近工作台，可制作工作台配方'; return; }
    if (type === 'rowboat') { this.toggleBoat(id); return; }
    if (type === 'minecart') { this.pushMinecart(id); return; }
    if (type === 'rail-segment') { this.notice = '轨道已连接；矿车只会沿相邻轨段前进'; return; }
    if (type.startsWith('animal-')) {
      const species = type.substring('animal-'.length); const next = this.state.clone(); next.milestones[`animal:${species}`] = true;
      this.apply(next, `图鉴记录：${this.animalName(species)}`); return;
    }
    this.showFacilities = true;
    this.notice = type === 'campfire' ? '营火可以照明、休息并处理食物' : '已打开附近设施';
  }
  private toggleBoat(id: string): void {
    const boat = this.state.entities[id]; if (boat === undefined) return;
    const next = this.state.clone(); const key = `transport:aboard:${id}`; const leaving = next.milestones[key] === true;
    for (const milestone of Object.keys(next.milestones)) if (milestone.startsWith('transport:aboard:')) next.milestones[milestone] = false;
    if (!leaving) { next.milestones[key] = true; this.offsetX = -boat.coordinates.x * Math.max(0.35, this.zoom) * 52; this.offsetY = -boat.coordinates.y * Math.max(0.35, this.zoom) * 52; }
    next.milestones['used:rowboat'] = true; this.apply(next, leaving ? '已从木船靠岸' : '已登船，再次使用即可靠岸');
  }
  private pushMinecart(id: string): void {
    const cart = this.state.entities[id]; if (cart === undefined) return;
    const rails = new Set<string>(Object.keys(this.state.entities).filter((key: string) => this.state.entities[key].type === 'rail-segment').map((key: string) => `${this.state.entities[key].coordinates.x},${this.state.entities[key].coordinates.y}`));
    const candidates: Coordinates[] = [{ x: cart.coordinates.x + 1, y: cart.coordinates.y }, { x: cart.coordinates.x, y: cart.coordinates.y + 1 }, { x: cart.coordinates.x - 1, y: cart.coordinates.y }, { x: cart.coordinates.x, y: cart.coordinates.y - 1 }];
    const target = candidates.find((point: Coordinates) => rails.has(`${point.x},${point.y}`));
    if (target === undefined) { this.notice = '矿车前方没有连续轨道'; return; }
    const next = this.state.clone(); next.entities[id].coordinates = target; next.milestones['used:minecart'] = true; this.apply(next, '矿车沿连续轨道前进了一格');
  }
  private animalName(species: string): string {
    if (species === 'land-crab') return '陆蟹'; if (species === 'sea-turtle') return '海龟'; if (species === 'wild-boar') return '野猪'; return '岛上动物';
  }
  private placeRail(): void {
    if (this.inventory('rail-segment') < 1) { this.notice = '需要窄轨轨段'; return; }
    const rails = Object.keys(this.state.entities).map((id: string) => this.state.entities[id]).filter(entity => entity.type === 'rail-segment');
    if (rails.length === 0) { this.notice = '先靠近已有轨道再铺设'; return; }
    const occupied = new Set<string>(Object.keys(this.state.entities).map((id: string) => `${this.state.entities[id].coordinates.x},${this.state.entities[id].coordinates.y}`));
    const origin = rails[rails.length - 1];
    const candidates: Coordinates[] = [{ x: origin.coordinates.x + 1, y: origin.coordinates.y }, { x: origin.coordinates.x, y: origin.coordinates.y + 1 }, { x: origin.coordinates.x - 1, y: origin.coordinates.y }, { x: origin.coordinates.x, y: origin.coordinates.y - 1 }];
    const target = candidates.find((point: Coordinates) => !occupied.has(`${point.x},${point.y}`));
    if (target === undefined) { this.notice = '轨道端点周围没有可铺设位置'; return; }
    const next = this.state.clone(); next.inventory['rail-segment'] -= 1;
    const id = `rail-${Date.now()}`; next.entities[id] = { id: id, type: 'rail-segment', coordinates: target, durability: 10, maxDurability: 10 };
    this.apply(next, '窄轨已与相邻轨段连接');
  }
  private restAtShelter(): void {
    const next = this.state.clone();
    next.day += 1; next.time = 360; next.vitals.stamina = Math.min(100, next.vitals.stamina + 42);
    if (next.vitals.hunger >= 70 && next.vitals.hydration >= 70) next.vitals.health = Math.min(100, next.vitals.health + 8);
    next.milestones['slept:any'] = true;
    this.apply(next, '休息到清晨：体力恢复，饱腹和饮水充足时生命也会恢复');
  }
  private roadTiles(): RoadTile[] {
    const roads = Object.keys(this.state.entities).map((id: string) => this.state.entities[id]).filter(entity => entity.type === 'road-segment');
    const keys = new Set<string>(roads.map(entity => `${entity.coordinates.x},${entity.coordinates.y}`));
    return roads.map(entity => {
      const x = entity.coordinates.x; const y = entity.coordinates.y;
      const n = keys.has(`${x},${y - 1}`); const e = keys.has(`${x + 1},${y}`); const s = keys.has(`${x},${y + 1}`); const w = keys.has(`${x - 1},${y}`);
      const count = [n, e, s, w].filter(value => value).length;
      if (count === 4) return { x, y, kind: 'crossing', rotation: 0 } as RoadTile;
      if (count === 3) return { x, y, kind: 'junction', rotation: !n ? 0 : !e ? 90 : !s ? 180 : 270 } as RoadTile;
      if (count === 2 && !((n && s) || (e && w))) return { x, y, kind: 'curve', rotation: e && s ? 0 : s && w ? 90 : w && n ? 180 : 270 } as RoadTile;
      return { x, y, kind: n || s ? 'vertical' : 'horizontal', rotation: 0 } as RoadTile;
    });
  }
  private craftRoad(): void {
    try { this.apply(Simulation.step(this.state, { type: 'craft', recipeId: 'build-road-segment' }), '制作了 4 段道路'); }
    catch (_) { this.notice = '道路需要树枝×1和海蚀石×1'; }
  }
  private placeRoad(): void {
    const roads = this.roadTiles(); const occupied = new Set<string>(roads.map(road => `${road.x},${road.y}`));
    const origin: RoadTile = roads.length > 0 ? roads[roads.length - 1] : { x: 0, y: 2, kind: 'horizontal', rotation: 0 } as RoadTile;
    const candidates: Coordinates[] = [{ x: origin.x + 1, y: origin.y } as Coordinates, { x: origin.x, y: origin.y + 1 } as Coordinates, { x: origin.x - 1, y: origin.y } as Coordinates, { x: origin.x, y: origin.y - 1 } as Coordinates];
    const target = candidates.find(point => !occupied.has(`${point.x},${point.y}`));
    if (target === undefined) { this.notice = '走到道路尽头再继续铺设'; return; }
    try { this.apply(Simulation.step(this.state, { type: 'place', entityId: `road-${Date.now()}`, itemId: 'road-segment', coordinates: target }), '道路已连接'); }
    catch (_) { this.notice = '请先制作道路组件'; }
  }

  private gather(item: string, label: string): void {
    const first = this.state.milestones[`item:${item}`] !== true;
    const next = Simulation.step(this.state, { type: 'gather', itemId: item, amount: 1 });
    next.milestones[`item:${item}`] = true;
    this.apply(next, `获得 1 ${label}`);
    if (first) this.showUnlock(label, this.linkedRecipes(item));
  }
  private linkedRecipes(item: string): string {
    if (item === 'palm-fiber') return '绳索、小背包、绷带';
    if (item === 'stone') return '石斧、石镐、营火';
    if (item === 'driftwood') return '石斧、营火、钓竿';
    if (item === 'fresh-water') return '煮沸水、炖汤';
    if (item === 'berry') return '水果碗、温补剂';
    return '已记录到图鉴';
  }
  private showUnlock(label: string, recipes: string): void {
    this.unlockText = `解锁了 ${label}\n配方是 ${recipes}`;
    setTimeout(() => this.unlockText = '', 3200);
  }
  private recruitVillager(): void {
    if (this.state.milestones['villager:castaway-builder:recruited']) { this.notice = '阿拓已经加入营地'; return; }
    if (this.countEntity('shelter') === 0) { this.notice = '先放置一处庇护所或床位'; return; }
    if (this.inventory('fresh-water') < 10 || this.inventory('berry') + this.inventory('coconut') < 10) { this.notice = '招募需要 10 份食物和 10 份淡水'; return; }
    const next = this.state.clone(); next.inventory['fresh-water'] -= 10;
    let needed = 10; const berry = Math.min(next.inventory['berry'] ?? 0, needed); next.inventory['berry'] = (next.inventory['berry'] ?? 0) - berry; needed -= berry;
    const coconut = Math.min(next.inventory['coconut'] ?? 0, needed); next.inventory['coconut'] = (next.inventory['coconut'] ?? 0) - coconut;
    next.milestones['villager:castaway-builder:recruited'] = true; this.apply(next, '阿拓加入了营地');
  }
  private tradeResident(kind: string): void {
    const next = this.state.clone();
    if (kind === 'trader') {
      if ((next.inventory['coconut'] ?? 0) < 2) { this.notice = '岚商需要 2 个椰子'; return; }
      next.inventory['coconut'] -= 2; next.inventory['rope'] = (next.inventory['rope'] ?? 0) + 1; this.apply(next, '与岚商交易：得到 1 根绳索'); return;
    }
    if ((next.inventory['berry'] ?? 0) < 3) { this.notice = '禾姨需要 3 份浆果'; return; }
    next.inventory['berry'] -= 3; next.inventory['taro-seed'] = (next.inventory['taro-seed'] ?? 0) + 1; this.apply(next, '与禾姨交易：得到 1 份芋种');
  }
  private localVillagerReply(question: string): string {
    if (question.includes('轨') || question.includes('路')) return '阿拓：轨段只能接在已有轨道的上下左右；道路先从营地出口往外铺。';
    if (question.includes('矿') || question.includes('铁')) return '阿拓：先找岩台和裸露矿脉，带石镐；铁矿不能当成海蚀石使用。';
    if (question.includes('种') || question.includes('田')) return '禾姨：播种后要浇水，田里有水才会随岛屿时间生长。';
    if (question.includes('买') || question.includes('卖') || question.includes('交易')) return '岚商：靠近我打开交易，实际货品和价格都要经过背包规则结算。';
    return '阿拓：先看情境按钮，它会按设施、村民、地面物、采集的顺序告诉你现在能做什么。';
  }
  private async askVillager(): Promise<void> {
    const question = this.villagerQuestion.trim(); if (question.length === 0 || this.villagerTalking) return;
    this.villagerReply = this.localVillagerReply(question); this.villagerReplySource = '岛民先答 · Kimi 快速回话中'; this.villagerTalking = true;
    if (this.sessionToken.length === 0) { this.villagerReplySource = '当前离线 · 岛民本地回应'; this.villagerTalking = false; return; }
    const payload = JSON.stringify({ villagerId: 'castaway-builder', villagerName: '阿拓', role: '营地建造者', relationship: this.state.milestones['villager:castaway-builder:recruited'] ? 'joined' : 'not-recruited', question: question.slice(0, 240), biome: 'island-camp', inventory: Object.keys(this.state.inventory).filter((id: string) => this.state.inventory[id] > 0).slice(0, 16).map((id: string) => `${this.itemName(id)}×${this.state.inventory[id]}`) });
    try {
      const reply = await this.client.talkToVillager(this.sessionToken, payload);
      if (reply.reply.trim().length > 0) this.villagerReply = reply.reply.trim();
      this.villagerReplySource = reply.source === 'kimi' ? 'Kimi 在线回应' : 'Kimi 不可用 · 岛民本地回应';
    } catch (_) { this.villagerReplySource = 'Kimi 超时 · 已保留岛民回答'; }
    this.villagerTalking = false;
  }

  private craftCampfire(): void {
    try { this.apply(Simulation.step(this.state, { type: 'craft', recipeId: 'build-campfire' }), '营火已制作，可放置到岛上'); }
    catch (_) { this.notice = '需要 3 木材和 4 石块'; }
  }

  private craftRope(): void {
    try {
      const next = Simulation.step(this.state, { type: 'craft', recipeId: 'craft-rope' }); next.milestones['item:rope'] = true;
      this.apply(next, '绳索已合成'); this.showUnlock('绳索', '石镐、石砍刀、庇护所');
    }
    catch (_) { this.notice = '需要 4 份棕榈纤维'; }
  }
  private craftRecipe(recipeId: string, label: string): void {
    try { this.apply(Simulation.step(this.state, { type: 'craft', recipeId: recipeId }), `${label}已制作`); }
    catch (_) { this.notice = `${label}材料不足，缺少的材料已标在制作页`; }
  }

  private placeCampfire(): void {
    try {
      const id = `campfire-${Date.now()}`;
      const point = this.placementPoint();
      this.apply(Simulation.step(this.state, { type: 'place', entityId: id, itemId: 'campfire', coordinates: point }), '营火已放在角色前方');
    } catch (_) { this.notice = '请先制作营火'; }
  }

  private toggleMode(): void {
    const mode = this.state.playMode === PlayMode.GUIDED ? PlayMode.FREE : PlayMode.GUIDED;
    this.apply(Simulation.step(this.state, { type: 'set_play_mode', playMode: mode }), mode === PlayMode.GUIDED ? '已切换到引导 A' : '已切换到自由 B');
  }

  private saveDiary(): void {
    if (this.diaryText.trim().length === 0) { this.notice = '先写下一点今天发生的事'; return; }
    this.apply(Simulation.step(this.state, { type: 'write_diary', entryId: `day-${this.state.day}-${Date.now()}`, text: this.diaryText.trim() }), '日记已保存到本机');
    this.diaryText = '';
    this.showDiary = false;
  }

  private advanceTime(): void {
    this.apply(this.advanceFarms(Simulation.step(this.state, { type: 'advance_time', minutes: 120 }), 120), '时间流逝，作物与天气同步推进');
  }

  private facilityId(type: string): string {
    return Object.keys(this.state.entities).find((id: string) => this.state.entities[id].type === type) ?? '';
  }
  private craftFacility(recipeId: string, label: string): void {
    try { this.apply(Simulation.step(this.state, { type: 'craft', recipeId: recipeId }), `${label}已制作，请放置后使用`); }
    catch (_) { this.notice = '材料不足，继续采集后再制作'; }
  }
  private placeFacility(type: string): void {
    const point = this.placementPoint();
    try { this.apply(Simulation.step(this.state, { type: 'place', entityId: `${type}-${Date.now()}`, itemId: type, coordinates: point }), `${type === 'furnace' ? '石砌熔炉' : '储物箱'}已放在角色前方`); }
    catch (_) { this.notice = '请先制作对应设施'; }
  }
  private moveStone(direction: TransferDirection): void {
    const id = this.facilityId('storage-crate'); if (id.length === 0) { this.notice = '请先放置储物箱'; return; }
    const result = FacilityRules.transferStorage(this.state, id, 'stone', 1, direction);
    if (result.error.length > 0) { this.notice = '没有可移动的海蚀石'; return; }
    this.apply(result.save, direction === TransferDirection.DEPOSIT ? '已存入 1 海蚀石' : '已取回 1 海蚀石');
  }
  private smeltCopper(): void {
    const id = this.facilityId('furnace'); if (id.length === 0) { this.notice = '请先放置石砌熔炉'; return; }
    const result = FacilityRules.startFurnace(this.state, id, FacilityRules.recipes[0]);
    if (result.error.length > 0) { this.notice = result.error === 'missing-fuel' ? '木炭不足' : '铜矿石不足或熔炉正忙'; return; }
    this.apply(result.save, '熔炉已点燃，离开面板后仍会工作');
  }
  private claimFurnace(): void {
    const result = FacilityRules.claimFurnace(this.state, this.facilityId('furnace'));
    if (result.error.length > 0) { this.notice = '还没有可领取的产物'; return; }
    this.apply(result.save, '领取产物成功');
  }

  @Builder
  private InventoryPanel() {
    Column({ space: 10 }) {
      Row() { Text('背包').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFF7E5'); Blank(); Text('返回岛上').fontSize(14).fontColor('#FFD394').onClick(() => this.showInventory = false); }
      Text('物品可直接进食或丢到脚边；丢弃物仍能再次拾取。').fontSize(12).fontColor('#9CB7AC');
      Scroll() {
        Column({ space: 7 }) {
          ForEach(Object.keys(this.state.inventory).filter((item: string) => this.inventory(item) > 0).sort(), (item: string) => {
            Row({ space: 8 }) {
              Text(this.itemName(item)).fontSize(15).fontWeight(FontWeight.Bold).fontColor('#FFF1D2').layoutWeight(1);
              Text(`×${this.inventory(item)}`).fontSize(14).fontColor('#BCD7CB');
              if (this.isFood(item)) Button('进食').height(38).onClick(() => this.eat(item, this.itemName(item)));
              Button('丢弃').height(38).backgroundColor('#4A352B').onClick(() => this.drop(item, this.itemName(item)));
            }.width('100%').padding(9).border({ width: 1, color: '#5C6F63' }).borderRadius(6).backgroundColor('#E6222C27');
          });
          if (Object.keys(this.state.inventory).filter((item: string) => this.inventory(item) > 0).length === 0) {
            Text('背包还是空的，返回岛上使用右侧情境动作采集。').fontSize(14).fontColor('#BCD7CB').padding(16);
          }
          if (Object.keys(this.state.groundItems).length > 0) Button(`拾取脚边物品 ×${Object.keys(this.state.groundItems).length}`).width('100%').onClick(() => this.pickup(Object.keys(this.state.groundItems)[0]));
        }
      }.layoutWeight(1).scrollBar(BarState.Auto);
    }.width('92%').height('78%').padding(18).border({ width: 1, color: '#8B6A39' }).borderRadius(10).backgroundColor('#F0182520');
  }

  @Builder
  private CraftingPanel() {
    Column({ space: 10 }) {
      Row() { Text('制作图鉴').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFF7E5'); Blank(); Text('返回岛上').fontSize(14).fontColor('#FFD394').onClick(() => this.showCrafting = false); }
      Text('取得材料后会逐步展开下一级配方；设施制作完成后需要放到岛上。').fontSize(12).fontColor('#9CB7AC');
      Scroll() {
        Column({ space: 8 }) {
          this.CraftRow('绳索', '棕榈纤维×4', 'craft-rope');
          this.CraftRow('石斧', '漂流木×2 · 海蚀石×2 · 棕榈纤维×1', 'craft-stone-axe');
          this.CraftRow('石镐', '树枝×2 · 海蚀石×3 · 绳索×1', 'craft-stone-pickaxe');
          this.CraftRow('钓竿', '漂流木×2 · 棕榈纤维×3', 'craft-fishing-rod');
          this.CraftRow('营火', '漂流木×3 · 海蚀石×4', 'build-campfire');
          this.CraftRow('储物箱', '漂流木×6 · 绳索×2', 'build-storage-crate');
          this.CraftRow('石砌熔炉', '海蚀石×8 · 黏土×4', 'build-furnace');
          this.CraftRow('道路组件 ×4', '树枝×1 · 海蚀石×1', 'build-road-segment');
          Button('打开营地设施').width('100%').height(46).margin({ top: 6 }).onClick(() => { this.showCrafting = false; this.showFacilities = true; });
          Button('打开海岛图鉴').width('100%').height(46).onClick(() => { this.showCrafting = false; this.showCompendium = true; });
        }
      }.layoutWeight(1).scrollBar(BarState.Auto);
    }.width('92%').height('80%').padding(18).border({ width: 1, color: '#8B6A39' }).borderRadius(10).backgroundColor('#F0182520');
  }

  @Builder
  private CraftRow(label: string, materials: string, recipeId: string) {
    Row({ space: 10 }) {
      Column({ space: 3 }) { Text(label).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#38281C'); Text(materials).fontSize(12).fontColor('#9C4C3F'); }.layoutWeight(1).alignItems(HorizontalAlign.Start);
      Button('制作').height(42).backgroundColor('#3E6B50').onClick(() => this.craftRecipe(recipeId, label));
    }.width('100%').padding(11).border({ width: 1, color: '#8F7247' }).borderRadius(6).backgroundColor('#E9D8B6');
  }

  @Builder
  private CompendiumPanel() {
    Column({ space: 10 }) {
      Text('海岛图鉴').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      Text('可直接采集').fontSize(14).fontColor('#FFD394');
      Text(`木材 ${this.state.milestones['item:driftwood'] ? '已取得' : '可采集'} · 棕榈纤维 ${this.state.milestones['item:palm-fiber'] ? '已取得' : '可采集'} · 海蚀石 ${this.state.milestones['item:stone'] ? '已取得' : '可采集'} · 淡水 可采集 · 浆果 可采集`).fontSize(13).fontColor('#BCD7CB').lineHeight(23);
      Row({ space: 8 }) { Button('拾取淡水').onClick(() => this.gather('fresh-water', '淡水')); Button('采集浆果').onClick(() => this.gather('berry', '浆果')); }
      Divider().color('#6E8A80'); Text('已展开的配方').fontSize(14).fontColor('#FFD394');
      if (this.state.milestones['item:palm-fiber']) Text('绳索 · 小背包 · 绷带').fontColor('#F08B7C');
      if (this.state.milestones['item:stone']) Text('石斧 · 石镐 · 营火').fontColor('#F08B7C');
      if (this.state.milestones['item:rope']) Text('石镐 · 石砍刀 · 庇护所').fontColor('#F08B7C');
      Divider().color('#6E8A80');
      Text('岛上动物').fontSize(14).fontColor('#FFD394');
      Text(`陆蟹 ${this.state.milestones['animal:land-crab'] ? '已观察' : '未记录'} · 海龟 ${this.state.milestones['animal:sea-turtle'] ? '已观察' : '未记录'} · 野猪 ${this.state.milestones['animal:wild-boar'] ? '已观察' : '未记录'}`)
        .fontSize(13).fontColor('#BCD7CB').lineHeight(23);
      Button('关闭').width('100%').onClick(() => this.showCompendium = false);
    }.width('88%').padding(22).borderRadius(20).backgroundColor('#183D38');
  }

  @Builder
  private VillagerPanel() {
    Column({ space: 10 }) {
      Text('潮生村 · 三位居民').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      Text('阿拓 · 建造者').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text(this.state.milestones['villager:castaway-builder:recruited'] ? '营地建造者 · 已加入营地' : '需要一处床位、10 份食物和 10 份淡水。').fontSize(13).fontColor('#BCD7CB');
      if (!this.state.milestones['villager:castaway-builder:recruited']) Button('邀请加入营地').width('100%').onClick(() => this.recruitVillager());
      Button('交谈').width('100%').onClick(() => this.notice = '阿拓：公共岛需要大家一起建设，个人日记仍只属于你。');
      Divider().color('#6E8A80');
      Text('岚商 · 行商').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text('椰子×2 → 绳索×1').fontSize(13).fontColor('#BCD7CB');
      Button('与岚商交易').width('100%').onClick(() => this.tradeResident('trader'));
      Text('禾姨 · 农人').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text('浆果×3 → 芋种×1').fontSize(13).fontColor('#BCD7CB');
      Button('与禾姨交易').width('100%').onClick(() => this.tradeResident('farmer'));
      Divider().color('#6E8A80');
      Text(this.villagerReplySource).fontSize(12).fontColor('#FFD394');
      Text(this.villagerReply).fontSize(13).fontColor('#BCD7CB').lineHeight(22).width('100%');
      TextInput({ text: this.villagerQuestion, placeholder: '问路线、矿物、种植或交易' }).width('100%').onChange((value: string) => this.villagerQuestion = value.slice(0, 240));
      Button(this.villagerTalking ? '岛民已经先回答，正在连接 Kimi…' : '询问岛民').width('100%').enabled(!this.villagerTalking && this.villagerQuestion.trim().length > 0).onClick(() => this.askVillager());
      Button('关闭').width('100%').onClick(() => this.showVillager = false);
    }.width('88%').padding(22).borderRadius(20).backgroundColor('#183D38');
  }

  @Builder
  private MapPanel() {
    Column({ space: 12 }) {
      Text('潮生村周边地图').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      Text('金点跟随当前镜头，橙点是潮生村。').fontSize(13).fontColor('#BCD7CB');
      Stack({ alignContent: Alignment.Center }) {
        Row().width(240).height(150).borderRadius(32).backgroundColor('#688B5D');
        Text('◆').fontSize(22).fontColor('#E78F32').translate({ x: 42, y: -18 });
        Text('●').fontSize(18).fontColor('#FFD45B').translate({ x: Math.max(-105, Math.min(105, this.offsetX / 6)), y: Math.max(-60, Math.min(60, this.offsetY / 6)) });
        Text('潮生村').fontSize(11).fontColor('#FFF3CF').translate({ x: 42, y: 6 });
      }.width(270).height(180).border({ width: 4, color: '#B98B42' }).borderRadius(40).backgroundColor('#174F5C');
      Button('打开海岛图鉴').width('100%').onClick(() => { this.showMap = false; this.showCompendium = true; });
      Button('关闭').width('100%').onClick(() => this.showMap = false);
    }.width('88%').padding(22).borderRadius(20).backgroundColor('#183D38');
  }

  @Builder
  private FacilityPanel() {
    Column({ space: 8 }) {
      Row() { Image($r('app.media.game_ui_crafting')).width(34).height(34); Text('营地工坊').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#FFF7E5').margin({ left: 8 }); Blank(); Text('返回岛上').fontSize(13).fontColor('#FFD394').onClick(() => this.showFacilities = false); }
      Scroll() {
        Column({ space: 8 }) {
      Text('储物箱').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text(`背包海蚀石 ${this.inventory('stone')} · 箱内 ${this.state.containerInventories[this.facilityId('storage-crate')]?.['stone'] ?? 0}`).fontSize(13).fontColor('#BCD7CB');
      Row({ space: 8 }) { Button('制作箱子').onClick(() => this.craftFacility('build-storage-crate', '储物箱')); Button('放置箱子').onClick(() => this.placeFacility('storage-crate')); }
      Row({ space: 8 }) { Button('存入 1').onClick(() => this.moveStone(TransferDirection.DEPOSIT)); Button('取回 1').onClick(() => this.moveStone(TransferDirection.WITHDRAW)); }
      Divider().color('#6E8A80');
      Text('石砌熔炉').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text('铜矿石×3 + 木炭×2 → 铜锭×1 · 30 岛屿分钟').fontSize(13).fontColor('#BCD7CB');
      Row({ space: 6 }) { Button('采黏土').onClick(() => this.gather('clay', '黏土')); Button('采铜矿').onClick(() => this.gather('copper-ore', '铜矿石')); Button('收木炭').onClick(() => this.gather('charcoal', '木炭')); }
      Row({ space: 8 }) { Button('制作熔炉').onClick(() => this.craftFacility('build-furnace', '石砌熔炉')); Button('放置熔炉').onClick(() => this.placeFacility('furnace')); }
      Row({ space: 8 }) { Button('开始熔炼').onClick(() => this.smeltCopper()); Button('领取产物').onClick(() => this.claimFurnace()); }
      Divider().color('#6E8A80');
      Text('道路网络').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text(`道路组件 ${this.inventory('road-segment')} · 自动连接直路、弯道和岔路`).fontSize(13).fontColor('#BCD7CB');
      Row({ space: 8 }) { Button('制作道路×4').onClick(() => this.craftRoad()); Button('继续铺路').onClick(() => this.placeRoad()); }
      Text('窄轨运输').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text(`轨段 ${this.inventory('rail-segment')} · 只能接到已有轨道的上下左右`).fontSize(13).fontColor('#BCD7CB');
      Button('继续铺轨').width('100%').onClick(() => this.placeRail());
      Divider().color('#6E8A80');
      Text('九格耕作田').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Text(`水量 ${this.state.plots[this.farmId()]?.water ?? 0}/12 · 缺水时生长暂停`).fontSize(13).fontColor('#BCD7CB');
      Row({ space: 6 }) { Button('播芋种').onClick(() => this.plant('taro-seed')); Button('播粟种').onClick(() => this.plant('millet-seed')); Button('播药草').onClick(() => this.plant('herb-seed')); }
      Row({ space: 8 }) { Button('浇水').onClick(() => this.waterFarm()); Button('收获成熟作物').onClick(() => this.harvestFarm()); }
      Divider().color('#6E8A80'); Text('食用与丢弃').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394');
      Row({ space: 6 }) { Button(`吃椰子 ${this.inventory('coconut')}`).onClick(() => this.eat('coconut', '椰子')); Button(`吃浆果 ${this.inventory('berry')}`).onClick(() => this.eat('berry', '浆果')); }
      Row({ space: 6 }) { Button('丢 1 椰子').onClick(() => this.drop('coconut', '椰子')); Button('丢 1 浆果').onClick(() => this.drop('berry', '浆果')); }
      if (Object.keys(this.state.groundItems).length > 0) Button(`拾取脚边物品 ${Object.keys(this.state.groundItems).length}`).width('100%').onClick(() => this.pickup(Object.keys(this.state.groundItems)[0]));
        }.width('100%');
      }.layoutWeight(1).scrollBar(BarState.Auto);
    }.width('92%').height('82%').padding(16).border({ width: 1, color: '#7D5D32' }).borderRadius(8).backgroundColor('#F0201914');
  }

  private passport(): void {
    this.context.openLink('https://zhengzhengstudio.cn/passport/login.html?redirect=https%3A%2F%2Fsurvival-diary.zhengzhengstudio.cn%2F&from=survival-diary&scope=survival-diary&returnUser=1')
      .catch(() => this.notice = '暂时无法打开通行证');
  }

  private tapFriend(): void {
    if (this.sessionToken.length === 0) { this.notice = '联网后才能发出碰一碰好友申请'; return; }
    new TapFriendService(this.context, this.client).shareFriendRequest(this.sessionToken)
      .catch(() => this.notice = '碰一碰暂时不可用');
  }

  private tapIsland(): void {
    if (this.sessionToken.length === 0) { this.notice = '联网后才能邀请公共岛'; return; }
    if (this.onlineIslandId.length === 0) { this.notice = '先创建或加入公共岛再邀请'; return; }
    new TapFriendService(this.context, this.client).sharePublicIsland(this.sessionToken, this.onlineIslandId)
      .catch(() => this.notice = '公共岛邀请暂时不可用');
  }

  @Builder
  private Landing() {
    Column() {
      Image($r('app.media.app_icon')).width(112).height(112).borderRadius(28);
      Text('生存日记').fontSize(34).fontWeight(FontWeight.Bold).fontColor('#FFF7E5').margin({ top: 18 });
      Text('每一座岛，都会继续生长').fontSize(15).fontColor('#BCD7CB').margin({ top: 8, bottom: 30 });
      Button('建议使用通行证登录').width('86%').height(52).backgroundColor('#E09345').fontColor('#102E2B').onClick(() => this.passport());
      Text('同步好友与公共岛').fontSize(12).fontColor('#8EAAA0').margin({ top: 7 });
      if (this.hasExistingSave) {
        Text(`本机存档 · 第 ${this.state.day} 天 · 自动保存完好`).fontSize(12).fontColor('#FFD394').margin({ top: 18, bottom: 10 });
        Button('继续岛屿').width('86%').height(50).backgroundColor('#35634F').onClick(() => this.beginIsland());
        if (!this.confirmingNewFromLauncher) {
          Button('新建岛屿').width('86%').height(44).margin({ top: 9 }).backgroundColor('#243D36').onClick(() => this.confirmingNewFromLauncher = true);
        } else {
          Text('当前岛屿、背包、建筑和日记会被替换。').fontSize(12).fontColor('#F0B8AA').margin({ top: 10 });
          Row({ space: 8 }) {
            Button('确认新建').backgroundColor('#8B3D30').onClick(async () => { await this.restartWorld(); this.confirmingNewFromLauncher = false; this.beginIsland(); });
            Button('保留存档').backgroundColor('#49645D').onClick(() => this.confirmingNewFromLauncher = false);
          }
        }
      } else {
        Button('开始新游戏 · 引导模式 A').width('86%').height(50).margin({ top: 22 }).backgroundColor('#284C47').onClick(async () => { await this.restartWorld(); this.beginIsland(); });
      }
      Text('临时即本地 · 不登录也能保存和游玩').fontSize(12).fontColor('#809B92').margin({ top: 7 });
    }
    .justifyContent(FlexAlign.Center)
    .width('100%').height('100%')
    .padding(24)
    .backgroundColor('#102E2B');
  }

  @Builder
  private LoadingWorld() {
    Column({ space: 12 }) {
      Text('SURVIVAL DIARY').fontSize(11).fontWeight(FontWeight.Bold).fontColor('#D4A33F');
      Text('潮声渐近').fontSize(34).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      Text('正在恢复天色、角色与营地状态……').fontSize(14).fontColor('#BCD7CB');
      Progress({ value: 72 }).width('78%').color('#D4A33F').margin({ top: 10 });
      Text('观察潮线、留意天色。你带走的每样东西都会改变下一步。').fontSize(11).fontColor('#809B92');
    }.justifyContent(FlexAlign.Center).width('100%').height('100%').padding(28).backgroundColor('#102E2B');
  }

  @Builder
  private DiaryPanel() {
    Column() {
      Text('岛上日记').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#3B291D');
      Text(`第 ${this.state.day} 天 · 已有 ${Object.keys(this.state.journals).length} 篇`).fontSize(13).fontColor('#795D48').margin({ top: 5, bottom: 14 });
      TextArea({ text: this.diaryText, placeholder: '潮声、天气、发现和你建造的东西……' })
        .height(180).backgroundColor('#FFF9E9').onChange((value: string) => this.diaryText = value);
      Row() {
        Button('取消').backgroundColor('#826A58').onClick(() => this.showDiary = false);
        Button('写入日记').margin({ left: 12 }).backgroundColor('#C96F3C').onClick(() => this.saveDiary());
      }.margin({ top: 16 });
    }.width('88%').padding(22).borderRadius(24).backgroundColor('#F2E2C5');
  }

  @Builder
  private FriendsPanel() {
    Column() {
      Text('系统 · 联机与好友').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      Scroll() {
        Column() {
      Text('碰一下只传递一次性邀请；好友申请仍需对方确认。个人岛和私人日记不会被带过去。')
        .fontSize(13).fontColor('#BCD7CB').margin({ top: 8, bottom: 16 });
      Button('碰一下 · 加好友').width('100%').height(48).onClick(() => this.tapFriend());
      Button(this.state.playMode === PlayMode.GUIDED ? '切换到自由模式 B' : '切换到引导模式 A').width('100%').height(46).margin({ top: 8 }).onClick(() => this.toggleMode());
      Text(this.onlineState === 'online' ? `已连接 ${this.onlineIslandId} · 版本 ${this.onlineRevision}` : '当前为本地游玩').fontSize(13).fontColor('#BCD7CB').margin({ top: 12 });
      Button('创建或进入我的公共岛').width('100%').height(48).margin({ top: 10 }).onClick(() => this.createPublicIsland());
      Button('刷新公共岛').width('100%').height(44).margin({ top: 8 }).onClick(() => this.refreshPublicIslands());
      ForEach(this.publicIslands, (island: PublicIsland) => {
        Button(`加入 ${island.name ?? island.id} · ${island.members.length}/4`).width('100%').height(44).margin({ top: 6 })
          .enabled(island.members.length < 4).onClick(() => this.joinPublicIsland(island.id));
      }, (island: PublicIsland) => island.id);
      if (this.onlineState === 'online') {
        Text('岛屿聊天').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD394').margin({ top: 12 });
        Scroll() {
          Column({ space: 4 }) {
            ForEach(this.chatMessages, (message: RealtimeChatMessage) => {
              Text(`${message.uid.slice(0, 12)}：${message.text}`).fontSize(13).fontColor('#FFF7E5').width('100%');
            });
          }.width('100%');
        }.height(100).width('100%');
        TextInput({ text: this.chatDraft, placeholder: '输入岛屿消息' }).width('100%').onChange((value: string) => this.chatDraft = value.slice(0, 500));
        Button('发送').width('100%').height(44).margin({ top: 6 }).enabled(this.chatDraft.trim().length > 0).onClick(() => this.sendIslandChat());
        Button('退出公共岛').width('100%').height(44).margin({ top: 6 }).backgroundColor('#713B32').onClick(() => this.leavePublicIsland());
        Button('碰一下 · 邀请到公共岛').width('100%').height(44).margin({ top: 6 }).onClick(() => this.tapIsland());
      }
      Button('检查新版本').width('100%').height(48).margin({ top: 10 }).onClick(() => {
        new UpdateService(this.context, this.client).checkAndOpen()
          .then((opened: boolean) => this.notice = opened ? '已打开新版本下载' : '当前已经是最新版')
          .catch(() => this.notice = '检查更新失败');
      });
      if (!this.confirmingRestart) {
        Button('重新开始').width('100%').height(48).margin({ top: 10 }).backgroundColor('#713B32').onClick(() => this.confirmingRestart = true);
      } else {
        Text('当前岛屿、背包、建筑和日记都会永久删除。').fontSize(12).fontColor('#F0B8AA').margin({ top: 12 });
        Button('确认删除并重新开始').width('100%').height(48).margin({ top: 8 }).backgroundColor('#9A3025').onClick(() => this.restartWorld());
        Button('保留当前世界').width('100%').height(42).margin({ top: 6 }).backgroundColor('#49645D').onClick(() => this.confirmingRestart = false);
      }
      Button('关闭').width('100%').margin({ top: 14 }).backgroundColor('#49645D').onClick(() => this.showFriends = false);
        }.width('100%');
      }.layoutWeight(1).scrollBar(BarState.Auto);
    }.width('88%').height('86%').padding(22).borderRadius(24).backgroundColor('#183D38');
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.loadingWorld) {
        this.LoadingWorld();
      } else if (!this.entered) {
        this.Landing();
      } else {
        GameCanvas({
          zoom: $zoom, offsetX: $offsetX, offsetY: $offsetY, rotation: this.rotation,
          weatherKind: this.state.weather.kind, weatherIntensity: this.state.weather.intensity,
          minute: this.state.time, campfires: this.countEntity('campfire'), shelters: this.countEntity('shelter'), villagers: 3,
          roads: this.roadTiles(), entities: this.worldEntities(), groundItems: this.worldGroundItems()
        });
        GameHud({
          day: this.state.day, minute: this.state.time, weather: this.state.weather.kind,
          mode: this.state.playMode, health: this.state.vitals.health, stamina: this.state.vitals.stamina,
          hunger: this.state.vitals.hunger, hydration: this.state.vitals.hydration,
          wood: this.inventory('driftwood'), fiber: this.inventory('palm-fiber'),
          stone: this.inventory('stone'), campfires: this.countEntity('campfire'), online: true, notice: this.notice, guideText: this.guideText(),
          contextActionLabel: this.contextActionLabel(),
          onGatherWood: () => this.gather('driftwood', '木材'), onGatherFiber: () => this.gather('palm-fiber', '棕榈纤维'),
          onGatherStone: () => this.gather('stone', '海蚀石'), onCraftCampfire: () => this.craftCampfire(), onCraftRope: () => this.craftRope(),
          onPlaceCampfire: () => this.placeCampfire(), onDiary: () => this.showDiary = true,
          onToggleMode: () => this.toggleMode(),
          onFriends: () => this.showFriends = true, onAdvanceTime: () => this.advanceTime(),
          onFacilities: () => this.showFacilities = true,
          onContextAction: () => this.contextualAction(),
          secondaryActionLabel: '就近采集', onSecondaryAction: () => this.quickGather(),
          onInventory: () => this.showInventory = true,
          onCrafting: () => this.showCrafting = true,
          onSystem: () => { this.showFriends = true; this.refreshPublicIslands(); },
          onMap: () => this.showMap = true,
          onVillager: () => this.showVillager = true
        });
        if (this.showDiary) this.DiaryPanel();
        if (this.showFriends) this.FriendsPanel();
        if (this.showInventory) this.InventoryPanel();
        if (this.showCrafting) this.CraftingPanel();
        if (this.showFacilities) this.FacilityPanel();
        if (this.showCompendium) this.CompendiumPanel();
        if (this.showMap) this.MapPanel();
        if (this.showVillager) this.VillagerPanel();
        if (this.unlockText.length > 0) {
          Text(this.unlockText).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFD66B').textAlign(TextAlign.Center)
            .padding(16).border({ width: 2, color: '#D9A13B' }).borderRadius(10).backgroundColor('#F02B2118');
        }
      }
    }.width('100%').height('100%').backgroundColor('#102E2B');
  }
}
