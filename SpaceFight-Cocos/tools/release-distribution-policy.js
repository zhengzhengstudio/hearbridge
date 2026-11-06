'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SPACEFIGHT_PREFIX = 'spacefight-';
const METADATA_FILES = Object.freeze(['manifest.json', 'client-downloads.json']);
const PACKAGE_EXTENSIONS = new Set(['.apk', '.app', '.hap', '.ipa', '.dmg']);
const EXPECTED_BUNDLES = Object.freeze({
  'spacefight-android': 'cn.zhengzhengstudio.spacefight',
  'spacefight-ios': 'cn.zhengzhengstudio.spacefight',
  'spacefight-macos': 'cn.zhengzhengstudio.spacefight',
  'spacefight-harmonyos': 'cn.zhengzhengstudio.spacefight.hmos',
  'spacefight-harmonyos-offline': 'cn.zhengzhengstudio.spacefight.huawei',
  'spacefight-harmonyos-offline-app': 'cn.zhengzhengstudio.spacefight.huawei',
});
const RELEASE_FIELDS = Object.freeze([
  'id',
  'version',
  'latestVersion',
  'versionName',
  'build',
  'versionCode',
  'artifactType',
  'fileName',
  'url',
  'latestUrl',
  'versionedUrl',
  'downloadURL',
  'bundleIdentifier',
  'variant',
  'signed',
  'signing',
  'debug',
  'releaseChannel',
  'storeReady',
  'size',
  'fileSize',
  'sha256',
  'checksum',
]);
const URL_FIELDS = Object.freeze(['url', 'latestUrl', 'versionedUrl', 'downloadURL']);

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid release version: ${value || 'missing'}`);
  return {
    numbers: match[1].split('.').map((part) => Number.parseInt(part, 10)),
    prerelease: match[2] || '',
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const count = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

function isRemoteReleaseNewer(remoteVersion, remoteBuild, localVersion, localBuild) {
  const versionComparison = compareVersions(remoteVersion, localVersion);
  if (versionComparison !== 0) return versionComparison > 0;
  return Number(remoteBuild) > Number(localBuild);
}

function spaceFightEntries(document, label) {
  if (!document || !Array.isArray(document.apps)) throw new Error(`${label} has no apps array`);
  const entries = document.apps.filter((entry) => String(entry.id || '').startsWith(SPACEFIGHT_PREFIX));
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`${label} has duplicate SpaceFight id ${entry.id}`);
    ids.add(entry.id);
  }
  return entries;
}

function releaseView(entry) {
  return Object.fromEntries(RELEASE_FIELDS.map((field) => [field, entry[field] ?? null]));
}

function comparableEntries(entries) {
  return entries
    .map(releaseView)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function selectEntries(entries, options = {}) {
  if (!Array.isArray(options.entryIds) || options.entryIds.length === 0) return entries;
  const selectedIds = new Set(options.entryIds);
  const selected = entries.filter((entry) => selectedIds.has(entry.id));
  const foundIds = new Set(selected.map((entry) => entry.id));
  const missingIds = options.entryIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) throw new Error(`Missing targeted SpaceFight entries: ${missingIds.join(', ')}`);
  return selected;
}

function packageNames(entry) {
  const names = new Set();
  if (entry.fileName) names.add(path.posix.basename(String(entry.fileName)));
  for (const field of URL_FIELDS) {
    const raw = String(entry[field] || '');
    if (!raw) continue;
    const clean = decodeURIComponent(raw.split(/[?#]/)[0]);
    const name = path.posix.basename(clean);
    if (PACKAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) names.add(name);
  }
  return [...names];
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function validateEntry(entry, appRoot, options) {
  const expectedBundle = EXPECTED_BUNDLES[entry.id];
  if (!expectedBundle) throw new Error(`Unexpected SpaceFight release id: ${entry.id}`);
  if (entry.bundleIdentifier !== expectedBundle) {
    throw new Error(`${entry.id} bundle mismatch: expected ${expectedBundle}, got ${entry.bundleIdentifier || 'missing'}`);
  }
  parseVersion(entry.version);
  if (!Number.isInteger(entry.build) || entry.build < 1) throw new Error(`${entry.id} has invalid build`);
  const names = packageNames(entry);
  if (names.length === 0) throw new Error(`${entry.id} has no package reference`);
  for (const name of names) {
    if (!PACKAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      throw new Error(`${entry.id} has unsupported package ${name}`);
    }
    const packagePath = path.join(appRoot, name);
    if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) {
      throw new Error(`${entry.id} references missing package ${name} in ${appRoot}`);
    }
  }
  if (entry.id === 'spacefight-android' || entry.variant === 'offline') {
    if (entry.signed !== true || entry.debug === true) throw new Error(`${entry.id} must be a signed non-debug release`);
  }
  if (options.checksums && entry.fileName) {
    const artifact = path.join(appRoot, path.posix.basename(entry.fileName));
    const size = fs.statSync(artifact).size;
    if (Number(entry.size || entry.fileSize) !== size) throw new Error(`${entry.id} size metadata mismatch`);
    const expectedHash = String(entry.sha256 || entry.checksum || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(artifact) !== expectedHash) {
      throw new Error(`${entry.id} checksum metadata mismatch`);
    }
  }
}

function readMetadata(appRoot, fileName) {
  const file = path.join(appRoot, fileName);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateAppRoot(appRoot, options = {}) {
  const documents = Object.fromEntries(METADATA_FILES.map((name) => [name, readMetadata(appRoot, name)]));
  const manifestEntries = selectEntries(
    spaceFightEntries(documents['manifest.json'], `${appRoot}/manifest.json`),
    options,
  );
  const downloadEntries = selectEntries(
    spaceFightEntries(documents['client-downloads.json'], `${appRoot}/client-downloads.json`),
    options,
  );
  if (JSON.stringify(comparableEntries(manifestEntries)) !== JSON.stringify(comparableEntries(downloadEntries))) {
    throw new Error(`${appRoot} manifest.json and client-downloads.json disagree for SpaceFight`);
  }
  for (const entry of manifestEntries) validateEntry(entry, appRoot, options);
  return comparableEntries(manifestEntries);
}

function validateDistributionRoots(appRoots, options = {}) {
  if (!Array.isArray(appRoots) || appRoots.length < 2) throw new Error('At least two app roots are required');
  const reference = validateAppRoot(appRoots[0], options);
  for (const appRoot of appRoots.slice(1)) {
    const candidate = validateAppRoot(appRoot, options);
    if (JSON.stringify(candidate) !== JSON.stringify(reference)) {
      throw new Error(`SpaceFight release metadata differs between ${appRoots[0]} and ${appRoot}`);
    }
  }
  return { entries: reference, roots: [...appRoots] };
}

function validateOfflineHarmonyModule(source) {
  const moduleJson = JSON.parse(source);
  const permissions = (moduleJson.module?.requestPermissions || []).map((permission) => permission.name);
  for (const forbidden of ['ohos.permission.INTERNET', 'ohos.permission.GET_NETWORK_INFO']) {
    if (permissions.includes(forbidden)) throw new Error(`HarmonyOS offline target requests ${forbidden}`);
  }
  return permissions;
}

module.exports = {
  EXPECTED_BUNDLES,
  compareVersions,
  isRemoteReleaseNewer,
  packageNames,
  validateAppRoot,
  validateDistributionRoots,
  validateOfflineHarmonyModule,
};
