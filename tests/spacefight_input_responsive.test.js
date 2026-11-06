const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const desktop = read('SpaceFight-Cocos/assets/scripts/input/DesktopFlightInput.ts');
const bridge = read('SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts');
const touch = read('SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts');
const shell = read('SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css');
const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');

function optionalRead(file) {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

test('desktop input keeps F5 and IME composition outside gameplay', () => {
  assert.match(desktop, /event\.isComposing \|\| event\.code === 'F5'/);
  assert.match(desktop, /'F2', 'Escape'/);
  assert.match(desktop, /requestPointerLock/);
  assert.match(desktop, /exitPointerLock/);
  assert.match(desktop, /ctrlKey && keyboardEvent\.altKey/);
  assert.match(desktop, /keyboardEvent\.code === 'Escape'/);
  assert.match(desktop, /canCapturePointer\(\)/);
  assert.match(desktop, /canHandleGameplay\(\)/);
  assert.match(desktop, /mousemove/);
});

test('touch movement, relative look, and combat actions remain independent', () => {
  assert.match(touch, /movementPointer/);
  assert.match(touch, /lookPointer/);
  assert.match(touch, /this\.lookX \+= x - this\.lookPointer\.x/);
  assert.match(touch, /primaryFire: activeActions\.has\('primaryFire'\)/);
  assert.match(bridge, /new Map<number, BrowserPointerRole>/);
  assert.match(bridge, /setPointerCapture/);
});

test('touch hit regions use safe-area insets and stable landscape coordinates', () => {
  assert.match(bridge, /safeLeft/);
  assert.match(bridge, /safeRight/);
  assert.match(bridge, /safeTop/);
  assert.match(bridge, /safeBottom/);
  assert.match(bridge, /windowRef\.innerWidth/);
  assert.match(bridge, /windowRef\.innerHeight/);
});

test('responsive shell separates portrait guard, short landscape, and combat controls', () => {
  assert.match(shell, /@media \(orientation: portrait\) and \(pointer: coarse\)/);
  assert.match(shell, /@media \(max-height: 420px\) and \(orientation: landscape\)/);
  assert.match(shell, /data-orientation-blocked="true"/);
  assert.match(shell, /#MoveStick/);
  assert.match(shell, /#PrimaryControl/);
  assert.match(shell, /#CameraControl/);
  assert.match(shell, /#PauseControl/);
});

test('native apps use Cocos input and keep desktop free of touch joysticks', () => {
  const nativeBridge = optionalRead('SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts');
  const nativeHud = optionalRead('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');

  assert.match(bootstrap, /sys\.isNative/);
  assert.match(bootstrap, /initializeCocosInput/);
  assert.match(bootstrap, /sys\.isMobile\s*\?\s*'touch'\s*:\s*'desktop'/);
  assert.match(nativeBridge, /Input\.EventType\.KEY_DOWN/);
  assert.match(nativeBridge, /Input\.EventType\.MOUSE_MOVE/);
  assert.match(nativeBridge, /Input\.EventType\.TOUCH_START/);
  assert.match(nativeBridge, /getUILocation/);
  assert.match(nativeBridge, /refreshInteractionState/);
  assert.match(nativeHud, /allowsPauseToggle/);
  assert.match(nativeBridge, /this\.setNativeCursorCaptured\(false\)/);
  assert.match(nativeBridge, /view\.getVisibleSize\(\)\.height\s*-\s*point\.y/);
  assert.doesNotMatch(nativeBridge, /getLocationInView/);
  assert.match(nativeHud, /touchEnabled/);
  assert.match(nativeHud, /if \(!this\.touchEnabled\) return/);
});

test('native touch HUD uses safe landscape regions and visible aim feedback', () => {
  const nativeBridge = optionalRead('SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts');
  const nativeHud = optionalRead('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');

  assert.match(nativeBridge, /sys\.getSafeAreaRect\(false\)/);
  assert.match(nativeBridge, /safeInsetsFromRect/);
  assert.match(nativeBridge, /touchLayout\?\./);
  assert.match(nativeBridge, /pointerRoleAt/);
  assert.match(nativeHud, /FixedMoveStick/);
  assert.match(nativeHud, /PrimaryFire/);
  assert.match(nativeHud, /AimReticle/);
  assert.match(nativeHud, /movementControlCircle/);
  assert.match(nativeHud, /this\.leftHanded/);
  assert.match(nativeHud, /this\.controlScale/);
  assert.match(nativeHud, /shotFeedbackFrames/);
  assert.match(nativeHud, /syncCombat/);
});

test('native joystick has threshold, direction, and visual-only release feedback', () => {
  const nativeBridge = optionalRead('SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts');
  const nativeHud = optionalRead('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');

  assert.match(nativeBridge, /touchStickFeedback/);
  assert.match(nativeBridge, /setStickFeedback/);
  assert.match(nativeBridge, /lastStickHapticAt/);
  assert.match(nativeHud, /drawStickDirection/);
  assert.match(nativeHud, /drawStickDeadzone/);
  assert.match(nativeHud, /tween\(this\.stickThumb\)/);
  assert.match(nativeHud, /\.to\(0\.1, \{ position: target \}\)/);
});

test('native fire button gives immediate haptic feedback while preserving hold input', () => {
  const nativeBridge = optionalRead('SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts');
  assert.match(nativeBridge, /role === 'primaryFire'/);
  assert.match(nativeBridge, /this\.emitHaptic\?\.\(\)/);
  assert.match(nativeBridge, /this\.touch\.beginAction\(pointerId, role\)/);
});
