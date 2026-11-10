'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const compiledInputRoot = process.env.SPACEFIGHT_COCOS_COMPILED_INPUT;
assert.ok(compiledInputRoot, 'Run this suite through npm run test:input');

const input = {
  ...require(path.join(compiledInputRoot, 'DesktopFlightInput.js')),
  ...require(path.join(compiledInputRoot, 'BrowserInputBridge.js')),
  ...require(path.join(compiledInputRoot, 'InputRouter.js')),
  ...require(path.join(compiledInputRoot, 'InputSettings.js')),
  ...require(path.join(compiledInputRoot, 'TouchStickFeedback.js')),
  ...require(path.join(compiledInputRoot, 'TouchFlightInput.js')),
  ...require(path.join(compiledInputRoot, 'GamepadFlightInput.js')),
};

function fakeEventTarget(properties = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
    },
    emit(type, event = {}) {
      const complete = {
        preventDefault() {},
        ...event,
      };
      for (const listener of listeners.get(type) || []) listener(complete);
    },
  }, properties);
}

function browserInputHarness({
  width,
  height,
  coarsePointer,
  finePointer,
  maxTouchPoints,
  override,
}) {
  const body = { dataset: { playing: 'true' } };
  if (override) body.dataset.inputModeOverride = override;
  const documentRef = fakeEventTarget({
    body,
    pointerLockElement: null,
    getElementById: () => null,
  });
  const canvas = fakeEventTarget({
    style: {},
    requestPointerLock() {
      documentRef.pointerLockElement = canvas;
    },
    setPointerCapture() {},
  });
  documentRef.pointerLockElement = canvas;
  const windowRef = fakeEventTarget({
    innerWidth: width,
    innerHeight: height,
    navigator: { maxTouchPoints },
    matchMedia(query) {
      return {
        matches: query === '(pointer: coarse)' ? coarsePointer : finePointer,
      };
    },
    getComputedStyle() {
      return { paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' };
    },
  });
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const touch = new input.TouchFlightInput({ width, height }, { sensitivity: 1 });
  const router = new input.InputRouter(desktop, touch);
  const bridge = new input.BrowserInputBridge(router, desktop, touch, input.DEFAULT_INPUT_SETTINGS);
  const detach = bridge.attach(canvas, documentRef, windowRef);
  return { body, canvas, documentRef, windowRef, router, detach };
}

function desktopShellHarness({
  width,
  height,
  coarsePointer,
  finePointer,
  maxTouchPoints,
  storedMode,
  hostMode,
}) {
  const body = { dataset: {} };
  if (hostMode) body.dataset.inputMode = hostMode;
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, fakeEventTarget({
        id,
        dataset: {},
        style: { setProperty() {} },
        disabled: false,
        textContent: '',
        focus() {},
        async requestPointerLock() {},
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 192, height: 192 };
        },
      }));
    }
    return elements.get(id);
  };
  const documentRef = fakeEventTarget({
    body,
    documentElement: { async requestFullscreen() {} },
    fullscreenElement: null,
    pointerLockElement: null,
    getElementById: element,
    querySelectorAll: () => [],
  });
  const values = new Map();
  if (storedMode) values.set('spacefight.input-mode.v1', storedMode);
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const windowRef = fakeEventTarget({
    innerWidth: width,
    innerHeight: height,
    location: { search: '', reload() {} },
    setTimeout: () => 0,
    dispatchEvent() {},
  });
  windowRef.window = windowRef;
  const matchMedia = query => ({
    matches: query === '(pointer: coarse)' ? coarsePointer : finePointer,
  });
  const context = {
    window: windowRef,
    document: documentRef,
    navigator: { maxTouchPoints },
    localStorage,
    matchMedia,
    screen: { orientation: {} },
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    console,
  };
  vm.runInNewContext(readFileSync(
    path.join(__dirname, '../SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.js'),
    'utf8',
  ), context);
  return { body, canvas: element('GameCanvas'), windowRef };
}

