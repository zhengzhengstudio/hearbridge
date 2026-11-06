const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const javaDir = path.join(root, 'MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames');
const analysisFile = path.join(javaDir, 'BoardAnalysis.java');
const activityFile = path.join(javaDir, 'MainActivity.java');

function compileAndRunHarness() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-board-analysis-'));
  const javaHome = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  const javac = path.join(javaHome, 'bin/javac');
  const java = path.join(javaHome, 'bin/java');
  const harness = path.join(work, 'BoardAnalysisHarness.java');
  fs.writeFileSync(harness, String.raw`
import cn.zhengzhengstudio.boardgames.BoardAnalysis;
import java.util.Arrays;

public final class BoardAnalysisHarness {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static String[] empty(int size) {
    String[] board = new String[size * size];
    Arrays.fill(board, "");
    return board;
  }

  public static void main(String[] args) {
    String[] gomoku = empty(15);
    for (int col = 4; col < 8; col++) gomoku[7 * 15 + col] = "1";
    BoardAnalysis.Position gomokuPosition = new BoardAnalysis.Position("gobang", 15, gomoku, 1);
    BoardAnalysis.Analysis easy = BoardAnalysis.analyze(gomokuPosition, BoardAnalysis.Difficulty.EASY);
    BoardAnalysis.Analysis challenge = BoardAnalysis.analyze(gomokuPosition, BoardAnalysis.Difficulty.CHALLENGE);
    check(easy.recommended != null &&
        (easy.recommended.index == 7 * 15 + 3 || easy.recommended.index == 7 * 15 + 8),
        "五子棋 AI 应找到确定胜着");
    check(challenge.nodes > easy.nodes, "提高难度必须增加实际搜索量");

    String[] go = empty(5);
    go[1 * 5 + 1] = "2";
    go[0 * 5 + 1] = "1";
    go[1 * 5 + 0] = "1";
    go[2 * 5 + 1] = "1";
    BoardAnalysis.Position goPosition = new BoardAnalysis.Position("go", 5, go, 1);
    BoardAnalysis.Move capture = new BoardAnalysis.Move(1 * 5 + 2);
    BoardAnalysis.ApplyResult captured = BoardAnalysis.applyMove(goPosition, capture);
    check(captured.ok && captured.position.board[1 * 5 + 1].isEmpty(), "围棋应正确提子");
    BoardAnalysis.Position suicide = new BoardAnalysis.Position("go", 3,
        new String[]{"", "2", "", "2", "", "2", "", "2", ""}, 1);
    check(!BoardAnalysis.applyMove(suicide, new BoardAnalysis.Move(4)).ok, "围棋应拒绝禁入点");

    String[] xiangqi = empty(90);
    xiangqi[0 * 9 + 4] = "bK";
    xiangqi[9 * 9 + 4] = "rK";
    xiangqi[5 * 9 + 4] = "rP";
    xiangqi[7 * 9 + 0] = "rR";
    xiangqi[3 * 9 + 0] = "bP";
    BoardAnalysis.Position xiangqiPosition = new BoardAnalysis.Position("xiangqi", 0, xiangqi, 1);
    BoardAnalysis.Move rookCapture = new BoardAnalysis.Move(7 * 9, 3 * 9);
    check(BoardAnalysis.applyMove(xiangqiPosition, rookCapture).ok, "象棋车应能沿直线吃子");
    check(!BoardAnalysis.legalMoves(xiangqiPosition).isEmpty(), "象棋离线 AI 必须有合法着生成");

    BoardAnalysis.Puzzle puzzle = BoardAnalysis.builtInPuzzle("xiangqi", 0);
    check(puzzle != null && "xiangqi".equals(puzzle.position.game) && !puzzle.goal.isEmpty(),
        "象棋应提供离线残局");
    String[] invalidXiangqi = empty(90);
    invalidXiangqi[9 * 9 + 4] = "rK";
    BoardAnalysis.Validation invalid = BoardAnalysis.validateEditor(
        new BoardAnalysis.Position("xiangqi", 0, invalidXiangqi, 1));
    check(!invalid.ok && invalid.message.contains("黑方将"), "摆盘校验应指出缺少的棋子");

    long now = 2_000_000L;
    BoardAnalysis.RoomInvite invite = BoardAnalysis.parseRoomInvite(
        "zhengzhengboardgames://join?v=1&purpose=continue&game=gobang&room=123456&invite=abc_123&expires=2060000",
        now);
    check(invite.version == 1 && "continue".equals(invite.purpose) && "123456".equals(invite.room),
        "应解析跨端继续对局邀请");
    check(BoardAnalysis.tryParseRoomInvite(
        "zhengzhengboardgames://join?v=1&purpose=challenge&game=rummy&room=654321&invite=abc&expires=2060000", now).ok,
        "房间邀请协议应兼容桌游中心现有棋种");
    check(!BoardAnalysis.tryParseRoomInvite(
        "zhengzhengboardgames://join?v=1&purpose=spectate&game=gobang&room=123456&invite=abc&expires=2060000", now).ok,
        "只允许继续对局或挑战邀请");
    check(!BoardAnalysis.tryParseRoomInvite(
        "zhengzhengboardgames://join?v=1&purpose=challenge&game=go&room=123456&invite=abc&expires=1999999", now).ok,
        "过期邀请必须被拒绝");
    check(BoardAnalysis.tryParseRoomInvite(
        "zhengzhengboardgames://join?game=gobang&room=123456&token=legacy&expiresAt=2060000", now).ok,
        "应兼容旧版 Android 邀请字段");
  }
}
`);
  execFileSync(javac, ['-d', work, analysisFile, harness], { stdio: 'pipe' });
  execFileSync(java, ['-cp', work, 'BoardAnalysisHarness'], { stdio: 'pipe' });
}

test('pure Java analysis core handles offline AI, rules, puzzles, editor and room invites', () => {
  assert.equal(fs.existsSync(analysisFile), true, 'BoardAnalysis.java should exist');
  compileAndRunHarness();
});

test('MainActivity exposes in-game study tools and uses the pure AI core', () => {
  const source = fs.readFileSync(activityFile, 'utf8');
  assert.match(source, /showBoardStudyDialog/);
  assert.match(source, /BoardAnalysis\.analyze/);
  assert.match(source, /loadBuiltInPuzzle/);
  assert.match(source, /toggleBoardEditor/);
  assert.match(source, /parseRoomInvite/);
  assert.doesNotMatch(source, /aiDifficulty\s*<=\s*1\s*\?\s*boardView\.randomLegalMove/);
});
