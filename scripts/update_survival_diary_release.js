#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const website = path.join(root, 'website');
const privateApps = path.join(website, 'api', 'apps');
const publicApps = path.join(website, 'zhengzhengstudio.cn', 'api', 'apps');
const versionedName = 'SurvivalDiary-Android-v0.2.0-b2.apk';
const latestName = 'SurvivalDiary-Android-latest.apk';
const versionedFile = path.join(privateApps, versionedName);
const latestFile = path.join(privateApps, latestName);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.survival-diary-${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function copyAtomic(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.survival-diary-${process.pid}.tmp`;
  fs.copyFileSync(source, temporary);
  if (fs.statSync(source).size !== fs.statSync(temporary).size || sha256(source) !== sha256(temporary)) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`copy verification failed for ${destination}`);
  }
  fs.renameSync(temporary, destination);
}

for (const file of [versionedFile, latestFile]) {
  if (!fs.existsSync(file)) throw new Error(`missing formal APK: ${file}`);
}
const size = fs.statSync(versionedFile).size;
const checksum = sha256(versionedFile);
if (size !== fs.statSync(latestFile).size || checksum !== sha256(latestFile)) {
  throw new Error('versioned and latest APKs are not byte-identical');
}

copyAtomic(versionedFile, path.join(publicApps, versionedName));
copyAtomic(latestFile, path.join(publicApps, latestName));

const updatedAt = new Date().toISOString();
const release = {
  kind: 'package',
  artifactType: 'package',
  product: 'survival-diary',
  id: 'survival-diary-android',
  name: '生存日记 Android 正式版',
  platform: 'android',
  platformLabel: 'Android',
  variant: 'online-with-offline-fallback',
  variantLabel: '联网版（含完整离线游戏）',
  category: '游戏',
  version: '0.2.0',
  latestVersion: '0.2.0',
  versionName: '0.2.0',
  build: 2,
  versionCode: 2,
  signed: true,
  signing: 'android-release',
  storeReady: true,
  fileName: versionedName,
  url: `/api/apps/download/${latestName}`,
  latestUrl: `/api/apps/download/${latestName}`,
  versionedUrl: `/api/apps/download/${versionedName}`,
  downloadURL: `/api/apps/download/${versionedName}`,
  pageURL: 'https://survival-diary.zhengzhengstudio.cn/',
  bundleIdentifier: 'cn.zhengzhengstudio.survivaldiary',
  minimumSystem: 'Android 8.0',
  minSystem: 'Android 8.0',
  icon: 'https://survival-diary.zhengzhengstudio.cn/assets/icons/icon-192.png',
  notes: [
    '开放式海岛生存，没有固定结局；支持持续探索、采集和本机存档。',
    '加入 12 种制作配方与 8 类可持久放置建筑，支持预览、旋转、确认、使用和安全拆除。',
    '恢复可编辑生存日记和按天历史，并记录采集、制作、建造、使用与发现事实。',
    '采用精细 2.5D 建筑贴图，完善桌面与手机 HUD、触控移动、缩放和离线缓存。',
    'Android 使用独立正式发布证书签名；联网检查更高版本/build，校验下载后调用系统安装器。',
  ],
  remarks: '正式签名 Android 安装包；联网使用正式站点，断网或加载失败时进入包内完整游戏。',
  title: '生存日记 Android 正式版 v0.2.0 build 2',
  size,
  fileSize: size,
  sha256: checksum,
  checksum,
  updatedAt,
};

const releaseDocuments = [
  path.join(privateApps, 'manifest.json'),
  path.join(privateApps, 'client-downloads.json'),
  path.join(publicApps, 'manifest.json'),
  path.join(publicApps, 'client-downloads.json'),
];
for (const file of releaseDocuments) {
  const document = readJson(file);
  const apps = Array.isArray(document.apps) ? document.apps : [];
  const first = apps.findIndex((item) => item.id === release.id);
  const filtered = apps.filter((item) => item.id !== release.id);
  filtered.splice(first < 0 ? filtered.length : first, 0, { ...release });
  document.apps = filtered;
  document.updatedAt = updatedAt;
  document.generatedAt = updatedAt;
  writeJsonAtomic(file, document);
}

const changelog = {
  id: '2026-07-29-survival-diary-0.2.0',
  date: '2026-07-29T00:30:00+08:00',
  type: 'feature',
  product: '生存日记',
  title: '生存日记 0.2.0：开放生存、精细建造与 Android 正式版',
  content: '已完成：\n- 开放式海岛生存不设固定结局，玩家可持续探索、采集、制作和扩建。\n- 补齐 12 种相互连接的制作配方与 8 类持久建筑，支持真实材料消耗、放置预览、90° 旋转、碰撞检查、使用与受保护拆除。\n- 恢复可编辑日记本和按天历史，采集、制作、放置、使用、拆除与发现会写入客观事实，同时保留玩家标题与正文。\n- 8 类建筑使用统一视角的精细 2.5D 透明贴图，新图标同步用于网页、PWA 与 Android。\n- 桌面和手机界面完成响应式重排，支持触控移动、双指缩放、制作抽屉、全屏日记和至少 44px 的主要触控区域。\n- Android 版本提升至 0.2.0 build 2，使用生存日记独立正式签名证书，非调试构建内置完整离线游戏。\n- Android 会在 manifest 版本或 build 更高时提示更新，下载并校验 SHA-256 后调用系统安装器。\n- 私有与公开 manifest、client downloads、带版本号/latest APK 和下载中心条目已同步。',
};

for (const file of [
  path.join(website, 'api', 'data', 'changelogs.json'),
  path.join(website, 'zhengzhengstudio.cn', 'api', 'changelogs.json'),
]) {
  const records = readJson(file);
  const filtered = records.filter((item) => item.id !== changelog.id);
  filtered.unshift({ ...changelog });
  writeJsonAtomic(file, filtered);
}

console.log(JSON.stringify({ version: release.version, build: release.build, size, sha256: checksum }));
