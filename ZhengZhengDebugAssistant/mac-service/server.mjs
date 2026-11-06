#!/usr/bin/env node
// 铮铮调试助手 · Mac 侧构建服务
// 零依赖（仅 Node 内置模块），仅限局域网使用。
// 用法：node server.mjs [--port 8124] [--config ./config.json]
//
// 职责（完整闭环的中枢）：
//   手机端 App（Android / HarmonyOS）→ 本服务 → 触发本机构建脚本 → 产物回传手机安装
//
// 接口一览（除 /api/ping 外均需请求头 X-Debug-Token 与 config.json 的 token 一致）：
//   GET  /api/ping                       存活探测
//   GET  /api/projects                   项目列表
//   GET  /api/tree?project=&path=        目录树（单层）
//   GET  /api/file?project=&path=        读文件 {content}
//   POST /api/file                       写文件 {project, path, content}
//   POST /api/build                      触发构建 {project, task?} → {buildId}
//   GET  /api/build/:id                  构建状态 {status, logTail, exitCode}
//   GET  /api/build/:id/artifact         下载构建产物（apk/hap/…）
//   GET  /api/artifacts?project=         最近产物列表

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 参数 ----------
let port = 8124;
let configPath = path.join(__dirname, 'config.json');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') port = parseInt(argv[++i], 10);
  else if (argv[i] === '--config') configPath = path.resolve(argv[++i]);
}
if (!fs.existsSync(configPath)) {
  console.error(`[fatal] 找不到配置文件 ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const WORKSPACE = path.resolve(config.workspaceDir);
if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });
const SECRET = config.token;
const ARTIFACT_EXT = new Set(config.artifactExtensions || ['.apk', '.apks', '.hap', '.app', '.haps', '.aab', '.zip']);
if (!SECRET || SECRET.length < 8) {
  console.error('[fatal] config.json 的 token 至少 8 位（局域网内也必须防误连）');
  process.exit(1);
}

// ---------- 构建（增量构建任务表）----------
const builds = new Map(); // id -> {id, project, status, log, exitCode, artifact, startedAt, endedAt}
const MAX_LOG = 200000;

function findArtifact(projectDir, since) {
  // 在项目目录里找 since 之后修改过的产物文件，返回最新一个
  let best = null;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (ARTIFACT_EXT.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= since && (!best || st.mtimeMs > best.mtimeMs)) best = { file: p, mtimeMs: st.mtimeMs, size: st.size };
        } catch { /* 忽略 */ }
      }
    }
  };
  walk(projectDir, 0);
  return best;
}

function runBuild(project, task) {
  const id = crypto.randomBytes(6).toString('hex');
  const entry = { id, project, status: 'running', log: '', exitCode: null, artifact: null, startedAt: Date.now(), endedAt: null };
  builds.set(id, entry);
  const projectDir = path.join(WORKSPACE, project);
  const commands = config.builds || {};
  const cmdStr = task || commands[project] || commands['*'];
  if (!cmdStr) {
    entry.status = 'failed'; entry.exitCode = -1; entry.log = `config.json 里没有配置项目「${project}」的构建命令，也没有通配 * 命令`; entry.endedAt = Date.now();
    return entry;
  }
  console.log(`[build ${id}] ${project}: ${cmdStr}`);
  const child = spawn('/bin/bash', ['-lc', cmdStr], { cwd: projectDir, env: { ...process.env, LANG: 'zh_CN.UTF-8' } });
  const since = Date.now();
  const pushLog = (chunk) => {
    entry.log = (entry.log + chunk.toString()).slice(-MAX_LOG);
  };
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('close', (code) => {
    entry.exitCode = code;
    entry.endedAt = Date.now();
    entry.status = code === 0 ? 'success' : 'failed';
    if (code === 0) {
      const art = findArtifact(projectDir, since);
      entry.artifact = art ? art.file : null;
      if (!art) entry.log += `\n[zzda] 构建退出码 0，但在项目目录里没找到构建产物（${[...ARTIFACT_EXT].join(' ')}）`;
    }
    console.log(`[build ${id}] ${entry.status}${entry.artifact ? ' → ' + entry.artifact : ''}`);
  });
  return entry;
}

// ---------- 工具 ----------
function guardPath(project, rel) {
  // 防路径穿越：必须解析回 WORKSPACE 之内；禁 .git
  if (!project || /[/\\]/.test(project) || project.startsWith('.')) return null;
  const clean = (rel || '').replace(/^[/\\]+/, '');
  if (clean.split(/[/\\]/).some((seg) => seg === '.git')) return null;
  const abs = path.resolve(WORKSPACE, project, clean);
  if (!abs.startsWith(WORKSPACE + path.sep)) return null;
  return abs;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = url.pathname;

  // 主动权交给局域网：ping 不鉴权，其余必须带 token
  if (p === '/api/ping' && req.method === 'GET') {
    return json(res, 200, { ok: true, name: '铮铮调试助手·Mac 构建服务', version: '0.1.0', workspace: WORKSPACE });
  }
  if (req.headers['x-debug-token'] !== SECRET) {
    return json(res, 401, { ok: false, error: 'token 不匹配' });
  }

  try {
    // 项目列表
    if (p === '/api/projects' && req.method === 'GET') {
      const list = fs.readdirSync(WORKSPACE, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name);
      return json(res, 200, { ok: true, projects: list });
    }

    // 目录树（单层）
    if (p === '/api/tree' && req.method === 'GET') {
      const dir = guardPath(url.searchParams.get('project'), url.searchParams.get('path'));
      if (!dir) return json(res, 400, { ok: false, error: '非法路径' });
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'build' && e.name !== '.gradle' && e.name !== '.hvigor')
        .map((e) => ({ name: e.name, dir: e.isDirectory(), size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0 }))
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'zh'));
      return json(res, 200, { ok: true, entries });
    }

    // 读文件
    if (p === '/api/file' && req.method === 'GET') {
      const f = guardPath(url.searchParams.get('project'), url.searchParams.get('path'));
      if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) return json(res, 404, { ok: false, error: '文件不存在' });
      if (fs.statSync(f).size > 2 * 1024 * 1024) return json(res, 413, { ok: false, error: '文件超过 2MB，不适合在手机上编辑' });
      return json(res, 200, { ok: true, content: fs.readFileSync(f, 'utf8') });
    }

    // 写文件
    if (p === '/api/file' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const f = guardPath(body.project, body.path);
      if (!f) return json(res, 400, { ok: false, error: '非法路径' });
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body.content ?? '', 'utf8');
      console.log(`[file] 已保存 ${path.relative(WORKSPACE, f)} (${(body.content ?? '').length} 字符)`);
      return json(res, 200, { ok: true });
    }

    // 触发构建
    if (p === '/api/build' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const dir = guardPath(body.project, '');
      if (!dir || !fs.existsSync(dir)) return json(res, 400, { ok: false, error: '项目不存在' });
      const entry = runBuild(body.project, body.task);
      return json(res, 200, { ok: true, buildId: entry.id });
    }

    // 构建状态：/api/build/:id
    const mBuild = p.match(/^\/api\/build\/([0-9a-f]+)$/);
    if (mBuild && req.method === 'GET') {
      const entry = builds.get(mBuild[1]);
      if (!entry) return json(res, 404, { ok: false, error: '任务不存在' });
      return json(res, 200, { ok: true, status: entry.status, exitCode: entry.exitCode, artifact: entry.artifact, elapsed: (entry.endedAt ?? Date.now()) - entry.startedAt, logTail: entry.log.slice(-4000) });
    }

    // 下载产物
    const mArt = p.match(/^\/api\/build\/([0-9a-f]+)\/artifact$/);
    if (mArt && req.method === 'GET') {
      const entry = builds.get(mArt[1]);
      if (!entry || !entry.artifact || !fs.existsSync(entry.artifact)) return json(res, 404, { ok: false, error: '产物不存在' });
      const file = entry.artifact;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'X-Artifact-Name': encodeURIComponent(path.basename(file)) });
      fs.createReadStream(file).pipe(res);
      return;
    }

    // 最近产物列表
    if (p === '/api/artifacts' && req.method === 'GET') {
      const project = url.searchParams.get('project');
      const dir = guardPath(project, '');
      if (!dir || !fs.existsSync(dir)) return json(res, 400, { ok: false, error: '项目不存在' });
      const found = [];
      const walk = (d, depth) => {
        if (depth > 6) return;
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const fp = path.join(d, e.name);
          if (e.isDirectory()) walk(fp, depth + 1);
          else if (ARTIFACT_EXT.has(path.extname(e.name).toLowerCase())) {
            const st = fs.statSync(fp);
            found.push({ path: path.relative(dir, fp), size: st.size, mtime: st.mtimeMs });
          }
        }
      };
      walk(dir, 0);
      found.sort((a, b) => b.mtime - a.mtime);
      return json(res, 200, { ok: true, artifacts: found.slice(0, 20) });
    }

    return json(res, 404, { ok: false, error: `未知路由 ${p}` });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`铮铮调试助手·Mac 构建服务 0.1.0`);
  console.log(`  监听: 0.0.0.0:${port}（仅局域网）`);
  console.log(`  工作区: ${WORKSPACE}`);
  console.log(`  构建命令配置: ${JSON.stringify(config.builds || {})}`);
});
