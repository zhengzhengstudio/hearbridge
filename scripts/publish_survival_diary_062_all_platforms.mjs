import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const root = process.cwd();
const privateRoot = join(root, 'website/api/apps');
const publicRoot = join(root, 'website/zhengzhengstudio.cn/api/apps');
const documents = [
  join(privateRoot, 'manifest.json'),
  join(privateRoot, 'client-downloads.json'),
  join(publicRoot, 'manifest.json'),
  join(publicRoot, 'client-downloads.json'),
];
const now = new Date().toISOString();

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyVerified(source, destination) {
  if (!existsSync(source)) throw new Error(`缺少发布文件：${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination) || sha256(source) !== sha256(destination)) copyFileSync(source, destination);
  if (sha256(source) !== sha256(destination)) throw new Error(`复制后摘要不一致：${destination}`);
}

function writeSidecar(path) {
  writeFileSync(`${path}.sha256`, `${sha256(path)}  ${basename(path)}\n`);
}

function artifact(path) {
  if (!existsSync(path)) throw new Error(`缺少发布文件：${path}`);
  return { size: statSync(path).size, sha256: sha256(path) };
}

const paths = {
  android: join(privateRoot, 'download/SurvivalDiary-Android-v0.6.2-b45.apk'),
  iosSource: join(root, 'apps/SurvivalDiary-Apple/Artifacts/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa'),
  ios: join(privateRoot, 'download/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa'),
  macSource: join(root, 'apps/SurvivalDiary-Apple/Artifacts/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip'),
  mac: join(privateRoot, 'download/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip'),
  harmonyOfflineHap: join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.hap'),
  harmonyOfflineApp: join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.app'),
  harmonyOnlineHap: join(privateRoot, 'SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap'),
  harmonyOnlineApp: join(privateRoot, 'SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app'),
  attachment: join(privateRoot, 'attachments/survival-diary-0.6.2-cross-platform-assets.zip'),
};

copyVerified(paths.iosSource, paths.ios);
copyVerified(paths.macSource, paths.mac);

const mirrored = [
  paths.android,
  paths.ios,
  paths.mac,
  paths.harmonyOfflineHap,
  paths.harmonyOfflineApp,
  paths.harmonyOnlineHap,
  paths.harmonyOnlineApp,
  paths.attachment,
];
for (const source of mirrored) {
  const relative = source.slice(privateRoot.length + 1);
  copyVerified(source, join(publicRoot, relative));
  writeSidecar(source);
  writeSidecar(join(publicRoot, relative));
}

copyVerified(paths.android, join(privateRoot, 'download/SurvivalDiary-Android-latest.apk'));
copyVerified(paths.android, join(publicRoot, 'download/SurvivalDiary-Android-latest.apk'));
copyVerified(paths.harmonyOfflineHap, join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.hap'));
copyVerified(paths.harmonyOfflineHap, join(publicRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.hap'));
copyVerified(paths.harmonyOfflineApp, join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.app'));
copyVerified(paths.harmonyOfflineApp, join(publicRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.app'));
for (const alias of [
  join(privateRoot, 'download/SurvivalDiary-Android-latest.apk'),
  join(publicRoot, 'download/SurvivalDiary-Android-latest.apk'),
  join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.hap'),
  join(publicRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.hap'),
  join(privateRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.app'),
  join(publicRoot, 'SurvivalDiary-HarmonyOS-Offline-latest.app'),
]) writeSidecar(alias);

const files = Object.fromEntries([
  ['android', artifact(paths.android)],
  ['ios', artifact(paths.ios)],
  ['mac', artifact(paths.mac)],
  ['harmonyOfflineHap', artifact(paths.harmonyOfflineHap)],
  ['harmonyOfflineApp', artifact(paths.harmonyOfflineApp)],
  ['harmonyOnlineHap', artifact(paths.harmonyOnlineHap)],
  ['harmonyOnlineApp', artifact(paths.harmonyOnlineApp)],
  ['attachment', artifact(paths.attachment)],
]);

const description = '《生存日记》是一款没有固定结局的开放式海岛生存游戏。探索迷雾与多地形，采集自然资源和矿物，制作工具，经营农业与工业，连接道路、铁路与船运，并与岛民共同建设持续发展的海岛生活。';
const commonNotes = [
  '六端统一加入游戏启动页，首次进入先看到继续游戏、新游戏和存档状态，不再直接掉进世界。',
  '恢复主操作与副操作层级；主操作会按场景显示使用、交谈、采集、拾取、进食或放置，减少按钮互相抢操作。',
  '新手引导改为可执行的短步骤，并补充继续游戏、重新开始和本地存档说明。',
  '修复移动端按钮过小、文字装不下、面板过胖以及窄屏布局拥挤的问题。',
  '修复首次启动时错误清除存档的情况；继续游戏会读取最近一次自动保存。',
  '网页缓存升级，确保 0.6.2 的界面与脚本不会继续命中旧版资源。',
  '窄轨轨段改用正确铁轨图标，单段重量从 12 kg 调整为 3 kg；新存档不再强塞两段铁轨到背包。',
  '铁轨端点改用连续直轨并适度重叠，减少斜轨、断缝和无法衔接；所有背包物品均可丢到角色脚边。',
];

function base(entry, version, build) {
  return {
    ...entry,
    product: 'survival-diary',
    category: '游戏',
    version,
    latestVersion: version,
    versionName: version,
    build,
    versionCode: build,
    available: true,
    pageURL: 'https://survival-diary.zhengzhengstudio.cn/',
    icon: 'https://survival-diary.zhengzhengstudio.cn/assets/icons/icon-192.png',
    description,
    notes: commonNotes,
    updatedAt: now,
  };
}

function updateEntry(entry) {
  if (entry.id === 'survival-diary-web') {
    return {
      ...base(entry, '0.6.2', 22),
      title: '生存日记 Web v0.6.2 build 22',
      remarks: '打开即玩并可安装为 PWA；网页端包含完整开放海岛、图鉴、设施、交通、动物、Kimi 岛民与公开岛入口。',
      blockedReason: '',
      url: 'https://survival-diary.zhengzhengstudio.cn/',
      versionedUrl: 'https://survival-diary.zhengzhengstudio.cn/',
      downloadURL: '',
      size: 0,
      fileSize: 0,
      sha256: '',
      checksum: '',
    };
  }
  if (entry.id === 'survival-diary-android') {
    const f = files.android;
    return {
      ...base(entry, '0.6.2', 45),
      artifactType: 'apk',
      title: '生存日记 Android 正式版 v0.6.2 build 45',
      remarks: '正式 Release APK，沿用既有发布证书，可覆盖升级；更新器按 version/build 识别，校验 SHA-256 后调用系统安装器。',
      blockedReason: '',
      signed: true,
      signing: 'android-release',
      debug: false,
      storeReady: true,
      distributionChannel: 'release',
      releaseChannel: 'release',
      updateEligible: true,
      directInstallSupported: true,
      latestBuild: 45,
      latestVersionCode: 45,
      fileName: 'SurvivalDiary-Android-v0.6.2-b45.apk',
      url: '/api/apps/download/SurvivalDiary-Android-latest.apk',
      latestUrl: '/api/apps/download/SurvivalDiary-Android-latest.apk',
      versionedUrl: '/api/apps/download/SurvivalDiary-Android-v0.6.2-b45.apk',
      downloadURL: '/api/apps/download/SurvivalDiary-Android-v0.6.2-b45.apk',
      size: f.size,
      fileSize: f.size,
      sha256: f.sha256,
      checksum: f.sha256,
    };
  }
  if (entry.id === 'survival-diary-ios') {
    const f = files.ios;
    return {
      ...base(entry, '0.6.2', 38),
      artifactType: 'ipa',
      title: '生存日记 iOS v0.6.2 build 38（未签名开发包）',
      remarks: '真实 arm64 IPA，供开发验证或使用匹配 Profile 重新签名；不是 App Store/TestFlight 正式包，不参与自动升级。',
      blockedReason: '缺少匹配包名的 Apple Distribution Profile；普通 iPhone 不能直接安装此未签名 IPA。',
      signed: false,
      signing: 'unsigned-debug',
      debug: true,
      storeReady: false,
      distributionChannel: 'debug',
      updateEligible: false,
      directInstallSupported: false,
      requiresResigning: true,
      fileName: 'SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa',
      url: '/api/apps/download/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa',
      latestUrl: '/api/apps/download/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa',
      versionedUrl: '/api/apps/download/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa',
      downloadURL: '/api/apps/download/SurvivalDiary-iOS-v0.6.2-b38-debug-unsigned.ipa',
      size: f.size,
      fileSize: f.size,
      sha256: f.sha256,
      checksum: f.sha256,
    };
  }
  if (entry.id === 'survival-diary-macos') {
    const f = files.mac;
    return {
      ...base(entry, '0.6.2', 38),
      artifactType: 'zip',
      title: '生存日记 macOS v0.6.2 build 38（未签名开发包）',
      remarks: '真实 x86_64 .app 压缩包，供开发验证；未使用 Developer ID 签名且未公证，不参与系统安装器自动升级。',
      blockedReason: '正式分发需要 Developer ID Application 签名、公证与装订。',
      signed: false,
      signing: 'unsigned-debug',
      debug: true,
      storeReady: false,
      distributionChannel: 'debug',
      updateEligible: false,
      directInstallSupported: false,
      requiresResigning: true,
      fileName: 'SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip',
      url: '/api/apps/download/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip',
      latestUrl: '/api/apps/download/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip',
      versionedUrl: '/api/apps/download/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip',
      downloadURL: '/api/apps/download/SurvivalDiary-macOS-v0.6.2-b38-debug-unsigned.zip',
      size: f.size,
      fileSize: f.size,
      sha256: f.sha256,
      checksum: f.sha256,
    };
  }
  if (entry.id === 'survival-diary-harmony-online') {
    const hap = files.harmonyOnlineHap;
    const app = files.harmonyOnlineApp;
    return {
      ...base(entry, '0.6.2', 60204),
      artifactType: 'hap',
      title: '生存日记 HarmonyOS 联机版 v0.6.2 build 60204（未签名 Debug）',
      remarks: 'HAP 与 APP 由本轮 Hvigor Debug 真实构建；供 DevEco 验证或重新签名，不作为可直接安装更新。',
      blockedReason: '缺少匹配 cn.zhengzhengstudio.survivaldiary.hmos 的联网版 Profile。',
      signed: false,
      signing: 'unsigned-debug',
      debug: true,
      storeReady: false,
      distributionChannel: 'debug',
      updateEligible: false,
      directInstallSupported: false,
      requiresResigning: true,
      fileName: 'SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap',
      url: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap',
      latestUrl: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap',
      versionedUrl: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap',
      downloadURL: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.hap',
      size: hap.size,
      fileSize: hap.size,
      sha256: hap.sha256,
      checksum: hap.sha256,
      appFileName: 'SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app',
      appUrl: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app',
      appLatestUrl: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app',
      appVersionedUrl: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app',
      appDownloadURL: '/api/apps/SurvivalDiary-HarmonyOS-Online-v0.6.2-b60204-unsigned-debug.app',
      appSize: app.size,
      appSha256: app.sha256,
    };
  }
  if (entry.id === 'survival-diary-harmony-offline') {
    const hap = files.harmonyOfflineHap;
    const app = files.harmonyOfflineApp;
    return {
      ...base(entry, '0.6.2', 60203),
      artifactType: 'hap',
      title: '生存日记 HarmonyOS 单机版 v0.6.2 build 60203 正式签名版',
      remarks: '纯本地版不申请网络权限；HAP 使用华为 Release Profile 正式签名，APP 用于 AppGallery 上架。',
      blockedReason: '',
      signed: true,
      signing: 'huawei-release',
      debug: false,
      storeReady: true,
      distributionChannel: 'release',
      releaseChannel: 'release',
      updateEligible: false,
      directInstallSupported: false,
      fileName: 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.hap',
      url: '/api/apps/SurvivalDiary-HarmonyOS-Offline-latest.hap',
      latestUrl: '/api/apps/SurvivalDiary-HarmonyOS-Offline-latest.hap',
      versionedUrl: '/api/apps/SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.hap',
      downloadURL: '/api/apps/SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.hap',
      size: hap.size,
      fileSize: hap.size,
      sha256: hap.sha256,
      checksum: hap.sha256,
      appFileName: 'SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.app',
      appUrl: '/api/apps/SurvivalDiary-HarmonyOS-Offline-latest.app',
      appLatestUrl: '/api/apps/SurvivalDiary-HarmonyOS-Offline-latest.app',
      appVersionedUrl: '/api/apps/SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.app',
      appDownloadURL: '/api/apps/SurvivalDiary-HarmonyOS-Offline-v0.6.2-b60203.app',
      appSize: app.size,
      appSha256: app.sha256,
    };
  }
  if (entry.id === 'survival-diary-android-play') {
    return {
      ...base(entry, '0.6.2', 45),
      available: false,
      title: '生存日记 Android 应用市场版 v0.6.2 build 45',
      remarks: '源码功能已与官网正式版对齐；尚未生成应用市场专用 AAB 和上传签名包。',
      blockedReason: '尚未配置应用市场上传签名与商店链接。',
      fileName: '', url: '', latestUrl: '', versionedUrl: '', downloadURL: '',
      size: 0, fileSize: 0, sha256: '', checksum: '',
    };
  }
  return entry;
}

const attachment = {
  id: 'survival-diary-062-cross-platform-assets',
  product: 'survival-diary',
  kind: 'attachment',
  artifactType: 'attachment',
  installable: false,
  version: '0.6.2',
  latestVersion: '0.6.2',
  title: '《生存日记》0.6.2 全端上架与素材包',
  description: '包含无透明留白的 1024×1024 正式商店图标、交通/设施/动物/地形 PNG、全端共享玩法 JSON、上架简介、短文案和功能对齐矩阵；这是附件，不是客户端。',
  fileName: 'survival-diary-0.6.2-cross-platform-assets.zip',
  url: '/api/apps/attachments/survival-diary-0.6.2-cross-platform-assets.zip',
  downloadURL: '/api/apps/attachments/survival-diary-0.6.2-cross-platform-assets.zip',
  size: files.attachment.size,
  sha256: files.attachment.sha256,
  updatedAt: now,
};

const updated = [];
for (const path of documents) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.updatedAt = now;
  data.generatedAt = now;
  data.apps = data.apps.map(updateEntry);
  data.attachments = [...(data.attachments || []).filter((item) => item.product !== 'survival-diary'), attachment];
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  JSON.parse(readFileSync(temporary, 'utf8'));
  renameSync(temporary, path);
  updated.push(data);
}

const ids = [
  'survival-diary-web',
  'survival-diary-android',
  'survival-diary-android-play',
  'survival-diary-ios',
  'survival-diary-macos',
  'survival-diary-harmony-online',
  'survival-diary-harmony-offline',
];
for (const id of ids) {
  const variants = updated.map((data) => JSON.stringify(data.apps.find((entry) => entry.id === id)));
  if (variants.some((value) => value !== variants[0])) throw new Error(`四份清单不一致：${id}`);
}
const attachmentVariants = updated.map((data) => JSON.stringify(data.attachments.find((item) => item.id === attachment.id)));
if (attachmentVariants.some((value) => value !== attachmentVariants[0])) throw new Error('四份清单素材附件不一致');

console.log(JSON.stringify({ now, files, updated: ids, attachment: attachment.id }, null, 2));
