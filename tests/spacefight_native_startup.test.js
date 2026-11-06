'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('native startup never requires browser body dataset fields', () => {
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  const inputRouter = read('SpaceFight-Cocos/assets/scripts/input/InputRouter.ts');

  assert.match(
    bootstrap,
    /function browserDataset\(\)[\s\S]*sys\.isNative[\s\S]*document\.body\?\.dataset/,
  );
  assert.doesNotMatch(bootstrap, /document\.body\.dataset/);
  assert.match(inputRouter, /document\.body\?\.dataset/);
  assert.match(inputRouter, /document\.body\?\.dataset\?\.inputDebug/);
  assert.match(
    bootstrap,
    /function dispatchBrowserEvent[\s\S]*sys\.isNative[\s\S]*typeof CustomEvent/,
  );
  assert.equal((bootstrap.match(/new CustomEvent/g) || []).length, 1);
  assert.match(inputRouter, /typeof CustomEvent !== 'undefined'/);
});

test('native combat HUD binds an overlay camera that renders the UI layer', () => {
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');

  assert.match(hud, /new Node\('NativeCombatHudCamera'\)/);
  assert.match(hud, /camera\.projection\s*=\s*Camera\.ProjectionType\.ORTHO/);
  assert.match(hud, /camera\.clearFlags\s*=\s*Camera\.ClearFlag\.DEPTH_ONLY/);
  assert.match(hud, /camera\.visibility\s*=\s*Layers\.Enum\.UI_2D/);
  assert.match(hud, /canvas\.cameraComponent\s*=\s*camera/);
});

