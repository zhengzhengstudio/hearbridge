'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

test('Cocos gameplay uses a 16:9 landscape design resolution', () => {
  const settings = JSON.parse(readText(
    path.join(projectRoot, 'settings', 'v2', 'packages', 'project.json'),
  ));

  assert.deepEqual(settings.general.designResolution, {
    width: 1280,
    height: 720,
  });
});

test('web release build disables debug output and fingerprints assets', () => {
  const config = JSON.parse(readText(
    path.join(projectRoot, 'config', 'build-web-release.json'),
  ));

  assert.equal(config.platform, 'web-desktop');
  assert.equal(config.debug, false);
  assert.equal(config.md5Cache, true);
  assert.equal(config.sourceMaps, false);
  assert.equal(config.startScene, 'ee9bc189-ccbe-45a5-bafb-2a39c70b4b08');
  assert.deepEqual(config.packages['web-desktop'].resolution, {
    designWidth: 1280,
    designHeight: 720,
  });
});

for (const platform of ['web-desktop', 'web-mobile']) {
  test(`${platform} launches gameplay into a full-viewport landscape surface`, () => {
    const template = readText(
      path.join(projectRoot, 'build-templates', platform, 'index.ejs'),
    );
    const shell = [
      template,
      readText(path.join(projectRoot, 'build-templates', platform, 'spacefight-shell.css')),
      readText(path.join(projectRoot, 'build-templates', platform, 'spacefight-shell.js')),
    ].join('\n');

    assert.match(shell, /cc_exact_fit_screen="true"/);
    assert.match(shell, /#GameDiv,[\s\S]*#Cocos3dGameContainer,[\s\S]*#GameCanvas[\s\S]*position:\s*fixed/);
    assert.match(shell, /#GameDiv,[\s\S]*#Cocos3dGameContainer,[\s\S]*#GameCanvas[\s\S]*inset:\s*0/);
    assert.match(shell, /requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
    assert.match(shell, /screen\.orientation\.lock\('landscape'\)/);
    assert.match(shell, /canvas\.requestPointerLock\(\)/);
    assert.match(shell, /canvas\.focus\(\)/);
    assert.match(shell, /spacefight:fullscreen-enter/);
    assert.match(shell, /fullscreenchange/);
    assert.match(shell, /spacefight:fullscreen-exit/);
    assert.match(shell, /spacefight:combat-state/);
    assert.match(shell, /id="OutpostPanel"/);
    assert.match(shell, /id="OutpostUndock"/);
    assert.match(shell, /id="OutpostLoadout"/);
    assert.match(shell, /spacefight:outpost-entered[\s\S]*dataset\.docked\s*=\s*'true'/);
    assert.match(shell, /OutpostUndock[\s\S]*dataset\.docked\s*=\s*'false'[\s\S]*spacefight:fullscreen-enter/);
    assert.match(shell, /input-debug/);
    assert.match(shell, /spacefight:input-debug/);
    assert.match(shell, /data-paused="true"\]\[data-mission="active"\]\s+#PauseOverlay/);
    assert.match(shell, /dataset\.mission\s*=\s*'active'[\s\S]*dataset\.paused\s*=\s*'false'/);
    assert.match(template, /data-engine-ready="false"/);
    assert.match(template, /id="LaunchButton"[^>]*disabled/);
    assert.match(shell, /spacefight:engine-ready/);
    assert.match(shell, /dataset\.engineReady\s*=\s*'true'/);
    assert.match(shell, /window\.setTimeout\(markEngineSlow,\s*18000\)/);
    assert.match(shell, /window\.setTimeout\(markEngineFailed,\s*120000\)/);
    assert.doesNotMatch(shell, /window\.setTimeout\(markEngineFailed,\s*18000\)/);
    assert.match(shell, /dataset\.playing\s*=\s*'true'[\s\S]*requestFlightSurface\(\)/);
    assert.match(shell, /window\.location\.reload\(\)/);
    if (platform === 'web-desktop') {
      assert.doesNotMatch(shell, /navigator\.maxTouchPoints/);
      assert.match(shell, /\(pointer: coarse\)/);
      assert.match(shell, /\(pointer: fine\)/);
      assert.match(shell, /inputModeOverride/);
    } else {
      assert.match(shell, /navigator\.maxTouchPoints/);
      assert.match(shell, /dataset\.inputMode\s*=\s*prefersTouch\s*\?\s*'touch'\s*:\s*'desktop'/);
    }
    assert.match(shell, /--stick-x/);
    assert.match(shell, /--stick-y/);
    assert.match(shell, /safe-area-inset-top/);
    assert.match(shell, /@media \(orientation: portrait\) and \(pointer: coarse\)/);
    assert.match(shell, /id="LandscapeGuard"/);
    assert.match(shell, /dataset\.orientationBlocked/);
    assert.match(shell, /#LandscapeGuard \{[\s\S]*position:\s*fixed/);
    assert.match(shell, /body\[data-orientation-blocked="true"\][\s\S]*#CombatHud/);
    assert.match(shell, /#LaunchButton \{ display: none; \}/);
    assert.match(shell, /#RotateMessage \{ display: block; \}/);
    for (const controlId of [
      'CombatReticle',
      'MoveStick',
      'PrimaryControl',
      'SecondaryControl',
      'BoostControl',
      'CameraControl',
      'PauseControl',
    ]) {
      assert.match(shell, new RegExp(`id="${controlId}"`));
    }
    for (const statusId of [
      'CombatHud',
      'HealthBar',
      'ShieldBar',
      'EnergyBar',
      'MissionLabel',
      'CameraValue',
      'PauseOverlay',
    ]) {
      assert.match(shell, new RegExp(`id="${statusId}"`));
    }
    assert.match(shell, /@media \(max-height: 540px\) and \(orientation: landscape\)/);
    assert.doesNotMatch(template, /href="https?:\/\//i);
  });
}

test('combat simulation pauses behind the launch gate and after fullscreen exit', () => {
  const bootstrap = readText(
    path.join(projectRoot, 'assets', 'scripts', 'game', 'CombatBootstrap.ts'),
  );

  assert.match(bootstrap, /document\.getElementById\('LaunchGate'\)/);
  assert.match(bootstrap, /pausedByLaunchGate\s*=\s*browserDataset\(\)\?\.playing\s*!==\s*'true'/);
  assert.match(bootstrap, /spacefight:fullscreen-enter/);
  assert.match(bootstrap, /spacefight:fullscreen-exit/);
  assert.match(bootstrap, /spacefight:toggle-pause/);
  assert.match(bootstrap, /browserDataset\(\)\?\.orientationBlocked\s*===\s*'true'/);
  assert.match(bootstrap, /spacefight:combat-state/);
  assert.match(bootstrap, /spacefight:engine-ready/);
  assert.match(bootstrap, /if\s*\([\s\S]*this\.pausedByLaunchGate[\s\S]*\|\|\s*!this\.initialized/);
  assert.match(bootstrap, /handleFullscreenEnter[\s\S]*pausedByLaunchGate\s*=\s*false/);
  assert.match(bootstrap, /handleFullscreenExit[\s\S]*pausedByLaunchGate\s*=\s*true/);
});

test('combat bootstrap consumes real player input without demo autopilot', () => {
  const bootstrap = readText(
    path.join(projectRoot, 'assets', 'scripts', 'game', 'CombatBootstrap.ts'),
  );

  assert.match(bootstrap, /new BrowserInputBridge/);
  assert.match(bootstrap, /inputRouter\?\.consumeCommand\(\)/);
  assert.match(bootstrap, /snapshot\.cameraMode\s*===\s*'cockpit'/);
  assert.doesNotMatch(bootstrap, /demoFlightCommand/);
});
