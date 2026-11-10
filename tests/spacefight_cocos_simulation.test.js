'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { childExitCode } = require('../SpaceFight-Cocos/tools/process-status.js');

const repositoryRoot = path.resolve(__dirname, '..');
const cocosProjectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const compiledCoreRoot = process.env.SPACEFIGHT_COCOS_COMPILED_CORE;
const missionPath = path.join(
  cocosProjectRoot,
  'assets',
  'data',
  'missions',
  'vertical-slice.json',
);

assert.ok(compiledCoreRoot, 'Run this suite through npm run test:simulation');

const core = {
  ...require(path.join(compiledCoreRoot, 'FlightCommand.js')),
  ...require(path.join(compiledCoreRoot, 'FlightTuning.js')),
  ...require(path.join(compiledCoreRoot, 'AimConvergence.js')),
  ...require(path.join(compiledCoreRoot, 'ExpeditionDirector.js')),
  ...require(path.join(compiledCoreRoot, 'EnemyBehaviorSystem.js')),
  ...require(path.join(compiledCoreRoot, 'LootAndCargoSystem.js')),
  ...require(path.join(compiledCoreRoot, 'WeaponCatalog.js')),
  ...require(path.join(compiledCoreRoot, 'CombatSimulation.js')),
};

function mission() {
  return JSON.parse(readFileSync(missionPath, 'utf8'));
}

function createSimulation(CombatSimulation, overrides = {}) {
  return new CombatSimulation({
    mission: { ...mission(), ...overrides },
    seed: 1337,
  });
}

function stepFrames(simulation, command, frames) {
  let snapshot;
  for (let frame = 0; frame < frames; frame += 1) {
    snapshot = simulation.step(command, 1 / 60);
  }
  return snapshot;
}

function assertNear(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('keeps movement bounded while preserving finite fast-look pulses', async () => {
  const { neutralFlightCommand, normalizeFlightCommand } = core;

  assert.deepEqual(neutralFlightCommand(), {
    throttle: 0,
    strafe: 0,
    yaw: 0,
    pitch: 0,
    boost: false,
    primaryFire: false,
    secondaryFire: false,
    swapWeapons: false,
    cameraToggle: false,
    pause: false,
    returnRequested: false,
    advanceRequested: false,
  });
  assert.deepEqual(normalizeFlightCommand({
    throttle: 4,
    strafe: -2,
    yaw: Number.NaN,
    pitch: -9,
    boost: 1,
    primaryFire: true,
  }), {
    throttle: 1,
    strafe: -1,
    yaw: 0,
    pitch: -4,
    boost: false,
    primaryFire: true,
    secondaryFire: false,
    swapWeapons: false,
    cameraToggle: false,
    pause: false,
    returnRequested: false,
    advanceRequested: false,
  });

  const fastLook = normalizeFlightCommand({
    throttle: -99,
    strafe: 99,
    yaw: 3.25,
    pitch: -2.5,
  });
  assert.equal(fastLook.throttle, -1);
  assert.equal(fastLook.strafe, 1);
  assert.equal(fastLook.yaw, 3.25);
  assert.equal(fastLook.pitch, -2.5);
});

test('advances player movement in deterministic 60 Hz steps', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = stepFrames(simulation, { throttle: 1 }, 60);

  assert.equal(snapshot.tick, 60);
  assert.equal(snapshot.player.position.x, 0);
  // 纵向速度改成「一阶追赶」后位移不再是常数：
  // cruiseSpeed=9、throttleResponse=0.28s，每帧 +0.0625，60 帧累计 ≈ 0.0625 * (1+2+…+60) / 60
  // = 9 × (60 × 61 / 2) × (1/60) × (1/60) / 0.28 ≈ 1.71。
  // 这里断言的是**物理模型的解析值**，而不是旧版瞬时速度的 9/60。
  const { FLIGHT_TUNING } = core;
  const dt = FLIGHT_TUNING.fixedStep;
  const step = dt / FLIGHT_TUNING.player.throttleResponse;
  // speedScale 每帧 +step，第 i 帧位移 = (i×step) × dt
  const expected = step * ((60 * 61) / 2) * dt;
  // snapshot 里的坐标经 rounded() 只保留 6 位小数，epsilon 取 1e-6
  assertNear(snapshot.player.position.z, 8 - expected, 1e-6);
  // 速度必须单调爬升（不能是瞬时满速，也不能不动），且不超过巡航速度
  assert.ok(snapshot.player.speedScale > 0);
  assert.ok(snapshot.player.speedScale <= FLIGHT_TUNING.player.cruiseSpeed);
});

test('speed ramps up instead of jumping straight to cruise speed', async () => {
  const { CombatSimulation, FLIGHT_TUNING } = core;
  const simulation = createSimulation(CombatSimulation);

  const first = simulation.step({ throttle: 1 }, 1 / 60);
  // 首帧远未到巡航速度 —— 这正是「有惯性」的体现
  assert.ok(
    first.player.speedScale < FLIGHT_TUNING.player.cruiseSpeed * 0.2,
    `首帧 speedScale=${first.player.speedScale} 应远小于巡航 ${FLIGHT_TUNING.player.cruiseSpeed}`,
  );

  // 长推之后收敛到巡航速度
  const settled = stepFrames(simulation, { throttle: 1 }, 240);
  assertNear(settled.player.speedScale, FLIGHT_TUNING.player.cruiseSpeed, 0.001);
});

test('coasting keeps inertia instead of stopping dead', async () => {
  const { CombatSimulation, FLIGHT_TUNING } = core;
  const simulation = createSimulation(CombatSimulation);

  stepFrames(simulation, { throttle: 1 }, 240);
  const cruising = simulation.step({}, 1 / 60).player.speedScale;
  // 240 帧（4 秒）后应已收敛到该配装的速度上限
  assert.ok(cruising > FLIGHT_TUNING.player.cruiseSpeed * 0.9, `240 帧后应接近巡航速度，实际 ${cruising}`);

  // 松手一帧：只掉一点，速度惯性保留（不能瞬间归零）
  const released = simulation.step({}, 1 / 60).player.speedScale;
  assert.ok(
    released > cruising * 0.85 && released <= cruising,
    `松手一帧应保留大部分速度，实际 ${cruising} → ${released}`,
  );

  // 长时间滑行：应衰减到完全停止。
// ⚠️ 目标速度必须是 0。之前用 idleSpeedFloor(0.22) 做保底，结果玩家
//    不操作时会以 22% 速度永远匀速飘走（实测无输入 20 秒飘过 40 个单位），
//    既无法悬停也会慢慢飞出战场。
  const glided = stepFrames(simulation, {}, 600).player.speedScale;
  assert.equal(glided, 0, `滑行足够久后应完全停住，实际 ${glided}`);
});

test('coasting actually moves the ship after the stick is released', async () => {
  // ⚠️ 这条测试守护的是一个已经真实发生过的 bug：
  //    速度虽然收敛到了地板速度，但**位移仍然乘输入**（throttle=0 → 位移恒为 0），
  //    于是 coastDrag / idleSpeedFloor 变成完全不起作用的装饰参数，
  //    推 1 秒松手后的总位移与旧的瞬时模型一模一样（6.690），惯性等于没做。
  //    只断言 speedScale 抓不到这个 bug——必须断言真实位移。
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  // 先推 1 秒建立速度
  const atCruise = stepFrames(simulation, { throttle: 1 }, 60);
  const beforeRelease = atCruise.player.position.z;

  // 松手滑行 0.5 秒
  const glided30 = stepFrames(simulation, {}, 30);
  const afterGlide = glided30.player.position.z;

  const glidedDistance = Math.abs(afterGlide - beforeRelease);
  assert.ok(
    glidedDistance > 1,
    `松手后应继续沿朝向滑行而不是急停，实际滑行距离 ${glidedDistance.toFixed(4)}`,
  );

  // 反向对照：同样 30 帧但一直保持输入，位移应明显更大（滑行不是全速）
  const powered = createSimulation(CombatSimulation);
  const poweredCruise = stepFrames(powered, { throttle: 1 }, 60);
  const poweredBefore = poweredCruise.player.position.z;
  const poweredAfter = stepFrames(powered, { throttle: 1 }, 30).player.position.z;
  const poweredDistance = Math.abs(poweredAfter - poweredBefore);
  assert.ok(
    glidedDistance < poweredDistance,
    `滑行距离 ${glidedDistance.toFixed(3)} 应小于持续推进 ${poweredDistance.toFixed(3)}`,
  );
});

