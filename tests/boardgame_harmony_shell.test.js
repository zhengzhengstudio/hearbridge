const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
const appConfig = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/app.json5'), 'utf8');
const buildScript = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/build-hap.sh'), 'utf8');
const moduleConfig = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/module.json5'), 'utf8');
const appIcon = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/resources/base/media/app_icon.png'));
const scopeBackground = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/resources/base/media/background.png'));
const entryBackground = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/background.png'));
const scopeForeground = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/resources/base/media/foreground.png'));
const entryForeground = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/foreground.png'));
const startIcon = fs.readFileSync(path.join(__dirname,
  '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/startIcon.png'));
const originalBoardgamesIcon = fs.readFileSync(path.join(__dirname,
  '../MultipleBoardGames/MultipleBoardGames Shared/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png'));

test('HarmonyOS keeps only lobby, games and profile in the bottom bar', () => {
  const bottom = source.match(/BottomBar\(\)[\s\S]*?build\(\)/)?.[0] || '';
  assert.match(source, /\{\s*id:\s*'lobby',\s*title:\s*'大厅'/);
  assert.match(source, /\{\s*id:\s*'games',\s*title:\s*'游戏'/);
  assert.match(source, /\{\s*id:\s*'profile',\s*title:\s*'我的'/);
  assert.doesNotMatch(source, /\{\s*id:\s*'(room|settings)',\s*title:/);
  assert.match(bottom, /ForEach\(this\.navigationItems/);
});

test('HarmonyOS profile includes registration, themes, version and feedback', () => {
  assert.match(source, /private registerPassport/);
  assert.match(source, /\['system', '跟随系统'\]/);
  assert.match(source, /\['light', '浅色'\]/);
  assert.match(source, /\['dark', '深色'\]/);
  assert.match(source, /HarmonyOS \$\{this\.appVersion\}/);
  assert.match(source, /\/api\/feedback/);
});

test('HarmonyOS exposes complete secondary panels instead of one oversized profile page', () => {
  [
    'PublicRoomsPanel',
    'LeaderboardPanel',
    'PassportPanel',
    'PreferencesPanel',
    'FeedbackPanel',
    'AboutPanel'
  ].forEach(name => assert.match(source, new RegExp(`${name}\\(\\)`)));
  assert.match(source, /secondaryPage/);
  assert.match(source, /private openSecondary/);
  assert.match(source, /公开房间/);
  assert.match(source, /排行榜/);
  assert.match(source, /通行证账号/);
  assert.match(source, /外观与操作/);
  assert.match(source, /检查更新/);
  assert.match(source, /反馈问题/);
  assert.match(source, /关于桌游中心/);
});

test('HarmonyOS exposes study as a separate workflow with real local AI', () => {
  assert.match(source, /StudyHub\(\)/);
  assert.match(source, /this\.openSecondary\('study'\)/);
  assert.match(source, /残局闯关/);
  assert.match(source, /死活题/);
  assert.match(source, /自建残局/);
  assert.match(source, /this\.localAiEnabled = true/);
});

test('HarmonyOS secondary panels always have a visible back path', () => {
  const topBar = source.match(/TopBar\(\)[\s\S]*?GameCard\(game: GameInfo\)/)?.[0] || '';
  assert.match(topBar, /this\.secondaryPage\.length > 0/);
  assert.match(topBar, /Text\('返回'\)/);
  assert.match(topBar, /this\.secondaryPage = ''/);
});

test('HarmonyOS 1.2.16 keeps source and package metadata in sync', () => {
  assert.match(source, /appVersion: string = '1\.2\.16'/);
  assert.match(source, /appBuild: number = 31/);
  assert.match(source, /updateText: string = '当前版本 1\.2\.16'/);
  assert.match(appConfig, /"versionName": "1\.2\.16"/);
  assert.match(appConfig, /"versionCode": 1021600/);
});

test('HarmonyOS navigation and game cards use adaptive theme surfaces', () => {
  const gameCard = source.match(/GameCard\(game: GameInfo\)[\s\S]*?Lobby\(\)/)?.[0] || '';
  const bottomBar = source.match(/BottomBar\(\)[\s\S]*?build\(\)/)?.[0] || '';
  assert.match(gameCard, /this\.cardColor\(\)/);
  assert.match(gameCard, /this\.mutedColor\(\)/);
  assert.doesNotMatch(gameCard, /: '#FFFFFF'\)/);
  assert.match(bottomBar, /this\.cardColor\(\)/);
  assert.match(bottomBar, /this\.mutedColor\(\)/);
  assert.doesNotMatch(bottomBar, /: '#FFFFFF'\)/);
});

test('HarmonyOS avoids ambiguous alpha hex colors that render incorrectly on devices', () => {
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{8}/);
});

test('HarmonyOS follows system appearance and keeps every surface theme-aware', () => {
  assert.match(source, /@StorageLink\('systemDark'\) systemDark/);
  assert.match(source, /this\.themeMode === 'system' && this\.systemDark/);
  assert.match(source, /private positiveSurfaceColor/);
  assert.match(source, /private warningSurfaceColor/);
});

test('HarmonyOS uses automatic knock sharing and a separate AirDrop-style invite command', () => {
  assert.match(source, /harmonyShare\.on\('knockShare'/);
  assert.doesNotMatch(source, /Button\('碰一碰邀请'\)/);
  assert.match(source, /Button\('隔空投送邀请'\)/);
  assert.doesNotMatch(source, /Button\('智感扫码'\)/);
  assert.match(source, /accessibilityText\('扫一扫'\)/);
});

test('HarmonyOS separates local controls from multiplayer controls', () => {
  const gameRoom = source.match(/GameRoom\(\)[\s\S]*?UpdateCenter\(\)/)?.[0] || '';
  assert.match(gameRoom, /this\.roomId === '本地'/);
  assert.match(gameRoom, /AI 难度/);
  assert.match(gameRoom, /if \(this\.roomId !== '本地'\)/);
  assert.match(gameRoom, /this\.ChatPanel\(\)/);
  assert.match(gameRoom, /申请重开/);
});

test('HarmonyOS renders dedicated native play panels instead of a placeholder', () => {
  assert.doesNotMatch(source, /完整原生规则面板正在补齐/);
  [
    'ReversiBoard',
    'TicTacToeBoard',
    'GoBoard',
    'ChineseChessBoard',
    'CheckersBoard',
    'RummyTable',
    'LudoBoard',
    'PartyTable'
  ].forEach(name => assert.match(source, new RegExp(`${name}\\(\\)`)));
});

test('HarmonyOS game library supports search and type filtering', () => {
  assert.match(source, /@State gameSearchText: string = ''/);
  assert.match(source, /@State gameCategory: string = 'all'/);
  assert.match(source, /private filteredGames\(\): GameInfo\[\]/);
  assert.match(source, /placeholder: '搜索桌游'/);
  assert.match(source, /ForEach\(this\.filteredGames\(\)/);
});

test('HarmonyOS launcher follows the current DevEco layered icon template', () => {
  assert.match(appConfig, /"icon": "\$media:layered_image"/);
  assert.match(moduleConfig, /"icon": "\$media:layered_image"/);
  assert.match(moduleConfig, /"ohos\.want\.action\.home"/);
  assert.match(moduleConfig, /"action\.system\.home"/);
  assert.equal(appIcon[25], 2, 'PNG must use RGB color type without an alpha channel');
  assert.equal(scopeBackground.readUInt32BE(16), 1024);
  assert.equal(scopeBackground.readUInt32BE(20), 1024);
  assert.equal(scopeBackground[25], 2, 'layered icon background must be opaque RGB');
  assert.deepEqual(scopeBackground, entryBackground);
  assert.deepEqual(scopeForeground, entryForeground);
  assert.equal(startIcon.readUInt32BE(16), 1024);
  assert.equal(startIcon.readUInt32BE(20), 1024);
  assert.equal(startIcon[25], 2, 'start icon must be an opaque RGB PNG');
  assert.deepEqual(appIcon, originalBoardgamesIcon, 'HarmonyOS must keep the original boardgames center artwork');
  assert.deepEqual(startIcon, originalBoardgamesIcon, 'launch screen must use the same original boardgames artwork');
  assert.match(buildScript, /validate_icon_assets/);
});

test('HarmonyOS launcher ships the layered icon for phone and tablet qualifiers', () => {
  for (const root of [
    '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/resources',
    '../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources'
  ]) {
    for (const qualifier of ['base', 'phone', 'tablet']) {
      for (const name of ['background.png', 'foreground.png', 'layered_image.json']) {
        assert.ok(fs.existsSync(path.join(__dirname, root, qualifier, 'media', name)),
          `${qualifier}/media/${name} must be packaged`);
      }
    }
  }
  assert.match(buildScript, /for qualifier in base phone tablet/);
});

test('HarmonyOS native boards use generated art below exact interactive overlays', () => {
  for (const name of [
    'reversi_board',
    'tictactoe_board',
    'xiangqi_board',
    'checkers_board',
    'rummy_table',
    'ludo_board',
    'property_board',
    'card_table'
  ]) {
    assert.match(source, new RegExp(`app\\.media\\.${name}`));
    assert.ok(fs.existsSync(path.join(__dirname,
      `../HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/${name}.png`)));
  }
});

test('signed HarmonyOS packages are compiled in release mode', () => {
  assert.match(buildScript, /BUILD_MODE="\$\(\[ "\$SIGNED_BUILD" -eq 1 \] && echo release \|\| echo debug\)"/);
  assert.match(buildScript, /-p buildMode="\$BUILD_MODE"/);
  assert.match(buildScript, /assembleApp/);
  assert.match(buildScript, /HARMONY_SIGN_PROFILE/);
  assert.match(buildScript, /create_hvigor_signing_config/);
  assert.match(buildScript, /verify_app_pack/);
});
