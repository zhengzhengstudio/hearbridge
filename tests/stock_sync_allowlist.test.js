const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isStockWatchAllowed,
  mayContainStockWatchFile,
} = require('../sync_stock_allowlist');

test('stock watch allowlist accepts the complete website release path set', () => {
  const requiredPaths = [
    'api/server.js',
    'api/stock_routes.js',
    'api/stock_quote_provider.js',
    'api/data/changelogs.json',
    'api/apps/manifest.json',
    'api/apps/client-downloads.json',
    'api/apps/ZhengZhengStock-Android-latest.apk',
    'zhengzhengstudio.cn/api/ai/routes/stock.js',
    'zhengzhengstudio.cn/simulators/stock_pro/index.html',
    'zhengzhengstudio.cn/api/apps/manifest.json',
    'zhengzhengstudio.cn/api/apps/client-downloads.json',
    'zhengzhengstudio.cn/api/apps/ZhengZhengStock-HarmonyOS-latest-unsigned.hap',
  ];

  for (const relativePath of requiredPaths) {
    assert.equal(isStockWatchAllowed(relativePath), true, relativePath);
  }
  assert.equal(mayContainStockWatchFile('zhengzhengstudio.cn/api/apps'), true);
});

test('stock watch allowlist rejects unrelated packages and runtime account data', () => {
  assert.equal(isStockWatchAllowed('api/apps/SpaceFight-Android-latest.apk'), false);
  assert.equal(isStockWatchAllowed('api/data/stock_accounts/user-1.json'), false);
  assert.equal(isStockWatchAllowed('zhengzhengstudio.cn/api/apps/OtherApp.apk'), false);
});
