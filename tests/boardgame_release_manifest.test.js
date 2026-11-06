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
const releases = {
  macos: {
    id: 'com.zzsys.MuitpalBoardGames.MultipleBoardGames',
    version: '1.2.16',
    build: 31,
    versionCode: 31,
    versionedFile: 'MultipleBoardGames-macOS-v1.2.16.dmg',
    latestFile: 'MultipleBoardGames-macOS-latest.dmg',
  },
  android: {
    id: 'cn.zhengzhengstudio.boardgames',
    version: '1.2.16',
    build: 31,
    versionCode: 31,
    versionedFile: 'ZhengzhengBoardGames-Android-v1.2.16-build31.apk',
    latestFile: 'ZhengzhengBoardGames-Android-latest-build31.apk',
  },
  harmonyos: {
    id: 'cn.zhengzhengstudio.boardgames.hmos',
    version: '1.2.16',
    build: 31,
    versionCode: 1021600,
    versionedFile: 'ZhengZhengBoardGames-HarmonyOS-v1.2.16-signed.hap',
    latestFile: 'ZhengZhengBoardGames-HarmonyOS-latest.hap',
  },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertRelease(entry, release, appRoot) {
  assert.ok(entry, `${release.id} is missing`);
  assert.equal(entry.version, release.version);
  assert.equal(entry.versionName, release.version);
  assert.equal(entry.latestVersion, release.version);
  assert.equal(entry.build, release.build);
  assert.equal(entry.versionCode, release.versionCode);
  assert.equal(entry.fileName, release.versionedFile);
  assert.equal(entry.shortVersion, release.version);
  assert.equal(entry.filename, release.versionedFile);
  assert.equal(entry.file, release.versionedFile);
  assert.equal(entry.versionedURL, `/api/apps/${release.versionedFile}`);
  assert.equal(entry.downloadUrl, `/api/apps/${release.versionedFile}`);
  assert.equal(entry.download_url, `/api/apps/${release.versionedFile}`);

  const versionedPath = path.join(appRoot, release.versionedFile);
  const latestPath = path.join(appRoot, release.latestFile);
  assert.ok(fs.existsSync(versionedPath), `${versionedPath} is missing`);
  assert.ok(fs.existsSync(latestPath), `${latestPath} is missing`);
  assert.equal(sha256(versionedPath), sha256(latestPath), `${release.platform || release.id} latest package is stale`);
  assert.equal(entry.size, fs.statSync(versionedPath).size);
  assert.equal(entry.fileSize, fs.statSync(versionedPath).size);
  assert.equal(entry.sha256, sha256(versionedPath));
  assert.equal(entry.checksum, sha256(versionedPath));
}

test('board game releases match packages in both public app directories', () => {
  for (const appRoot of appRoots) {
    for (const manifestName of ['client-downloads.json', 'manifest.json']) {
      const manifest = readJson(path.join(appRoot, manifestName));
      for (const [platform, release] of Object.entries(releases)) {
        const entry = manifest.apps.find(app => app.id === release.id && app.platform === platform);
        assertRelease(entry, release, appRoot);
      }
    }
  }
});

test('client download aliases do not lag behind app entries', () => {
  for (const appRoot of appRoots) {
    const manifest = readJson(path.join(appRoot, 'client-downloads.json'));
    assert.equal(manifest.latestVersion, releases.android.version);
    assert.equal(manifest.latestBuild, releases.android.build);
    assert.equal(manifest.versionCode, releases.android.versionCode);
    for (const platform of ['macos', 'android']) {
      const release = releases[platform];
      assertRelease(manifest.downloads[platform], release, appRoot);
    }
  }
});

test('sync allowlist accepts current and future signed HarmonyOS releases', () => {
  const source = fs.readFileSync(path.join(root, 'sync_to_termux.js'), 'utf8');
  assert.match(source, /isAppDistributionPath\(normalized\)[\s\S]*APP_PACKAGE_EXTENSIONS\.has\(extension\)/);
});
