const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const game = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
const Villagers = require('../website/survival-diary.zhengzhengstudio.cn/js/villager-ui.js');
const Physics = require('../website/survival-diary.zhengzhengstudio.cn/js/world-physics.js');
const Placement = require('../website/survival-diary.zhengzhengstudio.cn/js/placement.js');
const Content = require('../website/survival-diary.zhengzhengstudio.cn/js/content.js');
const World = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
const Onboarding = require('../website/survival-diary.zhengzhengstudio.cn/js/onboarding-controller.js');
const web = relative => fs.readFileSync(path.join(root, 'website/survival-diary.zhengzhengstudio.cn', relative), 'utf8');

test('each Web village role uses a distinct proportionate villager-v8 sprite set', () => {
  const residents = [
    { id: 'castaway:builder-1', type: 'castaway-builder' },
    { id: 'castaway:trader-1', type: 'castaway-trader' },
    { id: 'castaway:farmer-1', type: 'castaway-farmer' },
    { id: 'castaway:wanderer-1', type: 'castaway-wanderer' },
  ];
  const profiles = residents.map(entity => game.villagerVisualProfile({ ...entity, moving: true }, '', 2));
  assert.equal(new Set(profiles.map(profile => profile.key)).size, residents.length);
  assert.ok(profiles.every(profile => profile.width === 44 && profile.height === 66));
  assert.deepEqual(profiles.map(profile => profile.key), [
    'villager-atuo-walk-02', 'villager-lanshang-walk-02', 'villager-heyi-walk-02', 'villager-wanderer-walk-02',
  ]);
  assert.equal(game.villagerVisualProfile(residents[0], residents[0].id, 1).key, 'villager-atuo-talk');
  const movingTrader = game.mergeResidentVisual(residents[1], { x: 99.5, y: 41.25, direction: 'west', moving: true });
  assert.equal(movingTrader.type, 'castaway-trader');
  assert.equal(game.villagerVisualProfile(movingTrader, '', 1).key, 'villager-lanshang-walk-01');
});

test('resident patrol motion is continuous and reports real movement direction', () => {
  const trader = Villagers.RESIDENTS.find(resident => resident.role === 'trader');
  const start = Villagers.residentPosition(trader, 10);
  const next = Villagers.residentPosition(trader, 10.1);
  assert.equal(start.moving, true);
  assert.notDeepEqual([next.x, next.y], [start.x, start.y]);
  assert.ok(Math.hypot(next.x - start.x, next.y - start.y) < 1, 'patrol should glide instead of jumping a whole pixel step');
  assert.ok(['north', 'east', 'south', 'west'].includes(start.direction));
});

test('village scenery stays proportionate and leaves a readable central lane', () => {
  const layout = game.villageDecorationLayout({ x: 410, y: 250 });
  assert.equal(layout.length, 6);
  assert.ok(layout.every(entity => entity.visualScale >= .58 && entity.visualScale <= .72));
  assert.ok(layout.every(entity => Math.abs(entity.x - 410) >= 52 || Math.abs(entity.y - 250) >= 52), 'props must not sit on the village center lane');
});

test('village beds and work facilities migrate into real selectable world entities', () => {
  const oldSave = {
    entities: [{ id: 'player-fire', type: 'campfire', x: 12, y: 14 }],
    villagers: {}, village: { id: 'camp-village', name: '潮生村', x: 410, y: 250 },
    camp: { beds: 0, occupiedBeds: 0, storage: {} }, containers: {}, processedWorldCommands: {},
  };
  const migrated = Villagers.normalize(oldSave);
  const repeated = Villagers.normalize(migrated);
  for (const type of ['shelter', 'straw-mat', 'workbench', 'storageCrate', 'campfire', 'farm-plot']) {
    assert.ok(migrated.entities.some(entity => entity.type === type && entity.villageFacility === true), `${type} must be a real village entity`);
  }
  assert.equal(repeated.entities.length, migrated.entities.length, 'migration must not duplicate village facilities');
  assert.equal(migrated.camp.beds, 1, 'the real village bed must count as a usable bed');
  assert.equal(game.buildingContextAction(migrated.entities.find(entity => entity.type === 'workbench')).label, '制作');
  assert.equal(game.buildingContextAction(migrated.entities.find(entity => entity.type === 'straw-mat')).label, '睡觉');
  assert.equal(game.buildingContextAction(migrated.entities.find(entity => entity.type === 'storageCrate')).label, '打开');
  assert.ok(migrated.entities.filter(entity => entity.villageFacility).every(entity => entity.importance === 'important'));
});

