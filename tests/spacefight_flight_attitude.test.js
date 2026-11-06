'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const coreRoot = path.join(projectRoot, 'assets', 'scripts', 'core');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-flight-attitude-'));

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
], { cwd: projectRoot, encoding: 'utf8' });

assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);

const {
  DEFAULT_ATTITUDE_TUNING,
  neutralAttitude,
  stepFlightAttitude,
} = require(path.join(outputRoot, 'FlightAttitude.js'));

const TAU = Math.PI * 2;

function angleError(target, current) {
  let error = (target - current) % TAU;
  if (error > Math.PI) error -= TAU;
  if (error < -Math.PI) error += TAU;
  return error;
}

function assertNear(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('exports the exact Task 6 attitude tuning', () => {
  assert.deepEqual(DEFAULT_ATTITUDE_TUNING, {
    lookYawRate: Math.PI * 4.4,
    lookPitchRate: Math.PI * 3.2,
    hullYawAcceleration: Math.PI * 15.5,
    hullPitchAcceleration: Math.PI * 11.5,
    hullYawRateMax: Math.PI * 3.1,
    hullPitchRateMax: Math.PI * 2.2,
    maxPitch: Math.PI * 0.43,
  });
});

test('view responds on the first simulation step while hull follows with weight', () => {
  const next = stepFlightAttitude(
    neutralAttitude(),
    { yaw: 0.5, pitch: -0.25 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );

  assertNear(next.aimYaw, DEFAULT_ATTITUDE_TUNING.lookYawRate * 0.5 / 60);
  assertNear(next.aimPitch, -DEFAULT_ATTITUDE_TUNING.lookPitchRate * 0.25 / 60);
  assert.ok(next.hullYaw > 0);
  assert.ok(next.hullYaw < next.aimYaw);
  assert.ok(next.hullPitch < 0);
  assert.ok(next.hullPitch > next.aimPitch);
});

test('fast look pulses retain magnitude up to four axes instead of flattening at one', () => {
  let normal = stepFlightAttitude(
    neutralAttitude(),
    { yaw: 1, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );
  let fast = stepFlightAttitude(
    neutralAttitude(),
    { yaw: 4, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );
  const capped = stepFlightAttitude(
    neutralAttitude(),
    { yaw: 40, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );

  assertNear(fast.aimYaw, normal.aimYaw * 4);
  assertNear(capped.aimYaw, fast.aimYaw);

  for (let frame = 0; frame < 8; frame += 1) {
    normal = stepFlightAttitude(
      normal,
      { yaw: 0, pitch: 0 },
      1 / 60,
      DEFAULT_ATTITUDE_TUNING,
    );
    fast = stepFlightAttitude(
      fast,
      { yaw: 0, pitch: 0 },
      1 / 60,
      DEFAULT_ATTITUDE_TUNING,
    );
  }
  assert.ok(fast.hullYaw > normal.hullYaw);
});

test('hull keeps converging after the player stops moving the view', () => {
  const aimed = stepFlightAttitude(
    neutralAttitude(),
    { yaw: 1, pitch: 0 },
    0.1,
    DEFAULT_ATTITUDE_TUNING,
  );
  const settledInput = stepFlightAttitude(
    aimed,
    { yaw: 0, pitch: 0 },
    0.1,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.equal(settledInput.aimYaw, aimed.aimYaw);
  assert.ok(settledInput.hullYaw > aimed.hullYaw);
  assert.ok(
    Math.abs(angleError(settledInput.aimYaw, settledInput.hullYaw))
      < Math.abs(angleError(aimed.aimYaw, aimed.hullYaw)),
  );
});

test('yaw pursuit crosses the wrap seam by the shortest deterministic direction', () => {
  const acrossSeam = {
    ...neutralAttitude(),
    aimYaw: -Math.PI + 0.02,
    hullYaw: Math.PI - 0.02,
  };
  const next = stepFlightAttitude(
    acrossSeam,
    { yaw: 0, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.ok(next.hullYawVelocity > 0);
  assert.ok(
    Math.abs(angleError(next.aimYaw, next.hullYaw))
      < Math.abs(angleError(acrossSeam.aimYaw, acrossSeam.hullYaw)),
  );

  const positiveHalfTurn = stepFlightAttitude(
    { ...neutralAttitude(), aimYaw: Math.PI },
    { yaw: 0, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );
  const negativeHalfTurn = stepFlightAttitude(
    { ...neutralAttitude(), aimYaw: -Math.PI },
    { yaw: 0, pitch: 0 },
    1 / 60,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.ok(positiveHalfTurn.hullYawVelocity > 0);
  assert.ok(negativeHalfTurn.hullYawVelocity < 0);
});

test('angular acceleration and rate stay bounded without overshooting on large dt', () => {
  const dt = 1 / 20;
  const accelerated = stepFlightAttitude(
    { ...neutralAttitude(), aimYaw: 2, aimPitch: 1 },
    { yaw: 0, pitch: 0 },
    dt,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.ok(Math.abs(accelerated.hullYawVelocity)
    <= DEFAULT_ATTITUDE_TUNING.hullYawAcceleration * dt);
  assert.ok(Math.abs(accelerated.hullPitchVelocity)
    <= DEFAULT_ATTITUDE_TUNING.hullPitchAcceleration * dt);
  assert.ok(Math.abs(accelerated.hullYawVelocity)
    <= DEFAULT_ATTITUDE_TUNING.hullYawRateMax);
  assert.ok(Math.abs(accelerated.hullPitchVelocity)
    <= DEFAULT_ATTITUDE_TUNING.hullPitchRateMax);

  const largeStep = stepFlightAttitude(
    { ...neutralAttitude(), aimYaw: 0.7, aimPitch: 0.4 },
    { yaw: 0, pitch: 0 },
    10,
    DEFAULT_ATTITUDE_TUNING,
  );
  assertNear(largeStep.hullYaw, largeStep.aimYaw);
  assertNear(largeStep.hullPitch, largeStep.aimPitch);
  assert.equal(largeStep.hullYawVelocity, 0);
  assert.equal(largeStep.hullPitchVelocity, 0);
});

test('near-target braking never bypasses the angular acceleration bound', () => {
  const dt = 1 / 60;
  const state = {
    ...neutralAttitude(),
    aimYaw: 0.001,
    aimPitch: -0.001,
    hullYawVelocity: DEFAULT_ATTITUDE_TUNING.hullYawRateMax,
    hullPitchVelocity: -DEFAULT_ATTITUDE_TUNING.hullPitchRateMax,
  };
  const next = stepFlightAttitude(
    state,
    { yaw: 0, pitch: 0 },
    dt,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.ok(
    Math.abs(next.hullYawVelocity - state.hullYawVelocity)
      <= DEFAULT_ATTITUDE_TUNING.hullYawAcceleration * dt + 1e-12,
  );
  assert.ok(
    Math.abs(next.hullPitchVelocity - state.hullPitchVelocity)
      <= DEFAULT_ATTITUDE_TUNING.hullPitchAcceleration * dt + 1e-12,
  );
});

test('release from yaw-rate cap brakes without crossing an aim beyond stopping distance', () => {
  const dt = 1 / 60;
  const targetYaw = 1.2;
  const stoppingDistance = DEFAULT_ATTITUDE_TUNING.hullYawRateMax ** 2
    / (2 * DEFAULT_ATTITUDE_TUNING.hullYawAcceleration);
  assert.ok(targetYaw > stoppingDistance);

  let state = {
    ...neutralAttitude(),
    aimYaw: targetYaw,
    hullYawVelocity: DEFAULT_ATTITUDE_TUNING.hullYawRateMax,
  };
  for (let step = 0; step < 300; step += 1) {
    const previousVelocity = state.hullYawVelocity;
    state = stepFlightAttitude(
      state,
      { yaw: 0, pitch: 0 },
      dt,
      DEFAULT_ATTITUDE_TUNING,
    );

    assert.ok(state.hullYaw <= targetYaw + 1e-12, `crossed aim at step ${step}`);
    assert.ok(Math.abs(state.hullYawVelocity)
      <= DEFAULT_ATTITUDE_TUNING.hullYawRateMax + 1e-12);
    assert.ok(
      Math.abs(state.hullYawVelocity - previousVelocity)
        <= DEFAULT_ATTITUDE_TUNING.hullYawAcceleration * dt + 1e-12,
    );
  }

  assertNear(state.hullYaw, targetYaw);
  assert.equal(state.hullYawVelocity, 0);
});

test('zero or invalid dt preserves a finite attitude exactly', () => {
  const state = {
    aimYaw: 0.4,
    aimPitch: -0.2,
    hullYaw: 0.1,
    hullPitch: -0.05,
    hullYawVelocity: 0.7,
    hullPitchVelocity: -0.3,
  };

  assert.deepEqual(
    stepFlightAttitude(state, { yaw: 1, pitch: 1 }, 0, DEFAULT_ATTITUDE_TUNING),
    state,
  );
  assert.deepEqual(
    stepFlightAttitude(state, { yaw: 1, pitch: 1 }, Number.NaN, DEFAULT_ATTITUDE_TUNING),
    state,
  );
});

test('aim and hull pitch remain clamped under sustained and oversized steps', () => {
  let state = neutralAttitude();
  for (let step = 0; step < 300; step += 1) {
    state = stepFlightAttitude(
      state,
      { yaw: 0, pitch: 1 },
      1 / 60,
      DEFAULT_ATTITUDE_TUNING,
    );
  }
  state = stepFlightAttitude(
    state,
    { yaw: 0, pitch: -1 },
    100,
    DEFAULT_ATTITUDE_TUNING,
  );

  assert.ok(state.aimPitch >= -DEFAULT_ATTITUDE_TUNING.maxPitch);
  assert.ok(state.aimPitch <= DEFAULT_ATTITUDE_TUNING.maxPitch);
  assert.ok(state.hullPitch >= -DEFAULT_ATTITUDE_TUNING.maxPitch);
  assert.ok(state.hullPitch <= DEFAULT_ATTITUDE_TUNING.maxPitch);
  assert.ok(Object.values(state).every(Number.isFinite));
});

test('identical command streams produce identical finite attitude states', () => {
  const stream = [
    [{ yaw: 1, pitch: -0.4 }, 1 / 60],
    [{ yaw: 0.5, pitch: 0.2 }, 1 / 30],
    [{ yaw: 0, pitch: 0 }, 0.1],
    [{ yaw: -1, pitch: 1 }, 0.25],
    [{ yaw: 0, pitch: 0 }, 0],
  ];
  const run = () => stream.reduce(
    (state, [command, dt]) => stepFlightAttitude(
      state,
      command,
      dt,
      DEFAULT_ATTITUDE_TUNING,
    ),
    neutralAttitude(),
  );

  const left = run();
  const right = run();
  assert.deepEqual(left, right);
  assert.ok(Object.values(left).every(Number.isFinite));
});
