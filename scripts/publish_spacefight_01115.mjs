import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.15';
const build = 59;
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
  `${version} build ${build}：补齐战斗声音、引擎环境声、按钮音效与可独立管理的音频设置。`,
  '新增可牵引的实体货箱、货物入舱反馈、远征结算，以及名为“星港券”的本地货币和轨道交易所。',
  '机库与商城换用正式场景画面，加入页面过渡、货箱浮动、牵引、购买、命中和返航动画。',
  '修复返航失败、停靠穿模、界面闪烁和触屏暂停后无法恢复，并改善适度瞄准辅助。',
];

const releases = [
  {
    id: 'spacefight-android', artifactType: 'apk',
    versionedName: `SpaceFight-Android-v${version}.apk`, latestName: 'SpaceFight-Android-latest.apk',
    title: `SpaceFight Android v${version} build ${build}`,
    description: 'Cocos Creator 原生横屏空战客户端，包含战斗、空间站、机库、货舱、商城与完整装配台。',
    remarks: 'Release APK；新增原生音频、星港券经济、货物回收和完整暂停菜单，保留应用内检查更新、多线程下载与顶部进度条。',
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
  id: '2026-09-04-spacefight-01115-audio-cargo-market',
  date: localIso,
  type: 'release', product: 'SpaceFight', version, build,
  title: 'SpaceFight 0.11.15：声音、货运与轨道交易所',
  content: `SpaceFight 更新至 ${version} build ${build}。全端共用的 Cocos 战斗层新增引擎环境声、武器、命中、受击、货物、返航和菜单音效；战场加入实体货箱、牵引动画与入舱反馈。原生行动中心新增“星港券”和轨道交易所，可购买货舱扩展、牵引校准及专属涂装；机库和商城使用新的正式场景画面。返航时间和受击中断更清晰，空间站碰撞边界、瞄准保持、界面闪烁及暂停后无法恢复均已修复，暂停现提供继续战斗和装配设置入口。网页、Android APK 与 HarmonyOS release9 HAP/APP 已重新构建；本轮未连接实机。`,
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
