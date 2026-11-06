import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = path.join(process.env.HOME, 'Downloads');
const publishedAt = new Date().toISOString();

const releases = {
  'battery-organizer-harmonyos': {
    version: '1.1.29',
    build: 1000129,
    title: '电池收纳器 HarmonyOS',
    bundleName: 'cn.zhengzhengstudio.batteryorganizer.hmos',
    variant: 'online',
    variantLabel: '联网版',
    appSource: 'BatteryOrganizer-HarmonyOS-v1.1.29-signed.app',
    hapSource: 'BatteryOrganizer-HarmonyOS-v1.1.29-signed.hap',
    prefix: 'battery-organizer-harmonyos',
    notes: '新增待收货、现役和退役生命周期；详情页支持多个用途、数量与备注，修改后立即刷新库存统计。'
  },
  'battery-organizer-offline-harmonyos': {
    version: '1.0.13',
    build: 1000013,
    title: '电池收纳器单机版 HarmonyOS',
    bundleName: 'cn.zhengzhengstudio.batteryorganizeronedevice.hmos',
    variant: 'offline',
    variantLabel: '单机版',
    appSource: 'BatteryOrganizer-Offline-HarmonyOS-v1.0.13-signed.app',
    hapSource: 'BatteryOrganizer-Offline-HarmonyOS-v1.0.13-signed.hap',
    prefix: 'battery-organizer-offline-harmonyos',
    notes: '单机库存新增待收货、现役和退役生命周期；详情页支持多个用途、数量与备注，数据继续只保存在当前设备。'
  }
};

const appDirectories = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps')
];

const manifestFiles = [
  path.join(root, 'website/api/apps/client-downloads.json'),
  path.join(root, 'website/api/apps/manifest.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps/manifest.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/boardgames/manifest.json')
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(sourceName, targetName) {
  const source = path.join(downloads, sourceName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing signed release: ${source}`);
  }
  return {
    source,
    targetName,
    size: fs.statSync(source).size,
    sha256: sha256(source)
  };
}

for (const release of Object.values(releases)) {
  release.app = artifact(release.appSource, `${release.prefix}-${release.version}.app`);
  release.hap = artifact(release.hapSource, `${release.prefix}-${release.version}.hap`);
  for (const directory of appDirectories) {
    fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(release.app.source, path.join(directory, release.app.targetName));
    fs.copyFileSync(release.app.source, path.join(directory, `${release.prefix}-latest.app`));
    fs.copyFileSync(release.hap.source, path.join(directory, release.hap.targetName));
    fs.copyFileSync(release.hap.source, path.join(directory, `${release.prefix}-latest.hap`));
  }
}

function updateEntry(entry, release) {
  const appURL = `/api/apps/${release.app.targetName}`;
  const hapURL = `/api/apps/${release.hap.targetName}`;
  const latestAppURL = `/api/apps/${release.prefix}-latest.app`;
  const latestHapURL = `/api/apps/${release.prefix}-latest.hap`;
  Object.assign(entry, {
    version: release.version,
    versionName: release.version,
    latestVersion: release.version,
    shortVersion: release.version,
    build: String(release.build),
    latestBuild: String(release.build),
    buildNumber: release.build,
    versionCode: release.build,
    latestVersionCode: release.build,
    fileName: release.app.targetName,
    file: release.app.targetName,
    filename: release.app.targetName,
    appFileName: release.app.targetName,
    downloadURL: appURL,
    downloadUrl: appURL,
    download_url: appURL,
    versionedUrl: appURL,
    versionedURL: appURL,
    url: latestAppURL,
    latestUrl: latestAppURL,
    latestURL: latestAppURL,
    size: release.app.size,
    fileSize: release.app.size,
    appSize: release.app.size,
    sha256: release.app.sha256,
    checksum: release.app.sha256,
    appSha256: release.app.sha256,
    hapFileName: release.hap.targetName,
    hapUrl: hapURL,
    hapSize: release.hap.size,
    hapSha256: release.hap.sha256,
    latestAppFileName: `${release.prefix}-latest.app`,
    latestHapFileName: `${release.prefix}-latest.hap`,
    latestHapUrl: latestHapURL,
    title: `${release.title} v${release.version} build ${release.build}`,
    notes: release.notes,
    updatedAt: publishedAt,
    bundleName: release.bundleName,
    bundleIdentifier: release.bundleName,
    variant: release.variant,
    variantLabel: release.variantLabel,
    signed: true,
    signing: 'huawei-release'
  });
  entry.links = [
    { name: 'HarmonyOS APP 上架包', url: appURL, latestUrl: latestAppURL,
      fileName: release.app.targetName, size: release.app.size, sha256: release.app.sha256 },
    { name: 'HarmonyOS HAP 包', url: hapURL, latestUrl: latestHapURL,
      fileName: release.hap.targetName, size: release.hap.size, sha256: release.hap.sha256 }
  ];
  entry.artifacts = [
    { kind: 'app', label: '应用市场 APP', fileName: release.app.targetName, url: appURL,
      downloadURL: appURL, latestUrl: latestAppURL, size: release.app.size, sha256: release.app.sha256 },
    { kind: 'hap', label: 'HAP', fileName: release.hap.targetName, url: hapURL,
      downloadURL: hapURL, latestUrl: latestHapURL, size: release.hap.size, sha256: release.hap.sha256 }
  ];
  entry.downloadOptions = [
    { label: 'APP 上架包', url: appURL, latestUrl: latestAppURL,
      fileName: release.app.targetName, size: release.app.size, sha256: release.app.sha256 },
    { label: 'HAP 包', url: hapURL, latestUrl: latestHapURL,
      fileName: release.hap.targetName, size: release.hap.size, sha256: release.hap.sha256 }
  ];
}

for (const manifestFile of manifestFiles) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  let updated = 0;
  for (const entry of manifest.apps ?? []) {
    const release = releases[entry.id];
    if (release) {
      updateEntry(entry, release);
      updated += 1;
    }
  }
  if (manifest.product === 'battery-organizer') {
    manifest.latestVersion = releases['battery-organizer-harmonyos'].version;
    manifest.latestBuild = String(releases['battery-organizer-harmonyos'].build);
  }
  manifest.updatedAt = publishedAt;
  manifest.generatedAt = publishedAt;
  const expectedEntries = manifestFile.includes('/boardgames/') ? 1 : 2;
  if (updated !== expectedEntries) {
    throw new Error(`Expected ${expectedEntries} battery entries in ${manifestFile}, found ${updated}`);
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

const changelogFile = path.join(root, 'website/api/data/changelogs.json');
const changelog = JSON.parse(fs.readFileSync(changelogFile, 'utf8'));
const changelogId = '2026-08-11-battery-organizer-harmonyos-scan-photo';
if (!changelog.some((item) => item.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-08-11',
    title: '电池收纳器 HarmonyOS 扫码与照片快速录入',
    content: '联网版更新至 1.1.28，新增商品码、电池二维码和系统相机快速录入，照片可随账号同步并在失败后重试；单机版更新至 1.0.12，提供相同的原生录入体验，照片和库存仍只保存在当前设备。两版均继续支持手机、平板和 2in1。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
}

console.log('Published Battery Organizer HarmonyOS online 1.1.29 and offline 1.0.13 locally.');
