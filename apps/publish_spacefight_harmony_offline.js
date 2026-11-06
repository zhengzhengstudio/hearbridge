#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseIdentity = JSON.parse(fs.readFileSync(path.join(root, 'SpaceFight-Cocos/package.json'), 'utf8'));
const version = releaseIdentity.version;
const build = releaseIdentity.build;
// HarmonyOS is moving to a new AppGallery identity in this release. Keep the
// already verified Android package on its current release until it is rebuilt.
const androidVersion = '0.10.21';
const androidBuild = 40;
const updatedAt = new Date().toISOString();
const bundleIdentifier = 'cn.zhengzhengstudio.spacefight.huawei';
const buildOutput = path.join(root, 'SpaceFight-Cocos/native-build/artifacts');
const marketing = path.join(root, 'apps/build_output/SpaceFight/marketing');
const appIcon = path.join(root, 'website/spacefight.zhengzhengstudio.cn/spacefight-icon.aa21e.png');
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];

const artifacts = [
  {
    id: 'spacefight-android',
    platform: 'android',
    platformLabel: 'Android',
    artifactType: 'apk',
    version: androidVersion,
    build: androidBuild,
    source: path.join(buildOutput, `SpaceFight-Android-v${androidVersion}.apk`),
    versionedName: `SpaceFight-Android-v${androidVersion}.apk`,
    latestName: 'SpaceFight-Android-latest.apk',
    name: 'SpaceFight Android',
    title: `SpaceFight Android v${androidVersion} build ${androidBuild}`,
    description: 'Cocos Creator 原生横屏空战客户端，包含本机单机战斗与原生更新器。',
    remarks: 'Release APK；使用现有 Cocos 证书签名，应用内检查并下载更新，不跳转浏览器。',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight',
    minimumSystem: 'Android 7.0（64 位）',
    signing: 'cocos-existing-certificate',
    storeReady: false,
    notes: [
      `${androidVersion} build ${androidBuild}：镜头视线、准星与主武器弹道使用同一瞄准解算，消除发射方向漂移。`,
      '飞船 GLB 新增主副武器、导弹、引擎与第一/第三人称相机挂点，炮弹从模型炮口发射。',
      '战斗 HUD 支持简体中文、繁体中文、英语、日语、韩语、西班牙语、巴西葡萄牙语和法语。',
      '应用内更新改为原生发布面板，并继续由系统下载与安装组件完成安全更新。',
      '支持 Android 7.0 及以上 64 位设备；弱性能设备仍可使用低画质资源。',
    ],
  },
  {
    id: 'spacefight-harmonyos-offline',
    artifactType: 'hap',
    source: path.join(buildOutput, `SpaceFight-HarmonyOS-Offline-v${version}.hap`),
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    name: 'SpaceFight Offline HarmonyOS HAP',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    description: '使用 HarmonyOS Release Profile 签名的纯单机原生 HAP，供签名核验与受信任分发使用。',
    remarks: 'Release HAP 不能通过 hdc 或网页直接侧载；实机 Release 测试需经 AppGallery 测试分发并由华为重签。',
    directInstallSupported: false,
    storeReady: false,
  },
  {
    id: 'spacefight-harmonyos-offline-app',
    artifactType: 'app',
    source: path.join(buildOutput, `SpaceFight-HarmonyOS-Offline-v${version}.app`),
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.app`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    name: 'SpaceFight Offline HarmonyOS APP',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}（AppGallery 上架包）`,
    description: '使用 AppGallery Release Profile 和正式证书签名的 HarmonyOS APP 上架包。',
    remarks: 'AppGallery 正式上架包；Release Profile、证书链、包名和文件摘要均已校验。',
    storeReady: true,
  },
];

