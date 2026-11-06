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
const versionedName = 'SurvivalDiary-Android-v0.6.2-b45.apk';
const release = { version: '0.6.2', build: 45 };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function entry(document) {
  return document.apps.find((item) => item.id === 'survival-diary-android');
}

test('all four release documents expose the same formal Survival Diary release', () => {
  const documents = appRoots.flatMap((appRoot) => ['manifest.json', 'client-downloads.json']
    .map((name) => readJson(path.join(appRoot, name))));
  const entries = documents.map(entry);

  entries.forEach((item) => {
    assert.ok(item, 'survival-diary-android entry is missing');
    assert.equal(item.version, release.version);
    assert.equal(item.latestVersion, release.version);
    assert.equal(item.versionName, release.version);
    assert.equal(item.build, release.build);
    assert.equal(item.versionCode, release.build);
    assert.equal(item.signed, true);
    assert.equal(item.signing, 'android-release');
    assert.equal(item.storeReady, true);
    assert.equal(item.fileName, versionedName);
    assert.equal(item.latestUrl, '/api/apps/download/SurvivalDiary-Android-latest.apk');
    assert.equal(item.versionedUrl, `/api/apps/download/${versionedName}`);
    assert.equal(item.debug, false);
    assert.doesNotMatch(item.fileName, /debug|test-signed/i);
  });

  entries.slice(1).forEach((item) => assert.deepEqual(item, entries[0]));
});

test('private and public versioned APK copies match the formal metadata byte for byte', () => {
  const canonical = entry(readJson(path.join(appRoots[0], 'manifest.json')));
  for (const appRoot of appRoots) {
    const versioned = path.join(appRoot, 'download', versionedName);
    assert.ok(fs.existsSync(versioned), `${versioned} is missing`);
    assert.equal(fs.statSync(versioned).size, canonical.size);
    assert.equal(canonical.fileSize, canonical.size);
    assert.equal(sha256(versioned), canonical.sha256);
    assert.equal(canonical.checksum, canonical.sha256);
  }
});

test('both changelog stores preserve the complete Survival Diary 0.2.0 release history', () => {
  const files = [
    path.join(root, 'website/api/data/changelogs.json'),
    path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'),
  ];
  const requiredFacts = [/12\s*种|十二种/, /8\s*类|八类/, /日记/, /手机|响应式/, /正式签名/, /下载中心/, /贴图|纹理/];
  const records = files.map((file) => readJson(file)
    .find((item) => item.product === '生存日记' && /0\.2\.0/.test(`${item.title}\n${item.content}`)));
  records.forEach((record) => {
    assert.ok(record, 'Survival Diary 0.2.0 changelog entry is missing');
    requiredFacts.forEach((pattern) => assert.match(record.content, pattern));
  });
  assert.deepEqual(records[1], records[0]);
});
