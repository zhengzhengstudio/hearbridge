import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.0';
const build = 44;
const source = path.join(root, 'SpaceFight-Cocos/native-build/artifacts/SpaceFight-Android-v0.11.0.apk');
const versionedName = `SpaceFight-Android-v${version}.apk`;
const latestName = 'SpaceFight-Android-latest.apk';
const expectedSize = 24503432;
const expectedSha256 = 'cf90abd1b542468541d1adac25dce0a341702ebdc0bb3a1cd4e941b35bfad2d6';
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

const notes = [
  `${version} build ${build}：增加原生手柄控制、死区调整与中心漂移校准。`,
  '原生启动后先进入前哨大厅，机库、货舱、设置和三条行动路线可用，不再直接开战。',
  '修复 Cocos 原生 document shim 没有 dataset 时输入路由崩溃、应用停在启动界面的问题。',
  '保留原生应用内更新器，更新 APK 由系统安装器打开，不跳转浏览器。',
  'Release APK 已通过包名、版本、arm64 ABI、v1/v2 签名、包内修复代码和 SHA-256 校验。',
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (!fs.existsSync(source)) throw new Error(`Missing Android release: ${source}`);
if (fs.statSync(source).size !== expectedSize) throw new Error(`Unexpected Android release size: ${fs.statSync(source).size}`);
if (sha256(source) !== expectedSha256) throw new Error(`Unexpected Android release SHA-256: ${sha256(source)}`);

for (const appRoot of appRoots) {
  fs.copyFileSync(source, path.join(appRoot, versionedName));
  fs.copyFileSync(source, path.join(appRoot, latestName));

  for (const metadataName of metadataNames) {
    const file = path.join(appRoot, metadataName);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = document.apps.find(candidate => candidate.id === 'spacefight-android');
    if (!entry) throw new Error(`Missing spacefight-android in ${file}`);
    document.updatedAt = localIso;
    document.generatedAt = localIso;
    Object.assign(entry, {
      version,
      latestVersion: version,
      versionName: version,
      build,
      versionCode: build,
      artifactType: 'apk',
      fileName: versionedName,
      url: `/api/apps/${latestName}`,
      latestUrl: `/api/apps/${latestName}`,
      versionedUrl: `/api/apps/${versionedName}`,
      downloadURL: `/api/apps/${versionedName}`,
      title: `SpaceFight Android v${version} build ${build}`,
      description: 'Cocos Creator 原生横屏空战客户端，含前哨大厅、装配台、货舱、本机远征和原生更新器。',
      remarks: 'Release APK；使用现有 Cocos 证书签名，应用内检查下载更新，不跳转浏览器。',
      notes,
      size: expectedSize,
      fileSize: expectedSize,
      sha256: expectedSha256,
      checksum: expectedSha256,
      updatedAt: iso,
    });
    writeJson(file, document);
  }
}

const changelogFiles = [
  path.join(root, 'website/api/data/changelogs.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'),
];
const changelogId = '2026-08-29-spacefight-0110-android-release';
const changelogEntry = {
  id: changelogId,
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: `SpaceFight Android ${version}：前哨大厅与原生手柄`,
  content: `SpaceFight Android 更新至 ${version} build ${build}。原生 App 启动后先进入前哨大厅，机库、货舱、设置和三条行动路线可用；加入手柄飞行、瞄准、开火、视角切换、暂停、死区和漂移校准。修复 Cocos 原生 document shim 缺少 dataset 导致输入初始化失败、应用停在启动界面的问题。APK 保留原生更新器，已通过版本、arm64 ABI、v1/v2 签名、包内修复代码和 SHA-256 校验。`,
  version,
  build,
  platforms: ['android'],
};

for (const file of changelogFiles) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existingIndex = document.findIndex(item => item.id === changelogId);
  if (existingIndex >= 0) document.splice(existingIndex, 1);
  document.unshift(changelogEntry);
  writeJson(file, document);
}

process.stdout.write(`Published SpaceFight Android ${version} build ${build} to both download roots.\n`);
