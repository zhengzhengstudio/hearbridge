import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = path.join(process.env.HOME, 'Downloads');
const publishedAt = new Date().toISOString();

const release = {
  id: 'battery-organizer-offline-harmonyos',
  version: '1.0.18',
  build: 1000018,
  title: '电池收纳器单机版 HarmonyOS',
  bundleName: 'cn.zhengzhengstudio.batteryorganizeronedevice.hmos',
  variant: 'offline',
  variantLabel: '单机版',
  appSource: 'BatteryOrganizer-Offline-HarmonyOS-v1.0.18-signed.app',
  hapSource: 'BatteryOrganizer-Offline-HarmonyOS-v1.0.18-signed.hap',
  prefix: 'battery-organizer-offline-harmonyos',
  notes: [
    '修复库存页「总数量 / 电池组 / 需补货」统计值必须重新进入页面才会更新的问题，现在修改后立即同步。',
    '修复右上角刷新按钮不生效的问题：刷新现在会真正重新读取本机库存并重算统计，不再是只写不读。',
    '统计值改为依据当前库存实时计算，杜绝任何情况下的统计滞后或数值不一致。',
    '从其他页面返回库存页时自动重算统计，无需手动刷新。'
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
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'), required: true },
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json'), required: false },
  { file: path.join(root, 'website/zhengzhengstudio.cn/api/boardgames/manifest.json'), required: false }
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(sourceName, targetName) {
  const source = path.join(downloads, sourceName);
  if (!fs.existsSync(source)) {
    throw new Error(`缺少签名产物: ${source}`);
  }
  return { source, targetName, size: fs.statSync(source).size, sha256: sha256(source) };
}

release.app = artifact(release.appSource, `${release.prefix}-${release.version}.app`);
release.hap = artifact(release.hapSource, `${release.prefix}-${release.version}.hap`);

for (const directory of appDirectories) {
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(release.app.source, path.join(directory, release.app.targetName));
  fs.copyFileSync(release.app.source, path.join(directory, `${release.prefix}-latest.app`));
  fs.copyFileSync(release.hap.source, path.join(directory, release.hap.targetName));
  fs.copyFileSync(release.hap.source, path.join(directory, `${release.prefix}-latest.hap`));
}

function updateEntry(entry) {
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
    if (item.required) {
      throw new Error(`未在 ${item.file} 中找到 ${release.id} 条目`);
    }
    continue;
  }
  if (manifest.product === 'battery-organizer') {
    manifest.latestVersion = release.version;
    manifest.latestBuild = String(release.build);
  }
  manifest.updatedAt = publishedAt;
  manifest.generatedAt = publishedAt;
  fs.writeFileSync(item.file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已更新清单: ${path.relative(root, item.file)}`);
}

const changelogFile = path.join(root, 'website/api/data/changelogs.json');
const changelog = JSON.parse(fs.readFileSync(changelogFile, 'utf8'));

const changelogId = '2026-09-28-battery-organizer-offline-harmonyos-1018';
if (!changelog.some((entry) => entry.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-09-28',
    title: '电池收纳器单机版 HarmonyOS 修复库存统计不刷新 1.0.18',
    content: '单机版 HarmonyOS 更新至 1.0.18：修复库存页「总数量 / 电池组 / 需补货」三项统计必须重新进入页面才会更新的问题；修复右上角刷新按钮只把内存数据写回存储、却不读取最新库存的反向逻辑，现在点击刷新会真正重新读取本机库存并重算统计；统计值改为依据当前库存实时计算，从其他页面返回时也会自动重算。数据依然只保存在当前设备，不联网、不需要账号。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
  console.log('已写入更新日志。');
}

console.log(`已发布 ${release.id} v${release.version} build ${release.build}`);
