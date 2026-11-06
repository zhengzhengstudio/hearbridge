'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const scriptsRoot = path.join(projectRoot, 'assets', 'scripts');
const bootstrapPath = path.join(scriptsRoot, 'game', 'CombatBootstrap.ts');
const worldStreamerPath = path.join(scriptsRoot, 'game', 'WorldStreamer.ts');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-cocos-graphics-'));

test.after(() => {
  rmSync(outputRoot, { recursive: true, force: true });
});

const compile = spawnSync('npx', [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
  '--rootDir', scriptsRoot,
  '--outDir', outputRoot,
  path.join(scriptsRoot, 'performance', 'GraphicsProfile.ts'),
  path.join(scriptsRoot, 'performance', 'CapabilityPolicy.ts'),
  path.join(scriptsRoot, 'performance', 'GraphicsAdviceChannel.ts'),
  path.join(scriptsRoot, 'game', 'WorldStreamProfile.ts'),
], { cwd: projectRoot, encoding: 'utf8' });

assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);

const profiles = require(path.join(outputRoot, 'performance', 'GraphicsProfile.js'));
const policy = require(path.join(outputRoot, 'performance', 'CapabilityPolicy.js'));
const advice = require(path.join(outputRoot, 'performance', 'GraphicsAdviceChannel.js'));
const worldProfiles = require(path.join(outputRoot, 'game', 'WorldStreamProfile.js'));

function methodSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return source.slice(start, end);
}

test('graphics profiles keep the approved concrete resource budgets', () => {
  assert.deepEqual(profiles.GRAPHICS_PROFILES, {
    low: {
      targetFps: 30,
      renderScaleMin: 0.48,
      renderScaleMax: 0.64,
      shadows: false,
      particleCapacity: 16,
      activeWorldChunks: 1,
      decorationBudget: 14,
      projectilePoolSize: 18,
      projectileTrails: false,
      feedbackPoolSize: 8,
      feedbackLights: false,
      maxVisibleEnemies: 4,
    },
    high: {
      targetFps: 60,
      renderScaleMin: 0.82,
      renderScaleMax: 1,
      shadows: true,
      particleCapacity: 180,
      activeWorldChunks: 25,
      decorationBudget: 180,
      projectilePoolSize: 48,
      projectileTrails: true,
      feedbackPoolSize: 18,
      feedbackLights: true,
      maxVisibleEnemies: 10,
    },
  });
});

test('HarmonyOS falls back safely when hardware is weak or unavailable', () => {
  assert.deepEqual(policy.resolveGraphicsDecision({
    platform: 'harmonyos', memoryGB: 3, benchmarkFrameMs: 45,
  }), {
    tier: 'low',
    prompt: false,
    reason: 'harmony-critical-fallback',
    persistPromptSuppression: false,
  });
  assert.deepEqual(policy.resolveGraphicsDecision({
    platform: 'harmonyos', memoryGB: null, benchmarkFrameMs: null,
  }), {
    tier: 'low',
    prompt: false,
    reason: 'harmony-unknown-safe-fallback',
    persistPromptSuppression: false,
  });
});

test('weak Android starts low and advises before combat', () => {
  const result = policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 3, benchmarkFrameMs: 42,
  });

  assert.deepEqual(result, {
    tier: 'low',
    prompt: true,
    reason: 'android-below-baseline',
    persistPromptSuppression: false,
  });
});

test('Android low-RAM and emulator signals force low mode without an unsafe high-mode prompt', () => {
  for (const constrained of [
    { lowRamDevice: true, emulator: false },
    { lowRamDevice: false, emulator: true },
  ]) {
    assert.deepEqual(policy.resolveGraphicsDecision({
      platform: 'android', memoryGB: 8, availableMemoryGB: 6,
      benchmarkFrameMs: 16, ...constrained,
    }), {
      tier: 'low',
      prompt: false,
      reason: constrained.emulator ? 'android-emulator' : 'android-runtime-constrained',
      persistPromptSuppression: false,
    });
  }
});

test('critically low Android available memory forces low mode', () => {
  assert.equal(policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 8, availableMemoryGB: 0.5,
    lowRamDevice: false, emulator: false, benchmarkFrameMs: 16,
  }).reason, 'android-runtime-constrained');
});

test('do-not-ask-again suppresses later Android advice', () => {
  const result = policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 3, benchmarkFrameMs: 42, promptPreference: 'never',
  });

  assert.deepEqual(result, {
    tier: 'low',
    prompt: false,
    reason: 'android-below-baseline',
    persistPromptSuppression: true,
  });
});

