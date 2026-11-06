const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Android only applies line wins to Gomoku and Tic-Tac-Toe', () => {
  const android = source('MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java');
  assert.match(android, /if \(!\(isGobang\(\) \|\| isTicTacToe\(\)\)\) return false;/);
});

test('Apple only applies line wins to Gomoku and Tic-Tac-Toe', () => {
  const apple = source('MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift');
  assert.match(apple, /guard isGobangGame \|\| isTicTacToeGame else \{ return false \}/);
});

test('HarmonyOS ignores line-win evaluation outside Gomoku', () => {
  const harmony = source('HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets');
  assert.match(harmony, /if \(this\.selectedGame === 'gobang' && this\.hasWon\(index, piece\)\)/);
});