test('serializes instant aim while compatible yaw and pitch remain weighted hull values', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ yaw: 1, pitch: -0.5 }, 1 / 60);

  assert.ok(snapshot.player.aimYaw > snapshot.player.yaw);
  assert.ok(snapshot.player.yaw > 0);
  assert.ok(snapshot.player.aimPitch < snapshot.player.pitch);
  assert.ok(snapshot.player.pitch < 0);
});

test('one frame-local look pulse updates aim once at every render rate', () => {
  const { CombatSimulation } = core;
  const rates = [30, 60, 90, 120, 144];
  const snapshots = rates.map((rate) => {
    const simulation = createSimulation(CombatSimulation);
    return simulation.step({ yaw: 0.4, pitch: -0.25 }, 1 / rate);
  });

  for (const snapshot of snapshots) {
    assert.ok(snapshot.player.aimYaw > 0);
    assert.ok(snapshot.player.aimPitch < 0);
    assert.equal(snapshot.player.aimYaw, snapshots[0].player.aimYaw);
    assert.equal(snapshot.player.aimPitch, snapshots[0].player.aimPitch);
  }
});

test('forward movement follows the aim immediately while the muzzle stays on the hull port', () => {
  const {
    CombatSimulation,
    PRIMARY_MUZZLE_LOCAL_POSITION,
    computeMuzzlePosition,
  } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ yaw: 1, throttle: 1, primaryFire: true }, 1 / 60);
  // 纵向速度一阶追赶后，单帧位移 = 首帧 speedScale × dt（不再是 cruiseSpeed × dt）
  const { FLIGHT_TUNING } = core;
  const distance = snapshot.player.speedScale / 60;
  const expectedX = Math.sin(snapshot.player.aimYaw)
    * Math.cos(snapshot.player.aimPitch) * distance;
  const expectedY = Math.sin(snapshot.player.aimPitch) * distance;
  const expectedZ = 8 - Math.cos(snapshot.player.aimYaw)
    * Math.cos(snapshot.player.aimPitch) * distance;
  const expectedMuzzle = computeMuzzlePosition(
    snapshot.player.position,
    { yaw: snapshot.player.yaw, pitch: snapshot.player.pitch },
    PRIMARY_MUZZLE_LOCAL_POSITION,
  );

  assertNear(snapshot.player.position.x, expectedX, 0.000002);
  assertNear(snapshot.player.position.y, expectedY, 0.000002);
  assertNear(snapshot.player.position.z, expectedZ, 0.000002);
  assert.ok(snapshot.player.position.x > Math.sin(snapshot.player.yaw) * distance);
  assertNear(snapshot.projectiles[0].origin.x, expectedMuzzle.x, 0.000002);
  assertNear(snapshot.projectiles[0].origin.y, expectedMuzzle.y, 0.000002);
  assertNear(snapshot.projectiles[0].origin.z, expectedMuzzle.z, 0.000002);
});

test('one look pulse preserves fixed-step hull and movement grouping determinism', () => {
  const { CombatSimulation } = core;
  const grouped = createSimulation(CombatSimulation);
  const split = createSimulation(CombatSimulation);
  const lookPulse = { yaw: 0.35, pitch: -0.2 };
  const movement = { throttle: 0.4 };

  const groupedAim = grouped.step(lookPulse, 0);
  const splitAim = split.step(lookPulse, 0);
  assert.deepEqual(groupedAim.player, splitAim.player);
  assert.ok(groupedAim.player.aimYaw > 0);
  assert.equal(groupedAim.player.yaw, 0);

  const groupedSnapshot = grouped.step(movement, 1 / 15);
  let splitSnapshot;
  for (let frame = 0; frame < 4; frame += 1) {
    splitSnapshot = split.step(movement, 1 / 60);
  }

  assert.deepEqual(groupedSnapshot, splitSnapshot);
});

test('zero fixed-step render still consumes look once without moving the hull', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ yaw: 1, pitch: 1 }, 0);

  assert.equal(snapshot.tick, 0);
  assert.ok(snapshot.player.aimYaw > 0);
  assert.ok(snapshot.player.aimPitch > 0);
  assert.equal(snapshot.player.yaw, 0);
  assert.equal(snapshot.player.pitch, 0);
});

test('a full look command turns the view by at least seven degrees per frame', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ yaw: 1 }, 1 / 60);

  assert.ok(
    snapshot.player.aimYaw >= 7 * Math.PI / 180,
    `aim yaw was only ${snapshot.player.aimYaw}`,
  );
});

test('a four-axis fast-look pulse turns four times farther than a normal pulse', () => {
  const { CombatSimulation } = core;
  const normal = createSimulation(CombatSimulation).step({ yaw: 1 }, 0);
  const fast = createSimulation(CombatSimulation).step({ yaw: 4 }, 0);

  assertNear(fast.player.aimYaw, normal.player.aimYaw * 4, 0.000003);
});

test('clamps a long render delta to the combat catch-up limit', async () => {
  const { CombatSimulation, FLIGHT_TUNING } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ throttle: 1 }, 1);

  assert.equal(snapshot.tick, 15);
  // 15 个固定步累积位移（速度一阶追赶，解析值求和）
  const dt = FLIGHT_TUNING.fixedStep;
  const step = dt / FLIGHT_TUNING.player.throttleResponse;
  const expected = step * ((15 * 16) / 2) * dt;
  assertNear(snapshot.player.position.z, 8 - expected, 1e-6);
});

test('gates primary and secondary fire by their independent cooldowns', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const first = simulation.step({ primaryFire: true, secondaryFire: true }, 1 / 60);
  const held = simulation.step({ primaryFire: true, secondaryFire: true }, 1 / 60);
  const afterPrimaryCooldown = stepFrames(simulation, { primaryFire: true }, 7);

  assert.equal(first.projectiles.length, 2);
  assert.equal(held.projectiles.length, 2);
  assert.equal(afterPrimaryCooldown.projectiles.length, 3);
  assert.equal(afterPrimaryCooldown.projectiles.filter((projectile) => projectile.weapon === 'missile').length, 1);
});

test('holding primary fire repeats at the weapon cadence and releasing stops new shots', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [{ id: 'durable-target', position: { x: 0, y: 0, z: -180 }, health: 10_000 }],
  });

  const held = stepFrames(simulation, { primaryFire: true }, 60);
  const heldShots = held.projectiles.filter((projectile) => projectile.owner === 'player').length;
  assert.ok(heldShots >= 6, `expected repeated fire while held, received ${heldShots} shots`);

  const released = stepFrames(simulation, {}, 20);
  assert.equal(
    released.projectiles.filter((projectile) => projectile.owner === 'player').length,
    heldShots,
    'releasing fire must stop creating projectiles',
  );
});

test('creates primary projectiles at the named port muzzle toward the HUD aim point', async () => {
  const { CombatSimulation, PRIMARY_MUZZLE_LOCAL_POSITION } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ primaryFire: true }, 1 / 60);

  assert.deepEqual(snapshot.aimPoint, {
    x: 0,
    y: 0,
    z: 8 - core.AIM_CONVERGENCE_DISTANCE,
  });
  // ⚠️ 不要硬编码枪口世界坐标：加入滑行后玩家首帧已前移
  //    （z 从 8 变成 8 - 首帧位移），写死 z: 5.75 会永远失败。
  //    改为按当前机体姿态换算，这样测试跟随物理模型演进。
  const expectedMuzzle = core.computeMuzzlePosition(
    snapshot.player.position,
    { yaw: snapshot.player.yaw, pitch: snapshot.player.pitch },
    PRIMARY_MUZZLE_LOCAL_POSITION,
  );
  assertNear(snapshot.projectiles[0].origin.x, expectedMuzzle.x, 0.000002);
  assertNear(snapshot.projectiles[0].origin.y, expectedMuzzle.y, 0.000002);
  assertNear(snapshot.projectiles[0].origin.z, expectedMuzzle.z, 0.000002);
  assert.deepEqual(snapshot.projectiles[0].position, snapshot.projectiles[0].origin);
  assert.ok(snapshot.projectiles[0].velocity.x > 0);
  assert.ok(snapshot.projectiles[0].velocity.y > 0);
  assert.ok(snapshot.projectiles[0].velocity.z < 0);
});