test('selected transport uses real boat and minecart verbs with readable failures', () => {
  assert.equal(game.buildingContextAction({ type: 'rowboat', state: 'empty' }).label, '上船');
  assert.equal(game.buildingContextAction({ type: 'rowboat', state: 'aboard' }).label, '下船');
  assert.equal(game.buildingContextAction({ type: 'minecart' }).label, '推动');
  assert.equal(game.transportFailureMessage('boat-water-depth'), '船已搁浅，请把船移到可航行水面');
  assert.equal(game.transportFailureMessage('rail-route-missing'), '前方缺少一段轨道');
});

test('every village facility participates in real visibility, hit testing and use actions', () => {
  const source = Villagers.normalize({
    seed: 'village-hit-test', player: { x: 410, y: 250 }, camera: { x: 410, y: 250, zoom: 1.85 },
    entities: [], villagers: {}, inventory: { branch: 1 }, gameClock: { day: 1, minute: 1200 },
    vitals: { health: 70, energy: 20, food: 60, water: 60 },
    discoveredChunks: { '0,0': { visibility: 'discovered' } }, resourceNodes: {}, groundItems: {},
    camp: { beds: 0, occupiedBeds: 0, storage: {} }, containers: {}, processedWorldCommands: {},
  });
  const rendered = Physics.visibleEntities(source, { left: 0, top: 0, right: 768, bottom: 768 }, 'high');
  const visibleFacilities = rendered.filter(item => item.kind === 'entity' && item.value.villageFacility);
  assert.equal(visibleFacilities.length, Villagers.VILLAGE_FACILITIES.length);
  for (const item of visibleFacilities) {
    const hit = game.nearestSurvivalEntityAtPoint([item.value], item.value, value => Physics.collisionBounds(value, 'entity'));
    assert.equal(hit?.id, item.value.id, `${item.value.type} must be clickable at its visible center`);
  }
  assert.equal(Placement.useEntity(source, 'village:workbench', 'craft').effect.kind, 'open-crafting');
  assert.equal(Placement.useEntity(source, 'village:crate', 'open').effect.kind, 'open-storage');
  assert.equal(Placement.useEntity(source, 'village:bed', 'sleep').effect.kind, 'rest');
});

test('every saved bed branch sleeps until dawn and restores stamina', () => {
  for (const type of ['shelter', 'straw-mat', 'strawMat', 'hammock', 'simple-bed', 'simpleBed', 'camp-bed', 'campBed', 'wooden-bed', 'woodenBed']) {
    const source = {
      entities: [{ id: `bed:${type}`, type, x: 100, y: 100, state: {} }],
      inventory: {}, gameClock: { day: 3, minute: 1260 },
      vitals: { health: 72, energy: 18, food: 70, water: 70 },
    };
    const result = Placement.useEntity(source, `bed:${type}`, 'sleep');
    assert.equal(result.ok, true, `${type} must be usable`);
    assert.equal(result.effect.kind, 'rest');
    assert.equal(result.state.gameClock.day, 4);
    assert.equal(result.state.gameClock.minute, 360);
    assert.ok(result.state.vitals.energy > source.vitals.energy);
  }
});

