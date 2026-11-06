const assert = require('node:assert/strict');
const test = require('node:test');

const content = require('../website/survival-diary.zhengzhengstudio.cn/js/content.js');
const crafting = require('../website/survival-diary.zhengzhengstudio.cn/js/crafting.js');
const placement = require('../website/survival-diary.zhengzhengstudio.cn/js/placement.js');
const saveStore = require('../website/survival-diary.zhengzhengstudio.cn/js/save-store.js');
const world = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
const journal = require('../website/survival-diary.zhengzhengstudio.cn/js/journal.js');
const environment = require('../website/survival-diary.zhengzhengstudio.cn/js/environment.js');

function isolatedWorld(seed) {
  const state = world.createWorldView(seed);
  state.entities = [];
  state.resourceNodes = {};
  state.villagers = {};
  state.nextEntityId = 1;
  return state;
}

function buildablePoint(state, type, rotation = 0) {
  for (let y = 96; y <= 640; y += 24) {
    for (let x = 96; x <= 640; x += 24) {
      if (placement.previewPlacement(state, type, { x, y }, rotation).valid) return { x, y };
    }
  }
  throw new Error(`No buildable point found for ${type}`);
}

function createFakeTimer() {
  let nextId = 1;
  let now = 0;
  const pending = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, at: now + delay, delay });
      return id;
    },
    clearTimer(id) { pending.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      const ready = [...pending.entries()].filter(([, timer]) => timer.at <= now).sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of ready) {
        if (!pending.delete(id)) continue;
        timer.callback();
      }
    },
    delays() { return [...pending.values()].map(timer => timer.delay); },
    size() { return pending.size; },
  };
}

test('old saves gain journal and entity fields without losing inventory or coordinates', () => {
  const old = { player: { x: 17, y: 29 }, inventory: { fiber: 7 } };
  const migrated = journal.migrateSave(old);

  assert.deepEqual(migrated.player, old.player);
  assert.equal(migrated.inventory.fiber, 7);
  assert.deepEqual(migrated.entities, []);
  assert.deepEqual(migrated.journalEntries, []);
  assert.equal(migrated.saveSchemaVersion, 2);
});

test('automatic journal facts describe events without inventing feelings', () => {
  const baseState = journal.migrateSave({ inventory: {}, player: { x: 0, y: 0 } });
  const next = journal.recordFact(baseState, { type: 'placed', day: 1, minute: 720, subject: 'campfire' });

  assert.match(next.journalEntries[0].facts[0].text, /放置了篝火/);
  assert.doesNotMatch(next.journalEntries[0].facts[0].text, /开心|害怕|孤独/);
});

test('resource facts merge on a day while ordered build facts and authored text remain intact', () => {
  const authored = journal.migrateSave({
    journalEntries: [{ day: 1, title: '第一天', body: '我在海边搭好营地。', facts: [], updatedAt: '2026-07-28T00:00:00.000Z' }],
  });
  const gatheredOnce = journal.recordFact(authored, { type: 'gathered', day: 1, minute: 500, subject: 'fiber', count: 1, regionKey: '0,0' });
  const gatheredTwice = journal.recordFact(gatheredOnce, { type: 'gathered', day: 1, minute: 520, subject: 'fiber', count: 2, regionKey: '0,0' });
  const built = journal.recordFact(gatheredTwice, { type: 'placed', day: 1, minute: 540, subject: 'campfire', regionKey: '0,0' });

  assert.equal(built.journalEntries[0].title, '第一天');
  assert.equal(built.journalEntries[0].body, '我在海边搭好营地。');
  assert.equal(built.journalEntries[0].facts.length, 2);
  assert.equal(built.journalEntries[0].facts[0].count, 3);
  assert.match(built.journalEntries[0].facts[0].text, /采集了 3 份纤维/);
  assert.match(built.journalEntries[0].facts[1].text, /放置了篝火/);
});

test('save migration is idempotent and deep clones nested save records', () => {
  const raw = {
    inventory: { fiber: 4 },
    player: { x: 12, y: 24 },
    entities: [{ id: 'entity-1', state: { storage: { fiber: 1 } } }],
    journalEntries: [{ day: 2, title: '第二天', body: '保留原文', facts: [], updatedAt: 'saved' }],
    discoveries: [{ day: 2, subject: 'tide-ruins' }],
    gameClock: { day: 2, minute: 610 },
  };
  const migrated = journal.migrateSave(raw);
  const twice = journal.migrateSave(migrated);
  migrated.entities[0].state.storage.fiber = 9;

  assert.deepEqual(twice.inventory, { fiber: 4 });
  assert.equal(twice.entities[0].state.storage.fiber, 1);
  assert.equal(twice.journalEntries[0].body, '保留原文');
  assert.equal(twice.gameClock.minute, 610);
  assert.deepEqual(twice, journal.migrateSave(twice));
});

