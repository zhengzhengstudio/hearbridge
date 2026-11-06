export interface BoardMove {
  index?: number
  from?: number
  to?: number
}

export interface AppliedMove {
  board: number[] | string[]
  legal: boolean
  captured: number
  message: string
}

export interface SearchBudget {
  depth: number
  candidates: number
}

export class MoveScore {
  move: BoardMove
  score: number

  constructor(move: BoardMove, score: number) {
    this.move = move
    this.score = score
  }
}

export interface AnalysisResult {
  score: number
  recommended: BoardMove | null
  candidates: MoveScore[]
  explanation: string
  nodes: number
  confidence: number
  tactical: string
  principalVariation: BoardMove[]
}

export interface ValidationResult {
  valid: boolean
  message: string
}

export interface PuzzlePosition {
  id: string
  title: string
  board: number[] | string[]
  player: number
  goal: string
  difficulty: string
  solution: BoardMove[]
}

export interface PuzzleEvaluation {
  ok: boolean
  solved: boolean
  message: string
  board: number[] | string[]
}

const GOBANG_SIDE: number = 15
// 围棋路数支持 13/19：由 Index.ets 在切换棋盘尺寸时调用 setGoBoardSide 同步
let GO_SIDE: number = 19

export function setGoBoardSide(size: number): void {
  GO_SIDE = size === 13 ? 13 : 19
}
const XIANGQI_ROWS: number = 10
const XIANGQI_COLUMNS: number = 9
const WIN_SCORE: number = 1000000

export function difficultyBudget(level: string): SearchBudget {
  if (level === '轻松') return { depth: 1, candidates: 8 }
  if (level === '困难' || level === '挑战') return { depth: 3, candidates: 24 }
  return { depth: 2, candidates: 16 }
}

function numberBoard(board: number[] | string[], size: number): number[] {
  const result: number[] = Array(size).fill(0)
  for (let index = 0; index < Math.min(size, board.length); index++) {
    const value = board[index]
    result[index] = typeof value === 'number' ? value : 0
  }
  return result
}

function stringBoard(board: number[] | string[], size: number): string[] {
  const result: string[] = Array(size).fill('')
  for (let index = 0; index < Math.min(size, board.length); index++) {
    const value = board[index]
    result[index] = typeof value === 'string' ? value : ''
  }
  return result
}

function inside(row: number, column: number, rows: number, columns: number): boolean {
  return row >= 0 && row < rows && column >= 0 && column < columns
}

function lineCount(board: number[], side: number, index: number, piece: number, dr: number, dc: number): number {
  const row = Math.floor(index / side)
  const column = index % side
  let count = 1
  let r = row + dr
  let c = column + dc
  while (inside(r, c, side, side) && board[r * side + c] === piece) {
    count += 1
    r += dr
    c += dc
  }
  r = row - dr
  c = column - dc
  while (inside(r, c, side, side) && board[r * side + c] === piece) {
    count += 1
    r -= dr
    c -= dc
  }
  return count
}

export function boardWinner(game: string, board: number[] | string[], lastIndex: number, piece: number): number {
  if (game === 'gobang') {
    const values = numberBoard(board, GOBANG_SIDE * GOBANG_SIDE)
    const directions: number[][] = [[1, 0], [0, 1], [1, 1], [1, -1]]
    for (let direction of directions) {
      if (lineCount(values, GOBANG_SIDE, lastIndex, piece, direction[0], direction[1]) >= 5) return piece
    }
    return 0
  }
  if (game === 'chinese-chess') {
    const values = stringBoard(board, 90)
    if (!values.includes('帥')) return 2
    if (!values.includes('將')) return 1
  }
  return 0
}

