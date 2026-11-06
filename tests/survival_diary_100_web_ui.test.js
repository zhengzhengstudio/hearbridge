const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'website/survival-diary.zhengzhengstudio.cn');
const read = relative => fs.readFileSync(path.join(webRoot, relative), 'utf8');
const html = read('index.html');
const css = `${read('styles.css')}\n${read('game-hud-v2.css')}`;
const game = read('js/game.js');
const serviceWorker = read('sw.js');
const inventoryPath = path.join(webRoot, 'js/inventory-ui.js');
const contextPath = path.join(webRoot, 'js/context-actions.js');

test('Web surface exposes the complete world-first game regions and new controllers', () => {
  for (const id of ['survival-hud', 'goal-card', 'hotbar', 'context-action', 'game-panel', 'journal-book']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /<script src="js\/inventory-ui\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /<script src="js\/context-actions\.js\?v=[^"]+"><\/script>/);
});

test('mobile action, inventory, and storage lanes preserve text and safe areas', () => {
  assert.match(css, /#game-shell\.world-first-hud #context-action\s*\{[\s\S]{0,500}bottom:\s*calc\(var\(--safe-bottom\)\s*\+\s*var\(--dock-height\)\s*\+\s*8px\)/);
  assert.doesNotMatch(read('styles.css'), /@media\s*\(max-width:\s*430px\)[\s\S]{0,500}#context-action/);
  assert.doesNotMatch(css, /#context-action[\s\S]{0,500}text-overflow:\s*ellipsis/);
  assert.match(css, /\.inventory-grid\s*\{[\s\S]{0,500}overflow:\s*auto/);
  assert.match(css, /\.storage-(?:layout|list)[\s\S]{0,900}overscroll-behavior:\s*contain/);
  assert.match(css, /@media\s*\(max-width:\s*430px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1200px\)/);
});

test('inventory controller supports finite slots, hotbar transfer, and persistent ground drops', () => {
  assert.equal(fs.existsSync(inventoryPath), true, 'inventory-ui.js is missing');
  if (!fs.existsSync(inventoryPath)) return;
  const inventory = require(inventoryPath);
  const state = {
    inventory: { stone: 35, branch: 2 },
    hotbarSlots: ['stone', null, null, null, null, null],
    groundItems: {},
    player: { x: 12, y: 8 },
  };
  assert.deepEqual(inventory.inventoryUsage(state.inventory, { stone: { stack: 20 }, branch: { stack: 20 } }), {
    usedSlots: 3,
    totalSlots: 18,
  });
  const equipped = inventory.assignHotbar(state, 'branch', 1);
  assert.equal(equipped.hotbarSlots[1], 'branch');
  const removed = inventory.clearHotbar(equipped, 0);
  assert.equal(removed.hotbarSlots[0], null);
  const dropped = inventory.dropStack(removed, 'stone', 20, 'drop-web-1');
  assert.equal(dropped.ok, true);
  assert.equal(dropped.state.inventory.stone, 15);
  assert.equal(Object.values(dropped.state.groundItems)[0].amount, 20);
  assert.equal(inventory.dropStack(dropped.state, 'stone', 1, 'drop-web-1').ok, false);
});

test('context controller produces concrete actions, stat feedback, and placement camera separation', () => {
  assert.equal(fs.existsSync(contextPath), true, 'context-actions.js is missing');
  if (!fs.existsSync(contextPath)) return;
  const actions = require(contextPath);
  assert.deepEqual(actions.contextActionFor({ kind: 'food', name: '烤鱼', itemId: 'cooked-fish' }), {
    object: '烤鱼', verb: '进食', icon: 'food', command: 'consume', itemId: 'cooked-fish',
  });
  assert.deepEqual(actions.statFeedback({ health: 3, stamina: 8, hunger: 18, thirst: 0 }), ['生命 +3', '体力 +8', '饱腹 +18']);
  const camera = { x: 100, y: 80, following: true };
  assert.deepEqual(actions.moveCameraWhilePlacing(camera, { x: 14, y: -6 }), { x: 86, y: 86, following: false });
});

test('game connects drop, hotbar movement, placement camera pan, and non-text use feedback', () => {
  assert.match(game, /InventoryUI\.dropStack/);
  assert.match(game, /InventoryUI\.assignHotbar/);
  assert.match(game, /ContextActions\.moveCameraWhilePlacing/);
  assert.match(game, /ContextActions\.statFeedback/);
  assert.match(game, /classList\.add\(['"]use-feedback['"]\)/);
});

test('low-quality drawing and clicking consume the same visibility decisions', () => {
  const gameHelpers = require(path.join(webRoot, 'js/game.js'));
  const items = [
    { kind: 'resource', visibility: 'hidden', value: { id: 'hidden' } },
    { kind: 'resource', visibility: 'silhouette', value: { id: 'silhouette' } },
    { kind: 'resource', visibility: 'highlighted', value: { id: 'tracked' } },
    { kind: 'ground-item', visibility: 'detailed', value: { id: 'drop' } },
  ];
  assert.deepEqual(gameHelpers.interactiveVisibleItems(items, 'resource').map(item => item.id), ['tracked']);
  assert.deepEqual(gameHelpers.interactiveVisibleItems(items, 'ground-item').map(item => item.id), ['drop']);
  assert.deepEqual(gameHelpers.visibilityAppearance('silhouette'), { alpha: 0.5, silhouette: true, highlighted: false });
  assert.deepEqual(gameHelpers.visibilityAppearance('highlighted'), { alpha: 1, silhouette: false, highlighted: true });
  assert.match(game, /frameVisibleEntities/);
  assert.doesNotMatch(game, /World\.sceneObjectsForRender\(state\)\.filter\(item => item\.kind === 'entity'\)/);
  assert.match(game, /function drawEntityFallback[^]*const width = metrics\.width[^]*const height = metrics\.height/);
  assert.doesNotMatch(game, /Math\.max\(metrics\.height, width \* image\.naturalHeight/);
});

test('Web food use applies visible small health and stamina recovery instead of text only', () => {
  const world = require(path.join(webRoot, 'js/world.js'));
  const state = world.createWorldView('web-food-feedback');
  state.inventory.coconut = 1;
  state.vitals = { health: 70, energy: 45, food: 52, water: 48 };
  const result = world.performAction(state, { type: 'use', item: 'coconut' });
  assert.equal(result.ok, true);
  assert.ok(result.state.vitals.health > state.vitals.health);
  assert.ok(result.state.vitals.energy > state.vitals.energy);
  assert.ok(result.state.vitals.food > state.vitals.food);
  assert.ok(result.state.vitals.water > state.vitals.water);

  for (const crop of ['taro', 'millet']) {
    const cropState = world.createWorldView(`web-${crop}-feedback`);
    cropState.inventory[crop] = 1;
    cropState.vitals = { health: 70, energy: 45, food: 52, water: 48 };
    const eaten = world.performAction(cropState, { type: 'use', item: crop });
    assert.equal(eaten.ok, true, `${crop} must be edible in the Web world`);
    assert.ok(eaten.state.vitals.health > cropState.vitals.health, `${crop} restores a little health`);
    assert.ok(eaten.state.vitals.energy > cropState.vitals.energy, `${crop} restores stamina`);
  }
  assert.match(game, /\['reef-fish', 'coconut', 'berry', 'mushroom', 'taro', 'millet'\]\.includes\(heldItem\)/);
});

test('Web player movement cannot tunnel through a placed facility foot collision', () => {
  const world = require(path.join(webRoot, 'js/world.js'));
  const state = world.createWorldView('web-collision-parity');
  state.entities = [{ id: 'crate-1', type: 'storageCrate', x: state.player.x + 60, y: state.player.y, rotation: 0 }];
  state.moveTarget = { x: state.player.x + 180, y: state.player.y };
  const moved = world.stepPlayer(state, 2);
  assert.ok(moved.player.x <= state.entities[0].x - 28, `player entered crate foot collision at ${moved.player.x}`);
  assert.equal(moved.player.y, state.player.y);
});

test('offline shell versions and caches the new gameplay controllers', () => {
  assert.match(serviceWorker, /survival-diary-shell-v83/);
  assert.match(serviceWorker, /\.\/js\/inventory-ui\.js/);
  assert.match(serviceWorker, /\.\/js\/context-actions\.js/);
  assert.match(serviceWorker, /\.\/js\/farm-ui\.js/);
  assert.match(serviceWorker, /\.\/js\/machine-ui\.js/);
  assert.doesNotMatch(serviceWorker, /game-ui-icon-atlas-v1/);
  for (const icon of ['health', 'water', 'food', 'energy', 'time', 'weather_clear', 'weather_rain', 'weather_snow', 'backpack', 'crafting', 'map', 'journal', 'chat', 'gather', 'build', 'sleep']) {
    assert.ok(fs.existsSync(path.join(webRoot, `assets/ui/game_ui_${icon}.png`)), `missing Web UI icon: ${icon}`);
    assert.match(serviceWorker, new RegExp(`game_ui_${icon}\\.png`));
  }
});

test('Web placement preserves the usable entrance in front of a shelter', () => {
  const world = require(path.join(webRoot, 'js/world.js'));
  const placement = require(path.join(webRoot, 'js/placement.js'));
  const state = world.createWorldView('web-entrance-clearance');
  state.inventory.storageCrate = 1;
  state.resourceNodes = {};
  state.entities = [{ id: 'shelter-1', type: 'shelter', x: 320, y: 120, rotation: 0 }];
  const originalIsBuildableTerrain = world.isBuildableTerrain;
  world.isBuildableTerrain = () => true;
  try {
    const preview = placement.previewPlacement(state, 'storageCrate', { x: 320, y: 270 }, 0);
    assert.equal(preview.valid, false);
    assert.equal(preview.reason, '会挡住建筑入口');
  } finally {
    world.isBuildableTerrain = originalIsBuildableTerrain;
  }
});

test('dropped items participate in the same foot-Y depth order as actors and buildings', () => {
  const world = require(path.join(webRoot, 'js/world.js'));
  const state = world.createWorldView('web-ground-depth');
  state.resourceNodes = {};
  state.entities = [];
  state.villagers = {};
  state.groundItems = {
    behind: { id: 'behind', itemId: 'stone', amount: 1, x: state.player.x, y: state.player.y - 8 },
    front: { id: 'front', itemId: 'branch', amount: 1, x: state.player.x, y: state.player.y + 8 },
  };
  assert.deepEqual(world.sceneObjectsForRender(state).map(item => item.value.id || item.kind), ['behind', 'player', 'front']);
});
