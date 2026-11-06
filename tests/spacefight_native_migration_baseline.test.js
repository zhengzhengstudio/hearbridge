const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-native-baseline-'));
const outputPath = path.join(fixtureRoot, 'docs/spacefight/baselines/2026-08-03/native-foundation.json');
const archiveDirectory = path.join(fixtureRoot, 'archives');
const fixedNow = new Date('2026-08-03T12:34:56.789Z');

function writeFixture(relativePath, content) {
  const filePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

writeFixture('SpaceFight-Cocos/package.json', JSON.stringify({ version: '0.10.0', build: 18 }));
[
  'ZhengZhengStudioApp/ZhengZhengStudioAndroid',
  'apps/SpaceFight-iOS',
  'apps/SpaceFightMac',
  'apps/SpaceFightShared',
  'HarmonyOS-App/SpaceFightHarmony',
  'HarmonyOS-App/SpaceFightHarmonyOffline',
].forEach((directory) => writeFixture(`${directory}/source.txt`, directory));
writeFixture('apps/build_spacefight_apps.sh', '# fixture source');
writeFixture('website/api/apps/SpaceFight-Android-v0.10.0.apk', 'android');
writeFixture('website/api/apps/SpaceFight-iOS-v0.10.0.ipa', 'ios');
writeFixture('website/api/apps/SpaceFight-macOS-v0.10.0.dmg', 'macos');
writeFixture('website/api/apps/SpaceFight-HarmonyOS-v0.10.0-unsigned.hap', 'harmonyos');
writeFixture('website/api/apps/SpaceFight-HarmonyOS-Offline-v0.10.0.hap', 'harmonyos-offline-hap');
writeFixture('website/api/apps/SpaceFight-HarmonyOS-Offline-v0.10.0.app', 'harmonyos-offline-app');
writeFixture('website/api/data/harmony-signing/cn.zhengzhengstudio.spacefight.hmos/signing.env', 'KEY_PWD=secret');
writeFixture('SpaceFight-Cocos/build/cache.bin', 'build cache');
writeFixture('SpaceFight-Cocos/library/cache.bin', 'library cache');
writeFixture('SpaceFight-Cocos/temp/cache.bin', 'temp cache');
writeFixture('SpaceFight-Cocos/.preview/cache.bin', 'preview cache');
writeFixture('SpaceFight-Cocos/node_modules/secret.txt', 'dependency cache');
writeFixture('SpaceFight-Cocos/signing.env', 'KEY_PWD=secret');
writeFixture('SpaceFight-Cocos/private.p12', 'private key');
writeFixture('SpaceFight-Cocos/certificate.cer', 'certificate');
writeFixture('SpaceFight-Cocos/profile.p7b', 'profile');

const { createBaseline } = require('../SpaceFight-Cocos/tools/create-native-migration-baseline.js');

test('baseline records every current release artifact without copying signing secrets', () => {
  const manifest = createBaseline({ root: fixtureRoot, outputPath, archiveDirectory, now: fixedNow });
  assert.deepEqual(manifest.identity, { version: '0.10.0', build: 18 });
  assert.deepEqual(manifest.artifacts.map((item) => item.platform), [
    'android', 'ios', 'macos', 'harmonyos', 'harmonyos-offline-hap', 'harmonyos-offline-app',
  ]);
  assert.ok(manifest.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.equal(JSON.stringify(manifest).includes('KEY_PWD'), false);
  assert.equal(manifest.archive.path, path.join(archiveDirectory, 'SpaceFight-native-foundation-before-2026-08-03T12-34-56-789Z.tar.gz'));
  assert.ok(fs.existsSync(manifest.archive.path));

  const archiveEntries = execFileSync('tar', ['-tzf', manifest.archive.path], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.equal(archiveEntries.filter((entry) => entry.startsWith('website/api/apps/SpaceFight-')).length, 6);
  assert.ok(archiveEntries.includes('SpaceFight-Cocos/package.json'));
  assert.equal(archiveEntries.some((entry) => /(^|\/)(build|library|temp|\.preview|node_modules)(\/|$)|signing\.env|\.(p12|cer|p7b)$|website\/api\/data\/harmony-signing/i.test(entry)), false);

  for (const item of manifest.artifacts) {
    assert.equal(item.size, fs.statSync(path.join(fixtureRoot, item.path)).size);
  }
});

test('baseline fails closed when a declared source input is missing', () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-native-baseline-missing-'));
  fs.cpSync(fixtureRoot, missingRoot, { recursive: true });
  fs.rmSync(path.join(missingRoot, 'apps/SpaceFightMac'), { recursive: true });

  assert.throws(
    () => createBaseline({
      root: missingRoot,
      outputPath: path.join(missingRoot, 'baseline.json'),
      archiveDirectory: path.join(missingRoot, 'archives'),
      now: fixedNow,
    }),
    /Missing declared source input: apps\/SpaceFightMac/,
  );
});
