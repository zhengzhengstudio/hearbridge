import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.10.23';
const build = 42;
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
const metadataNames = ['manifest.json', 'client-downloads.json'];
const now = new Date();
const iso = now.toISOString();
const localIso = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(now).replace(' ', 'T') + '+08:00';

const releases = {
  'spacefight-android': {
    artifactType: 'apk',
    fileName: `SpaceFight-Android-v${version}.apk`,
    latestName: 'SpaceFight-Android-latest.apk',
    size: 40231843,
    sha256: '9eac6f5c961211f7b0033be50848ae6feb065269d7149334185d1e80162aa756',
    title: `SpaceFight Android v${version} build ${build}`,
    notes: [
      `${version} build ${build}：摇杆加入方向、行程和阈值反馈，松手立即归零并提供节流震动。`,
      '战机模型异步加载失败时使用可见备用机体，避免停在 Cocos 启动画面或出现不可见碰撞体。',
      '远征加入主要目标、深区行动、返航保持、敌机职责、货舱物资和失败结算。',
      '原生 HUD 增加远征目标、货舱、目标职责与返航控件，并补齐八种语言。',
      'Release APK 已通过包名、版本、arm64 ABI、v1/v2 签名和 SHA-256 校验。',
    ],
  },
  'spacefight-harmonyos-offline': {
    artifactType: 'hap',
    fileName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    size: 49392196,
    sha256: '93bce933326d5df6fef8f8d4ac8f89788d5ffdaa9495f993da925e09519e5135',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    notes: [
      `${version} build ${build}：摇杆反馈、战机备用模型、远征目标、敌机职责和货舱系统同步进入鸿蒙单机版。`,
      '原生横屏 HUD 增加返航进度、目标职责和货舱状态，并补齐八种语言。',
      '单机版不需要通行证，且不声明 INTERNET 或网络状态权限。',
      'Release HAP 已通过 Profile、证书链、代码签名、包名和 SHA-256 校验。',
    ],
  },
  'spacefight-harmonyos-offline-app': {
    artifactType: 'app',
    fileName: `SpaceFight-HarmonyOS-Offline-v${version}.app`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    size: 49408241,
    sha256: 'd34e14c1b70c09ad9078c603e7cddb5b7ebeed61b1de65af06b20cf94cedf075',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}（AppGallery 上架包）`,
    notes: [
      `${version} build ${build}：摇杆反馈、战机备用模型、远征目标、敌机职责和货舱系统同步进入鸿蒙单机版。`,
      '原生横屏 HUD 增加返航进度、目标职责和货舱状态，并补齐八种语言。',
      '单机版不需要通行证，且不声明 INTERNET 或网络状态权限。',
      '外层 APP 与内层 HAP 均已通过 Release Profile、证书链、代码签名、包名和 SHA-256 校验。',
    ],
  },
};

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

for (const appRoot of appRoots) {
  for (const release of Object.values(releases)) {
    for (const name of [release.fileName, release.latestName]) {
      const file = path.join(appRoot, name);
      if (!fs.existsSync(file)) throw new Error(`Missing published package: ${file}`);
      const stats = fs.statSync(file);
      if (stats.size !== release.size) throw new Error(`Size mismatch: ${file}`);
      if (hash(file) !== release.sha256) throw new Error(`SHA-256 mismatch: ${file}`);
    }
  }

  for (const metadataName of metadataNames) {
    const file = path.join(appRoot, metadataName);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    document.updatedAt = localIso;
    document.generatedAt = localIso;
    for (const [id, release] of Object.entries(releases)) {
      const entry = document.apps.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`Missing ${id} in ${file}`);
      Object.assign(entry, {
        version,
        latestVersion: version,
        versionName: version,
        build,
        versionCode: build,
        artifactType: release.artifactType,
        fileName: release.fileName,
        url: `/api/apps/${release.latestName}`,
        latestUrl: `/api/apps/${release.latestName}`,
        versionedUrl: `/api/apps/${release.fileName}`,
        downloadURL: `/api/apps/${release.fileName}`,
        title: release.title,
        size: release.size,
        fileSize: release.size,
        sha256: release.sha256,
        checksum: release.sha256,
        notes: release.notes,
        updatedAt: iso,
      });
    }
    writeJson(file, document);
  }
}

const changelogFile = path.join(root, 'website/api/data/changelogs.json');
const changelogs = JSON.parse(fs.readFileSync(changelogFile, 'utf8'));
const changelogId = '2026-08-29-spacefight-01023-release';
const entry = {
  id: changelogId,
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: `SpaceFight ${version}：操控反馈与开放远征基础`,
  content: `SpaceFight 网页、Android 与 HarmonyOS 单机版更新至 ${version} build ${build}。摇杆加入方向、行程、阈值和震动反馈；战机模型失败时使用可见备用机体，不再阻塞战斗启动；远征加入主要目标、深区行动、返航保持、五种敌机职责、货舱物资与失败结算。原生 HUD 补齐远征、货舱、目标职责、返航控件和八种语言。Android APK 已通过 v1/v2 签名校验，HarmonyOS HAP/APP 的外层与内层签名均通过官方工具校验；版本文件、latest 文件和两个下载清单已同步。`,
  version,
  build,
  platforms: ['web', 'android', 'harmonyos'],
};
const existingIndex = changelogs.findIndex((item) => item.id === changelogId);
if (existingIndex >= 0) changelogs.splice(existingIndex, 1);
changelogs.unshift(entry);
writeJson(changelogFile, changelogs);

for (const buildFile of [
  path.join(root, 'docs/spacefight/builds/android-0.10.23-b42.json'),
  path.join(root, 'docs/spacefight/builds/harmony-offline-0.10.23-b42.json'),
]) {
  const document = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
  document.verification.publishedAt = localIso;
  document.verification.publishedByUserDirection = true;
  document.verification.launchBoundary = 'Native runtime smoke was not performed because device/emulator validation was stopped by user direction; the signed artifact was published by subsequent explicit user direction.';
  writeJson(buildFile, document);
}

process.stdout.write(`Published SpaceFight ${version} build ${build} metadata and changelog.\n`);
