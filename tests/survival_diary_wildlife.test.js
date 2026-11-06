const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

const shared = require(path.join(root, 'apps/SurvivalDiaryShared/src/wildlife-simulation.js'));
const serverBundle = require(path.join(root, 'website/survival-diary.zhengzhengstudio.cn/server/lib/wildlife-simulation.js'));
const browserBundle = require(path.join(root, 'website/survival-diary.zhengzhengstudio.cn/js/vendor/survival-wildlife.js'));

// ---------------------------------------------------------------- 测试夹具
const SAMPLE_WIDTH = 17;

function makeRegion(id, coordinate, biome, height) {
  const heights = [];
  const biomes = [];
  for (let index = 0; index < SAMPLE_WIDTH * SAMPLE_WIDTH; index += 1) {
    heights.push(height);
    biomes.push(biome);
  }
  const blocked = [];
  const reachable = [];
  for (let index = 0; index < 16 * 16; index += 1) {
    blocked.push(false);
    reachable.push(true);
  }
  return { id, coordinate, height: heights, biome: biomes, blocked, reachable };
}

function makeWorld(biome = 'cloud-forest', height = 1) {
  const regions = { '0,0': makeRegion('0,0', { x: 0, y: 0 }, biome, height) };
  return { seed: 'island-seed-1', regions, discoveredChunks: { '0,0': { visibility: 'discovered' } } };
}

const FAR_PLAYER = { x: 900, y: 900 };
// 云林物种（野兔/野猪/果蝠）都是夜行性：activityWindows = dawn/dusk/night
const NIGHT = 'night';
const DAY = 'day';

function spawnState(api = shared, world = makeWorld()) {
  return api.createWildlifeState({
    seed: world.seed,
    regions: world.regions,
    discoveredChunks: world.discoveredChunks,
    playerPosition: FAR_PLAYER,
  });
}

function speciesOf(state, speciesId) {
  return Object.values(state.animals).filter(animal => animal.speciesId === speciesId);
}

// ---------------------------------------------------------------- 三份产物一致
test('共享包 / 服务端包 / 浏览器包 三份产物行为完全一致', () => {
  const world = makeWorld();
  const states = [shared, serverBundle, browserBundle].map(api => spawnState(api, world));
  assert.deepEqual(states[1], states[0], '服务端包与共享包不一致');
  assert.deepEqual(states[2], states[0], '浏览器包与共享包不一致');

  // 连续推进 5 分钟，状态与事件都必须一致
  const stepped = states.map((state, index) => {
    const api = [shared, serverBundle, browserBundle][index];
    const result = api.stepWildlife(state, {
      player: { id: 'p1', position: { x: 8, y: 8 } },
      activeRadius: 32,
      phase: NIGHT,
      weather: { kind: 'clear' },
    }, 5);
    assert.equal(result.ok, true);
    return result;
  });
  assert.deepEqual(stepped[1].state, stepped[0].state, '服务端包推进结果不一致');
  assert.deepEqual(stepped[2].state, stepped[0].state, '浏览器包推进结果不一致');
  assert.deepEqual(stepped[1].events, stepped[0].events, '服务端包事件不一致');
  assert.deepEqual(stepped[2].events, stepped[0].events, '浏览器包事件不一致');
});

test('浏览器包的事件 ID 与 Node crypto 的 SHA-256 一致', () => {
  const payload = { type: 'wildlife-killed', subjectId: 'a:1:2', gameMinute: 12.5, payload: { b: 1, a: [2, 3] } };
  const event = browserBundle.createWildlifeEvent(
    payload.type, payload.subjectId, payload.gameMinute, payload.payload,
  );
  const expected = crypto
    .createHash('sha256')
    .update(JSON.stringify({ gameMinute: payload.gameMinute, payload: { a: [2, 3], b: 1 }, subjectId: payload.subjectId, type: payload.type }))
    .digest('hex');
  assert.equal(event.id, expected, '浏览器包的 SHA-256 与 Node 不一致');
});

