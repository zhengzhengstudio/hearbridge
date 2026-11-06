const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const androidRoot = path.join(root, 'apps/SurvivalDiary-Android');

function read(relativePath) {
  return fs.readFileSync(path.join(androidRoot, relativePath), 'utf8');
}

function pngDimensions(filePath) {
  const png = fs.readFileSync(filePath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runPublisher({ sourceApk, publishDir, versionedName, latestName, env = {} }) {
  const scriptPath = path.join(root, 'scripts/build_survival_diary_release.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /publish_verified_apk\(\)/);
  return childProcess.spawnSync('/bin/bash', [
    '-c',
    'source "$1"; install_release_cleanup_trap; publish_verified_apk "$2" "$3" "$4" "$5" "$6"',
    'publisher-test',
    scriptPath,
    sourceApk,
    sha256(sourceApk),
    publishDir,
    versionedName,
    latestName,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('Android project is an independent native Survival Diary application', () => {
  const gradle = read('app/build.gradle.kts');
  const activity = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/MainActivity.kt');
  assert.match(gradle, /namespace = "cn\.zhengzhengstudio\.survivaldiary"/);
  assert.match(gradle, /applicationId = "cn\.zhengzhengstudio\.survivaldiary"/);
  assert.match(activity, /setContent \{ SurvivalDiaryApp\(gameModel\) \}/);
  assert.doesNotMatch(activity, /WebView|loadUrl|javascript:/i);
});

test('Android packages shared gameplay content and native raster assets without a WebView fallback', () => {
  const gradle = read('app/build.gradle.kts');
  assert.match(gradle, /syncSurvivalDiaryContent/);
  assert.match(gradle, /syncSurvivalDiaryAssets/);
  assert.match(gradle, /SurvivalDiaryShared/);
  assert.match(gradle, /generated\/survivalAssets/);
  assert.doesNotMatch(gradle, /syncSurvivalDiaryWeb|index\.html/);
});

test('Android launcher persists native play and checks the manifest before entering', () => {
  const activity = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/MainActivity.kt');
  const updater = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/UpdateRepository.kt');
  const app = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  assert.match(activity, /gameModel\.persistNow\(\)/);
  assert.match(updater, /BuildConfig\.MANIFEST_URL/);
  assert.match(app, /IslandLauncher/);
  assert.match(app, /suspend fun checkUpdate/);
  assert.match(app, /if \(launchStage == "playing"\) \{\s*AndroidView\(/);
});

test('Android first frame does not synchronously decode world or HUD rasters', () => {
  const rasterAtlas = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/RasterAtlas.kt');
  const drawableAtlas = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/Atlas.kt');
  const hud = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt');
  const panels = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GamePanelSurface.kt');
  assert.match(rasterAtlas, /island-raster-loader/);
  assert.match(rasterAtlas, /fun building[\s\S]*?loadAsync\(/);
  assert.match(drawableAtlas, /fun player\(\): Bitmap\? = cache\.getOrSchedule/);
  assert.doesNotMatch(hud, /BitmapFactory\.decodeStream/);
  assert.match(panels, /withContext\(Dispatchers\.IO\)/);
});

test('Survival Diary release is version 0.6.2 build 46 and securely signed', () => {
  const gradle = read('app/build.gradle.kts');
  assert.match(gradle, /versionCode = 46/);
  assert.match(gradle, /versionName = "0\.6\.2"/);
  assert.match(gradle, /SURVIVAL_DIARY_STORE_PASSWORD/);
  assert.match(gradle, /signingConfig = signingConfigs\.getByName\("survivalRelease"\)/);
  assert.doesNotMatch(gradle, /storePassword\s*=\s*"[^"$]+"/);
});

test('Survival Diary signing is isolated from debug and distribution channels', () => {
  const gradle = read('app/build.gradle.kts');
  assert.match(gradle, /debug \{ applicationIdSuffix = "\.debug" \}/);
  assert.match(gradle, /create\("website"\)/);
  assert.match(gradle, /create\("play"\)/);
  assert.match(gradle, /release \{[\s\S]*?isDebuggable = false/);
  assert.match(gradle, /Missing Survival Diary release signing credentials/);
});

test('Survival Diary owns a full-resolution launcher resource', () => {
  const manifest = read('app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:icon="@drawable\/app_icon"/);
  const productIcon = path.join(androidRoot, 'app/src/main/res/drawable-nodpi/app_icon.png');
  assert.deepEqual(pngDimensions(productIcon), [1024, 1024]);
});

test('Survival Diary launcher rasters are deterministic derivatives of the approved master', () => {
  const master = path.join(root, 'website/survival-diary.zhengzhengstudio.cn/assets/art/app-icon-master-v1.png');
  assert.equal(sha256(master), '5690030f678b5a22e67b934bec8696865a603b6ac9c493ea2d691a69a556ad93');

  const productIcon = path.join(androidRoot, 'app/src/main/res/drawable-nodpi/app_icon.png');
  assert.equal(sha256(productIcon), sha256(master));
});

test('packaged Survival Diary APK owns round and Android 13 themed icon resources', { skip: !process.env.SURVIVAL_DIARY_RELEASE_APK }, () => {
  const apk = path.resolve(process.env.SURVIVAL_DIARY_RELEASE_APK);
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
  const buildTools = fs.readdirSync(path.join(sdk, 'build-tools')).sort().at(-1);
  const aapt2 = path.join(sdk, 'build-tools', buildTools, 'aapt2');
  const resources = childProcess.execFileSync(aapt2, ['dump', 'resources', apk], { encoding: 'utf8' });
  const round = resources.match(/resource (0x[0-9a-f]+) mipmap\/ic_launcher_round\n([\s\S]*?)(?=\n    resource |\n  type )/);
  const monochrome = resources.match(/resource (0x[0-9a-f]+) drawable\/ic_launcher_monochrome\n\s+\(\) \(file\) (\S+)/);
  const background = resources.match(/resource (0x[0-9a-f]+) color\/survival_diary_launcher_background/);
  assert.ok(round, 'round icon resource missing from APK');
  assert.match(round[2], /\(mdpi\).*type=PNG/);
  assert.match(round[2], /\(xxxhdpi\).*type=PNG/);
  assert.match(round[2], /\(anydpi\) \(file\) (\S+) type=XML/);
  assert.ok(monochrome, 'product monochrome resource missing from APK');
  assert.ok(background, 'product adaptive background missing from APK');

  const roundFile = round[2].match(/\(anydpi\) \(file\) (\S+) type=XML/)[1];
  const roundTree = childProcess.execFileSync(aapt2, ['dump', 'xmltree', apk, '--file', roundFile], { encoding: 'utf8' });
  const monochromeTree = childProcess.execFileSync(aapt2, ['dump', 'xmltree', apk, '--file', monochrome[2]], { encoding: 'utf8' });
  assert.match(roundTree, new RegExp(`@${background[1]}`));
  assert.match(roundTree, new RegExp(`@${monochrome[1]}`));
  assert.match(monochromeTree, /M22,18 L86,18/);
});

test('Survival Diary release script fails closed before publishing an APK', () => {
  const scriptPath = path.join(root, 'scripts/build_survival_diary_release.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /security find-generic-password/);
  assert.match(script, /assembleWebsiteRelease/);
  assert.match(script, /"\$(?:APKSIGNER|apksigner)"\s+verify --verbose --print-certs/);
  assert.match(script, /CN=Android Debug/);
  assert.match(script, /android:debuggable/);
  assert.match(script, /cn\.zhengzhengstudio\.survivaldiary/);
  assert.match(script, /EXPECTED_VERSION_CODE="46"/);
  assert.match(script, /EXPECTED_VERSION_NAME="0\.6\.2"/);
  assert.match(script, /shasum[^\n]*-a 256/);
  assert.match(script, /VERSIONED_NAME="SurvivalDiary-Android-v0\.6\.2-b46\.apk"/);
  assert.match(script, /LATEST_NAME="SurvivalDiary-Android-latest\.apk"/);
  assert.doesNotMatch(script, /SurvivalDiary-Android-[^"\n]*-signed\.apk/);
});

test('release publisher verifies and installs a complete byte-identical artifact set', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'survival-release-success-'));
  try {
    const sourceApk = path.join(temp, 'source.apk');
    const publishDir = path.join(temp, 'publish');
    fs.mkdirSync(publishDir);
    fs.writeFileSync(sourceApk, Buffer.from('verified-apk-payload'));
    const result = runPublisher({
      sourceApk,
      publishDir,
      versionedName: 'SurvivalDiary-Android-v0.2.0-b2.apk',
      latestName: 'SurvivalDiary-Android-latest.apk',
    });
    assert.equal(result.status, 0, result.stderr);
    const versioned = path.join(publishDir, 'SurvivalDiary-Android-v0.2.0-b2.apk');
    const latest = path.join(publishDir, 'SurvivalDiary-Android-latest.apk');
    assert.deepEqual(fs.readFileSync(versioned), fs.readFileSync(sourceApk));
    assert.deepEqual(fs.readFileSync(latest), fs.readFileSync(sourceApk));
    assert.equal(fs.readFileSync(`${versioned}.sha256`, 'utf8'), `${sha256(sourceApk)}  SurvivalDiary-Android-v0.2.0-b2.apk\n`);
    assert.equal(fs.readFileSync(`${latest}.sha256`, 'utf8'), `${sha256(sourceApk)}  SurvivalDiary-Android-latest.apk\n`);
    assert.deepEqual(fs.readdirSync(publishDir).filter((name) => name.startsWith('.survival-diary-release.')), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('release publisher rolls back every public file when an atomic replace fails', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'survival-release-rollback-'));
  try {
    const sourceApk = path.join(temp, 'source.apk');
    const publishDir = path.join(temp, 'publish');
    const fakeBin = path.join(temp, 'bin');
    const moveCount = path.join(temp, 'move-count');
    const versionedName = 'SurvivalDiary-Android-v0.2.0-b2.apk';
    const latestName = 'SurvivalDiary-Android-latest.apk';
    fs.mkdirSync(publishDir);
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(sourceApk, Buffer.from('new-verified-apk'));
    const oldFiles = {
      [versionedName]: 'old-versioned-apk',
      [`${versionedName}.sha256`]: 'old-versioned-checksum\n',
      [latestName]: 'old-latest-apk',
      [`${latestName}.sha256`]: 'old-latest-checksum\n',
    };
    for (const [name, contents] of Object.entries(oldFiles)) fs.writeFileSync(path.join(publishDir, name), contents);
    const fakeMv = path.join(fakeBin, 'mv');
    fs.writeFileSync(fakeMv, `#!/bin/bash\ncount=0\n[[ -f "$MOVE_COUNT_FILE" ]] && count=$(<"$MOVE_COUNT_FILE")\ncount=$((count + 1))\nprintf '%s' "$count" > "$MOVE_COUNT_FILE"\n[[ "$count" -eq 2 ]] && exit 73\nexec /bin/mv "$@"\n`);
    fs.chmodSync(fakeMv, 0o755);

    const result = runPublisher({
      sourceApk,
      publishDir,
      versionedName,
      latestName,
      env: { PATH: `${fakeBin}:${process.env.PATH}`, MOVE_COUNT_FILE: moveCount },
    });
    assert.notEqual(result.status, 0, result.stdout);
    for (const [name, contents] of Object.entries(oldFiles)) {
      assert.equal(fs.readFileSync(path.join(publishDir, name), 'utf8'), contents, name);
    }
    assert.deepEqual(fs.readdirSync(publishDir).filter((name) => name.startsWith('.survival-diary-release.')), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('release signing documentation does not disclose a local account or password relationship', () => {
  const readme = fs.readFileSync(path.join(root, 'Android证书/README.md'), 'utf8');
  assert.match(readme, /Keychain account: `\$USER`/);
  assert.doesNotMatch(readme, /Keychain account: `ljg`/);
  assert.doesNotMatch(readme, /passwords are the same|passwords? (?:match|share|reuse)/i);
});
