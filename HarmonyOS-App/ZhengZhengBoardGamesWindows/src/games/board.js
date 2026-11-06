// 棋盘类：五子棋 / 黑白棋 / 井字棋 / 围棋 / 中国跳棋 / 扫雷
(function (C) {
  const el = C.el

  // ---------- 通用方格棋盘 ----------
  function gridBoard(size, cellRender, onCell) {
    const table = el('table', { class: 'board' })
    const cells = []
    for (let r = 0; r < size; r++) {
      const tr = el('tr')
      for (let c = 0; c < size; c++) {
        const idx = r * size + c
        const td = el('td', {
          class: ((r + c) % 2 === 0 ? '' : 'dark'),
          onclick: () => onCell(idx)
        })
        cells.push(td)
        tr.appendChild(td)
      }
      table.appendChild(tr)
    }
    return { table, cells, render: () => cells.forEach((td, i) => cellRender(td, i)) }
  }

  // ================= 五子棋 =================
  C.register('gobang', {
    title: '五子棋', note: '15 路 · 连五即胜', players: '1-2 人', accent: '#A4453A',
    mount(root) {
      const N = 15
      const board = new Array(N * N).fill(0)
      let turn = 1
      let over = false
      const status = C.status(root, '你执黑先行，点击交叉点落子')

      function winnerAt(b) {
        const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
        for (let i = 0; i < b.length; i++) {
          const v = b[i]
          if (!v) continue
          const r = Math.floor(i / N)
          const c = i % N
          for (const d of dirs) {
            let count = 1
            for (let k = 1; k < 5; k++) {
              const rr = r + d[0] * k
              const cc = c + d[1] * k
              if (rr < 0 || rr >= N || cc < 0 || cc >= N || b[rr * N + cc] !== v) break
              count++
            }
            for (let k = 1; k < 5; k++) {
              const rr = r - d[0] * k
              const cc = c - d[1] * k
              if (rr < 0 || rr >= N || cc < 0 || cc >= N || b[rr * N + cc] !== v) break
              count++
            }
            if (count >= 5) return v
          }
        }
        return 0
      }

      function scorePoint(idx, who) {
        const r = Math.floor(idx / N)
        const c = idx % N
        const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
        let total = 0
        dirs.forEach((d) => {
          const line = [board[idx]]
          for (let k = 1; k <= 4; k++) {
            const rr = r + d[0] * k
            const cc = c + d[1] * k
            if (rr < 0 || rr >= N || cc < 0 || cc >= N) break
            line.push(board[rr * N + cc])
          }
          for (let k = 1; k <= 4; k++) {
            const rr = r - d[0] * k
            const cc = c - d[1] * k
            if (rr < 0 || rr >= N || cc < 0 || cc >= N) break
            line.unshift(board[rr * N + cc])
          }
          total += C.minimaxScore(line, who, who === 1 ? 2 : 1)
        })
        // 靠近已有棋子更有价值
        let near = 0
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue
            if (board[rr * N + cc]) near += 1
          }
        }
        return total + near
      }

      function aiMove() {
        let best = -1
        let bestScore = -Infinity
        for (let i = 0; i < board.length; i++) {
          if (board[i]) continue
          const mine = scorePoint(i, 2)
          const theirs = scorePoint(i, 1)
          const s = mine * 1.0 + theirs * 0.85
          if (s > bestScore) { bestScore = s; best = i }
        }
        if (best >= 0) place(best, 2)
      }

      function place(idx, who) {
        if (over || board[idx]) return
        board[idx] = who
        const w = winnerAt(board)
        if (w) {
          over = true
          status.textContent = w === 1 ? '五子连珠，你赢了！🏆' : 'AI 连成五子，本局失利'
          g.render()
          return
        }
        turn = who === 1 ? 2 : 1
        g.render()
        if (turn === 2) setTimeout(aiMove, 260)
        else status.textContent = '轮到你（黑）'
      }

      const g = gridBoard(N, (td, i) => {
        td.innerHTML = ''
        if (board[i]) {
          td.appendChild(el('span', { class: 'piece ' + (board[i] === 1 ? 'b' : 'w') }))
        }
      }, (i) => { if (!over && C.isPlayer(turn - 1)) place(i, turn) })

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(g.table)
      root.appendChild(wrap)
      const modes = C.modeToggle()
      root.appendChild(C.el('div', { class: 'row' }, [modes.node]))
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => { board.fill(0); over = false; turn = 1; status.textContent = '重开一局，你执黑'; g.render() } },
        { text: 'AI 先手', onClick: () => { board.fill(0); over = false; turn = 2; if (C.isAi()) aiMove(); else { turn = 1; status.textContent = '线下模式已忽略「AI 先手」，你执黑先行'; g.render() } } }
      ]))
      C.rules(root, '规则：横、竖、斜任意方向先连成 5 子获胜。AI 会同时评估自己的进攻与你的威胁。')
      C.on('mode', () => { modes.refresh(); status.textContent = C.isLocal() ? '线下双人：黑白轮流由你落子' : 'AI 陪练：白子由电脑落子' })
      g.render()
    }
  })

  // ================= 黑白棋 =================
  C.register('reversi', {
    title: '黑白棋', note: '翻转棋子 · 终局计数', players: '2 人', accent: '#2F855A',
    mount(root) {
      const N = 8
      const board = new Array(64).fill(0)
      board[27] = 2
      board[28] = 1
      board[35] = 1
      board[36] = 2
      let turn = 1
      const status = C.status(root, '你执黑，只能在能夹住对方棋子的位置落子')

      function flips(idx, who) {
        const r = Math.floor(idx / 8)
        const c = idx % 8
        const opp = who === 1 ? 2 : 1
        const out = []
        const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
        dirs.forEach((d) => {
          let rr = r + d[0]
          let cc = c + d[1]
          const caps = []
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === opp) {
            caps.push(rr * 8 + cc)
            rr += d[0]
            cc += d[1]
          }
          if (caps.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === who) {
            caps.forEach((x) => out.push(x))
          }
        })
        return out
      }

      function legal(who) {
        const res = []
        for (let i = 0; i < 64; i++) {
          if (!board[i] && flips(i, who).length) res.push(i)
        }
        return res
      }

      function counts() {
        let a = 0
        let b = 0
        board.forEach((v) => { if (v === 1) a++; else if (v === 2) b++ })
        return [a, b]
      }

      function finish() {
        const c = counts()
        const txt = `终局：黑 ${c[0]} · 白 ${c[1]} —— ` + (c[0] > c[1] ? '你获胜！🏆' : c[0] < c[1] ? 'AI 获胜' : '平局')
        status.textContent = txt
        turn = 0
      }

      function apply(idx, who) {
        const fs = flips(idx, who)
        if (!fs.length) return false
        board[idx] = who
        fs.forEach((i) => board[i] = who)
        return true
      }

      function nextTurn() {
        if (legal(1).length || legal(2).length) {
          if (!legal(turn).length) {
            turn = turn === 1 ? 2 : 1
            status.textContent = turn === 1 ? '白方无处可下，轮到你' : '你无处可下，AI 继续'
          }
        } else {
          finish()
        }
        g.render()
      }

      function aiMove() {
        const moves = legal(2)
        if (!moves.length) { nextTurn(); return }
        const corners = [0, 7, 56, 63]
        let best = moves[0]
        let bestScore = -Infinity
        moves.forEach((m) => {
          let s = flips(m, 2).length
          if (corners.indexOf(m) >= 0) s += 60
          const r = Math.floor(m / 8)
          const c = m % 8
          if (r === 0 || r === 7 || c === 0 || c === 7) s += 8
          if (s > bestScore) { bestScore = s; best = m }
        })
        apply(best, 2)
        turn = 1
        nextTurn()
      }

      const g = gridBoard(N, (td, i) => {
        td.innerHTML = ''
        td.className = ((Math.floor(i / 8) + i % 8) % 2 === 0 ? '' : 'dark')
        if (board[i]) td.appendChild(el('span', { class: 'piece ' + (board[i] === 1 ? 'b' : 'w') }))
        else if (turn === 1 && flips(i, 1).length) td.classList.add('hint')
      }, (i) => {
        if (turn !== 1) return
        if (!apply(i, 1)) { status.textContent = '这里不能落子：必须夹住至少一枚白棋'; return }
        turn = 2
        nextTurn()
        if (turn === 2) setTimeout(aiMove, 300)
      })

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(g.table)
      root.appendChild(wrap)
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => {
          board.fill(0); board[27] = 2; board[28] = 1; board[35] = 1; board[36] = 2
          turn = 1; status.textContent = '重开一局'; g.render()
        } }
      ]))
      C.rules(root, '规则：落子必须夹住对方至少一枚棋子，被夹住的棋子翻面。双方都无处可下时子多者胜。')
      g.render()
    }
  })

  // ================= 井字棋 =================
  C.register('tictactoe', {
    title: '井字棋', note: '三连获胜 · 极速对局', players: '2 人', accent: '#2471A3',
    mount(root) {
      const board = new Array(9).fill(0)
      let turn = 1
      let over = false
      const status = C.status(root, '你执 ✕ 先行')
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

      function winner() {
        for (const l of lines) {
          if (board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]) return board[l[0]]
        }
        return 0
      }

      function ai() {
        const empty = board.map((v, i) => v ? -1 : i).filter((i) => i >= 0)
        if (!empty.length) return
        let pick = empty[Math.floor(Math.random() * empty.length)]
        // 能赢就赢，能堵就堵
        for (const who of [2, 1]) {
          for (const e of empty) {
            board[e] = who
            const w = winner()
            board[e] = 0
            if (w === who) { pick = e; break }
          }
          if (board[pick] === 0 && winner() === 0 && who === 2) {
            // 检查上面是否已锁定
          }
        }
        board[pick] = 2
        if (winner()) { over = true; status.textContent = C.isLocal() ? '○ 三连，本局结束' : 'AI 连成一线，本局失利'; g.render(); return }
        if (!board.includes(0)) { over = true; status.textContent = '平局'; g.render(); return }
        turn = 1
        g.render()
      }

      const g = gridBoard(3, (td, i) => {
        td.innerHTML = ''
        td.textContent = board[i] ? (board[i] === 1 ? '✕' : '○') : ''
        td.style.fontSize = '30px'
      }, (i) => {
        // 单击直接落子（无二次确认）；线下多人模式下 ✕/○ 双方都由本机玩家操作
        if (over || board[i]) return
        if (turn === 1 ? !C.isPlayer(0) : !C.isPlayer(1)) return
        const me = turn
        board[i] = me
        if (winner()) { over = true; status.textContent = me === 1 ? '三连！你赢了 🏆' : '三连！电脑获胜'; g.render(); return }
        if (!board.includes(0)) { over = true; status.textContent = '平局'; g.render(); return }
        turn = me === 1 ? 2 : 1
        g.render()
        if (C.isAi()) setTimeout(ai, 280)
      })

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(g.table)
      root.appendChild(wrap)
      const modes = C.modeToggle()
      root.appendChild(C.el('div', { class: 'row' }, [modes.node]))
      root.appendChild(C.buttonRow([{ text: '重开', onClick: () => { board.fill(0); over = false; turn = 1; status.textContent = '重开一局'; g.render() } }]))
      C.on('mode', () => { modes.refresh(); status.textContent = C.isLocal() ? '线下双人：✕ 与 ○ 轮流由你落子' : 'AI 陪练：○ 由电脑落子' })
      g.render()
    }
  })

  // ================= 围棋（9 / 13 / 19 路可切换） =================
  C.register('go', {
    title: '围棋', note: '9 / 13 / 19 路 · 提子与数目', players: '1-2 人', accent: '#B58B45',
    mount(root) {
      // N 之前硬编码 9 路，且 gridBoard 一次性建表；改成可变尺寸后
      // 换路数必须整张表重建，所以g 声明为 let并提供 rebuild()。
      let N = 9
      let board = new Array(N * N).fill(0)
      let turn = 1
      let passCount = 0
      const status = C.status(root, '你执黑，点击交叉点落子；无气之子会被提掉')

      function neighbors(i) {
        const r = Math.floor(i / N)
        const c = i % N
        const out = []
        if (r > 0) out.push(i - N)
        if (r < N - 1) out.push(i + N)
        if (c > 0) out.push(i - 1)
        if (c < N - 1) out.push(i + 1)
        return out
      }

      function groupAndLiberties(i) {
        const color = board[i]
        const seen = new Set([i])
        const stack = [i]
        let libs = 0
        while (stack.length) {
          const cur = stack.pop()
          neighbors(cur).forEach((n) => {
            if (!board[n]) libs++
            else if (board[n] === color && !seen.has(n)) { seen.add(n); stack.push(n) }
          })
        }
        return { stones: Array.from(seen), libs }
      }

      function place(idx, who) {
        if (board[idx]) return false
        board[idx] = who
        // 提对方无气子
        neighbors(idx).forEach((n) => {
          if (board[n] && board[n] !== who) {
            const g = groupAndLiberties(n)
            if (g.libs === 0) g.stones.forEach((s) => board[s] = 0)
          }
        })
        // 自杀判定
        const mine = groupAndLiberties(idx)
        if (mine.libs === 0) {
          mine.stones.forEach((s) => board[s] = 0)
          return false
        }
        return true
      }

      function counts() {
        let a = 0
        let b = 0
        board.forEach((v) => { if (v === 1) a++; else if (v === 2) b++ })
        return [a, b]
      }

      function ai() {
        const empty = []
        for (let i = 0; i < board.length; i++) if (!board[i]) empty.push(i)
        if (!empty.length) { status.textContent = '棋盘已满'; return }
        let pick = empty[Math.floor(Math.random() * empty.length)]
        let bestScore = -Infinity
        empty.forEach((i) => {
          const snapshot = board.slice()
          const ok = place(i, 2)
          board = snapshot
          if (!ok) return
          let s = Math.random() * 3
          neighbors(i).forEach((n) => {
            if (board[n] === 1) {
              const g = groupAndLiberties(n)
              if (g.libs === 1) s += 30
            }
            if (board[n] === 2) s += 4
          })
          if (s > bestScore) { bestScore = s; pick = i }
        })
        place(pick, 2)
        passCount = 0
        turn = 1
        const c = counts()
        status.textContent = `AI 落子 · 黑白子数 ${c[0]} : ${c[1]}`
        g.render()
      }

      function makeBoard() {
        const boardEl = gridBoard(N, (td, i) => {
          td.innerHTML = ''
          if (board[i]) td.appendChild(el('span', { class: 'piece ' + (board[i] === 1 ? 'b' : 'w') }))
        }, (i) => {
          // AI 陪练模式下白方是电脑；线下多人模式下双方都由本机玩家操作。
          if (turn === 1 ? !C.isPlayer(0) : !C.isPlayer(1)) return
          if (!place(i, turn)) { status.textContent = '这里不能落子（无气或已有棋子）'; return }
          passCount = 0
          const moved = turn
          turn = turn === 1 ? 2 : 1
          const c = counts()
          status.textContent = `落子成功 · 黑白子数 ${c[0]} : ${c[1]}`
          g.render()
          if (C.isAi()) setTimeout(ai, 320)
        })
        return boardEl
      }

      let g = makeBoard()

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(g.table)
      root.appendChild(wrap)

      const modes = C.modeToggle()

      root.appendChild(C.buttonRow([
        { text: '9 路', onClick: () => switchSize(9) },
        { text: '13 路', onClick: () => switchSize(13) },
        { text: '19 路', onClick: () => switchSize(19) },
      ]))
      root.appendChild(C.el('div', { class: 'row' }, [modes.node]))
      root.appendChild(C.buttonRow([
        { text: '虚手（Pass）', onClick: () => { passCount++; turn = turn === 1 ? 2 : 1; if (passCount >= 2) { const c = counts(); status.textContent = `双方虚手，终局：黑 ${c[0]} · 白 ${c[1]}` } else { status.textContent = '你选择虚手'; if (C.isAi()) setTimeout(ai, 250) } } },
        { text: '重开', onClick: () => { board = new Array(N * N).fill(0); turn = 1; passCount = 0; status.textContent = '重开一局'; g.render() } }
      ]))
      C.rules(root, `规则：当前 ${N} 路盘，落子后对方无气的棋块被提掉；双方连续虚手即终局，按盘面子数计胜负。`)

      // 换路数：重置棋盘并整张表重建（旧 N 的 table 节点必须丢弃）
      function switchSize(next) {
        if (next === N) return
        N = next
        board = new Array(N * N).fill(0)
        turn = 1
        passCount = 0
        const old = g.table
        g = makeBoard()
        wrap.replaceChild(g.table, old)
        status.textContent = `已切换到 ${N} 路，新开一局`
        g.render()
      }

      C.on('mode', () => { modes.refresh(); status.textContent = C.isLocal() ? '线下多人：黑白双方都由你落子' : 'AI 陪练：白方由电脑应对' })
      g.render()
    }
  })

  // ================= 中国跳棋（六角星） =================
  C.register('jump', {
    title: '中国跳棋', note: '六角星 · 连跳 · 三人', players: '2-3 人', accent: '#5B6FB5',
    mount(root) {
      const canvas = el('canvas', { width: 720, height: 720 })
      canvas.style.maxWidth = '100%'
      const ctx = canvas.getContext('2d')
      const status = C.status(root, '你是红色，点击自己的棋子，再点高亮目标；可连跳')

      // 六角星 121 孔：17 行
      const ROW_START = [0, -0.5, -1, -1.5, -6, -5.5, -5, -4.5, -4, -4.5, -5, -5.5, -6, -1.5, -1, -0.5, 0]
      const ROW_COUNT = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]
      const pos = []
      for (let r = 0; r < 17; r++) {
        for (let k = 0; k < ROW_COUNT[r]; k++) {
          const ux = ROW_START[r] + k
          const uy = r * 0.8660254
          pos.push({ x: 360 + (ux + 6) * 34, y: 90 + uy * 34, ux, row: r })
        }
      }
      const neighbors = pos.map((p, i) => {
        const out = []
        pos.forEach((q, j) => {
          if (i === j) return
          const dr = Math.abs(p.row - q.row)
          const dx = Math.abs(p.ux - q.ux)
          if ((dr === 0 && Math.abs(dx - 1) < 0.01) || (dr === 1 && Math.abs(dx - 0.5) < 0.01)) out.push(j)
        })
        return out
      })
      const idxOf = (r, ux) => pos.findIndex((p) => p.row === r && Math.abs(p.ux - ux) < 0.01)
      const T = []
      const B = []
      for (let r = 0; r < 4; r++) for (let k = 0; k < ROW_COUNT[r]; k++) T.push(idxOf(r, ROW_START[r] + k))
      for (let r = 13; r < 17; r++) for (let k = 0; k < ROW_COUNT[r]; k++) B.push(idxOf(r, ROW_START[r] + k))
      const corner = (rows, fromLeft) => {
        const out = []
        rows.forEach((r, n) => {
          const take = n + 1
          for (let k = 0; k < take; k++) {
            out.push(idxOf(r, ROW_START[r] + (fromLeft ? k : ROW_COUNT[r] - take + k)))
          }
        })
        return out
      }
      const TL = corner([4, 5, 6, 7], true)
      const TR = corner([4, 5, 6, 7], false)
      const BL = corner([9, 10, 11, 12], true)
      const BR = corner([9, 10, 11, 12], false)

      const homes = [T, BL, BR]
      const goals = [B, TR, TL]
      const colors = ['#C0392B', '#E3B23C', '#2E5C8A']
      const names = ['红（你）', '黄', '蓝']

      let board = new Array(121).fill(0)
      let turn = 0
      let sel = -1
      let targets = []

      function reset() {
        board = new Array(121).fill(0)
        homes.forEach((h, p) => h.forEach((i) => board[i] = p + 1))
        turn = 0
        sel = -1
        targets = []
        status.textContent = '你是红色，目标是正下方的蓝色营地'
      }
      reset()

      // 单步 + 连跳可达（不能越过己方目标区）
      function reachable(from) {
        const out = []
        const seen = new Set([from])
        neighbors[from].forEach((n) => {
          if (!board[n]) { out.push(n); seen.add(n) }
        })
        const queue = [from]
        let h = 0
        while (h < queue.length) {
          const cur = queue[h++]
          neighbors[cur].forEach((m) => {
            if (!board[m]) return
            const lr = 2 * pos[m].row - pos[cur].row
            const lx = 2 * pos[m].ux - pos[cur].ux
            for (let j = 0; j < pos.length; j++) {
              if (seen.has(j) || board[j]) continue
              if (pos[j].row !== lr || Math.abs(pos[j].ux - lx) > 0.01) continue
              seen.add(j)
              out.push(j)
              queue.push(j)
              break
            }
          })
        }
        return out
      }

      function inGoal(i, p) { return goals[p].indexOf(i) >= 0 }
      function inHome(i, p) { return homes[p].indexOf(i) >= 0 }

      function winner() {
        for (let p = 0; p < 3; p++) {
          const g = goals[p]
          let full = true
          g.forEach((i) => { if (board[i] !== p + 1) full = false })
          if (full) return p
        }
        return -1
      }

      function move(from, to) {
        board[to] = board[from]
        board[from] = 0
        const w = winner()
        if (w >= 0) {
          turn = -1
          status.textContent = w === 0 ? '你的 10 枚棋子全部到达对面，获胜！🏆' : `${names[w]} 获胜`
          draw()
          return
        }
        turn = (turn + 1) % 3
        sel = -1
        targets = []
        draw()
        if (turn !== 0) setTimeout(aiMove, 420)
      }

      function aiMove() {
        const p = turn
        let best = null
        let bestScore = Infinity
        const goalSet = goals[p]
        for (let i = 0; i < 121; i++) {
          if (board[i] !== p + 1) continue
          if (inGoal(i, p) && goalSet.indexOf(i) >= 0) {
            // 已入营的棋子尽量不动（简化：允许动但优先级低）
          }
          reachable(i).forEach((t) => {
            let s = 0
            goalSet.forEach((g) => {
              s += Math.abs(pos[t].row - pos[g].row) * 3 + Math.abs(pos[t].ux - pos[g].ux)
            })
            if (goalSet.indexOf(t) >= 0) s -= 40
            if (Math.random() < 0.15) s -= 20
            if (s < bestScore) { bestScore = s; best = { from: i, to: t } }
          })
        }
        if (best) move(best.from, best.to)
        else { turn = (turn + 1) % 3; draw(); if (turn !== 0) setTimeout(aiMove, 300) }
      }

      function draw() {
        ctx.clearRect(0, 0, 720, 720)
        ctx.fillStyle = '#FBF7EC'
        ctx.fillRect(0, 0, 720, 720)
        // 角区底色
        const corners = [
          { set: T, color: 'rgba(192,57,43,.18)' }, { set: B, color: 'rgba(46,92,138,.18)' },
          { set: TL, color: 'rgba(227,178,60,.16)' }, { set: TR, color: 'rgba(227,178,60,.16)' },
          { set: BL, color: 'rgba(46,92,138,.16)' }, { set: BR, color: 'rgba(46,92,138,.16)' }
        ]
        corners.forEach((c) => {
          ctx.fillStyle = c.color
          c.set.forEach((i) => {
            ctx.beginPath()
            ctx.arc(pos[i].x, pos[i].y, 15, 0, Math.PI * 2)
            ctx.fill()
          })
        })
        // 孔
        pos.forEach((p, i) => {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
          ctx.fillStyle = '#DCC9A8'
          ctx.fill()
          ctx.strokeStyle = '#B9A483'
          ctx.lineWidth = 1
          ctx.stroke()
        })
        // 落点提示
        if (sel >= 0) {
          targets.forEach((t) => {
            ctx.beginPath()
            ctx.arc(pos[t].x, pos[t].y, 11, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(183,121,31,.55)'
            ctx.fill()
          })
        }
        // 棋子
        board.forEach((v, i) => {
          if (!v) return
          ctx.beginPath()
          ctx.arc(pos[i].x, pos[i].y, 13, 0, Math.PI * 2)
          ctx.fillStyle = colors[v - 1]
          ctx.fill()
          ctx.strokeStyle = sel === i ? '#F5C542' : 'rgba(0,0,0,.3)'
          ctx.lineWidth = sel === i ? 4 : 2
          ctx.stroke()
        })
      }

      canvas.addEventListener('click', (e) => {
        if (turn !== 0) return
        const rect = canvas.getBoundingClientRect()
        const mx = (e.clientX - rect.left) * (720 / rect.width)
        const my = (e.clientY - rect.top) * (720 / rect.height)
        let hit = -1
        pos.forEach((p, i) => {
          if (Math.hypot(p.x - mx, p.y - my) < 20) hit = i
        })
        if (hit < 0) return
        if (sel >= 0 && targets.indexOf(hit) >= 0) { move(sel, hit); return }
        if (board[hit] === 1) {
          sel = hit
          targets = reachable(hit)
          status.textContent = `已选中，可落点 ${targets.length} 个`
          draw()
        } else {
          sel = -1
          targets = []
          draw()
        }
      })

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(canvas)
      root.appendChild(wrap)
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => { reset(); draw() } }
      ]))
      C.rules(root, '规则：每次可走一步或连续跳跃（隔一枚棋子落到对称空位）；先把自己 10 枚棋子全部送进正对面营地者获胜。')
      draw()
    }
  })

  // ================= 扫雷 =================
  C.register('minesweeper', {
    title: '扫雷', note: '三档难度 · 首击必安全', players: '1 人', accent: '#5D6D7E',
    mount(root) {
      const levels = [
        { name: '初级', size: 9, mines: 10 },
        { name: '中级', size: 12, mines: 24 },
        { name: '高级', size: 16, mines: 40 }
      ]
      let level = 0
      let size = 9
      let mines = 10
      let board = []
      let shown = []
      let flagged = []
      let started = false
      let finished = false
      const status = C.status(root, '点击格子开始，首次点击必定安全')

      function build(safeIdx) {
        board = new Array(size * size).fill(0)
        const spots = []
        for (let i = 0; i < board.length; i++) if (i !== safeIdx) spots.push(i)
        C.shuffle(spots).slice(0, mines).forEach((i) => board[i] = -1)
        for (let i = 0; i < board.length; i++) {
          if (board[i] === -1) continue
          let n = 0
          around(i).forEach((j) => { if (board[j] === -1) n++ })
          board[i] = n
        }
        shown = new Array(board.length).fill(false)
        flagged = new Array(board.length).fill(false)
      }

      function around(i) {
        const r = Math.floor(i / size)
        const c = i % size
        const out = []
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
            out.push(rr * size + cc)
          }
        }
        return out
      }

      function reveal(i) {
        if (shown[i] || flagged[i]) return
        shown[i] = true
        if (board[i] === -1) {
          finished = true
          shown = shown.map(() => true)
          status.textContent = '踩到雷了，本局结束 💥'
          render()
          return
        }
        if (board[i] === 0) around(i).forEach(reveal)
        checkWin()
      }

      function checkWin() {
        let hidden = 0
        for (let i = 0; i < board.length; i++) if (board[i] !== -1 && !shown[i]) hidden++
        if (hidden === 0 && !finished) {
          finished = true
          status.textContent = '全部安全格子已翻开，扫雷成功！🏆'
        }
      }

      const table = el('table', { class: 'board' })
      function render() {
        C.clear(table)
        for (let r = 0; r < size; r++) {
          const tr = el('tr')
          for (let c = 0; c < size; c++) {
            const i = r * size + c
            const td = el('td', {
              style: 'width:32px;height:32px;font-size:15px;cursor:pointer;background:' +
                (shown[i] ? '#F7F3EA' : '#D9CFBC'),
              oncontextmenu: (e) => {
                e.preventDefault()
                if (!shown[i] && !finished) { flagged[i] = !flagged[i]; render() }
              },
              onclick: () => {
                if (finished) return
                if (!started) { started = true; build(i) }
                if (flagged[i]) return
                reveal(i)
                render()
              }
            })
            if (shown[i]) {
              if (board[i] === -1) td.textContent = '💥'
              else if (board[i] > 0) {
                td.textContent = board[i]
                td.style.color = ['', '#2B67A0', '#2E7D5B', '#C0392B', '#7A3E9D', '#B7791F', '#3C8C7A', '#172033', '#6B7280'][board[i]] || '#172033'
                td.style.fontWeight = '700'
              }
            } else if (flagged[i]) td.textContent = '🚩'
            tr.appendChild(td)
          }
          table.appendChild(tr)
        }
      }

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(table)
      root.appendChild(wrap)
      root.appendChild(C.buttonRow(levels.map((lv, i) => ({
        text: lv.name + ` ${lv.size}×${lv.size}`,
        primary: i === 0,
        onClick: () => { level = i; size = lv.size; mines = lv.mines; started = false; finished = false; build(-1); status.textContent = `${lv.name}：${lv.mines} 颗雷，右键插旗`; render() }
      }))))
      root.appendChild(C.buttonRow([{ text: '重开本档', onClick: () => { started = false; finished = false; build(-1); status.textContent = '重新开局，首次点击必定安全'; render() } }]))
      C.rules(root, '左键翻开，右键插旗。首次点击必定安全。')
      build(-1)
      render()
    }
  })
})(window.ZZCore)
