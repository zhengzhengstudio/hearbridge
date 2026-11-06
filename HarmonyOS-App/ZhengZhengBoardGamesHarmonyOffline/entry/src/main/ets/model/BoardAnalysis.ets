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
    const values = numberBoard(board, GO_SIDE * GO_SIDE)
    const moves: BoardMove[] = []
    for (let index = 0; index < values.length; index++) {
      const previous = previousBoard ? numberBoard(previousBoard, GO_SIDE * GO_SIDE) : undefined
      if (values[index] === 0 && applyGo(values, index, player, previous).legal) moves.push({ index: index })
    }
    return moves
  }
  if (game === 'chinese-chess') return legalXiangqiMoves(stringBoard(board, 90), player)
  return []
}

export function applyBoardMove(game: string, board: number[] | string[], move: BoardMove, player: number,
  previousBoard?: number[] | string[]): AppliedMove {
  if (game === 'gobang') {
    const values = numberBoard(board, 225)
    const index = move.index === undefined ? -1 : move.index
    if (index < 0 || index >= values.length || values[index] !== 0) {
      return { board: values, legal: false, captured: 0, message: '该位置不能落子' }
    }
    values[index] = player
    return { board: values, legal: true, captured: 0, message: '落子完成' }
  }
  if (game === 'go') return applyGo(numberBoard(board, GO_SIDE * GO_SIDE), move.index === undefined ? -1 : move.index, player,
    previousBoard ? numberBoard(previousBoard, GO_SIDE * GO_SIDE) : undefined)
  if (game === 'chinese-chess') {
    const values = stringBoard(board, 90)
    const allowed = legalXiangqiMoves(values, player).some((candidate: BoardMove) =>
      candidate.from === move.from && candidate.to === move.to)
    if (!allowed) return { board: values, legal: false, captured: 0, message: '这步不符合象棋规则' }
    const captured = move.to === undefined || values[move.to].length === 0 ? 0 : 1
    return { board: rawXiangqiMove(values, move), legal: true, captured: captured, message: captured > 0 ? '吃子完成' : '走子完成' }
  }
  return { board: board.slice(), legal: false, captured: 0, message: '暂不支持该棋种' }
}

function gobangShapeScore(board: number[], index: number, player: number): number {
  const directions: number[][] = [[1, 0], [0, 1], [1, 1], [1, -1]]
  let score = 0
  for (let direction of directions) {
    const count = lineCount(board, 15, index, player, direction[0], direction[1])
    score += count * count * count * 18
    if (count >= 5) score += WIN_SCORE
  }
  const row = Math.floor(index / 15)
  const column = index % 15
  score += 14 - Math.abs(7 - row) - Math.abs(7 - column)
  return score
}

function xiangqiValue(piece: string): number {
  if (piece.length === 0) return 0
  if ('帥將'.includes(piece)) return 100000
  if ('俥車'.includes(piece)) return 900
  if ('炮砲'.includes(piece)) return 480
  if ('傌馬'.includes(piece)) return 420
  if ('相象仕士'.includes(piece)) return 210
  if ('兵卒'.includes(piece)) return 100
  return 0
}

function xiangqiScore(board: string[], player: number): number {
  let score = 0
  for (let piece of board) {
    const side = pieceSide(piece)
    if (side === player) score += xiangqiValue(piece)
    if (side !== 0 && side !== player) score -= xiangqiValue(piece)
  }
  return score
}

function staticMoveScore(game: string, board: number[] | string[], move: BoardMove, player: number,
  previousBoard?: number[] | string[]): number {
  const applied = applyBoardMove(game, board, move, player, previousBoard)
  if (!applied.legal) return -WIN_SCORE
  if (game === 'gobang') {
    const index = move.index === undefined ? -1 : move.index
    const next = applied.board as number[]
    let score = gobangShapeScore(next, index, player)
    const opponent = player === 1 ? 2 : 1
    const threat = numberBoard(board, 225)
    threat[index] = opponent
    if (boardWinner('gobang', threat, index, opponent) === opponent) score += WIN_SCORE / 2
    return score
  }
  if (game === 'go') {
    const index = move.index === undefined ? 0 : move.index
    const row = Math.floor(index / GO_SIDE)
    const column = index % GO_SIDE
    const mid = (GO_SIDE - 1) / 2
    const center = (GO_SIDE - 1) - Math.abs(mid - row) - Math.abs(mid - column)
    const ownGroup = goGroup(applied.board as number[], index)
    return applied.captured * 800 + goLiberties(applied.board as number[], ownGroup) * 24 + center
  }
  if (game === 'chinese-chess') {
    return xiangqiScore(applied.board as string[], player) + applied.captured * 120
  }
  return 0
}

