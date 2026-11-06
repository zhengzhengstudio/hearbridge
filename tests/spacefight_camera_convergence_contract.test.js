'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const coreRoot = path.join(projectRoot, 'assets', 'scripts', 'core');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-aim-convergence-'));
const shipPresenterSource = readFileSync(path.join(
  projectRoot,
  'assets',
  'scripts',
  'game',
  'ShipPresenter.ts',
), 'utf8');
const combatBootstrapSource = readFileSync(path.join(
  projectRoot,
  'assets',
  'scripts',
  'game',
  'CombatBootstrap.ts',
), 'utf8');

test.after(() => {
  rmSync(outputRoot, { recursive: true, force: true });
});

const compile = spawnSync('npx', [
  '--yes',
  '--package',
  'typescript@4.9.5',
  'tsc',
  '--target',
  'ES2020',
  '--module',
  'commonjs',
  '--moduleResolution',
  'node',
  '--strict',
  '--skipLibCheck',
  '--outDir',
  outputRoot,
  path.join(coreRoot, 'FlightCommand.ts'),
  path.join(coreRoot, 'FlightAttitude.ts'),
  path.join(coreRoot, 'FlightTuning.ts'),
  path.join(coreRoot, 'WeaponCatalog.ts'),
  path.join(coreRoot, 'AimConvergence.ts'),
  path.join(coreRoot, 'CombatSimulation.ts'),
], { cwd: projectRoot, encoding: 'utf8' });

assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);

const aim = require(path.join(outputRoot, 'AimConvergence.js'));
const { CombatSimulation } = require(path.join(outputRoot, 'CombatSimulation.js'));

