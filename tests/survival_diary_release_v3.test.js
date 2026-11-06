const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const privateApps = path.join(root, 'website/api/apps');
const documentFiles = [
  'website/api/apps/manifest.json', 'website/api/apps/client-downloads.json',
  'website/zhengzhengstudio.cn/api/apps/manifest.json', 'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
];
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const survival = (document) => document.apps.filter((item) => item.product === 'survival-diary');
const release = { version: '0.6.2', build: 45 };

test('all release mirrors expose the complete Survival Diary package matrix', () => {
  const sets = documentFiles.map((file) => survival(read(file)));
  assert.deepEqual(sets[0].map((item) => item.id), [
    'survival-diary-web', 'survival-diary-android', 'survival-diary-android-play',
    'survival-diary-ios', 'survival-diary-macos', 'survival-diary-harmony-online', 'survival-diary-harmony-offline',
  ]);
  for (const set of sets) {
    const android = set.find((item) => item.id === 'survival-diary-android');
    assert.equal(android.version, release.version);
    assert.equal(android.build, release.build);
    assert.equal(android.available, true);
    assert.equal(android.signed, true);
    const play = set.find((item) => item.id === 'survival-diary-android-play');
    assert.equal(play.available, false);
    for (const id of ['survival-diary-ios', 'survival-diary-macos', 'survival-diary-harmony-online']) {
      const debugPackage = set.find((item) => item.id === id);
      assert.equal(debugPackage.available, true);
      assert.equal(debugPackage.signed, false);
      assert.equal(debugPackage.storeReady, false);
      assert.match(debugPackage.signing, /debug|unsigned/);
    }
    const offlineHarmony = set.find((item) => item.id === 'survival-diary-harmony-offline');
    assert.equal(offlineHarmony.version, '0.6.2');
    assert.equal(offlineHarmony.build, 60203);
    assert.equal(offlineHarmony.available, true);
    assert.equal(offlineHarmony.signed, true);
    assert.equal(offlineHarmony.signing, 'huawei-release');
    assert.equal(offlineHarmony.storeReady, true);
    assert.equal(offlineHarmony.fileName, 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.hap');
    assert.equal(offlineHarmony.size, 11723449);
    assert.equal(offlineHarmony.sha256, '22f6b798ccf779392e56c08cc1d922f47e57386dbff140ed00750f18f665f2cf');
    assert.equal(offlineHarmony.appFileName, 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.app');
    assert.equal(offlineHarmony.appSize, 11503480);
    assert.equal(offlineHarmony.appSha256, 'f03a85fa951dcd6d6cca76c9fe9e3f3bdcb0cd4bf1563398d08134aaad623b19');
    assert.equal(offlineHarmony.blockedReason, '');
    assert.deepEqual(set, sets[0]);
  }
});

test('download-center entries carry a stable product introduction separate from release notes', () => {
  for (const file of documentFiles) {
    const entries = survival(read(file));
    const android = entries.find((item) => item.id === 'survival-diary-android');
    assert.ok(android.description.length >= 40);
    assert.ok(android.notes.length >= 3);
    assert.notEqual(android.description, android.remarks);
  }
});

test('every available package is real and every unavailable package has no download URL', () => {
  for (const item of survival(read(documentFiles[0]))) {
    if (item.kind === 'web') { assert.equal(item.available, true); continue; }
    if (!item.available) {
      assert.equal(item.signed, false);
      assert.equal(item.storeReady, false);
      assert.equal(item.fileName, '');
      assert.equal(item.downloadURL, '');
      assert.ok(item.blockedReason.length > 0);
      continue;
    }
    const relativeDownloadPath = item.downloadURL.replace(/^\/api\/apps\//, '');
    assert.ok(relativeDownloadPath && !relativeDownloadPath.includes('..'));
    const file = path.join(privateApps, relativeDownloadPath);
    assert.ok(fs.existsSync(file), item.fileName);
    assert.equal(fs.statSync(file).size, item.size);
    assert.equal(digest(file), item.sha256);
    assert.equal(item.sha256, item.checksum);
  }
});

test('Android versioned file is identical in private and public trees and is the installer URL', () => {
  const names = ['SurvivalDiary-Android-v0.6.2-b45.apk'];
  const expected = process.env.SURVIVAL_DIARY_EXPECTED_SHA256 || survival(read(documentFiles[0])).find((item) => item.id === 'survival-diary-android').sha256;
  for (const item of documentFiles.map((file) => survival(read(file)).find((entry) => entry.id === 'survival-diary-android'))) {
    assert.equal(item.url, '/api/apps/download/SurvivalDiary-Android-latest.apk');
    assert.equal(item.latestUrl, item.url);
    assert.equal(item.downloadURL, '/api/apps/download/SurvivalDiary-Android-v0.6.2-b45.apk');
  }
  for (const base of ['website/api/apps/download', 'website/zhengzhengstudio.cn/api/apps/download']) {
    for (const name of names) assert.equal(digest(path.join(root, base, name)), expected);
  }
});

test('release metadata generator fails closed and never activates unsigned artifacts', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/generate_survival_diary_release_metadata.mjs'), 'utf8');
  assert.match(source, /available artifact missing/);
  assert.match(source, /if \(!platform\.available\)/);
  assert.match(source, /result\.downloadURL = ''/);
  assert.doesNotMatch(source, /unsigned\.(ipa|hap|app)/i);
});

test('website watcher preserves nested download paths from app manifests', () => {
  const source = fs.readFileSync(path.join(root, 'sync_to_termux.js'), 'utf8');
  assert.match(source, /const packagePaths = new Set\(\)/);
  assert.match(source, /cleanValue\.slice\(markerIndex \+ marker\.length\)/);
  assert.match(source, /`website\/\$\{prefix\}\/\$\{packagePath\}`/);
  assert.match(source, /`zhengzhengstudio\.cn\/api\/apps\/\$\{appPath\}`/);
});
