import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.6';
const build = 50;
const source = path.join(root, `SpaceFight-Cocos/native-build/artifacts/SpaceFight-Android-v${version}.apk`);
const versionedName = `SpaceFight-Android-v${version}.apk`;
const latestName = 'SpaceFight-Android-latest.apk';
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

if (!fs.existsSync(source)) throw new Error(`Missing Android release: ${source}`);
const size = fs.statSync(source).size;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const notes = [
  `${version} build ${build}：降低全部敌机的追击速度、威胁成长和射击频率，让目标保持在可瞄准范围。`,
  '战场新增低概率敌对阵营内战；敌机可锁定并伤害另一阵营，互击不会伪造成玩家命中或错误发放玩家分数。',
  '新增离子扰动和应急补给随机事件，事件由固定种子驱动，暂停时同步冻结并可重复测试。',
  '玩家命中加入更亮、更大且持续更清晰的 3D 冲击与准星反馈，震动只响应玩家自己的命中和击毁。',
  '恢复六类标准路径高画质飞船资源，避免 iCloud 占位符导致高配资源缺失。',
  '应用展示名保持 SpaceFight，包名保持 cn.zhengzhengstudio.spacefight；本批次未连接 Windows 或 Android 设备，未完成设备运行验证。',
];

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyRelease(sourceFile, destination) {
  const cloudPlaceholder = path.join(path.dirname(destination), `.${path.basename(destination)}.icloud`);
  if (fs.existsSync(cloudPlaceholder)) fs.rmSync(cloudPlaceholder);
  fs.copyFileSync(sourceFile, destination);
}

for (const appRoot of appRoots) {
  copyRelease(source, path.join(appRoot, versionedName));
  copyRelease(source, path.join(appRoot, latestName));
  for (const metadataName of ['manifest.json', 'client-downloads.json']) {
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
      description: 'Cocos Creator 原生横屏空战客户端，包含阵营内战、随机战场事件、清晰命中反馈、完整装配和应用内更新。',
      remarks: 'Release APK；应用内支持手动检查和多线程下载更新，不跳转浏览器。',
      notes, size, fileSize: size, sha256, checksum: sha256, updatedAt: iso,
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '本批次按要求未连接 Windows 或 Android 设备，未完成设备运行验证',
    });
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-09-01-spacefight-0116-android-release',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight Android 0.11.6：敌机内战、随机事件与瞄准节奏',
  content: `SpaceFight Android 更新至 ${version} build ${build}。降低敌机追击速度、威胁成长和射击频率；新增低概率敌对阵营内战、离子扰动和应急补给事件。玩家命中使用更清晰的准星、3D 冲击与震动反馈，敌机互击不会冒充玩家命中或错误发放分数。六类高画质飞船资源从 iCloud 占位状态恢复。包名和应用名保持不变。本批次未连接 Windows 或 Android 设备，未完成设备运行验证。`,
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

process.stdout.write(`Published SpaceFight Android ${version} build ${build} (${size} bytes, ${sha256}).\n`);
