'use strict';

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { NATIVE_TARGETS } = require('./native-targets');

const creatorVersion = '3.8.8';
const creatorInfoPath = `/Applications/Cocos/Creator/${creatorVersion}/CocosCreator.app/Contents/Info.plist`;
const defaultDevEcoPath = '/Applications/DevEco-Studio.app';
const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const supportedBuildTargets = [
  'web-mobile',
  'web-desktop',
  'android',
  'ios',
  'mac',
  'harmonyos-next',
];

function commandOutput(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { encoding: 'utf8' });
  return {
    available: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function findJavaExecutables(directory, depth = 6) {
  if (depth < 0 || !existsSync(directory)) {
    return [];
  }

  const candidates = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...findJavaExecutables(entryPath, depth - 1));
    } else if (entry.isFile() && entry.name === 'java' && path.basename(directory) === 'bin') {
      candidates.push(entryPath);
    }
  }
  return candidates;
}

function launcherXJavaCandidates() {
  if (!process.env.HOME) {
    return [];
  }

  const downloadedJrePath = path.join(
    process.env.HOME,
    'Library',
    'Application Support',
    'LauncherX',
    'LauncherX',
    'DownloadedJRE',
  );
  if (!existsSync(downloadedJrePath)) {
    return [];
  }

  return readdirSync(downloadedJrePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /jdk[_-]?21/i.test(entry.name))
    .flatMap((entry) => findJavaExecutables(path.join(downloadedJrePath, entry.name)));
}

function javaHomeCandidate() {
  const result = commandOutput('/usr/libexec/java_home', ['-v', '21']);
  if (!result.available || !result.output) {
    return [];
  }
  return [path.join(result.output.split('\n')[0], 'bin', 'java')];
}

function pathJavaCandidates() {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'java'))
    .filter(existsSync);
}

function installedCreatorVersion() {
  if (!existsSync(creatorInfoPath)) {
    return null;
  }

  const result = commandOutput('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    creatorInfoPath,
  ]);

  return result.available && result.output === creatorVersion ? creatorVersion : null;
}

function installedJdk() {
  const candidates = [
    ...launcherXJavaCandidates(),
    ...pathJavaCandidates(),
    ...javaHomeCandidate(),
  ];

  for (const javaPath of candidates) {
    const result = commandOutput(javaPath, ['-version']);
    const match = result.output.match(/(?:openjdk|java) version \"([^\"]+)\"/i);
    if (result.available && match && /^21(?:\.|$)/.test(match[1])) {
      return { path: javaPath, version: match[1] };
    }
  }

  return null;
}

function installedXcodeVersion() {
  const result = commandOutput('xcodebuild', ['-version']);
  const match = result.output.match(/^Xcode\s+(.+)$/m);
  return result.available && match ? match[1] : null;
}

function releaseMetadata() {
  const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const projectMetadata = JSON.parse(readFileSync(
    path.join(projectRoot, 'settings', 'v2', 'packages', 'project.json'),
    'utf8',
  )).project;

  return {
    version: packageMetadata.version === projectMetadata.version
      ? packageMetadata.version
      : null,
    build: packageMetadata.build === projectMetadata.build
      ? packageMetadata.build
      : null,
  };
}

function hasRequiredFiles(rootPath, fileNames) {
  return fileNames.every((fileName) => existsSync(path.join(rootPath, fileName)));
}

function hasProfileFile(rootPath) {
  if (!existsSync(rootPath)) {
    return false;
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .some((entry) => entry.isFile() && /\.p7b$/i.test(entry.name));
}

function resolveDevEcoPath() {
  return process.env.SPACEFIGHT_DEV_ECO_PATH || defaultDevEcoPath;
}

function resolveHarmonySignToolPath(devecoPath) {
  return process.env.SPACEFIGHT_HARMONY_SIGN_TOOL_PATH || path.join(
    devecoPath,
    'Contents',
    'sdk',
    'default',
    'openharmony',
    'toolchains',
    'lib',
    'hap-sign-tool.jar',
  );
}

function defaultHarmonySigningRoot(packageName) {
  return path.join(
    repositoryRoot,
    'website',
    'api',
    'data',
    'harmony-signing',
    packageName,
  );
}

function onlineSigningMaterialPresent() {
  const onlineSigningRoot = process.env.SPACEFIGHT_HARMONY_ONLINE_SIGNING_ROOT
    || defaultHarmonySigningRoot('cn.zhengzhengstudio.spacefight.hmos');

  return hasRequiredFiles(onlineSigningRoot, [
    'signing.env',
    'keystore.p12',
    'app-release.cer',
  ]) && hasProfileFile(onlineSigningRoot);
}

function offlineSigningMaterialPresent() {
  const offlineSigningRoot = process.env.SPACEFIGHT_HARMONY_OFFLINE_SIGNING_ROOT
    || defaultHarmonySigningRoot('cn.zhengzhengstudio.spacefight.huawei');

  return hasRequiredFiles(offlineSigningRoot, [
    'signing.env',
    'keystore.p12',
    'app-release.cer',
    'spacefight-offline-release.p7b',
  ]);
}

const jdk21 = installedJdk();
const xcodeVersion = installedXcodeVersion();
const release = releaseMetadata();
const devecoPath = resolveDevEcoPath();
const harmonySignToolPath = resolveHarmonySignToolPath(devecoPath);
const devecoReady = existsSync(devecoPath);
const onlineHarmonySigningReady = onlineSigningMaterialPresent();
const offlineHarmonySigningReady = offlineSigningMaterialPresent();

function nativeTargetStatus({ buildReady, signingReady, packageName }) {
  return {
    buildReady,
    signingReady,
    releaseReady: buildReady && signingReady,
    ready: buildReady,
    packageName,
  };
}

process.stdout.write(`${JSON.stringify({
  creatorVersion: installedCreatorVersion(),
  releaseVersion: release.version,
  releaseBuild: release.build,
  deveco: {
    available: devecoReady,
    path: devecoPath,
  },
  jdk21: {
    available: jdk21 !== null,
    path: jdk21?.path || null,
    version: jdk21?.version || null,
  },
  xcode: {
    available: xcodeVersion !== null,
    version: xcodeVersion,
  },
  harmonySignTool: {
    available: existsSync(harmonySignToolPath),
    path: harmonySignToolPath,
  },
  nativeTargets: {
    android: nativeTargetStatus({
      buildReady: jdk21 !== null,
      signingReady: false,
      packageName: NATIVE_TARGETS.android.packageName,
    }),
    ios: nativeTargetStatus({
      buildReady: xcodeVersion !== null,
      signingReady: false,
      packageName: NATIVE_TARGETS.ios.packageName,
    }),
    mac: nativeTargetStatus({
      buildReady: xcodeVersion !== null,
      signingReady: false,
      packageName: NATIVE_TARGETS.mac.packageName,
    }),
    harmonyos: nativeTargetStatus({
      buildReady: devecoReady,
      signingReady: onlineHarmonySigningReady,
      packageName: NATIVE_TARGETS.harmonyos.packageName,
    }),
    harmonyosOffline: nativeTargetStatus({
      buildReady: devecoReady,
      signingReady: offlineHarmonySigningReady,
      packageName: NATIVE_TARGETS['harmonyos-offline'].packageName,
    }),
  },
  supportedBuildTargets,
})}\n`);