// ---------------------------------------------------------------- 规则
test('动物只在合法栖息地生成', () => {
  const state = spawnState(shared, makeWorld('cloud-forest', 1));
  assert.ok(speciesOf(state, 'wild-rabbit').length > 0, '云林应生成野兔');
  assert.ok(speciesOf(state, 'wild-boar').length > 0, '云林应生成野猪');
  assert.equal(speciesOf(state, 'seabird').length, 0, '云林不该生成海鸟（栖息地是潟湖/遗迹）');
  assert.equal(speciesOf(state, 'reef-fish').length, 0, '陆地不该生成礁鱼');
  assert.equal(speciesOf(state, 'reef-shark').length, 0, '陆地不该生成小型鲨鱼');
});

test('动物出生点不会落在玩家正前方（REVEAL_RADIUS 内）', () => {
  const world = makeWorld();
  const state = shared.createWildlifeState({
    seed: world.seed,
    regions: world.regions,
    discoveredChunks: world.discoveredChunks,
    playerPosition: { x: 8, y: 8 },
  });
  for (const animal of Object.values(state.animals)) {
    const distance = Math.hypot(animal.position.x - 8, animal.position.y - 8);
    assert.ok(distance >= 10, `${animal.id} 离玩家太近（${distance.toFixed(2)}）`);
  }
});

