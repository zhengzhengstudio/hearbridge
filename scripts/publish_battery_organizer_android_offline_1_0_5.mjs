// 发布安卓单机版 1.0.5：修复华为审核驳回的两个问题（扫码失败、未提示隐私政策）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedAt = new Date().toISOString();

const release = {
  id: 'battery-organizer-offline-android',
  version: '1.0.5',
  build: 6,
  title: '电池收纳器单机版 Android',
  packageName: 'cn.zhengzhengstudio.batteryorganizer.offline',
  variant: 'offline',
  variantLabel: '单机版',
  source: 'BatteryOrganizerAndroid/app/build/outputs/apk/offline/release/app-offline-release.apk',
  prefix: 'battery-organizer-offline-android',
  minimumSystem: 'Android 7.0',
  notes: [
    '修复扫码失败：原扫码依赖 Google Play 服务，在没有 GMS 的设备（如 HarmonyOS 手机）上必然失败。现在改为应用内自研扫码（CameraX + ZXing），不需要任何 Google 服务。',
    '新增相机权限申请：首次扫码时按系统规范弹窗申请，拒绝后给出明确提示。',
    '新增首次启动隐私政策弹窗：启动时会提示阅读《隐私政策》，可直接在弹窗内打开完整政策，同意后才继续使用。',
    '更新渠道按安装来源区分：从应用市场安装的只在应用市场内更新，从官网安装的才引导到官网下载。',
    '设置页「软件更新」显示当前安装来源，更新弹窗按来源给出对应的更新入口。'
  ]
};

const appDirectories = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps')
];

const manifestFiles = [
  { file: path.join(root, 'website/api/apps/client-downloads.json'), required: true },
  { file: path.join(root, 'website/api/apps/manifest.json'), required: true },
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'), required: true },
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/apps/manifest.json'), required: true },
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'), required: false }
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const apkSource = path.join(root, release.source);
if (!fs.existsSync(apkSource)) {
  throw new Error(`缺少签名 APK: ${apkSource}`);
}
release.apk = {
  source: apkSource,
  targetName: `${release.prefix}-${release.version}.apk`,
  size: fs.statSync(apkSource).size,
  sha256: sha256(apkSource)
};

for (const directory of appDirectories) {
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(release.apk.source, path.join(directory, release.apk.targetName));
  fs.copyFileSync(release.apk.source, path.join(directory, `${release.prefix}-latest.apk`));
}

function updateEntry(entry) {
  const apkURL = `/api/apps/${release.apk.targetName}`;
  const latestURL = `/api/apps/${release.prefix}-latest.apk`;
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
    fileName: release.apk.targetName,
    file: release.apk.targetName,
    filename: release.apk.targetName,
    apkFileName: release.apk.targetName,
    downloadURL: apkURL,
    downloadUrl: apkURL,
    download_url: apkURL,
    url: latestURL,
    latestUrl: latestURL,
    latestURL: latestURL,
    size: release.apk.size,
    fileSize: release.apk.size,
    apkSize: release.apk.size,
    sha256: release.apk.sha256,
    checksum: release.apk.sha256,
    apkSha256: release.apk.sha256,
    latestApkFileName: `${release.prefix}-latest.apk`,
    title: `${release.title} v${release.version} build ${release.build}`,
    notes: release.notes,
    updatedAt: publishedAt,
    packageName: release.packageName,
    applicationId: release.packageName,
    bundleIdentifier: release.packageName,
    minimumSystem: release.minimumSystem,
    platform: 'android',
    variant: release.variant,
    variantLabel: release.variantLabel,
    signed: true
  });
  entry.links = [
    { name: 'Android APK', url: apkURL, latestUrl: latestURL,
      fileName: release.apk.targetName, size: release.apk.size, sha256: release.apk.sha256 }
  ];
  entry.artifacts = [
    { kind: 'apk', label: 'Android APK', fileName: release.apk.targetName, url: apkURL,
      downloadURL: apkURL, latestUrl: latestURL, size: release.apk.size, sha256: release.apk.sha256 }
  ];
  entry.downloadOptions = [
    { label: 'Android APK', url: apkURL, latestUrl: latestURL,
      fileName: release.apk.targetName, size: release.apk.size, sha256: release.apk.sha256 }
  ];
}

let created = false;
for (const item of manifestFiles) {
  const manifest = JSON.parse(fs.readFileSync(item.file, 'utf8'));
  let updated = 0;
  for (const entry of manifest.apps ?? []) {
    if (entry.id === release.id) {
      updateEntry(entry);
      updated += 1;
    }
  }
  if (updated === 0) {
    if (!item.required) continue;
    const template = (manifest.apps ?? []).find((entry) => entry.platform === 'android');
    const entry = template ? JSON.parse(JSON.stringify(template)) : { platform: 'android' };
    entry.id = release.id;
    entry.name = release.title;
    updateEntry(entry);
    (manifest.apps ??= []).push(entry);
    created = true;
  }
  if (manifest.product === 'battery-organizer') {
    manifest.latestVersion = release.version;
    manifest.latestBuild = String(release.build);
  }
  manifest.updatedAt = publishedAt;
  manifest.generatedAt = publishedAt;
  fs.writeFileSync(item.file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已更新清单: ${path.relative(root, item.file)}${updated === 0 ? '（新建条目）' : ''}`);
}

const changelogFile = path.join(root, 'website/api/data/changelogs.json');
const changelog = JSON.parse(fs.readFileSync(changelogFile, 'utf8'));
const changelogId = '2026-09-28-battery-organizer-android-offline-105';
if (!changelog.some((entry) => entry.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-09-28',
    title: '电池收纳器单机版 Android 修复扫码失败并新增隐私政策弹窗 1.0.5',
    content: '安卓单机版更新至 1.0.5：修复扫码失败——原来的扫码功能依赖 Google Play 服务，在没有 GMS 的设备（如 HarmonyOS 手机）上会直接失败，现在改为应用内自研扫码（CameraX + ZXing），不需要任何 Google 服务，同时按系统规范申请相机权限；新增首次启动隐私政策弹窗，启动后先提示阅读《隐私政策》，可在弹窗内打开完整政策，同意后才继续使用；更新渠道现在按安装来源区分，从应用市场安装的只在应用市场内更新，从官网安装的才引导到官网下载，设置页也会显示当前安装来源。包名 cn.zhengzhengstudio.batteryorganizer.offline，数据依然只保存在本机。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
  console.log('已写入更新日志。');
}

console.log(`已发布 ${release.id} v${release.version} build ${release.build}`);
console.log(`APK: ${release.apk.targetName} ${release.apk.size} 字节 sha256=${release.apk.sha256}`);
