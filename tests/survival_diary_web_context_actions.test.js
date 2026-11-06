const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'website/survival-diary.zhengzhengstudio.cn');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(webRoot, 'js/game.js'), 'utf8');
const sw = fs.readFileSync(path.join(webRoot, 'sw.js'), 'utf8');
const TransportUI = require(path.join(webRoot, 'js/transport-ui.js'));
const World = require(path.join(webRoot, 'js/world.js'));
const WorldPhysics = require(path.join(webRoot, 'js/world-physics.js'));
const WorldChunks = require(path.join(webRoot, 'js/world-chunks.js'));
const Content = require(path.join(webRoot, 'js/content.js'));
const GameHelpers = require(path.join(webRoot, 'js/game.js'));

function visible(type, id, x, y) {
  return { kind: 'entity', visibility: 'detailed', value: { id, type, x, y } };
}

test('desktop and mobile share one contextual yellow transport action without permanent transport buttons', () => {
  const base = { player: { x: 100, y: 100, mode: 'walking' }, inventory: { 'rope-bridge': 1, 'rail-segment': 2 } };
  assert.deepEqual(TransportUI.contextAction(base, { selectedItem: null, visibleEntities: [visible('rowboat', 'boat-1', 140, 100)] }), {
    command: 'board-boat', label: '上船', hint: '划桨木船', targetId: 'boat-1', progress: '靠近后掌舵',
  });
  assert.equal(TransportUI.contextAction(base, { selectedItem: null, visibleEntities: [visible('rowboat', 'boat-far', 180, 100)] }), null);
  assert.equal(TransportUI.contextAction({ ...base, player: { ...base.player, mode: 'aboard', vehicleId: 'boat-1' } }, {}).label, '下船');
  assert.equal(TransportUI.contextAction(base, { selectedItem: 'rope-bridge', visibleEntities: [] }).label, '架桥');
  assert.equal(TransportUI.contextAction(base, { selectedItem: 'rail-segment', visibleEntities: [] }).label, '铺轨');
  assert.equal(TransportUI.contextAction(base, { selectedItem: 'rope-bridge', visibleEntities: [visible('rowboat', 'boat-1', 140, 100)] }).label, '架桥');
  assert.equal(TransportUI.contextAction(base, { visibleEntities: [visible('minecart', 'cart-1', 150, 100)] }).label, '乘坐矿车');

  assert.equal((html.match(/id=["']context-action["']/g) || []).length, 1);
  assert.doesNotMatch(html, /id=["'](?:board-boat|leave-boat|place-bridge|place-rail|move-minecart)["']/);
  assert.match(html, /class=["'][^"']*context-action/);
  assert.match(html, /class=["'][^"']*mobile-action-dock/);
});

test('new and migrated worlds have one deterministic playable transport entry', () => {
  const fresh = World.createWorldView('transport-entry');
  assert.equal(fresh.transportBootstrapVersion, 2);
  assert.ok(fresh.entities.some(entity => entity.type === 'rowboat'));
  assert.ok(fresh.entities.some(entity => entity.type === 'minecart'));
  assert.ok(fresh.entities.filter(entity => entity.type === 'rail-segment').length >= 2);
  for (const itemId of ['rope-bridge', 'rail-segment']) assert.ok(Content.ITEMS[itemId]);
  assert.equal(Content.RECIPES.ropeBridge.output.id, 'rope-bridge');
  assert.equal(Content.RECIPES.railSegment.output.id, 'rail-segment');
  const starterBoat = fresh.entities.find(entity => entity.type === 'rowboat');
  assert.ok(Math.hypot(starterBoat.x - fresh.player.x, starterBoat.y - fresh.player.y) <= 72);
  assert.ok(World.transportTerrainAt(fresh, starterBoat).waterDepth >= .45);
  assert.equal(WorldPhysics.canOccupy(fresh, fresh.player), true, 'restart spawn must not overlap starter transport');
  assert.ok(World.movePlayer(fresh, { x: 12, y: 0 }).player.x > fresh.player.x);

  const oldSaved = { seed: fresh.seed, entities: [], resourceNodes: fresh.resourceNodes };
  const realLoadMerge = { ...fresh, ...oldSaved, entities: oldSaved.entities, transportBootstrapVersion: oldSaved.transportBootstrapVersion };
  const migrated = World.reconcileResourceNodes(realLoadMerge);
  const repeated = World.reconcileResourceNodes(migrated);
  assert.equal(repeated.entities.filter(entity => entity.type === 'rowboat').length, 1);
  assert.equal(repeated.entities.filter(entity => entity.type === 'minecart').length, 1);
  assert.equal(repeated.entities.filter(entity => entity.type === 'rail-segment').length, 2);
});

test('starter transport is nearby for common seeds without a synchronous world scan', () => {
  const started = performance.now();
  for (const seed of ['20260726', 'local-1', 'local-2', 'abc', 'sample-2', 'sample-7']) {
    const fresh = World.createWorldView(seed);
    const boat = fresh.entities.find(entity => entity.type === 'rowboat');
    assert.ok(boat, `${seed} must have a starter boat`);
    assert.ok(Math.hypot(boat.x - fresh.player.x, boat.y - fresh.player.y) <= 72, `${seed} boat must be actionable`);
    assert.equal(World.transportTerrainAt(fresh, boat).waterDepth, .65);
  }
  assert.ok(performance.now() - started < 750, 'six deterministic bootstraps should stay below 750ms');
});

test('starter inlet matches the horizontal boat footprint, tapers naturally, and keeps a north landing bank', () => {
  const fresh = World.createWorldView('starter-inlet-shape');
  for (const [x, y] of [[2,3], [3,3], [4,3], [5,3], [3,4], [4,4]])
    assert.equal(World.transportTerrainAt(fresh, { x: x * 48 + 24, y: y * 48 + 24 }).waterDepth, .65, `${x},${y} is navigable cove water`);
  for (const [x, y] of [[2,4], [5,4]])
    assert.ok(World.transportTerrainAt(fresh, { x: x * 48 + 24, y: y * 48 + 24 }).waterDepth < .45, `${x},${y} tapers back into shore`);
  assert.ok(World.transportTerrainAt(fresh, { x: 4 * 48 + 24, y: 2 * 48 + 24 }).waterDepth < .45, 'north edge remains a landing bank');
});

test('network client exposes authenticated Kimi villager dialogue', async () => {
  const requests = [];
  const Network = require(path.join(webRoot, 'js/network.js'));
  const client = Network.createNetworkClient({
    storage: { getItem: () => 'device-ai', setItem() {} }, location: { protocol: 'https:', host: 'example.test' },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith('/session')) return { ok: true, json: async () => ({ sessionToken: 'signed-test' }) };
      return { ok: true, json: async () => ({ reply: '先沿海岸找淡水。', memory: '找水', source: 'kimi' }) };
    },
  });
  const result = await client.talkToVillager({ villagerId: 'castaway-builder', question: '去哪找水？' });
  assert.equal(result.source, 'kimi');
  assert.equal(requests[1].url, '/npc-dialogue');
  assert.equal(requests[1].init.headers.authorization, 'Bearer signed-test');
});

test('network client creates an idempotent public island through the authenticated root contract', async () => {
  const requests = [];
  const Network = require(path.join(webRoot, 'js/network.js'));
  const client = Network.createNetworkClient({
    storage: { getItem: () => 'public-device', setItem() {} },
    location: { protocol: 'https:', host: 'example.test' },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url === '/session') return { ok: true, status: 200, json: async () => ({ sessionToken: 'public-token' }) };
      return { ok: true, status: 200, json: async () => ({ id: 'public-owned', members: ['guest-public-device'] }) };
    },
  });
  const island = await client.ensurePublicIsland('same-seed');
  assert.equal(island.id, 'public-owned');
  assert.equal(requests[1].url, '/islands/mine/public');
  assert.equal(requests[1].init.method, 'PUT');
  assert.equal(requests[1].init.headers.authorization, 'Bearer public-token');
  assert.deepEqual(JSON.parse(requests[1].init.body), { seed: 'same-seed' });
});

test('villager dialogue renews an expired guest session once instead of staying offline', async () => {
  const requests = [];
  let sessionNumber = 0;
  const Network = require(path.join(webRoot, 'js/network.js'));
  const client = Network.createNetworkClient({
    storage: { getItem: () => 'device-renew', setItem() {} },
    location: { protocol: 'https:', host: 'example.test' },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith('/session')) {
        sessionNumber += 1;
        return { ok: true, status: 200, json: async () => ({ kind: 'guest', sessionToken: `signed-${sessionNumber}` }) };
      }
      if (init.headers.authorization === 'Bearer signed-1') {
        return { ok: false, status: 401, json: async () => ({ error: 'session_required' }) };
      }
      return { ok: true, status: 200, json: async () => ({ reply: '新会话已恢复。', memory: '', source: 'kimi' }) };
    },
  });

  const result = await client.talkToVillager({ villagerId: 'castaway-builder', question: '还在吗？' });
  assert.equal(result.reply, '新会话已恢复。');
  assert.deepEqual(requests.map(request => request.url), ['/session', '/npc-dialogue', '/session', '/npc-dialogue']);
  assert.equal(requests[3].init.headers.authorization, 'Bearer signed-2');
});

test('villager sheet exposes Kimi dialogue while keeping offline fallback copy', () => {
  assert.match(html, /id="villager-ai-form"/);
  assert.match(html, /在线时由 Kimi 回答/);
  assert.match(game, /talkToSelectedVillager/);
  assert.match(game, /离线岛民回应/);
  assert.match(game, /岛民先答 · Kimi 连接中/);
  assert.match(game, /button\.textContent = '连接 Kimi…'/);
  assert.match(html, /id="villager-merchant-stock"/);
  assert.match(game, /merchantStockCatalog/);
  assert.match(game, /VillagerUI\.tradeOffer/);
});

test('villager dialogue has a short client deadline and aborts a stalled request', async () => {
  let dialogueSignal = null;
  let scheduledDelay = 0;
  const Network = require(path.join(webRoot, 'js/network.js'));
  const client = Network.createNetworkClient({
    dialogueTimeoutMs: 2_500,
    storage: { getItem: () => 'device-fast-dialogue', setItem() {} },
    setTimeoutImpl(callback, delay) {
      scheduledDelay = delay;
      queueMicrotask(callback);
      return 1;
    },
    clearTimeoutImpl() {},
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/session')) return { ok: true, status: 200, json: async () => ({ kind: 'guest', sessionToken: 'signed-fast' }) };
      dialogueSignal = init.signal;
      return new Promise(() => {});
    },
  });
  await client.ensureSession();
  await assert.rejects(
    client.talkToVillager({ villagerId: 'castaway-builder', question: '现在怎么办？' }),
    error => error.code === 'dialogue_timeout',
  );
  assert.equal(scheduledDelay, 2_500);
  assert.equal(dialogueSignal.aborted, true);
});

test('system panel can save, clear and test a device-local Kimi key', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const network = fs.readFileSync(path.join(webRoot, 'js/network.js'), 'utf8');
  const game = fs.readFileSync(path.join(webRoot, 'js/game.js'), 'utf8');
  for (const id of ['kimi-api-key', 'save-kimi-key', 'test-kimi-key', 'kimi-settings-status']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /只保存在这台设备/);
  assert.match(network, /function setKimiApiKey/);
  assert.match(network, /function hasKimiApiKey/);
  assert.match(game, /refreshKimiSettings/);
  assert.match(game, /离线回答 · 尚未配置 Kimi/);
});

test('device-local Kimi key accepts provider formats, is attached once, and can be cleared', async () => {
  const values = new Map([['survival-diary-device-id', 'device-kimi-settings']]);
  const storage = { getItem: key => values.get(key) || '', setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const requests = [];
  const Network = require(path.join(webRoot, 'js/network.js'));
  const client = Network.createNetworkClient({
    storage,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith('/session')) return { ok: true, status: 200, json: async () => ({ kind: 'guest', sessionToken: 'signed-kimi' }) };
      return { ok: true, status: 200, json: async () => ({ reply: '海风正好。', memory: '', source: 'kimi' }) };
    },
  });
  assert.equal(client.hasKimiApiKey(), false);
  assert.equal(client.setKimiApiKey('provider_key_123456789'), true);
  assert.equal(client.hasKimiApiKey(), true);
  await client.talkToVillager({ villagerId: 'island-trader', question: '你好' });
  assert.equal(requests[1].init.headers['x-kimi-key'], 'provider_key_123456789');
  assert.equal(client.setKimiApiKey(''), false);
  assert.equal(client.hasKimiApiKey(), false);
  assert.throws(() => client.setKimiApiKey('too short'), /格式不正确/);
});

test('multi-seed starter boats can move, choose an unblocked bank and keep walking after landing', () => {
  for (const seed of ['20260726', 'local-1', 'abc']) {
    const fresh = World.createWorldView(seed);
    const boat = fresh.entities.find(entity => entity.type === 'rowboat');
    const boarded = World.performTransportCommand(fresh, { type: 'board-boat', targetId: boat.id, commandId: `board:${seed}` });
    assert.equal(boarded.ok, true, `${seed} boards`);
    const sailed = World.movePlayer(boarded.state, { x: 0, y: 12 });
    assert.ok(sailed.player.y > boarded.state.player.y, `${seed} boat moves within starter cove`);
    const left = World.performTransportCommand(sailed, { type: 'leave-boat', targetId: boat.id, commandId: `leave:${seed}` });
    assert.equal(left.ok, true, `${seed} finds an unblocked bank`);
    assert.equal(WorldPhysics.canOccupy(left.state, left.state.player), true, `${seed} landing is occupiable`);
    const walked = World.movePlayer(left.state, { x: 0, y: 12 });
    assert.ok(walked.player.y > left.state.player.y, `${seed} keeps walking after landing`);
  }
});

test('starter rail and minecart use the same 48px grid as contextual commands', () => {
  const fresh = World.createWorldView('starter-grid');
  const cart = fresh.entities.find(entity => entity.type === 'minecart');
  const nearTrack = { ...fresh, player: { ...fresh.player, x: cart.x, y: cart.y + 60 }, inventory: { ...fresh.inventory, 'rail-segment': 1 } };
  const route = TransportUI.suggestMinecartRoute(nearTrack, cart.id);
  assert.ok(route);
  const moved = World.performTransportCommand(nearTrack, { type: 'move-minecart', targetId: cart.id, route, commandId: 'starter-cart' });
  assert.equal(moved.ok, true);
  const point = TransportUI.suggestRailPoint(nearTrack, value => World.transportTerrainAt(nearTrack, value));
  assert.ok(point);
  assert.ok(nearTrack.entities.filter(entity => entity.type === 'rail-segment')
    .some(rail => Math.abs(point.x - rail.x) + Math.abs(point.y - rail.y) === 48));
  const placed = World.performTransportCommand(nearTrack, { type: 'place-rail', point, commandId: 'starter-rail' });
  assert.equal(placed.ok, true);

  const vertical = {
    seed: 'vertical-grid', player: { x: 96, y: 120, mode: 'walking' }, inventory: {}, processedWorldCommands: {}, resourceNodes: {},
    entities: [{ id: 'vr1', type: 'rail-segment', x: 96, y: 96 }, { id: 'vr2', type: 'rail-segment', x: 96, y: 144 }, { id: 'vc', type: 'minecart', x: 96, y: 96 }],
  };
  const verticalRoute = TransportUI.suggestMinecartRoute(vertical, 'vc');
  assert.deepEqual(verticalRoute, [{ x: 96, y: 96 }, { x: 96, y: 144 }]);
  assert.equal(World.performTransportCommand(vertical, { type: 'move-minecart', targetId: 'vc', route: verticalRoute, commandId: 'vertical-cart' }).ok, true);
});

test('boat traversal enforces the same 0.45 through 4.0 depth contract as boarding', () => {
  assert.equal(WorldPhysics.canTraverse({ waterDepth: .44, walkable: false }, { mode: 'aboard' }), false);
  assert.equal(WorldPhysics.canTraverse({ waterDepth: .45, walkable: false }, { mode: 'aboard' }), true);
  assert.equal(WorldPhysics.canTraverse({ waterDepth: 4, walkable: false }, { mode: 'aboard' }), true);
  assert.equal(WorldPhysics.canTraverse({ waterDepth: 4.01, walkable: false }, { mode: 'aboard' }), false);
});

test('leaving a boat outranks held food and fishing while bridge visuals match their full span', () => {
  const leaveIndex = game.indexOf("transportAction?.command === 'leave-boat'");
  const foodIndex = game.indexOf("['reef-fish', 'coconut', 'berry', 'mushroom', 'taro', 'millet'].includes(heldItem)");
  assert.ok(leaveIndex >= 0 && leaveIndex < foodIndex);
  const long = { type: 'rope-bridge', spanLength: 7, spanCells: Array.from({ length: 9 }, (_, index) => ({ x: index * 48, y: 0 })) };
  assert.equal(GameHelpers.transportTextureKey(long), 'rope-bridge-long');
  assert.deepEqual(GameHelpers.transportVisualMetrics(long), { width: 96, height: 432, centered: true });
});

test('context transport suggestions choose a valid shore span and contiguous rail step', () => {
  const state = {
    player: { x: 0, y: 0, mode: 'walking' },
    entities: [
      { id: 'rail:one', type: 'rail-segment', x: 480, y: 480 },
      { id: 'rail:two', type: 'rail-segment', x: 528, y: 480 },
      { id: 'cart-1', type: 'minecart', x: 480, y: 480 },
    ],
  };
  const terrainAt = point => {
    const x = Math.round(point.x / 48);
    const waterDepth = [1, 2].includes(x) ? .8 : 0;
    return { waterDepth, walkable: waterDepth <= .35 };
  };
  assert.deepEqual(TransportUI.suggestBridgeCells(state, terrainAt), [0, 48, 96, 144].map(x => ({ x, y: 0 })));
  assert.equal(TransportUI.suggestRailPoint(state, terrainAt), null, 'distant track must not be extended remotely');
  assert.deepEqual(TransportUI.suggestRailPoint({ ...state, player: { x: 528, y: 480 } }, terrainAt), { x: 576, y: 480 });
  assert.deepEqual(TransportUI.suggestMinecartRoute(state, 'cart-1'), [{ x: 480, y: 480 }, { x: 528, y: 480 }]);
});

test('Web transport commands convert 48px world positions and persist real boat, bridge, rail and cart state', () => {
  const state = {
    player: { id: 'player', x: 96, y: 96, mode: 'walking' },
    entities: [{ id: 'boat-1', type: 'rowboat', x: 144, y: 96, state: 'empty' }],
    inventory: { 'rope-bridge': 1, 'rail-segment': 3 },
    processedWorldCommands: {},
  };
  const terrainAt = (x, y) => {
    const key = `${Math.round(x / 48)},${Math.round(y / 48)}`;
    const depths = { '3,2': .8, '2,2': .2, '4,2': .8, '3,1': .8, '3,3': .8 };
    const waterDepth = depths[key] ?? 0;
    return { waterDepth, walkable: waterDepth <= .35 };
  };
  const boarded = World.performTransportCommand(state, { type: 'board-boat', targetId: 'boat-1', commandId: 'web-board', terrainAt });
  assert.equal(boarded.ok, true);
  assert.equal(boarded.state.player.mode, 'aboard');
  assert.deepEqual({ x: boarded.state.player.x, y: boarded.state.player.y }, { x: 144, y: 96 });
  const left = World.performTransportCommand(boarded.state, { type: 'leave-boat', targetId: 'boat-1', commandId: 'web-leave', terrainAt });
  assert.equal(left.ok, true);
  assert.deepEqual({ x: left.state.player.x, y: left.state.player.y }, { x: 96, y: 96 });

  const bridgeTerrain = (x, y) => {
    const cellX = Math.round(x / 48);
    const waterDepth = [1, 2, 3, 4, 5, 6, 7].includes(cellX) ? .8 : 0;
    return { waterDepth, walkable: waterDepth <= .35 };
  };
  const bridged = World.performTransportCommand(left.state, {
    type: 'place-bridge', commandId: 'web-bridge', terrainAt: bridgeTerrain,
    cells: Array.from({ length: 9 }, (_, x) => ({ x: x * 48, y: 240 })),
  });
  assert.equal(bridged.ok, true);
  assert.equal(bridged.state.entities.at(-1).type, 'rope-bridge');
  assert.equal(bridged.state.entities.at(-1).x, 192);
  assert.equal(WorldPhysics.worldAdapter(bridged.state).terrainAt(1, 5).bridge, true);
  assert.equal(WorldPhysics.worldAdapter(bridged.state).terrainAt(7, 5).bridge, true);

  const railOne = World.performTransportCommand(bridged.state, { type: 'place-rail', commandId: 'web-rail-1', point: { x: 480, y: 480 }, terrainAt });
  const railTwo = World.performTransportCommand(railOne.state, { type: 'place-rail', commandId: 'web-rail-2', point: { x: 528, y: 480 }, terrainAt });
  railTwo.state.entities.push({ id: 'cart-1', type: 'minecart', x: 480, y: 480, state: 'empty' });
  const moved = World.performTransportCommand(railTwo.state, {
    type: 'move-minecart', commandId: 'web-cart', targetId: 'cart-1',
    route: [{ x: 480, y: 480 }, { x: 528, y: 480 }], terrainAt,
  });
  assert.equal(moved.ok, true);
  assert.deepEqual({ x: moved.state.entities.find(entity => entity.id === 'cart-1').x, y: moved.state.entities.find(entity => entity.id === 'cart-1').y }, { x: 528, y: 480 });
});

test('aboard movement uses water traversal and keeps the rowboat under the player', () => {
  const seed = 'transport-movement';
  const water = { x: -168, y: 792 };
  assert.ok(WorldChunks.terrainAt(seed, water.x, water.y).waterDepth >= .45, 'fixture needs generated navigable boat water');
  const state = {
    seed, player: { id: 'player', ...water, mode: 'aboard', vehicleId: 'boat-1' },
    entities: [{ id: 'boat-1', type: 'rowboat', ...water, state: 'aboard' }], resourceNodes: {},
  };
  const moved = World.movePlayer(state, { x: 6, y: 0 });
  const boat = moved.entities.find(entity => entity.id === 'boat-1');
  assert.ok(moved.player.x > state.player.x);
  assert.deepEqual({ x: boat.x, y: boat.y }, { x: moved.player.x, y: moved.player.y });
});

test('browser transport adapter and CommonJS shared engine execute every command fixture identically', () => {
  const source = fs.readFileSync(path.join(webRoot, 'js/transport-ui.js'), 'utf8');
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'transport-ui.js' });
  const browser = sandbox.SurvivalTransportUI.engine;
  const common = require('../apps/SurvivalDiaryShared/src/transport-engine.js');
  const fixture = {
    player: { x: 0, y: 0, mode: 'walking' },
    entities: [{ id: 'boat-1', type: 'rowboat', x: 1, y: 0 }],
    inventory: {}, processedWorldCommands: {},
    terrainAt: () => ({ waterDepth: .8, walkable: false }),
  };
  const normalize = result => JSON.parse(JSON.stringify(result));
  assert.deepEqual(normalize(browser.boardBoat(fixture, 'boat-1', 'parity')), normalize(common.boardBoat(fixture, 'boat-1', 'parity')));
  const leave = {
    ...fixture,
    player: { x: 1, y: 0, mode: 'aboard', vehicleId: 'boat-1' },
    entities: [{ id: 'boat-1', type: 'rowboat', x: 1, y: 0, state: 'aboard' }],
    terrainAt: (x, y) => ({ waterDepth: x === 0 && y === 0 ? .2 : .8, walkable: x === 0 && y === 0 }),
  };
  assert.deepEqual(normalize(browser.leaveBoat(leave, 'boat-1', 'leave')), normalize(common.leaveBoat(leave, 'boat-1', 'leave')));
  const bridge = {
    player: { x: 0, y: 0 }, entities: [], inventory: { 'rope-bridge': 1 }, processedWorldCommands: {},
    terrainAt: (x) => ({ waterDepth: x > 0 && x < 4 ? .8 : 0, walkable: !(x > 0 && x < 4) }),
  };
  const span = { cells: [0, 1, 2, 3, 4].map(x => ({ x, y: 0 })) };
  assert.deepEqual(normalize(browser.placeBridge(bridge, span, 'bridge')), normalize(common.placeBridge(bridge, span, 'bridge')));
  const rail = { player: {}, entities: [], inventory: { 'rail-segment': 1 }, processedWorldCommands: {}, terrainAt: () => ({ waterDepth: 0, walkable: true }) };
  assert.deepEqual(normalize(browser.placeRail(rail, { x: 2, y: 3 }, 'rail')), normalize(common.placeRail(rail, { x: 2, y: 3 }, 'rail')));
  const cart = {
    player: {}, inventory: {}, processedWorldCommands: {},
    entities: [{ id: 'r1', type: 'rail-segment', x: 2, y: 3 }, { id: 'r2', type: 'rail-segment', x: 3, y: 3 }, { id: 'cart', type: 'minecart', x: 2, y: 3 }],
  };
  const route = { minecartId: 'cart', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }] };
  assert.deepEqual(normalize(browser.moveMinecart(cart, route, 'cart')), normalize(common.moveMinecart(cart, route, 'cart')));
  assert.deepEqual(normalize(browser.boardBoat(fixture, 'boat-1', 42)), normalize(common.boardBoat(fixture, 'boat-1', 42)));
});