test('a requested web tier is honored ahead of the web default', () => {
  assert.deepEqual(policy.resolveGraphicsDecision({
    platform: 'web', memoryGB: null, benchmarkFrameMs: null, requestedTier: 'low',
  }), {
    tier: 'low',
    prompt: false,
    reason: 'user-selected',
    persistPromptSuppression: false,
  });
});

test('Android asks only below the memory or frame-time baseline', () => {
  assert.equal(policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 4, benchmarkFrameMs: 40,
  }).prompt, false);
  assert.equal(policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 4, benchmarkFrameMs: 41,
  }).prompt, true);
  assert.equal(policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 3.5, benchmarkFrameMs: 16,
  }).prompt, true);
});

test('native Android with no capability report starts conservatively', () => {
  assert.deepEqual(policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: null, benchmarkFrameMs: null,
  }), {
    tier: 'low',
    prompt: true,
    reason: 'android-below-baseline',
    persistPromptSuppression: false,
  });
});

test('performance advice is allowed only before combat starts', () => {
  const decision = policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 3, benchmarkFrameMs: 42,
  });

  assert.equal(policy.shouldShowGraphicsPrompt(decision, 'pre-combat'), true);
  assert.equal(policy.shouldShowGraphicsPrompt(decision, 'playing'), false);
});

test('Cocos native OS detection reaches Android and Harmony without a DOM', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const OS = {
    ANDROID: 'Android',
    IOS: 'iOS',
    OSX: 'OS X',
    OHOS: 'OHOS',
    OPENHARMONY: 'OpenHarmony',
  };

  assert.equal(policy.resolveRuntimePlatform(undefined, {
    isNative: true, os: OS.ANDROID, OS,
  }), 'android');
  assert.equal(policy.resolveRuntimePlatform(undefined, {
    isNative: true, os: OS.OHOS, OS,
  }), 'harmonyos');
  assert.equal(policy.resolveRuntimePlatform(undefined, {
    isNative: true, os: OS.OPENHARMONY, OS,
  }), 'harmonyos');
  assert.equal(policy.resolveRuntimePlatform('ios', {
    isNative: true, os: OS.ANDROID, OS,
  }), 'ios', 'trusted shell signal remains authoritative');
  assert.equal(policy.resolveRuntimePlatform(undefined, {
    isNative: false, os: OS.ANDROID, OS,
  }), undefined, 'browser OS strings must not masquerade as native');
});

test('native advice is subscribable and never awaits persistence before local suppression', async () => {
  const channel = advice.createGraphicsAdviceChannel();
  const decision = policy.resolveGraphicsDecision({
    platform: 'android', memoryGB: 3, benchmarkFrameMs: 42,
  });
  const received = [];
  let state = 'pre-combat';
  let releaseWrite;
  let writeCompleted = false;
  channel.subscribe((request) => received.push(request));

  assert.equal(channel.publish(decision, {
    simulationState: () => state,
    applyTier: () => assert.fail('never must not switch tiers'),
    persistNever: () => new Promise((resolve) => {
      releaseWrite = () => {
        writeCompleted = true;
        resolve();
      };
    }),
  }), true);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].actions.map((action) => action.id), [
    'switch-now', 'not-now', 'never',
  ]);

  let resolved = false;
  const action = channel.perform('never').then((result) => {
    resolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(channel.isPromptSuppressed(), false);
  releaseWrite();
  assert.equal(await action, true);
  assert.equal(writeCompleted, true);
  assert.equal(channel.isPromptSuppressed(), true);

  channel.setPromptSuppressed(false);
  state = 'playing';
  assert.equal(channel.publish(decision, {
    simulationState: () => state,
    applyTier: () => {},
    persistNever: async () => {},
  }), false, 'no native prompt may emit after combat starts');
  assert.equal(received.length, 1);
});

test('selected tiers create fresh immutable world profiles at exact allocation budgets', () => {
  const low = worldProfiles.createWorldStreamProfile(profiles.GRAPHICS_PROFILES.low);
  const anotherLow = worldProfiles.createWorldStreamProfile(profiles.GRAPHICS_PROFILES.low);
  const high = worldProfiles.createWorldStreamProfile(profiles.GRAPHICS_PROFILES.high);

  assert.notEqual(low, anotherLow);
  assert.equal(Object.isFrozen(low), true);
  assert.equal(Object.isFrozen(low.debrisPerChunk), true);
  assert.equal(Object.isFrozen(low.debrisCollidersPerChunk), true);
  assert.equal(low.activeWorldChunks, 1);
  assert.equal(low.debrisPerChunk.length, 1);
  assert.equal(low.debrisPerChunk.reduce((sum, count) => sum + count, 0), 14);
  assert.equal(low.debrisColliderCount, 4);
  assert.deepEqual(low.debrisCollidersPerChunk, [4]);
  assert.equal(low.detailedOutpost, false);
  assert.equal(high.activeWorldChunks, 25);
  assert.equal(high.debrisPerChunk.length, 25);
  assert.equal(high.debrisPerChunk.reduce((sum, count) => sum + count, 0), 180);
  assert.equal(high.debrisColliderCount, 180);
  assert.equal(high.debrisCollidersPerChunk.reduce((sum, count) => sum + count, 0), 180);
  assert.equal(high.detailedOutpost, true);
});