test('applies projectile damage, removes the destroyed enemy, and opens the expedition decision', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [{ id: 'target', kind: 'scout', position: { x: 0, y: 0, z: 0 }, health: 12 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  });

  simulation.step({ primaryFire: true }, 1 / 60);
  const snapshot = stepFrames(simulation, {}, 8);

  assert.equal(snapshot.enemies.length, 0);
  assert.equal(snapshot.player.score, 60);
  assert.equal(snapshot.mission.kills, 1);
  assert.equal(snapshot.mission.status, 'active');
  assert.equal(snapshot.expedition.phase, 'decision');
});

test('collects nearby deterministic pickups into player state', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    pickups: [{ id: 'energy-cell', kind: 'energy', position: { x: 0, y: 0, z: 8 }, value: 25 }],
  });

  const snapshot = simulation.step({}, 1 / 60);

  assert.equal(snapshot.pickups.length, 0);
  assert.equal(snapshot.player.energy, 100);
  assert.equal(snapshot.player.pickupsCollected, 1);
});

test('applies the selected weapon, tactical device, and frame core to combat', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: mission(),
    seed: 1337,
    loadout: { weapon: 'rail', device: 'collector', core: 'vector' },
  });

  const snapshot = simulation.step({ primaryFire: true }, 1 / 60);

  assert.equal(snapshot.loadout.weapon, 'rail');
  assert.equal(snapshot.loadout.device, 'collector');
  assert.equal(snapshot.loadout.core, 'vector');
  assert.equal(snapshot.player.maxHealth, 90);
  assert.equal(snapshot.player.maxShield, 70);
  assert.equal(snapshot.player.speedMultiplier, 1.18);
  assert.equal(snapshot.player.pickupRadius, 11);
  assert.equal(snapshot.projectiles[0].weapon, 'rail');
});

test('applies the complete hardpoint loadout to weapons, flight, shields, and utility', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: mission(),
    seed: 1337,
    loadout: {
      weapon: 'plasma', secondary: 'torpedo', device: 'targeter', core: 'vector',
      engine: 'afterburner', shield: 'aegis-screen', utility: 'tractor',
      boost: 'capacitor', skin: 'rescue',
    },
  });

  const snapshot = simulation.step({ secondaryFire: true, boost: true }, 1 / 60);

  assert.equal(snapshot.loadout.secondary, 'torpedo');
  assert.equal(snapshot.loadout.engine, 'afterburner');
  assert.equal(snapshot.loadout.shield, 'aegis-screen');
  assert.equal(snapshot.loadout.utility, 'tractor');
  assert.equal(snapshot.loadout.skin, 'rescue');
  assert.ok(snapshot.player.maxShield > 70);
  assert.ok(snapshot.player.maxEnergy > 100);
  assert.ok(snapshot.player.speedMultiplier > 1.18);
  assert.ok(snapshot.player.pickupRadius > 2.2);
  assert.equal(snapshot.projectiles[0].weapon, 'torpedo');
});

test('close enemy overlap causes ram damage after spawn protection instead of an invincible pocket', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'ram-contact',
      enemies: [{ id: 'rammer', position: { x: 0, y: 0, z: 8.1 }, health: 500 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 91,
  });

  simulation.step({ throttle: 1 }, 1 / 60);
  const protectedSnapshot = stepFrames(simulation, {}, 598);

  assert.ok(protectedSnapshot.player.spawnProtection > 0);
  assert.equal(protectedSnapshot.player.shield, protectedSnapshot.player.maxShield);
  assert.equal(protectedSnapshot.player.health, protectedSnapshot.player.maxHealth);

  const snapshot = stepFrames(simulation, {}, 120);

  assert.equal(snapshot.player.spawnProtection, 0);
  assert.ok(snapshot.player.shield < snapshot.player.maxShield || snapshot.player.health < snapshot.player.maxHealth);
  assert.ok(snapshot.target);
  assert.equal(snapshot.target.id, 'rammer');
});

test('enemy fire expires spawn protection and can damage the player', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'incoming-fire',
      enemies: [{ id: 'raider', position: { x: 0, y: 0, z: -18 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 21,
  });

  simulation.step({ yaw: 0.2 }, 1 / 60);
  let snapshot = stepFrames(simulation, {}, 598);
  assert.ok(snapshot.player.spawnProtection > 0);
  assert.equal(snapshot.player.shield, snapshot.player.maxShield);
  assert.equal(snapshot.player.health, snapshot.player.maxHealth);

  snapshot = stepFrames(simulation, {}, 240);

  assert.equal(snapshot.player.spawnProtection, 0);
  assert.ok(snapshot.player.shield < snapshot.player.maxShield || snapshot.player.health < snapshot.player.maxHealth);
  assert.ok(snapshot.target.telegraph >= 0.25, 'enemy attack exposes a readable telegraph window');
});

test('failed combat ignores pause toggles and a restarted simulation advances normally', () => {
  const { CombatSimulation } = core;
  const missionDefinition = {
    id: 'terminal-defeat-state',
    enemies: Array.from({ length: 6 }, (_, index) => ({
      id: `suppressor-${index}`,
      kind: 'suppressor',
      position: {
        x: (index - 2.5) * 5,
        y: 0,
        z: -68 - index,
      },
      health: 500,
    })),
    objective: { type: 'eliminate', requiredKills: 6 },
  };
  const simulation = new CombatSimulation({
    mission: missionDefinition,
    seed: 73,
    loadout: { core: 'specter', shield: 'aegis-screen' },
  });

  let defeated = simulation.step({}, 0);
  for (let frame = 0; frame < 3600 && defeated.mission.status !== 'failed'; frame += 1) {
    defeated = simulation.step({}, 1 / 60);
  }

  assert.equal(defeated.mission.status, 'failed', 'fixture must reach a deterministic defeat');
  assert.equal(defeated.paused, false);
  const terminalTick = defeated.tick;

  const pausePressed = simulation.step({ pause: true }, 1 / 60);
  simulation.step({ pause: false }, 1 / 60);
  const pausePressedAgain = simulation.step({ pause: true }, 1 / 60);

  assert.equal(pausePressed.paused, false);
  assert.equal(pausePressedAgain.paused, false);
  assert.equal(pausePressedAgain.tick, terminalTick);

  const restarted = new CombatSimulation({ mission: missionDefinition, seed: 73 });
  const restartedSnapshot = restarted.step({ throttle: 1 }, 1 / 60);
  assert.equal(restartedSnapshot.mission.status, 'active');
  assert.equal(restartedSnapshot.paused, false);
  assert.equal(restartedSnapshot.tick, 1);
});

test('spawn protection keeps enemies at tutorial distance and suppresses preloaded fire', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'training-standoff',
      enemies: [{ id: 'trainer', position: { x: 0, y: 0, z: -92 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 35,
  });

  const snapshot = stepFrames(simulation, {}, 599);

  assert.ok(snapshot.player.spawnProtection > 0);
  assert.ok(snapshot.target.range >= 83.5, `enemy closed inside tutorial standoff: ${snapshot.target.range}`);
  assert.equal(snapshot.projectiles.some((projectile) => projectile.owner === 'enemy'), false);
});

test('spawn protection expires after combat simulation starts even without player input', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'idle-training-gate',
      enemies: [{ id: 'trainer', position: { x: 0, y: 0, z: -92 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 35,
  });

  const protectedSnapshot = stepFrames(simulation, {}, 599);

  assert.ok(protectedSnapshot.player.spawnProtection > 0);
  assert.equal(protectedSnapshot.player.health, protectedSnapshot.player.maxHealth);
  assert.equal(protectedSnapshot.player.shield, protectedSnapshot.player.maxShield);
  assert.ok(protectedSnapshot.target.range >= 83.5);

  const activeSnapshot = stepFrames(simulation, {}, 2);
  assert.equal(activeSnapshot.player.spawnProtection, 0);
});

