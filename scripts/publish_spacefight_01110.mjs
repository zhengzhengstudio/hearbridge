import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.10';
const build = 54;
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
  `${version} build ${build}：为低配安卓、模拟器和内存紧张设备加入真实运行预算。`,
  '低配档改为单区块与 14 个环境掩体，推迟世界生成；完整 GLB 改用带机库、走廊和掩体的模块化空间站。',
  '低配弹丸池缩至 18，关闭弹道拖尾、弹丸物理组件、逐发动态光和高速粒子；命中标记与声音震动反馈继续保留。',
  '敌机模型按锁定目标与距离选择，同屏最多 4 架，避免波次增长后持续堆积模型和加载请求。',
  'Android 原生端增加低内存、可用内存和模拟器识别；普通安卓与 HarmonyOS 仍按既定规则使用高配。',
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
  id: '2026-09-03-spacefight-01110-low-end-compatibility',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight 0.11.10：低配设备兼容与启动降载',
  content: `SpaceFight 更新至 ${version} build ${build}。Android 原生端补充系统低内存、实时可用内存和模拟器识别，受限设备会直接进入低配档；普通 Android 与 HarmonyOS 继续按既定规则使用高配。低配档缩减为单区块、14 个环境掩体、18 个弹丸节点和 8 个命中特效节点，关闭弹道物理、拖尾、逐发动态光与高速粒子，并把世界生成延后到主界面可操作之后。低配空间站使用保留机库、走廊、建筑外壳与内部掩体的模块化模型，高配继续加载完整 GLB。敌机模型按当前锁定和距离筛选，同屏最多 4 架，保留实际战斗模拟、命中标记、声音和震动反馈。网页、Android 与 HarmonyOS 共用本轮兼容逻辑；本轮未连接 Android、鸿蒙实机，macOS/iOS 保留已有真实版本。`,
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
