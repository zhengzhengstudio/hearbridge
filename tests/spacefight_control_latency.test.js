'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('native touch controls use a low-dead-zone accelerated response curve', () => {
  const sources = [
    read('ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt'),
    read('apps/SpaceFightShared/NativeGameScene.swift'),
    read('HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets'),
    read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets'),
  ];

  for (const source of sources) {
    assert.match(source, /ANALOG_DEADZONE[^\n]*0\.0[456]/i);
    assert.match(source, /ANALOG_RESPONSE_EXPONENT[^\n]*0\.[67]/i);
    assert.doesNotMatch(source, /raw\s*<=\s*\.?17/);
  }
});

test('HarmonyOS joystick thumb visibly follows its movement values', () => {
  for (const source of [
    read('HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets'),
    read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets'),
  ]) {
    assert.match(source, /\.translate\(\{\s*x:\s*this\.strafe/);
    assert.match(source, /y:\s*-this\.throttle/);
  }
});

test('web mobile profile avoids eager model loading, excessive chunks, and CSM shadows', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');
  const world = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts');
  const worldProfile = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamProfile.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  const graphicsProfile = read('SpaceFight-Cocos/assets/scripts/performance/GraphicsProfile.ts');
  const bridge = read('SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts');

  assert.match(ships, /INITIAL_SHIP_KINDS/);
  assert.doesNotMatch(ships, /Object\.keys\(MODEL_NORMALIZATION\)/);
  assert.match(world, /TOUCH_WORLD_PROFILE[^\n]*|TOUCH_WORLD_PROFILE/);
  assert.match(world, /activeWorldChunks:\s*9/);
  assert.match(world, /decorationBudget:\s*45/);
  assert.match(worldProfile, /Math\.sqrt\(graphicsProfile\.activeWorldChunks\)/);
  assert.match(worldProfile, /const recycleRadius = \(sideLength - 1\) \/ 2/);
  assert.match(worldProfile, /decorationBudget \/ graphicsProfile\.activeWorldChunks/);
  assert.match(bootstrap, /touchOptimized/);
  assert.match(bootstrap, /shadowsEnabled\s*=\s*!sys\.isBrowser\s*&&\s*this\.graphicsProfile\.shadows/);
  assert.match(bootstrap, /keyLight\.enableCSM\s*=\s*shadowsEnabled/);
  assert.match(graphicsProfile, /low:[\s\S]*shadows:\s*false/);
  assert.match(bootstrap, /createWorldStreamProfile\(this\.graphicsProfile\)/);
  assert.match(bootstrap, /innerWidth\s*<=\s*900/);
  assert.match(bootstrap, /innerHeight\s*<=\s*540/);
  assert.match(bridge, /prefersTouchInput/);
  assert.match(bridge, /innerWidth[\s\S]*innerHeight/);
});