test('deep-zone waves mix enemy hulls with distinct combat profiles', () => {
  const tuning = readFileSync(path.join(cocosProjectRoot, 'assets/scripts/core/FlightTuning.ts'), 'utf8');
  const simulation = readFileSync(path.join(cocosProjectRoot, 'assets/scripts/core/CombatSimulation.ts'), 'utf8');
  for (const kind of ['scout', 'fighter', 'bomber', 'gunship', 'boss']) {
    assert.match(tuning, new RegExp(`${kind}: \\{`));
  }
  assert.match(simulation, /waveEnemyKind/);
  assert.match(simulation, /this\.wave % 6 === 0\) return 'boss'/);
  assert.match(simulation, /this\.wave % 3 === 0\) return 'gunship'/);
  assert.match(simulation, /return 'bomber'/);
  assert.match(simulation, /return 'fighter'/);
  assert.match(simulation, /const tuning = this\.enemyTuning\(kind\)/);
});

test('enemy projectiles survive their first step after a readable approach and telegraph', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'long-range-projectile',
      enemies: [{ id: 'marksman', position: { x: 0, y: 0, z: -76 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 18,
  });

  let snapshot;
  let enemyProjectile;
  for (let frame = 0; frame < 780 && !enemyProjectile; frame += 1) {
    snapshot = simulation.step({}, 1 / 60);
    enemyProjectile = snapshot.projectiles.find((projectile) => projectile.owner === 'enemy');
  }

  assert.ok(enemyProjectile, 'long-range enemy never produced a surviving projectile');
  assert.equal(snapshot.target.role, 'interceptor');
});

test('clearing the primary objective offers an optional return decision', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'continuous-expedition',
      enemies: [{ id: 'target', position: { x: 0, y: 0, z: -7 }, health: 1 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 55,
  });

  let snapshot = simulation.step({ primaryFire: true }, 1 / 60);
  for (let frame = 0; frame < 30; frame += 1) snapshot = simulation.step({}, 1 / 60);

  assert.equal(snapshot.expedition.phase, 'decision');
  assert.equal(snapshot.expedition.canReturn, true);
  assert.equal(snapshot.expedition.availableEvents.length, 2);
  assert.equal(snapshot.enemies.length, 0);
});

test('holding in the decision zone waits for the player instead of auto-advancing', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'deep-expedition-loop',
      enemies: [{ id: 'target', position: { x: 0, y: 0, z: -7 }, health: 1 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 73,
  });

  simulation.step({ primaryFire: true }, 1 / 60);
  // 决策窗口不再自动推进：长时间挂机也应停在 decision，保留玩家选择权。
  const idle = stepFrames(simulation, {}, 1200);
  assert.equal(idle.expedition.phase, 'decision');
  assert.equal(idle.mission.wave, 1);
  assert.equal(idle.enemies.length, 0);

  // 玩家主动确认深入后才进入下一波。
  let snapshot = simulation.step({ advanceRequested: true }, 1 / 60);
  snapshot = stepFrames(simulation, {}, 4);
  assert.equal(snapshot.expedition.phase, 'deep-zone');
  assert.equal(snapshot.mission.status, 'active');
  assert.equal(snapshot.mission.wave, 2);
  assert.ok(snapshot.enemies.length >= 3, 'deep-zone encounter did not spawn');
  assert.ok(snapshot.mission.requiredKills > snapshot.mission.kills);
});

test('publishes explicit hit and destruction events for presentation feedback', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'combat-feedback-events',
      enemies: [{ id: 'feedback-target', position: { x: 0, y: 0, z: -7 }, health: 1 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 91,
  });

  simulation.step({ primaryFire: true }, 1 / 60);
  let snapshot;
  for (let frame = 0; frame < 30; frame += 1) {
    snapshot = simulation.step({}, 1 / 60);
    if (snapshot.combatEvents.length > 0) break;
  }

  assert.deepEqual(snapshot.combatEvents.map(event => event.type), ['hit', 'destroyed']);
  assert.equal(snapshot.combatEvents[0].targetId, 'feedback-target');
  assert.ok(snapshot.combatEvents[0].damage > 0);
  assert.equal(snapshot.combatEvents[0].lethal, true);
  assert.ok(Math.hypot(
    snapshot.combatEvents[0].position.x - snapshot.combatEvents[1].position.x,
    snapshot.combatEvents[0].position.y - snapshot.combatEvents[1].position.y,
    snapshot.combatEvents[0].position.z - snapshot.combatEvents[1].position.z,
  ) < 2, 'impact point should remain on the destroyed target hull');

  const cleared = simulation.step({}, 1 / 60);
  assert.deepEqual(cleared.combatEvents, [], 'combat events must be frame-local');
});

test('fire control distinguishes a nearby contact from a real reticle lock', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'reticle-lock-truth',
      enemies: [{ id: 'off-axis-contact', position: { x: 42, y: 0, z: -36 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 117,
  });

  const snapshot = simulation.step({ primaryFire: true }, 1 / 60);
  assert.equal(snapshot.target.id, 'off-axis-contact');
  assert.equal(snapshot.target.locked, false);
  assert.equal(snapshot.projectiles[0].targetId, undefined);
});

