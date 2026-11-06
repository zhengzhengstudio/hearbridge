const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const shared = path.join(root, 'MultipleBoardGames', 'MultipleBoardGames Shared');
const corePath = path.join(shared, 'BoardAnalysis.swift');
const invitePath = path.join(shared, 'BoardRoomInvite.swift');
const scenePath = path.join(shared, 'MainMenuScene.swift');
const projectPath = path.join(root, 'MultipleBoardGames', 'MultipleBoardGames.xcodeproj', 'project.pbxproj');

test('Apple shared target contains the offline board-analysis and invitation cores', () => {
  assert.ok(fs.existsSync(corePath), 'BoardAnalysis.swift is missing');
  assert.ok(fs.existsSync(invitePath), 'BoardRoomInvite.swift is missing');
  const core = fs.readFileSync(corePath, 'utf8');
  const invite = fs.readFileSync(invitePath, 'utf8');
  for (const symbol of ['bestMove', 'analyze', 'legalMoves', 'apply', 'validate', 'builtInPuzzles']) {
    assert.match(core, new RegExp(`\\b${symbol}\\b`), `missing ${symbol}`);
  }
  assert.match(core, /case easy[\s\S]*case medium[\s\S]*case hard/);
  assert.match(invite, /purpose[\s\S]*expiresAt[\s\S]*token/);
  assert.match(invite, /continueGame[\s\S]*challenge/);
});

test('pure Swift core makes legal offline moves for Gomoku, Go, and Xiangqi', { timeout: 30000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-apple-analysis-'));
  const harness = path.join(dir, 'main.swift');
  const binary = path.join(dir, 'analysis-tests');
  fs.writeFileSync(harness, `
import Foundation

func expect(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fputs("FAIL: \\(message)\\n", stderr); exit(1) }
}

var gomoku = BoardPosition.empty(game: .gomoku)
for col in 3...6 { gomoku[7, col] = "black" }
gomoku.turn = "black"
let easyBudget = BoardDifficulty.easy.searchBudget
let hardBudget = BoardDifficulty.hard.searchBudget
expect(hardBudget.depth > easyBudget.depth, "difficulty depth must be effective")
expect(hardBudget.candidates > easyBudget.candidates, "difficulty candidates must be effective")
let winning = BoardAnalysis.bestMove(in: gomoku, difficulty: .hard)
expect(winning?.toRow == 7 && (winning?.toCol == 2 || winning?.toCol == 7), "Gomoku must finish five")
expect(BoardAnalysis.analyze(gomoku, difficulty: .medium).recommended != nil, "Gomoku analysis missing")

var go = BoardPosition.empty(game: .go)
go[0, 1] = "black"; go[1, 0] = "black"; go[2, 1] = "black"; go[1, 1] = "white"
go.turn = "black"
let capture = BoardMove(toRow: 1, toCol: 2)
expect(BoardAnalysis.legalMoves(in: go).contains(capture), "Go capture must be legal")
let captured = BoardAnalysis.apply(capture, to: go)
expect(captured?[1, 1] == nil, "Go stone must be captured")

var chess = BoardPosition.empty(game: .xiangqi)
chess[0, 4] = "bK"; chess[9, 4] = "rK"; chess[5, 4] = "rP"
chess[9, 0] = "rR"; chess[0, 0] = "bR"; chess.turn = "red"
let rookCapture = BoardMove(fromRow: 9, fromCol: 0, toRow: 0, toCol: 0)
expect(BoardAnalysis.legalMoves(in: chess).contains(rookCapture), "Xiangqi rook capture must be legal")
expect(BoardAnalysis.apply(rookCapture, to: chess)?[0, 0] == "rR", "Xiangqi capture was not applied")

let invalid = BoardPosition.empty(game: .xiangqi)
expect(!BoardAnalysis.validate(invalid).isValid, "empty Xiangqi editor board must be invalid")
expect(!BoardAnalysis.builtInPuzzles(for: .gomoku).isEmpty, "Gomoku puzzles missing")
expect(!BoardAnalysis.builtInPuzzles(for: .go).isEmpty, "Go puzzles missing")
expect(!BoardAnalysis.builtInPuzzles(for: .xiangqi).isEmpty, "Xiangqi puzzles missing")

let now: Int64 = 2_000_000
let invite = BoardRoomInvite(version: 1, purpose: .challenge, game: "gobang", room: "123456", token: "token-abc", expiresAt: now + 60_000)
let url = invite.url(scheme: "zzboardgames")!
expect(BoardRoomInvite.parse(url, now: now)?.purpose == .challenge, "valid challenge invite did not parse")
let webCompatible = URL(string: "zhengzhengboardgames://join?v=1&purpose=continue&game=go&room=654321&invite=legacy-token&expires=2060000")!
expect(BoardRoomInvite.parse(webCompatible, now: now)?.purpose == .continueGame, "website-compatible invite did not parse")
expect(BoardRoomInvite.parse(url, now: now + 60_001) == nil, "expired invite was accepted")
expect(BoardRoomInvite.parse(URL(string: "zzboardgames://room?v=2&purpose=continue&game=go&room=123456&token=x&expiresAt=3000000")!, now: now) == nil, "unsupported protocol accepted")
print("OK")
`);
  execFileSync('swiftc', [corePath, invitePath, harness, '-o', binary], { stdio: 'pipe' });
  const output = execFileSync(binary, { encoding: 'utf8' });
  assert.match(output, /OK/);
});

test('Apple game scene exposes in-game study modes and uses the shared AI offline', () => {
  const scene = fs.readFileSync(scenePath, 'utf8');
  assert.match(scene, /case play[\s\S]*case analysis[\s\S]*case puzzle[\s\S]*case editor/);
  assert.match(scene, /BoardAnalysis\.bestMove/);
  assert.match(scene, /BoardAnalysis\.analyze/);
  assert.match(scene, /BoardAnalysis\.validate/);
  assert.match(scene, /localPractice[\s\S]*scheduleLocalAIMove/);
  assert.match(scene, /BoardRoomInvite\.parse/);
  assert.match(scene, /purpose:\s*\.continueGame/);
});

test('Apple home exposes a separate study hub and passes its setup into one shared board scene', () => {
  const scene = fs.readFileSync(scenePath, 'utf8');
  assert.match(scene, /drawStudyHub\(\)/);
  assert.match(scene, /buttonFrames\["study-hub"\]/);
  assert.match(scene, /study-game:/);
  assert.match(scene, /study-mode:/);
  assert.match(scene, /study-side:/);
  assert.match(scene, /study-difficulty:/);
  assert.match(scene, /initialStudyMode:/);
  assert.match(scene, /initialStudySide:/);
  assert.match(scene, /initialDifficulty:/);
  assert.match(scene, /openLocalPractice\([\s\S]*studyMode:[\s\S]*side:[\s\S]*difficulty:/);
});

test('new Swift cores are included in both iOS and macOS source phases without version changes', () => {
  const project = fs.readFileSync(projectPath, 'utf8');
  assert.match(project, /BoardAnalysis\.swift/);
  assert.match(project, /BoardRoomInvite\.swift/);
  const analysisBuilds = (project.match(/BoardAnalysis\.swift in Sources/g) || []).length;
  const inviteBuilds = (project.match(/BoardRoomInvite\.swift in Sources/g) || []).length;
  assert.ok(analysisBuilds >= 4, 'BoardAnalysis must have file reference plus iOS/macOS build entries');
  assert.ok(inviteBuilds >= 4, 'BoardRoomInvite must have file reference plus iOS/macOS build entries');
});