function assertNear(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertFiniteUnit(vector) {
  assert.ok(Object.values(vector).every(Number.isFinite));
  assertNear(Math.hypot(vector.x, vector.y, vector.z), 1);
}

function normalized(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function cocosWorldPoint(shipPosition, localPosition, pitch, yaw) {
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const pitchedY = localPosition.y * cosPitch - localPosition.z * sinPitch;
  const pitchedZ = localPosition.y * sinPitch + localPosition.z * cosPitch;
  return {
    x: shipPosition.x + localPosition.x * cosYaw + pitchedZ * sinYaw,
    y: shipPosition.y + pitchedY,
    z: shipPosition.z - localPosition.x * sinYaw + pitchedZ * cosYaw,
  };
}

function assertTrajectoryPassesThrough(projectile, point) {
  const offset = {
    x: point.x - projectile.origin.x,
    y: point.y - projectile.origin.y,
    z: point.z - projectile.origin.z,
  };
  const cross = {
    x: offset.y * projectile.velocity.z - offset.z * projectile.velocity.y,
    y: offset.z * projectile.velocity.x - offset.x * projectile.velocity.z,
    z: offset.x * projectile.velocity.y - offset.y * projectile.velocity.x,
  };
  const scale = Math.hypot(offset.x, offset.y, offset.z)
    * Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
  const dot = offset.x * projectile.velocity.x
    + offset.y * projectile.velocity.y
    + offset.z * projectile.velocity.z;

  assert.ok(Math.hypot(cross.x, cross.y, cross.z) / scale < 0.000002);
  assert.ok(dot > 0, 'projectile must travel toward the visible convergence point');
}

test('camera direction uses aim attitude while ship presentation keeps hull attitude', () => {
  const player = {
    position: { x: 3, y: -2, z: 5 },
    aimYaw: 0.8,
    aimPitch: 0.2,
    yaw: 0.3,
    pitch: 0.05,
  };

  const ray = aim.computeAimRay(player);
  const ship = aim.computeShipPresentationAttitude(player);

  assert.deepEqual(ray.origin, player.position);
  assertNear(Math.atan2(ray.direction.x, -ray.direction.z), 0.8);
  assertNear(Math.asin(ray.direction.y), 0.2);
  assert.equal(ship.yaw, 0.3);
  assert.equal(ship.pitch, 0.05);
  assert.equal(ship.roll, -0.225);
  assert.match(
    combatBootstrapSource,
    /computeAimRay\(\{\s*position: player\.position,\s*aimYaw: player\.aimYaw,\s*aimPitch: player\.aimPitch,/,
  );
});

test('a target under the reticle becomes the ballistic convergence point', () => {
  const targetPosition = { x: 0.45, y: 0.18, z: -36 };
  const simulation = new CombatSimulation({
    mission: {
      id: 'dynamic-reticle-convergence',
      enemies: [
        { id: 'under-reticle', position: targetPosition, health: 100 },
        { id: 'off-axis', position: { x: 28, y: 0, z: -34 }, health: 100 },
      ],
      objective: { type: 'eliminate', requiredKills: 2 },
    },
    seed: 113,
  });

  const snapshot = simulation.step({ primaryFire: true }, 1 / 60);
  const projectile = snapshot.projectiles.find(candidate => candidate.owner === 'player');

  assert.equal(snapshot.target?.id, 'under-reticle');
  assert.deepEqual(snapshot.aimPoint, targetPosition);
  assert.ok(projectile);
  assertTrajectoryPassesThrough(projectile, targetPosition);
});

test('both named muzzle positions converge on the visible aim ray', () => {
  const ray = aim.computeAimRay({
    position: { x: 0, y: 0, z: 0 },
    aimYaw: 0,
    aimPitch: 0,
  });
  const point = aim.computeConvergencePoint(ray, aim.AIM_CONVERGENCE_DISTANCE);
  const primary = aim.computeMuzzlePosition(
    ray.origin,
    { yaw: 0, pitch: 0 },
    aim.PRIMARY_MUZZLE_LOCAL_POSITION,
  );
  const secondary = aim.computeMuzzlePosition(
    ray.origin,
    { yaw: 0, pitch: 0 },
    aim.SECONDARY_MUZZLE_LOCAL_POSITION,
  );
  const primaryDirection = aim.computeMuzzleDirection(primary, point);
  const secondaryDirection = aim.computeMuzzleDirection(secondary, point);

  assert.deepEqual(point, { x: 0, y: 0, z: -360 });
  assert.deepEqual(primary, { x: -0.68, y: -0.04, z: -2.25 });
  assert.deepEqual(secondary, { x: 0.68, y: -0.04, z: -2.25 });
  assertFiniteUnit(primaryDirection);
  assertFiniteUnit(secondaryDirection);

  for (const [muzzle, direction] of [
    [primary, primaryDirection],
    [secondary, secondaryDirection],
  ]) {
    const distance = Math.hypot(point.x - muzzle.x, point.y - muzzle.y, point.z - muzzle.z);
    assertNear(muzzle.x + direction.x * distance, point.x);
    assertNear(muzzle.y + direction.y * distance, point.y);
    assertNear(muzzle.z + direction.z * distance, point.z);
  }
});

test('Cocos presentation negates hull yaw while preserving pitch and convergence', () => {
  assert.match(
    shipPresenterSource,
    /setRotationFromEuler\(\s*attitude\.pitch \* 180 \/ Math\.PI,\s*-attitude\.yaw \* 180 \/ Math\.PI,/,
  );

  const simulation = new CombatSimulation({
    mission: {
      id: 'cocos-presentation-convention',
      enemies: [{ id: 'observer', position: { x: 400, y: 400, z: 400 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 83,
  });
  simulation.step({ yaw: 0.75, pitch: 0.5 }, 0);
  for (let frame = 0; frame < 30; frame += 1) simulation.step({}, 1 / 60);
  const snapshot = simulation.step({ primaryFire: true, secondaryFire: true }, 1 / 60);
  const player = snapshot.player;
  const cocosYaw = -player.yaw;
  const renderedForward = normalized(cocosWorldPoint(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
    player.pitch,
    cocosYaw,
  ));
  const expectedHullForward = {
    x: Math.sin(player.yaw) * Math.cos(player.pitch),
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * Math.cos(player.pitch),
  };
  const aimRay = aim.computeAimRay(player);
  const visibleAimDirection = normalized({
    x: snapshot.aimPoint.x - player.position.x,
    y: snapshot.aimPoint.y - player.position.y,
    z: snapshot.aimPoint.z - player.position.z,
  });

  assert.ok(player.yaw > 0);
  assert.ok(player.pitch > 0);
  assert.ok(renderedForward.x > 0);
  assert.ok(renderedForward.y > 0);
  assertNear(renderedForward.x, expectedHullForward.x);
  assertNear(renderedForward.y, expectedHullForward.y);
  assertNear(renderedForward.z, expectedHullForward.z);
  assert.ok(aimRay.direction.x > 0);
  assert.ok(aimRay.direction.y > 0);
  assertNear(aimRay.direction.x, visibleAimDirection.x, 0.000002);
  assertNear(aimRay.direction.y, visibleAimDirection.y, 0.000002);
  assertNear(aimRay.direction.z, visibleAimDirection.z, 0.000002);

  for (const [weapon, localPosition] of [
    ['pulse', aim.PRIMARY_MUZZLE_LOCAL_POSITION],
    ['missile', aim.SECONDARY_MUZZLE_LOCAL_POSITION],
  ]) {
    const projectile = snapshot.projectiles.find(candidate => candidate.weapon === weapon);
    const renderedMuzzle = cocosWorldPoint(
      player.position,
      localPosition,
      player.pitch,
      cocosYaw,
    );
    assert.ok(projectile);
    assertNear(projectile.origin.x, renderedMuzzle.x, 0.000002);
    assertNear(projectile.origin.y, renderedMuzzle.y, 0.000002);
    assertNear(projectile.origin.z, renderedMuzzle.z, 0.000002);
    assertTrajectoryPassesThrough(projectile, snapshot.aimPoint);
    const projectileDirection = normalized(projectile.velocity);
    assert.ok(projectileDirection.x > 0);
    assert.ok(projectileDirection.y > 0);
  }
});

test('invalid convergence inputs produce deterministic finite normalized output', () => {
  const invalidRay = aim.computeAimRay({
    position: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: -0 },
    aimYaw: Number.NaN,
    aimPitch: Number.NEGATIVE_INFINITY,
  });
  const point = aim.computeConvergencePoint({
    origin: invalidRay.origin,
    direction: { x: Number.NaN, y: 0, z: 0 },
  }, Number.NaN);
  const direction = aim.computeMuzzleDirection(point, point);

  assert.deepEqual(invalidRay, {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
  });
  assert.deepEqual(point, { x: 0, y: 0, z: -360 });
  assert.deepEqual(direction, { x: 0, y: 0, z: -1 });
  assertFiniteUnit(direction);
});

test('simulation launches both weapon slots along the shared convergence point', () => {
  const simulation = new CombatSimulation({
    mission: {
      id: 'convergence-contract',
      enemies: [{ id: 'observer', position: { x: 400, y: 400, z: 400 }, health: 100 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    },
    seed: 71,
  });

  const snapshot = simulation.step({
    yaw: 0.75,
    pitch: -0.25,
    primaryFire: true,
    secondaryFire: true,
  }, 1 / 60);
  const primary = snapshot.projectiles.find(projectile => projectile.weapon !== 'missile');
  const secondary = snapshot.projectiles.find(projectile => projectile.weapon === 'missile');

  assert.ok(primary);
  assert.ok(secondary);
  assert.ok(primary.origin.x < snapshot.player.position.x);
  assert.ok(secondary.origin.x > snapshot.player.position.x);
  assert.deepEqual(primary.position, primary.origin);
  assert.deepEqual(secondary.position, secondary.origin);
  assertNear(
    Math.hypot(
      snapshot.aimPoint.x - snapshot.player.position.x,
      snapshot.aimPoint.y - snapshot.player.position.y,
      snapshot.aimPoint.z - snapshot.player.position.z,
    ),
    aim.AIM_CONVERGENCE_DISTANCE,
    0.000002,
  );
  assertTrajectoryPassesThrough(primary, snapshot.aimPoint);
  assertTrajectoryPassesThrough(secondary, snapshot.aimPoint);
});