test('successful craft results map to a factual crafted journal event', () => {
  const event = journal.factEventForAction(
    { type: 'craft', recipeId: 'rope' },
    { ok: true, crafted: { id: 'rope', count: 1 } },
    { day: 3, minute: 615 },
  );

  assert.deepEqual(event, { type: 'crafted', day: 3, minute: 615, subject: 'rope', count: 1 });
});

test('successful dismantle results map to the removed entity and region', () => {
  const event = journal.factEventForAction(
    { type: 'dismantle', entityId: 'entity-7' },
    { ok: true, entity: { id: 'entity-7', type: 'campfire', regionKey: '2,-1' } },
    { day: 4, minute: 700 },
  );

  assert.deepEqual(event, { type: 'dismantled', day: 4, minute: 700, subject: 'campfire', regionKey: '2,-1' });
});

test('building interactions write concrete journal facts instead of generic use text', () => {
  const cases = [
    ['campfire-lit', 'campfire', '点燃了篝火'],
    ['slept-until-dawn', 'shelter', '在避难棚休息到清晨'],
    ['fresh-water-collected', 'rainCollector', '从集雨器收集了 2 份淡水'],
  ];
  for (const [eventType, subject, expectedText] of cases) {
    const result = {
      ok: true,
      entity: { type: subject, regionKey: '0,0' },
      event: { type: eventType, amount: 2 },
    };
    const event = journal.factEventForAction(
      { type: 'useEntity', entityId: 'entity-1' },
      result,
      { day: 1, minute: 540 },
    );
    const recorded = journal.recordFact(journal.migrateSave({}), event);
    assert.equal(recorded.journalEntries[0].facts[0].text, expectedText);
    assert.doesNotMatch(recorded.journalEntries[0].facts[0].text, /使用了/);
  }
});

