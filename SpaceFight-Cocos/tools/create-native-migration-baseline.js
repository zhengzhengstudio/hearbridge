const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { basename, dirname, join, relative, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_ARCHIVE_DIRECTORY = '/Users/ljg/Downloads';

const SOURCE_PATHS = [
  'SpaceFight-Cocos',
  'ZhengZhengStudioApp/ZhengZhengStudioAndroid',
  'apps/SpaceFight-iOS',
  'apps/SpaceFightMac',
  'apps/SpaceFightShared',
  'HarmonyOS-App/SpaceFightHarmony',
  'HarmonyOS-App/SpaceFightHarmonyOffline',
  'apps/build_spacefight_apps.sh',
];

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function artifact(platform, filePath, root) {
  const stat = statSync(filePath);
  return {
    platform,
    path: relative(root, filePath),
    size: stat.size,
    sha256: sha256(filePath),
  };
}

function firstExisting(root, candidates) {
  const filePath = candidates.map(candidate => join(root, candidate)).find(existsSync);
  if (!filePath) {
    throw new Error(`Missing published release artifact: ${candidates.join(' or ')}`);
  }
  return filePath;
}

function hasMatchingFile(directory, extension) {
  return existsSync(directory) && readdirSync(directory).some(file => file.endsWith(extension));
}

function signingMaterial(root, identifier) {
  const directory = join(root, 'website/api/data/harmony-signing', identifier);
  const keystore = existsSync(join(directory, 'keystore.p12'));
  const certificate = hasMatchingFile(directory, '.cer');
  const profile = hasMatchingFile(directory, '.p7b');
  return {
    keystore,
    certificate,
    profile,
    complete: keystore && certificate && profile,
  };
}

function archivePathFor(now, archiveDirectory = DEFAULT_ARCHIVE_DIRECTORY) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return join(archiveDirectory, `SpaceFight-native-foundation-before-${timestamp}.tar.gz`);
}

function assertSourceInputs(root) {
  const missing = SOURCE_PATHS.filter(candidate => !existsSync(join(root, candidate)));
  if (missing.length > 0) {
    throw new Error(`Missing declared source input: ${missing.join(', ')}`);
  }
}

function createArchive(root, now, artifactPaths, { archiveDirectory, archivePath } = {}) {
  assertSourceInputs(root);
  const destination = archivePath
    ? resolve(archivePath)
    : archivePathFor(now, archiveDirectory || DEFAULT_ARCHIVE_DIRECTORY);
  mkdirSync(dirname(destination), { recursive: true });

  const includedPaths = [...SOURCE_PATHS, ...artifactPaths];
  const exclusions = [
    '--exclude=.git',
    '--exclude=build',
    '--exclude=library',
    '--exclude=temp',
    '--exclude=.preview',
    '--exclude=node_modules',
    '--exclude=website/api/data/harmony-signing',
    '--exclude=signing.env',
    '--exclude=*.p12',
    '--exclude=*.cer',
    '--exclude=*.p7b',
  ];
  const result = spawnSync('tar', ['-czf', destination, ...exclusions, '-C', root, ...includedPaths], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Could not create native migration archive: ${result.stderr || result.error?.message || 'tar failed'}`);
  }

  return {
    path: destination,
    sourceCount: SOURCE_PATHS.length,
    artifactCount: artifactPaths.length,
  };
}

function createBaseline({ root, outputPath, now, archiveDirectory, archivePath }) {
  const resolvedRoot = resolve(root);
  assertSourceInputs(resolvedRoot);
  const identity = JSON.parse(readFileSync(join(resolvedRoot, 'SpaceFight-Cocos/package.json'), 'utf8'));
  const version = identity.version;
  const artifactDefinitions = [
    ['android', [`website/api/apps/SpaceFight-Android-v${version}.apk`]],
    ['ios', [`website/api/apps/SpaceFight-iOS-v${version}.ipa`]],
    ['macos', [`website/api/apps/SpaceFight-macOS-v${version}.dmg`]],
    ['harmonyos', [
      `website/api/apps/SpaceFight-HarmonyOS-v${version}.hap`,
      `website/api/apps/SpaceFight-HarmonyOS-v${version}-unsigned.hap`,
    ]],
    ['harmonyos-offline-hap', [
      `website/api/apps/SpaceFight-HarmonyOS-Offline-v${version}.hap`,
      `website/api/apps/SpaceFight-HarmonyOS-Offline-v${version}-unsigned.hap`,
    ]],
    ['harmonyos-offline-app', [`website/api/apps/SpaceFight-HarmonyOS-Offline-v${version}.app`]],
  ];
  const artifactFiles = artifactDefinitions.map(([platform, candidates]) => [
    platform,
    firstExisting(resolvedRoot, candidates),
  ]);
  const artifactPaths = artifactFiles.map(([, filePath]) => relative(resolvedRoot, filePath));
  const manifest = {
    createdAt: now.toISOString(),
    identity: { version: identity.version, build: identity.build },
    artifacts: artifactFiles.map(([platform, filePath]) => artifact(platform, filePath, resolvedRoot)),
    signingMaterial: {
      harmonyos: signingMaterial(resolvedRoot, 'cn.zhengzhengstudio.spacefight.hmos'),
      harmonyosOffline: signingMaterial(resolvedRoot, 'cn.zhengzhengstudio.spacefight.huawei'),
    },
    archive: createArchive(resolvedRoot, now, artifactPaths, { archiveDirectory, archivePath }),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const root = resolve(__dirname, '../..');
  const outputPath = join(root, 'docs/spacefight/baselines/2026-08-03/native-foundation.json');
  const manifest = createBaseline({ root, outputPath, now: new Date() });
  console.log(`Wrote ${relative(root, outputPath)} with ${manifest.artifacts.length} artifacts.`);
  console.log(`Created ${basename(manifest.archive.path)}.`);
}

module.exports = { artifact, createBaseline, sha256 };
