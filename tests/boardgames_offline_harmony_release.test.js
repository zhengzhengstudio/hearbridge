const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
const bundle = 'cn.zhengzhengstudio.boardgames.offline.hmos';
const projectRoot = path.join(root, 'HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline');
const releases = [
  {
    id: bundle,
    artifactType: 'hap',
    versionedFile: 'ZhengZhengBoardGames-Offline-HarmonyOS-v1.0.6-signed.hap',
    latestFile: 'ZhengZhengBoardGames-Offline-HarmonyOS-latest.hap',
  },
  {
    id: `${bundle}.app`,
    artifactType: 'app',
    versionedFile: 'ZhengZhengBoardGames-Offline-HarmonyOS-v1.0.6-signed.app',
    latestFile: 'ZhengZhengBoardGames-Offline-HarmonyOS-latest.app',
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('offline HarmonyOS board games packages are published in every download manifest', () => {
  for (const appRoot of appRoots) {
    for (const manifestName of ['manifest.json', 'client-downloads.json']) {
      const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, manifestName), 'utf8'));
      for (const release of releases) {
        const entry = manifest.apps.find(item => item.id === release.id && item.platform === 'harmonyos');
        assert.ok(entry, `${release.id} is missing from ${manifestName}`);
        assert.equal(entry.version, '1.0.6');
        assert.equal(entry.versionCode, 1000600);
        assert.equal(entry.bundleIdentifier, bundle);
        assert.equal(entry.artifactType, release.artifactType);
        assert.equal(entry.fileName, release.versionedFile);
        assert.equal(entry.signed, true);
        assert.equal(entry.variant, 'offline');

        const versioned = path.join(appRoot, release.versionedFile);
        const latest = path.join(appRoot, release.latestFile);
        assert.ok(fs.existsSync(versioned), `${versioned} is missing`);
        assert.ok(fs.existsSync(latest), `${latest} is missing`);
        assert.equal(sha256(versioned), sha256(latest));
        assert.equal(entry.sha256, sha256(versioned));
        assert.equal(entry.size, fs.statSync(versioned).size);
      }
    }
  }
});

test('offline HarmonyOS launcher follows the current DevEco icon template', () => {
  const app = fs.readFileSync(path.join(projectRoot, 'AppScope/app.json5'), 'utf8');
  const module = fs.readFileSync(path.join(projectRoot, 'entry/src/main/module.json5'), 'utf8');
  const scopeBackground = fs.readFileSync(path.join(projectRoot, 'AppScope/resources/base/media/background.png'));
  const entryBackground = fs.readFileSync(path.join(projectRoot, 'entry/src/main/resources/base/media/background.png'));
  const scopeForeground = fs.readFileSync(path.join(projectRoot, 'AppScope/resources/base/media/foreground.png'));
  const entryForeground = fs.readFileSync(path.join(projectRoot, 'entry/src/main/resources/base/media/foreground.png'));
  const startIcon = fs.readFileSync(path.join(projectRoot, 'entry/src/main/resources/base/media/startIcon.png'));
  assert.match(app, /"versionName": "1\.0\.6"/);
  assert.match(app, /"versionCode": 1000600/);
  assert.match(app, /"icon": "\$media:layered_image"/);
  assert.match(module, /"icon": "\$media:layered_image"/);
  assert.match(module, /"ohos\.want\.action\.home"/);
  assert.match(module, /"action\.system\.home"/);
  assert.deepEqual(scopeBackground, entryBackground);
  assert.equal(scopeBackground[25], 2, 'layered icon background must be opaque RGB');
  assert.deepEqual(scopeForeground, entryForeground);
  assert.equal(startIcon.readUInt32BE(16), 1024);
  assert.equal(startIcon.readUInt32BE(20), 1024);
  assert.equal(startIcon[25], 2);
});

test('offline HarmonyOS build signs and verifies the HAP inside the APP pack', () => {
  const buildScript = fs.readFileSync(path.join(projectRoot, 'build-hap.sh'), 'utf8');
  const publishScript = fs.readFileSync(path.join(root, 'scripts/publish_boardgames_harmony_offline.py'), 'utf8');
  assert.match(buildScript, /create_hvigor_signing_config/);
  assert.match(buildScript, /verify_app_pack/);
  assert.match(publishScript, /verify_app_pack/);
});

test('offline HarmonyOS app exposes only local play and local settings', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  assert.doesNotMatch(source, /@kit\.ShareKit/);
  assert.doesNotMatch(source, /RoomInvite/);
  assert.match(source, /private offlineGames\(\): GameInfo\[\] \{\s*return this\.games\s*\}/);
  assert.match(source, /else if \(this\.activeTab === 'lobby'\) \{\s*this\.OfflineLobby\(\)/);
  assert.match(source, /else if \(this\.activeTab === 'profile'\) \{\s*this\.OfflineProfile\(\)/);
  const offlineProfile = source.slice(source.indexOf('OfflineProfile()'), source.indexOf('\n  build()'));
  assert.doesNotMatch(offlineProfile, /通行证账号|公开房间|排行榜|检查更新|反馈问题/);
});

test('public changelog mirror includes the offline HarmonyOS release', () => {
  const dataLogs = JSON.parse(fs.readFileSync(path.join(root, 'website/api/data/changelogs.json'), 'utf8'));
  const publicLogs = JSON.parse(fs.readFileSync(path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'), 'utf8'));
  const releaseId = '2026-08-28-boardgames-harmony-offline-1.0.6';
  assert.ok(dataLogs.some(item => item.id === releaseId));
  assert.ok(publicLogs.some(item => item.id === releaseId));
});

test('Termux package allowlist includes signed HAP and APP files under api/apps', () => {
  const syncSource = fs.readFileSync(path.join(root, 'sync_to_termux.js'), 'utf8');
  assert.match(syncSource, /APP_PACKAGE_EXTENSIONS/);
  assert.match(syncSource, /isAppDistributionPath\(normalized\) && APP_PACKAGE_EXTENSIONS\.has\(extension\)/);
  assert.match(syncSource, /'\.hap'/);
  assert.match(syncSource, /'\.app'/);
});
