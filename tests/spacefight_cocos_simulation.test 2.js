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
  ...require(path.join(compiledCoreRoot, 'AimConvergence.js')),
  ...require(path.join(compiledCoreRoot, 'ExpeditionDirector.js')),
  ...require(path.join(compiledCoreRoot, 'EnemyBehaviorSystem.js')),
  ...require(path.join(compiledCoreRoot, 'LootAndCargoSystem.js')),
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
  assert.equal(snapshot.player.position.z, -1);
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
  const distance = 9 / 60;
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
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ throttle: 1 }, 1);

  assert.equal(snapshot.tick, 15);
  assert.equal(snapshot.player.position.z, 5.75);
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
  const { CombatSimulation } = core;
  const simulation = createSimulation(CombatSimulation);

  const snapshot = simulation.step({ primaryFire: true }, 1 / 60);

  assert.deepEqual(snapshot.aimPoint, {
    x: 0,
    y: 0,
    z: 8 - core.AIM_CONVERGENCE_DISTANCE,
  });
  assert.deepEqual(snapshot.projectiles[0].origin, { x: -0.68, y: -0.04, z: 5.75 });
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

test('outpost service repairs the craft, clears fire, secures cargo, and launches outside the dock', () => {
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
  const docked = simulation.serviceAtOutpost();
  assert.equal(docked.navigation.docked, true);
  assert.equal(docked.player.health, docked.player.maxHealth);
  assert.equal(docked.player.shield, docked.player.maxShield);
  assert.equal(docked.player.energy, docked.player.maxEnergy);
  assert.equal(docked.projectiles.length, 0);
  assert.ok(docked.combatEvents.some((event) => event.type === 'outpost-serviced'));

  const launched = simulation.departOutpost();
  assert.equal(launched.navigation.docked, false);
  assert.equal(launched.navigation.canDock, false);
  assert.ok(launched.player.spawnProtection > 0);
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
