import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.8';
const build = 52;
const artifactRoot = path.join(root, 'SpaceFight-Cocos/native-build/artifacts');
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
const now = new Date();
const iso = now.toISOString();
const localIso = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(now).replace(' ', 'T') + '+08:00';

const commonNotes = [
  `${version} build ${build}：修复命中事件被界面刷新节流丢弃的问题，命中与击毁反馈会稳定显示。`,
  '准星只在真正进入射击解算时显示锁定，并增加有限弹道引导与碰撞宽容，降低“看似瞄准却打不中”的挫败。',
  '前哨加入实时距离、可停靠提示和真正的进入动作；进入后回到原生行动大厅，可继续装配或重新出击。',
  '第一人称座舱补齐显示器、侧控台、节流杆、按钮与开关组；恢复前哨、机库和战区正式视觉资源。',
  '网页与原生端统一战斗层级，保留 SpaceFight 自有视觉与交互，不复制其他游戏资源。',
];

const releases = [
  {
    id: 'spacefight-android', artifactType: 'apk',
    versionedName: `SpaceFight-Android-v${version}.apk`, latestName: 'SpaceFight-Android-latest.apk',
    title: `SpaceFight Android v${version} build ${build}`,
    description: 'Cocos Creator 原生横屏空战客户端，包含原生大厅、装配、随机战场事件和应用内更新。',
    remarks: 'Release APK；支持应用内手动检查、多线程下载和顶部进度条。',
    metadata: {
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '已完成 Release 构建与签名校验；本轮未连接 Android 实机',
    },
  },
  {
    id: 'spacefight-harmonyos-offline', artifactType: 'hap',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    description: 'HarmonyOS NEXT 原生单机版，不需要通行证。',
    remarks: 'Release HAP；包名 cn.zhengzhengstudio.spacefight.huawei。',
    metadata: {
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '已完成 Profile、证书链和发布签名校验；本轮未连接鸿蒙实机',
    },
  },
  {
    id: 'spacefight-harmonyos-offline-app', artifactType: 'app',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.app`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}`,
    description: 'HarmonyOS NEXT AppGallery 上架包，内含已签名的单机 HAP。',
    remarks: 'Release APP；外层 APP 与内层 HAP 分别验签。',
    metadata: {
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '已完成外层 APP 和内层 HAP 签名校验；本轮未连接鸿蒙实机',
    },
  },
];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyRelease(source, destination) {
  const cloudPlaceholder = path.join(path.dirname(destination), `.${path.basename(destination)}.icloud`);
  if (fs.existsSync(cloudPlaceholder)) fs.rmSync(cloudPlaceholder);
  fs.copyFileSync(source, destination);
}

for (const release of releases) {
  release.source = path.join(artifactRoot, release.versionedName);
  if (!fs.existsSync(release.source)) throw new Error(`Missing verified artifact: ${release.source}`);
  release.size = fs.statSync(release.source).size;
  release.sha256 = digest(release.source);
}

for (const appRoot of appRoots) {
  for (const release of releases) {
    copyRelease(release.source, path.join(appRoot, release.versionedName));
    copyRelease(release.source, path.join(appRoot, release.latestName));
  }
  for (const metadataName of ['manifest.json', 'client-downloads.json']) {
    const file = path.join(appRoot, metadataName);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    document.updatedAt = localIso;
    document.generatedAt = localIso;
    for (const release of releases) {
      const entry = document.apps.find((candidate) => candidate.id === release.id);
      if (!entry) throw new Error(`Missing ${release.id} in ${file}`);
      Object.assign(entry, {
        version, latestVersion: version, versionName: version, build, versionCode: build,
        artifactType: release.artifactType, fileName: release.versionedName,
        url: `/api/apps/${release.latestName}`, latestUrl: `/api/apps/${release.latestName}`,
        versionedUrl: `/api/apps/${release.versionedName}`,
        downloadURL: `/api/apps/${release.versionedName}`,
        title: release.title, description: release.description, remarks: release.remarks,
        notes: commonNotes, size: release.size, fileSize: release.size,
        sha256: release.sha256, checksum: release.sha256, updatedAt: iso,
      }, release.metadata);
    }
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-09-02-spacefight-0118-combat-feedback',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight 0.11.8：命中反馈、前哨停靠与完整座舱',
  content: `SpaceFight 更新至 ${version} build ${build}。修复命中事件被界面节流丢失和非准星目标误显示锁定的问题，加入有限弹道引导、碰撞宽容与更清晰的命中/击毁反馈。前哨现在显示距离和停靠状态，抵达后可以真正进入行动大厅。第一人称座舱补齐显示器、控制台、节流杆、按钮和开关组，网页与原生端统一使用新的战斗信息层级。恢复前哨、机库和战区主视觉资源。Android 与 HarmonyOS 安装包已完成构建和签名结构检查；本轮未连接 Android、鸿蒙实机。macOS/iOS 保留已有真实版本。`,
  version,
  build,
  platforms: ['web', 'android', 'harmonyos'],
};

for (const file of [
  path.join(root, 'website/api/data/changelogs.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'),
]) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existing = document.findIndex((entry) => entry.id === changelogEntry.id);
  if (existing >= 0) document.splice(existing, 1);
  document.unshift(changelogEntry);
  writeJson(file, document);
}

process.stdout.write(`Published SpaceFight ${version} build ${build}: ${releases.map(({ id }) => id).join(', ')}\n`);
