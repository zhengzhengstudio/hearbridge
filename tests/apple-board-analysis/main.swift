import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

for game in BoardGameKind.allCases {
    let puzzles = BoardAnalysis.builtInPuzzles(for: game)
    require(puzzles.count >= 3, "\(game.rawValue) needs at least three puzzles")
    require(Set(puzzles.map(\.id)).count == puzzles.count, "puzzle ids must be unique")
    require(puzzles.allSatisfy { !$0.solution.isEmpty }, "every puzzle needs a solution")
}

let puzzle = BoardAnalysis.builtInPuzzles(for: .gomoku)[0]
let solved = BoardAnalysis.evaluate(puzzle: puzzle, move: puzzle.solution[0])
require(solved.solved, "the documented solution must solve its puzzle")
let wrong = BoardAnalysis.legalMoves(in: puzzle.position).first { !puzzle.solution.contains($0) }!
require(!BoardAnalysis.evaluate(puzzle: puzzle, move: wrong).solved, "a legal wrong move must not solve the puzzle")

var attack = BoardPosition.empty(game: .gomoku)
attack.turn = "black"
for col in 3...6 { attack[7, col] = "black" }
let analysis = BoardAnalysis.analyze(attack, difficulty: .hard)
require(analysis.tactical == "立即获胜", "forced win needs a tactical label")
require(analysis.principalVariation.first == analysis.recommended, "principal variation starts with recommendation")
require((0...1).contains(analysis.confidence), "confidence stays normalized")

print("Apple board analysis tests passed")
