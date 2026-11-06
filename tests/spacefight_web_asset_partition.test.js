'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const project = path.join(root, 'SpaceFight-Cocos');
const scripts = path.join(project, 'assets', 'scripts');
const output = mkdtempSync(path.join(os.tmpdir(), 'spacefight-asset-policy-'));

test.after(() => rmSync(output, { recursive: true, force: true }));

const compile = spawnSync('npx', [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--rootDir', scripts, '--outDir', output,
  path.join(scripts, 'performance', 'GraphicsProfile.ts'),
  path.join(scripts, 'performance', 'AssetBundlePolicy.ts'),
], { cwd: project, encoding: 'utf8' });

test('graphics tiers choose the required bundles without leaking high assets into low mode', () => {
  assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);
  const policy = require(path.join(output, 'performance', 'AssetBundlePolicy.js'));
  assert.deepEqual(policy.selectAssetBundles('low'), ['resources']);
  assert.deepEqual(policy.selectAssetBundles('high'), ['resources', 'spacefight-high']);
});

test('low ship assets are real reduced models and high ships live only in the optional bundle', () => {
  const lowRoot = path.join(project, 'assets', 'resources', 'models-low', 'ships');
  const highRoot = path.join(project, 'assets', 'spacefight-high', 'models', 'ships');
  const legacyRoot = path.join(project, 'assets', 'resources', 'models', 'ships');
  const ships = ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss'];

  for (const ship of ships) {
    const low = path.join(lowRoot, `${ship}.glb`);
    const high = path.join(highRoot, `${ship}.glb`);
    assert.ok(statSync(low).size > 1000, `${ship} low model is missing`);
    assert.ok(statSync(low).size * 1.5 < statSync(high).size, `${ship} low model was not materially reduced`);
    assert.equal(require('node:fs').existsSync(path.join(legacyRoot, `${ship}.glb`)), false);
  }
});

test('ship presenter loads resources immediately and high ships through the optional bundle', () => {
  const source = readFileSync(path.join(scripts, 'game', 'ShipPresenter.ts'), 'utf8');
  const bootstrap = readFileSync(path.join(scripts, 'game', 'CombatBootstrap.ts'), 'utf8');
  assert.match(source, /models-low\/ships/);
  assert.match(source, /assetManager\.loadBundle\(['"]spacefight-high['"]/);
  assert.match(source, /selectAssetBundles\(graphicsTier\)/);
  assert.match(source, /bundle\.load\(/);
  assert.match(source, /loadModel\('low', MODEL_NORMALIZATION\[kind\]\)/);
  assert.match(bootstrap, /handleFullscreenEnter[\s\S]*enableHighQuality\(this\.graphicsTier\)/);
});
