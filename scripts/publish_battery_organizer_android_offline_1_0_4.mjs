// 发布安卓单机版 1.0.4 到下载中心，并修正此前 Android 条目错指鸿蒙 .app 的问题。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedAt = new Date().toISOString();

const release = {
  id: 'battery-organizer-offline-android',
  version: '1.0.4',
  build: 5,
  title: '电池收纳器单机版 Android',
  packageName: 'cn.zhengzhengstudio.batteryorganizer.offline',
  variant: 'offline',
  variantLabel: '单机版',
  source: 'BatteryOrganizerAndroid/app/build/outputs/apk/offline/release/app-offline-release.apk',
  prefix: 'battery-organizer-offline-android',
  minimumSystem: 'Android 7.0',
  notes: [
    '新增数据导出与导入：可只导出电池库存或个人预设，导入前显示备份内容，导入时只补充本机没有的条目，现有数据不会被覆盖。',
    '导出与导入全程在系统文件管理器里完成，不联网、不上传，可以反复导出也可以反复导入同一份备份。',
    '修复编辑电池时累计充电次数、上次充电日期被清零，以及数量、容量、电压填非数字被静默改成默认值的问题。',
    '退役电池不再显示数量与「新电池」状态，改为明确显示「已退役，不计入库存」；退役后加号按钮的禁用样式与减号一致。',
    '删除电池时会同时清理本机的电池照片；清空本机数据改为需要二次确认。',
    '修复单机版检查更新时命中联网版条目、被误提示升级成联网版的问题。'
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
    if (entry.downloadURL && entry.downloadURL.includes('.app')) delete entry.downloadURL;
    if (entry.fileName && entry.fileName.includes('.app')) delete entry.fileName;
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
const changelogId = '2026-09-26-battery-organizer-android-offline-104';
if (!changelog.some((entry) => entry.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-09-26',
    title: '电池收纳器单机版 Android 新增数据导出导入 1.0.4',
    content: '安卓单机版更新至 1.0.4：设置页新增数据导出与导入，可只导出电池库存或个人预设，导入前显示备份内容，导入只补充本机没有的条目；修复编辑电池时累计充电次数与上次充电日期被清零、数量容量填非数字被静默改成默认值；退役电池不再显示数量与状态，删除电池同时清理本机照片，清空数据改为二次确认；修复单机版检查更新时误命中联网版条目。包名 cn.zhengzhengstudio.batteryorganizer.offline，数据只保存在本机、不联网。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
  console.log('已写入更新日志。');
}

console.log(`已发布 ${release.id} v${release.version} build ${release.build}${created ? '（首次登记安卓单机版条目）' : ''}`);
console.log(`APK: ${release.apk.targetName} ${release.apk.size} 字节 sha256=${release.apk.sha256}`);
