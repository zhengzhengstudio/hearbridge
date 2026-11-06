const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('multiplayer server owns rooms and serves the maintained game source', () => {
  const source = read('website/api/zzworld_server.js');
  assert.match(source, /zhengzhengstudio\.cn', 'multiplayer_games/);
  assert.match(source, /app\.post\('\/api\/multiplayer\/quick-match'/);
  assert.match(source, /app\.post\('\/api\/multiplayer\/rooms\/\:code\/join'/);
  assert.match(source, /socket\.on\('room:ready'/);
  assert.match(source, /socket\.on\('room:chat'/);
  assert.match(source, /socket\.on\('game:state'/);
  assert.match(source, /function requirePassport/);
  assert.match(source, /io\.use\(\(socket, next\)/);
  assert.match(source, /playerId: req\.passport\.uid/);
  assert.match(source, /LEGACY_HOSTS\.has\(host\)/);
  assert.match(source, /res\.redirect\(308/);
  assert.doesNotMatch(source, /app\.get\('\*'/);
});

test('lobby offers real room operations and every game loads the shared runtime', () => {
  const lobby = read('website/zhengzhengstudio.cn/multiplayer_games/index.html');
  const client = read('website/zhengzhengstudio.cn/multiplayer_games/multiplayer-lobby.js');
  assert.match(lobby, /铮铮多人游戏/);
  assert.match(lobby, /id="quick-match"/);
  assert.match(lobby, /id="create-room"/);
  assert.match(lobby, /id="join-room"/);
  assert.match(lobby, /box-sizing: border-box/);
  assert.match(lobby, /width: calc\(100% - 32px\)/);
  assert.match(client, /\/api\/multiplayer\/quick-match/);
  assert.match(client, /\/api\/multiplayer\/rooms/);
  assert.match(client, /zhengzhengstudio\.cn\/api\/zz-pass/);
  assert.match(client, /credentials: 'include'/);
  assert.match(client, /clearInvalidSession/);
  assert.match(client, /Authorization: `Bearer \$\{token\}`/);
  assert.match(read('website/zhengzhengstudio.cn/multiplayer_games/multiplayer-runtime.js'), /auth: \{ token \}/);

  for (const file of ['voxel_world.html', 'space_battle_3d.html', 'racing.html', 'maze_battle.html', 'bomberman_2d.html', 'draw_guess.html', 'brick_breaker.html', 'tank_battle_2d.html']) {
    assert.match(read(`website/zhengzhengstudio.cn/multiplayer_games/${file}`), /multiplayer-runtime\.js/, file);
  }
});

test('native clients use the new domain and preserve upgrade identifiers', () => {
  const android = read('platform/android/app/build.gradle');
  const iosPlist = read('platform/ios/ZZWorld/Info.plist');
  const macPlist = read('platform/macos/ZZWorld/Info.plist');
  assert.match(android, /versionCode 3/);
  assert.match(android, /versionName "0\.2\.0"/);
  assert.match(android, /multiplayergames\.zhengzhengstudio\.cn/);
  assert.match(android, /applicationId "cn\.zhengzhengstudio\.zzworld"/);
  for (const plist of [iosPlist, macPlist]) {
    assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>ZZWorld<\/string>/);
    assert.match(plist, /<key>CFBundleName<\/key>\s*<string>铮铮多人游戏<\/string>/);
    assert.match(plist, /<string>cn\.zhengzhengstudio\.zzworld<\/string>/);
    assert.match(plist, /<string>0\.2\.0<\/string>/);
  }
  assert.match(read('apps/MultiplayerGames-HarmonyOS/AppScope/app.json5'), /"versionCode": 1020003/);
  assert.match(read('apps/MultiplayerGames-HarmonyOS/entry/src/main/ets/pages/Index.ets'), /multiplayergames\.zhengzhengstudio\.cn/);
});

test('publisher emits public multiplayer app ids and packages', () => {
  const source = read('build_zzworld.js');
  assert.match(source, /VERSION[^\n]*'0\.2\.0'/);
  assert.match(source, /BUILD[^\n]*3/);
  assert.match(source, /PRODUCT = 'multiplayer-games'/);
  assert.match(source, /APP_NAME = '铮铮多人游戏'/);
  assert.match(source, /multiplayergames\.zhengzhengstudio\.cn/);
  assert.match(source, /id: `multiplayer-games-\$\{platform\}`/);
  assert.match(source, /MultiplayerGames-HarmonyOS/);
  assert.match(source, /'multiplayer-games-harmonyos'/);
});
