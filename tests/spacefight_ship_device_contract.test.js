'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8');

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-ship-device-'));
test.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

const sources = [
  'assets/scripts/core/ShipCatalog.ts',
  'assets/scripts/performance/DeviceFormFactor.ts',
  'assets/scripts/performance/CapabilityPolicy.ts',
  'assets/scripts/performance/GraphicsProfile.ts',
  'assets/scripts/ui/Localization.ts',
].map((relative) => path.join(projectRoot, relative));

const compile = spawnSync('npx', [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
  '--outDir', outputRoot, ...sources,
], { cwd: projectRoot, encoding: 'utf8' });
assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);

const catalog = require(path.join(outputRoot, 'core', 'ShipCatalog.js'));
const formFactor = require(path.join(outputRoot, 'performance', 'DeviceFormFactor.js'));
const capability = require(path.join(outputRoot, 'performance', 'CapabilityPolicy.js'));
const localization = require(path.join(outputRoot, 'ui', 'Localization.js'));

test('五种玩家机型，基线机全 1.0 倍率，其余机型有实质差异', () => {
  assert.deepEqual(catalog.PLAYER_SHIP_IDS, [
    'interceptor', 'scout', 'fighter', 'bomber', 'gunship',
  ]);
  const baseline = catalog.PLAYER_SHIPS.interceptor;
  for (const key of [
    'healthMultiplier', 'shieldMultiplier', 'speedMultiplier', 'strafeMultiplier',
    'damageMultiplier', 'fireRateMultiplier', 'energyMultiplier', 'lockRangeMultiplier',
  ]) {
    assert.equal(baseline[key], 1, `baseline ${key} 必须是 1，否则既有确定性模拟数值会漂`);
  }
  assert.equal(baseline.pickupRadiusBonus, 0);
  for (const id of catalog.PLAYER_SHIP_IDS) {
    assert.equal(catalog.PLAYER_SHIPS[id].id, id);
    assert.ok(catalog.PLAYER_SHIPS[id].code.startsWith('SF-'));
  }
  assert.ok(catalog.PLAYER_SHIPS.bomber.damageMultiplier > 1.3);
  assert.ok(catalog.PLAYER_SHIPS.scout.speedMultiplier > 1.2);
  assert.ok(catalog.PLAYER_SHIPS.gunship.shieldMultiplier > 1.3);
});

test('非法机型回退到基线截击机', () => {
  assert.equal(catalog.resolvePlayerShip('nope').id, 'interceptor');
  assert.equal(catalog.resolvePlayerShip(undefined).id, 'interceptor');
  assert.equal(catalog.resolvePlayerShip('gunship').id, 'gunship');
  assert.equal(catalog.isPlayerShipId('boss'), false);
});

test('装配结构把 ship 纳入解析，非法值不污染存档', () => {
  const source = read('assets', 'scripts', 'core', 'WeaponCatalog.ts');
  assert.match(source, /ship\?: PlayerShipId/);
  assert.match(source, /ship: DEFAULT_PLAYER_SHIP/);
  assert.match(source, /isPlayerShipId\(candidateShip\)/);
  assert.match(source, /const ship: PlayerShipId/);
});

