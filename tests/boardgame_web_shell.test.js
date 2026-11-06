const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../website/zhengzhengstudio.cn/boardgames/index.html'), 'utf8');
const rummy = fs.readFileSync(path.join(__dirname, '../website/zhengzhengstudio.cn/boardgames/rummy.html'), 'utf8');

test('web shell exposes only lobby, games and profile as primary pages', () => {
  const primaryPages = [...html.matchAll(/data-primary-page="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(primaryPages)], ['lobby', 'games', 'profile']);
});

test('lobby prioritizes resume, matchmaking and room joining', () => {
  assert.match(html, /id="active-game-resume"/);
  assert.match(html, /id="app-match-btn"/);
  assert.match(html, /id="app-join-btn"/);
});

test('games use a dedicated detail surface before starting', () => {
  assert.match(html, /id="game-detail-panel"/);
  assert.match(html, /id="game-detail-online"/);
  assert.match(html, /id="game-detail-local"/);
});

test('profile contains account, appearance, update and feedback settings', () => {
  assert.match(html, /id="profile-account"/);
  assert.match(html, /data-theme-mode="system"/);
  assert.match(html, /data-theme-mode="light"/);
  assert.match(html, /data-theme-mode="dark"/);
  assert.match(html, /id="profile-update"/);
  assert.match(html, /id="profile-feedback"/);
});

test('mobile Rummy keeps an empty table compact and its hand near the first viewport', () => {
  assert.match(rummy, /\.pool-area:empty\s*\{[\s\S]*?min-height:\s*220px/);
  assert.match(rummy, /body\.screen-small-fold \.pool-area:empty/);
  assert.match(rummy, /class="header-actions"/);
});
