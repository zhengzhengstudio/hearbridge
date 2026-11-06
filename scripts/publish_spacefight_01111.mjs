import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.11';
const build = 55;
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
  `${version} build ${build}：重做空间站外壳分层、进近掩体和开放区设施分布。`,
  '高配空间站 GLB 增加居住舱、电力脊柱、散热鳍、炮台与服务罐，并移除与可交互舱内模块重叠的重复几何。',
  '出生区固定布置 8 组可读进近掩体，碎片按墙体、货舱、信标柱和岩体分型，不再只是随机石块。',
  '开放区设施扩展为货运站、跃迁门、中继站、残骸、精炼阵列和防御平台六类。',
  '低配档仍保留 4 个关键环境碰撞体与命中、声音、震动反馈，不以清空掩体换取帧率。',
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
  id: '2026-09-04-spacefight-01111-outpost-cover-pass',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight 0.11.11：空间站外壳、进近掩体与设施扩展',
  content: `SpaceFight 更新至 ${version} build ${build}。高配空间站 GLB 增加居住舱、电力脊柱、散热鳍、炮台和服务罐，并改成只替换模块化空间站外壳，避免与可交互机库、走廊及舱内掩体重叠。出生区加入 8 组固定进近掩体，环境碎片分为墙体、货舱、信标柱和岩体；开放区设施扩展为货运站、跃迁门、中继站、残骸、精炼阵列和防御平台六类。低配档继续保留 4 个关键环境碰撞体，命中、声音和震动反馈不降级。三张空间站 1920×1080 原生界面图已恢复进资源库。网页、Android 与 HarmonyOS 已重新构建；Android APK 与 HarmonyOS release9 HAP/APP 均完成签名校验，本轮未连接实机。`,
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
