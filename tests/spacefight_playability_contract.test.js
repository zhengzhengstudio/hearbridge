const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const files = {
  web: 'website/spacefight.zhengzhengstudio.cn/index.html',
  webCss: 'SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css',
  webGame: 'SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts',
  webInput: 'SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts',
  webRenderer: 'SpaceFight-Cocos/assets/scripts/game/ProjectilePresenter.ts',
  webShip: 'SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts',
  webSimulation: 'SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts',
  android: 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt',
  androidBundle: 'SpaceFight-Cocos/native-build/spacefight-android/data/assets/main/index.3953d.js',
  cocosHud: 'SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts',
  cocosLocalization: 'SpaceFight-Cocos/assets/scripts/ui/Localization.ts',
  androidTheme: 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/values/themes.xml',
  androidNightTheme: 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/values-night/themes.xml',
  appleScene: 'apps/SpaceFightShared/NativeGameScene.swift',
  ios: 'apps/SpaceFight-iOS/Sources/main.swift',
  macos: 'apps/SpaceFightMac/Sources/main.swift',
  harmony: 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets',
  harmonyOffline: 'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets',
};

test('web launch deck teaches device-specific movement, aiming, firing, and camera controls', () => {
  const html = read(files.web);
  assert.match(html, /W\s?A\s?S\s?D/);
  assert.match(html, /鼠标瞄准|鼠标移动控制机头/);
  assert.match(html, /左键开火/);
  assert.match(html, /camera-readout[\s\S]*F2/);
  assert.match(html, /id="MoveStick"/);
  assert.match(html, /id="AimSurface"[\s\S]*拖动瞄准/);
  assert.match(html, /id="PrimaryControl"[\s\S]*主炮/);
});

