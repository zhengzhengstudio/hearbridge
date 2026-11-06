const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const projects = [
  'HarmonyOS-App/ZhengZhengBoardGamesHarmony',
  'HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline'
];

function sourcePath(project, suffix) {
  return path.join(root, project, 'entry/src/main/ets', suffix);
}

function loadCore(project) {
  const filename = sourcePath(project, 'model/BoardAnalysis.ets');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true
    },
    fileName: filename,
    reportDiagnostics: true
  });
  const errors = (output.diagnostics || []).filter((diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(errors.map((error) => error.messageText), []);
  const module = { exports: {} };
  Function('module', 'exports', output.outputText)(module, module.exports);
  return module.exports;
}

test('online and offline projects carry the same executable analysis core', () => {
  const online = fs.readFileSync(sourcePath(projects[0], 'model/BoardAnalysis.ets'), 'utf8');
  const offline = fs.readFileSync(sourcePath(projects[1], 'model/BoardAnalysis.ets'), 'utf8');
  assert.equal(online.trimEnd(), offline.trimEnd());
  for (const project of projects) loadCore(project);
});

test('difficulty levels change the local search budget', () => {
  const core = loadCore(projects[0]);
  const easy = core.difficultyBudget('轻松');
  const normal = core.difficultyBudget('标准');
  const hard = core.difficultyBudget('困难');
  assert.ok(easy.depth < normal.depth);
  assert.ok(normal.depth < hard.depth);
  assert.ok(easy.candidates < hard.candidates);
});

test('gobang analysis finds and applies an immediate winning move', () => {
  const core = loadCore(projects[0]);
  const board = Array(225).fill(0);
  [105, 106, 107, 108].forEach((index) => board[index] = 2);
  const analysis = core.analyzeBoard('gobang', board, 2, '标准');
  assert.ok([104, 109].includes(analysis.recommended.index));
  const applied = core.applyBoardMove('gobang', board, analysis.recommended, 2);
  assert.equal(core.boardWinner('gobang', applied.board, analysis.recommended.index, 2), 2);
});

test('go local rules capture surrounded stones and reject suicide', () => {
  const core = loadCore(projects[0]);
  const board = Array(361).fill(0);
  board[20] = 2;
  board[1] = 1;
  board[19] = 1;
  board[21] = 1;
  const capture = core.applyBoardMove('go', board, { index: 39 }, 1);
  assert.equal(capture.legal, true);
  assert.equal(capture.board[20], 0);
  assert.equal(capture.captured, 1);

  const suicideBoard = Array(361).fill(0);
  suicideBoard[1] = 2;
  suicideBoard[19] = 2;
  const suicide = core.applyBoardMove('go', suicideBoard, { index: 0 }, 1);
  assert.equal(suicide.legal, false);

  const beforeKo = Array(361).fill(0);
  [20, 2, 40, 22].forEach((index) => beforeKo[index] = 2);
  [1, 19, 39].forEach((index) => beforeKo[index] = 1);
  const koCapture = core.applyBoardMove('go', beforeKo, { index: 21 }, 1);
  assert.equal(koCapture.legal, true);
  const immediateRecapture = core.applyBoardMove('go', koCapture.board, { index: 20 }, 2, beforeKo);
  assert.equal(immediateRecapture.legal, false);
  assert.match(immediateRecapture.message, /劫争/);
});

test('xiangqi analysis generates legal captures and editor validation', () => {
  const core = loadCore(projects[0]);
  const board = Array(90).fill('');
  board[4] = '將';
  board[85] = '帥';
  board[76] = '俥';
  board[13] = '卒';
  const moves = core.legalMoves('chinese-chess', board, 1);
  assert.ok(moves.some((move) => move.from === 76 && move.to === 13));
  const applied = core.applyBoardMove('chinese-chess', board, { from: 76, to: 13 }, 1);
  assert.equal(applied.legal, true);
  assert.equal(applied.board[13], '俥');
  assert.equal(applied.board[76], '');
  assert.equal(core.validateEditorState('chinese-chess', board).valid, true);
  board[4] = '';
  assert.match(core.validateEditorState('chinese-chess', board).message, /黑方将/);
});

test('all three game AIs return legal moves without network dependencies', () => {
  const coreSource = fs.readFileSync(sourcePath(projects[0], 'model/BoardAnalysis.ets'), 'utf8');
  assert.doesNotMatch(coreSource, /https?:|requestText|fetch\(|WebSocket/);
  const core = loadCore(projects[0]);

  const gobang = Array(225).fill(0);
  gobang[112] = 1;
  const gobangMove = core.findBestMove('gobang', gobang, 2, '困难');
  assert.equal(core.applyBoardMove('gobang', gobang, gobangMove, 2).legal, true);

  const go = Array(361).fill(0);
  go[180] = 1;
  const goMove = core.findBestMove('go', go, 2, '标准');
  assert.equal(core.applyBoardMove('go', go, goMove, 2).legal, true);

  const xiangqi = core.puzzlePosition('chinese-chess');
  const xiangqiMove = core.findBestMove('chinese-chess', xiangqi.board, xiangqi.player, '轻松');
  assert.equal(core.applyBoardMove('chinese-chess', xiangqi.board, xiangqiMove, xiangqi.player).legal, true);
});

test('all Harmony pages wire real offline AI, analysis, puzzle and editor modes', () => {
  for (const project of projects) {
    const source = fs.readFileSync(sourcePath(project, 'pages/Index.ets'), 'utf8');
    assert.match(source, /from '..\/model\/BoardAnalysis'/);
    assert.match(source, /findBestMove\(/);
    assert.match(source, /applyBoardMove\(/);
    assert.match(source, /runLocalAi\(/);
    assert.match(source, /analyzeCurrentBoard\(/);
    assert.match(source, /\['puzzle', '残局'\]/);
    assert.match(source, /\['editor', '自建'\]/);
    assert.match(source, /ForEach\(\['轻松', '标准', '困难'\]/);
  }
});
