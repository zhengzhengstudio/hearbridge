// 中国象棋 与 国际象棋
(function (C) {
  const el = C.el

  // ================= 中国象棋 =================
  const XQ = {
    W: 9, H: 10,
    // 棋子：红 'r'+类型，黑 'b'+类型；类型 K 将 A 士 B 象 N 马 R 车 C 炮 P 兵
    layout() {
      const b = new Array(90).fill('')
      const back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R']
      for (let i = 0; i < 9; i++) {
        b[i] = 'b' + back[i]
        b[81 + i] = 'r' + back[i]
      }
      b[19] = 'bC'
      b[25] = 'bC'
      b[64] = 'rC'
      b[70] = 'rC'
      for (let i = 0; i < 5; i++) {
        b[27 + i * 2] = 'bP'
        b[54 + i * 2] = 'rP'
      }
      return b
    },
    sideOf(p) { return p.charAt(0) },
    typeOf(p) { return p.charAt(1) },
    inside(r, c) { return r >= 0 && r < this.H && c >= 0 && c < this.W },
    // 伪合法走法
    pseudo(board, from) {
      const out = []
      const p = board[from]
      if (!p) return out
      const r = Math.floor(from / 9)
      const c = from % 9
      const me = this.sideOf(p)
      const t = this.typeOf(p)
      const push = (rr, cc) => {
        if (!this.inside(rr, cc)) return false
        const to = rr * 9 + cc
        const q = board[to]
        if (q && this.sideOf(q) === me) return false
        out.push(to)
        return !q
      }
      if (t === 'R') {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => {
          for (let k = 1; k < 10; k++) if (!push(r + d[0] * k, c + d[1] * k)) break
        })
      } else if (t === 'C') {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => {
          let jumped = false
          for (let k = 1; k < 10; k++) {
            const rr = r + d[0] * k
            const cc = c + d[1] * k
            if (!this.inside(rr, cc)) break
            const to = rr * 9 + cc
            const q = board[to]
            if (!jumped) {
              if (q) { jumped = true }
              else out.push(to)
            } else if (q) {
              if (this.sideOf(q) !== me) out.push(to)
              break
            }
          }
        })
      } else if (t === 'N') {
        const steps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
        const legs = [[-1, 0], [-1, 0], [0, -1], [0, -1], [0, 1], [0, 1], [1, 0], [1, 0]]
        steps.forEach((s, i) => {
          const rr = r + s[0]
          const cc = c + s[1]
          if (!this.inside(rr, cc)) return
          const lr = r + legs[i][0]
          const lc = c + legs[i][1]
          if (board[lr * 9 + lc]) return
          const q = board[rr * 9 + cc]
          if (q && this.sideOf(q) === me) return
          out.push(rr * 9 + cc)
        })
      } else if (t === 'B') {
        [[-2, -2], [-2, 2], [2, -2], [2, 2]].forEach((s) => {
          const rr = r + s[0]
          const cc = c + s[1]
          if (!this.inside(rr, cc)) return
          if (board[(r + s[0] / 2) * 9 + (c + s[1] / 2)]) return
          // 象不过河
          if (me === 'r' && rr < 5) return
          if (me === 'b' && rr > 4) return
          const q = board[rr * 9 + cc]
          if (q && this.sideOf(q) === me) return
          out.push(rr * 9 + cc)
        })
      } else if (t === 'A') {
        [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach((s) => {
          const rr = r + s[0]
          const cc = c + s[1]
          if (!this.inside(rr, cc)) return
          if (me === 'r' && (rr < 7 || cc < 3 || cc > 5)) return
          if (me === 'b' && (rr > 2 || cc < 3 || cc > 5)) return
          const q = board[rr * 9 + cc]
          if (q && this.sideOf(q) === me) return
          out.push(rr * 9 + cc)
        })
      } else if (t === 'K') {
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((s) => {
          const rr = r + s[0]
          const cc = c + s[1]
          if (!this.inside(rr, cc)) return
          if (me === 'r' && (rr < 7 || cc < 3 || cc > 5)) return
          if (me === 'b' && (rr > 2 || cc < 3 || cc > 5)) return
          const q = board[rr * 9 + cc]
          if (q && this.sideOf(q) === me) return
          out.push(rr * 9 + cc)
        })
      } else if (t === 'P') {
        const dir = me === 'r' ? -1 : 1
        push(r + dir, c)
        const crossed = me === 'r' ? r <= 4 : r >= 5
        if (crossed) {
          push(r, c - 1)
          push(r, c + 1)
        }
      }
      return out
    },
    findKing(board, side) {
      for (let i = 0; i < board.length; i++) {
        if (board[i] === side + 'K') return i
      }
      return -1
    },
    // 将帅照面
    kingsFace(board) {
      let red = -1
      let black = -1
      for (let i = 0; i < board.length; i++) {
        if (board[i] === 'rK') red = i
        if (board[i] === 'bK') black = i
      }
      if (red < 0 || black < 0) return false
      if (red % 9 !== black % 9) return false
      const hi = Math.max(red, black)
      const lo = Math.min(red, black)
      for (let i = lo + 9; i < hi; i += 9) if (board[i]) return false
      return true
    },
    inCheck(board, side) {
      const king = this.findKing(board, side)
      if (king < 0) return false
      for (let i = 0; i < board.length; i++) {
        const p = board[i]
        if (!p || this.sideOf(p) === side) continue
        if (this.pseudo(board, i).indexOf(king) >= 0) return true
      }
      return this.kingsFace(board)
    },
    legal(board, from) {
      const p = board[from]
      if (!p) return []
      const me = this.sideOf(p)
      return this.pseudo(board, from).filter((to) => {
        const nb = board.slice()
        nb[to] = nb[from]
        nb[from] = ''
        return !this.inCheck(nb, me)
      })
    },
    value(t) {
      return { K: 10000, R: 900, N: 400, C: 450, A: 200, B: 200, P: 100 }[t] || 0
    }
  }

  C.register('chinese-chess', {
    title: '中国象棋', note: '楚河汉界 · 完整走法与将军判定', players: '2 人', accent: '#C0392B',
    mount(root) {
      let board = XQ.layout()
      let turn = 'r'
      let sel = -1
      let targets = []
      const status = C.status(root, '你执红先行，点自己的棋子再点目标')

      const table = el('table', { class: 'board' })
      const cells = []
      for (let r = 0; r < 10; r++) {
        const tr = el('tr')
        for (let c = 0; c < 9; c++) {
          const td = el('td', { style: 'width:46px;height:46px;font-size:22px;cursor:pointer;background:#EFE0C4' })
          cells.push(td)
          tr.appendChild(td)
        }
        table.appendChild(tr)
      }

      const glyph = { rK: '帥', rA: '仕', rB: '相', rN: '傌', rR: '俥', rC: '炮', rP: '兵', bK: '將', bA: '士', bB: '象', bN: '馬', bR: '車', bC: '砲', bP: '卒' }

      function render() {
        for (let i = 0; i < cells.length; i++) {
          const td = cells[i]
          td.innerHTML = ''
          td.className = ''
          td.style.background = (Math.floor(i / 9) + i % 9) % 2 ? '#E4D2B0' : '#EFE0C4'
          if (sel === i) td.classList.add('sel')
          if (targets.indexOf(i) >= 0) td.classList.add('hint')
          if (board[i]) {
            const span = el('span', {
              class: 'piece ' + (XQ.sideOf(board[i]) === 'r' ? 'r' : 'b'),
              text: glyph[board[i]] || '?'
            })
            span.style.background = XQ.sideOf(board[i]) === 'r' ? '#C0392B' : '#2E3440'
            td.appendChild(span)
          }
          td.onclick = () => tap(i)
        }
      }

      function tap(i) {
        if (turn !== 'r') return
        if (sel >= 0 && targets.indexOf(i) >= 0) { apply(sel, i); return }
        const p = board[i]
        if (p && XQ.sideOf(p) === 'r') {
          sel = i
          targets = XQ.legal(board, i)
          status.textContent = `已选 ${glyph[p]}，可走 ${targets.length} 步` + (targets.length ? '' : '（此子无合法走法）')
          render()
          return
        }
        sel = -1
        targets = []
        render()
      }

      function apply(from, to) {
        const captured = board[to]
        board[to] = board[from]
        board[from] = ''
        sel = -1
        targets = []
        if (captured && XQ.typeOf(captured) === 'K') {
          status.textContent = '你吃掉对方的将，获胜！🏆'
          turn = 'x'
          render()
          return
        }
        turn = 'b'
        render()
        setTimeout(ai, 320)
      }

      function ai() {
        const moves = []
        for (let i = 0; i < board.length; i++) {
          if (!board[i] || XQ.sideOf(board[i]) !== 'b') continue
          XQ.legal(board, i).forEach((to) => moves.push({ from: i, to }))
        }
        if (!moves.length) {
          status.textContent = '黑方无棋可走，你获胜！🏆'
          turn = 'x'
          return
        }
        let best = moves[0]
        let bestScore = -Infinity
        moves.forEach((m) => {
          const victim = board[m.to]
          let s = victim ? XQ.value(XQ.typeOf(victim)) : Math.random() * 8
          // 走后自己是否会被吃
          const nb = board.slice()
          nb[m.to] = nb[m.from]
          nb[m.from] = ''
          let risk = 0
          for (let i = 0; i < nb.length; i++) {
            if (!nb[i] || XQ.sideOf(nb[i]) !== 'r') continue
            if (XQ.pseudo(nb, i).indexOf(m.to) >= 0) risk += XQ.value(XQ.typeOf(nb[m.to]))
          }
          s -= risk * 0.8
          if (XQ.inCheck(nb, 'r')) s += 60
          if (s > bestScore) { bestScore = s; best = m }
        })
        const captured = board[best.to]
        board[best.to] = board[best.from]
        board[best.from] = ''
        if (captured && XQ.typeOf(captured) === 'K') {
          status.textContent = '红帅被吃，本局失利'
          turn = 'x'
          render()
          return
        }
        turn = 'r'
        const inChk = XQ.inCheck(board, 'r')
        status.textContent = (inChk ? '将军！' : '') + '轮到你（红方）'
        render()
      }

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(table)
      root.appendChild(wrap)
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => { board = XQ.layout(); turn = 'r'; sel = -1; targets = []; status.textContent = '重开一局，你执红'; render() } }
      ]))
      C.rules(root, '规则：车直线、马走日（有蹩腿）、炮隔子吃、象飞田不过河、士将限九宫，将帅不可照面。')
      render()
    }
  })

  // ================= 国际象棋 =================
  const WC = {
    layout() {
      const b = new Array(64).fill('')
      const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
      for (let i = 0; i < 8; i++) {
        b[i] = 'b' + back[i]
        b[8 + i] = 'bP'
        b[48 + i] = 'wP'
        b[56 + i] = 'w' + back[i]
      }
      return b
    },
    sideOf(p) { return p.charAt(0) },
    typeOf(p) { return p.charAt(1) },
    value(t) { return { K: 10000, Q: 900, R: 500, B: 330, N: 320, P: 100 }[t] || 0 },
    inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8 },
    pseudo(board, from, ep) {
      const p = board[from]
      if (!p) return []
      const r = Math.floor(from / 8)
      const c = from % 8
      const me = this.sideOf(p)
      const t = this.typeOf(p)
      const out = []
      const push = (rr, cc, okEmpty) => {
        if (!this.inside(rr, cc)) return false
        const to = rr * 8 + cc
        const q = board[to]
        if (q && this.sideOf(q) === me) return false
        if (!q && !okEmpty) return false
        out.push(to)
        return !q
      }
      if (t === 'P') {
        const dir = me === 'w' ? -1 : 1
        if (this.inside(r + dir, c) && !board[(r + dir) * 8 + c]) {
          out.push((r + dir) * 8 + c)
          const startRow = me === 'w' ? 6 : 1
          if (r === startRow && !board[(r + dir * 2) * 8 + c]) out.push((r + dir * 2) * 8 + c)
        }
        [-1, 1].forEach((dc) => {
          const rr = r + dir
          const cc = c + dc
          if (!this.inside(rr, cc)) return
          const to = rr * 8 + cc
          if (board[to] && this.sideOf(board[to]) !== me) out.push(to)
          else if (ep === to) out.push(to)
        })
      } else if (t === 'N') {
        [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach((s) => push(r + s[0], c + s[1], true))
      } else if (t === 'K') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          push(r + dr, c + dc, true)
        }
      } else {
        const dirs = t === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : t === 'B' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        dirs.forEach((d) => {
          for (let k = 1; k < 8; k++) if (!push(r + d[0] * k, c + d[1] * k, true)) break
        })
      }
      return out
    },
    attacked(board, idx, by) {
      for (let i = 0; i < 64; i++) {
        const p = board[i]
        if (!p || this.sideOf(p) !== by) continue
        if (this.pseudo(board, i, -1).indexOf(idx) >= 0) return true
      }
      return false
    },
    findKing(board, side) {
      for (let i = 0; i < 64; i++) if (board[i] === side + 'K') return i
      return -1
    },
    inCheck(board, side) {
      const k = this.findKing(board, side)
      if (k < 0) return false
      return this.attacked(board, k, side === 'w' ? 'b' : 'w')
    },
    legal(board, from, ep, castle) {
      const p = board[from]
      if (!p) return []
      const me = this.sideOf(p)
      const moves = this.pseudo(board, from, ep).filter((to) => {
        const nb = board.slice()
        nb[to] = nb[from]
        nb[from] = ''
        return !this.inCheck(nb, me)
      })
      // 王车易位
      if (this.typeOf(p) === 'K' && castle && castle[me]) {
        const row = me === 'w' ? 7 : 0
        if (from === row * 8 + 4 && !this.inCheck(board, me)) {
          const rightEmpty = !board[row * 8 + 5] && !board[row * 8 + 6]
          const rightRook = board[row * 8 + 7] === me + 'R'
          if (rightEmpty && rightRook && castle[me].kingSide &&
            !this.attacked(board, row * 8 + 5, me === 'w' ? 'b' : 'w') &&
            !this.attacked(board, row * 8 + 6, me === 'w' ? 'b' : 'w')) {
            moves.push(row * 8 + 6)
          }
          const leftEmpty = !board[row * 8 + 3] && !board[row * 8 + 2] && !board[row * 8 + 1]
          const leftRook = board[row * 8] === me + 'R'
          if (leftEmpty && leftRook && castle[me].queenSide &&
            !this.attacked(board, row * 8 + 3, me === 'w' ? 'b' : 'w') &&
            !this.attacked(board, row * 8 + 2, me === 'w' ? 'b' : 'w')) {
            moves.push(row * 8 + 2)
          }
        }
      }
      return moves
    }
  }

  C.register('world-chess', {
    title: '国际象棋', note: '王车易位 · 兵升变 · 将军判定', players: '2 人', accent: '#4A5A3A',
    mount(root) {
      let board = WC.layout()
      let turn = 'w'
      let sel = -1
      let targets = []
      let ep = -1
      let castle = { w: { kingSide: true, queenSide: true }, b: { kingSide: true, queenSide: true } }
      let promote = -1
      const status = C.status(root, '你执白，点棋子再点目标')

      const glyph = { wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙', bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟' }

      const table = el('table', { class: 'board' })
      const cells = []
      for (let r = 0; r < 8; r++) {
        const tr = el('tr')
        for (let c = 0; c < 8; c++) {
          const td = el('td', { style: 'width:48px;height:48px;font-size:30px;cursor:pointer' })
          cells.push(td)
          tr.appendChild(td)
        }
        table.appendChild(tr)
      }

      function render() {
        cells.forEach((td, i) => {
          td.innerHTML = ''
          td.className = ''
          td.style.background = (Math.floor(i / 8) + i % 8) % 2 ? '#B58863' : '#F0D9B5'
          td.style.color = board[i] && WC.sideOf(board[i]) === 'w' ? '#FFFFFF' : '#172033'
          if (sel === i) td.classList.add('sel')
          if (targets.indexOf(i) >= 0) td.classList.add('hint')
          if (board[i]) td.textContent = glyph[board[i]] || '?'
          td.onclick = () => tap(i)
        })
      }

      function tap(i) {
        if (turn !== 'w' || promote >= 0) return
        if (sel >= 0 && targets.indexOf(i) >= 0) { apply(sel, i); return }
        const p = board[i]
        if (p && WC.sideOf(p) === 'w') {
          sel = i
          targets = WC.legal(board, i, ep, castle)
          status.textContent = `已选，可走 ${targets.length} 步`
          render()
          return
        }
        sel = -1
        targets = []
        render()
      }

      function apply(from, to) {
        const piece = board[from]
        const captured = board[to]
        // 王车易位：同步移动车
        if (WC.typeOf(piece) === 'K' && Math.abs((to % 8) - (from % 8)) === 2) {
          const row = Math.floor(from / 8)
          if (to === row * 8 + 6) {
            board[row * 8 + 5] = board[row * 8 + 7]
            board[row * 8 + 7] = ''
          } else {
            board[row * 8 + 3] = board[row * 8]
            board[row * 8] = ''
          }
        }
        // 吃过路兵
        if (WC.typeOf(piece) === 'P' && to === ep && !captured) {
          const dir = WC.sideOf(piece) === 'w' ? 1 : -1
          board[to + dir * 8] = ''
        }
        board[to] = piece
        board[from] = ''
        // 记录易位权利
        if (WC.typeOf(piece) === 'K') castle[WC.sideOf(piece)] = null
        if (WC.typeOf(piece) === 'R') {
          const row = Math.floor(from / 8)
          if (from === row * 8) castle[WC.sideOf(piece)] && (castle[WC.sideOf(piece)].queenSide = false)
          if (from === row * 8 + 7) castle[WC.sideOf(piece)] && (castle[WC.sideOf(piece)].kingSide = false)
        }
        // 过路兵目标
        ep = -1
        if (WC.typeOf(piece) === 'P' && Math.abs(Math.floor(to / 8) - Math.floor(from / 8)) === 2) {
          ep = (Math.floor(to / 8) + Math.floor(from / 8)) / 2 * 8 + (to % 8)
        }
        // 升变
        if (WC.typeOf(piece) === 'P' && (Math.floor(to / 8) === 0 || Math.floor(to / 8) === 7)) {
          promote = to
          sel = -1
          targets = []
          render()
          showPromote(to, WC.sideOf(piece))
          return
        }
        sel = -1
        targets = []
        if (captured && WC.typeOf(captured) === 'K') {
          status.textContent = '你吃掉对方的王，获胜！🏆'
          turn = 'x'
          render()
          return
        }
        turn = 'b'
        render()
        setTimeout(ai, 320)
      }

      function showPromote(at, side) {
        status.textContent = '兵升变：选择要变成的棋子'
        const row = C.buttonRow(['Q', 'R', 'B', 'N'].map((t) => ({
          text: { Q: '后', R: '车', B: '象', N: '马' }[t],
          primary: t === 'Q',
          onClick: () => {
            board[at] = side + t
            promote = -1
            turn = 'b'
            render()
            setTimeout(ai, 320)
          }
        })))
        root.insertBefore(row, root.children[1])
      }

      function ai() {
        const moves = []
        for (let i = 0; i < 64; i++) {
          if (!board[i] || WC.sideOf(board[i]) !== 'b') continue
          WC.legal(board, i, ep, castle).forEach((to) => moves.push({ from: i, to }))
        }
        if (!moves.length) {
          status.textContent = WC.inCheck(board, 'b') ? '将杀！你获胜 🏆' : '逼和，平局'
          turn = 'x'
          return
        }
        let best = moves[0]
        let bestScore = -Infinity
        moves.forEach((m) => {
          const victim = board[m.to]
          let s = victim ? WC.value(WC.typeOf(victim)) : Math.random() * 6
          const nb = board.slice()
          nb[m.to] = nb[m.from]
          nb[m.from] = ''
          let risk = 0
          for (let i = 0; i < 64; i++) {
            if (!nb[i] || WC.sideOf(nb[i]) !== 'w') continue
            if (WC.pseudo(nb, i, -1).indexOf(m.to) >= 0) risk += WC.value(WC.typeOf(nb[m.to]))
          }
          s -= risk * 0.75
          if (WC.inCheck(nb, 'w')) s += 50
          if (s > bestScore) { bestScore = s; best = m }
        })
        const captured = board[best.to]
        const piece = board[best.from]
        if (WC.typeOf(piece) === 'K' && Math.abs((best.to % 8) - (best.from % 8)) === 2) {
          const row = Math.floor(best.from / 8)
          if (best.to === row * 8 + 6) { board[row * 8 + 5] = board[row * 8 + 7]; board[row * 8 + 7] = '' }
          else { board[row * 8 + 3] = board[row * 8]; board[row * 8] = '' }
        }
        board[best.to] = piece
        board[best.from] = ''
        if (WC.typeOf(piece) === 'P' && (Math.floor(best.to / 8) === 0 || Math.floor(best.to / 8) === 7)) {
          board[best.to] = 'bQ'
        }
        ep = -1
        if (captured && WC.typeOf(captured) === 'K') {
          status.textContent = '白王被吃，本局失利'
          turn = 'x'
          render()
          return
        }
        turn = 'w'
        status.textContent = (WC.inCheck(board, 'w') ? '将军！' : '') + '轮到你（白方）'
        render()
      }

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(table)
      root.appendChild(wrap)
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => {
          board = WC.layout(); turn = 'w'; sel = -1; targets = []; ep = -1; promote = -1
          castle = { w: { kingSide: true, queenSide: true }, b: { kingSide: true, queenSide: true } }
          status.textContent = '重开一局，你执白'; render()
        } }
      ]))
      C.rules(root, '规则：含王车易位、兵升变（自动升后）与吃过路兵；被将且无解即为将杀。')
      render()
    }
  })
})(window.ZZCore)
