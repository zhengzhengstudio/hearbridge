const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname,
  '../MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift'), 'utf8');

test('Apple scene uses lobby, games and profile as primary sections', () => {
  assert.match(source, /\("大厅", "lobby", StudioAction\.navLobby\)/);
  assert.match(source, /\("游戏", "games", StudioAction\.navGames\)/);
  assert.match(source, /\("我的", "profile", StudioAction\.navProfile\)/);
  assert.match(source, /primarySection == "games"/);
  assert.match(source, /primarySection == "profile"/);
});

test('Apple settings include account, appearance, version, feedback and updates', () => {
  assert.match(source, /通行证账号/);
  assert.match(source, /外观/);
  assert.match(source, /CFBundleShortVersionString/);
  assert.match(source, /反馈问题/);
  assert.match(source, /checkAppUpdates\(userInitiated:/);
  assert.match(source, /\/api\/feedback/);
});

test('Apple game library provides search and category filters', () => {
  assert.match(source, /gameSearchText/);
  assert.match(source, /gameCategory/);
  assert.match(source, /filteredOnlineGames/);
  assert.match(source, /搜索桌游/);
});
