const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'website/zhengzhengstudio.cn/boardgames');
const android = path.join(root, 'MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java');
const apple = path.join(root, 'MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift');
const harmony = path.join(root, 'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('web functional boards do not stack legacy board artwork under generated geometry', () => {
  for (const page of ['checkers.html', 'chess.html', 'ludo.html', 'monopoly.html', 'tictactoe.html']) {
    const html = source(path.join(web, page));
    assert.doesNotMatch(html, /assets\/boards\/(checkers-board|xiangqi-board|ludo-board|property-board|tictactoe-board)\.jpg/, `${page} still stacks a legacy board image`);
  }
});

test('web puzzle and editor are distinct, self-explanatory workflows', () => {
  const js = source(path.join(web, 'analysis-studio.js'));
  for (const text of ['题面已摆好', '只需要走下一步', '下一题', '重新开始本题', '退出训练', '第一步：选择棋子', '第二步：点击棋盘摆放', '第三步：检查并开始']) {
    assert.ok(js.includes(text), `missing study workflow copy: ${text}`);
  }
  assert.match(js, /data-action="reset-puzzle"/);
  assert.match(js, /data-action="exit-puzzle"/);
});

test('native renderers use programmatic board geometry instead of stacking old texture boards', () => {
  const java = source(android);
  assert.doesNotMatch(java, /(?:reversi|ticTacToe|checkers|chineseChess|ludo|rummy|property|card)Texture/);
  assert.doesNotMatch(java, /drawTexture\s*\(/);

  const swift = source(apple);
  assert.doesNotMatch(swift, /addBoardTexture\("Board(?:Reversi|TicTacToe|Rummy|Ludo|Checkers|ChineseChess|Property)"/);

  const ets = source(harmony);
  assert.doesNotMatch(ets, /Image\(\$r\('app\.media\.property_board'\)\)/);
});

test('native study controls distinguish solving a puzzle from arranging a custom board', () => {
  const java = source(android);
  for (const text of ['题面已摆好', '走下一步', '下一题', '重新开始本题', '退出残局']) assert.ok(java.includes(text), `Android missing ${text}`);

  const swift = source(apple);
  for (const text of ['题面已摆好', '走下一步', '下一题', '重新开始', '退出残局']) assert.ok(swift.includes(text), `Apple missing ${text}`);

  const ets = source(harmony);
  for (const text of ['题面已摆好', '只需走下一步', '下一题', '重新开始本题', '退出残局']) assert.ok(ets.includes(text), `HarmonyOS missing ${text}`);
});
