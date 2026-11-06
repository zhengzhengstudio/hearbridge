import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.3';
const build = 47;
const size = 56_461_658;
const sha256 = 'ab1c8f018cc7f27ce26df52621282e5f2224fbcfa9750ccc227a7955fdf91793';
const source = path.join(root, `SpaceFight-Cocos/native-build/artifacts/SpaceFight-Android-v${version}.apk`);
const versionedName = `SpaceFight-Android-v${version}.apk`;
const latestName = 'SpaceFight-Android-latest.apk';
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

const notes = [
  `${version} build ${build}：新增更完整的前哨空间站结构、双环旋转、停靠臂与信标动画。`,
  '行动、机库和前哨页面加入三套原创 1920x1080 场景画面，并使用淡入切换和标题动效。',
  'Android 应用内更新改为四路分段下载，在应用顶部持续显示进度；不支持分段时自动降级为单路下载。',
  '下载完成后校验文件大小和 SHA-256，再交给系统安装器，不跳转浏览器。',
  'Release APK 已完成包名、版本、arm64 ABI、V1/V2/V3 签名、包内资源和摘要检查；本批次未连接 Android 设备运行验证。',
];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (!fs.existsSync(source)) throw new Error(`Missing Android release: ${source}`);
if (fs.statSync(source).size !== size) throw new Error(`Unexpected Android release size: ${fs.statSync(source).size}`);
if (digest(source) !== sha256) throw new Error(`Unexpected Android release SHA-256: ${digest(source)}`);

for (const appRoot of appRoots) {
  fs.copyFileSync(source, path.join(appRoot, versionedName));
  fs.copyFileSync(source, path.join(appRoot, latestName));
  for (const metadataName of metadataNames) {
    const file = path.join(appRoot, metadataName);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = document.apps.find((candidate) => candidate.id === 'spacefight-android');
    if (!entry) throw new Error(`Missing spacefight-android in ${file}`);
    document.updatedAt = localIso;
    document.generatedAt = localIso;
    Object.assign(entry, {
      version, latestVersion: version, versionName: version, build, versionCode: build,
      artifactType: 'apk', fileName: versionedName,
      url: `/api/apps/${latestName}`, latestUrl: `/api/apps/${latestName}`,
      versionedUrl: `/api/apps/${versionedName}`,
      downloadURL: `/api/apps/${versionedName}`,
      title: `SpaceFight Android v${version} build ${build}`,
      description: 'Cocos Creator 原生横屏空战客户端，包含动态前哨空间站、机库装配台、本机远征和应用内分段更新。',
      remarks: 'Release APK；沿用既有证书签名，应用内四路下载更新，不跳转浏览器。',
      notes, size, fileSize: size, sha256, checksum: sha256, updatedAt: iso,
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '未连接 Android 设备验证',
    });
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-08-30-spacefight-0113-android-release',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight Android 0.11.3：动态空间站与应用内分段更新',
  content: 'SpaceFight Android 更新至 0.11.3 build 47。战场加入更完整的前哨空间站、双环旋转、停靠臂和信标动画；行动、机库与前哨页面接入三套原创全高清场景画面和过渡动效。应用内更新改为四路分段下载，并在应用顶部显示进度；服务器不支持分段时自动降级，完成后校验大小与 SHA-256，再交给系统安装器。APK 已完成构建、版本、arm64、签名和包内资源检查，本批次未连接 Android 设备运行验证。',
  version,
  build,
  platforms: ['android'],
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

process.stdout.write(`Published SpaceFight Android ${version} build ${build} to both download roots.\n`);
