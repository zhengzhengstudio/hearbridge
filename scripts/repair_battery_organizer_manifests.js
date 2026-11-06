#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const host = 'zhengzhengstudio.cn';
const syncHost = 'sync.zhengzhengstudio.cn';
const secret = process.env.SYNC_SECRET;
const batteryIds = new Set([
  'battery-organizer-macos',
  'battery-organizer-android',
  'battery-organizer-web',
  'battery-organizer-ios',
  'battery-organizer-ipados',
  'battery-organizer-harmonyos',
  'battery-organizer-offline-android',
  'battery-organizer-offline-harmonyos'
]);

if (!secret) {
  console.error('缺少 SYNC_SECRET，已停止清单修复。');
  process.exit(2);
}

const manifests = [
  {
    url: '/api/apps/manifest.json',
    remotes: ['api/apps/manifest.json', 'zhengzhengstudio.cn/api/apps/manifest.json'],
    local: 'website/api/apps/manifest.json'
  },
  {
    url: '/api/apps/client-downloads.json',
    remotes: ['api/apps/client-downloads.json', 'zhengzhengstudio.cn/api/apps/client-downloads.json'],
    local: 'website/api/apps/client-downloads.json'
  },
  {
    url: '/api/battery-organizer/apps/manifest.json',
    remotes: ['zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'],
    local: 'website/zhengzhengstudio.cn/api/battery-organizer/apps/manifest.json'
  },
  {
    url: '/api/boardgames/apps/manifest.json',
    remotes: ['zhengzhengstudio.cn/api/boardgames/apps/manifest.json'],
    local: 'website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json'
  },
  {
    url: '/api/boardgames/manifest.json',
    remotes: ['zhengzhengstudio.cn/api/boardgames/manifest.json'],
    local: 'website/zhengzhengstudio.cn/api/boardgames/manifest.json'
  }
];

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.end(body);
  });
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await request({
      hostname: host,
      path: `${url}?batteryRepair=${Date.now()}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/136 Safari/537.36', Accept: 'application/json' },
      timeout: 30000
    });
    if (result.status === 200) return JSON.parse(result.body.toString('utf8'));
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`无法读取线上清单：${url}`);
}

function replaceBatteryEntries(remote, local) {
  const replacements = new Map((local.apps || []).filter(item => batteryIds.has(item.id)).map(item => [item.id, item]));
  const apps = (remote.apps || []).map(item => replacements.get(item.id) || item);
  for (const [id, item] of replacements) {
    if (!apps.some(existing => existing.id === id)) apps.push(item);
  }
  const downloads = { ...(remote.downloads || {}) };
  for (const [key, item] of Object.entries(local.downloads || {})) {
    if (batteryIds.has(item?.id)) downloads[key] = item;
  }
  return {
    ...remote,
    updatedAt: local.updatedAt || new Date().toISOString(),
    generatedAt: local.generatedAt || new Date().toISOString(),
    apps,
    ...(Object.keys(downloads).length ? { downloads } : {})
  };
}

async function forceUpload(remotePath, value) {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const uploadId = crypto.createHash('sha256').update(`${remotePath}:${Date.now()}`).digest('hex').slice(0, 24);
  const payload = Buffer.from(JSON.stringify({
    secret,
    relativePath: remotePath,
    uploadId,
    chunkIndex: 0,
    totalChunks: 1,
    chunk: content.toString('base64'),
    isLast: true
  }));
  const result = await request({
    hostname: syncHost,
    path: '/api/internal/sync-file-chunk',
    method: 'POST',
    headers: {
      'X-Sync-Secret': secret,
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    },
    timeout: 60000
  }, payload);
  if (result.status !== 200) throw new Error(`${remotePath}: HTTP ${result.status} ${result.body.toString('utf8').slice(0, 160)}`);
  console.log(`已精确修复 ${remotePath}，保留 ${value.apps?.length || 0} 个应用条目`);
}

(async () => {
  for (const manifest of manifests) {
    const remote = await fetchJson(manifest.url);
    const local = JSON.parse(fs.readFileSync(path.join(root, manifest.local), 'utf8'));
    const repaired = replaceBatteryEntries(remote, local);
    for (const remotePath of manifest.remotes) await forceUpload(remotePath, repaired);
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
