import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.13';
const build = 57;
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
  `${version} build ${build}：移动端开火键增加即时触觉反馈，并保留按住连续射击。`,
  '联机新增服务端输入限流、递增序号、客户端时钟和消息体积校验，异常输入会被拒绝，持续滥用才会断开当前连接。',
  '客户端不能提交伤害、命中、弹丸、血量、位置或速度；射速、弹药、弹道、命中与伤害继续由服务端计算。',
  '反作弊不做永久封禁，避免共享网络和短暂卡顿造成误判；正常 30Hz 操作及长按开火已通过自动测试。',
];

const releases = [
  {
    id: 'spacefight-android', artifactType: 'apk',
    versionedName: `SpaceFight-Android-v${version}.apk`, latestName: 'SpaceFight-Android-latest.apk',
    title: `SpaceFight Android v${version} build ${build}`,
    description: 'Cocos Creator 原生横屏空战客户端，包含战场内空间站、装配、随机事件和应用内更新。',
    remarks: 'Release APK；支持应用内手动检查、多线程下载、顶部进度条和按住开火。',
    metadata: { verificationStatus: 'build-verified', deviceTested: false,
      verificationNote: '已完成 Release 构建、版本和签名校验；本轮按要求未做 Windows 或实机验证' },
  },
  {
    id: 'spacefight-harmonyos-offline', artifactType: 'hap',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    description: 'HarmonyOS NEXT 原生单机版，不需要通行证。',
    remarks: 'Release9 HAP；包名 cn.zhengzhengstudio.spacefight.huawei。',
    metadata: { verificationStatus: 'build-verified', deviceTested: false,
      verificationNote: '已完成 Profile、证书链和 release9 发布签名校验；本轮未连接实机' },
  },
  {
    id: 'spacefight-harmonyos-offline-app', artifactType: 'app',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.app`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}`,
    description: 'HarmonyOS NEXT AppGallery 上架包，内含已签名的单机 HAP。',
    remarks: 'Release9 APP；外层 APP 与内层 HAP 分别验签。',
    metadata: { verificationStatus: 'build-verified', deviceTested: false,
      verificationNote: '已完成外层 APP、内层 HAP 和 release9 Profile 校验；本轮未连接实机' },
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
  id: '2026-09-04-spacefight-01113-fire-anticheat',
  date: localIso,
  type: 'release', product: 'SpaceFight', version, build,
  title: 'SpaceFight 0.11.13：开火反馈与联机反作弊',
  content: `SpaceFight 更新至 ${version} build ${build}。移动端开火键在按下时提供即时触觉反馈，并继续支持按住连续射击。联机服务增加输入频率、递增序号、客户端时钟和 8KB 消息上限校验，拒绝客户端伪造伤害、命中、弹丸、生命、位置和速度；射速、弹药、弹道、命中及伤害均由服务端裁定。异常输入采用逐步计分，只在持续滥用时断开当前连接，不做永久封禁。网页、Android APK 与 HarmonyOS release9 HAP/APP 已重新构建；本轮按要求未做 Windows 或实机验证。`,
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