test('journal draft debounce writes the latest title and body once after 250ms and flushes immediately', () => {
  const timer = createFakeTimer();
  const writes = [];
  const drafts = journal.createDraftController({
    commit: patch => writes.push(patch),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  drafts.queue({ title: '海边', body: '第一版' });
  drafts.queue({ title: '海边营地', body: '第二版' });
  timer.advance(249);
  assert.deepEqual(writes, []);
  timer.advance(1);
  assert.deepEqual(writes, [{ title: '海边营地', body: '第二版' }]);

  drafts.queue({ title: '夜里的海边', body: '最新正文' });
  assert.equal(timer.size(), 1);
  drafts.flush();
  assert.deepEqual(writes[1], { title: '夜里的海边', body: '最新正文' });
  assert.equal(timer.size(), 0);
  timer.advance(250);
  assert.equal(writes.length, 2);
});

test('successful mutations execute state then fact then render then save while failures stop', () => {
  const order = [];
  const success = journal.commitActionMutation(
    { type: 'craft', recipeId: 'rope' },
    { ok: true, state: { gameClock: { day: 2, minute: 540 } }, crafted: { id: 'rope', count: 1 } },
    {
      setState(next) { order.push('state'); assert.equal(next.gameClock.day, 2); },
      recordFact(next, event) { order.push('fact'); return { ...next, recorded: event.subject }; },
      render(next) { order.push('render'); assert.equal(next.recorded, 'rope'); },
      save(next) { order.push('save'); assert.equal(next.recorded, 'rope'); },
    },
  );

  assert.deepEqual(order, ['state', 'fact', 'render', 'save']);
  assert.equal(success.state.recorded, 'rope');

  order.length = 0;
  const failed = { ok: false, state: { untouched: true } };
  assert.strictEqual(journal.commitActionMutation({ type: 'craft' }, failed, {
    setState() { order.push('state'); },
    recordFact() { order.push('fact'); },
    render() { order.push('render'); },
    save() { order.push('save'); },
  }), failed);
  assert.deepEqual(order, []);
});

test('storage failure enters error state and retries exactly after 3000ms before clearing error', () => {
  const timer = createFakeTimer();
  const statuses = [];
  let attempts = 0;
  const saver = saveStore.createRetryingSaver({
    save() {
      attempts += 1;
      if (attempts === 1) throw new Error('quota');
      return true;
    },
    onStatus: status => statuses.push(status),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  assert.equal(saver.save('main', { inventory: { fiber: 1 } }), false);
  assert.deepEqual(statuses, ['error']);
  assert.deepEqual(timer.delays(), [3000]);
  timer.advance(2999);
  assert.equal(attempts, 1);
  timer.advance(1);
  assert.equal(attempts, 2);
  assert.deepEqual(statuses, ['error', '']);
  assert.equal(timer.size(), 0);
});

test('web content exposes a connected early-game tool and survival progression', () => {
  assert.ok(Object.keys(content.ITEMS).length >= 16);
  assert.ok(Object.keys(content.RECIPES).length >= 16);
  assert.ok(Object.keys(content.PLACEABLES).length >= 24);

  for (const recipe of Object.values(content.RECIPES)) {
    for (const id of Object.keys(recipe.input)) assert.ok(content.ITEMS[id]);
    assert.ok(content.ITEMS[recipe.output.id] || content.PLACEABLES[recipe.output.id]);
  }
});

test('crafting is atomic and reports exact missing material counts', () => {
  const poor = { driftwood: 1, 'palm-fiber': 1 };
  const failed = crafting.craft(poor, 'rope', { station: 'hand' });

  assert.equal(failed.ok, false);
  assert.deepEqual(failed.inventory, poor);
  assert.deepEqual(failed.missing, [{ id: 'palm-fiber', count: 3 }]);
});

test('placed storage crate persists deposits and withdrawals with a finite slot capacity', () => {
  const base = isolatedWorld('storage-transfer');
  base.inventory.storageCrate = 1;
  base.inventory['palm-fiber'] = 9;
  const point = buildablePoint(base, 'storageCrate');
  const placementResult = placement.confirmPlacement(
    base,
    placement.previewPlacement(base, 'storageCrate', point, 0),
  );
  assert.equal(placementResult.ok, true);
  const placed = placementResult.state;
  const crateId = placementResult.entity.id;

  const deposited = placement.transferToStorage(placed, crateId, 'palm-fiber', 6);
  assert.equal(deposited.ok, true);
  assert.equal(deposited.state.inventory['palm-fiber'], 3);
  assert.equal(deposited.entity.state.storage['palm-fiber'], 6);
  assert.equal(deposited.entity.state.storageCapacity, 24);

  const withdrawn = placement.transferFromStorage(deposited.state, crateId, 'palm-fiber', 2);
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.state.inventory['palm-fiber'], 5);
  assert.equal(withdrawn.entity.state.storage['palm-fiber'], 4);
});

test('web rope recipe uses the same palm-fibre id produced by resource nodes', () => {
  assert.deepEqual(content.RECIPES.rope.input, { 'palm-fiber': 4 });
  const crafted = crafting.craft({ 'palm-fiber': 4 }, 'rope', { station: 'hand' });
  assert.equal(crafted.ok, true);
  assert.equal(crafted.inventory.rope, 1);
});

test('web backpack capacity stacks by crafted quantity and tools expose real durability', () => {
  assert.equal(content.inventoryCapacity({}), 18);
  assert.equal(content.inventoryCapacity({ 'small-backpack': 1 }), 28);
  assert.equal(content.inventoryCapacity({ 'small-backpack': 2 }), 38);
  assert.equal(content.inventoryCapacity({ 'small-backpack': 1, 'frame-backpack': 1 }), 50);
  assert.equal(content.TOOL_DURABILITY['stone-machete'], 55);
  assert.equal(content.TOOL_DURABILITY.machete, 180);
  const worn = world.wearTool({ inventory: { 'stone-machete': 1 }, toolDurability: { 'stone-machete': 2 } }, 'stone-machete', 1);
  assert.equal(worn.toolDurability['stone-machete'], 1);
  const broken = world.wearTool(worn, 'stone-machete', 1);
  assert.equal(broken.inventory['stone-machete'] || 0, 0);
});

test('crafting removes all inputs and adds the recipe output without changing its input', () => {
  const inventory = { branch: 2, stone: 2, rope: 1, leaf: 4 };
  const crafted = crafting.craft(inventory, 'stoneAxe', { station: 'hand' });

  assert.deepEqual(crafted, {
    ok: true,
    inventory: { branch: 0, stone: 0, rope: 0, leaf: 4, 'stone-axe': 1 },
    crafted: { id: 'stone-axe', count: 1 }
  });
  assert.deepEqual(inventory, { branch: 2, stone: 2, rope: 1, leaf: 4 });
});

test('new web worlds start with raw essentials rather than free finished tools and rope', () => {
  const state = world.createWorldView('honest-start');
  assert.equal(state.inventory.rope || 0, 0);
  assert.equal(state.inventory['stone-axe'] || 0, 0);
  assert.equal(state.inventory['palm-fiber'] || 0, 0);
  assert.equal(state.inventory['taro-seed'], 1);
  assert.equal('fiber' in state.inventory, false);
  const starterItems = new Set(Object.values(state.resourceNodes).map(node => node.itemId));
  for (const itemId of ['branch', 'stone', 'palm-fiber', 'fresh-water', 'coconut']) assert.ok(starterItems.has(itemId));
});

test('crafting rejects a recipe at the wrong station without consuming materials', () => {
  const inventory = { rawFish: 1, branch: 1 };
  const crafted = crafting.craft(inventory, 'cookedFish', { station: 'hand' });

  assert.equal(crafted.ok, false);
  assert.equal(crafted.reason, 'station');
  assert.deepEqual(crafted.inventory, inventory);
});

test('crafting reports an unknown recipe without changing inventory', () => {
  const inventory = { fiber: 3 };
  const crafted = crafting.craft(inventory, 'unknown', { station: 'hand' });

  assert.deepEqual(crafted, { ok: false, inventory, reason: 'recipe' });
});

test('crafting rejects inherited recipe keys without throwing or changing inventory', () => {
  for (const recipeId of ['toString', 'constructor']) {
    const inventory = { fiber: 3 };
    const crafted = crafting.craft(inventory, recipeId, { station: 'hand' });

    assert.deepEqual(crafted, { ok: false, inventory, reason: 'recipe' });
    assert.notStrictEqual(crafted.inventory, inventory);
  }
});

test('valid placement consumes one token and creates a persistent entity', () => {
  const state = isolatedWorld('placement');
  state.inventory.campfire = 1;
  const preview = placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0);
  assert.equal(preview.valid, true);

  const result = placement.confirmPlacement(state, preview);
  assert.equal(result.ok, true);
  assert.equal(result.state.inventory.campfire, 0);
  assert.equal(result.entity.type, 'campfire');
});

test('overlap is rejected without consuming inventory', () => {
  const base = isolatedWorld('collision');
  base.inventory.campfire = 1;
  const point = buildablePoint(base, 'campfire');
  const placed = placement.confirmPlacement(
    base,
    placement.previewPlacement(base, 'campfire', point, 0)
  ).state;
  placed.inventory.storageCrate = 1;

  const preview = placement.previewPlacement(placed, 'storageCrate', point, 0);
  assert.equal(preview.valid, false);
  assert.equal(preview.reason, '这里已有建筑');
  assert.equal(placed.inventory.storageCrate, 1);
});

test('placement rotation normalizes and swaps an entity footprint at ninety degrees', () => {
  const state = isolatedWorld('rotation');
  state.inventory.palisade = 1;
  const point = buildablePoint(state, 'palisade', -270);
  const preview = placement.previewPlacement(state, 'palisade', point, -270);

  assert.equal(preview.rotation, 90);
  assert.ok(preview.bounds.width > preview.bounds.height);
  assert.equal(placement.rotatePlacement(preview).rotation, 180);
});

test('placement rounds an arbitrary rotation to the nearest right angle and exposes its source', () => {
  const state = isolatedWorld('rotation-rounding');
  state.inventory.palisade = 1;

  const point = buildablePoint(state, 'palisade', 45);
  const preview = placement.previewPlacement(state, 'palisade', point, 45);
  assert.equal(preview.valid, true);
  assert.equal(preview.rotation, 90);
  assert.equal(preview.normalizedFrom, 45);
});

test('placement rejects a footprint whose corner reaches locally unbuildable terrain', () => {
  const state = isolatedWorld('footprint-terrain');
  state.inventory.campfire = 1;
  const point = buildablePoint(state, 'campfire');
  const originalPredicate = world.isBuildableTerrain;
  let checks = 0;
  world.isBuildableTerrain = () => (++checks < 2);
  try {
    const preview = placement.previewPlacement(state, 'campfire', point, 0);
    assert.equal(preview.valid, false);
    assert.equal(preview.reason, '这里的地形无法建造');
    assert.ok(checks >= 2);
  } finally {
    world.isBuildableTerrain = originalPredicate;
  }
});

test('placement rejects null, undefined and non-finite points without throwing', () => {
  const state = world.createWorldView('invalid-points');
  state.inventory.campfire = 1;

  for (const point of [undefined, null, { x: Infinity, y: 200 }, { x: 320, y: NaN }]) {
    assert.doesNotThrow(() => placement.previewPlacement(state, 'campfire', point, 0));
    assert.deepEqual(placement.previewPlacement(state, 'campfire', point, 0), {
      valid: false,
      reason: '这里的地形无法建造',
    });
  }
});

test('placement rejects a footprint whose center reaches locally unbuildable terrain', () => {
  const state = world.createWorldView('center-terrain');
  state.inventory.campfire = 1;
  const originalPredicate = world.isBuildableTerrain;
  const checkedPoints = [];
  world.isBuildableTerrain = (_, point) => {
    checkedPoints.push(point);
    return point.x !== 320 || point.y !== 200;
  };

  try {
    const preview = placement.previewPlacement(state, 'campfire', { x: 320, y: 200 }, 0);
    assert.equal(preview.valid, false);
    assert.equal(preview.reason, '这里的地形无法建造');
    assert.ok(checkedPoints.some(point => point.x === 320 && point.y === 200));
  } finally {
    world.isBuildableTerrain = originalPredicate;
  }
});

test('placed entities keep a deterministic persistence shape and region owner', () => {
  const state = isolatedWorld('persistence');
  state.inventory.workbench = 1;
  const point = buildablePoint(state, 'workbench');
  const result = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'workbench', point, 0)
  );

  assert.deepEqual(result.entity, {
    id: 'entity-1',
    type: 'workbench',
    x: point.x,
    y: point.y,
    rotation: 0,
    regionKey: `${Math.floor(point.x / world.REGION_WIDTH)},${Math.floor(point.y / world.REGION_HEIGHT)}`,
    durability: content.PLACEABLES.workbench.durability,
    createdDay: 1,
    state: {}
  });
  assert.equal(result.state.nextEntityId, 2);
});

