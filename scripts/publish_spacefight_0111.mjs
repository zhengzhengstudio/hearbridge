import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.1';
const build = 45;
const artifactRoot = path.join(root, 'SpaceFight-Cocos/native-build/artifacts');
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

const candidates = [
  {
    id: 'spacefight-android',
    artifactType: 'apk',
    versionedName: `SpaceFight-Android-v${version}.apk`,
    latestName: 'SpaceFight-Android-latest.apk',
    expectedSize: 30138271,
    expectedSha256: '103d9514cbaf0798f685c518de438af7d1a3bc31121b1be0b03d73393a56a906',
    title: `SpaceFight Android v${version} build ${build}`,
    notes: [
      `${version} build ${build}：修复机体归零后画面静止但仍能暂停的伪卡死，新增失败结算、重新出击和返回前哨。`,
      '加入 SpaceFight 原生品牌启动层、可停留前哨大厅、三条行动路线和完整战备装配台。',
      '触控死区降至 3%，瞄准满量滑动距离缩短，摇杆和主副武器按下反馈重新区分。',
      '保留原生应用内更新器，更新 APK 由系统安装器处理，不把 App 跳转成网页。',
      'Release APK 已通过包名、版本、arm64 ABI、v1/v2 签名、包内代码和 SHA-256 校验。',
    ],
  },
  {
    id: 'spacefight-harmonyos-offline',
    artifactType: 'hap',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.hap`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.hap',
    expectedSize: 36085628,
    expectedSha256: '750de18d1b42a06334f2c58791bef6f2352cd53edf9ac6d73be3c42be88875a8',
    title: `SpaceFight Offline HarmonyOS HAP v${version} build ${build}`,
    notes: [
      `${version} build ${build}：同步失败结算、原生前哨大厅、触控调校和 56 项装配选择。`,
      '单机版不要求通行证，也不声明 INTERNET 或网络状态权限。',
      'Release HAP 使用 cn.zhengzhengstudio.spacefight.huawei 对应的华为发布 Profile 签名。',
    ],
  },
  {
    id: 'spacefight-harmonyos-offline-app',
    artifactType: 'app',
    versionedName: `SpaceFight-HarmonyOS-Offline-v${version}.app`,
    latestName: 'SpaceFight-HarmonyOS-Offline-latest.app',
    expectedSize: 36101672,
    expectedSha256: '6357e84f70443033b42c2d6e94230670c4f16f83e0819d21ba89f6d14666fa51',
    title: `SpaceFight Offline HarmonyOS APP v${version} build ${build}（AppGallery 上架包）`,
    notes: [
      `${version} build ${build}：同步失败结算、原生前哨大厅、触控调校和 56 项装配选择。`,
      '单机版不要求通行证，也不声明 INTERNET 或网络状态权限。',
      '外层 APP 与内层 HAP 均须通过 Release Profile、证书链、包名和 SHA-256 校验。',
    ],
  },
  {
    id: 'spacefight-macos',
    artifactType: 'dmg',
    versionedName: `SpaceFight-macOS-v${version}-debug.dmg`,
    latestName: 'SpaceFight-macOS-latest-debug.dmg',
    expectedSize: 56262449,
    expectedSha256: '2727726bc1eccecb4acc2b3f744e5486f064151e94ab6375d60101ecadc7f559',
    title: `SpaceFight macOS v${version} build ${build}（Ad-hoc 调试版）`,
    metadata: {
      platform: 'macos',
      platformLabel: 'macOS',
      signed: true,
      signing: 'ad-hoc',
      debug: true,
      releaseChannel: 'debug',
      storeReady: false,
      minimumSystem: 'macOS 11.0',
      minSystem: 'macOS 11.0',
      bundleIdentifier: 'cn.zhengzhengstudio.spacefight',
      description: 'Cocos Creator 原生 macOS 客户端调试包，包含与网页、Android 和 HarmonyOS 同批的前哨大厅、装配与战斗逻辑。',
      remarks: '已通过本机深度签名和 DMG 校验；未使用 Developer ID、未公证，不作为 Mac App Store 或正式渠道包。',
    },
    notes: [
      `${version} build ${build}：同步失败结算、前哨大厅、装配台、键鼠和手柄输入。`,
      '应用为 Cocos 原生 macOS 构建，不嵌入网站或 WebView。',
      '当前仅使用 Ad-hoc 签名；缺少 Developer ID 与公证条件，因此下载中心明确标记为调试版。',
    ],
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const releases = candidates.flatMap((candidate) => {
  const source = path.join(artifactRoot, candidate.versionedName);
  if (!fs.existsSync(source)) return [];
  const size = fs.statSync(source).size;
  const digest = sha256(source);
  if (candidate.expectedSize && size !== candidate.expectedSize) {
    throw new Error(`Unexpected size for ${source}: ${size}`);
  }
  if (candidate.expectedSha256 && digest !== candidate.expectedSha256) {
    throw new Error(`Unexpected SHA-256 for ${source}: ${digest}`);
  }
  return [{ ...candidate, source, size, digest }];
});

if (!releases.some((release) => release.id === 'spacefight-android')) {
  throw new Error('The verified Android 0.11.1 release is required.');
}

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
        version,
        latestVersion: version,
        versionName: version,
        build,
        versionCode: build,
        artifactType: release.artifactType,
        fileName: release.versionedName,
        url: `/api/apps/${release.latestName}`,
        latestUrl: `/api/apps/${release.latestName}`,
        versionedUrl: `/api/apps/${release.versionedName}`,
        downloadURL: `/api/apps/${release.versionedName}`,
        title: release.title,
        notes: release.notes,
        size: release.size,
        fileSize: release.size,
        sha256: release.digest,
        checksum: release.digest,
        updatedAt: iso,
      }, release.metadata || {});
    }
    writeJson(file, document);
  }
}

const platforms = ['web', ...new Set(releases.map((release) => {
  if (release.id.startsWith('spacefight-harmonyos')) return 'harmonyos';
  if (release.id === 'spacefight-macos') return 'macos';
  return 'android';
}))];
const changelogEntry = {
  id: '2026-08-30-spacefight-0111-release',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: `SpaceFight ${version}：失败结算、前哨大厅与手机横屏修复`,
  content: `SpaceFight 网页与已完成构建的平台更新至 ${version} build ${build}。修复战机机体与护盾归零后模拟停止、画面却没有结算层而被误认为卡死的问题，加入重新出击和返回前哨；原生端增加品牌启动层与可停留大厅，装配扩充到 56 项。网页手机横屏修复旧单列规则与新三列大厅冲突，844×390 下导航、任务板和底部出击栏均保持在安全区。Android Release APK 与 HarmonyOS Release HAP/APP 已通过各自签名和包结构校验；macOS 提供经过 DMG 与 Ad-hoc 签名校验的原生调试版，并明确标记为非公证渠道包。`,
  version,
  build,
  platforms,
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

process.stdout.write(`Published SpaceFight ${version} build ${build}: ${releases.map((release) => release.id).join(', ')}\n`);
