package cn.zhengzhengstudio.boardgames;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.Test;

public class BoardAnalysisTest {
    @Test
    public void everyStudyGameHasThreeDistinctPuzzles() {
        for (String game : new String[]{"gobang", "go", "xiangqi"}) {
            List<BoardAnalysis.Puzzle> puzzles = BoardAnalysis.builtInPuzzles(game);
            assertTrue(game, puzzles.size() >= 3);
            Set<String> ids = new HashSet<>();
            for (BoardAnalysis.Puzzle puzzle : puzzles) {
                assertTrue(ids.add(puzzle.id));
                assertEquals(game, puzzle.position.game);
                assertFalse(puzzle.solution.isEmpty());
            }
        }
    }

    @Test
    public void puzzleEvaluationRejectsALegalNonSolution() {
        BoardAnalysis.Puzzle puzzle = BoardAnalysis.builtInPuzzles("gobang").get(0);
        BoardAnalysis.PuzzleResult solved = BoardAnalysis.evaluatePuzzle(puzzle, puzzle.solution.get(0));
        assertTrue(solved.ok);
        assertTrue(solved.solved);

        BoardAnalysis.Move wrong = null;
        for (BoardAnalysis.Move move : BoardAnalysis.legalMoves(puzzle.position)) {
            if (!BoardAnalysis.sameMove(move, puzzle.solution.get(0))) {
                wrong = move;
                break;
            }
        }
        assertNotNull(wrong);
        BoardAnalysis.PuzzleResult rejected = BoardAnalysis.evaluatePuzzle(puzzle, wrong);
        assertTrue(rejected.ok);
        assertFalse(rejected.solved);
    }

    @Test
    public void challengeAnalysisExplainsImmediateWinAndPrincipalVariation() {
        String[] board = new String[225];
        java.util.Arrays.fill(board, "");
        for (int column = 3; column <= 6; column++) board[7 * 15 + column] = "1";
        BoardAnalysis.Position position = new BoardAnalysis.Position("gobang", 15, board, 1);
        BoardAnalysis.Analysis analysis = BoardAnalysis.analyze(position, BoardAnalysis.Difficulty.CHALLENGE);
        assertEquals("立即获胜", analysis.tactical);
        assertFalse(analysis.principalVariation.isEmpty());
        assertTrue(analysis.confidence >= 0 && analysis.confidence <= 1);
        assertTrue(BoardAnalysis.sameMove(analysis.recommended, analysis.principalVariation.get(0)));
    }

    @Test
    public void editorPlacementTogglesTheSelectedPiece() {
        String[] board = new String[225];
        java.util.Arrays.fill(board, "");
        BoardAnalysis.Position source = new BoardAnalysis.Position("gobang", 15, board, 2);
        BoardAnalysis.Position placed = BoardAnalysis.editPosition(source, 112, "1");
        assertEquals("1", placed.board[112]);
        assertEquals(2, placed.currentPlayer);
        BoardAnalysis.Position removed = BoardAnalysis.editPosition(placed, 112, "1");
        assertEquals("", removed.board[112]);
    }

    @Test
    public void standardXiangqiPositionContainsBothKings() {
        BoardAnalysis.Position position = BoardAnalysis.standardPosition("xiangqi", 0);
        assertEquals(90, position.board.length);
        assertEquals("bK", position.board[4]);
        assertEquals("rK", position.board[85]);
        assertTrue(BoardAnalysis.validateEditor(position).ok);
    }
}