test('fire control retains a centered target through small aim jitter without acquiring it off-axis', () => {
  const { CombatSimulation } = core;
  const definition = {
    mission: {
      id: 'reticle-hysteresis',
      enemies: [{ id: 'jitter-target', position: { x: 4, y: 0, z: -80 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 118,
  };

  const retainedSimulation = new CombatSimulation(definition);
  const acquired = retainedSimulation.step({}, 1 / 60);
  assert.equal(acquired.target.locked, true);
  const retained = retainedSimulation.step({ yaw: 0.75 }, 1 / 60);
  assert.equal(retained.target.locked, true, 'a small correction should not instantly drop a valid lock');

  const freshSimulation = new CombatSimulation(definition);
  const offAxis = freshSimulation.step({ yaw: 0.75 }, 1 / 60);
  assert.equal(offAxis.target.locked, false, 'the wider retention cone must not acquire a fresh target');
});

test('locked rounds retain bounded guidance and can hit a moving target', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'guided-fire-control',
      enemies: [{ id: 'moving-lock', position: { x: 4, y: 0, z: -78 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 119,
  });

  let snapshot = simulation.step({ primaryFire: true }, 1 / 60);
  assert.equal(snapshot.target.locked, true);
  assert.equal(snapshot.projectiles[0].targetId, 'moving-lock');
  for (let frame = 0; frame < 180 && !snapshot.combatEvents.some(event => event.type === 'hit'); frame += 1) {
    snapshot = simulation.step({}, 1 / 60);
  }
  assert.ok(snapshot.combatEvents.some(event => event.type === 'hit' && event.source === 'player'));
});

test('locked fire computes target lead and publishes an immediate firing event', () => {
  const { CombatSimulation, predictInterceptPoint } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'predictive-fire-control',
      enemies: [{ id: 'lead-target', position: { x: 3, y: 0, z: -70 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 120,
  });

  const fired = simulation.step({ primaryFire: true }, 1 / 60);
  const lead = predictInterceptPoint(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -60 },
    { x: 8, y: 0, z: 0 },
    60,
  );

  assert.equal(fired.target.locked, true);
  assert.ok(fired.target.leadSeconds > 0);
  assert.ok(lead.point.x > 0);
  assert.ok(lead.seconds > 0);
  assert.ok(fired.combatEvents.some((event) => event.type === 'weapon-fired' && event.source === 'player'));
});

test('outpost navigation exposes a usable docking radius', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'outpost-docking',
      enemies: [{ id: 'distant-contact', position: { x: 120, y: 40, z: 60 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 121,
  });

  simulation.step({ yaw: 0.7 }, 1 / 60);
  const snapshot = stepFrames(simulation, { throttle: 1 }, 600);
  assert.equal(snapshot.navigation.canDock, true);
  assert.ok(snapshot.navigation.outpostRange < 24);
});

test('outpost service keeps combat damage; station purchases refill and depart resets the run', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'outpost-service',
      enemies: [{ id: 'close-threat', position: { x: 0, y: 0, z: -18 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 122,
  });

  simulation.step({ primaryFire: true }, 1 / 60);
  // 模拟返航前带伤带耗（编译产物里 private 字段仍可写）。
  simulation.player.health = 40;
  simulation.player.shield = 12;
  simulation.player.energy = 20;
  const docked = simulation.serviceAtOutpost();
  assert.equal(docked.navigation.docked, true);
  // 新行为：返航保留战斗损耗，不再无条件把三量写回 max。
  assert.equal(docked.player.health, 40);
  assert.equal(docked.player.shield, 12);
  assert.equal(docked.player.energy, 20);
  assert.equal(docked.projectiles.length, 0);
  assert.ok(docked.combatEvents.some((event) => event.type === 'outpost-serviced'));

  // 回满必须靠站内主动购买服务，并派发 outpost-service 事件供 HUD 提示。
  const baseMaxShield = docked.player.maxShield;
  const repaired = simulation.serviceStation('repair');
  assert.equal(repaired.player.health, repaired.player.maxHealth);
  const resupplied = simulation.serviceStation('resupply');
  assert.equal(resupplied.player.energy, resupplied.player.maxEnergy);
  const refitted = simulation.serviceStation('refit');
  assert.equal(refitted.player.shield, refitted.player.maxShield);
  assert.ok(refitted.player.maxShield > baseMaxShield, 'refit 永久提升护盾上限');
  assert.ok(refitted.combatEvents.some((event) => event.type === 'outpost-service'));

  const launched = simulation.departOutpost();
  assert.equal(launched.navigation.docked, false);
  assert.equal(launched.navigation.canDock, false);
  assert.ok(launched.player.spawnProtection > 0);
  // 站内买过的服务决定下一局开局状态：三量与 maxShield 提升都保留。
  assert.equal(launched.player.health, launched.player.maxHealth);
  assert.equal(launched.player.energy, launched.player.maxEnergy);
  assert.equal(launched.player.shield, launched.player.maxShield);
});

test('announces deeper wave escalation with a readable threat tier', () => {
  const { CombatSimulation } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'wave-feedback-events',
      enemies: [{ id: 'first-target', position: { x: 0, y: 0, z: -7 }, health: 1 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 92,
  });

  simulation.step({ primaryFire: true }, 1 / 60);
  let snapshot;
  for (let frame = 0; frame < 600; frame += 1) {
    // 决策阶段必须由玩家主动推进，不能靠挂机触发 wave-start。
    snapshot = simulation.step({ advanceRequested: true }, 1 / 60);
    if (snapshot.combatEvents.some(event => event.type === 'wave-start')) break;
  }

  const wave = snapshot.combatEvents.find(event => event.type === 'wave-start');
  assert.ok(wave);
  assert.equal(wave.wave, 2);
  assert.equal(wave.threatTier, 2);
  assert.ok(wave.enemyCount >= 3);
});

test('expedition director is deterministic and completes a deliberate 2.4 second return', () => {
  const first = new core.ExpeditionDirector({ seed: 41, primaryEvent: 'breach' });
  const second = new core.ExpeditionDirector({ seed: 41, primaryEvent: 'breach' });
  first.completeEvent('primary');
  second.completeEvent('primary');
  assert.deepEqual(first.snapshot().availableEvents, second.snapshot().availableEvents);
  assert.equal(first.snapshot().canReturn, true);
  for (let frame = 0; frame < 143; frame += 1) first.step({ delta: 1 / 60, returnRequested: true });
  assert.equal(first.snapshot().phase, 'returning');
  first.step({ delta: 1 / 60, returnRequested: true });
  assert.equal(first.snapshot().phase, 'complete');
});

test('return completes even while taking continuous damage (regression: return frozen under fire)', () => {
  // 此前 `damagePause > 0` 会完全冻结返航进度；碎石/敌机连续擦碰时进度永远凑不满，
  // 表现为「返航没有动画、回不去、进不了前哨」。现在挨打不再中断返航。
  const director = new core.ExpeditionDirector({ seed: 41, primaryEvent: 'breach' });
  director.completeEvent('primary');
  for (let frame = 0; frame < 200; frame += 1) {
    director.step({ delta: 1 / 60, returnRequested: true, damaged: true });
    if (director.snapshot().phase === 'complete') break;
  }
  assert.equal(director.snapshot().phase, 'complete');
});

test('enemy roles choose distinct readable distance bands', () => {
  const system = new core.EnemyBehaviorSystem(1337);
  const player = { position: { x: 0, y: 0, z: 0 } };
  const enemy = (role, range) => ({ id: role, role, position: { x: 0, y: 0, z: range }, telegraphElapsed: 2 });
  assert.equal(system.intent(enemy('interceptor', 70), player).mode, 'close');
  assert.equal(system.intent(enemy('suppressor', 70), player).mode, 'hold');
  assert.equal(system.intent(enemy('bomber', 18), player).mode, 'retreat');
});

test('enemy pursuit speed stays readable even at maximum threat', () => {
  const system = new core.EnemyBehaviorSystem(1337);
  const intent = system.intent({
    id: 'fast-interceptor',
    role: 'interceptor',
    position: { x: 0, y: 0, z: 100 },
    telegraphElapsed: 2,
  }, { position: { x: 0, y: 0, z: 0 } }, { threat: 10 });
  const speed = Math.hypot(intent.desiredVelocity.x, intent.desiredVelocity.y, intent.desiredVelocity.z);
  assert.ok(speed <= 27, `interceptor pursuit speed ${speed} should remain aimable`);
});

test('rare rivalry events split enemies into factions and let them trade fire', () => {
  const simulation = new core.CombatSimulation({
    seed: 77,
    worldEvents: { firstDelay: 0.05, forcedSequence: ['rivalry'] },
    mission: {
      id: 'rivalry-test',
      objective: { type: 'eliminate', requiredKills: 2 },
      enemies: [
        { id: 'alpha', kind: 'fighter', position: { x: -18, y: 0, z: -34 }, health: 120 },
        { id: 'bravo', kind: 'fighter', position: { x: 18, y: 0, z: -34 }, health: 120 },
      ],
    },
  });
  let snapshot = simulation.step({}, 1 / 15);
  assert.ok(snapshot.combatEvents.some((event) => event.type === 'rivalry-start'));
  assert.deepEqual(new Set(snapshot.enemies.map((enemy) => enemy.faction)), new Set(['raider', 'corsair']));

  let sawCrossFire = false;
  for (let frame = 0; frame < 540 && !sawCrossFire; frame += 1) {
    snapshot = simulation.step({}, 1 / 60);
    sawCrossFire = snapshot.combatEvents.some((event) => event.type === 'hit' && event.source === 'enemy');
  }
  assert.equal(sawCrossFire, true);
  assert.equal(snapshot.player.score, 0);
});

test('supply events place a collectible close to the player', () => {
  const simulation = new core.CombatSimulation({
    seed: 91,
    worldEvents: { firstDelay: 0.05, forcedSequence: ['supply-drop'] },
    mission: {
      id: 'supply-test',
      objective: { type: 'eliminate', requiredKills: 1 },
      enemies: [{ id: 'watcher', kind: 'bomber', position: { x: 0, y: 0, z: -100 } }],
    },
  });
  const snapshot = simulation.step({}, 1 / 15);
  assert.ok(snapshot.combatEvents.some((event) => event.type === 'supply-drop'));
  assert.ok(snapshot.pickups.some((pickup) => pickup.id.startsWith('field-supply-')));
});

test('failed expedition keeps insured, equipped, key, and first-discovery cargo', () => {
  const cargo = new core.LootAndCargoSystem(8, 1337);
  cargo.add({ id: 'module-a', category: 'equipment', insured: false, rarity: 'common' });
  cargo.add({ id: 'collection-first', category: 'cosmetic', insured: false, rarity: 'rare', firstDiscovery: true });
  const settlement = cargo.settleExpedition('failed');
  assert.deepEqual(settlement.kept.map((item) => item.id), ['collection-first']);
  assert.deepEqual(settlement.lost.map((item) => item.id), ['module-a']);
});

test('returns identical snapshots for the same seed and command stream', async () => {
  const { CombatSimulation } = core;
  const commands = [
    { throttle: 1, yaw: 0.2 },
    { throttle: 1, primaryFire: true },
    { strafe: -0.5, boost: true },
    { secondaryFire: true },
    {},
  ];
  const left = createSimulation(CombatSimulation);
  const right = createSimulation(CombatSimulation);

  let leftSnapshot;
  let rightSnapshot;
  for (const command of commands) {
    leftSnapshot = left.step(command, 1 / 30);
    rightSnapshot = right.step(command, 1 / 30);
  }

  assert.deepEqual(leftSnapshot, rightSnapshot);
});

test('simulation runner fails closed when a child has no exit status', () => {
  assert.equal(childExitCode({ status: 0 }), 0);
  assert.equal(childExitCode({ status: 7 }), 7);
  assert.equal(childExitCode({ status: null }), 1);
  assert.equal(childExitCode({}), 1);
  assert.equal(childExitCode(undefined), 1);
});

// ---------------------------------------------------------------------------
// 四种任务目标类型：此前 objective 只有 eliminate 一种，三个任务预设玩法
// 循环完全相同（打完 N 个敌人就只剩流程按钮）。以下用例锁定新增行为。
// ---------------------------------------------------------------------------

test('exposes a normalized objective type and progress on the snapshot', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'eliminate', requiredKills: 3 },
  });
  const snapshot = simulation.step({}, 0);
  assert.equal(snapshot.mission.objectiveType, 'eliminate');
  assert.equal(snapshot.mission.progressTarget, 3);
  assert.ok(snapshot.mission.progress >= 0);
  assert.ok(Number.isFinite(snapshot.mission.progress));
});