function nearbyCandidates(board: number[], side: number): BoardMove[] {
  const occupied: number[] = []
  board.forEach((value: number, index: number) => {
    if (value !== 0) occupied.push(index)
  })
  if (occupied.length === 0) return [{ index: Math.floor(board.length / 2) }]
  const marked: boolean[] = Array(board.length).fill(false)
  for (let origin of occupied) {
    const row = Math.floor(origin / side)
    const column = origin % side
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = row + dr
        const c = column + dc
        if (inside(r, c, side, side) && board[r * side + c] === 0) marked[r * side + c] = true
      }
    }
  }
  const moves: BoardMove[] = []
  marked.forEach((value: boolean, index: number) => {
    if (value) moves.push({ index: index })
  })
  return moves
}

function goNeighbors(index: number): number[] {
  const row = Math.floor(index / GO_SIDE)
  const column = index % GO_SIDE
  const result: number[] = []
  if (row > 0) result.push(index - GO_SIDE)
  if (row < GO_SIDE - 1) result.push(index + GO_SIDE)
  if (column > 0) result.push(index - 1)
  if (column < GO_SIDE - 1) result.push(index + 1)
  return result
}

function goGroup(board: number[], start: number): number[] {
  const color = board[start]
  const queue: number[] = [start]
  const visited: boolean[] = Array(board.length).fill(false)
  const group: number[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || visited[current]) continue
    visited[current] = true
    group.push(current)
    for (let neighbor of goNeighbors(current)) {
      if (!visited[neighbor] && board[neighbor] === color) queue.push(neighbor)
    }
  }
  return group
}

function goLiberties(board: number[], group: number[]): number {
  const marked: boolean[] = Array(board.length).fill(false)
  let liberties = 0
  for (let stone of group) {
    for (let neighbor of goNeighbors(stone)) {
      if (board[neighbor] === 0 && !marked[neighbor]) {
        marked[neighbor] = true
        liberties += 1
      }
    }
  }
  return liberties
}

function boardsEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function applyGo(board: number[], index: number, player: number, previousBoard?: number[]): AppliedMove {
  if (index < 0 || index >= board.length || board[index] !== 0) {
    return { board: board.slice(), legal: false, captured: 0, message: '该交叉点不能落子' }
  }
  const next = board.slice()
  next[index] = player
  const opponent = player === 1 ? 2 : 1
  let captured = 0
  for (let neighbor of goNeighbors(index)) {
    if (next[neighbor] !== opponent) continue
    const group = goGroup(next, neighbor)
    if (goLiberties(next, group) === 0) {
      for (let stone of group) next[stone] = 0
      captured += group.length
    }
  }
  if (goLiberties(next, goGroup(next, index)) === 0) {
    return { board: board.slice(), legal: false, captured: 0, message: '禁入点：落子后没有气' }
  }
  if (previousBoard && previousBoard.length === next.length && boardsEqual(next, previousBoard)) {
    return { board: board.slice(), legal: false, captured: 0, message: '劫争：不能立即回提还原上一局面' }
  }
  return { board: next, legal: true, captured: captured, message: captured > 0 ? `提掉 ${captured} 子` : '落子完成' }
}

// 注意：JS 的 String.includes('') 恒为 true，直接写 `'俥傌相仕帥炮兵'.includes(piece)`
// 会把所有空格判成红方棋子，进而让象/士/帅/兵 的走法表整个错乱（表现为"没有合法走法"）。
// 所以这里必须先挡掉空串。
function pieceSide(piece: string): number {
  if (piece.length === 0) return 0
  if ('俥傌相仕帥炮兵'.includes(piece)) return 1
  if ('車馬象士將砲卒'.includes(piece)) return 2
  return 0
}

function inPalace(side: number, row: number, column: number): boolean {
  if (column < 3 || column > 5) return false
  return side === 1 ? row >= 7 && row <= 9 : row >= 0 && row <= 2
}

