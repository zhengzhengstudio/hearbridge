'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', 'SpaceFight-Cocos', 'native', 'engine', 'android', 'app');
const buildTool = require(path.resolve(__dirname, '..', 'SpaceFight-Cocos', 'tools', 'build-native-target.js'));

test('Cocos Android shell keeps the native in-app updater', () => {
  const activity = fs.readFileSync(path.join(root, 'src/com/cocos/game/AppActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');

  assert.match(activity, /https:\/\/zhengzhengstudio\.cn\/api\/apps\/manifest\.json/);
  assert.match(activity, /spacefight-android/);
  assert.match(activity, /Range/);
  assert.match(activity, /newFixedThreadPool\(DOWNLOAD_WORKERS\)/);
  assert.match(activity, /DOWNLOAD_WORKERS\s*=\s*4/);
  assert.match(activity, /AtomicLong/);
  assert.match(activity, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(activity, /showUpdateProgress/);
  assert.match(activity, /updateDownloadProgress/);
  assert.match(activity, /ProgressBar/);
  assert.match(activity, /ACTION_VIEW/);
  assert.match(activity, /requestSpaceFightUpdateCheck/);
  assert.match(activity, /checkForUpdates\(true\)/);
  assert.match(activity, /application\/vnd\.android\.package-archive/);
  assert.match(activity, /UpdateFileProvider\.uriFor/);
  assert.doesNotMatch(activity, /new Intent\(Intent\.ACTION_VIEW,\s*Uri\.parse\(download\)\)/,
    'APK updates must not be delegated to a browser');
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /UpdateFileProvider/);
  assert.match(manifest, /grantUriPermissions="true"/);
});

test('Android exports keep the public SpaceFight display name', () => {
  const strings = fs.readFileSync(path.resolve(
    __dirname, '..', 'SpaceFight-Cocos', 'native-build', 'spacefight-android',
    'proj', 'res', 'values', 'strings.xml',
  ), 'utf8');
  const buildSource = fs.readFileSync(path.resolve(
    __dirname, '..', 'SpaceFight-Cocos', 'tools', 'build-native-target.js',
  ), 'utf8');
  assert.match(strings, /<string name="app_name"[^>]*>SpaceFight<\/string>/);
  assert.match(buildSource, /writeFileSync\(outputStringsPath, androidStringsXml\(\)\)/);
  assert.match(buildSource, /syncAndroidIcons\(outputDirectory\)/);
  assert.doesNotMatch(buildSource, /templateStringsPath/);
  const templateStrings = fs.readFileSync(path.resolve(root, '..', 'res', 'values', 'strings.xml'), 'utf8');
  const gradle = fs.readFileSync(path.resolve(root, 'build.gradle'), 'utf8');
  assert.match(templateStrings, /<string name="app_name">SpaceFight<\/string>/);
  assert.doesNotMatch(gradle, /res\.srcDirs\s+["']\.\.\/res/);
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    assert.equal(fs.existsSync(path.resolve(
      __dirname, '..', 'SpaceFight-Cocos', 'native-build', 'spacefight-android',
      'proj', 'res', `mipmap-${density}`, 'ic_launcher.png',
    )), true, `${density} launcher icon should be exported`);
  }
});

test('Android release normalization uses version first and build only as a tie breaker', () => {
  const legacy = [
    'DownloadManager manager;',
    'String ACTION_DOWNLOAD_COMPLETE;',
    'manager.getUriForDownloadedFile(downloadId);',
    'boolean newer = build > localBuild() || compareVersions(version, localVersion()) > 0;',
  ].join('\n');
  const normalized = buildTool.normalizeAndroidUpdater(legacy);

  assert.match(normalized, /int versionComparison = compareVersions\(version, localVersion\(\)\)/);
  assert.match(normalized, /versionComparison > 0[\s\S]*versionComparison == 0 && build > localBuild\(\)/);
  assert.doesNotMatch(normalized, /build > localBuild\(\) \|\|/);
  assert.throws(() => buildTool.normalizeAndroidUpdater(
    `${legacy}\nnew Intent(Intent.ACTION_VIEW, Uri.parse(download));`,
  ), /browser/i);
});