test('desktop mouse delta keeps turning the camera when pointer lock is unavailable', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });

  desktop.handleMouseMove({ movementX: 40, movementY: -20 });
  const fallback = desktop.consumeCommand();
  assert.ok(fallback.yaw >= 0.76, `unlocked yaw fallback remained resistant: ${fallback.yaw}`);
  assert.ok(fallback.pitch >= 0.38, `unlocked pitch fallback remained resistant: ${fallback.pitch}`);

  desktop.handlePointerLockChange(true);
  desktop.handleMouseMove({ movementX: 40, movementY: -20 });
  const command = desktop.consumeCommand();
  assert.ok(command.yaw >= 0.76, `desktop yaw remained resistant: ${command.yaw}`);
  assert.ok(command.pitch >= 0.38, `desktop pitch remained resistant: ${command.pitch}`);
  assert.equal(desktop.consumeCommand().yaw, 0, 'mouse delta is frame-local');
});

test('first canvas press captures the pointer without leaving fire held', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const documentRef = fakeEventTarget({ pointerLockElement: null });
  documentRef.exitPointerLock = () => { documentRef.pointerLockElement = null; };
  let pointerLockRequests = 0;
  const canvas = fakeEventTarget({
    requestPointerLock() {
      pointerLockRequests += 1;
      return Promise.resolve();
    },
  });
  desktop.attach(canvas, documentRef);

  canvas.emit('mousedown', { button: 0 });

  assert.equal(pointerLockRequests, 1);
  assert.equal(desktop.consumeCommand().primaryFire, false);
  documentRef.pointerLockElement = canvas;
  documentRef.emit('pointerlockchange');
  canvas.emit('mousedown', { button: 0 });
  assert.equal(desktop.consumeCommand().primaryFire, true);
  documentRef.emit('mouseup', { button: 0 });
  assert.equal(desktop.consumeCommand().primaryFire, false);
  desktop.detach();
});

test('ctrl-alt releases pointer lock and clears held fire', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const documentRef = fakeEventTarget({ pointerLockElement: null });
  let exits = 0;
  documentRef.exitPointerLock = () => {
    exits += 1;
    documentRef.pointerLockElement = null;
  };
  const canvas = fakeEventTarget({ requestPointerLock() {} });
  documentRef.pointerLockElement = canvas;
  desktop.attach(canvas, documentRef);
  canvas.emit('mousedown', { button: 0 });
  assert.equal(desktop.consumeCommand().primaryFire, true);

  documentRef.emit('keydown', { code: 'AltLeft', ctrlKey: true, altKey: true });

  assert.equal(exits, 1);
  assert.equal(desktop.consumeCommand().primaryFire, false);
  desktop.detach();
});

test('escape pauses and releases pointer lock without losing the pause command', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const documentRef = fakeEventTarget({ pointerLockElement: null });
  let exits = 0;
  documentRef.exitPointerLock = () => {
    exits += 1;
    documentRef.pointerLockElement = null;
  };
  const canvas = fakeEventTarget({ requestPointerLock() {} });
  documentRef.pointerLockElement = canvas;
  desktop.attach(canvas, documentRef);

  documentRef.emit('keydown', { code: 'Escape' });

  assert.equal(exits, 1);
  assert.equal(desktop.consumeCommand().pause, true);
  assert.equal(desktop.consumeCommand().pause, false);
  desktop.detach();
});

test('browser capture guard keeps launcher and paused screens clickable', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const documentRef = fakeEventTarget({ pointerLockElement: null });
  let requests = 0;
  const canvas = fakeEventTarget({ requestPointerLock() { requests += 1; } });
  let combatActive = false;
  desktop.attach(canvas, documentRef, () => combatActive);

  canvas.emit('mousedown', { button: 0 });
  assert.equal(requests, 0);
  combatActive = true;
  canvas.emit('mousedown', { button: 0 });
  assert.equal(requests, 1);
  desktop.detach();
});