test('Web shell loads and caches transport before world/game and routes the existing action through it', () => {
  const uiIndex = html.indexOf('js/transport-ui.js');
  const worldIndex = html.indexOf('js/world.js');
  const gameIndex = html.indexOf('js/game.js');
  assert.ok(uiIndex >= 0 && uiIndex < worldIndex && worldIndex < gameIndex);
  assert.match(sw, /survival-diary-shell-v83/);
  assert.match(sw, /.\/js\/transport-ui\.js/);
  assert.match(game, /const TransportUI = window\.SurvivalTransportUI/);
  assert.match(game, /TransportUI(?:\?\.)?contextAction/);
  assert.match(game, /World\.performTransportCommand/);
  assert.match(game, /transportBootstrapVersion:\s*savedWorld\.transportBootstrapVersion/);
});

test('ImageGen transport visuals select connected rails and loaded carts', () => {
  const rails = [
    { id: 'center', type: 'rail-segment', x: 96, y: 96 },
    { id: 'east', type: 'rail-segment', x: 144, y: 96 },
    { id: 'north', type: 'rail-segment', x: 96, y: 48 },
  ];
  assert.equal(GameHelpers.railTextureSelection(rails[0], rails).key, 'rail-curve-v7');
  assert.equal(GameHelpers.railTextureSelection(rails[1], rails).key, 'rail-straight-ew-v7');
  assert.equal(GameHelpers.minecartTextureKey({ type: 'minecart', state: { storage: {} } }), 'minecart-empty-v7');
  assert.equal(GameHelpers.minecartTextureKey({ type: 'minecart', state: { storage: { 'iron-ore': 2 } } }), 'minecart-ore-v7');
  assert.deepEqual(GameHelpers.transportVisualMetrics({ type: 'rail-segment' }), { width: 56, height: 56, centered: true });
  assert.deepEqual(GameHelpers.transportVisualMetrics({ type: 'minecart' }), { width: 46, height: 30, centered: true });
  const crossing = [
    { id: 'c', type: 'rail-segment', x: 96, y: 96 },
    { id: 'e', type: 'rail-segment', x: 144, y: 96 }, { id: 'w', type: 'rail-segment', x: 48, y: 96 },
    { id: 'n', type: 'rail-segment', x: 96, y: 48 }, { id: 's', type: 'rail-segment', x: 96, y: 144 },
  ];
  assert.equal(GameHelpers.railTextureSelection(crossing[0], crossing).key, 'rail-crossing-v7');
  const roads = [{ type: 'road-segment', x: 96, y: 96 }, { type: 'road-segment', x: 144, y: 96 }, { type: 'road-segment', x: 96, y: 144 }];
  assert.equal(GameHelpers.roadTextureSelection(roads[0], roads).key, 'road-curve-v7');
  const roadCrossing = [
    { id: 'road-center', type: 'road-segment', x: 96, y: 96 },
    { type: 'road-segment', x: 144, y: 96 }, { type: 'road-segment', x: 48, y: 96 },
    { type: 'road-segment', x: 96, y: 48 }, { type: 'road-segment', x: 96, y: 144 },
  ];
  assert.equal(GameHelpers.roadTextureSelection(roadCrossing[0], roadCrossing).key, 'road-crossing-v7');
  assert.match(game, /roadCrossingImages\.forEach/);
  const formal = path.join(webRoot, 'assets/game/transport-v7');
  for (const name of ['road-straight-ew', 'road-straight-ns', 'road-curve-es', 'road-junction-t', 'rail-straight-ew', 'rail-straight-ns', 'rail-curve-ne', 'rail-junction-t', 'rail-crossing', 'rail-terminal', 'minecart-empty', 'minecart-ore']) {
    const png = fs.readFileSync(path.join(formal, `${name}.png`));
    assert.equal(png.readUInt32BE(16), 256, `${name} width`);
    assert.equal(png.readUInt32BE(20), 256, `${name} height`);
    assert.ok(fs.statSync(path.join(formal, `${name}.webp`)).size > 1024, `${name} WebP`);
  }
  assert.ok(fs.statSync(path.join(webRoot, 'assets/game/fog-v8/unknown-island-fog.webp')).size > 50000);
  assert.ok(fs.statSync(path.join(webRoot, 'assets/game/fog-v8/unknown-island-fog@0.5x.webp')).size > 15000);
  assert.ok(fs.statSync(path.join(webRoot, 'assets/game/fog-v9/fog-bank-edge-v9.webp')).size > 50000);
  assert.ok(fs.statSync(path.join(webRoot, 'assets/game/fog-v9/fog-bank-edge-v9@0.5x.webp')).size > 15000);
});

test('one-tap road placement extends an existing road before creating an isolated segment', () => {
  const state = {
    player: { x: 96, y: 96, direction: 2 },
    entities: [{ id: 'road-east-2', type: 'road-segment', x: 192, y: 96 }],
  };
  assert.deepEqual(GameHelpers.roadPlacementPoints(state)[0], { x: 144, y: 96 });
  const empty = GameHelpers.roadPlacementPoints({ player: { x: 96, y: 96, direction: 2 }, entities: [] });
  assert.deepEqual(empty[0], { x: 144, y: 96 }, 'without an existing road, use the nearest facing tile');
});