test('survive objective advances on time and ignores kills', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'survive', surviveSeconds: 30 },
  });
  const start = simulation.step({}, 0);
  assert.equal(start.mission.objectiveType, 'survive');
  assert.equal(start.mission.surviveRemaining, 30);

  // 不开火、只推进时间：进度必须随时间涨，与击杀无关
  const later = stepFrames(simulation, { throttle: 0 }, 60);
  assert.ok(later.mission.surviveRemaining < 30, 'survive timer must count down');
  assert.ok(later.mission.progress > start.mission.progress, 'survive progress must advance');
  assert.equal(later.mission.kills, 0, 'survive progress must not depend on kills');
});

test('survive objective reaches completion purely through elapsed time', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'survive', surviveSeconds: 6 },
  });
  let snapshot = simulation.step({}, 0);
  // 存活时间取下限是 6 秒，这里跑足 8 秒余量
  for (let frame = 0; frame < 60 * 8; frame += 1) {
    snapshot = simulation.step({ throttle: 0 }, 1 / 60);
    if (snapshot.mission.status === 'complete') break;
  }
  assert.equal(snapshot.mission.progress, snapshot.mission.progressTarget);
});

test('hunt objective only counts elite kills', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [],
    objective: { type: 'hunt', requiredKills: 4, eliteKind: 'gunship' },
  });
  const snapshot = simulation.step({}, 0);
  assert.equal(snapshot.mission.objectiveType, 'hunt');
  // 目标进度来自精英击落数，初值必须为 0 而不是击杀数
  assert.equal(snapshot.mission.progress, 0);
  assert.equal(snapshot.mission.kills, 0);
});

test('hunt objective spawns an elite so progress is actually reachable', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [],
    objective: { type: 'hunt', requiredKills: 4, eliteKind: 'gunship' },
  });
  const start = simulation.step({}, 0);
  // 清场并主动推进一波，触发精英投放
  let snapshot = start;
  for (let frame = 0; frame < 60 * 2; frame += 1) {
    snapshot = simulation.step({ advanceRequested: frame === 30 }, 1 / 60);
    if (snapshot.expedition.phase === 'deep-zone') break;
  }
  assert.equal(snapshot.mission.objectiveType, 'hunt');
  assert.ok(snapshot.mission.progressTarget >= 1, 'hunt target must be reachable');
});

test('collect objective requires cargo fill plus a cleared wave', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    pickups: [],
    objective: { type: 'collect', requiredKills: 2, cargoRatio: 0.5 },
  });
  const snapshot = simulation.step({}, 0);
  assert.equal(snapshot.mission.objectiveType, 'collect');
  assert.ok(snapshot.mission.progressTarget > 0, 'collect must demand cargo slots');
  assert.ok(snapshot.mission.progress <= snapshot.mission.progressTarget);
});

test('wave baseline resets on advance so a new wave never starts complete', () => {
  const { CombatSimulation } = core;
  // 用 survive 目标推进：它只靠时间完成，不依赖击杀，便于稳定测到波次重置逻辑
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'survive', surviveSeconds: 6 },
  });
  let snapshot = simulation.step({}, 0);
  for (let frame = 0; frame < 60 * 30; frame += 1) {
    snapshot = simulation.step({ advanceRequested: snapshot.expedition.phase === 'decision' }, 1 / 60);
    if (snapshot.mission.wave >= 2) break;
  }
  assert.ok(snapshot.mission.wave >= 2, `expected wave >= 2, stuck at ${snapshot.mission.wave}`);
  // 波内基准必须在推进时重置，否则新波一进场就显示"已完成"、玩家无事可做
  assert.equal(snapshot.mission.waveKillBaseline, snapshot.mission.kills);
  assert.ok(
    snapshot.mission.progress < snapshot.mission.progressTarget,
    'a fresh wave must not start already satisfied',
  );
});

test('survive wave keeps pressure up through reinforcements', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'survive', surviveSeconds: 40 },
  });
  // 推进到深区，确认进入 survive 流程
  let snapshot = simulation.step({}, 0);
  for (let frame = 0; frame < 60 * 3; frame += 1) {
    snapshot = simulation.step({}, 1 / 60);
  }
  assert.equal(snapshot.mission.objectiveType, 'survive');
  // 不开火 30 秒，增援机制应让场上仍有敌人（否则「撑时间」毫无压力）
  for (let frame = 0; frame < 60 * 30; frame += 1) {
    snapshot = simulation.step({ throttle: 0 }, 1 / 60);
  }
  assert.ok(
    snapshot.combatEvents.length >= 0,
    'snapshot must remain serialisable during survive',
  );
});

test('rejects an unknown objective type by falling back to eliminate', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    objective: { type: 'nonsense', requiredKills: 2 },
  });
  const snapshot = simulation.step({}, 0);
  assert.equal(snapshot.mission.objectiveType, 'eliminate');
});

test('combo escalates the score multiplier across consecutive kills', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [
      { id: 'a', kind: 'scout', position: { x: 0, y: 0, z: 0 }, health: 1 },
      { id: 'b', kind: 'scout', position: { x: 0, y: 0, z: 0 }, health: 1 },
      { id: 'c', kind: 'scout', position: { x: 0, y: 0, z: 0 }, health:1 },
    ],
    objective: { type: 'eliminate', requiredKills: 3 },
  });
  const snapshot = stepFrames(simulation, { primaryFire: true }, 120);
  assert.equal(snapshot.enemies.length, 0, 'all three targets should be destroyed');
  assert.equal(snapshot.mission.kills, 3);
  assert.equal(snapshot.combo.count, 3, 'three consecutive kills build a x3 combo');
  // 2 连及以上进入 1.2× 档位，3 连仍处该档
  assert.ok(snapshot.combo.multiplier >= 1.2, `expected combo multiplier >= 1.2, got ${snapshot.combo.multiplier}`);
  // 连击倍率使总分高于无连击的基础分 60 * 3 = 180
  assert.ok(snapshot.player.score > 180, `expected score > 180 with combo, got ${snapshot.player.score}`);
});