test('launcher ignores gameplay keys while paused combat still accepts escape', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  const documentRef = fakeEventTarget({ pointerLockElement: null });
  documentRef.exitPointerLock = () => {};
  const canvas = fakeEventTarget({ requestPointerLock() {} });
  let playing = false;
  desktop.attach(canvas, documentRef, () => playing, () => playing);

  documentRef.emit('keydown', { code: 'KeyW' });
  documentRef.emit('keydown', { code: 'Escape' });
  assert.equal(desktop.consumeCommand().throttle, 0);
  assert.equal(desktop.consumeCommand().pause, false);

  playing = true;
  documentRef.emit('keydown', { code: 'Escape' });
  assert.equal(desktop.consumeCommand().pause, true);
  desktop.detach();
});

test('desktop look preserves a fast swipe up to the look-axis safety cap', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 3 });
  desktop.handlePointerLockChange(true);
  desktop.handleMouseMove({ movementX: 80, movementY: -80 });

  const command = desktop.consumeCommand();

  assert.equal(command.yaw, 4);
  assert.equal(command.pitch, 4);
  assert.equal(desktop.consumeCommand().yaw, 0);
});

test('fine primary pointer keeps touch controls disabled despite compact size or passive touch', () => {
  assert.equal(input.prefersTouchInput(667, 375, false, 5, true), false);
  assert.equal(input.prefersTouchInput(900, 540, true, 10, true), false);
  assert.equal(input.prefersTouchInput(1280, 720, false, 10, true), false);
});

test('coarse primary pointer and explicit override select touch mode without viewport guessing', () => {
  assert.equal(input.prefersTouchInput(667, 375, true, 5, false), true);
  assert.equal(input.prefersTouchInput(1024, 768, true, 10, false), true);
  assert.equal(input.prefersTouchInput(667, 375, false, 10, false), false);
  assert.equal(input.prefersTouchInput(1440, 900, false, 0, true, 'touch'), true);
  assert.equal(input.prefersTouchInput(667, 375, true, 5, false, 'desktop'), false);
});

test('browser bridge leaves a touch-capable desktop on keyboard and mouse until real touch', () => {
  const harness = browserInputHarness({
    width: 667,
    height: 375,
    coarsePointer: true,
    finePointer: true,
    maxTouchPoints: 10,
  });

  assert.equal(harness.body.dataset.inputMode, 'desktop');
  assert.equal(harness.router.currentMode(), 'desktop');
  harness.documentRef.emit('keydown', { code: 'KeyW', isComposing: false, repeat: false });
  harness.documentRef.emit('mousemove', { movementX: 40, movementY: 0 });
  const command = harness.router.consumeCommand();
  assert.equal(command.throttle, 1);
  assert.ok(command.yaw >= 0.76);

  harness.canvas.emit('pointerdown', {
    pointerType: 'touch',
    pointerId: 41,
    clientX: 500,
    clientY: 180,
  });
  assert.equal(harness.body.dataset.inputMode, 'touch');
  harness.detach();
});

test('browser bridge starts phone and tablet coarse-pointer landscapes in touch mode', () => {
  for (const [width, height] of [[667, 375], [1024, 768]]) {
    const harness = browserInputHarness({
      width,
      height,
      coarsePointer: true,
      finePointer: false,
      maxTouchPoints: 5,
    });
    assert.equal(harness.body.dataset.inputMode, 'touch');
    assert.equal(harness.router.currentMode(), 'touch');
    harness.detach();
  }
});

