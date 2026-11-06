const assert = require('node:assert/strict');
const test = require('node:test');

const { mergeAppDistributionManifest } = require('../website/api/lib/app_manifest_merge');

test('scoped releases cannot downgrade or remove unrelated app packages', () => {
  const existing = {
    updatedAt: '2026-08-09T19:40:00+08:00',
    apps: [
      {
        id: 'cn.zhengzhengstudio.boardgames.hmos',
        platform: 'harmonyos',
        version: '1.2.11',
        versionCode: 1021100,
        fileName: 'ZhengZhengBoardGames-HarmonyOS-v1.2.11-signed.hap',
      },
      {
        id: 'cn.zhengzhengstudio.boardgames.offline.hmos',
        platform: 'harmonyos',
        version: '1.0.2',
        versionCode: 1000200,
        fileName: 'ZhengZhengBoardGames-Offline-HarmonyOS-v1.0.2-signed.hap',
      },
      {
        id: 'survival-diary-android',
        platform: 'android',
        version: '0.4.4',
        versionCode: 44,
      },
    ],
  };
  const staleWorktree = {
    updatedAt: '2026-08-11T15:35:00+08:00',
    apps: [
      {
        id: 'cn.zhengzhengstudio.boardgames.hmos',
        platform: 'harmonyos',
        version: '1.2.7',
        versionCode: 1020700,
        fileName: 'ZhengZhengBoardGames-HarmonyOS-v1.2.7-signed.hap',
      },
      {
        id: 'survival-diary-android',
        platform: 'android',
        version: '0.4.5',
        versionCode: 45,
      },
    ],
  };

  const merged = mergeAppDistributionManifest(existing, staleWorktree);
  const online = merged.apps.find(app => app.id === 'cn.zhengzhengstudio.boardgames.hmos');
  const offline = merged.apps.find(app => app.id === 'cn.zhengzhengstudio.boardgames.offline.hmos');
  const survival = merged.apps.find(app => app.id === 'survival-diary-android');

  assert.equal(online.version, '1.2.11');
  assert.equal(online.versionCode, 1021100);
  assert.ok(offline, 'an incoming product-scoped release must not remove another product');
  assert.equal(offline.version, '1.0.2');
  assert.equal(survival.version, '0.4.5');
  assert.equal(survival.versionCode, 45);
});

test('client download aliases keep the newer release for each platform', () => {
  const existing = {
    apps: [],
    downloads: {
      android: { id: 'boardgames-android', version: '1.2.5', versionCode: 28 },
      harmonyos: { id: 'cn.zhengzhengstudio.boardgames.hmos', version: '1.2.11', versionCode: 1021100 },
    },
  };
  const incoming = {
    apps: [],
    downloads: {
      android: { id: 'boardgames-android', version: '1.2.4', versionCode: 27 },
      ios: { id: 'boardgames-ios', version: '1.2.3', versionCode: 21 },
    },
  };

  const merged = mergeAppDistributionManifest(existing, incoming);
  assert.equal(merged.downloads.android.version, '1.2.5');
  assert.equal(merged.downloads.harmonyos.version, '1.2.11');
  assert.equal(merged.downloads.ios.version, '1.2.3');
});

test('a valid platform package repairs a cross-platform artifact with a misleading higher build', () => {
  const existing = {
    apps: [{
      id: 'battery-organizer-android',
      platform: 'android',
      version: '1.1.23',
      versionCode: 1000123,
      fileName: 'battery-organizer-harmonyos-1.1.23.app',
    }],
  };
  const incoming = {
    apps: [{
      id: 'battery-organizer-android',
      platform: 'android',
      version: '1.1.19',
      versionCode: 19,
      fileName: 'battery-organizer-android-1.1.19.apk',
    }],
  };

  const merged = mergeAppDistributionManifest(existing, incoming);
  assert.equal(merged.apps[0].version, '1.1.19');
  assert.equal(merged.apps[0].versionCode, 19);
  assert.equal(merged.apps[0].fileName, 'battery-organizer-android-1.1.19.apk');
});

test('one bundle id can publish separate Apple platforms without duplicating one platform', () => {
  const existing = {
    apps: [
      { id: 'com.example.boardgames', platform: 'ios', version: '1.1.3', fileName: 'BoardGames-iOS.ipa' },
      { id: 'com.example.boardgames', platform: 'macos', version: '1.2.15', fileName: 'BoardGames-macOS-old.dmg' },
      { id: 'com.example.boardgames', platform: 'macos', version: '1.2.16', fileName: 'BoardGames-macOS.dmg' },
    ],
  };
  const incoming = {
    apps: [
      { id: 'com.example.boardgames', platform: 'ios', version: '1.1.3', fileName: 'BoardGames-iOS.ipa' },
      { id: 'com.example.boardgames', platform: 'ipados', version: '1.1.3', fileName: 'BoardGames-iPad.ipa' },
      { id: 'com.example.boardgames', platform: 'macos', version: '1.2.16', fileName: 'BoardGames-macOS.dmg' },
    ],
  };

  const merged = mergeAppDistributionManifest(existing, incoming);
  assert.deepEqual(
    merged.apps.map(entry => entry.platform).sort(),
    ['ios', 'ipados', 'macos'],
  );
  assert.equal(merged.apps.filter(entry => entry.platform === 'macos').length, 1);
  assert.equal(merged.apps.find(entry => entry.platform === 'macos').version, '1.2.16');
});