test('all interactive work blocks expose a real effect instead of a generic message', () => {
  const cases = [
    ['workbench', 'craft', 'open-crafting'],
    ['storageCrate', 'open', 'open-storage'],
    ['storage-crate', 'open', 'open-storage'],
    ['fishRack', 'process', 'open-crafting'],
    ['fish-rack', 'process', 'open-crafting'],
    ['cookingPot', 'cook', 'open-crafting'],
    ['cooking-pot', 'cook', 'open-crafting'],
    ['dryingShed', 'process', 'open-crafting'],
    ['drying-shed', 'process', 'open-crafting'],
    ['medicineTable', 'prepare', 'open-crafting'],
    ['medicine-table', 'prepare', 'open-crafting'],
    ['dock', 'use', 'start-fishing'],
  ];
  for (const [type, action, effect] of cases) {
    const source = { entities: [{ id: `facility:${type}`, type, x: 0, y: 0, state: { storage: {} } }], inventory: {}, gameClock: { day: 1, minute: 480 }, vitals: {} };
    const result = Placement.useEntity(source, `facility:${type}`, action);
    assert.equal(result.ok, true, `${type} must be usable`);
    assert.equal(result.effect.kind, effect, `${type} must trigger ${effect}`);
  }
  const fire = Placement.useEntity({ entities: [{ id: 'fire', type: 'campfire', lit: true }], inventory: {}, gameClock: { day: 1, minute: 480 }, vitals: {} }, 'fire', 'cook');
  assert.equal(fire.effect.kind, 'open-crafting');
  const lamp = Placement.useEntity({ entities: [{ id: 'lamp', type: 'lanternPost', active: false }], inventory: {} }, 'lamp', 'toggle');
  assert.equal(lamp.effect.kind, 'light-toggled');
  assert.equal(lamp.state.entities[0].active, true);
});

test('specialized work blocks expose craftable recipes and selected facilities keep action priority', () => {
  const stationRecipes = {
    'fish-rack': 'dried-fish',
    'cooking-pot': 'coconut-water',
    'drying-shed': 'dry-herb',
    'medicine-table': 'strong-bandage',
  };
  for (const [station, output] of Object.entries(stationRecipes)) {
    assert.ok(Object.values(Content.RECIPES).some(recipe => recipe.station === station && recipe.output?.id === output), `${station} must reveal a real recipe`);
    assert.ok(Content.PLACEABLES[station], `${station} must be placeable and selectable`);
  }
  const source = web('js/game.js');
  const leaveBoat = source.indexOf("transportAction?.command === 'leave-boat'");
  const selected = source.indexOf('if (selectedEntityId)', leaveBoat);
  const villager = source.indexOf('const villagerAction', selected);
  assert.ok(leaveBoat >= 0 && selected > leaveBoat && villager > selected, 'selected facilities must win over nearby NPC and non-leave transport actions');
});

test('movement uses compact foot collisions while selection keeps the visible building footprint', () => {
  const state = { seed: 'compact-collision', entities: [{ id: 'hut', type: 'shelter', x: 480, y: 480 }], resourceNodes: {} };
  const obstacle = Physics.worldAdapter(state).obstacles.find(value => value.id === 'hut');
  assert.deepEqual(obstacle.collision, { width: 2.75, height: 1.35 });
  assert.deepEqual(Physics.collisionBounds(state.entities[0]), { x: 384, y: 384, width: 192, height: 192 });
});

test('world click priority uses an already-selected facility before selection, gathering or walking', () => {
  const entity = { id: 'bed', type: 'straw-mat' };
  const resource = { id: 'branch', itemId: 'branch' };
  assert.equal(game.worldClickIntent({ selectedEntityId: 'bed', entity, resource, activeTool: 'gather' }), 'use-selected-entity');
  assert.equal(game.worldClickIntent({ entity, resource, activeTool: 'gather' }), 'select-entity');
  assert.equal(game.worldClickIntent({ resource, activeTool: 'gather' }), 'gather-resource');
  assert.equal(game.worldClickIntent({ activeTool: 'explore' }), 'move');
});

test('island compendium reveals direct finds and workstation branches without forgetting discoveries', () => {
  const base = { inventory: {}, journalEntries: [{ facts: [{ type: 'gathered', subject: 'branch', count: 3 }] }], entities: [] };
  const entries = game.compendiumEntries(base, Content);
  assert.equal(entries.find(entry => entry.id === 'branch').direct, true);
  assert.match(entries.find(entry => entry.id === 'driftwood').source.detail, /漂流木/);
  assert.equal(entries.find(entry => entry.id === 'strong-bandage').unlocked, false);
  const withStation = game.compendiumEntries({ ...base, entities: [{ type: 'medicineTable' }] }, Content);
  assert.equal(withStation.find(entry => entry.id === 'strong-bandage').unlocked, true);
});

test('starter area guarantees two branch and two driftwood nodes instead of one hard-to-find copy', () => {
  const fresh = World.createWorldView('starter-supplies');
  const starter = Object.values(fresh.resourceNodes).filter(node => node.id.includes('@0,0:'));
  assert.ok(starter.filter(node => node.itemId === 'branch').length >= 2);
  assert.ok(starter.filter(node => node.itemId === 'driftwood').length >= 2);
});

