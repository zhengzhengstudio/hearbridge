const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(relativePath, extension) {
  const directory = path.join(root, relativePath);
  return fs.readdirSync(directory)
    .filter(file => !extension || file.endsWith(extension))
    .sort();
}

const sources = {
  android: 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt',
  androidBuild: 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/build.gradle.kts',
  ios: 'apps/SpaceFight-iOS/Sources/main.swift',
  macos: 'apps/SpaceFightMac/Sources/main.swift',
  appleScene: 'apps/SpaceFightShared/NativeGameScene.swift',
  harmony: 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets',
  harmonyApp: 'HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5',
  harmonyAppStrings: 'HarmonyOS-App/SpaceFightHarmony/AppScope/resources/base/element/string.json',
  harmonyOffline: 'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets',
  harmonyOfflineApp: 'HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/app.json5',
  harmonyOfflineAppStrings: 'HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/resources/base/element/string.json',
  harmonyOfflineModule: 'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/module.json5',
  harmonyOfflineBuild: 'HarmonyOS-App/SpaceFightHarmonyOffline/build-hap.sh',
  web: 'website/spacefight.zhengzhengstudio.cn/index.html',
  webCss: 'SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css',
  webShell: 'SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.js',
};

test('native clients never embed or load the website UI', () => {
  for (const key of ['android', 'ios', 'macos', 'appleScene', 'harmony']) {
    const source = read(sources[key]);
    assert.doesNotMatch(source, /\b(?:WebView|WKWebView|ArkWeb)\b/, `${key} contains a web container`);
    assert.doesNotMatch(source, /spacefight\.zhengzhengstudio\.cn\/(?:["']|\?)/, `${key} loads the public website`);
  }
});

test('all native clients use the 0.10.2 build 20 development identity', () => {
  const androidBuild = read(sources.androidBuild);
  assert.match(androidBuild, /applicationId\s*=\s*"cn\.zhengzhengstudio\.spacefight"/);
  assert.match(androidBuild, /versionCode\s*=\s*20\b/);
  assert.match(androidBuild, /versionName\s*=\s*"0\.10\.2"/);

  for (const key of ['android', 'ios', 'macos', 'harmony']) {
    const source = read(sources[key]);
    assert.match(source, /0\.10\.2/, `${key} has a stale version`);
    assert.match(source, /(?:APP_BUILD|appBuild)[^\n]*20\b/i, `${key} has a stale build`);
  }

  assert.match(read(sources.harmonyApp), /cn\.zhengzhengstudio\.spacefight\.hmos/);
  assert.match(read(sources.harmonyAppStrings), /"value": "SpaceFight"/);
});

test('HarmonyOS Offline is an independently installable local-only game', () => {
  assert.match(read(sources.harmonyOfflineApp), /cn\.zhengzhengstudio\.spacefight\.hmos\.offline/);
  assert.match(read(sources.harmonyOfflineAppStrings), /SpaceFight Offline/);

  const offline = read(sources.harmonyOffline);
  assert.doesNotMatch(offline, /@ohos\.net\.(?:http|webSocket)/);
  assert.doesNotMatch(offline, /passport|通行证|公开协作|checkUpdates|manifestUrl|connectSocket/i);
  assert.doesNotMatch(read(sources.harmonyOfflineModule), /ohos\.permission\.INTERNET/);
  assert.match(offline, /stepLocalBattle/);
  assert.match(offline, /updateMove/);
  assert.match(offline, /updateFire/);
  assert.match(offline, /trainingStep/);
  assert.match(read(sources.harmonyOfflineBuild), /SpaceFight-HarmonyOS-Offline-v\$\{VERSION:-test\}\.hap/);
  assert.match(read(sources.harmonyOfflineBuild), /SpaceFightHarmonyOffline-build/);
});

test('offline missions use local simulation and keep networking secondary', () => {
  const android = read(sources.android);
  assert.match(android, /mode\s*!=\s*"public"[\s\S]{0,500}localRunning\s*=\s*true/);
  assert.match(android, /if\s*\(mode\s*!=\s*"public"\)[\s\S]{0,900}return[\s\S]{0,500}newWebSocket/);

  const apple = read(sources.appleScene);
  assert.match(apple, /usesLocalBattle\s*=\s*mode\s*!=\s*"public"/);
  assert.match(apple, /if\s+usesLocalBattle[\s\S]{0,700}localBattle\.reset[\s\S]{0,700}else[\s\S]{0,500}socket\.connect/);

  const harmony = read(sources.harmony);
  assert.match(harmony, /selectedMode\s*===\s*'public'/);
  assert.match(harmony, /localRunning\s*=\s*true/);
});

test('web flight deck uses a real app icon, rendered ships, and complete controls', () => {
  const html = read(sources.web);
  assert.match(html, /spacefight-icon\.[a-z0-9]+\.png/);
  for (const id of ['GameCanvas', 'MoveStick', 'PrimaryControl', 'SecondaryControl', 'CameraControl', 'PauseControl']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.equal(listFiles('website/spacefight.zhengzhengstudio.cn/assets/models', '.glb').length, 6);
  assert.equal((html.match(/data-loadout-slot=/g) || []).length, 34);
  for (const slot of ['weapon', 'secondary', 'device', 'core', 'engine', 'shield', 'utility', 'boost', 'skin']) {
    assert.match(html, new RegExp(`data-loadout-slot="${slot}"`), `${slot} hardpoint is missing`);
  }
  assert.match(html, /id="TargetHealthBar"/);
  assert.match(html, /id="TargetHealthValue"/);
});

test('download center exposes current native client releases', () => {
  const release = JSON.parse(read('SpaceFight-Cocos/package.json'));
  const manifest = JSON.parse(read('website/api/apps/client-downloads.json'));
  const ids = new Set(manifest.apps.map((entry) => entry.id));
  for (const id of [
    'spacefight-android',
    'spacefight-ios',
    'spacefight-macos',
    'spacefight-harmonyos-offline',
    'spacefight-harmonyos-offline-app',
  ]) assert.equal(ids.has(id), true, `${id} is missing`);
  for (const entry of manifest.apps.filter((item) => String(item.id).startsWith('spacefight-'))) {
    const isCurrentRelease = entry.id === 'spacefight-android'
      || String(entry.id).includes('harmonyos-offline');
    const expectedVersion = isCurrentRelease ? release.version : '0.10.0';
    const expectedBuild = isCurrentRelease ? release.build : 18;
    assert.equal(entry.version, expectedVersion);
    assert.equal(entry.build, expectedBuild);
  }
});

test('passport profile exposes current SpaceFight clients from the downloads API', () => {
  const passport = read('website/zhengzhengstudio.cn/passport/index.html');
  assert.match(passport, /id="spacefight-client-section"/);
  assert.match(passport, /fetch\('\/api\/downloads'/);
  assert.match(passport, /\^SpaceFight-\/i/);
  assert.match(passport, /file\.installUrl \|\| file\.url/);
  assert.match(passport, /file\.version \|\| '0\.10\.0'/);
  assert.match(passport, /file\.build \|\| 18/);
});

test('native update checks compare semantic version before build number', () => {
  const android = read(sources.android);
  const ios = read(sources.ios);
  const macos = read(sources.macos);
  const harmony = read(sources.harmony);

  assert.match(android, /isRemoteReleaseNewer\(latestVersion,\s*latestBuild\)/);
  assert.match(android, /remotePart\s*>\s*localPart[\s\S]*build\s*>\s*APP_BUILD/);
  for (const source of [ios, macos]) {
    assert.match(source, /isRemoteReleaseNewer\(version:\s*version,\s*build:\s*remoteBuild\)/);
    assert.match(source, /remotePart\s*>\s*localPart[\s\S]*build\s*>\s*appBuild/);
  }
  assert.match(harmony, /isRemoteReleaseNewer\(entry\.version,\s*Number\(entry\.build\)\)/);
  assert.match(harmony, /remotePart\s*>\s*localPart[\s\S]*build\s*>\s*this\.appBuild/);
});

test('release checks bypass stale manifest caches', () => {
  const android = read(sources.android);
  const ios = read(sources.ios);
  const macos = read(sources.macos);
  const harmony = read(sources.harmony);
  const server = read('website/api/server.js');

  assert.match(android, /\.header\("Cache-Control",\s*"no-cache"\)/);
  for (const source of [ios, macos]) {
    assert.match(source, /cachePolicy\s*=\s*\.reloadIgnoringLocalCacheData/);
    assert.match(source, /setValue\("no-cache",\s*forHTTPHeaderField:\s*"Cache-Control"\)/);
  }
  assert.match(harmony, /manifestUrl}\?release=\$\{Date\.now\(\)\}/);
  assert.match(server, /api\/apps\/manifest\.json[\s\S]*no-store,\s*no-cache,\s*must-revalidate/);
});

test('primary UI sources contain no emoji controls or legacy CSS weapon drawings', () => {
  const primary = [read(sources.web), read(sources.android), read(sources.ios), read(sources.macos), read(sources.harmony)].join('\n');
  assert.doesNotMatch(primary, /[\u{1F300}-\u{1FAFF}]/u);

  const css = read(sources.webCss);
  assert.doesNotMatch(css, /\.weapon-(?:laser|missile|plasma|scatter|railgun)::(?:before|after)/);
});

test('native platforms bundle vector interface controls', () => {
  const androidVectors = listFiles('ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/drawable', '.xml')
    .filter(file => !file.startsWith('ic_launcher_'));
  assert.ok(androidVectors.length >= 4, 'Android needs at least four non-launcher vector controls');

  const harmonyVectors = listFiles('HarmonyOS-App/SpaceFightHarmony/entry/src/main/resources/base/media', '.svg');
  assert.ok(harmonyVectors.length >= 3, 'HarmonyOS needs profile, update, and pause SVG controls');

  const harmonyOfflineVectors = listFiles('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/resources/base/media', '.svg');
  assert.ok(harmonyOfflineVectors.length >= 1, 'HarmonyOS Offline needs a pause SVG control');
});
