#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.6.0';
const build = 35;
const versionedName = `SurvivalDiary-Android-v${version}-b${build}.apk`;
const latestName = 'SurvivalDiary-Android-latest.apk';
const privateDownload = path.join(root, 'website/api/apps/download');
const publicDownload = path.join(root, 'website/zhengzhengstudio.cn/api/apps/download');
const source = path.join(privateDownload, versionedName);
const documents = [
  path.join(root, 'website/api/apps/manifest.json'),
  path.join(root, 'website/api/apps/client-downloads.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps/manifest.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'),
];

if (!fs.existsSync(source)) throw new Error(`verified APK missing: ${source}`);
const bytes = fs.readFileSync(source);
const size = bytes.length;
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (!size || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid release artifact');

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

for (const directory of [privateDownload, publicDownload]) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of [versionedName, latestName]) {
    const target = path.join(directory, name);
    atomicWrite(target, bytes);
    atomicWrite(`${target}.sha256`, `${sha256}  ${name}\n`);
  }
}

const now = new Date().toISOString();
for (const file of documents) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = document.apps.find(item => item.id === 'survival-diary-android');
  if (!entry) throw new Error(`Android download entry missing: ${file}`);
  Object.assign(entry, {
    version, latestVersion: version, versionName: version,
    build, versionCode: build,
    available: true, signed: true, signing: 'android-release', storeReady: true,
    remarks: '0.6.0 build 35 正式签名包；扩大原生主要动作、快捷栏、相机与底栏触控区，并同步当前设施、村庄、迷雾和更新器源码。',
    title: `生存日记 Android 正式版 v${version} build ${build}`,
    updatedAt: now,
    fileName: versionedName,
    url: `/api/apps/download/${latestName}`,
    latestUrl: `/api/apps/download/${latestName}`,
    versionedUrl: `/api/apps/download/${versionedName}`,
    downloadURL: `/api/apps/download/${versionedName}`,
    size, fileSize: size, sha256, checksum: sha256,
  });
  document.updatedAt = now;
  document.generatedAt = now;
  atomicWrite(file, `${JSON.stringify(document, null, 2)}\n`);
}

for (const directory of [privateDownload, publicDownload]) {
  for (const name of [versionedName, latestName]) {
    const file = path.join(directory, name);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== sha256 || fs.statSync(file).size !== size) throw new Error(`published copy mismatch: ${file}`);
  }
}

console.log(JSON.stringify({ version, build, fileName: versionedName, size, sha256 }, null, 2));
