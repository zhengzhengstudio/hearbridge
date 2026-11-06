'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('project owns a full-HD launcher key art asset', () => {
  const file = path.join(root, 'SpaceFight-Cocos/assets/resources/ui/launcher/spacefight-launcher-keyart.png');
  assert.ok(fs.existsSync(file));
  assert.ok(fs.statSync(file).size > 1_000_000);
});

test('Android covers engine startup with SpaceFight branding until Cocos is ready', () => {
  const activity = read('SpaceFight-Cocos/native/engine/android/app/src/com/cocos/game/AppActivity.java');
  assert.match(activity, /showSpaceFightLaunchScreen\(\)/);
  assert.match(activity, /hideSpaceFightLaunchScreen/);
  assert.match(activity, /spacefight_launcher_keyart/);
  assert.match(activity, /SPACEFIGHT/);
  assert.match(activity, /ORBITAL FRONTIER/);
  assert.doesNotMatch(activity, /Cocos Creator/);
});

test('Cocos presents a branded verification layer and key-art operations lobby', () => {
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  assert.match(hud, /NativeBootPanel/);
  assert.match(hud, /NativeBootProgress/);
  assert.match(hud, /ui\/launcher\/spacefight-launcher-keyart/);
  assert.match(hud, /resources\.load\(`\$\{path\}\/texture`, Texture2D/);
  assert.match(hud, /SPACEFIGHT/);
  assert.match(hud, /ORBITAL FRONTIER/);
  assert.match(hud, /this\.bootPanel\.active = false/);
  assert.match(bootstrap, /dismissNativeLaunchScreen/);
});

test('expanded equipment catalog contains at least fifty real choices', () => {
  const catalog = read('SpaceFight-Cocos/assets/scripts/core/WeaponCatalog.ts');
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  for (const id of ['ion', 'beam', 'swarm', 'mine', 'jammer', 'overclock', 'vanguard', 'inertial-drive', 'phase-screen', 'decoy-drone', 'stabilizer', 'hazard']) {
    assert.match(catalog + hud, new RegExp(`['\"]${id}['\"]`));
  }
  const optionBlock = hud.match(/const LOADOUT_OPTIONS = \{([\s\S]*?)\} as const;/)?.[1] || '';
  const count = (optionBlock.match(/'[^']+'/g) || []).length;
  assert.ok(count >= 50, `expected at least 50 equipment choices, received ${count}`);
});

test('native death state always exposes restart and return-to-outpost actions', () => {
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  assert.match(hud, /NativeDefeatPanel/);
  assert.match(hud, /snapshot\.mission\.status === 'failed'/);
  assert.match(hud, /NativeDefeatRestart/);
  assert.match(hud, /NativeDefeatReturn/);
  assert.match(hud, /this\.setHomeOpen\(true\)/);
  assert.match(bootstrap, /this\.handleRestart/);
});

test('native defeat is terminal for the frame and hides every combat control', () => {
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  assert.match(
    hud,
    /this\.setDefeatOpen\(snapshot\.mission\.status === 'failed'\);[\s\S]*?if \(snapshot\.mission\.status === 'failed'\) \{[\s\S]*?this\.canReturn = false;[\s\S]*?return;[\s\S]*?\}/,
  );
  assert.match(
    hud,
    /\[this\.hullStatusBar, this\.shieldStatusBar, this\.energyStatusBar, this\.targetHealthBar, this\.hitMarker\]/,
  );
  assert.match(hud, /return this\.loadoutOpen \|\| this\.homeOpen \|\| this\.defeatOpen/);
  assert.match(
    hud,
    /if \(open\) \{[\s\S]*?this\.inputReleaseVisuals\(\);[\s\S]*?this\.setCombatChromeVisible\(false\);[\s\S]*?return;/,
  );
});

test('mobile controls use a compact thumb arc and responsive camera travel', () => {
  const layout = read('SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts');
  const touch = read('SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts');
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  assert.match(layout, /const radius = 78 \* scale/);
  assert.match(layout, /primaryFire[^\n]+radius: 50 \* sizedScale/);
  assert.match(touch, /LOOK_PIXELS_FOR_FULL_AXIS = 32/);
  assert.match(touch, /ANALOG_RESPONSE_EXPONENT = 0\.62/);
  assert.match(hud, /drawActionControl/);
});
