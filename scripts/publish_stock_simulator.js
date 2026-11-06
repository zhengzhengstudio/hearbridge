#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { updateStockReleaseEntry } = require('./lib/stock_release');

const root = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const version = args.version || '1.2.0';
const androidBuild = Number(args['android-build'] || 11);
const harmonyBuild = Number(args['harmony-build'] || 1002000);

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function localIsoNow() {
  const now = new Date();
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now).replace(' ', 'T') + '+08:00';
}

const sources = {
  android: path.resolve(args.android || path.join(root, 'StockSimulatorApps/ZhengZhengStockAndroid/app/build/outputs/apk/debug/app-debug.apk')),
  harmonyos: path.resolve(args.harmony || path.join(root, 'StockSimulatorApps/ZhengZhengStockHarmony/entry/build/default/outputs/default/entry-default-unsigned.hap')),
};
for (const [platform, source] of Object.entries(sources)) {
  if (!fs.existsSync(source)) throw new Error(`Missing ${platform} artifact: ${source}`);
}

const artifacts = {
  android: {
    platform: 'android', version, build: androidBuild, source: sources.android,
    fileName: `ZhengZhengStock-Android-v${version}-debug.apk`,
    latestName: 'ZhengZhengStock-Android-latest.apk',
  },
  harmonyos: {
    platform: 'harmonyos', version, build: harmonyBuild, source: sources.harmonyos,
    fileName: `ZhengZhengStock-HarmonyOS-v${version}-unsigned.hap`,
    latestName: 'ZhengZhengStock-HarmonyOS-latest-unsigned.hap',
  },
};
const updatedAt = localIsoNow();
for (const artifact of Object.values(artifacts)) {
  artifact.size = fs.statSync(artifact.source).size;
  artifact.sha256 = digest(artifact.source);
  artifact.updatedAt = updatedAt;
}

const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
for (const appRoot of appRoots) {
  for (const artifact of Object.values(artifacts)) {
    fs.copyFileSync(artifact.source, path.join(appRoot, artifact.fileName));
    fs.copyFileSync(artifact.source, path.join(appRoot, artifact.latestName));
  }
}

const downloadDir = path.join(os.homedir(), 'Downloads');
for (const artifact of Object.values(artifacts)) {
  fs.copyFileSync(artifact.source, path.join(downloadDir, artifact.fileName));
}

const manifests = [
  'website/api/apps/manifest.json',
  'website/api/apps/client-downloads.json',
  'website/zhengzhengstudio.cn/api/apps/manifest.json',
  'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
  'website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json',
  'website/zhengzhengstudio.cn/api/boardgames/manifest.json',
];
for (const relativeFile of manifests) {
  const file = path.join(root, relativeFile);
  if (!fs.existsSync(file)) continue;
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const artifact of Object.values(artifacts)) updateStockReleaseEntry(document, artifact);
  writeJson(file, document);
}

const changelog = {
  id: '2026-08-31-stock-simulator-native-120',
  date: updatedAt,
  type: 'release',
  product: '铮铮模拟炒股',
  title: '铮铮模拟炒股 1.2.0：Android 与 HarmonyOS 行情和交易台重做',
  content: 'Android 与 HarmonyOS 原生客户端升级至 1.2.0。两端接入服务器行情，支持真实优先、真实+仿真和纯仿真模式；网络异常或闭市时继续使用内部引擎补帧。修复服务器行情代理偶发截断 JSON 的问题，客户端现在会显示格式错误并明确回退本地连续仿真。Android 移除不必要的安装包权限，降低系统风险告警。Android 股票列表改为可复用原生列表，解决 500 多只股票持续刷新导致的卡顿，并适配手机和平板布局。HarmonyOS 修复暗色模式可读性、窄屏操作区溢出和指数不可见问题。同一通行证仍绑定 A股、港股、美股三个独立账户，保留原生交易和应用内更新。',
  version,
  platforms: ['android', 'harmonyos'],
};
for (const relativeFile of ['website/api/data/changelogs.json', 'website/zhengzhengstudio.cn/api/changelogs.json']) {
  const file = path.join(root, relativeFile);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const oldIndex = document.findIndex((entry) => entry.id === changelog.id);
  if (oldIndex >= 0) document.splice(oldIndex, 1);
  document.unshift(changelog);
  writeJson(file, document);
}

process.stdout.write(`Published ZhengZhengStock ${version}: Android ${artifacts.android.size} bytes, HarmonyOS ${artifacts.harmonyos.size} bytes.\n`);
