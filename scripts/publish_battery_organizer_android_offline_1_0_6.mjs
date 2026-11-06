// 发布安卓单机版 1.0.5：修复华为审核驳回的两个问题（扫码失败、未提示隐私政策）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedAt = new Date().toISOString();

const release = {
  id: 'battery-organizer-offline-android',
  version: '1.0.6',
  build: 7,
  title: '电池收纳器单机版 Android',
  packageName: 'cn.zhengzhengstudio.batteryorganizer.offline',
  variant: 'offline',
  variantLabel: '单机版',
  source: 'BatteryOrganizerAndroid/app/build/outputs/apk/offline/release/app-offline-release.apk',
  prefix: 'battery-organizer-offline-android',
  minimumSystem: 'Android 7.0',
  notes: [
    '修复应用市场审核问题：首次启动的隐私政策弹窗现在提供明确的「不同意并退出」选项，不再只有「同意」一种选择。',
    '隐私政策弹窗新增「我已阅读并同意《隐私政策》」勾选框，未勾选时无法点击同意，确保同意是用户主动作出的。',
    '选择「不同意并退出」会直接退出应用，不会在后台保留任何数据或继续联网。',
    '其余功能与 1.0.5 一致：数据只保存在本机，不联网、不需要账号。'
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
const changelogId = '2026-09-30-battery-organizer-android-offline-106';
if (!changelog.some((entry) => entry.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-09-30',
    title: '电池收纳器单机版 Android 隐私政策弹窗补充拒绝选项 1.0.6',
    content: '安卓单机版更新至 1.0.6：针对应用市场审核意见，首次启动的隐私政策弹窗新增「我已阅读并同意《隐私政策》」勾选框，未勾选时同意按钮不可点击，并新增「不同意并退出」按钮，选择后直接退出应用，不再只有「同意」一种选择。其余功能与 1.0.5 一致，数据依然只保存在本机。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
  console.log('已写入更新日志。');
}

console.log(`已发布 ${release.id} v${release.version} build ${release.build}`);
console.log(`APK: ${release.apk.targetName} ${release.apk.size} 字节 sha256=${release.apk.sha256}`);