test('靠近玩家时普通动物逃跑，反击型动物先威吓再反击', () => {
  const world = makeWorld();
  const base = spawnState(shared, world);
  const rabbit = speciesOf(base, 'wild-rabbit')[0];
  const boar = speciesOf(base, 'wild-boar')[0];
  assert.ok(rabbit && boar, '夹具里应当同时有野兔和野猪');

  // 第一步：进入感知半径
  const first = shared.stepWildlife(base, {
    player: { id: 'p1', position: { x: rabbit.position.x + 1, y: rabbit.position.y } },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 1);
  const rabbitAfter = first.state.animals[rabbit.id];
  const boarAfter = first.state.animals[boar.id];
  assert.equal(rabbitAfter.state, 'flee', '野兔应逃跑');
  assert.equal(boarAfter.state, 'threaten', '野猪应先威吓');
  assert.ok(
    first.events.some(event => event.type === 'wildlife-flee' && event.animalId === rabbit.id),
    '应发出 wildlife-flee 事件',
  );
  assert.ok(
    first.events.some(event => event.type === 'wildlife-warning' && event.animalId === boar.id),
    '应发出 wildlife-warning 事件',
  );

  // 第二步：威吓期满（3 分钟预警窗）→ 反击
  const second = shared.stepWildlife(first.state, {
    player: { id: 'p1', position: { x: rabbit.position.x + 1, y: rabbit.position.y } },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 3);
  assert.equal(second.state.animals[boar.id].state, 'retaliate', '野猪应转入反击');
  assert.ok(
    second.events.some(event => event.type === 'wildlife-retaliation' && event.animalId === boar.id),
    '应发出 wildlife-retaliation 事件',
  );
});

test('预警窗内不会立刻反击，玩家能看到「它要反击了」', () => {
  const world = makeWorld();
  const base = spawnState(shared, world);
  const boar = speciesOf(base, 'wild-boar')[0];
  assert.ok(boar, '夹具里应有野猪');
  const player = { x: boar.position.x + 1, y: boar.position.y };

  const first = shared.stepWildlife(base, {
    player: { id: 'p1', position: player },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 1);
  assert.equal(first.state.animals[boar.id].state, 'threaten', '第一拍只威吓');
  assert.ok(
    first.events.some(event => event.type === 'wildlife-warning' && event.animalId === boar.id),
    '第一拍应发出 wildlife-warning',
  );

  // 预警窗内再推进 1 分钟（绝对分钟 2 < 3），仍应是威吓
  const mid = shared.stepWildlife(first.state, {
    player: { id: 'p1', position: player },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 1);
  assert.equal(mid.state.animals[boar.id].state, 'threaten', '预警窗内不应反击');
});

test('昼夜相位会改变动物状态：白天夜行性动物休息', () => {
  const world = makeWorld();
  const base = spawnState(shared, world);
  const rabbit = speciesOf(base, 'wild-rabbit')[0];
  assert.ok(rabbit, '夹具里应有野兔');
  const player = { x: rabbit.position.x + 1, y: rabbit.position.y };

  const day = shared.stepWildlife(base, {
    player: { id: 'p1', position: player },
    activeRadius: 32,
    phase: DAY,
    weather: { kind: 'clear' },
  }, 1);
  assert.equal(day.state.animals[rabbit.id].state, 'resting', '白天野兔应休息');

  const night = shared.stepWildlife(base, {
    player: { id: 'p1', position: player },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 1);
  assert.equal(night.state.animals[rabbit.id].state, 'flee', '夜里野兔应逃跑');
});

test('动物会真的移动，不是固定不动的资源节点', () => {
  const world = makeWorld();
  const base = spawnState(shared, world);
  const before = Object.values(base.animals).map(animal => ({ ...animal.position }));
  const result = shared.stepWildlife(base, {
    player: { id: 'p1', position: FAR_PLAYER },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 3);
  const after = Object.values(result.state.animals).map(animal => ({ ...animal.position }));
  assert.equal(after.length, before.length, '动物数量不应变化');
  const moved = after.filter((position, index) => (
    Math.abs(position.x - before[index].x) > 1e-6 || Math.abs(position.y - before[index].y) > 1e-6
  ));
  assert.ok(moved.length > 0, '推进分钟后至少应有一只动物移动过');
});

test('动物不会跑出自己所在区块', () => {
  const world = makeWorld();
  let state = spawnState(shared, world);
  for (let step = 0; step < 12; step += 1) {
    const result = shared.stepWildlife(state, {
      player: { id: 'p1', position: FAR_PLAYER },
      activeRadius: 32,
      phase: NIGHT,
      weather: { kind: 'clear' },
    }, 10);
    state = result.state;
  }
  for (const animal of Object.values(state.animals)) {
    assert.ok(animal.position.x >= 0 && animal.position.x < 16, `${animal.id} 越出区块 x=${animal.position.x}`);
    assert.ok(animal.position.y >= 0 && animal.position.y < 16, `${animal.id} 越出区块 y=${animal.position.y}`);
  }
});

test('移动是确定性的：同样的输入走到同样的位置', () => {
  const world = makeWorld();
  const run = () => {
    let state = spawnState(shared, world);
    for (let step = 0; step < 5; step += 1) {
      state = shared.stepWildlife(state, {
        player: { id: 'p1', position: FAR_PLAYER },
        activeRadius: 32,
        phase: NIGHT,
        weather: { kind: 'clear' },
      }, 4).state;
    }
    return state;
  };
  assert.deepEqual(run(), run(), '两次相同推进应得到完全相同的状态');
});

test('重复动作不会重复结算（幂等）', () => {
  const world = makeWorld();
  const state = spawnState(shared, world);
  const rabbit = speciesOf(state, 'wild-rabbit')[0];
  const action = { type: 'damage', animalId: rabbit.id, amount: 5, id: 'act-1' };

  const first = shared.applyWildlifeAction(state, action, { player: { id: 'p1', position: rabbit.position } });
  assert.equal(first.ok, true);
  assert.equal(first.state.animals[rabbit.id].health, rabbit.health - 5);

  const second = shared.applyWildlifeAction(first.state, action, { player: { id: 'p1', position: rabbit.position } });
  assert.equal(second.ok, true);
  assert.equal(second.state.animals[rabbit.id].health, rabbit.health - 5, '重复动作不应再扣血');
  assert.equal(second.details.duplicate, true);
});

test('击倒动物会降低种群并累积捕猎压力', () => {
  const world = makeWorld();
  const state = spawnState(shared, world);
  const rabbit = speciesOf(state, 'wild-rabbit')[0];
  const key = `${rabbit.regionId}:${rabbit.speciesId}`;
  const adultsBefore = state.populations[key].adults;

  const killed = shared.applyWildlifeAction(state, {
    type: 'damage', animalId: rabbit.id, amount: 999, id: 'kill-1',
  }, { player: { id: 'p1', position: rabbit.position } });
  assert.equal(killed.ok, true);
  assert.equal(killed.state.animals[rabbit.id], undefined, '被击倒的动物应从存档移除');
  assert.equal(killed.state.populations[key].adults, adultsBefore - 1, '种群成年数应减少');
  assert.equal(killed.state.populations[key].huntingPressure, 1, '捕猎压力应增加');
  assert.ok(killed.events.some(event => event.type === 'wildlife-killed'), '应发出 wildlife-killed 事件');
});

test('喂食建立信任，连续三次后驯养', () => {
  const world = makeWorld();
  const state = spawnState(shared, world);
  const goat = speciesOf(state, 'mountain-goat')[0] || speciesOf(state, 'wild-rabbit')[0];
  if (!goat) return; // 该栖息地里没有可驯养动物时跳过
  const habitat = require(path.join(root, 'apps/SurvivalDiaryShared/content/habitats.json'))
    .find(entry => entry.animalId === goat.speciesId);
  const food = habitat.foodTags[0];
  const context = { player: { id: 'p1', position: goat.position }, safeCamp: true };

  let current = state;
  for (let feed = 0; feed < 3; feed += 1) {
    const result = shared.applyWildlifeAction(current, {
      type: 'feed', animalId: goat.id, itemId: food, id: `feed-${feed}`,
    }, context);
    assert.equal(result.ok, true, `第 ${feed + 1} 次喂食应成功`);
    current = result.state;
  }
  assert.equal(current.animals[goat.id].tamingProgress, 3);
  assert.equal(current.animals[goat.id].state, 'tame');
  assert.equal(current.animals[goat.id].tamedBy, 'p1');
});

test('不在安全营地不能喂食', () => {
  const world = makeWorld();
  const state = spawnState(shared, world);
  const goat = speciesOf(state, 'mountain-goat')[0] || speciesOf(state, 'wild-rabbit')[0];
  if (!goat) return;
  const habitat = require(path.join(root, 'apps/SurvivalDiaryShared/content/habitats.json'))
    .find(entry => entry.animalId === goat.speciesId);
  const result = shared.applyWildlifeAction(state, {
    type: 'feed', animalId: goat.id, itemId: habitat.foodTags[0], id: 'feed-unsafe',
  }, { player: { id: 'p1', position: goat.position }, safeCamp: false });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsafe-camp');
});

test('捕猎压力会衰减，种群在承载力内缓慢恢复', () => {
  const world = makeWorld();
  const state = spawnState(shared, world);
  const key = Object.keys(state.populations)[0];
  const pressured = {
    ...state,
    populations: {
      ...state.populations,
      [key]: { ...state.populations[key], adults: 1, huntingPressure: 2, lastUpdatedMinute: 0 },
    },
  };
  const result = shared.stepWildlife(pressured, {
    player: { id: 'p1', position: FAR_PLAYER },
    activeRadius: 32,
    phase: NIGHT,
    weather: { kind: 'clear' },
  }, 10_080);
  assert.equal(result.ok, true);
  const population = result.state.populations[key];
  assert.ok(population.huntingPressure < 2, '捕猎压力应随时间衰减');
  assert.ok(population.adults >= 1, '种群不应归零');
  assert.ok(population.adults <= population.capacity, '种群不应超过承载力');
});

test('旧存档（没有 wildlife 字段）不会影响其它字段', () => {
  const legacySave = {
    schemaVersion: 5,
    seed: 'island-seed-1',
    player: { x: 1, y: 2 },
    inventory: { 'coconut-water': 2 },
    gameClock: { day: 1, minute: 30 },
  };
  const migrated = shared.createWildlifeState({
    seed: legacySave.seed,
    regions: legacySave.regions || {},
    discoveredChunks: legacySave.discoveredChunks || {},
    existing: legacySave.wildlife,
    playerPosition: { x: 1, y: 2 },
  });
  assert.ok(migrated.animals && typeof migrated.animals === 'object');
  assert.ok(migrated.populations && typeof migrated.populations === 'object');
  assert.equal(migrated.elapsedMinutes, 0);
  // 原存档字段不受影响
  assert.equal(legacySave.player.x, 1);
  assert.equal(legacySave.inventory['coconut-water'], 2);
});