function minimaxXiangqi(board: string[], player: number, root: number, depth: number,
  alphaValue: number, betaValue: number, limit: number): number {
  if (depth <= 0 || !board.includes('帥') || !board.includes('將')) return xiangqiScore(board, root)
  let alpha = alphaValue
  let beta = betaValue
  const moves = legalXiangqiMoves(board, player)
    .sort((a: BoardMove, b: BoardMove) => xiangqiValue(board[b.to === undefined ? 0 : b.to]) - xiangqiValue(board[a.to === undefined ? 0 : a.to]))
    .slice(0, limit)
  if (moves.length === 0) return player === root ? -WIN_SCORE : WIN_SCORE
  if (player === root) {
    let best = -WIN_SCORE * 2
    for (let move of moves) {
      best = Math.max(best, minimaxXiangqi(rawXiangqiMove(board, move), player === 1 ? 2 : 1, root, depth - 1, alpha, beta, limit))
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  }
  let best = WIN_SCORE * 2
  for (let move of moves) {
    best = Math.min(best, minimaxXiangqi(rawXiangqiMove(board, move), player === 1 ? 2 : 1, root, depth - 1, alpha, beta, limit))
    beta = Math.min(beta, best)
    if (beta <= alpha) break
  }
  return best
}

export function analyzeBoard(game: string, board: number[] | string[], player: number, difficulty: string,
  previousBoard?: number[] | string[]): AnalysisResult {
  const budget = difficultyBudget(difficulty)
  let moves = legalMoves(game, board, player, previousBoard)
  const scored: MoveScore[] = moves.map((move: BoardMove) =>
    new MoveScore(move, staticMoveScore(game, board, move, player, previousBoard)))
    .sort((a: MoveScore, b: MoveScore) => b.score - a.score).slice(0, budget.candidates)
  let nodes = scored.length
  if (game === 'chinese-chess' && budget.depth > 1) {
    const values = stringBoard(board, 90)
    for (let item of scored) {
      const next = rawXiangqiMove(values, item.move)
      item.score = minimaxXiangqi(next, player === 1 ? 2 : 1, player, budget.depth - 1,
        -WIN_SCORE * 2, WIN_SCORE * 2, Math.max(6, Math.floor(budget.candidates / 2)))
      nodes += budget.candidates * budget.depth
    }
    scored.sort((a: MoveScore, b: MoveScore) => b.score - a.score)
  }
  if (difficulty === '轻松' && scored.length > 2) {
    const relaxed = scored.splice(2, 1)[0]
    scored.unshift(relaxed)
  }
  const recommended = scored.length > 0 ? scored[0].move : null
  const tactical = tacticalLabel(game, board, player, recommended, previousBoard)
  const confidence = analysisConfidence(scored)
  const principalVariation: BoardMove[] = []
  if (recommended) {
    principalVariation.push(recommended)
    if (tactical !== '立即获胜' && difficulty !== '轻松') {
      const applied = applyBoardMove(game, board, recommended, player, previousBoard)
      if (applied.legal) {
        const replies = legalMoves(game, applied.board, player === 1 ? 2 : 1, board)
        if (replies.length > 0) principalVariation.push(replies[0])
      }
    }
  }
  let explanation = '当前没有合法着法'
  if (recommended) {
    if (game === 'gobang') explanation = tactical === '立即获胜' ? '发现直接取胜点' : tactical === '必须防守' ? '必须封堵对手的取胜点' : '兼顾连线与阻断'
    if (game === 'go') explanation = scored[0].score >= 800 ? '优先提子并保持棋块有气' : '选择气较充足的落点'
    if (game === 'chinese-chess') explanation = scored[0].score > 0 ? '优先子力与将军压力' : '选择当前较稳妥的合法着'
  }
  return {
    score: scored.length > 0 ? scored[0].score : -WIN_SCORE,
    recommended: recommended,
    candidates: scored.slice(0, 3),
    explanation: explanation,
    nodes: nodes,
    confidence: confidence,
    tactical: tactical,
    principalVariation: principalVariation
  }
}

function analysisConfidence(scored: MoveScore[]): number {
  if (scored.length === 0) return 0
  const gap = scored.length > 1 ? Math.max(0, scored[0].score - scored[1].score) : Math.abs(scored[0].score)
  return Math.max(0.5, Math.min(0.99, 0.58 + Math.log10(gap + 1) * 0.08))
}

function tacticalLabel(game: string, board: number[] | string[], player: number, move: BoardMove | null,
  previousBoard?: number[] | string[]): string {
  if (!move) return '无合法着'
  const applied = applyBoardMove(game, board, move, player, previousBoard)
  if (!applied.legal) return '无合法着'
  if (game === 'gobang' && move.index !== undefined && boardWinner(game, applied.board, move.index, player) === player) return '立即获胜'
  if (game === 'chinese-chess') {
    const values = applied.board as string[]
    if (!values.includes(player === 1 ? '將' : '帥')) return '立即获胜'
    if (applied.captured > 0) return '优先吃子'
  }
  if (game === 'go' && applied.captured > 0) return `提子 ${applied.captured}`
  if (game === 'gobang' && move.index !== undefined) {
    const opponent = player === 1 ? 2 : 1
    const threat = numberBoard(board, 225)
    threat[move.index] = opponent
    if (boardWinner('gobang', threat, move.index, opponent) === opponent) return '必须防守'
  }
  return '均衡'
}

export function findBestMove(game: string, board: number[] | string[], player: number, difficulty: string,
  previousBoard?: number[] | string[]): BoardMove | null {
  return analyzeBoard(game, board, player, difficulty, previousBoard).recommended
}

export function validateEditorState(game: string, board: number[] | string[]): ValidationResult {
  if (game === 'gobang' && board.length !== 225) return { valid: false, message: '五子棋棋盘需要 15×15 个交叉点' }
  // 围棋有 13/19 两种路数，尺寸必须跟着 GO_SIDE 走；
  // 旧写法硬编码 361，切到 13 路后编辑器会把正常的 169 点棋盘判成非法。
  if (game === 'go' && board.length !== GO_SIDE * GO_SIDE) {
    return { valid: false, message: `围棋棋盘需要 ${GO_SIDE}×${GO_SIDE} 个交叉点` }
  }
  if (game === 'chinese-chess') {
    const values = stringBoard(board, 90)
    if (board.length !== 90) return { valid: false, message: '象棋棋盘需要 9×10 个位置' }
    if (values.filter((piece: string) => piece === '帥').length !== 1) return { valid: false, message: '红方帅必须且只能有一枚' }
    if (values.filter((piece: string) => piece === '將').length !== 1) return { valid: false, message: '黑方将必须且只能有一枚' }
    if (kingsFace(values)) return { valid: false, message: '将帅不能在同一路直接照面' }
  }
  return { valid: true, message: '局面规则检查通过' }
}

export function emptyBoard(game: string): number[] | string[] {
  if (game === 'gobang') return Array(225).fill(0)
  if (game === 'go') return Array(GO_SIDE * GO_SIDE).fill(0)
  if (game === 'chinese-chess') return Array(90).fill('')
  return []
}

export function standardBoard(game: string): number[] | string[] {
  if (game !== 'chinese-chess') return emptyBoard(game)
  const board: string[] = Array(90).fill('')
  const blackBack: string[] = ['車', '馬', '象', '士', '將', '士', '象', '馬', '車']
  const redBack: string[] = ['俥', '傌', '相', '仕', '帥', '仕', '相', '傌', '俥']
  for (let column = 0; column < 9; column++) {
    board[column] = blackBack[column]
    board[81 + column] = redBack[column]
  }
  board[19] = '砲'; board[25] = '砲'; board[64] = '炮'; board[70] = '炮'
  for (let index of [27, 29, 31, 33, 35]) board[index] = '卒'
  for (let index of [54, 56, 58, 60, 62]) board[index] = '兵'
  return board
}

export function editBoardPosition(game: string, board: number[] | string[], index: number,
  piece: number | string): number[] | string[] {
  if (index < 0 || index >= board.length) return board.slice()
  if (game === 'chinese-chess') {
    const next = stringBoard(board, 90)
    const selected = typeof piece === 'string' ? piece : ''
    next[index] = next[index] === selected ? '' : selected
    return next
  }
  const next = numberBoard(board, board.length)
  const selected = typeof piece === 'number' ? piece : 0
  next[index] = next[index] === selected ? 0 : selected
  return next
}

export function puzzlePositions(game: string): PuzzlePosition[] {
  if (game === 'gobang') {
    const first: number[] = Array(225).fill(0)
    for (let column = 3; column <= 6; column++) first[7 * 15 + column] = 1
    const second: number[] = Array(225).fill(0)
    for (let column = 4; column <= 7; column++) second[5 * 15 + column] = 2
    const third: number[] = Array(225).fill(0)
    for (let point = 4; point <= 7; point++) third[point * 15 + point] = 1
    return [
      { id: 'gobang-001', title: '一击成五', board: first, player: 1, goal: '黑先，一手完成五连', difficulty: '入门', solution: [{ index: 7 * 15 + 2 }, { index: 7 * 15 + 7 }] },
      { id: 'gobang-002', title: '封住冲四', board: second, player: 1, goal: '黑先，挡住白棋下一手取胜', difficulty: '进阶', solution: [{ index: 5 * 15 + 3 }, { index: 5 * 15 + 8 }] },
      { id: 'gobang-003', title: '斜线终结', board: third, player: 1, goal: '黑先，补成斜线五连', difficulty: '进阶', solution: [{ index: 3 * 15 + 3 }, { index: 8 * 15 + 8 }] }
    ]
  }
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
