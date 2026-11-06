'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const checkerPath = path.join(
  repositoryRoot,
  'SpaceFight-Cocos',
  'tools',
  'check-toolchain.js',
);
const releaseMetadata = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'SpaceFight-Cocos', 'package.json'),
  'utf8',
));

function runChecker(environment = process.env) {
  const result = spawnSync(process.execPath, [checkerPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function writeFakeJava(javaPath, version) {
  mkdirSync(path.dirname(javaPath), { recursive: true });
  writeFileSync(
    javaPath,
    `#!/bin/sh\necho 'openjdk version "${version}"' >&2\n`,
  );
  chmodSync(javaPath, 0o755);
}

test('reports the required Cocos 3.8.8 cross-platform toolchain', () => {
  const report = runChecker();
  assert.equal(report.creatorVersion, '3.8.8');
  assert.equal(report.releaseVersion, releaseMetadata.version);
  assert.equal(report.releaseBuild, releaseMetadata.build);
  assert.equal(report.deveco.available, true);
  assert.equal(report.jdk21.available, true);
  assert.match(report.jdk21.version, /^21(?:\.|$)/);
  assert.equal(path.isAbsolute(report.jdk21.path), true);
  assert.equal(report.xcode.available, true);
  assert.equal(report.harmonySignTool.available, true);
  assert.deepEqual(report.supportedBuildTargets, [
    'web-mobile',
    'web-desktop',
    'android',
    'ios',
    'mac',
    'harmonyos-next',
  ]);
  assert.deepEqual(report.nativeTargets, {
    android: {
      buildReady: true,
      packageName: 'cn.zhengzhengstudio.spacefight',
      ready: true,
      releaseReady: false,
      signingReady: false,
    },
    ios: {
      buildReady: true,
      packageName: 'cn.zhengzhengstudio.spacefight',
      ready: true,
      releaseReady: false,
      signingReady: false,
    },
    mac: {
      buildReady: true,
      packageName: 'cn.zhengzhengstudio.spacefight',
      ready: true,
      releaseReady: false,
      signingReady: false,
    },
    harmonyos: {
      buildReady: true,
      packageName: 'cn.zhengzhengstudio.spacefight.hmos',
      ready: true,
      releaseReady: false,
      signingReady: false,
    },
    harmonyosOffline: {
      buildReady: true,
      packageName: 'cn.zhengzhengstudio.spacefight.huawei',
      ready: true,
      releaseReady: true,
      signingReady: true,
    },
  });
});

test('separates Harmony build readiness from signing material presence', (context) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'spacefight-harmony-readiness-'));
  const offlineSigningRoot = path.join(temporaryRoot, 'offline-signing');
  const missingDevEcoPath = path.join(temporaryRoot, 'missing-deveco.app');
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  mkdirSync(offlineSigningRoot, { recursive: true });
  for (const fileName of [
    'signing.env',
    'keystore.p12',
    'app-release.cer',
    'spacefight-offline-release.p7b',
  ]) {
    writeFileSync(path.join(offlineSigningRoot, fileName), 'placeholder');
  }

  const report = runChecker({
    ...process.env,
    SPACEFIGHT_DEV_ECO_PATH: missingDevEcoPath,
    SPACEFIGHT_HARMONY_OFFLINE_SIGNING_ROOT: offlineSigningRoot,
  });

  assert.deepEqual(report.nativeTargets.harmonyos, {
    buildReady: false,
    packageName: 'cn.zhengzhengstudio.spacefight.hmos',
    ready: false,
    releaseReady: false,
    signingReady: false,
  });
  assert.deepEqual(report.nativeTargets.harmonyosOffline, {
    buildReady: false,
    packageName: 'cn.zhengzhengstudio.spacefight.huawei',
    ready: false,
    releaseReady: false,
    signingReady: true,
  });
});

test('online Harmony signing requires a .p7b profile in addition to env, p12, and cer', (context) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'spacefight-harmony-online-signing-'));
  const onlineSigningRoot = path.join(temporaryRoot, 'online-signing');
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  mkdirSync(onlineSigningRoot, { recursive: true });
  for (const fileName of [
    'signing.env',
    'keystore.p12',
    'app-release.cer',
  ]) {
    writeFileSync(path.join(onlineSigningRoot, fileName), 'placeholder');
  }

  const withoutProfile = runChecker({
    ...process.env,
    SPACEFIGHT_HARMONY_ONLINE_SIGNING_ROOT: onlineSigningRoot,
  });
  assert.deepEqual(withoutProfile.nativeTargets.harmonyos, {
    buildReady: true,
    packageName: 'cn.zhengzhengstudio.spacefight.hmos',
    ready: true,
    releaseReady: false,
    signingReady: false,
  });

  writeFileSync(path.join(onlineSigningRoot, 'spacefight-online-release.p7b'), 'placeholder');

  const withProfile = runChecker({
    ...process.env,
    SPACEFIGHT_HARMONY_ONLINE_SIGNING_ROOT: onlineSigningRoot,
  });
  assert.deepEqual(withProfile.nativeTargets.harmonyos, {
    buildReady: true,
    packageName: 'cn.zhengzhengstudio.spacefight.hmos',
    ready: true,
    releaseReady: true,
    signingReady: true,
  });
});

