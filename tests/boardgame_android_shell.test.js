const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname,
  '../MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java'), 'utf8');

test('Android uses the same three primary destinations', () => {
  const pageTabs = source.match(/private LinearLayout pageTabs[\s\S]*?return tabs;/)?.[0] || '';
  assert.match(pageTabs, /tabButton\("大厅", "lobby"/);
  assert.match(pageTabs, /tabButton\("游戏", "games"/);
  assert.match(pageTabs, /tabButton\("我的", "profile"/);
  assert.doesNotMatch(pageTabs, /tabButton\("更多"|tabButton\("设置"|tabButton\("联机"/);
});

test('Android profile keeps account, version, update and feedback controls', () => {
  const settings = source.match(/private LinearLayout settingsPage[\s\S]*?return page;/)?.[0] || '';
  assert.match(settings, /通行证登录 \/ 注册/);
  assert.match(settings, /BuildConfig\.VERSION_NAME/);
  assert.match(settings, /检查软件更新/);
  assert.match(settings, /反馈问题/);
  assert.match(settings, /外观/);
  assert.match(source, /String\[] values = \{"system", "light", "dark"\}/);
  assert.match(source, /\/api\/feedback/);
});

test('Android game library provides search and category filters', () => {
  assert.match(source, /gameSearchInput/);
  assert.match(source, /filterGameLibrary/);
  assert.match(source, /搜索桌游/);
  assert.match(source, /全部.*棋类.*牌类.*聚会/s);
});