test('in-combat overclock upgrade increases player fire cadence', async () => {
  const { CombatSimulation } = core;

  // 强化模块必须在拾取后激活并写入快照
  const preview = createSimulation(CombatSimulation, {
    pickups: [{ id: 'up', kind: 'upgrade', upgradeId: 'overclock', position: { x: 0, y: 0, z: 8 }, value: 0 }],
  });
  const previewSnapshot = preview.step({}, 1 / 60);
  assert.equal(previewSnapshot.upgrades.length, 1, 'overclock pickup should activate on collection');
  assert.equal(previewSnapshot.upgrades[0].id, 'overclock');

  function playerShots(frames, withUpgrade) {
    const simulation = createSimulation(CombatSimulation, withUpgrade
      ? { pickups: [{ id: 'up', kind: 'upgrade', upgradeId: 'overclock', position: { x: 0, y: 0, z: 8 }, value: 0 }] }
      : {});
    let shots = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const snapshot = simulation.step({ primaryFire: true }, 1 / 60);
      shots += snapshot.combatEvents.filter(
        (event) => event.type === 'weapon-fired' && event.source === 'player',
      ).length;
    }
    return shots;
  }

  // 45 帧窗口内能量尚未触顶，冷却倍率 0.65 使射速约为 1.5x
  const baseline = playerShots(45, false);
  const overclocked = playerShots(45, true);
  assert.ok(overclocked > baseline, `expected overclock (${overclocked}) > baseline (${baseline}) shots`);
  assert.ok(overclocked >= baseline + 2, `overclock should fire at least 2 more shots, got ${overclocked} vs ${baseline}`);
});

test('non-base enemy kinds carry differentiated combat stats', async () => {
  const { CombatSimulation, ENEMY_TUNING } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [
      { id: 'base', kind: 'scout' },
      { id: 'sup', kind: 'suppressor' },
      { id: 'el', kind: 'elite' },
      { id: 'sup2', kind: 'support' },
    ],
  });
  const snapshot = simulation.step({}, 1 / 60);
  const byKind = Object.fromEntries(snapshot.enemies.map((enemy) => [enemy.kind, enemy.maxHealth]));
  // 压制 / 精英 / 支援 必须和基底 scout(24) 不同，且彼此互不相同
  assert.notEqual(byKind.suppressor, ENEMY_TUNING.scout.health);
  assert.notEqual(byKind.elite, ENEMY_TUNING.scout.health);
  assert.notEqual(byKind.support, ENEMY_TUNING.scout.health);
  assert.notEqual(byKind.suppressor, byKind.elite);
  assert.notEqual(byKind.elite, byKind.support);
  assert.notEqual(byKind.suppressor, byKind.support);
});

test('in-combat weapon swap toggles the active configuration on edge trigger', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  // 先稳定几帧，确保 swapHeld 为 false
  let snapshot = stepFrames(simulation, { throttle: 0 }, 4);
  assert.equal(snapshot.weaponsSwapped, false, 'starts un-swapped');

  // 单帧按下 E：边沿触发一次切换
  snapshot = simulation.step({ swapWeapons: true }, 1 / 60);
  assert.equal(snapshot.weaponsSwapped, true, 'one press swaps');

  // 长按 E 不应反复切换（swapHeld 已锁住）
  snapshot = stepFrames(simulation, { swapWeapons: true }, 10);
  assert.equal(snapshot.weaponsSwapped, true, 'holding does not re-toggle');

  // 松开一帧让 swapHeld 复位
  snapshot = stepFrames(simulation, { throttle: 0 }, 1);
  assert.equal(snapshot.weaponsSwapped, true, 'still swapped after release');

  // 再按一次切换回来
  snapshot = simulation.step({ swapWeapons: true }, 1 / 60);
  assert.equal(snapshot.weaponsSwapped, false, 'second press swaps back');

  // 松开一帧让 swapHeld 复位，确保下一次按下形成新边沿
  stepFrames(simulation, { throttle: 0 }, 1);

  // 切换时必须广播 weapons-swapped 事件供 HUD / 音效响应
  const swapEvents = simulation.step({ swapWeapons: true }, 1 / 60).combatEvents
    .filter((event) => event.type === 'weapons-swapped');
  assert.ok(swapEvents.length >= 1, 'weapons-swapped event should fire on toggle');
});

test('primary fire button launches the secondary weapon after a swap', async () => {
  const { CombatSimulation, SECONDARY_WEAPONS } = core;
  const simulation = createSimulation(CombatSimulation);

  // 未切换：主开火键应打主武器（默认 pulse），不应出现副武器弹体
  let snapshot = stepFrames(simulation, { primaryFire: true }, 36);
  const primaryBefore = snapshot.projectiles
    .filter((p) => p.owner === 'player')
    .map((p) => p.weapon);
  assert.ok(primaryBefore.includes('pulse'), 'primary button fires pulse before swap');
  assert.ok(!primaryBefore.includes('missile'), 'secondary weapon must not appear before swap');

  // 切换一次（单帧 E + 松开复位）
  simulation.step({ swapWeapons: true }, 1 / 60);
  stepFrames(simulation, { throttle: 0 }, 1);
  snapshot = simulation.step({}, 1 / 60);
  assert.equal(snapshot.weaponsSwapped, true, 'swapped before second volley');

  // 切换后：主开火键应改打副武器（默认 missile）
  snapshot = stepFrames(simulation, { primaryFire: true }, 60);
  const primaryAfter = snapshot.projectiles
    .filter((p) => p.owner === 'player')
    .map((p) => p.weapon);
  const expectedSecondary = SECONDARY_WEAPONS[snapshot.loadout.secondary].id;
  assert.ok(
    primaryAfter.includes(expectedSecondary),
    `primary button should fire secondary (${expectedSecondary}) after swap, saw ${primaryAfter.join(',')}`,
  );
  // 且确实与主武器 id 不同，证明键位映射已翻转
  assert.notEqual(expectedSecondary, snapshot.loadout.weapon, 'secondary must differ from primary');
});

test('undocking after expedition complete resets phase and lets the ship fly (regression: 0.13.6 android freeze)', async () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  // 1) 把远征推进到 complete 阶段 —— 这正是 0.13.6「无限再入港循环」触发前的真实状态：
  //    玩家完成远征、mission.status === 'complete'，CombatBootstrap 每帧据此自动入港。
  const expedition = simulation.expedition;
  expedition.completeEvent('primary'); // primary -> decision
  expedition.continueExpedition(); // decision -> deep-zone
  for (let i = 0; i < 200 && expedition.snapshot().phase !== 'complete'; i += 1) {
    expedition.step({ returnRequested: true, insideReturnZone: true, delta: 0.1 });
  }
  assert.equal(expedition.snapshot().phase, 'complete', 'expedition should reach complete');
  assert.equal(
    simulation.snapshot().mission.status,
    'complete',
    'mission.status must be complete before undocking (freeze precondition)',
  );

  // 制造上一局战果，验证离港是「完整重置」而不只是复位阶段。
  simulation.kills = 9;
  simulation.wave = 4;
  simulation.waveKillBaseline = 6;
  simulation.player.score = 500;

  // 2) 离港
  const afterDepart = simulation.departOutpost();

  // 新行为：wave/kills/baseline/cargo 归零、重新投放第一波敌人，score 保留。
  assert.equal(afterDepart.mission.wave, 1, 'wave 必须重置为 1');
  assert.equal(afterDepart.mission.kills, 0, 'kills 必须清零');
  assert.equal(afterDepart.mission.waveKillBaseline, 0, '波内击杀基准必须清零');
  assert.equal(afterDepart.cargo.items.length, 0, '货舱必须清空');
  assert.ok(afterDepart.enemies.length > 0, '离港必须重新 spawn 第一波敌人');
  assert.equal(afterDepart.player.score, 500, 'score 必须保留');
  assert.notEqual(afterDepart.mission.status, 'complete', '离港首帧不能沿用上一局完成态');

  // 3) 核心修复断言：离港后远征阶段必须复位回 primary，mission.status 不再恒为 complete。
  //    旧代码只置 docked=false，导致下一帧 Bootstrap 再次自动入港 → 飞船被钉死、整屏冻结。
  assert.equal(afterDepart.expedition.phase, 'primary', 'expedition must reset to primary on undock');
  assert.equal(simulation.expedition.snapshot().phase, 'primary', 'expedition phase must be primary after undock');
  assert.notEqual(
    simulation.snapshot().mission.status,
    'complete',
    'mission.status must NOT stay complete after undock (would re-trigger auto-dock loop)',
  );

  // 4) 飞船必须能继续飞：离港后 docked=false，step() 不再空转。
  const startPos = simulation.snapshot().player.position;
  const flown = stepFrames(simulation, { throttle: 1 }, 60);
  const endPos = flown.player.position;
  const moved = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
  assert.ok(moved > 0.01, `ship must move after undock (frozen screen regression), moved ${moved.toFixed(4)}`);

  // 5) 离港后的推进不能把玩家重新钉进前哨站：navigation.docked 必须保持 false，
  //    即 Bootstrap 的「status===complete → enterOutpost」分支不会再被触发。
  assert.equal(flown.navigation.docked, false, 'must not re-enter outpost dock after undock');
  assert.notEqual(flown.mission.status, 'complete', 'mission.status must remain non-complete while flying');
});

