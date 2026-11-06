const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const project = path.join(root, 'HarmonyOS-App/SpaceFightHarmonyOffline');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('HarmonyOS Offline store build uses the release identity and no network permission', () => {
  const app = read('HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/app.json5');
  const module = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/module.json5');
  const release = JSON.parse(read('SpaceFight-Cocos/package.json'));

  assert.match(app, /"bundleName"\s*:\s*"cn\.zhengzhengstudio\.spacefight\.huawei"/);
  assert.match(app, new RegExp(`"versionCode"\\s*:\\s*${release.build}`));
  assert.match(app, new RegExp(`"versionName"\\s*:\\s*"${release.version.replace(/\./g, '\\.')}"`));
  assert.doesNotMatch(module, /requestPermissions|INTERNET|ohos\.permission/);
});

test('HarmonyOS Offline pauses input when backgrounded and runs as an immersive landscape game', () => {
  const page = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets');
  const ability = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/entryability/EntryAbility.ets');
  const entryStrings = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/resources/base/element/string.json');

  assert.match(page, /onPageHide\(\)[\s\S]*?this\.paused\s*=\s*true[\s\S]*?this\.resetInput\(\)/);
  assert.match(page, /if \(this\.paused\)[\s\S]*?Button\('继续战斗'\)/);
  assert.doesNotMatch(page, /getContext\(this\)/);
  assert.doesNotMatch(entryStrings, /"name"\s*:\s*"app_name"/);
  assert.match(ability, /setPreferredOrientation\(window\.Orientation\.LANDSCAPE\)/);
  assert.match(ability, /setWindowLayoutFullScreen\(true\)/);
  assert.match(ability, /setWindowSystemBarEnable\(\[\]\)/);
});

test('HarmonyOS Offline release builder emits and verifies signed HAP and APP packages', () => {
  const scriptPath = path.join(project, 'build-release.sh');
  assert.equal(fs.existsSync(scriptPath), true);
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /assembleHap[\s\S]*?buildMode=release/);
  assert.match(script, /assembleApp/);
  assert.match(script, /SpaceFight-HarmonyOS-Offline-v\$\{VERSION_NAME\}\.hap/);
  assert.match(script, /SpaceFight-HarmonyOS-Offline-v\$\{VERSION_NAME\}\.app/);
  assert.match(script, /verify-app[\s\S]*?HAP_OUT/);
  assert.match(script, /verify-app[\s\S]*?APP_OUT/);
  assert.match(script, /cn\.zhengzhengstudio\.spacefight\.huawei/);
});

test('Cocos Harmony APP packager embeds the signed HAP and verifies both signature layers', () => {
  const scriptPath = path.join(root, 'SpaceFight-Cocos/tools/package-harmony-offline-release.sh');
  assert.equal(fs.existsSync(scriptPath), true);
  const script = fs.readFileSync(scriptPath, 'utf8');
  const packageJson = JSON.parse(read('SpaceFight-Cocos/package.json'));

  assert.match(packageJson.scripts['package:native:harmony-offline-release'], /package-harmony-offline-release\.sh/);
  assert.match(script, /assembleHap[\s\S]*?assembleApp/);
  assert.match(script, /sign-app[\s\S]*?SIGNED_HAP/);
  assert.match(script, /cp "\$SIGNED_HAP" "\$APP_UNPACKED\/entry-default\.hap"/);
  assert.match(script, /sign-app[\s\S]*?SIGNED_APP/);
  assert.match(script, /unzip -p "\$SIGNED_APP" entry-default\.hap/);
  assert.match(script, /verify-app[\s\S]*?INNER_HAP/);
  assert.match(script, /rm -rf "\$STAGED_RUNTIME"/);
  assert.match(script, /rsync -a "\$EXPORT_DIR\/data\/" "\$STAGED_RUNTIME\/"/);
});

test('Cocos Harmony release declares its compatible and target SDK explicitly', () => {
  const buildProfile = read('SpaceFight-Cocos/native/engine/harmonyos-next/build-profile.json5');

  assert.match(buildProfile, /"compatibleSdkVersion"\s*:\s*"5\.0\.3\(15\)"/);
  assert.match(buildProfile, /"targetSdkVersion"\s*:\s*"5\.0\.3\(15\)"/);
});

test('SpaceFight store promo image is exactly 1920 by 1080', () => {
  const imagePath = path.join(
    root,
    'website/spacefight.zhengzhengstudio.cn/assets/store/spacefight-harmonyos-offline-promo-1920x1080.png',
  );
  assert.equal(fs.existsSync(imagePath), true);
  const png = fs.readFileSync(imagePath);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
});

test('SpaceFight store promo is an accurate software introduction, not plain key art', () => {
  const source = read('apps/build_output/SpaceFight/marketing/promo-source.html');
  const listing = read('apps/build_output/SpaceFight/marketing/AppGallery-copy-zh-CN.md');

  assert.match(source, /纯单机太空射击/);
  assert.match(source, /无需登录/);
  assert.match(source, /六种任务/);
  assert.match(source, /第一.*第三人称/);
  assert.match(source, /双视角飞行/);
  assert.match(source, /左侧移动 · 右侧瞄准开火/);
  assert.match(source, /spacefight-harmonyos-offline-key-art-1920x1080\.png/);
  assert.match(listing, /cn\.zhengzhengstudio\.spacefight\.huawei/);
  assert.match(listing, /不申请网络权限/);
  assert.match(listing, /生存、首领、护航、防守、歼灭和突袭/);
});

test('website release metadata publishes both signed offline HAP and APP artifacts', () => {
  const release = JSON.parse(read('SpaceFight-Cocos/package.json'));
  const manifest = JSON.parse(read('website/api/apps/manifest.json'));
  const entries = manifest.apps.filter((app) => String(app.id).startsWith('spacefight-harmonyos-offline'));
  const hap = entries.find((app) => app.artifactType === 'hap' || String(app.fileName).endsWith('.hap'));
  const app = entries.find((entry) => entry.artifactType === 'app' || String(entry.fileName).endsWith('.app'));

  assert.equal(hap?.version, release.version);
  assert.equal(hap?.build, release.build);
  assert.equal(hap?.signed, true);
  assert.equal(app?.version, release.version);
  assert.equal(app?.build, release.build);
  assert.equal(app?.signed, true);
  assert.equal(app?.storeReady, true);
});