test('dismantling a placed entity returns its token and removes only that entity', () => {
  const state = isolatedWorld('dismantle');
  state.inventory.campfire = 1;
  state.inventory.stone = 0;
  state.inventory.branch = 0;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;

  const result = placement.dismantleEntity(placed, 'entity-1');
  assert.equal(result.ok, true);
  assert.equal(result.state.inventory.campfire, 0);
  assert.equal(result.state.inventory.stone, 2);
  assert.equal(result.state.inventory.branch, 2);
  assert.deepEqual(result.state.entities, []);
});

test('dismantling rejects an entity whose state storage still has materials', () => {
  const state = isolatedWorld('storage-protection');
  state.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const protectedState = {
    ...placed,
    entities: [{ ...placed.entities[0], state: { storage: { fiber: 1 } } }],
  };

  const result = placement.dismantleEntity(protectedState, 'entity-1');
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, protectedState);
  assert.equal(result.reason, '建筑中仍有物资');
});

test('dismantling rejects an entity whose state inventory still has materials', () => {
  const state = isolatedWorld('inventory-protection');
  state.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const protectedState = {
    ...placed,
    entities: [{ ...placed.entities[0], state: { inventory: { stone: 1 } } }],
  };

  const result = placement.dismantleEntity(protectedState, 'entity-1');
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, protectedState);
  assert.equal(result.reason, '建筑中仍有物资');
});

