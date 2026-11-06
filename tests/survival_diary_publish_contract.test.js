const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
test('download center metadata exposes the current seven-channel Survival Diary matrix', () => {
  for (const relativePath of [
    'website/api/apps/client-downloads.json',
    'website/api/apps/manifest.json',
    'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
    'website/zhengzhengstudio.cn/api/apps/manifest.json'
  ]) {
    const document = readJson(relativePath);
    const entries = document.apps.filter((entry) => entry.product === 'survival-diary');
    assert.equal(entries.length, 7, `${relativePath} must contain the seven release channels`);
    assert.ok(entries.some((entry) => entry.id === 'survival-diary-web' && entry.available === true));
    assert.ok(entries.some((entry) => entry.id === 'survival-diary-android' && entry.version === '0.6.2' && entry.build === 45 && entry.available === true));
    assert.ok(entries.some((entry) => entry.id === 'survival-diary-harmony-online'));
    assert.ok(entries.some((entry) => entry.id === 'survival-diary-harmony-offline' && entry.version === '0.6.2' && entry.build === 60203 && entry.available === true));
  }
});

test('published Android versioned copies are identical signed release artifacts', () => {
  const expectedSha256 = readJson('website/api/apps/manifest.json').apps.find((entry) => entry.id === 'survival-diary-android').sha256;
  for (const directory of ['website/api/apps/download', 'website/zhengzhengstudio.cn/api/apps/download']) {
    const file = fs.readFileSync(path.join(root, directory, 'SurvivalDiary-Android-v0.6.2-b45.apk'));
    assert.equal(require('node:crypto').createHash('sha256').update(file).digest('hex'), expectedSha256);
  }
});

test('Survival Diary deployment discovers release packages from metadata instead of pinning an old version', () => {
  const deployment = fs.readFileSync(path.join(root, 'sync_to_termux.js'), 'utf8');
  assert.doesNotMatch(deployment, /SurvivalDiary-Android-v0\.2\.0-b2/);
  assert.match(deployment, /collectSurvivalDiaryReleaseFiles/);
  assert.match(deployment, /entry\.product !== 'survival-diary'/);
});

test('online server deploys its matching world simulation instead of depending on a workspace-only path', () => {
  const serverRoot = path.join(root, 'website/survival-diary.zhengzhengstudio.cn/server');
  const worldStore = fs.readFileSync(path.join(serverRoot, 'world-store.js'), 'utf8');
  assert.match(worldStore, /require\('\.\/lib\/reference-simulation\.js'\)/);
  assert.doesNotMatch(worldStore, /apps\/SurvivalDiaryShared/);
  for (const relativePath of ['lib/reference-simulation.js', 'content/biomes.json', 'content/weather.json', 'content/recipes.json']) {
    assert.ok(fs.statSync(path.join(serverRoot, relativePath)).size > 0, `${relativePath} must be bundled`);
  }
});
