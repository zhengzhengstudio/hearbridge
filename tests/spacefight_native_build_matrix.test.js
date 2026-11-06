'use strict';

const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const combatScene = {
  url: 'db://assets/scenes/Combat.scene',
  uuid: 'ee9bc189-ccbe-45a5-bafb-2a39c70b4b08',
};
const landscapeOrientation = Object.freeze({
  portrait: false,
  upsideDown: false,
  landscapeRight: true,
  landscapeLeft: true,
});
const expectedConfigPaths = Object.freeze({
  android: 'config/build-android-foundation.json',
  ios: 'config/build-ios-foundation.json',
  mac: 'config/build-mac-foundation.json',
  harmonyos: 'config/build-harmony-foundation.json',
  'harmonyos-offline': 'config/build-harmony-offline-foundation.json',
});
const buildToolPath = path.join(projectRoot, 'tools', 'build-native-target.js');
const { NATIVE_TARGETS } = require(path.join(
  projectRoot,
  'tools',
  'native-targets.js',
));

function validateEvidence(evidence) {
  if (!existsSync(buildToolPath)) {
    throw new Error('Native build evidence validator is not implemented');
  }
  return require(buildToolPath).validateEvidence(evidence);
}

function nativeBuildTool() {
  return require(buildToolPath);
}