test('browser bridge remeasures hidden touch controls on first combat pointer down', () => {
  const bridgeSource = readFileSync(
    path.join(__dirname, '../SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts'),
    'utf8',
  );
  assert.match(bridgeSource, /const pointerDown = \(event: PointerEvent\): void => \{\s*resize\(\);/);
});

test('desktop shell hides joystick for fine pointer and honors genuine touch or host override', () => {
  const shellCss = readFileSync(
    path.join(__dirname, '../SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css'),
    'utf8',
  );
  assert.match(shellCss, /#TouchHud \{ display: none; pointer-events: none; \}/);
  assert.match(shellCss, /data-input-mode="touch"\] #TouchHud \{ display: block; \}/);

  const desktop = desktopShellHarness({
    width: 667,
    height: 375,
    coarsePointer: true,
    finePointer: true,
    maxTouchPoints: 10,
  });
  assert.equal(desktop.body.dataset.inputMode, 'desktop');

  desktop.canvas.emit('pointerdown', {
    pointerType: 'pen',
    pointerId: 7,
    clientX: 500,
    clientY: 180,
  });
  assert.equal(desktop.body.dataset.inputMode, 'touch');

  const phone = desktopShellHarness({
    width: 844,
    height: 390,
    coarsePointer: true,
    finePointer: false,
    maxTouchPoints: 5,
  });
  assert.equal(phone.body.dataset.inputMode, 'touch');

  const staleTouchPreference = desktopShellHarness({
    width: 1440,
    height: 900,
    coarsePointer: false,
    finePointer: true,
    maxTouchPoints: 0,
    storedMode: 'touch',
  });
  assert.equal(staleTouchPreference.body.dataset.inputMode, 'desktop');

  const hostOverridden = desktopShellHarness({
    width: 844,
    height: 390,
    coarsePointer: true,
    finePointer: false,
    maxTouchPoints: 5,
    hostMode: 'desktop',
  });
  assert.equal(hostOverridden.body.dataset.inputMode, 'desktop');
});

test('pointer lock release clears held mouse buttons and pending deltas', () => {
  const desktop = new input.DesktopFlightInput();
  desktop.handlePointerLockChange(true);
  desktop.handleMouseButton(0, true);
  desktop.handleMouseMove({ movementX: 30, movementY: 10 });

  desktop.handlePointerLockChange(false);

  const command = desktop.consumeCommand();
  assert.equal(command.primaryFire, false);
  assert.equal(command.yaw, 0);
  assert.equal(command.pitch, 0);
});

test('composition events and browser-reserved F5/F11 never enter gameplay key state', () => {
  const desktop = new input.DesktopFlightInput();

  desktop.handleKeyDown({ code: 'KeyW', isComposing: true });
  desktop.handleKeyDown({ code: 'F5', isComposing: false });
  desktop.handleKeyDown({ code: 'F11', isComposing: false });

  assert.deepEqual(desktop.consumeCommand(), input.neutralInputCommand());
});

test('desktop maps flight keys and emits F2 camera toggle once', () => {
  const desktop = new input.DesktopFlightInput();
  desktop.handleKeyDown({ code: 'KeyW' });
  desktop.handleKeyDown({ code: 'KeyD' });
  desktop.handleKeyDown({ code: 'ShiftLeft' });
  desktop.handleKeyDown({ code: 'F2' });

  const first = desktop.consumeCommand();
  assert.equal(first.throttle, 1);
  assert.equal(first.strafe, 1);
  assert.equal(first.boost, true);
  assert.equal(first.cameraToggle, true);
  assert.equal(desktop.consumeCommand().cameraToggle, false);
});

test('desktop return command is held on R and releases immediately', () => {
  const desktop = new input.DesktopFlightInput({ sensitivity: 1 });
  desktop.handleKeyDown({ code: 'KeyR' });
  assert.equal(desktop.consumeCommand().returnRequested, true);
  desktop.handleKeyUp({ code: 'KeyR' });
  assert.equal(desktop.consumeCommand().returnRequested, false);
});

test('touch movement uses a fixed left stick instead of recentering on touch', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 });
  const center = touch.movementCenter();

  touch.beginMovement(11, center.x + 48, center.y - 24);
  const command = touch.consumeCommand();

  assert.ok(command.strafe > 0.57);
  assert.ok(command.throttle > 0.28);
  assert.ok(Math.abs((command.strafe / command.throttle) - 2) < 0.001);
  assert.deepEqual(touch.movementCenter(), center);
});

