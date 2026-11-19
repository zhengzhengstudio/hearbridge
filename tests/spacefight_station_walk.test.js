'use strict';

/**
 * 站内自由行走（3D 舱内探索）纯逻辑回归测试。
 * 验证摇杆移动、边界钳制、终端接近检测、开火边沿交互与防连触发。
 * 必须通过 npm run test:simulation 提供 SPACEFIGHT_COCOS_COMPILED_CORE。
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const compiledCoreRoot = process.env.SPACEFIGHT_COCOS_COMPILED_CORE;
assert.ok(compiledCoreRoot, 'Run this suite through npm run test:simulation');
const {
  StationWalkSystem,
  STATION_WALK_BOUNDS,
  STATION_WALK_START,
  STATION_WALK_TERMINALS,
  STATION_WALK_CORES,
} = require(path.join(compiledCoreRoot, 'StationWalkSystem.js'));

function command(overrides = {}) {
  return { throttle: 0, strafe: 0, primaryFire: false, boost: false, ...overrides };
}

test('起点在机库入口，落在可行走范围内', () => {
  const walk = new StationWalkSystem();
  const pos = walk.position();
  assert.deepEqual(pos, STATION_WALK_START);
  assert.ok(pos.x >= STATION_WALK_BOUNDS.minX && pos.x <= STATION_WALK_BOUNDS.maxX);
  assert.ok(pos.z >= STATION_WALK_BOUNDS.minZ && pos.z <= STATION_WALK_BOUNDS.maxZ);
});

test('throttle 向前推进使 z 减小，strafe 向右使 x 增大', () => {
  const walk = new StationWalkSystem();
  const start = walk.position();
  for (let i = 0; i < 10; i += 1) walk.step(command({ throttle: 1 }), 0.016);
  const forward = walk.position();
  assert.ok(forward.z < start.z - 0.5, `forward z should shrink: ${forward.z}`);

  walk.reset();
  for (let i = 0; i < 10; i += 1) walk.step(command({ strafe: 1 }), 0.016);
  const right = walk.position();
  assert.ok(right.x > start.x + 0.5, `strafe x should grow: ${right.x}`);
});

test('boost 明显加快移动', () => {
  const normal = new StationWalkSystem();
  const boosted = new StationWalkSystem();
  for (let i = 0; i < 10; i += 1) {
    normal.step(command({ throttle: 1 }), 0.016);
    boosted.step(command({ throttle: 1, boost: true }), 0.016);
  }
  assert.ok(boosted.position().z < normal.position().z - 0.3);
});

test('边界钳制：长时间朝一个方向不会穿墙', () => {
  const walk = new StationWalkSystem();
  for (let i = 0; i < 400; i += 1) walk.step(command({ throttle: 1, strafe: -1 }), 0.05);
  const pos = walk.position();
  assert.ok(pos.x >= STATION_WALK_BOUNDS.minX - 1e-6, `x ${pos.x}`);
  assert.ok(pos.z >= STATION_WALK_BOUNDS.minZ - 1e-6, `z ${pos.z}`);

  walk.reset();
  for (let i = 0; i < 400; i += 1) walk.step(command({ throttle: -1, strafe: 1 }), 0.05);
  const pos2 = walk.position();
  assert.ok(pos2.x <= STATION_WALK_BOUNDS.maxX + 1e-6, `x ${pos2.x}`);
  assert.ok(pos2.z <= STATION_WALK_BOUNDS.maxZ + 1e-6, `z ${pos2.z}`);
});

test('斜向移动不比直线快（归一化）', () => {
  const straight = new StationWalkSystem();
  const diagonal = new StationWalkSystem();
  for (let i = 0; i < 12; i += 1) {
    straight.step(command({ throttle: 1 }), 0.016);
    diagonal.step(command({ throttle: 1, strafe: 1 }), 0.016);
  }
  const straightDist = STATION_WALK_START.z - straight.position().z;
  const diagPos = diagonal.position();
  const diagDist = Math.hypot(diagPos.x - STATION_WALK_START.x, diagPos.z - STATION_WALK_START.z);
  assert.ok(Math.abs(diagDist - straightDist) < 0.05, `${diagDist} vs ${straightDist}`);
});

test('nearest 检测终端半径，出口起点即靠近 undock', () => {
  const walk = new StationWalkSystem();
  const near = walk.nearest();
  assert.ok(near, 'start should be near a terminal');
  assert.equal(near.id, 'undock');

  const terminal = STATION_WALK_TERMINALS.find((t) => t.id === 'contracts');
  const atTerminal = walk.nearest(terminal.x, terminal.z);
  assert.equal(atTerminal.id, 'contracts');

  const far = walk.nearest(0, 0);
  assert.equal(far, null, 'center should be outside all terminal radii');
});

test('开火上升沿在终端内触发一次交互，长按不重复', () => {
  const walk = new StationWalkSystem();
  // 起点就在 undock 半径内，按开火应触发离港交互。
  const first = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(first.interact, 'undock');
  const held = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(held.interact, null, 'holding fire must not re-trigger');
  // 松开再按：仍在闩锁内也不触发。
  walk.step(command({ primaryFire: false }), 0.016);
  const rePress = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(rePress.interact, null, 'interact lock should block quick re-press');
});

test('不在终端内按开火不触发交互', () => {
  const walk = new StationWalkSystem();
  // 走到中心（各终端半径外）。
  for (let i = 0; i < 40; i += 1) walk.step(command({ throttle: 1 }), 0.016);
  const mid = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(mid.near, null);
  assert.equal(mid.interact, null);
});

test('suspendInteraction 吃掉当前按键，面板关闭瞬间不误触', () => {
  const walk = new StationWalkSystem();
  walk.step(command({ primaryFire: true }), 0.016);
  walk.suspendInteraction();
  // 面板关闭时玩家仍按着开火：不应再触发。
  const after = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(after.interact, null);
});

test('reset 清除位置与按键闩锁，可立即再次交互', () => {
  const walk = new StationWalkSystem();
  walk.step(command({ throttle: 1 }), 0.016);
  walk.step(command({ primaryFire: true }), 0.05);
  walk.reset();
  assert.deepEqual(walk.position(), STATION_WALK_START);
  const fresh = walk.step(command({ primaryFire: true }), 0.016);
  assert.equal(fresh.interact, 'undock');
});

test('异常 deltaTime 不会造成 NaN 或瞬移', () => {
  const walk = new StationWalkSystem();
  const result = walk.step(command({ throttle: 1 }), Number.NaN);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.z));
  assert.deepEqual(walk.position(), STATION_WALK_START);
});

test('飞进核心半径自动收集，同一核心不重复计入', () => {
  const walk = new StationWalkSystem();
  const core = STATION_WALK_CORES[0];
  // 直接把化身开到核心位置附近：用足够小的推力逐步逼近。
  // 起点 (0,3.5)，核心0 在 (0,1.9)，向前飞即可经过。
  let picked = [];
  for (let i = 0; i < 60; i += 1) {
    const result = walk.step(command({ throttle: 1 }), 0.016);
    picked.push(...result.collected);
  }
  assert.ok(picked.includes(core.id), `core ${core.id} should be collected`);
  assert.equal(new Set(picked).size, picked.length, 'no duplicate pickup');
  assert.ok(walk.collectedCores().has(core.id));
});

test('集齐全部核心触发一次奖励，之后不再触发', () => {
  const walk = new StationWalkSystem();
  let bonusCount = 0;
  // 依次把化身挪到每个核心：通过直接 step 的公开移动无法瞬移，
  // 用 reset 后分段导航的方式验证拾取判定。
  for (const core of STATION_WALK_CORES) {
    // 用足够多的帧朝目标推进（x 用 strafe，z 用 throttle）。
    for (let guard = 0; guard < 400; guard += 1) {
      const pos = walk.position();
      const dx = core.x - pos.x;
      const dz = core.z - pos.z;
      if (Math.hypot(dx, dz) <= 0.35) break;
      const result = walk.step(command({
        strafe: Math.max(-1, Math.min(1, dx)),
        throttle: Math.max(-1, Math.min(1, -dz)),
      }), 0.02);
      if (result.bonus) bonusCount += 1;
    }
  }
  assert.equal(walk.coresRemaining(), 0, 'all cores collected');
  assert.equal(bonusCount, 1, 'bonus fires exactly once');
});

test('reset 重置核心收集，可重新玩', () => {
  const walk = new StationWalkSystem();
  for (const core of STATION_WALK_CORES) {
    for (let guard = 0; guard < 400; guard += 1) {
      const pos = walk.position();
      const dx = core.x - pos.x;
      const dz = core.z - pos.z;
      if (Math.hypot(dx, dz) <= 0.35) break;
      walk.step(command({ strafe: dx, throttle: -dz }), 0.02);
    }
  }
  assert.equal(walk.coresRemaining(), 0);
  walk.reset();
  assert.equal(walk.coresRemaining(), STATION_WALK_CORES.length);
  assert.equal(walk.collectedCores().size, 0);
});