test('guided mode advances from real movement and permanent gather facts after materials are consumed', () => {
  const state = {
    playMode: 'guided', player: { x: 278, y: 120 }, spawnPoint: { x: 260, y: 120 }, inventory: {},
    journalEntries: [{ facts: [
      { type: 'gathered', subject: 'branch', count: 1 },
      { type: 'gathered', subject: 'stone', count: 2 },
      { type: 'gathered', subject: 'palm-fiber', count: 4 },
    ] }],
    entities: [], milestones: { meet_atuo: true }, discoveredChunks: { '0,0': { visibility: 'discovered' } },
  };
  assert.equal(Onboarding.currentCue(state).id, 'craft_first_tool');
});

test('opening chapter requires real tool food fire shelter and sleep facts before open exploration', () => {
  const base = {
    playMode: 'guided', player: { x: 278, y: 120 }, spawnPoint: { x: 260, y: 120 },
    inventory: { branch: 1, stone: 2, 'palm-fiber': 5, 'fresh-water': 1, coconut: 1 },
    journalEntries: [{ facts: [{ type: 'gathered', subject: 'fresh-water', count: 1 }, { type: 'gathered', subject: 'coconut', count: 1 }] }],
    entities: [], milestones: { meet_atuo: true }, discoveredChunks: { '0,0': { visibility: 'discovered' } },
  };
  assert.equal(Onboarding.currentCue(base).id, 'craft_first_tool');

  const tool = { ...base, journalEntries: [{ facts: [...base.journalEntries[0].facts, { type: 'crafted', subject: 'stone-axe', count: 1 }] }] };
  assert.equal(Onboarding.currentCue(tool).id, 'light_first_fire');

  const fed = { ...tool, journalEntries: [{ facts: [...tool.journalEntries[0].facts, { type: 'ate', subject: 'coconut', count: 1 }] }] };
  assert.equal(Onboarding.currentCue(fed).id, 'light_first_fire');

  const fire = { ...fed, entities: [{ id: 'fire', type: 'campfire', lit: true }] };
  assert.equal(Onboarding.currentCue(fire).id, 'place_first_shelter');

  const sheltered = { ...fire, entities: [...fire.entities, { id: 'bed', type: 'hammock' }] };
  // Earlier eating is credited: once the shelter is built the chapter can
  // advance directly to the first-night rest instead of asking the player to
  // repeat an action they already completed.
  assert.equal(Onboarding.currentCue(sheltered).id, 'rest_first_night');

  const recovered = { ...sheltered, milestones: { ...sheltered.milestones, 'consumed:any': true }, journalEntries: fed.journalEntries };
  assert.equal(Onboarding.currentCue(recovered).id, 'rest_first_night');
  const dawn = { ...recovered, milestones: { ...recovered.milestones, 'slept:any': true } };
  assert.equal(Onboarding.currentCue(dawn).id, 'discover_morning_signal');
  const open = { ...dawn, milestones: { ...dawn.milestones, discover_morning_signal: true } };
  assert.equal(Onboarding.currentCue(open).completion, true);
});

test('map tiles use plain-language direction labels instead of raw coordinates alone', () => {
  assert.equal(game.regionDirectionLabel({ x: 0, y: 0 }, { x: 0, y: 0 }), '你在这里');
  assert.equal(game.regionDirectionLabel({ x: 1, y: -1 }, { x: 0, y: 0 }), '东北 · 1 区');
  assert.equal(game.regionDirectionLabel({ x: -2, y: 0 }, { x: 0, y: 0 }), '西 · 2 区');
});

test('guide has an explicit dismiss control and villager-v8 is available offline', () => {
  const html = web('index.html');
  const sw = web('sw.js');
  assert.match(html, /id="guide-dismiss"[^>]*aria-label="收起新手引导"/);
  assert.match(html, /assets\/game\/villager-v8\/atuo-talk\.png/);
  assert.match(sw, /\['atuo', 'lanshang', 'heyi', 'wanderer'\]\.flatMap/);
  assert.match(sw, /\['idle', 'talk', 'walk-01', 'walk-02'\]\.map/);
  assert.match(sw, /villager-v8\/\$\{character\}-\$\{state\}\.png/);
});
