const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'website/survival-diary.zhengzhengstudio.cn');
const onboarding = require(path.join(root, 'apps/SurvivalDiaryShared/src/onboarding.js'));
const catalog = require(path.join(root, 'apps/SurvivalDiaryShared/content/onboarding.json'));
const transport = require(path.join(root, 'apps/SurvivalDiaryShared/src/transport-engine.js'));
const World = require(path.join(webRoot, 'js/world.js'));

test('opening chapter is a recoverable eleven-beat story with a morning mystery', () => {
  assert.equal(catalog.version, 3);
  assert.equal(catalog.steps.length, 11);
  assert.deepEqual(catalog.steps.map(step => step.id), [
    'wake_and_observe', 'meet_atuo', 'gather_starter_supplies', 'craft_first_tool',
    'secure_water_and_food', 'harvest_first_fiber', 'light_first_fire',
    'place_first_shelter', 'eat_and_recover', 'rest_first_night', 'discover_morning_signal',
  ]);
  assert.match(catalog.steps.at(-1).body, /烟柱/);
  assert.match(catalog.completion.body, /旧路/);
});

test('prior actions are credited and starter resources recover before the opening completes', () => {
  const save = {
    playMode: 'guided', inventory: { branch: 1, stone: 2, 'palm-fiber': 5, 'fresh-water': 1, coconut: 1, 'stone-machete': 1 },
    milestones: { wake_and_observe: true, meet_atuo: true },
    journalEntries: [{ facts: [{ type: 'gathered', subject: 'branch', count: 1 }, { type: 'crafted', subject: 'stone-machete', count: 1 }] }],
    entities: [],
  };
  assert.equal(onboarding.nextOnboardingCue(save).id, 'light_first_fire');

  const world = World.createWorldView('opening-recovery');
  const starter = Object.values(world.resourceNodes).find(node => node.id.includes('@0,0:') && node.itemId === 'fresh-water');
  const depleted = { ...world, playMode: 'guided', resourceNodes: { ...world.resourceNodes, [starter.id]: { ...starter, remaining: 0, state: 'depleted' } } };
  const repaired = World.reconcileResourceNodes(depleted);
  assert.ok(repaired.resourceNodes[starter.id].remaining > 0);
});

test('minecart ride moves both cart and passenger along a complete cardinal rail step', () => {
  const state = {
    player: { id: 'player', x: 0, y: 0, mode: 'walking' }, transportInteractionRange: 1.5,
    inventory: {}, processedWorldCommands: {}, terrainAt: () => ({ walkable: true, waterDepth: 0 }),
    entities: [
      { id: 'cart', type: 'minecart', x: 0, y: 0 },
      { id: 'r0', type: 'rail-segment', x: 0, y: 0 },
      { id: 'r1', type: 'rail-segment', x: 1, y: 0 },
    ],
  };
  const result = transport.rideMinecart(state, { minecartId: 'cart', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, 'ride-1');
  assert.equal(result.ok, true);
  assert.deepEqual({ x: result.state.player.x, y: result.state.player.y }, { x: 1, y: 0 });
  assert.deepEqual({ x: result.minecart.x, y: result.minecart.y }, { x: 1, y: 0 });
});

test('old stranded boats and their passengers recover to the starter tidal cove', () => {
  const world = World.createWorldView('opening-boat-recovery');
  const starterBoat = world.entities.find(entity => entity.type === 'rowboat');
  const stranded = {
    ...world,
    transportBootstrapVersion: 1,
    player: { ...world.player, mode: 'aboard', vehicleId: starterBoat.id },
    entities: world.entities.map(entity => entity.id === starterBoat.id
      ? { ...entity, x: world.player.x, y: world.player.y, state: 'aboard', occupantId: 'local' }
      : entity),
  };
  const repaired = World.reconcileResourceNodes(stranded);
  const boat = repaired.entities.find(entity => entity.id === starterBoat.id);
  assert.deepEqual({ x: boat.x, y: boat.y }, { x: starterBoat.x, y: starterBoat.y });
  assert.equal(boat.state, 'empty');
  assert.equal(repaired.player.mode, 'walking');
  assert.equal(repaired.player.vehicleId, undefined);
});

test('launcher checks updates before entering the world and smoke is a real raster landmark', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const game = fs.readFileSync(path.join(webRoot, 'js/game.js'), 'utf8');
  assert.match(html, /id="launcher-update-status"/);
  assert.match(game, /checkLauncherUpdate\(\);/);
  assert.ok(fs.existsSync(path.join(webRoot, 'assets/game/tutorial-v1/distant-smoke-column.png')));
  assert.ok(World.createWorldView('smoke-landmark').entities.some(entity => entity.type === 'tutorial-smoke'));
});
