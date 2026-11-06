const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { updateStockReleaseEntry } = require('../scripts/lib/stock_release');
const ROOT = path.resolve(__dirname, '..');

test('stock release metadata updates only the requested native platform', () => {
  const document = {
    apps: [
      { id: 'cn.zhengzhengstudio.stock', platform: 'android', version: '1.0.1' },
      { id: 'cn.zhengzhengstudio.stock.harmony', platform: 'harmonyos', version: '1.0.0' },
      { id: 'spacefight-android', platform: 'android', version: '9.9.9' },
    ],
  };

  updateStockReleaseEntry(document, {
    platform: 'android',
    version: '1.2.0',
    build: 3,
    fileName: 'ZhengZhengStock-Android-v1.2.0-debug.apk',
    latestName: 'ZhengZhengStock-Android-latest.apk',
    size: 2345,
    sha256: 'abc123',
    updatedAt: '2026-08-31T12:00:00+08:00',
  });

  assert.equal(document.apps[0].version, '1.2.0');
  assert.equal(document.apps[0].versionCode, 3);
  assert.equal(document.apps[0].url, '/api/apps/ZhengZhengStock-Android-latest.apk');
  assert.equal(document.apps[1].version, '1.0.0');
  assert.equal(document.apps[2].version, '9.9.9');
});

test('Android stock release build number stays above the previously published build', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'StockSimulatorApps/ZhengZhengStockAndroid/app/build.gradle.kts'), 'utf8');
  const publisher = fs.readFileSync(path.join(ROOT, 'scripts/publish_stock_simulator.js'), 'utf8');

  assert.match(gradle, /versionCode\s*=\s*11\b/);
  assert.match(publisher, /android-build'\]\s*\|\|\s*11/);
});