test('dismantling rejects an entity that is active without changing state', () => {
  const state = isolatedWorld('active-protection');
  state.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const activeState = {
    ...placed,
    entities: [{ ...placed.entities[0], state: { active: true } }],
  };

  const result = placement.dismantleEntity(activeState, 'entity-1');
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, activeState);
  assert.equal(result.reason, '建筑正在使用中');
});

test('dismantling rejects an entity that is lit without changing state', () => {
  const state = isolatedWorld('lit-protection');
  state.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const protectedState = {
    ...placed,
    entities: [{ ...placed.entities[0], state: { lit: true } }],
  };

  const result = placement.dismantleEntity(protectedState, 'entity-1');
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, protectedState);
  assert.equal(result.reason, '建筑正在使用中');
});

test('dismantling rejects an entity that is using without changing state', () => {
  const state = isolatedWorld('using-protection');
  state.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const protectedState = {
    ...placed,
    entities: [{ ...placed.entities[0], state: { using: true } }],
  };

  const result = placement.dismantleEntity(protectedState, 'entity-1');
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, protectedState);
  assert.equal(result.reason, '建筑正在使用中');
});

test('world exposes stable entity sprite keys and y-sorted render entities', () => {
  const state = world.createWorldView('entity-rendering');
  state.entities = [
    { id: 'entity-2', type: 'shelter', y: 180 },
    { id: 'entity-3', type: 'campfire', y: 140 },
    { id: 'entity-1', type: 'workbench', y: 180 },
  ];

  assert.equal(world.entitySpriteKey(state.entities[1]), 'campfire');
  assert.deepEqual(world.entitiesForRender(state).map(entity => entity.id), ['entity-3', 'entity-1', 'entity-2']);
});

