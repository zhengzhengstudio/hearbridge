import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = path.join(process.env.HOME, 'Downloads');
const publishedAt = new Date().toISOString();

const release = {
  id: 'battery-organizer-harmonyos',
  version: '1.1.30',
  build: 1000130,
  title: '电池收纳器 HarmonyOS',
  bundleName: 'cn.zhengzhengstudio.batteryorganizer.hmos',
  variant: 'online',
  variantLabel: '联网版',
  appSource: 'BatteryOrganizer-HarmonyOS-v1.1.30-signed.app',
  hapSource: 'BatteryOrganizer-HarmonyOS-v1.1.30-signed.hap',
  prefix: 'battery-organizer-harmonyos',
  notes: [
    '新增数据导出与导入：可只导出电池库存或自定义预设，导出前显示会生成几个文件，支持分卷保存。',
    '导入前先显示备份里有多少电池和预设，确认后才写入；导入只补充本机没有的条目，现有数据一条不动。',
    '导出导入全程在系统文件管理器完成，不经过服务器，可以反复导出也可以反复导入同一份备份。',
    '修复编辑电池时被重置的购买日期、上次充电日期、过期日期、循环次数和收藏状态。',
    '修复数量、最低库存、容量、电压填写非数字时被静默改成 1 的问题，现在会明确提示。',
    '修复云端返回空预设时本机自定义预设被清空的问题。',
    '删除电池、删除预设新增二次确认；删除电池时同步清理本机照片并关闭详情页。',
    '关闭添加或编辑表单时清理拍了但没保存的照片，不再残留文件。',
    '退役电池、登记用途、移除用途等操作统一给出明确提示，不再静默失败。'
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
const changelogId = '2026-09-26-battery-organizer-harmonyos-1130';
if (!changelog.some((entry) => entry.id === changelogId)) {
  changelog.unshift({
    id: changelogId,
    date: '2026-09-26',
    title: '电池收纳器 HarmonyOS 新增数据导出导入并修复数据重置 1.1.30',
    content: '联网版 HarmonyOS 更新至 1.1.30：设置页新增数据导出与导入，可只导出电池库存或自定义预设，支持分卷保存，导入前显示备份内容且只补充本机没有的条目；修复编辑电池时购买日期、上次充电与过期日期、循环次数、收藏状态被重置的问题；修复数量与电压填非数字被静默改成 1、云端返回空预设清空本机预设、删除电池不清理照片、删除操作缺少二次确认等问题。',
    category: '应用更新'
  });
  fs.writeFileSync(changelogFile, `${JSON.stringify(changelog, null, 2)}\n`);
  console.log('已写入更新日志。');
}

console.log(`已发布 ${release.id} v${release.version} build ${release.build}`);
