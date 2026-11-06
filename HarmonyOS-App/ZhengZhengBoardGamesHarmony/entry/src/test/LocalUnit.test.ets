import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';
import {
  analyzeBoard,
  editBoardPosition,
  evaluatePuzzle,
  puzzlePositions,
  standardBoard,
  validateEditorState
} from '../main/ets/model/BoardAnalysis';

export default function localUnitTest() {
  describe('localUnitTest', () => {
    // Defines a test suite. Two parameters are supported: test suite name and test suite function.
    beforeAll(() => {
      // Presets an action, which is performed only once before all test cases of the test suite start.
      // This API supports only one parameter: preset action function.
    });
    beforeEach(() => {
      // Presets an action, which is performed before each unit test case starts.
      // The number of execution times is the same as the number of test cases defined by **it**.
      // This API supports only one parameter: preset action function.
    });
    afterEach(() => {
      // Presets a clear action, which is performed after each unit test case ends.
      // The number of execution times is the same as the number of test cases defined by **it**.
      // This API supports only one parameter: clear action function.
    });
    afterAll(() => {
      // Presets a clear action, which is performed after all test cases of the test suite end.
      // This API supports only one parameter: clear action function.
    });
    it('assertContain', 0, () => {
      // Defines a test case. This API supports three parameters: test case name, filter parameter, and test case function.
      let a = 'abc';
      let b = 'b';
      // Defines a variety of assertion methods, which are used to declare expected boolean conditions.
      expect(a).assertContain(b);
      expect(a).assertEqual(a);
    });
    it('boardStudyHasPuzzleCatalogAndAnalysisLine', 0, () => {
      const puzzles = puzzlePositions('gobang');
      expect(puzzles.length >= 3).assertTrue();
      expect(puzzles[0].solution.length > 0).assertTrue();
      expect(evaluatePuzzle(puzzles[0], puzzles[0].solution[0]).solved).assertTrue();

      const board: number[] = Array(225).fill(0);
      for (let column = 3; column <= 6; column++) board[7 * 15 + column] = 1;
      const analysis = analyzeBoard('gobang', board, 1, '挑战');
      expect(analysis.tactical).assertEqual('立即获胜');
      expect(analysis.principalVariation.length > 0).assertTrue();
      expect(analysis.confidence >= 0 && analysis.confidence <= 1).assertTrue();
    });
    it('boardEditorBuildsAValidStandardXiangqiPosition', 0, () => {
      const board = standardBoard('chinese-chess') as string[];
      expect(board.length).assertEqual(90);
      expect(board.filter((piece: string) => piece === '帥').length).assertEqual(1);
      expect(board.filter((piece: string) => piece === '將').length).assertEqual(1);
      expect(validateEditorState('chinese-chess', board).valid).assertTrue();
    });
    it('boardEditorTogglesTheSelectedPiece', 0, () => {
      const empty: number[] = standardBoard('gobang') as number[];
      const placed = editBoardPosition('gobang', empty, 112, 1) as number[];
      const removed = editBoardPosition('gobang', placed, 112, 1) as number[];
      expect(placed[112]).assertEqual(1);
      expect(removed[112]).assertEqual(0);
    });
  });
}