function pathCount(board: string[], from: number, to: number): number {
  const fromRow = Math.floor(from / 9)
  const fromColumn = from % 9
  const toRow = Math.floor(to / 9)
  const toColumn = to % 9
  let count = 0
  if (fromRow === toRow) {
    for (let column = Math.min(fromColumn, toColumn) + 1; column < Math.max(fromColumn, toColumn); column++) {
      if (board[fromRow * 9 + column].length > 0) count += 1
    }
  } else if (fromColumn === toColumn) {
    for (let row = Math.min(fromRow, toRow) + 1; row < Math.max(fromRow, toRow); row++) {
      if (board[row * 9 + fromColumn].length > 0) count += 1
    }
  }
  return count
}

function pseudoXiangqiMoves(board: string[], player: number): BoardMove[] {
  const moves: BoardMove[] = []
  for (let from = 0; from < board.length; from++) {
    const piece = board[from]
    if (pieceSide(piece) !== player) continue
    const row = Math.floor(from / 9)
    const column = from % 9
    for (let to = 0; to < board.length; to++) {
      if (to === from || pieceSide(board[to]) === player) continue
      const targetRow = Math.floor(to / 9)
      const targetColumn = to % 9
      const dr = targetRow - row
      const dc = targetColumn - column
      const ar = Math.abs(dr)
      const ac = Math.abs(dc)
      let valid = false
      if ('俥車'.includes(piece)) {
        valid = (dr === 0 || dc === 0) && pathCount(board, from, to) === 0
      } else if ('炮砲'.includes(piece)) {
        const screens = pathCount(board, from, to)
        valid = (dr === 0 || dc === 0) && (board[to].length === 0 ? screens === 0 : screens === 1)
      } else if ('傌馬'.includes(piece)) {
        if ((ar === 2 && ac === 1) || (ar === 1 && ac === 2)) {
          const legRow = row + (ar === 2 ? dr / 2 : 0)
          const legColumn = column + (ac === 2 ? dc / 2 : 0)
          valid = board[legRow * 9 + legColumn].length === 0
        }
      } else if ('相象'.includes(piece)) {
        if (ar === 2 && ac === 2) {
          const ownHalf = player === 1 ? targetRow >= 5 : targetRow <= 4
          valid = ownHalf && board[(row + dr / 2) * 9 + column + dc / 2].length === 0
        }
      } else if ('仕士'.includes(piece)) {
        valid = ar === 1 && ac === 1 && inPalace(player, targetRow, targetColumn)
      } else if ('帥將'.includes(piece)) {
        valid = ar + ac === 1 && inPalace(player, targetRow, targetColumn)
      } else if ('兵卒'.includes(piece)) {
        const forward = player === 1 ? -1 : 1
        const crossed = player === 1 ? row <= 4 : row >= 5
        valid = (dr === forward && dc === 0) || (crossed && dr === 0 && ac === 1)
      }
      if (valid) moves.push({ from: from, to: to })
    }
  }
  return moves
}

function rawXiangqiMove(board: string[], move: BoardMove): string[] {
  const next = board.slice()
  const from = move.from === undefined ? -1 : move.from
  const to = move.to === undefined ? -1 : move.to
  if (from >= 0 && to >= 0) {
    next[to] = next[from]
    next[from] = ''
  }
  return next
}

function kingsFace(board: string[]): boolean {
  const red = board.indexOf('帥')
  const black = board.indexOf('將')
  if (red < 0 || black < 0 || red % 9 !== black % 9) return false
  return pathCount(board, red, black) === 0
}

function xiangqiInCheck(board: string[], player: number): boolean {
  const king = board.indexOf(player === 1 ? '帥' : '將')
  if (king < 0 || kingsFace(board)) return true
  const opponent = player === 1 ? 2 : 1
  return pseudoXiangqiMoves(board, opponent).some((move: BoardMove) => move.to === king)
}

function legalXiangqiMoves(board: string[], player: number): BoardMove[] {
  return pseudoXiangqiMoves(board, player).filter((move: BoardMove) => {
    return !xiangqiInCheck(rawXiangqiMove(board, move), player)
  })
}