function readConfig(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  assert.equal(existsSync(absolutePath), true, `Missing ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

test('native matrix preserves every package identity', () => {
  assert.deepEqual(Object.keys(NATIVE_TARGETS), [
    'android',
    'ios',
    'mac',
    'harmonyos',
    'harmonyos-offline',
  ]);
  assert.equal(NATIVE_TARGETS.android.packageName, 'cn.zhengzhengstudio.spacefight');
  assert.equal(NATIVE_TARGETS.harmonyos.packageName, 'cn.zhengzhengstudio.spacefight.hmos');
  assert.equal(
    NATIVE_TARGETS['harmonyos-offline'].packageName,
    'cn.zhengzhengstudio.spacefight.huawei',
  );
});

test('native matrix points each target at the required foundation config file', () => {
  for (const [targetId, target] of Object.entries(NATIVE_TARGETS)) {
    assert.equal(target.configPath, expectedConfigPaths[targetId]);
    assert.equal(target.outputName, `spacefight-${targetId}`);
  }
});

test('native build configs lock exports to the Combat scene and landscape identity', () => {
  const outputNames = new Set();

  for (const [targetId, target] of Object.entries(NATIVE_TARGETS)) {
    const config = readConfig(target.configPath);
    const packageOptions = config.packages?.[target.platform];

    assert.equal(config.platform, target.platform);
    const shouldDebug = ['ios', 'mac'].includes(targetId);
    assert.equal(config.debug, shouldDebug, `${targetId} build channel is incorrect`);
    assert.equal(config.buildPath, 'project://native-build');
    assert.equal(config.outputName, target.outputName);
    assert.equal(config.startScene, combatScene.uuid);
    assert.deepEqual(config.scenes, [combatScene]);
    assert.equal(packageOptions?.packageName, target.packageName);
    if (targetId === 'mac') {
      assert.equal('orientation' in packageOptions, false);
    } else {
      assert.deepEqual(packageOptions?.orientation, landscapeOrientation);
    }
    outputNames.add(config.outputName);
  }

  assert.equal(outputNames.size, Object.keys(NATIVE_TARGETS).length);
});

test('successful native evidence requires a generated project and package identity', () => {
  assert.throws(() => validateEvidence({
    target: 'android',
    packageName: 'cn.zhengzhengstudio.spacefight',
    creatorVersion: '3.8.8',
    commandExit: 0,
    generatedProject: false,
    files: [],
    verification: {},
  }), /generated project/i);
});

test('offline Harmony evidence rejects the online package name', () => {
  assert.throws(() => validateEvidence({
    target: 'harmonyos-offline',
    packageName: 'cn.zhengzhengstudio.spacefight.hmos',
    creatorVersion: '3.8.8',
    commandExit: 0,
    generatedProject: true,
    files: ['build-profile.json5'],
    verification: { exportPassed: true, packageIdentityPassed: true },
  }), /package/i);
});

test('Android runtime config receives explicit SDK, NDK and JDK paths', () => {
  const source = { packages: { android: { packageName: 'cn.zhengzhengstudio.spacefight' } } };
  const configured = nativeBuildTool().applyAndroidToolchain(source, {
    sdkPath: '/android/sdk',
    ndkPath: '/android/sdk/ndk/23.2.8568313',
    javaPath: '/launcherx/jdk-21/bin/java',
  });

  assert.equal(configured.packages.android.sdkPath, '/android/sdk');
  assert.equal(configured.packages.android.ndkPath, '/android/sdk/ndk/23.2.8568313');
  assert.equal(configured.packages.android.javaPath, '/launcherx/jdk-21/bin/java');
  assert.equal(configured.packages.android.javaHome, '/launcherx/jdk-21');
  assert.equal('sdkPath' in source.packages.android, false, 'canonical config stays immutable');
});

test('Android Gradle properties encode non-ASCII absolute project paths', () => {
  const source = [
    'RES_PATH=/Users/test/Desktop/开发者/TRAE/SpaceFight-Cocos/native-build/spacefight-android',
    'NATIVE_DIR=/Users/test/Desktop/开发者/TRAE/SpaceFight-Cocos/native/engine/android',
    'APPLICATION_ID=cn.zhengzhengstudio.spacefight',
  ].join('\n');
  const normalized = nativeBuildTool().normalizeAndroidGradleProperties(source);

  assert.match(normalized, /^RES_PATH=\/Users\/test\/Desktop\/\\u5F00\\u53D1\\u8005\/TRAE\/SpaceFight-Cocos\/native-build\/spacefight-android$/m);
  assert.match(normalized, /^NATIVE_DIR=\/Users\/test\/Desktop\/\\u5F00\\u53D1\\u8005\/TRAE\/SpaceFight-Cocos\/native\/engine\/android$/m);
  assert.match(normalized, /^APPLICATION_ID=cn\.zhengzhengstudio\.spacefight$/m);
  assert.doesNotMatch(normalized, /开发者/);
});

test('Android generated buildscript resolves through the configured mirrors first', () => {
  const source = 'buildscript {\n    repositories {\n        google()\n        mavenCentral()\n    }\n}';
  const normalized = nativeBuildTool().normalizeAndroidRepositories(source);
  assert.ok(normalized.indexOf('maven.aliyun.com/repository/google') < normalized.indexOf('google()'));
  assert.ok(normalized.indexOf('maven.aliyun.com/repository/public') < normalized.indexOf('mavenCentral()'));
});

test('Android native identity uses the project release version instead of Cocos defaults', () => {
  const source = [
    'defaultConfig {',
    '    versionCode 1',
    '    versionName "1.0"',
    '}',
  ].join('\n');
  const normalized = nativeBuildTool().normalizeAndroidGradleIdentity(source, {
    version: '0.10.2',
    build: 20,
  });

  assert.match(normalized, /^\s*versionCode 20$/m);
  assert.match(normalized, /^\s*versionName "0\.10\.2"$/m);
  assert.doesNotMatch(normalized, /versionName "1\.0"/);
});

test('Android app label is generated as SpaceFight', () => {
  assert.equal(
    nativeBuildTool().androidStringsXml('SpaceFight'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">SpaceFight</string>\n</resources>\n',
  );
});

test('compiled native artifact evidence records an immutable digest and release identity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'spacefight-native-evidence-'));
  const evidencePath = path.join(directory, 'android.json');
  const artifactPath = path.join(directory, 'SpaceFight.apk');
  writeFileSync(evidencePath, JSON.stringify({
    target: 'android',
    packageName: 'cn.zhengzhengstudio.spacefight',
    verification: { compilePassed: false },
  }));
  writeFileSync(artifactPath, 'verified-apk');

  try {
    const evidence = nativeBuildTool().recordCompiledArtifact(evidencePath, artifactPath, {
      version: '0.10.2',
      build: 20,
      signing: 'android-debug',
    });
    assert.equal(evidence.verification.compilePassed, true);
    assert.equal(evidence.artifact.version, '0.10.2');
    assert.equal(evidence.artifact.build, 20);
    assert.equal(evidence.artifact.size, 12);
    assert.match(evidence.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.artifact.signing, 'android-debug');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native runtime output rejects stale entry files and missing required ship prefabs', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'spacefight-native-runtime-'));
  const data = path.join(directory, 'data');
  const mainAssets = path.join(data, 'assets', 'main');
  const resourcesAssets = path.join(data, 'assets', 'resources');
  const src = path.join(data, 'src');
  const fs = require('node:fs');
  fs.mkdirSync(mainAssets, { recursive: true });
  fs.mkdirSync(resourcesAssets, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
  writeFileSync(path.join(data, 'main.js'), [
    'const importMapJson = jsb.fileUtils.getStringFromFile("src/import-map.live.json");',
    "System.import('./application.live.js')",
  ].join('\n'));
  writeFileSync(path.join(data, 'application.live.js'), "this.settingsPath = 'src/settings.live.json';");
  writeFileSync(path.join(src, 'import-map.live.json'), '{}');
  writeFileSync(path.join(src, 'settings.live.json'), JSON.stringify({
    assets: { bundleVers: { main: 'live', resources: 'ships' } },
  }));
  writeFileSync(path.join(mainAssets, 'index.live.js'), 'showPreflight loadInitialEnemyVisuals');
  writeFileSync(path.join(mainAssets, 'cc.config.live.json'), '{}');
  writeFileSync(path.join(resourcesAssets, 'index.ships.js'), '');
  writeFileSync(path.join(resourcesAssets, 'cc.config.ships.json'), JSON.stringify({
    paths: Object.fromEntries(['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss']
      .map((kind, index) => [index, [`models-low/ships/${kind}/${kind}`, 4, 1]])),
  }));

  try {
    assert.doesNotThrow(() => nativeBuildTool().validateNativeRuntimeOutput(directory));
    writeFileSync(path.join(mainAssets, 'index.stale.js'), 'stale');
    assert.throws(
      () => nativeBuildTool().validateNativeRuntimeOutput(directory),
      /stale native runtime file/i,
    );
    fs.rmSync(path.join(mainAssets, 'index.stale.js'));
    writeFileSync(path.join(resourcesAssets, 'cc.config.ships.json'), JSON.stringify({ paths: {} }));
    assert.throws(
      () => nativeBuildTool().validateNativeRuntimeOutput(directory),
      /required ship prefab/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Apple native plist uses the SpaceFight release identity', () => {
  const source = [
    '<key>CFBundleDisplayName</key>',
    '<string>${PRODUCT_NAME}</string>',
    '<key>CFBundleShortVersionString</key>',
    '<string>1.0.0</string>',
    '<key>CFBundleVersion</key>',
    '<string>1.0</string>',
  ].join('\n');
  const normalized = nativeBuildTool().normalizeAppleInfoPlist(source, {
    name: 'SpaceFight',
    version: '0.10.2',
    build: 20,
  });

  assert.match(normalized, /<key>CFBundleDisplayName<\/key>\s*<string>SpaceFight<\/string>/);
  assert.match(normalized, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.10\.2<\/string>/);
  assert.match(normalized, /<key>CFBundleVersion<\/key>\s*<string>20<\/string>/);
  assert.doesNotMatch(normalized, /<string>1\.0(?:\.0)?<\/string>/);
});

test('Harmony export evidence accepts the Cocos native resource project layout', () => {
  assert.equal(nativeBuildTool().generatedProjectPresent(NATIVE_TARGETS.harmonyos, [
    'cocos.compile.config.json',
    'data/main.js',
    'proj/cfg.cmake',
  ]), true);
});

test('Harmony identity uses the release package and removes network access offline', () => {
  const app = nativeBuildTool().normalizeHarmonyAppJson(JSON.stringify({
    app: {
      bundleName: 'example.game',
      versionCode: 1000000,
      versionName: '1.0.0',
    },
  }), 'cn.zhengzhengstudio.spacefight.huawei', {
    version: '0.10.2',
    build: 20,
  });
  const module = nativeBuildTool().normalizeHarmonyModuleJson(JSON.stringify({
    module: {
      requestPermissions: [
        { name: 'ohos.permission.INTERNET' },
        { name: 'ohos.permission.GET_NETWORK_INFO' },
        { name: 'ohos.permission.VIBRATE' },
      ],
    },
  }), true);

  assert.deepEqual(JSON.parse(app).app, {
    bundleName: 'cn.zhengzhengstudio.spacefight.huawei',
    versionCode: 20,
    versionName: '0.10.2',
  });
  assert.deepEqual(JSON.parse(module).module.requestPermissions, [
    { name: 'ohos.permission.VIBRATE' },
  ]);
});

test('Harmony Cocos adapter receives explicit native context types for modern ArkTS', () => {
  const source = [
    "import cocos from 'libcocos.so';",
    'const nativeContext = cocos.getContext(ContextType.WORKER_INIT);',
    'const renderContext = cocos.getContext(ContextType.NATIVE_RENDER_API);',
  ].join('\n');
  const normalized = nativeBuildTool().normalizeHarmonyArkTsContext(source);

  assert.match(normalized, /import cocos, \{ context \} from 'libcocos\.so';/);
  assert.match(normalized, /const nativeContext: context = cocos\.getContext/);
  assert.match(normalized, /const renderContext: context = cocos\.getContext/);
});
