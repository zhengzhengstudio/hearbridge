import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.9';
const build = 53;
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
  `${version} build ${build}：移动目标加入速度估算和弹道提前量，锁定射击更容易形成可预期命中。`,
  '开火反馈改为独立战斗事件，准星会产生短促后坐变化，枪口闪光与命中爆点不会再因低帧率漏掉。',
  '命中爆点改为真实弹道接触位置，不再统一显示在敌机中心。',
  '前哨停靠成为战斗核心状态：敌火冻结、弹丸清场、机体/护盾/能量整备、货物结算，并从安全航道离站。',
  '原生空间站大厅加入淡入与轻微推进动画，网页、Android 与 HarmonyOS 共用本轮射击和停靠逻辑。',
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
  id: '2026-09-02-spacefight-0119-shooting-outpost',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight 0.11.9：弹道提前量与空间站整备',
  content: `SpaceFight 更新至 ${version} build ${build}。射击核心加入敌机速度估算和移动目标提前量，开火改用独立事件驱动准星后坐与枪口闪光，命中爆点落在实际弹道接触位置。空间站停靠改为明确的核心状态，进入后冻结战场、清除飞行弹丸、维修机体、恢复护盾和能量并结算货舱；重新出击会从停靠范围外的安全航道离站并获得短暂保护。原生大厅新增淡入推进动画。网页、Android 与 HarmonyOS 共用本轮逻辑；本轮未连接 Android、鸿蒙实机，macOS/iOS 保留已有真实版本。`,
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
