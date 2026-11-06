import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.5';
const build = 49;
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
  `${version} build ${build}：命中、击毁、护盾击穿和波次升级改为明确战斗事件，不再依赖血量差值猜测反馈。`,
  'HUD 加入命中标记、伤害/击毁提示和威胁等级播报；战场加入池化冲击、爆炸光环与分级震动反馈。',
  '空间站 GLB 重建为可接近的装甲外壳、开放机库、内部甲板、走廊、舱门、掩体与引导灯，并保留低配程序化回退。',
  '恢复六类标准路径高画质飞船资源，避免云盘冲突副本导致高配设备加载失败。',
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
      description: 'Cocos Creator 原生横屏空战客户端，包含直接命中反馈、递进波次、精细空间站、完整装配和应用内更新。',
      remarks: 'Release APK；应用内支持手动检查和多线程下载更新，不跳转浏览器。',
      notes, size, fileSize: size, sha256, checksum: sha256, updatedAt: iso,
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: '本批次按要求未连接 Windows 或 Android 设备，未完成设备运行验证',
    });
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-09-01-spacefight-0115-android-release',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight Android 0.11.5：命中反馈、递进战斗与空间站重建',
  content: `SpaceFight Android 更新至 ${version} build ${build}。命中、击毁、护盾击穿和波次升级使用明确事件驱动 HUD、3D 冲击与震动反馈；空间站重建为包含开放机库和可见内部结构的 GLB，并保留低配回退。六类标准路径高画质飞船资源已恢复。包名和应用名保持不变。本批次未连接 Windows 或 Android 设备，未完成设备运行验证。`,
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
