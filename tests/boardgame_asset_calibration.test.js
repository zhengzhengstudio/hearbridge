const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('every generated board asset is decodable and keeps its intended format', () => {
  const expected = {
    'card-table.png': [1280, 1280],
    'checkers-board.png': [1280, 1280],
    'draughts-board.png': [1280, 1280],
    'ludo-board.png': [1280, 1280],
    'property-board.png': [1280, 1280],
    'reversi-board.png': [1280, 1280],
    'rummy-table.png': [1280, 800],
    'tictactoe-board.png': [1280, 1280],
    'xiangqi-board.png': [1280, 1280]
  };
  for (const [name, size] of Object.entries(expected)) {
    assert.deepEqual(pngSize(path.join(root, 'assets/boardgames/generated', name)), size, name);
  }
});

test('rule-sensitive boards are calibrated instead of trusting generated geometry', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/calibrate_boardgame_assets.py'), 'utf8');
  assert.match(script, /range\(9\)/);
  assert.match(script, /range\(10\)/);
  assert.match(script, /column in \(0, 8\)/);
  assert.match(script, /ys\[4\]/);
  assert.match(script, /ys\[5\]/);
  assert.match(script, /range\(15\)/);
  assert.match(script, /in_cross/);
  assert.match(script, /in_center/);
  assert.match(script, /same-colour jump squares/);
  assert.match(script, /Dotted cross-flight routes/);
  assert.match(script, /render_property_china/);
  assert.match(script, /map_crop/);
});

test('calibrated board masters are identical in HarmonyOS, Android and Apple resources', () => {
  const copies = {
    'xiangqi-board.png': [
      'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/xiangqi_board.png',
      'HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/resources/base/media/xiangqi_board.png',
      'MultipleBoardGamesAndroid/app/src/main/res/drawable-nodpi/xiangqi_board.png',
      'MultipleBoardGames/MultipleBoardGames Shared/Assets.xcassets/BoardChineseChess.imageset/board-chinese-chess.png'
    ],
    'ludo-board.png': [
      'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/ludo_board.png',
      'HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/resources/base/media/ludo_board.png',
      'MultipleBoardGamesAndroid/app/src/main/res/drawable-nodpi/ludo_board.png',
      'MultipleBoardGames/MultipleBoardGames Shared/Assets.xcassets/BoardLudo.imageset/board-ludo.png'
    ],
    'property-board.png': [
      'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media/property_board.png',
      'HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/resources/base/media/property_board.png',
      'MultipleBoardGamesAndroid/app/src/main/res/drawable-nodpi/property_board.png',
      'MultipleBoardGames/MultipleBoardGames Shared/Assets.xcassets/BoardProperty.imageset/board-property.png'
    ]
  };
  for (const [master, destinations] of Object.entries(copies)) {
    const masterHash = hash(path.join(root, 'assets/boardgames/generated', master));
    for (const destination of destinations) {
      assert.equal(hash(path.join(root, destination)), masterHash, destination);
    }
  }
});