test('small mobile stick deflection produces useful movement immediately', () => {
  const touch = new input.TouchFlightInput({ width: 667, height: 375 });
  const center = touch.movementCenter();

  touch.beginMovement(12, center.x + 13, center.y);
  const command = touch.consumeCommand();

  assert.ok(command.strafe >= 0.25, `20% deflection only produced ${command.strafe}`);
  assert.equal(command.throttle, 0);
});

test('touch stick feedback exposes normalized travel and threshold crossings', () => {
  let state = input.touchStickFeedback(0, 0, 80, true, 'center');
  assert.equal(state.travel, 0);
  assert.equal(state.threshold, 'center');

  state = input.touchStickFeedback(64, 0, 80, true, state.threshold);
  assert.equal(state.travel, 0.8);
  assert.equal(state.threshold, 'cruise');
  assert.equal(state.crossedThreshold, true);

  state = input.touchStickFeedback(120, 0, 80, true, state.threshold);
  assert.equal(state.travel, 1);
  assert.equal(state.threshold, 'full');
});

test('touch stick release zeroes logical displacement immediately', () => {
  const state = input.touchStickFeedback(55, -20, 80, false, 'cruise');
  assert.deepEqual(state.axis, { x: 0, y: 0 });
  assert.equal(state.threshold, 'center');
  assert.equal(state.active, false);
});

test('touch movement follows the visible joystick geometry exactly', () => {
  const touch = new input.TouchFlightInput({ width: 780, height: 360 });
  touch.setMovementGeometry({ x: 71, y: 289 }, 59);

  touch.beginMovement(18, 71, 289);
  assert.equal(touch.consumeCommand().throttle, 0);
  assert.equal(touch.consumeCommand().strafe, 0);

  touch.movePointer(18, 100.5, 289);
  assert.ok(touch.consumeCommand().strafe > 0.58);
});

test('right-side touch look is relative and consumes per-frame movement', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 }, { sensitivity: 1 });
  touch.beginLook(22, 900, 320);
  touch.movePointer(22, 940, 300);

  const command = touch.consumeCommand();
  assert.ok(command.yaw >= 0.9, `touch yaw remained resistant: ${command.yaw}`);
  assert.ok(command.pitch >= 0.45, `touch pitch remained resistant: ${command.pitch}`);
  assert.equal(touch.consumeCommand().yaw, 0);
});

test('right-side touch look preserves a fast swipe up to the look-axis safety cap', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 }, { sensitivity: 3 });
  touch.beginLook(23, 900, 320);
  touch.movePointer(23, 980, 240);

  const command = touch.consumeCommand();

  assert.equal(command.yaw, 4);
  assert.equal(command.pitch, 4);
  assert.equal(touch.consumeCommand().yaw, 0);
});

test('ending a look pointer preserves its final swipe until the frame consumes it', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 });
  touch.beginLook(9, 900, 320);
  touch.movePointer(9, 940, 300);
  touch.endPointer(9);

  const command = touch.consumeCommand();
  assert.ok(command.yaw >= 0.76);
  assert.ok(command.pitch >= 0.38);
  assert.equal(touch.consumeCommand().yaw, 0);
});

test('three touch pointers remain independent when one pointer ends', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 });
  const center = touch.movementCenter();
  touch.beginMovement(1, center.x, center.y - 96);
  touch.beginLook(2, 920, 320);
  touch.beginAction(3, 'primaryFire');
  touch.movePointer(2, 950, 320);

  touch.endPointer(3);
  const afterFireEnds = touch.consumeCommand();
  assert.equal(afterFireEnds.throttle, 1);
  assert.ok(afterFireEnds.yaw > 0);
  assert.equal(afterFireEnds.primaryFire, false);

  touch.endPointer(2);
  assert.equal(touch.consumeCommand().throttle, 1);
});

