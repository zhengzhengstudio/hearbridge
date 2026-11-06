#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.6.1';
const build = 39;
const versionedName = `SurvivalDiary-Android-v${version}-b${build}.apk`;
const latestName = 'SurvivalDiary-Android-latest.apk';
const privateApps = path.join(root, 'website/api/apps');
const publicApps = path.join(root, 'website/zhengzhengstudio.cn/api/apps');
const documents = [
  path.join(privateApps, 'manifest.json'),
  path.join(privateApps, 'client-downloads.json'),
  path.join(publicApps, 'manifest.json'),
  path.join(publicApps, 'client-downloads.json'),
];
const source = path.join(privateApps, 'download', versionedName);

if (!fs.existsSync(source)) throw new Error(`verified APK missing: ${source}`);
const bytes = fs.readFileSync(source);
const size = bytes.length;
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (!size || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid release artifact');

function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

for (const appsRoot of [privateApps, publicApps]) {
  const download = path.join(appsRoot, 'download');
  fs.mkdirSync(download, { recursive: true });
  for (const name of [versionedName, latestName]) {
    const target = path.join(download, name);
    atomicWrite(target, bytes);
    atomicWrite(`${target}.sha256`, `${sha256}  ${name}\n`);
  }
}

const now = new Date().toISOString();
let canonical;
for (const file of documents) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = document.apps.find((item) => item.id === 'survival-diary-android');
  if (!entry) throw new Error(`Android entry missing: ${file}`);
  Object.assign(entry, {
    version,
    latestVersion: version,
    versionName: version,
    build,
    latestBuild: build,
    versionCode: build,
    latestVersionCode: build,
    available: true,
    signed: true,
    signing: 'android-release',
    storeReady: true,
    fileName: versionedName,
    url: `/api/apps/download/${versionedName}`,
    latestUrl: `/api/apps/download/${versionedName}`,
    versionedUrl: `/api/apps/download/${versionedName}`,
    downloadURL: `/api/apps/download/${versionedName}`,
    size,
    fileSize: size,
    sha256,
    checksum: sha256,
    updatedAt: now,
    title: `生存日记 Android 正式版 v${version} build ${build}`,
    remarks: '0.6.1 build 39 正式签名包；岛民先立即本地回应，Kimi 在线回答最多等待 7 秒且不会因慢请求重复等待。继续使用同一正式证书，可覆盖安装 0.6.0 build 38。',
  });
  const releaseNotes = [
    '岛民交谈会先立即显示符合人物与地点的本地回答，Kimi 在线结果返回后在同一条消息中替换。',
    'Kimi 调用最多等待 7 秒；仅会话过期时刷新重试，网络慢、限流或上游超时不会再连续等待两轮。',
  ];
  entry.notes = [...releaseNotes, ...entry.notes.filter((note) => !note.includes('岛民在线交谈按 Kimi 配置调用'))];
  document.updatedAt = now;
  document.generatedAt = now;
  canonical ??= JSON.stringify(entry);
  if (JSON.stringify(entry) !== canonical) throw new Error(`release metadata diverged: ${file}`);
  atomicWrite(file, `${JSON.stringify(document, null, 2)}\n`);
}

for (const appsRoot of [privateApps, publicApps]) {
  for (const name of [versionedName, latestName]) {
    const file = path.join(appsRoot, 'download', name);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== sha256 || fs.statSync(file).size !== size) throw new Error(`published copy mismatch: ${file}`);
  }
}

console.log(JSON.stringify({ version, build, fileName: versionedName, size, sha256 }, null, 2));
