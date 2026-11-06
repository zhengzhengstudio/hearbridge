const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const parse = relativePath => JSON.parse(read(relativePath));

const android = read('apps/ManagerPortal-Android/app/build.gradle.kts');
const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
const macos = read('apps/ManagerPortalMac/Sources/main.swift');
const harmonyApp = read('apps/ManagerPortal-HarmonyOS/AppScope/app.json5');
const harmonyPage = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');
const buildScript = read('apps/build_manager_portal_apps.sh');
const server = read('website/api/server.js');

test('all Manager Portal clients identify release 1.5.5 build 17', () => {
  assert.match(android, /versionCode\s*=\s*17/);
  assert.match(android, /versionName\s*=\s*"1\.5\.5"/);
  assert.match(ios, /appVersion\s*=\s*"1\.5\.5"/);
  assert.match(ios, /appBuild\s*=\s*17/);
  assert.match(macos, /appVersion\s*=\s*"1\.5\.5"/);
  assert.match(macos, /appBuild\s*=\s*17/);
  assert.match(harmonyApp, /"versionCode"\s*:\s*1050517/);
  assert.match(harmonyApp, /"versionName"\s*:\s*"1\.5\.5"/);
  assert.match(harmonyPage, /ManagerPortal\/HarmonyOS-1\.5\.5/);
  assert.match(harmonyPage, /appBuild:\s*number\s*=\s*17/);
});

test('release builder emits the exact private 1.5.5 package names', () => {
  assert.match(buildScript, /VERSION="1\.5\.5"/);
  assert.match(buildScript, /BUILD="17"/);
  for (const fileName of [
    'ManagerPortal-macOS-v${VERSION}.dmg',
    'ManagerPortal-iOS-v${VERSION}-unsigned.ipa',
    'ManagerPortal-Android-v${VERSION}.apk',
    'ManagerPortal-HarmonyOS-v${VERSION}-unsigned.hap'
  ]) {
    assert.ok(buildScript.includes(fileName), `missing release filename: ${fileName}`);
  }
  assert.match(buildScript, /private:\s*true/);
  assert.match(buildScript, /scope:\s*'manager_portal'/);
});

test('private release notes cover structured editing and session safety', () => {
  for (const phrase of ['原生结构化', '安全编辑', '删除确认', '网站创建', '权限检查', '401', '自动退出']) {
    assert.ok(buildScript.includes(phrase), `missing release note: ${phrase}`);
  }
});

test('public app manifests contain no Manager Portal entries', () => {
  for (const relativePath of [
    'website/api/apps/manifest.json',
    'website/api/apps/client-downloads.json',
    'website/zhengzhengstudio.cn/api/apps/manifest.json',
    'website/zhengzhengstudio.cn/api/apps/client-downloads.json'
  ]) {
    const manifest = parse(relativePath);
    const managerEntries = (manifest.apps || []).filter(item =>
      String(item.id || '').startsWith('manager-portal-') ||
      String(item.fileName || '').startsWith('ManagerPortal-')
    );
    assert.deepEqual(managerEntries, [], `${relativePath} exposes private Manager Portal packages`);
  }
});

test('private Manager Portal manifest is blocked before main-site static serving', () => {
  const guardIndex = server.indexOf("req.path === '/manager_portal/apps.json'");
  const staticIndex = server.indexOf("express.static(path.join(__dirname, '..', 'zhengzhengstudio.cn')");
  assert.ok(guardIndex >= 0, 'missing private manifest static-path guard');
  assert.ok(guardIndex < staticIndex, 'private manifest guard must run before static serving');
  assert.match(server.slice(guardIndex, staticIndex), /res\.status\(404\)/);
});

test('expired admin authentication returns 401 while permission denial remains 403', () => {
  const authStart = server.indexOf('const authAdmin =');
  const authEnd = server.indexOf("app.use('/api/hap-installer'", authStart);
  const authBlock = server.slice(authStart, authEnd);
  assert.match(authBlock, /res\.status\(401\)\.json/);
  assert.match(server, /res\.status\(403\)\.json\(\{ error: `Permission denied:/);
});