test('native combat entry uses a branded preflight instead of blocking on ship GLBs', () => {
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  const hudPosition = bootstrap.indexOf('this.initializeNativeHud(scene)');
  const graphicsPosition = bootstrap.indexOf('await this.prepareGraphicsProfile()');
  const shipShellPosition = bootstrap.indexOf('this.shipPresenter.initialize()');
  const visualLoadPosition = bootstrap.indexOf('this.shipPresenter.ensurePlayerVisual()');
  const enemyVisualLoadPosition = bootstrap.indexOf('this.shipPresenter.loadInitialEnemyVisuals(this.snapshot)');
  const initializedPosition = bootstrap.indexOf('this.initialized = true');

  assert.notEqual(hudPosition, -1);
  assert.notEqual(shipShellPosition, -1);
  assert.notEqual(visualLoadPosition, -1);
  assert.notEqual(enemyVisualLoadPosition, -1);
  assert.ok(hudPosition < graphicsPosition);
  assert.ok(hudPosition < shipShellPosition);
  assert.ok(visualLoadPosition < initializedPosition);
  assert.ok(initializedPosition < enemyVisualLoadPosition);
  assert.match(bootstrap, /this\.nativeHud\?\.showPreflight\(\)/);
  assert.match(bootstrap, /dismissNativeLaunchScreen\(runtimePlatform\(\)\)/);
  assert.doesNotMatch(bootstrap, /await Promise\.all\(\[\s*this\.shipPresenter\.loadPlayerVisual/);
  assert.doesNotMatch(bootstrap, /required combat visuals unavailable; combat entry blocked/);
  assert.match(bootstrap, /combat visual mode/);
});

test('optional world rendering cannot prevent a visible player ship from becoming ready', () => {
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  const initializedPosition = bootstrap.indexOf('this.initialized = true');
  const readyEventPosition = bootstrap.indexOf("dispatchBrowserEvent('spacefight:engine-ready')");
  const optionalWorldPosition = bootstrap.indexOf('this.initializeOptionalWorld(worldRoot, player)');

  assert.notEqual(initializedPosition, -1);
  assert.notEqual(readyEventPosition, -1);
  assert.notEqual(optionalWorldPosition, -1);
  assert.ok(initializedPosition < optionalWorldPosition);
  assert.ok(initializedPosition < readyEventPosition);
  assert.match(bootstrap, /world rendering unavailable; combat remains playable/);
  assert.match(bootstrap, /this\.worldStreamer = null/);
  assert.doesNotMatch(bootstrap, /!this\.projectilePresenter/);
  assert.match(bootstrap, /this\.projectilePresenter\?\.sync\(this\.snapshot\)/);
});

test('published web bundle never claims readiness before the required player visual', () => {
  const websiteRoot = path.join(root, 'website/spacefight.zhengzhengstudio.cn');
  const mainAssetRoot = path.join(websiteRoot, 'assets/main');
  const configFiles = fs.readdirSync(mainAssetRoot)
    .filter(file => /^config\..+\.json$/.test(file));
  assert.equal(configFiles.length, 1, 'published website must contain one current main config');
  const mainConfig = JSON.parse(fs.readFileSync(path.join(mainAssetRoot, configFiles[0]), 'utf8'));
  const mainBundleName = mainConfig.name || 'main';
  assert.equal(mainBundleName, 'main');

  const bundleFiles = fs.readdirSync(mainAssetRoot)
    .filter(file => /^index\..+\.js$/.test(file));
  assert.equal(bundleFiles.length, 1, 'published website must contain one current main bundle');
  const bundle = fs.readFileSync(path.join(mainAssetRoot, bundleFiles[0]), 'utf8');

  assert.match(bundle, /loadPlayerVisual/);
  assert.match(bundle, /loadPlayerVisual/);
  assert.doesNotMatch(bundle, /player visual unavailable; combat remains playable/);
});

test('web publisher copies a real Cocos build without rewriting compiled combat code', () => {
  const publisher = read('SpaceFight-Cocos/tools/publish-web-release.js');

  assert.doesNotMatch(publisher, /patchLegacyBlockingCombatBundle/);
  assert.doesNotMatch(publisher, /blockingStartup|resilientStartup/);
  assert.doesNotMatch(publisher, /writeFileSync\(bundlePath/);
});

test('published web shell displays the current project version and build', () => {
  const project = JSON.parse(read('SpaceFight-Cocos/package.json'));
  const html = read('website/spacefight.zhengzhengstudio.cn/index.html');

  assert.match(html, new RegExp(`本机战斗核心 <b>${project.version.replace(/\./g, '\\.')}`));
  assert.match(html, new RegExp(`BUILD ${project.build}`));
  assert.doesNotMatch(html, /__SPACEFIGHT_(?:VERSION|BUILD)__/);
});

test('native input retries before combat and device probing cannot block startup forever', () => {
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');

  assert.match(bootstrap, /native input unavailable; startup will retry before combat/);
  assert.match(bootstrap, /Native combat input could not be initialized/);
  assert.match(bootstrap, /if \(this\.nativeHud\) this\.cocosInput\.setFeedback\(this\.nativeHud\)/);
  assert.match(bootstrap, /CAPABILITY_TIMEOUT_MS\s*=\s*1200/);
  assert.match(bootstrap, /Promise\.race/);
});

test('local imported models are not cancelled by a slow-device timeout', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');

  assert.match(ships, /MODEL_LOAD_TIMEOUT_MS\s*=\s*8000/);
  assert.match(ships, /MODEL_LOAD_ATTEMPTS\s*=\s*2/);
  assert.match(ships, /retryModelLoad/);
  assert.match(ships, /setTimeout\(/);
  assert.match(ships, /clearTimeout\(/);
  assert.match(ships, /loadPrefab\(resources, model\.lowPath\)/);
  assert.match(ships, /loadPrefab\(await loadHighBundle\(\), model\.highPath, MODEL_LOAD_TIMEOUT_MS\)/);
  assert.match(ships, /PLAYER_VISUAL_READY_TIMEOUT_MS\s*=\s*2500/);
  assert.match(ships, /installFallbackVisual/);
  assert.match(ships, /Promise\.race/);
  assert.deepEqual(
    ships.match(/INITIAL_SHIP_KINDS[^\n]+/)?.[0],
    "INITIAL_SHIP_KINDS: readonly ShipKind[] = ['interceptor'];",
  );
});

test('failed model promises are evicted so a native resource load can recover', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');

  assert.match(ships, /this\.prefabLoads\.delete\(kind\);\s*throw error;/);
  assert.match(ships, /this\.highPrefabLoads\.delete\(kind\);\s*throw error;/);
  assert.match(ships, /private readonly pendingEnemies = new Map<string, Promise<void>>\(\)/);
  assert.match(ships, /this\.pendingEnemies\.delete\(enemyId\)/);
});

test('combat simulation waits for the player visual without requiring every enemy to finish loading', () => {
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  const visibilityGate = bootstrap.indexOf('if (!this.shipPresenter.isPlayerVisualReady())');
  const commandRead = bootstrap.indexOf('const command = this.inputRouter?.consumeCommand()');
  const simulationStep = bootstrap.indexOf('this.snapshot = this.simulation.step(command, deltaTime)');

  assert.notEqual(visibilityGate, -1);
  assert.ok(visibilityGate < commandRead);
  assert.ok(visibilityGate < simulationStep);
  assert.match(
    bootstrap.slice(visibilityGate, commandRead),
    /this\.shipPresenter\.sync\(this\.snapshot\);\s*return;/,
  );
});

test('ship presenter creates the controllable player shell before loading its visual', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');
  const initializeStart = ships.indexOf('public initialize(): Node');
  const playerShell = ships.indexOf("this.createShipShell('PlayerShip', 'interceptor', true)");
  const visualLoader = ships.indexOf('public async loadPlayerVisual(): Promise<void>');

  assert.notEqual(initializeStart, -1);
  assert.ok(playerShell > initializeStart);
  assert.ok(visualLoader > playerShell);
});

test('native ship loads target the imported GLB prefab sub-assets', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');

  for (const kind of ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss']) {
    assert.match(ships, new RegExp(`models-low/ships/${kind}/${kind}`));
    assert.match(ships, new RegExp(`models/ships/${kind}/${kind}`));
  }
});