test('pins release version and build in both Cocos metadata files', () => {
  const packageMetadata = JSON.parse(readFileSync(
    path.join(repositoryRoot, 'SpaceFight-Cocos', 'package.json'),
    'utf8',
  ));
  const projectMetadata = JSON.parse(readFileSync(
    path.join(
      repositoryRoot,
      'SpaceFight-Cocos',
      'settings',
      'v2',
      'packages',
      'project.json',
    ),
    'utf8',
  ));

  assert.match(packageMetadata.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(packageMetadata.build) && packageMetadata.build > 0);
  assert.equal(projectMetadata.project.version, packageMetadata.version);
  assert.equal(projectMetadata.project.build, packageMetadata.build);
});

test('startup excludes Bullet WebAssembly and uses the stable Cocos forward pipeline', () => {
  const engineSettings = JSON.parse(readFileSync(
    path.join(
      repositoryRoot,
      'SpaceFight-Cocos',
      'settings',
      'v2',
      'packages',
      'engine.json',
    ),
    'utf8',
  ));
  const modules = engineSettings.modules?.configs?.defaultConfig?.includeModules || [];

  assert.ok(modules.includes('physics-builtin'));
  assert.ok(modules.includes('3d'));
  assert.ok(modules.includes('ui'));
  assert.ok(modules.includes('particle'));
  assert.equal(modules.includes('physics-ammo'), false);
  assert.equal(modules.includes('webview'), false);
  assert.equal(modules.includes('video'), false);
  assert.equal(modules.includes('physics-2d-box2d'), false);
  assert.ok(modules.includes('legacy-pipeline'));
  assert.equal(modules.includes('custom-pipeline'), false);
  assert.equal(
    engineSettings.modules.configs.defaultConfig.cache['render-pipeline']?._option,
    'legacy-pipeline',
  );
});

test('mobile native scene has a lightweight pre-script cold start', () => {
  const scene = JSON.parse(readFileSync(
    path.join(repositoryRoot, 'SpaceFight-Cocos', 'assets', 'scenes', 'Combat.scene'),
    'utf8',
  ));
  const directionalLight = scene.find((entry) => entry.__type__ === 'cc.DirectionalLight');
  const shadows = scene.find((entry) => entry.__type__ === 'cc.ShadowsInfo');
  const fog = scene.find((entry) => entry.__type__ === 'cc.FogInfo');

  assert.equal(directionalLight?._shadowEnabled, false);
  assert.equal(shadows?._enabled, false);
  assert.ok(shadows?._size?.x <= 1024);
  assert.ok(shadows?._size?.y <= 1024);
  assert.equal(fog?._enabled, false);

  for (const configName of [
    'build-android-foundation.json',
    'build-harmony-foundation.json',
    'build-harmony-offline-foundation.json',
  ]) {
    const buildConfig = JSON.parse(readFileSync(
      path.join(repositoryRoot, 'SpaceFight-Cocos', 'config', configName),
      'utf8',
    ));
    assert.equal(buildConfig.useSplashScreen, false, configName);
  }
});

test('prefers an architecture-neutral LauncherX JDK 21 discovery', (context) => {
  const temporaryHome = mkdtempSync(path.join(tmpdir(), 'spacefight-jdk-home-'));
  context.after(() => rmSync(temporaryHome, { recursive: true, force: true }));

  const launcherJavaPath = path.join(
    temporaryHome,
    'Library',
    'Application Support',
    'LauncherX',
    'LauncherX',
    'DownloadedJRE',
    'ZULU_JDK_21_OSX_ARM64',
    'zulu-21.jdk',
    'Contents',
    'Home',
    'bin',
    'java',
  );
  const pathJavaPath = path.join(temporaryHome, 'path-bin', 'java');
  writeFakeJava(launcherJavaPath, '21.0.9');
  writeFakeJava(pathJavaPath, '21.0.10');

  const report = runChecker({
    ...process.env,
    HOME: temporaryHome,
    PATH: path.dirname(pathJavaPath),
  });

  assert.equal(report.jdk21.available, true);
  assert.equal(report.jdk21.path, launcherJavaPath);
  assert.equal(report.jdk21.version, '21.0.9');
});

test('falls back to a Java 21 executable on PATH', (context) => {
  const temporaryHome = mkdtempSync(path.join(tmpdir(), 'spacefight-jdk-path-'));
  context.after(() => rmSync(temporaryHome, { recursive: true, force: true }));

  const pathJavaPath = path.join(temporaryHome, 'bin', 'java');
  writeFakeJava(pathJavaPath, '21.0.10');

  const report = runChecker({
    ...process.env,
    HOME: temporaryHome,
    PATH: path.dirname(pathJavaPath),
  });

  assert.equal(report.jdk21.available, true);
  assert.equal(report.jdk21.path, pathJavaPath);
  assert.equal(report.jdk21.version, '21.0.10');
});
