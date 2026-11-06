#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const endpoint = new URL(process.env.SYNC_ENDPOINT || 'https://sync.zhengzhengstudio.cn');
const secret = process.env.SYNC_SECRET;
const chunkSize = 1024 * 1024;

if (!secret) {
  console.error('缺少 SYNC_SECRET，已停止发布。');
  process.exit(2);
}

const packages = [
  'battery-organizer-macos-1.1.19.dmg',
  'battery-organizer-macos-latest.dmg',
  'battery-organizer-android-1.1.19.apk',
  'battery-organizer-android-latest.apk',
  'battery-organizer-offline-android-1.0.3.apk',
  'battery-organizer-offline-android-latest.apk',
  'battery-organizer-harmonyos-1.1.29.app',
  'battery-organizer-harmonyos-1.1.29.hap',
  'battery-organizer-harmonyos-latest.app',
  'battery-organizer-harmonyos-latest.hap',
  'battery-organizer-offline-harmonyos-1.0.13.app',
  'battery-organizer-offline-harmonyos-1.0.13.hap',
  'battery-organizer-offline-harmonyos-latest.app',
  'battery-organizer-offline-harmonyos-latest.hap'
];

const files = [
  ['api/data/changelogs.json', 'website/api/data/changelogs.json'],
  ['api/lib/app_manifest_merge.js', 'website/api/lib/app_manifest_merge.js'],
  ['api/lib/battery_organizer_store.js', 'website/api/lib/battery_organizer_store.js'],
  ['api/apps/manifest.json', 'website/api/apps/manifest.json'],
  ['api/apps/client-downloads.json', 'website/api/apps/client-downloads.json'],
  ['zhengzhengstudio.cn/api/apps/manifest.json', 'website/zhengzhengstudio.cn/api/apps/manifest.json'],
  ['zhengzhengstudio.cn/api/apps/client-downloads.json', 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'],
  ['zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json', 'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'],
  ['zhengzhengstudio.cn/api/boardgames/apps/manifest.json', 'website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json'],
  ['zhengzhengstudio.cn/api/boardgames/manifest.json', 'website/zhengzhengstudio.cn/api/boardgames/manifest.json'],
  ['zhengzhengstudio.cn/battery-organizer/index.html', 'website/zhengzhengstudio.cn/battery-organizer/index.html'],
  ['zhengzhengstudio.cn/battery-organizer/battery-organizer.js', 'website/zhengzhengstudio.cn/battery-organizer/battery-organizer.js'],
  ['zhengzhengstudio.cn/battery-organizer/battery-organizer.css', 'website/zhengzhengstudio.cn/battery-organizer/battery-organizer.css'],
  ['zhengzhengstudio.cn/battery-organizer/battery-store.js', 'website/zhengzhengstudio.cn/battery-organizer/battery-store.js']
];

for (const file of packages) {
  files.push([`api/apps/${file}`, `website/api/apps/${file}`]);
  files.push([`zhengzhengstudio.cn/api/apps/${file}`, `website/zhengzhengstudio.cn/api/apps/${file}`]);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(route, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: route,
      method: 'POST',
      headers: {
        'X-Sync-Secret': secret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    }, res => {
      let response = '';
      res.on('data', chunk => { response += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, response, retryAfter: Number(res.headers['retry-after']) || 5 }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('同步请求超时')));
    req.end(payload);
  });
}

async function sendWithRetry(route, body, label) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await request(route, body);
    if (result.status === 200) return;
    if (result.status === 429) {
      await delay(Math.max(5, result.retryAfter) * 1000);
      continue;
    }
    throw new Error(`${label}: HTTP ${result.status} ${result.response.slice(0, 160)}`);
  }
  throw new Error(`${label}: 多次重试后仍被限流`);
}

async function upload(remotePath, localPath) {
  const absolute = path.join(root, localPath);
  if (!fs.existsSync(absolute)) throw new Error(`本地文件不存在：${localPath}`);
  const content = fs.readFileSync(absolute);
  if (content.length <= chunkSize) {
    await sendWithRetry('/api/internal/sync-file', {
      secret,
      relativePath: remotePath,
      encoding: 'base64',
      content: content.toString('base64')
    }, remotePath);
  } else {
    const totalChunks = Math.ceil(content.length / chunkSize);
    const uploadId = crypto.createHash('sha256').update(`${remotePath}:${content.length}`).digest('hex').slice(0, 24);
    for (let index = 0; index < totalChunks; index += 1) {
      await sendWithRetry('/api/internal/sync-file-chunk', {
        secret,
        relativePath: remotePath,
        uploadId,
        chunkIndex: index,
        totalChunks,
        chunk: content.subarray(index * chunkSize, Math.min(content.length, (index + 1) * chunkSize)).toString('base64'),
        isLast: index === totalChunks - 1
      }, `${remotePath} ${index + 1}/${totalChunks}`);
    }
  }
  console.log(`已上传 ${remotePath} (${content.length} bytes)`);
}

(async () => {
  for (const [remotePath, localPath] of files) await upload(remotePath, localPath);
  console.log(`电池收纳器发布完成，共 ${files.length} 个文件。`);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