const notes = [
  `${version} build ${build}：镜头视线、准星与主武器弹道使用同一瞄准解算，消除发射方向漂移。`,
  '飞船 GLB 新增主副武器、导弹、引擎与第一/第三人称相机挂点，炮弹从模型炮口发射。',
  '战斗 HUD 支持简体中文、繁体中文、英语、日语、韩语、西班牙语、巴西葡萄牙语和法语。',
  '保留高低两套正式飞船资源，并继续支持弱性能设备的低画质降级。',
  'HAP、APP 和 APP 内层 HAP 校验 Release Profile、代码签名和 cn.zhengzhengstudio.spacefight.huawei 包名。',
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copy(source, destination) {
  const destinationDirectory = path.dirname(destination);
  const destinationName = path.basename(destination);
  const extension = path.extname(destinationName);
  const stem = destinationName.slice(0, -extension.length);
  const placeholder = path.join(
    destinationDirectory,
    `.${path.basename(destination)}.icloud`,
  );
  fs.rmSync(placeholder, { force: true });
  fs.rmSync(destination, { force: true });
  for (const name of fs.readdirSync(destinationDirectory)) {
    if (new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+${extension.replace('.', '\\.')}$`).test(name)) {
      fs.rmSync(path.join(destinationDirectory, name), { force: true });
    }
  }
  fs.copyFileSync(source, destination);
}

// 缺少本地产物的条目必须跳过，而不是让整个脚本崩掉。
//
// 背景：本脚本列出的产物并非每次都重新构建。2026-10-11 只重建了 HarmonyOS 离线版，
// `native-build/artifacts/` 里的 Android apk 早已被 iCloud 清成 .icloud 占位
// （服务器上其实还留着已发布的 0.11.18）。原实现直接 statSync 会 ENOENT 整体失败，
// 导致「只想发鸿蒙」这件事都做不成。
//
// 跳过是安全的：下面合并 manifest 时用
// `metadata.apps.filter((entry) => !releaseIds.has(entry.id))` 保留了
// 服务器上已发布的那一条，跳过的条目不会被覆盖、也不会被误删。
// 只有真正要发某个平台时，才必须先把它的产物构建出来放进 artifacts/。
const availableArtifacts = artifacts.filter((artifact) => {
  if (fs.existsSync(artifact.source)) return true;
  process.stderr.write(
    `跳过缺失的本地产物（服务器上已有其已发布版本，将保持不变）：${path.basename(artifact.source)}\n`,
  );
  return false;
});

function metadataEntry(artifact) {
  const size = fs.statSync(artifact.source).size;
  const checksum = sha256(artifact.source);
  const artifactVersion = artifact.version || version;
  const artifactBuild = artifact.build || build;
  return {
    id: artifact.id,
    name: artifact.name,
    platform: artifact.platform || 'harmonyos',
    platformLabel: artifact.platformLabel || 'HarmonyOS',
    kind: 'package',
    artifactType: artifact.artifactType,
    product: 'spacefight',
    category: '游戏',
    ...(artifact.platform === 'android' ? {} : { variant: 'offline', variantLabel: '单机版' }),
    version: artifactVersion,
    latestVersion: artifactVersion,
    versionName: artifactVersion,
    build: artifactBuild,
    versionCode: artifactBuild,
    signed: true,
    signing: artifact.signing || 'huawei-release',
    debug: false,
    releaseChannel: 'release',
    storeReady: artifact.storeReady,
    ...(artifact.directInstallSupported === undefined ? {} : {
      directInstallSupported: artifact.directInstallSupported,
    }),
    fileName: artifact.versionedName,
    url: `/api/apps/${artifact.latestName}`,
    latestUrl: `/api/apps/${artifact.latestName}`,
    versionedUrl: `/api/apps/${artifact.versionedName}`,
    downloadURL: `/api/apps/${artifact.versionedName}`,
    pageURL: 'https://spacefight.zhengzhengstudio.cn/',
    icon: '/api/apps/SpaceFight-icon.png',
    ...(artifact.platform === 'android' ? {} : {
      promoImageURL: '/api/apps/SpaceFight-HarmonyOS-Offline-promo-1920x1080.png',
      storeCopyURL: '/api/apps/SpaceFight-HarmonyOS-Offline-AppGallery-copy-zh-CN.md',
    }),
    bundleIdentifier: artifact.bundleIdentifier || bundleIdentifier,
    minimumSystem: artifact.minimumSystem || 'HarmonyOS 4.0 / 5.0 / 6.0',
    minSystem: artifact.minimumSystem || 'HarmonyOS 4.0 / 5.0 / 6.0',
    description: artifact.description,
    remarks: artifact.remarks,
    notes: artifact.notes || notes,
    title: artifact.title,
    size,
    fileSize: size,
    sha256: checksum,
    checksum,
    updatedAt,
  };
}

const entries = availableArtifacts.map(metadataEntry);
const releaseIds = new Set(entries.map((entry) => entry.id));
releaseIds.add('spacefight-harmonyos');
const marketingFiles = [
  ['SpaceFight-HarmonyOS-Offline-promo-1920x1080.png', 'SpaceFight-HarmonyOS-Offline-promo-1920x1080.png'],
  ['spacefight-harmonyos-offline-key-art-1920x1080.png', 'SpaceFight-HarmonyOS-Offline-key-art-1920x1080.png'],
  ['AppGallery-copy-zh-CN.md', 'SpaceFight-HarmonyOS-Offline-AppGallery-copy-zh-CN.md'],
];

for (const appRoot of appRoots) {
  fs.mkdirSync(appRoot, { recursive: true });
  for (const artifact of availableArtifacts) {
    copy(artifact.source, path.join(appRoot, artifact.versionedName));
    copy(artifact.source, path.join(appRoot, artifact.latestName));
  }
  copy(appIcon, path.join(appRoot, 'SpaceFight-icon.png'));
  for (const [sourceName, destinationName] of marketingFiles) {
    const source = path.join(marketing, sourceName);
    if (!fs.existsSync(source)) {
      process.stderr.write(`跳过缺失的可选营销素材：${sourceName}\n`);
      continue;
    }
    copy(source, path.join(appRoot, destinationName));
  }

  for (const fileName of ['manifest.json', 'client-downloads.json']) {
    const file = path.join(appRoot, fileName);
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    metadata.apps = [
      ...entries,
      ...metadata.apps.filter((entry) => !releaseIds.has(entry.id)),
    ];
    metadata.updatedAt = updatedAt;
    metadata.generatedAt = updatedAt;
    fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
  }
}

const websitePromo = path.join(
  root,
  'website/spacefight.zhengzhengstudio.cn/assets/store/spacefight-harmonyos-offline-promo-1920x1080.png',
);
copy(path.join(marketing, 'SpaceFight-HarmonyOS-Offline-promo-1920x1080.png'), websitePromo);

for (const entry of entries) {
  process.stdout.write(`${entry.fileName}\t${entry.size}\t${entry.sha256}\n`);
}

const { validateDistributionRoots } = require('../SpaceFight-Cocos/tools/release-distribution-policy');
validateDistributionRoots(appRoots, {
  checksums: true,
  entryIds: entries.map((entry) => entry.id),
});
process.stdout.write('SpaceFight 双根清单、下载索引、包名与文件摘要校验通过。\n');