test('web touch controls remain visible and explain every flight control role', () => {
  const input = read(files.webInput);
  const css = read(files.webCss);
  const html = read(files.web);

  for (const id of ['MoveStick', 'PrimaryControl', 'SecondaryControl', 'BoostControl', 'CameraControl', 'PauseControl']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /data-input-mode="touch"/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(input, /primaryFire/);
  assert.match(input, /secondaryFire/);
  assert.match(input, /canvas\.addEventListener\(['"]pointerdown['"]/);
  assert.match(input, /setPointerCapture/);
});

test('every client shows the simulation-authentic muzzle and weapon trajectory', () => {
  const renderer = read(files.webRenderer);
  const ship = read(files.webShip);
  const simulation = read(files.webSimulation);
  assert.match(ship, /primaryMuzzleTransform/);
  assert.match(ship, /secondaryMuzzleTransform/);
  assert.match(ship, /computeMuzzlePosition/);
  assert.match(renderer, /projectile\.position/);
  assert.doesNotMatch(renderer, /muzzle\.worldPosition/);
  assert.match(simulation, /computeMuzzleDirection\(origin, convergencePoint\)/);

  // Android ships the Cocos export, not the retired 2D project, so verify the
  // muzzle rig actually reaches the published bundle instead of grepping dead source.
  const androidBundle = read(files.androidBundle);
  assert.match(androidBundle, /primaryMuzzleTransform/);
  assert.match(androidBundle, /secondaryMuzzleTransform/);
  assert.match(androidBundle, /computeMuzzlePosition/);

  const apple = read(files.appleScene);
  assert.match(apple, /updateFireVector\(snapshot\)/);
  assert.match(apple, /forwardX \* 1\.4/);
  assert.match(apple, /"fx\.fireOrigin"/);
  assert.match(apple, /"fx\.firePipper"/);

  for (const harmonyPath of [files.harmony, files.harmonyOffline]) {
    const harmony = read(harmonyPath);
    assert.match(harmony, /drawFireVector\(c, width, height\)/);
    assert.match(harmony, /forwardX \* 1\.4/);
    assert.match(harmony, /fillText\('炮口'/);
    assert.match(harmony, /fillText\('主炮'/);
    assert.match(harmony, /Text\('推进 · 平移'\)/);
    assert.match(harmony, /Text\('机头转向'\)/);
    assert.match(harmony, /Text\('主武器'\)/);
  }
});

test('web combat exposes working pause and first/third-person camera perspectives', () => {
  const html = read(files.web);
  const game = read(files.webGame);

  assert.match(html, /id="CameraControl"/);
  assert.match(html, /id="PauseControl"/);
  assert.match(html, /id="PauseOverlay"/);
  assert.match(game, /snapshot\.cameraMode === 'cockpit'/);
  assert.match(game, /this\.togglePauseRequested/);
});

test('native clients expose an interactive first-flight calibration and control recap', () => {
  // Android and HarmonyOS offline ship the Cocos export, so the calibration must
  // live in the shared Cocos HUD rather than the retired 2D Android project.
  const hud = read(files.cocosHud);
  const localization = read(files.cocosLocalization);
  assert.match(hud, /trainingStep/);
  assert.match(hud, /NativeTrainingPanel/);
  assert.match(hud, /tutorial\.calibration/);
  assert.match(hud, /tutorial\.move/);
  assert.match(hud, /tutorial\.aim/);
  assert.match(hud, /tutorial\.weapon/);
  assert.match(localization, /'tutorial\.calibration': '飞行校准'/);
  assert.match(localization, /'tutorial\.move': '拖动移动杆推进与横移'/);
  assert.match(localization, /'tutorial\.aim': '拖动瞄准区并按独立开火键'/);
  assert.match(localization, /'tutorial\.weapon': '点选底部武器切换主炮与副武器'/);
  assert.match(localization, /'tutorial\.independence': '移动、瞄准、开火相互独立，互不抢键'/);

  const apple = read(files.appleScene);
  assert.match(apple, /trainingStep/);
  assert.match(apple, /飞行校准/);
  assert.match(apple, /拖动移动杆推进与横移/);
  assert.match(apple, /独立开火键/);
  assert.match(apple, /WASD/);

  assert.match(read(files.ios), /移动、瞄准与开火相互独立/);
  assert.match(read(files.macos), /WASD 移动/);

  for (const harmonyPath of [files.harmony, files.harmonyOffline]) {
    const harmony = read(harmonyPath);
    assert.match(harmony, /trainingStep/);
    assert.match(harmony, /飞行校准/);
    assert.match(harmony, /拖动移动杆推进与横移/);
    assert.match(harmony, /拖动瞄准区并按独立开火键/);
    assert.match(harmony, /点选底部武器/);
    assert.match(harmony, /leftTouchId/);
    assert.match(harmony, /rightTouchId/);
    assert.match(harmony, /changedTouches/);
    assert.match(harmony, /this\.leftTouchId = -1/);
    assert.match(harmony, /this\.rightTouchId = -1/);
  }
});

test('Android battle launches in an immersive no-action-bar game theme', () => {
  for (const theme of [read(files.androidTheme), read(files.androidNightTheme)]) {
    assert.match(theme, /NoActionBar/);
    assert.match(theme, /windowFullscreen/);
    assert.doesNotMatch(theme, /purple_/);
  }
  const android = read(files.android);
  assert.match(android, /WindowInsetsControllerCompat/);
  assert.match(android, /WindowInsetsCompat\.Type\.systemBars/);
  assert.match(android, /loadVisualAssetsAsync/);
  assert.doesNotMatch(android, /setLayerType\(LAYER_TYPE_SOFTWARE/);
  assert.doesNotMatch(android, /battlefield\s+by\s+lazy\s*\{\s*BitmapFactory\.decodeResource/);
});

test('macOS app keeps its delegate alive for the full application run loop', () => {
  const source = read(files.macos);
  assert.match(source, /withExtendedLifetime\(delegate\)/);
});
