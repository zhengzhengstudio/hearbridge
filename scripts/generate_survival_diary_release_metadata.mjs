#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'release/survival-diary/0.4.7/release.json'), 'utf8'));
const privateApps = path.join(root, 'website/api/apps');
const publicApps = path.join(root, 'website/zhengzhengstudio.cn/api/apps');
const documents = [
  path.join(privateApps, 'manifest.json'), path.join(privateApps, 'client-downloads.json'),
  path.join(publicApps, 'manifest.json'), path.join(publicApps, 'client-downloads.json'),
];
const write = process.argv.includes('--write');

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const icon = 'https://survival-diary.zhengzhengstudio.cn/assets/icons/icon-192.png';

function entry(platform) {
  const version = platform.version ?? descriptor.version;
  const build = platform.build ?? descriptor.build;
  const result = {
    kind: platform.platform === 'web' ? 'web' : 'package',
    artifactType: platform.platform === 'web' ? 'web' : 'package',
    product: descriptor.product,
    id: platform.id,
    name: platform.name,
    platform: platform.platform,
    platformLabel: platform.platformLabel,
    variant: platform.variant,
    variantLabel: platform.variantLabel,
    category: '游戏',
    version,
    latestVersion: version,
    versionName: version,
    build,
    versionCode: platform.platformVersionCode ?? build,
    available: platform.available,
    signed: platform.signed,
    signing: platform.signing ?? 'unavailable',
    storeReady: platform.storeReady,
    bundleIdentifier: platform.bundleIdentifier,
    minimumSystem: platform.minimumSystem,
    minSystem: platform.minimumSystem,
    pageURL: 'https://survival-diary.zhengzhengstudio.cn/',
    icon,
    description: platform.description ?? descriptor.description,
    notes: platform.notes ?? descriptor.notes,
    remarks: platform.remarks,
    blockedReason: platform.blockedReason ?? '',
    title: `${platform.name} v${version} build ${build}`,
    updatedAt: descriptor.updatedAt,
  };
  if (platform.platform === 'web') {
    result.url = platform.url;
    result.versionedUrl = platform.url;
    result.downloadURL = '';
    result.size = 0; result.fileSize = 0; result.sha256 = ''; result.checksum = '';
    return result;
  }
  if (!platform.available) {
    result.fileName = '';
    result.url = '';
    result.latestUrl = '';
    result.versionedUrl = '';
    result.downloadURL = '';
    result.size = 0; result.fileSize = 0; result.sha256 = ''; result.checksum = '';
    return result;
  }
  const file = path.join(privateApps, platform.artifact);
  if (!fs.existsSync(file)) throw new Error(`available artifact missing: ${file}`);
  const size = fs.statSync(file).size;
  const checksum = hash(file);
  result.fileName = platform.artifact;
  result.url = `/api/apps/download/${platform.latestArtifact}`;
  result.latestUrl = `/api/apps/download/${platform.latestArtifact}`;
  result.versionedUrl = `/api/apps/download/${platform.artifact}`;
  result.downloadURL = `/api/apps/download/${platform.artifact}`;
  result.size = size; result.fileSize = size; result.sha256 = checksum; result.checksum = checksum;
  if (platform.appArtifact && platform.appLatestArtifact) {
    const appFile = path.join(privateApps, platform.appArtifact);
    if (!fs.existsSync(appFile)) throw new Error(`available APP artifact missing: ${appFile}`);
    const appSize = fs.statSync(appFile).size;
    const appChecksum = hash(appFile);
    result.appFileName = platform.appArtifact;
    result.appUrl = `/api/apps/download/${platform.appLatestArtifact}`;
    result.appLatestUrl = `/api/apps/download/${platform.appLatestArtifact}`;
    result.appVersionedUrl = `/api/apps/download/${platform.appArtifact}`;
    result.appDownloadURL = `/api/apps/download/${platform.appArtifact}`;
    result.appSize = appSize;
    result.appSha256 = appChecksum;
  }
  return result;
}

const generated = descriptor.platforms.map(entry);
for (const documentFile of documents) {
  const document = JSON.parse(fs.readFileSync(documentFile, 'utf8'));
  const old = document.apps.filter((item) => item.product === descriptor.product || item.id.startsWith('survival-diary-'));
  const first = old.length ? document.apps.indexOf(old[0]) : document.apps.length;
  document.apps = document.apps.filter((item) => item.product !== descriptor.product && !item.id.startsWith('survival-diary-'));
  document.apps.splice(first, 0, ...generated);
  document.updatedAt = descriptor.updatedAt;
  document.generatedAt = descriptor.updatedAt;
  if (write) fs.writeFileSync(documentFile, `${JSON.stringify(document, null, 2)}\n`);
}

if (write) {
  for (const platform of descriptor.platforms.filter((item) => item.available && item.artifact)) {
    const pairs = [[platform.artifact, platform.latestArtifact]];
    if (platform.appArtifact && platform.appLatestArtifact) pairs.push([platform.appArtifact, platform.appLatestArtifact]);
    for (const [versioned, latest] of pairs) {
      const source = path.join(privateApps, versioned);
      for (const name of [versioned, latest]) {
        const target = path.join(publicApps, name);
        fs.copyFileSync(source, target);
        fs.writeFileSync(`${path.join(privateApps, name)}.sha256`, `${hash(source)}  ${name}\n`);
        fs.writeFileSync(`${target}.sha256`, `${hash(source)}  ${name}\n`);
        if (name === latest) fs.copyFileSync(source, path.join(privateApps, name));
      }
    }
  }
}
console.log(JSON.stringify({ write, entries: generated.map(({ id, available, signed, storeReady }) => ({ id, available, signed, storeReady })) }, null, 2));