test('机型倍率接进模拟层与 HUD 摘要，且玩家模型不再写死', () => {
  const simulation = read('assets', 'scripts', 'core', 'CombatSimulation.ts');
  assert.match(simulation, /resolvePlayerShip\(this\.loadout\.ship\)/);
  assert.match(simulation, /ship\.healthMultiplier/);
  assert.match(simulation, /shipDefinition\.fireRateMultiplier/);
  assert.match(simulation, /shipDefinition\.lockRangeMultiplier/);
  const presenter = read('assets', 'scripts', 'game', 'ShipPresenter.ts');
  assert.match(presenter, /setPlayerShipKind\(kind: PlayerShipId\)/);
  assert.match(presenter, /MODEL_NORMALIZATION\[this\.playerShipKind\]/);
  assert.doesNotMatch(presenter, /replaceVisual\(this\.playerNode, 'interceptor'/);
  const hud = read('assets', 'scripts', 'game', 'NativeCombatHud.ts');
  assert.match(hud, /ship: \[\.\.\.PLAYER_SHIP_IDS\]/);
  assert.match(hud, /ship: 'slot\.ship'/);
  assert.match(hud, /ship\.damageMultiplier/);
  const bootstrap = read('assets', 'scripts', 'game', 'CombatBootstrap.ts');
  assert.match(bootstrap, /loadoutShip/);
  assert.match(bootstrap, /setPlayerShipKind\(/);
});

test('设备形态覆盖 iPhone / 双屏 / 三折叠三态 / 阔折叠 / 常规折叠', () => {
  const f = (metrics) => formFactor.resolveDeviceFormFactor(metrics);
  assert.equal(f({ width: 2532, height: 1170, userAgent: 'iPhone16,2' }), 'iphone');
  assert.equal(f({ width: 1800, height: 1350, windowSegments: 2 }), 'dual-screen');
  assert.equal(f({ width: 1800, height: 1350, userAgent: 'Surface Duo 2' }), 'dual-screen');
  assert.equal(f({ width: 1008, height: 2232, userAgent: 'HUAWEI Mate XT' }), 'tri-fold-single');
  assert.equal(f({ width: 1590, height: 1416, userAgent: 'HUAWEI Mate XT' }), 'tri-fold-dual');
  assert.equal(f({ width: 2232, height: 1590, userAgent: 'HUAWEI Mate XT' }), 'tri-fold-triple');
  assert.equal(f({ width: 980, height: 980, userAgent: 'HUAWEI Pura X' }), 'wide-fold');
  assert.equal(f({ width: 2610, height: 1080 }), 'fold-closed');
  assert.equal(f({ width: 2200, height: 1800 }), 'fold-open');
});

test('宽高比连续变化时布局参数跟着变，且不把首次状态写死', () => {
  const closed = formFactor.resolveViewportLayout({ width: 2610, height: 1080 });
  const open = formFactor.resolveViewportLayout({ width: 2200, height: 1800 });
  assert.notEqual(closed.aspectClass, open.aspectClass);
  assert.ok(open.hudScale >= closed.hudScale);
  assert.equal(closed.seamInset, 0);
  const dual = formFactor.resolveViewportLayout({ width: 1800, height: 1350, windowSegments: 2 });
  assert.ok(dual.seamInset > 0, '双屏必须留出铰链避让');
  assert.equal(dual.conservativeUpgrade, true);
  assert.ok(formFactor.formFactorLabelKey('tri-fold-triple').startsWith('device.'));
});

test('展开态在能力探针无数据时保守选档，普通设备不受影响', () => {
  const base = { platform: 'web', memoryGB: null, benchmarkFrameMs: null };
  assert.equal(capability.resolveGraphicsDecision(base).tier, 'high');
  const expanded = capability.resolveGraphicsDecision({ ...base, formFactor: 'tri-fold-triple' });
  assert.equal(expanded.tier, 'low');
  assert.equal(expanded.reason, 'expanded-form-factor-conservative');
  const known = capability.resolveGraphicsDecision({ ...base, memoryGB: 8, formFactor: 'fold-open' });
  assert.equal(known.tier, 'high');
  const user = capability.resolveGraphicsDecision({ ...base, formFactor: 'tri-fold-triple', requestedTier: 'high' });
  assert.equal(user.tier, 'high', '用户手动选档优先');
});

test('本地化补齐机型与设备形态键，且 combatText 对脏值不抛错', () => {
  for (const key of [
    'slot.ship', 'ship.interceptor', 'ship.scout', 'ship.fighter', 'ship.bomber', 'ship.gunship',
    'device.iphone', 'device.tablet', 'device.dualScreen', 'device.foldable',
    'device.wideFold', 'device.triFold', 'device.phone',
  ]) {
    assert.ok(typeof localization.COMBAT_HUD_MESSAGES['zh-CN'][key] === 'string', key);
  }
  assert.equal(
    localization.combatText('这个语言不存在', 'status.hull', { current: 1, max: 2 }),
    localization.combatText('zh-CN', 'status.hull', { current: 1, max: 2 }),
  );
  assert.doesNotThrow(() => localization.combatText('en', '不存在的键'));
});

test('网页 launcher 有机型选择、形态事件与连续 resize 监听', () => {
  for (const variant of ['web-desktop', 'web-mobile']) {
    const ejs = read('build-templates', variant, 'index.ejs');
    assert.match(ejs, /data-ship-choice="gunship"/);
    assert.match(ejs, /id="CraftCode"/);
    assert.match(ejs, /data-stat="shield"/);
    const js = read('build-templates', variant, 'spacefight-shell.js');
    assert.match(js, /document\.body\.dataset\.loadoutShip/);
    assert.match(js, /spacefight:viewport-layout/);
    assert.match(js, /visualViewport\.addEventListener\('resize'/);
    assert.match(js, /getWindowSegments/);
    assert.match(js, /setCssVar/);
    const css = read('build-templates', variant, 'spacefight-shell.css');
    assert.match(css, /data-form-factor="dual-screen"/);
    assert.match(css, /craft-card__ships/);
  }
});

test('已修复的缺陷有回归护栏', () => {
  const hud = read('assets', 'scripts', 'game', 'NativeCombatHud.ts');
  assert.match(hud, /if \(options\.length === 0\) return;/, '空涂装数组不得取模出 NaN');
  const presenter = read('assets', 'scripts', 'game', 'ShipPresenter.ts');
  assert.match(presenter, /candidatePaths\(path: string, highQuality: boolean\)/);
  assert.match(presenter, /candidatePaths\(model\.lowPath, false\)/);
  assert.match(presenter, /this\.modelMuzzleSockets\.delete\(enemyNode\)/);
  assert.match(presenter, /this\.pendingEnemies\.delete\(enemyId\)/);
  assert.doesNotMatch(presenter, /path\.indexOf\('spacefight-high'\) === -1/);
  // 开局即冻结防御：玩家模型在宽限内仍加载不出时，必须有兜底机体且只尝试一次，
  // 否则原生端模型加载失败会让 isPlayerVisualReady 闸门永久冻住战斗（点 Deploy 就定格）。
  assert.match(presenter, /public ensureFallbackVisual\(\)/);
  assert.match(presenter, /fallbackVisualAttempted/);
  const bootstrap = read('assets', 'scripts', 'game', 'CombatBootstrap.ts');
  assert.match(bootstrap, /formFactor: \(this\.viewportFormFactor/);
  assert.match(bootstrap, /PLAYER_VISUAL_GRACE_MS/);
  assert.match(bootstrap, /this\.shipPresenter\.ensureFallbackVisual\(\)/);
  assert.match(bootstrap, /this\.combatVisualWaitMs = 0;/, '部署开局须重置视觉宽限计时');
});

test('版本元数据保持一致，瘦身脚本可执行且带校验模式', () => {
  const pkg = JSON.parse(read('package.json'));
  const project = JSON.parse(read('settings', 'v2', 'packages', 'project.json'));
  assert.equal(pkg.version, project.project.version, 'Cocos 元数据不得漂移');
  assert.equal(pkg.build, project.project.build);
  for (const variant of ['web-desktop', 'web-mobile']) {
    const ejs = read('build-templates', variant, 'index.ejs');
    assert.ok(ejs.includes(`<b>${pkg.version}</b>`), `${variant} 版本号`);
    assert.ok(ejs.includes(`BUILD ${pkg.build}`), `${variant} build 号`);
  }
  const pruner = read('tools', 'prune-duplicate-texture-variants.js');
  assert.match(pruner, /KEEP_PRESET = '7e97f'/);
  assert.match(pruner, /DROP_PRESETS/);
  assert.match(pruner, /--verify/);
  assert.match(pruner, /JSON\.stringify\(config\)/);
});
