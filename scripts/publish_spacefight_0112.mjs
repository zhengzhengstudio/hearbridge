import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.2';
const build = 46;
const artifactRoot = path.join(root, 'SpaceFight-Cocos/native-build/artifacts');
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
const metadataNames = ['manifest.json', 'client-downloads.json'];
const now = new Date();
const iso = now.toISOString();
const localIso = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(now).replace(' ', 'T') + '+08:00';

const commonNotes = [
  `${version} build ${build}：原生前哨大厅、机库装配台、货舱与设置重新设计。`,
  '改善武器射程、辅助瞄准、扫掠碰撞、敌机血条和命中反馈，并扩充至 50 项以上装备。',
  '修复机体归零后画面静止但暂停仍响应的问题，失败后可重新出击或返回前哨。',
  '设置新增手动检查更新入口；Android 继续在应用内下载 APK，不跳转浏览器。',
];

const candidates = [
  {
    id: 'spacefight-android', artifactType: 'apk',
    versionedName: `SpaceFight-Android-v${version}.apk`, latestName: 'SpaceFight-Android-latest.apk',
    title: `SpaceFight Android v${version} build ${build}`,
    notes: [...commonNotes, 'Release APK 已完成包名、版本、ABI、签名和摘要校验；本批次未连接 Android 设备进行安装与运行验证。'],
    metadata: { verificationStatus: 'not-device-tested', deviceTested: false, verificationNote: '未连接 Android 设备验证' },
  },
  {
    id: 'spacefight-harmonyos-offline', artifactType: 'hap',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    notes: [...commonNotes, '单机版不要求通行证；Release HAP 已完成 Profile、证书链、包名和摘要校验，本批次未连接鸿蒙设备运行验证。'],
    metadata: { verificationStatus: 'not-device-tested', deviceTested: false, verificationNote: '未连接 HarmonyOS 设备验证' },
  },
  {
    id: 'spacefight-harmonyos-offline-app', artifactType: 'app',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.app`, latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}（AppGallery 上架包）`,
    notes: [...commonNotes, '外层 APP 与内层 HAP 已完成 Release 签名校验；本批次未连接鸿蒙设备运行验证。'],
    metadata: { verificationStatus: 'not-device-tested', deviceTested: false, verificationNote: '未连接 HarmonyOS 设备验证' },
  },
  {
    id: 'spacefight-macos', artifactType: 'dmg',
    versionedName: `SpaceFight-macOS-v${version}-debug.dmg`, latestName: 'SpaceFight-macOS-latest-debug.dmg',
    title: `SpaceFight macOS v${version} build ${build}（Ad-hoc 调试版）`,
    notes: [...commonNotes, 'Cocos 原生 App 已完成本机启动与签名检查；锁屏阻断可信画面截图，未完成视觉验收。'],
    metadata: {
      platform: 'macos', platformLabel: 'macOS', signed: true, signing: 'ad-hoc', debug: true,
      releaseChannel: 'debug', storeReady: false, minimumSystem: 'macOS 11.0', minSystem: 'macOS 11.0',
      bundleIdentifier: 'cn.zhengzhengstudio.spacefight', verificationStatus: 'runtime-no-visual-validation',
      deviceTested: false, verificationNote: '已启动；锁屏期间未完成画面验证',
      description: 'Cocos Creator 原生 macOS 客户端，包含原生前哨大厅、装配台、设置与战斗逻辑。',
      remarks: 'Ad-hoc 调试版，未使用 Developer ID 且未公证。',
    },
  },
];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const releases = candidates.map((candidate) => {
  const source = path.join(artifactRoot, candidate.versionedName);
  if (!fs.existsSync(source)) throw new Error(`Missing verified artifact: ${source}`);
  return { ...candidate, source, size: fs.statSync(source).size, sha256: digest(source) };
});

for (const appRoot of appRoots) {
  if (!fs.existsSync(appRoot)) throw new Error(`Missing download root: ${appRoot}`);
  for (const release of releases) {
    fs.copyFileSync(release.source, path.join(appRoot, release.versionedName));
    fs.copyFileSync(release.source, path.join(appRoot, release.latestName));
  }
  for (const metadataName of metadataNames) {
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
        title: release.title, notes: release.notes, size: release.size, fileSize: release.size,
        sha256: release.sha256, checksum: release.sha256, updatedAt: iso,
      }, release.metadata);
    }
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-08-30-spacefight-0112-native-release', date: localIso, type: 'release', product: 'SpaceFight',
  title: 'SpaceFight 0.11.2：原生大厅、装配台与命中体验更新',
  content: 'SpaceFight 原生客户端更新至 0.11.2 build 46。重做前哨大厅、机库装配台、货舱和设置，设置项已接入实际输入系统，并增加手动检查更新入口；Android 更新仍在应用内下载 APK，不跳转浏览器。改善射程、辅助瞄准、高速弹丸碰撞、敌机血条与命中反馈，并扩充装备选择；修复机体归零后战斗静止但暂停仍响应的问题。Android 与 HarmonyOS 包已完成构建和签名结构校验，但本批次未连接对应设备运行验证，下载中心已明确提示；macOS 为 Ad-hoc 调试版。',
  version, build, platforms: ['android', 'harmonyos', 'macos'],
};

for (const file of [
  path.join(root, 'website/api/data/changelogs.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'),
]) {
  if (!fs.existsSync(file)) continue;
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = document.findIndex((entry) => entry.id === changelogEntry.id);
  if (index >= 0) document.splice(index, 1);
  document.unshift(changelogEntry);
  writeJson(file, document);
}

process.stdout.write(`Published SpaceFight ${version} build ${build}: ${releases.map(({ id }) => id).join(', ')}\n`);