export function legalMoves(game: string, board: number[] | string[], player: number,
  previousBoard?: number[] | string[]): BoardMove[] {
  if (game === 'gobang') return nearbyCandidates(numberBoard(board, 225), GOBANG_SIDE)
  if (game === 'go') {
    // 残题按当前路数生成：13 路下这些绝对下标会落到盘外，
    // 所以一律用「离中心几个点」的相对位置，两种路数都能用。
    // 白子只剩一气（未被黑子占住的那个邻点就是答案），黑先填上去即可提子。
    const n = GO_SIDE
    const at = (dr: number, dc: number): number => {
      const mid = Math.floor(n / 2)
      return (mid + dr) * n + (mid + dc)
    }
    // 白子摆在 target，上下左右用黑子封三面，剩下的一口就是 answer
    const build = (target: number, answer: number): number[] => {
      const board: number[] = Array(n * n).fill(0)
      board[target] = 2
      const row = Math.floor(target / n)
      const col = target % n
      const around: number[] = []
      if (row > 0) around.push(target - n)
      if (row < n - 1) around.push(target + n)
      if (col > 0) around.push(target - 1)
      if (col < n - 1) around.push(target + 1)
      around.forEach((point: number) => { if (point !== answer) board[point] = 1 })
      return board
    }
    const t1 = at(0, 0)
    const t2 = at(2, 2)
    const t3 = at(-3, 1)
    return [
      { id: 'go-001', title: '中央提子', board: build(t1, t1 + 1), player: 1, goal: '黑先，找到白棋最后一口气', difficulty: '入门', solution: [{ index: t1 + 1 }] },
      { id: 'go-002', title: '边上收气', board: build(t2, t2 - 1), player: 1, goal: '黑先，找到白棋最后一口气', difficulty: '进阶', solution: [{ index: t2 - 1 }] },
      { id: 'go-003', title: '下边提子', board: build(t3, t3 + n), player: 1, goal: '黑先，找到白棋最后一口气', difficulty: '进阶', solution: [{ index: t3 + n }] }
    ]
  }
  const first: string[] = Array(90).fill('')
  first[4] = '將'; first[85] = '帥'; first[13] = '俥'
  const second: string[] = Array(90).fill('')
  second[4] = '將'; second[85] = '帥'; second[76] = '車'
  const third: string[] = Array(90).fill('')
  third[4] = '將'; third[13] = '士'; third[22] = '炮'; third[85] = '帥'
  return [
    { id: 'xiangqi-001', title: '车取黑将', board: first, player: 1, goal: '红先，找到立即取胜着', difficulty: '入门', solution: [{ from: 13, to: 4 }] },
    { id: 'xiangqi-002', title: '黑车绝杀', board: second, player: 2, goal: '黑先，直接擒帅', difficulty: '进阶', solution: [{ from: 76, to: 85 }] },
    { id: 'xiangqi-003', title: '隔山打将', board: third, player: 1, goal: '红先，炮借士架擒将', difficulty: '进阶', solution: [{ from: 22, to: 4 }] }
  ]
}

export function puzzlePosition(game: string, level: number = 0): PuzzlePosition {
  const puzzles = puzzlePositions(game)
  return puzzles[((level % puzzles.length) + puzzles.length) % puzzles.length]
}

function sameMove(left: BoardMove, right: BoardMove): boolean {
  if (left.index !== undefined || right.index !== undefined) return left.index === right.index
  return left.from === right.from && left.to === right.to
}

export function evaluatePuzzle(puzzle: PuzzlePosition, move: BoardMove): PuzzleEvaluation {
  const applied = applyBoardMove(puzzle.id.startsWith('xiangqi') ? 'chinese-chess' : puzzle.id.startsWith('go-') ? 'go' : 'gobang',
    puzzle.board, move, puzzle.player)
  if (!applied.legal) return { ok: false, solved: false, message: applied.message, board: puzzle.board.slice() }
  let solved = false
  for (let answer of puzzle.solution) if (sameMove(answer, move)) solved = true
  return { ok: true, solved: solved, message: solved ? '解答正确' : '这步合法，但不是关键着，再想一想。', board: applied.board }
}
