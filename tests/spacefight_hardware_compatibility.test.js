'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Android native shell exposes a bounded local capability bridge', () => {
  const activity = read('SpaceFight-Cocos/native/engine/android/app/src/com/cocos/game/AppActivity.java');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/platform/PlatformBootstrap.ts');

  assert.match(activity, /public static String spaceFightInvoke\(String method, String payload\)/);
  assert.match(activity, /ActivityManager\.MemoryInfo/);
  assert.match(activity, /memoryInfo\.totalMem \/ 1073741824\.0/);
  assert.match(activity, /Runtime\.getRuntime\(\)\.availableProcessors\(\)/);
  assert.match(activity, /getDeviceConfigurationInfo\(\)\.reqGlEsVersion/);
  assert.match(activity, /metrics\.widthPixels/);
  assert.match(activity, /new WeakReference<>\(this\)/);
  assert.match(bootstrap, /androidReflectionHost/);
  assert.match(bootstrap, /com\/cocos\/game\/AppActivity/);
});

test('native capability payloads are bounded before graphics policy sees them', () => {
  const bridge = read('SpaceFight-Cocos/assets/scripts/platform/NativePlatformBridge.ts');

  assert.match(bridge, /Number\.isFinite\(value\)/);
  assert.match(bridge, /finiteNumber\(snapshot\.memoryGB, 0\.25, 256\)/);
  assert.match(bridge, /finiteNumber\(snapshot\.viewportWidth, 0, 32768\)/);
  assert.match(bridge, /finiteNumber\(snapshot\.pixelRatio, 0\.25, 8\)/);
  assert.match(bridge, /Math\.floor\(logicalCores\)/);
});

test('Harmony window-stage teardown hides native rendering and removes its listener', () => {
  const ability = read('SpaceFight-Cocos/native/engine/harmonyos-next/entry/src/main/ets/entryability/EntryAbility.ets');

  assert.match(ability, /private activeWindowStage: window\.WindowStage \| undefined/);
  assert.match(ability, /windowStage\.on\("windowStageEvent", this\.windowStageEventHandler\)/);
  assert.match(ability, /onWindowStageDestroy\(\)[\s\S]*windowStageType\.hide/);
  assert.match(ability, /activeWindowStage\?\.off\("windowStageEvent", this\.windowStageEventHandler\)/);
});

test('native bundles stay partitioned within the current mobile disk budget', () => {
  function directoryBytes(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
      const absolute = path.join(directory, entry.name);
      return total + (entry.isDirectory() ? directoryBytes(absolute) : fs.statSync(absolute).size);
    }, 0);
  }

  const lowBytes = directoryBytes(path.join(root, 'SpaceFight-Cocos/assets/resources'));
  const highBytes = directoryBytes(path.join(root, 'SpaceFight-Cocos/assets/spacefight-high'));
  // The base bundle includes launcher, hangar, and station key art. Runtime
  // entity, lighting, projectile, and enemy budgets are tested separately.
  assert.ok(lowBytes <= 18 * 1024 * 1024, `low bundle is ${lowBytes} bytes`);
  assert.ok(highBytes <= 28 * 1024 * 1024, `high bundle is ${highBytes} bytes`);

  const bundlePolicy = read('SpaceFight-Cocos/assets/scripts/performance/AssetBundlePolicy.ts');
  assert.match(bundlePolicy, /LOW_BUNDLES[\s\S]*\['resources'\]/);
  assert.match(bundlePolicy, /HIGH_BUNDLES[\s\S]*'spacefight-high'/);
});

test('native target matrix is landscape and ABI support is explicit', () => {
  for (const configName of [
    'build-android-foundation.json',
    'build-harmony-foundation.json',
    'build-harmony-offline-foundation.json',
  ]) {
    const config = JSON.parse(read(`SpaceFight-Cocos/config/${configName}`));
    const target = config.packages[config.platform];
    assert.deepEqual(target.orientation, {
      portrait: false,
      upsideDown: false,
      landscapeRight: true,
      landscapeLeft: true,
    });
  }

  const androidGradle = read('SpaceFight-Cocos/native/engine/android/app/build.gradle');
  const harmonyProfile = read('SpaceFight-Cocos/native/engine/harmonyos-next/entry/build-profile.json5');
  assert.match(androidGradle, /abiFilters PROP_APP_ABI\.split\(':'\)/);
  assert.match(harmonyProfile, /abiFilters:\s*\[\s*'arm64-v8a'/);
});

test('Android release targets API 36 with GLES2 fallback and haptic permission', () => {
  const config = JSON.parse(read('SpaceFight-Cocos/config/build-android-foundation.json'));
  assert.equal(config.packages.android.apiLevel, 36);
  assert.deepEqual(config.packages.android.appABIs, ['arm64-v8a']);
  assert.deepEqual(config.packages.android.renderBackEnd, {
    vulkan: false,
    gles3: true,
    gles2: true,
  });
  const manifest = read('SpaceFight-Cocos/native/engine/android/app/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.VIBRATE/);
  assert.match(manifest, /android:glEsVersion="0x00020000"/);
  const builder = read('SpaceFight-Cocos/tools/build-native-target.js');
  assert.match(builder, /PROP_TARGET_SDK_VERSION=36/);
});