test('a confirmed entity remains renderable in stable order after a JSON save round trip', () => {
  const state = isolatedWorld('json-round-trip');
  state.inventory.campfire = 1;
  const confirmed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;
  const restored = JSON.parse(JSON.stringify(confirmed));

  assert.deepEqual(world.entitiesForRender(restored), [confirmed.entities[0]]);
});

test('lighting a campfire consumes fuel and changes the world instead of recording a shallow use label', () => {
  const state = isolatedWorld('entity-use');
  state.inventory.campfire = 1;
  state.inventory.driftwood = 1;
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'campfire', buildablePoint(state, 'campfire'), 0)
  ).state;

  const used = placement.useEntity(placed, 'entity-1', 'light');
  assert.equal(used.ok, true);
  assert.equal(used.state.entities[0].lit, true);
  assert.ok(used.state.entities[0].fuel > 0);
  assert.equal(used.state.inventory.driftwood, 0);
  assert.equal(used.event.type, 'campfire-lit');
  assert.equal(used.effect.kind, 'warmth-and-cooking');
});

test('using a shelter advances to dawn and applies real survival costs and recovery', () => {
  const state = isolatedWorld('shelter-use');
  state.inventory.shelter = 1;
  state.gameClock = { day: 2, minute: 1_200 };
  state.vitals = { health: 60, energy: 30, food: 70, water: 65 };
  const point = buildablePoint(state, 'shelter');
  const placed = placement.confirmPlacement(
    state,
    placement.previewPlacement(state, 'shelter', point, 0)
  ).state;

  const used = placement.useEntity(placed, 'entity-1', 'sleep');
  assert.equal(used.ok, true);
  assert.deepEqual(used.state.gameClock, { day: 3, minute: 360 });
  assert.ok(used.state.vitals.energy > placed.vitals.energy);
  assert.ok(used.state.vitals.health > placed.vitals.health);
  assert.ok(used.state.vitals.food < placed.vitals.food);
  assert.ok(used.state.vitals.water < placed.vitals.water);
  assert.equal(used.event.type, 'slept-until-dawn');
});

test('rain collector and workbench expose typed gameplay effects', () => {
  const waterState = isolatedWorld('collector-use');
  waterState.inventory.rainCollector = 1;
  let placed = placement.confirmPlacement(
    waterState,
    placement.previewPlacement(waterState, 'rainCollector', buildablePoint(waterState, 'rainCollector'), 0)
  ).state;
  placed.entities[0].state.water = 40;
  const collected = placement.useEntity(placed, 'entity-1', 'collect');
  assert.equal(collected.ok, true);
  assert.equal(collected.state.inventory['fresh-water'], 2);
  assert.equal(collected.state.entities[0].state.water, 0);
  assert.equal(collected.event.type, 'fresh-water-collected');

  const benchState = isolatedWorld('workbench-use');
  benchState.inventory.workbench = 1;
  const benchPlaced = placement.confirmPlacement(
    benchState,
    placement.previewPlacement(benchState, 'workbench', buildablePoint(benchState, 'workbench'), 0)
  ).state;
  const opened = placement.useEntity(benchPlaced, 'entity-1', 'use');
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.effect, { kind: 'open-crafting', station: 'workbench' });
  assert.equal(opened.event.type, 'crafting-opened');
});

