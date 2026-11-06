// 补齐电池收纳器下载中心的三个遗留问题：
// 1) 官网 changelog（zhengzhengstudio.cn）漏同步最近 8 条记录
// 2) 产品接口 battery-organizer/apps/manifest.json 缺「单机版 Android」条目
// 3) 两个 Android 条目残留 HarmonyOS 包名 / HAP 链接 / 旧版本文件名
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/ljg/Desktop/开发者/TRAE';
const MASTER_CHANGELOG = path.join(ROOT, 'website/api/data/changelogs.json');
const SITE_CHANGELOG = path.join(ROOT, 'website/zhengzhengstudio.cn/api/changelogs.json');

const MANIFESTS = [
  'website/api/apps/client-downloads.json',
  'website/api/apps/manifest.json',
  'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
  'website/zhengzhengstudio.cn/api/apps/manifest.json',
  'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'
].map((p) => path.join(ROOT, p));

function backup(file) {
  const bak = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, bak);
  return bak;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function appList(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.apps)) return doc.apps;
  for (const value of Object.values(doc)) {
    if (Array.isArray(value)) return value;
  }
  throw new Error('找不到 apps 数组');
}

function findApp(apps, id) {
  return apps.find((item) => item && item.id === id);
}

const HAP_KEYS = [
  'hapFileName',
  'hapUrl',
  'latestHapUrl',
  'hapSize',
  'hapSha256',
  'appFileName',
  'appSize',
  'appSha256',
  'latestHapFileName',
  'isHap',
  'requiresSignedHap'
];

function cleanAndroidEntry(app) {
  if (!app) return null;
  const pkg = app.packageName || app.applicationId;
  const fileName = app.fileName;
  app.bundleIdentifier = pkg;
  app.bundleName = pkg;
  app.filename = fileName;
  app.file = fileName;
  app.apkFileName = fileName;
  app.latestApkFileName = app.latestApkFileName || fileName.replace(/-\d+\.\d+\.\d+\.apk$/, '-latest.apk');
  app.versionedUrl = app.downloadURL;
  app.versionedURL = app.downloadURL;
  const build = app.build ?? String(app.versionCode ?? '');
  app.title = `${app.name} v${app.version} build ${build}`;
  for (const key of HAP_KEYS) {
    if (key in app) delete app[key];
  }
  if (Array.isArray(app.artifacts)) {
    app.artifacts = app.artifacts.filter((item) => item && item.kind !== 'hap');
  }
  if (Array.isArray(app.downloadOptions)) {
    app.downloadOptions = app.downloadOptions.filter((item) => !`${item.fileName || ''}`.endsWith('.hap'));
  }
  if (Array.isArray(app.links)) {
    app.links = app.links.filter((item) => !`${item.fileName || ''}`.endsWith('.hap'));
  }
  app.updatedAt = app.updatedAt || new Date().toISOString();
  app.checksumAlgorithm = 'sha256';
  return pkg;
}

// ---------- 1. changelog 同步 ----------
const master = readJson(MASTER_CHANGELOG);
const site = readJson(SITE_CHANGELOG);
const siteIds = new Set(site.map((item) => item.id));
const missing = master.filter((item) => !siteIds.has(item.id));
if (missing.length === 0) {
  console.log('[changelog] 无需同步');
} else {
  const merged = master.map((item) => item);
  backup(SITE_CHANGELOG);
  writeJson(SITE_CHANGELOG, merged);
  console.log(`[changelog] 补写 ${missing.length} 条：${missing.map((item) => item.id).join(', ')}`);
}

// ---------- 2 & 3. 清单修正 ----------
const source = readJson(MANIFESTS[1]);
const sourceApps = appList(source);
const sourceOfflineAndroid = findApp(sourceApps, 'battery-organizer-offline-android');
if (!sourceOfflineAndroid) {
  throw new Error('主清单里找不到 battery-organizer-offline-android，无法继续');
}
cleanAndroidEntry(sourceOfflineAndroid);
cleanAndroidEntry(findApp(sourceApps, 'battery-organizer-android'));

for (const file of MANIFESTS) {
  const doc = readJson(file);
  const apps = appList(doc);
  const changed = [];

  const offlineAndroid = findApp(apps, 'battery-organizer-offline-android');
  if (offlineAndroid) {
    cleanAndroidEntry(offlineAndroid);
    changed.push('battery-organizer-offline-android(清理)');
  } else {
    const clone = JSON.parse(JSON.stringify(sourceOfflineAndroid));
    apps.push(clone);
    changed.push('battery-organizer-offline-android(新增)');
  }

  const onlineAndroid = findApp(apps, 'battery-organizer-android');
  if (onlineAndroid) {
    cleanAndroidEntry(onlineAndroid);
    changed.push('battery-organizer-android(清理)');
  }

  backup(file);
  writeJson(file, doc);
  console.log(`[manifest] ${path.relative(ROOT, file)} -> ${changed.join(' / ')}`);
}

// ---------- 4. 回读校验 ----------
console.log('\n--- 校验 ---');
for (const file of MANIFESTS) {
  const apps = appList(readJson(file));
  const rows = ['battery-organizer-android', 'battery-organizer-offline-android'].map((id) => {
    const app = findApp(apps, id);
    if (!app) return `${id}: 缺失`;
    const hapLeft = HAP_KEYS.filter((key) => key in app);
    return `${id}: ${app.version}(${app.build}) ${app.fileName} pkg=${app.bundleName}${hapLeft.length ? ` 残留=${hapLeft}` : ''}`;
  });
  console.log(`${path.relative(ROOT, file)}\n   ${rows.join('\n   ')}`);
}

const siteChangelog = readJson(SITE_CHANGELOG);
console.log(`\nchangelog: master=${master.length} site=${siteChangelog.length}`);