test('a second movement pointer cannot steal or release the active joystick', () => {
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 }, { sensitivity: 1 });
  const center = touch.movementCenter();
  assert.equal(touch.beginMovement(1, center.x + 40, center.y), true);
  assert.equal(touch.beginMovement(2, center.x, center.y), false);
  touch.endPointer(2);
  assert.ok(touch.consumeCommand().strafe > 0);
  touch.endPointer(1);
  assert.equal(touch.consumeCommand().strafe, 0);
});

test('input settings persist sensitivity, invert-Y, handedness, and control scale', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const saved = input.saveInputSettings(storage, {
    sensitivity: 2.4,
    invertY: true,
    leftHanded: true,
    controlScale: 1.2,
  });

  assert.deepEqual(input.loadInputSettings(storage), saved);
});

test('router selects one input mode and releases the previous source', () => {
  const desktop = new input.DesktopFlightInput();
  const touch = new input.TouchFlightInput({ width: 1280, height: 720 });
  const router = new input.InputRouter(desktop, touch);
  desktop.handleKeyDown({ code: 'KeyW' });
  assert.equal(router.consumeCommand().throttle, 1);

  router.setMode('touch');
  assert.deepEqual(router.consumeCommand(), input.neutralInputCommand());
  router.setMode('desktop');
  assert.equal(router.consumeCommand().throttle, 0);
});