test('well-fed and hydrated survivors recover health and stamina while depleted survivors do not', () => {
  const healthy = world.createWorldView('recovery-thresholds');
  healthy.vitals = { health: 60, energy: 35, food: 86, water: 78 };
  const recovered = environment.advanceEnvironment(healthy, 60, { activity: 'idle' });

  assert.ok(recovered.vitals.health > healthy.vitals.health);
  assert.ok(recovered.vitals.energy > healthy.vitals.energy);
  assert.equal(recovered.recoveryState.health, 'recovering');

  const depleted = world.createWorldView('recovery-blocked');
  depleted.vitals = { health: 60, energy: 35, food: 24, water: 18 };
  const blocked = environment.advanceEnvironment(depleted, 60, { activity: 'idle' });
  assert.equal(blocked.vitals.health, depleted.vitals.health);
  assert.ok(blocked.vitals.energy < recovered.vitals.energy);
  assert.ok(blocked.recoveryState.blockers.includes('needs-food'));
  assert.ok(blocked.recoveryState.blockers.includes('needs-water'));
});

test('adjacent generated regions share a walkable land seam instead of trapping the player', () => {
  const state = world.createWorldView('continuous-land');
  state.player = { ...state.player, x: world.REGION_WIDTH - 12, y: world.REGION_HEIGHT / 2 };
  const target = { x: world.REGION_WIDTH + 32, y: world.REGION_HEIGHT / 2 };

  assert.equal(world.isWalkableTerrain(state, { x: world.REGION_WIDTH, y: world.REGION_HEIGHT / 2 }), true);
  let moving = world.setPlayerTarget(state, target);
  for (let index = 0; index < 20 && moving.moveTarget; index += 1) moving = world.stepPlayer(moving, 0.1);
  assert.ok(moving.player.x > world.REGION_WIDTH);
  assert.equal(moving.moveTarget, null);
});

test('resource presentation has real scale tiers and a ground anchor for depth sorting', () => {
  const tree = world.resourceRenderMetrics({ resourceId: 'softwood-tree', itemId: 'softwood-log', x: 10, y: 20 });
  const ore = world.resourceRenderMetrics({ resourceId: 'iron-vein', itemId: 'iron-ore', x: 10, y: 20 });
  const shell = world.resourceRenderMetrics({ resourceId: 'shell-bed', itemId: 'shell', x: 10, y: 20 });

  assert.ok(tree.width > ore.width);
  assert.ok(ore.width > shell.width);
  assert.ok(tree.height > tree.width);
  assert.equal(tree.groundY, 20);
});

test('resources buildings and the player share one y-sorted depth queue', () => {
  const state = world.createWorldView('depth-queue');
  state.villagers = {};
  state.player = { ...state.player, y: 150 };
  state.entities = [{ id: 'hut', type: 'shelter', x: 200, y: 210 }];
  state.resourceNodes = {
    palm: { id: 'palm', resourceId: 'coconut-palm', itemId: 'coconut', x: 180, y: 90, remaining: 1 },
  };

  assert.deepEqual(world.sceneObjectsForRender(state).map(item => item.kind), ['resource', 'player', 'entity', 'foreground']);
});

test('touch input tolerates finger jitter while mouse drags remain responsive', () => {
  assert.equal(world.pointerGestureIntent({ pointerType: 'touch', distance: 7, pointers: 1 }), 'tap');
  assert.equal(world.pointerGestureIntent({ pointerType: 'touch', distance: 13, pointers: 1 }), 'pan');
  assert.equal(world.pointerGestureIntent({ pointerType: 'mouse', distance: 4, pointers: 1 }), 'pan');
  assert.equal(world.pointerGestureIntent({ pointerType: 'touch', distance: 3, pointers: 2 }), 'pinch');
});

test('local save falls back to the previous valid snapshot when the newest snapshot is corrupt', () => {
  const values = new Map();
  const original = global.localStorage;
  global.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  try {
    assert.equal(saveStore.saveLocal('main', { seed: 'first', inventory: { stone: 3 } }), true);
    assert.equal(saveStore.saveLocal('main', { seed: 'second', inventory: { stone: 9 } }), true);
    values.set('survival-diary-save-v2:main', '{broken');
    const restored = saveStore.loadLocal('main');
    assert.equal(restored.world.seed, 'first');
    assert.equal(restored.world.inventory.stone, 3);
  } finally {
    global.localStorage = original;
  }
});