test('render scale is deterministically clamped to each profile bounds', () => {
  assert.equal(profiles.resolveRenderScale(profiles.GRAPHICS_PROFILES.low, 0.2), 0.48);
  assert.equal(profiles.resolveRenderScale(profiles.GRAPHICS_PROFILES.low, 0.6), 0.6);
  assert.equal(profiles.resolveRenderScale(profiles.GRAPHICS_PROFILES.low, 1), 0.64);
  assert.equal(profiles.resolveRenderScale(profiles.GRAPHICS_PROFILES.high), 1);
});

test('combat bootstrap applies the resolved profile once before creating runtime resources', () => {
  const source = readFileSync(bootstrapPath, 'utf8');
  const prepareSource = methodSource(
    source,
    'private async prepareGraphicsProfile',
    'private graphicsParticleRate',
  );
  const initializeSource = methodSource(
    source,
    'private async initialize()',
    'private dispatchCombatState',
  );
  const particleSource = methodSource(
    source,
    'private createSpeedParticles',
    'private updateCamera',
  );
  const applySource = methodSource(
    source,
    'public applyGraphicsTier',
    'private initializePlatformRuntime',
  );
  const applyIndex = initializeSource.indexOf('this.applyGraphicsTier(this.graphicsTier)');

  assert.doesNotMatch(prepareSource, /applyGraphicsTier/);
  assert.doesNotMatch(particleSource, /applyGraphicsTier/);
  assert.equal(
    initializeSource.match(/this\.applyGraphicsTier\(this\.graphicsTier\)/g)?.length,
    1,
  );
  assert.ok(applyIndex > initializeSource.indexOf('await this.prepareGraphicsProfile()'));
  assert.ok(applyIndex < initializeSource.indexOf("new Node('CombatRuntime')"));
  assert.ok(applyIndex < initializeSource.indexOf('new WorldStreamer'));
  assert.ok(applyIndex < initializeSource.indexOf('this.createSpeedParticles'));
  assert.match(source, /public applyGraphicsTier\(tier: GraphicsTier\)/);
  assert.doesNotMatch(source, /applyWorldBudget/);
  assert.doesNotMatch(source, /Object\.assign/);
  assert.match(source, /resolveRuntimePlatform\([^)]*sys/);
  assert.match(
    prepareSource,
    /platform:\s*runtimePlatform\(\)\s*\|\|\s*platform\.platform/,
    'native Android must not inherit the web fallback bridge platform',
  );
  assert.match(source, /game\.frameRate\s*=\s*this\.graphicsProfile\.targetFps/);
  assert.match(source, /pipeline\.shadingScale\s*=\s*renderScale/);
  assert.match(source, /createWorldStreamProfile\(this\.graphicsProfile\)/);
  assert.match(source, /projectilePoolSize/);
  assert.match(source, /feedbackLights/);
  assert.match(source, /maxVisibleEnemies/);
  assert.match(source, /graphicsAdviceChannel\.publish/);
  assert.doesNotMatch(applySource, /destroyAllChildren/);
  assert.match(applySource, /removeAllChildren\(\)/);
});

test('world streamer allocates from the selected profile before creating chunks', () => {
  const source = readFileSync(worldStreamerPath, 'utf8');
  const constructorSource = methodSource(source, 'public constructor', 'public update');
  const createSource = methodSource(source, 'private createChunk', 'private addStationPart');

  assert.match(constructorSource, /profile\.activeWorldChunks/);
  assert.match(constructorSource, /profile\.detailedOutpost/);
  assert.match(constructorSource, /this\.createChunk\(index\)/);
  assert.match(createSource, /profile\.debrisPerChunk\[index\]/);
  assert.match(createSource, /profile\.debrisCollidersPerChunk\[index\]/);
  assert.doesNotMatch(source, /Math\.ceil\([^)]*decorationBudget/);
});