test('router tolerates a Cocos native document shim without dataset', () => {
  const previousDocument = global.document;
  global.document = { body: {} };
  try {
    const router = new input.InputRouter(
      new input.DesktopFlightInput(),
      new input.TouchFlightInput({ width: 1280, height: 720 }),
    );
    assert.doesNotThrow(() => router.setMode('touch'));
    assert.equal(router.currentMode(), 'touch');
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('touch screen roles match the visible landscape combat controls', () => {
  const width = 844;
  const height = 390;
  for (const control of input.touchActionLayout(width, height)) {
    assert.equal(
      input.pointerRoleAt(control.x, control.y, width, height),
      control.role,
    );
  }
  assert.equal(input.pointerRoleAt(86, height - 86, width, height), 'movement');
  assert.equal(input.pointerRoleAt(width * 0.62, height * 0.5, width, height), 'look');

  const controls = input.touchActionLayout(width, height);
  const primary = controls.find((control) => control.role === 'primaryFire');
  const secondary = controls.find((control) => control.role === 'secondaryFire');
  const camera = controls.find((control) => control.role === 'cameraToggle');
  const pause = controls.find((control) => control.role === 'pause');
  for (const [left, right] of [[primary, secondary], [camera, pause]]) {
    const gap = Math.hypot(left.x - right.x, left.y - right.y);
    assert.ok(gap >= left.radius + right.radius, `${left.role} overlaps ${right.role}`);
  }

  const ability = controls.find((control) => control.role === 'deviceAbility');
  assert.ok(ability, '触屏必须有战术设备主动技能键');
  for (const other of controls) {
    if (other === ability) continue;
    const gap = Math.hypot(ability.x - other.x, ability.y - other.y);
    assert.ok(gap >= ability.radius + other.radius, `deviceAbility overlaps ${other.role}`);
  }
});

test('touch action routing can use measured visual control circles', () => {
  const measured = [
    { role: 'primaryFire', x: 727, y: 307, radius: 39 },
    { role: 'secondaryFire', x: 657, y: 301, radius: 29 },
    { role: 'boost', x: 729, y: 235, radius: 29 },
    { role: 'cameraToggle', x: 744, y: 36, radius: 24 },
    { role: 'pause', x: 692, y: 36, radius: 24 },
  ];
  for (const control of measured) {
    assert.equal(
      input.pointerRoleAt(control.x, control.y, 780, 360, false, undefined, measured),
      control.role,
    );
  }
});

test('notched landscape safe areas keep visible touch controls aligned with hit targets', () => {
  const width = 852;
  const height = 393;
  const safeInsets = { left: 47, right: 47, top: 0, bottom: 21 };
  const controls = input.touchActionLayout(width, height, false, safeInsets);

  for (const control of controls) {
    assert.equal(
      input.pointerRoleAt(control.x, control.y, width, height, false, safeInsets),
      control.role,
      `${control.role} must follow the visible safe-area position`,
    );
  }

  const primary = controls.find((control) => control.role === 'primaryFire');
  const boost = controls.find((control) => control.role === 'boost');
  const camera = controls.find((control) => control.role === 'cameraToggle');
  const scale = Math.max(0.65, Math.min(1, width / 960, height / 540));
  assert.ok(Math.abs(primary.x - (width - safeInsets.right - (76 * scale))) < 0.001);
  assert.ok(Math.abs(primary.y - (height - safeInsets.bottom - (76 * scale))) < 0.001);
  assert.equal(boost.x, primary.x);
  assert.ok(Math.abs(camera.x - (width - safeInsets.right - (76 * scale))) < 0.001);
});

test('native safe rectangle converts bottom-origin bounds into screen edge insets', () => {
  assert.deepEqual(
    input.safeInsetsFromRect(852, 393, { x: 47, y: 21, width: 758, height: 354 }),
    { left: 47, right: 47, top: 18, bottom: 21 },
  );
  assert.deepEqual(
    input.safeInsetsFromRect(640, 360, null, { left: 16, right: 16, top: 8, bottom: 8 }),
    { left: 16, right: 16, top: 8, bottom: 8 },
  );
});

test('control scale and handedness move visible circles and hit regions together', () => {
  const width = 780;
  const height = 360;
  const safe = { left: 24, right: 32, top: 8, bottom: 12 };
  const scale = 1.25;
  const actions = input.touchActionLayout(width, height, true, safe, scale);
  const movement = input.movementControlCircle(width, height, true, safe, scale);

  for (const control of actions) {
    assert.equal(
      input.pointerRoleAt(control.x, control.y, width, height, true, safe, actions, movement, scale),
      control.role,
    );
    assert.ok(control.x - control.radius >= safe.left - 0.001);
    assert.ok(control.x + control.radius <= width - safe.right + 0.001);
    assert.ok(control.y - control.radius >= safe.top - 0.001);
    assert.ok(control.y + control.radius <= height - safe.bottom + 0.001);
  }
  assert.ok(movement.x > width / 2, 'left-handed movement belongs on the right');
  assert.ok(actions.find((control) => control.role === 'primaryFire').x < width / 2);
});

test('overlapping action hit regions choose the control nearest to the touch', () => {
  const controls = [
    { role: 'primaryFire', x: 100, y: 100, radius: 60 },
    { role: 'secondaryFire', x: 150, y: 100, radius: 60 },
  ];
  assert.equal(
    input.pointerRoleAt(145, 100, 320, 180, false, undefined, controls),
    'secondaryFire',
  );
});

test('touch camera and pause actions are emitted through the shared command', () => {
  const touch = new input.TouchFlightInput({ width: 844, height: 390 });
  touch.beginAction(7, 'cameraToggle');
  touch.beginAction(8, 'pause');
  const command = touch.consumeCommand();
  assert.equal(command.cameraToggle, true);
  assert.equal(command.pause, true);
  touch.endPointer(7);
  touch.endPointer(8);
});

test('touch prefab exposes stable landscape zones for every pointer role', () => {
  const prefabPath = path.resolve(
    __dirname,
    '../SpaceFight-Cocos/assets/prefabs/ui/TouchControls.prefab',
  );
  const prefab = JSON.parse(readFileSync(prefabPath, 'utf8'));
  const names = prefab
    .filter((item) => item.__type__ === 'cc.Node')
    .map((item) => item._name);

  for (const required of [
    'FixedMoveStick', 'LookSurface', 'PrimaryFire', 'SecondaryFire', 'Boost',
    'CameraToggle', 'Pause',
  ]) {
    assert.ok(names.includes(required), `missing ${required} touch zone`);
  }

  const transforms = prefab.filter((item) => item.__type__ === 'cc.UITransform');
  const widgets = prefab.filter((item) => item.__type__ === 'cc.Widget');
  assert.equal(transforms.length, 8, 'root and seven zones need bounded hit regions');
  assert.equal(widgets.length, 7, 'every control zone needs safe-edge anchoring');
  assert.ok(prefab.some((item) => item.__type__ === 'cc.SafeArea'));
  for (const widget of widgets) {
    assert.equal(widget._alignMode, 1, 'widgets must update after safe-area layout');
  }
});

test('gamepad deadzone removes centered drift and calibration captures offset', () => {
  const calibration = input.calibrationFromCenteredAxes([0.09, -0.06, 0.04, -0.03]);
  assert.deepEqual(calibration.offsets, [0.09, -0.06, 0.04, -0.03]);
  assert.equal(calibration.deadzone, 0.14);
  const gamepad = new input.GamepadFlightInput(
    { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1 },
    calibration,
  );
  gamepad.update({ connected: true, id: 'Test Pad', axes: [0.1, -0.05, 0.03, -0.02], buttons: [] });
  const command = gamepad.consumeCommand();
  assert.equal(command.strafe, 0);
  assert.equal(command.throttle, 0);
  assert.equal(command.yaw, 0);
  assert.equal(command.pitch, 0);
});

test('gamepad maps both sticks, triggers, boost, return, camera and pause', () => {
  const gamepad = new input.GamepadFlightInput(
    { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1 },
    { deadzone: 0.1, offsets: [0, 0, 0, 0] },
  );
  const buttons = Array(10).fill(0);
  buttons[1] = 1;
  buttons[3] = 1;
  buttons[4] = 1;
  buttons[6] = 1;
  buttons[7] = 1;
  buttons[9] = 1;
  gamepad.update({ connected: true, id: 'Test Pad', axes: [0.7, -0.8, 0.6, -0.5], buttons });
  const first = gamepad.consumeCommand();
  assert.ok(first.strafe > 0.5);
  assert.ok(first.throttle > 0.6);
  assert.ok(first.yaw > 0.4);
  assert.ok(first.pitch < -0.3);
  assert.equal(first.primaryFire, true);
  assert.equal(first.secondaryFire, true);
  assert.equal(first.boost, true);
  assert.equal(first.returnRequested, true);
  assert.equal(first.cameraToggle, true);
  assert.equal(first.pause, true);
  const held = gamepad.consumeCommand();
  assert.equal(held.cameraToggle, false);
  assert.equal(held.pause, false);
});

test('gamepad Select and Start chord recalibrates center without pausing', () => {
  const gamepad = new input.GamepadFlightInput(
    { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1 },
    { deadzone: 0.08, offsets: [0, 0, 0, 0] },
  );
  const buttons = Array(10).fill(0);
  buttons[8] = 1;
  buttons[9] = 1;
  gamepad.update({ connected: true, id: 'Drifting Pad', axes: [0.2, -0.16, 0.12, -0.1], buttons });
  const command = gamepad.consumeCommand();
  assert.equal(command.strafe, 0);
  assert.equal(command.throttle, 0);
  assert.equal(command.yaw, 0);
  assert.equal(command.pitch, 0);
  assert.equal(command.pause, false);
});

test('input router adopts an active gamepad and falls back after disconnect', () => {
  const desktop = new input.DesktopFlightInput();
  const touch = new input.TouchFlightInput({ width: 844, height: 390 });
  const gamepad = new input.GamepadFlightInput(
    { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1 },
    { deadzone: 0.1, offsets: [0, 0, 0, 0] },
  );
  const router = new input.InputRouter(desktop, touch, gamepad);
  gamepad.update({ connected: true, id: 'Test Pad', axes: [0.8, 0, 0, 0], buttons: [] });
  assert.ok(router.consumeCommand().strafe > 0.5);
  assert.equal(router.currentMode(), 'gamepad');
  gamepad.update({ connected: false, id: '', axes: [0, 0, 0, 0], buttons: [] });
  router.consumeCommand();
  assert.equal(router.currentMode(), 'desktop');
});
