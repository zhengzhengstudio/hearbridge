'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compareVersions,
  isRemoteReleaseNewer,
  validateDistributionRoots,
  validateOfflineHarmonyModule,
} = require('../SpaceFight-Cocos/tools/release-distribution-policy');

function fixtureEntry(overrides = {}) {
  return {
    id: 'spacefight-android',
    version: '0.10.17',
    build: 36,
    fileName: 'SpaceFight-Android-v0.10.17.apk',
    url: '/api/apps/SpaceFight-Android-latest.apk',
    latestUrl: '/api/apps/SpaceFight-Android-latest.apk',
    versionedUrl: '/api/apps/SpaceFight-Android-v0.10.17.apk',
    downloadURL: '/api/apps/SpaceFight-Android-v0.10.17.apk',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight',
    signed: true,
    debug: false,
    releaseChannel: 'release',
    ...overrides,
  };
}

function writeRoot(root, entry) {
  fs.mkdirSync(root, { recursive: true });
  const document = `${JSON.stringify({ apps: [entry] }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'manifest.json'), document);
  fs.writeFileSync(path.join(root, 'client-downloads.json'), document);
  for (const name of ['SpaceFight-Android-v0.10.17.apk', 'SpaceFight-Android-latest.apk']) {
    fs.writeFileSync(path.join(root, name), 'signed-apk-fixture');
  }
}

test('release comparison never lets a larger build downgrade the semantic version', () => {
  assert.equal(compareVersions('0.10.17', '0.10.17'), 0);
  assert.equal(compareVersions('0.10.18', '0.10.17'), 1);
  assert.equal(isRemoteReleaseNewer('0.10.16', 999, '0.10.17', 36), false);
  assert.equal(isRemoteReleaseNewer('0.10.17', 37, '0.10.17', 36), true);
  assert.equal(isRemoteReleaseNewer('0.10.18', 1, '0.10.17', 36), true);
});

test('dual app roots and both metadata documents must agree', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-distribution-'));
  const api = path.join(temp, 'api-apps');
  const publicRoot = path.join(temp, 'public-apps');
  try {
    writeRoot(api, fixtureEntry());
    writeRoot(publicRoot, fixtureEntry());
    assert.equal(validateDistributionRoots([api, publicRoot]).entries.length, 1);

    const changed = fixtureEntry({ build: 37 });
    fs.writeFileSync(path.join(publicRoot, 'client-downloads.json'), JSON.stringify({ apps: [changed] }));
    assert.throws(() => validateDistributionRoots([api, publicRoot]), /disagree/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('distribution rejects package identity and signed release claim errors', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-identity-'));
  const api = path.join(temp, 'api-apps');
  const publicRoot = path.join(temp, 'public-apps');
  try {
    writeRoot(api, fixtureEntry({ bundleIdentifier: 'example.wrong' }));
    writeRoot(publicRoot, fixtureEntry({ bundleIdentifier: 'example.wrong' }));
    assert.throws(() => validateDistributionRoots([api, publicRoot]), /bundle mismatch/);

    writeRoot(api, fixtureEntry({ signed: false }));
    writeRoot(publicRoot, fixtureEntry({ signed: false }));
    assert.throws(() => validateDistributionRoots([api, publicRoot]), /signed non-debug/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('targeted distribution validation ignores unselected legacy platforms', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-targeted-distribution-'));
  const api = path.join(temp, 'api-apps');
  const publicRoot = path.join(temp, 'public-apps');
  try {
    const current = fixtureEntry();
    const legacy = fixtureEntry({
      id: 'spacefight-macos',
      fileName: 'missing-legacy.dmg',
      url: '/api/apps/missing-legacy.dmg',
      latestUrl: '/api/apps/missing-legacy.dmg',
      versionedUrl: '/api/apps/missing-legacy.dmg',
      downloadURL: '/api/apps/missing-legacy.dmg',
    });
    for (const root of [api, publicRoot]) {
      writeRoot(root, current);
      const document = `${JSON.stringify({ apps: [current, legacy] }, null, 2)}\n`;
      fs.writeFileSync(path.join(root, 'manifest.json'), document);
      fs.writeFileSync(path.join(root, 'client-downloads.json'), document);
    }
    assert.equal(validateDistributionRoots([api, publicRoot], {
      entryIds: ['spacefight-android'],
    }).entries.length, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('HarmonyOS offline policy rejects every network permission', () => {
  const safe = JSON.stringify({ module: { requestPermissions: [{ name: 'ohos.permission.VIBRATE' }] } });
  assert.deepEqual(validateOfflineHarmonyModule(safe), ['ohos.permission.VIBRATE']);
  assert.throws(() => validateOfflineHarmonyModule(JSON.stringify({
    module: { requestPermissions: [{ name: 'ohos.permission.INTERNET' }] },
  })), /INTERNET/);
});

test('SpaceFight publisher derives release identity and verifies both roots', () => {
  const publisher = fs.readFileSync(
    path.resolve(__dirname, '../apps/publish_spacefight_harmony_offline.js'),
    'utf8',
  );
  assert.match(publisher, /SpaceFight-Cocos\/package\.json/);
  assert.match(publisher, /const version = releaseIdentity\.version/);
  assert.match(publisher, /const build = releaseIdentity\.build/);
  assert.match(publisher, /validateDistributionRoots\(appRoots, \{[\s\S]*checksums: true,[\s\S]*entryIds:/);
  assert.doesNotMatch(publisher, /const version = '0\.10\.9'/);
});