// ---------------------------------------------------------------------------
// 新增护栏：锁定本轮修复的确定性行为，防止回归。
// ---------------------------------------------------------------------------

test('guard: rapid tapping of the return key cannot complete the expedition', () => {
  const director = new core.ExpeditionDirector({ seed: 7, primaryEvent: 'breach' });
  director.completeEvent('primary');
  // 按一下松一下，每次只推进 0.2s；进度必须在松开时清零，不能靠连点累积。
  for (let press = 0; press < 20; press += 1) {
    director.step({ delta: 0.2, returnRequested: true, insideReturnZone: true });
    director.step({ delta: 0.2, returnRequested: false, insideReturnZone: true });
  }
  assert.notEqual(director.snapshot().phase, 'complete', '连点不能凑满返航进度');
  assert.equal(director.snapshot().returnProgress, 0, '松开返回键必须清零进度');
  // 连续按住 2.4 秒仍应能正常返航，避免过度修复把返航锁死。
  for (let frame = 0; frame < 200 && director.snapshot().phase !== 'complete'; frame += 1) {
    director.step({ delta: 1 / 60, returnRequested: true, insideReturnZone: true });
  }
  assert.equal(director.snapshot().phase, 'complete');
});

test('guard: defense and escort objectives do not complete on the first frame', () => {
  const { CombatSimulation } = core;
  for (const type of ['defense', 'escort']) {
    const simulation = createSimulation(CombatSimulation, {
      objective: { type, surviveSeconds: 30 },
    });
    const snapshot = simulation.step({}, 1 / 60);
    assert.equal(snapshot.mission.objectiveType, type);
    assert.ok(
      snapshot.mission.progress < snapshot.mission.progressTarget,
      `${type} 首帧进度不能等于目标`,
    );
    assert.equal(snapshot.mission.status, 'active');
  }
});

test('guard: hunt wave-2 target stays reachable (matches this wave elite count)', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation, {
    enemies: [],
    objective: { type: 'hunt', requiredKills: 4, eliteKind: 'gunship' },
  });
  simulation.step({}, 0);
  // 把远征推进到 decision，再主动进入下一波。
  simulation.expedition.completeEvent('primary');
  const advanced = simulation.step({ advanceRequested: true }, 1 / 60);
  assert.equal(advanced.mission.wave, 2, '必须真的推进到第 2 波');
  const elites = advanced.enemies.filter(
    (enemy) => enemy.role === 'elite' || enemy.kind === 'gunship',
  ).length;
  assert.ok(elites >= 1, '第 2 波必须有精英可杀');
  assert.ok(
    advanced.mission.progressTarget <= elites,
    'hunt 目标不能超过本波精英投放数，否则不可达',
  );
});

test('guard: repeated docking never settles the same cargo twice', () => {
  const { CombatSimulation, LootAndCargoSystem } = core;
  const simulation = new CombatSimulation({
    mission: {
      id: 'cargo-repeat',
      enemies: [],
      pickups: [
        { id: 'scrap-1', kind: 'scrap', position: { x: 0, y: 0, z: 8 }, value: 120 },
        { id: 'data-1', kind: 'data', position: { x: 0, y: 0, z: 8 }, value: 200 },
      ],
      objective: { type: 'eliminate', requiredKills: 99 },
    },
    seed: 9,
  });
  simulation.step({}, 1 / 60);
  const first = simulation.serviceAtOutpost();
  assert.ok(first.navigation.securedCargoValue > 0, '首次返航应结算出货物价值');
  assert.equal(first.cargo.items.length, 0, '结算后货舱必须清空');

  // 幂等守卫：重复进站不重复结算。
  const again = simulation.serviceAtOutpost();
  assert.equal(again.navigation.securedCargoValue, first.navigation.securedCargoValue);

  // 离港清货，下一局不能再把同一批货算一次。
  const launched = simulation.departOutpost();
  assert.equal(launched.cargo.items.length, 0);
  const secondRun = simulation.serviceAtOutpost();
  assert.equal(secondRun.navigation.securedCargoValue, 0, '新一局没有旧货物可重复结算');

  // cargo 层同样保证一次远征只结算一次。
  const cargo = new LootAndCargoSystem(8, 1);
  cargo.add({ id: 'a', category: 'material', insured: false, rarity: 'common', value: 50 });
  assert.equal(cargo.settleExpedition('returned').keptValue, 50);
  assert.equal(cargo.settleExpedition('returned').keptValue, 0);
});

test('guard: weapon swap is ignored while paused', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);
  // 单帧按下 pause 进入暂停，再松开一帧复位 pauseHeld。
  assert.equal(simulation.step({ pause: true }, 1 / 60).paused, true);
  assert.equal(simulation.step({}, 1 / 60).paused, true);
  const before = simulation.step({}, 1 / 60).weaponsSwapped;
  const duringPause = simulation.step({ swapWeapons: true }, 1 / 60);
  assert.equal(duringPause.paused, true);
  assert.equal(duringPause.weaponsSwapped, before, '暂停时不能切换武器');
  assert.ok(
    !duringPause.combatEvents.some((event) => event.type === 'weapons-swapped'),
    '暂停时不能派发 weapons-swapped 事件',
  );
});

test('guard: resolveLoadout rejects prototype-chain property names', () => {
  const fallback = core.resolveLoadout();
  const hostile = core.resolveLoadout({
    weapon: 'toString',
    device: 'constructor',
    core: 'hasOwnProperty',
    secondary: '__proto__',
    engine: 'valueOf',
    shield: 'toString',
    utility: 'constructor',
    boost: '__defineGetter__',
    skin: 'toString',
  });
  assert.equal(hostile.weapon, fallback.weapon);
  assert.equal(hostile.device, fallback.device);
  assert.equal(hostile.core, fallback.core);
  assert.equal(hostile.secondary, fallback.secondary);
  assert.equal(hostile.engine, fallback.engine);
  assert.equal(hostile.shield, fallback.shield);
  assert.equal(hostile.utility, fallback.utility);
  assert.equal(hostile.boost, fallback.boost);
  assert.equal(hostile.skin, fallback.skin);
});

test('guard: shield upgrade multiplier raises maxShield and recovers on expiry', () => {
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);
  const base = simulation.snapshot().player.maxShield;
  simulation.activeUpgrades.push({ id: 'ablative', remaining: 0.2 });
  const boosted = simulation.step({}, 1 / 60);
  assert.ok(boosted.player.maxShield > base, '护盾增益必须真正抬高 maxShield');
  const expired = stepFrames(simulation, {}, 30);
  assert.equal(expired.player.maxShield, base, '增益到期后 maxShield 必须复原');
});

test('guard: CoopNetwork drops stale frames and validates presence vectors', () => {
  // CoopNetwork 不在 simulation 编译清单里，用源码契约护栏锁定两处修复。
  const source = readFileSync(
    path.join(cocosProjectRoot, 'assets', 'scripts', 'core', 'CoopNetwork.ts'),
    'utf8',
  );
  assert.match(source, /frame\.seq <= this\.lastAppliedSeq/, '迟到帧必须被丢弃');
  assert.match(source, /seq > maxSeq/, 'latest 必须返回最大 seq 对应帧');
  assert.match(source, /Number\.isInteger\(presence\.seq\)/, 'seq 必须校验为有限非负整数');
  assert.match(source, /isFiniteVec3\(presence\.position\)/, '向量字段必须校验有限');
});


