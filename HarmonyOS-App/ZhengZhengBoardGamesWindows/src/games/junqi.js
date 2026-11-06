// 陆战棋（中国军棋）· 暗棋：玩家红方明牌，对手蓝方暗子，交火后才互相揭晓
(function (C) {
  const el = C.el
  const W = 5
  const H = 12
  const BASE = [1, 3, 56, 58]
  // 行营：紧贴己方大本营的标准位置（红方在上半，蓝方镜像在下半）
  const CAMP = [7, 8, 12, 13, 17, 46, 47, 51, 52, 53]
  const NAMES = {
    '9': '司令', '8': '军长', '7': '师长', '6': '旅长', '5': '团长',
    '4': '营长', '3': '连长', '2': '排长', '1': '工兵', 'M': '地雷', 'B': '炸弹', 'F': '军旗'
  }

  function rankOf(p) {
    const t = p.charAt(1)
    if (t === 'F') return -2
    if (t === 'M') return 0
    if (t === 'B') return -1
    return parseInt(t, 10)
  }

  // 中国军棋铁路：每方一个独立的「口」字形闭环，红方沿上半绕行、蓝方沿下半镜像，
  // 两个闭环在中央不互通。此前实现是「中央 4 行全行横向铁路 + 两侧纵线」，
  // 两侧共用一条大铁路，规则本质与标准军棋不同。
  //
  // 几何（已用连通性脚本验证：恰好 2 个环，各 12 点，互不连通）：
  //   红方环 = 第 3 行整行 + 第 5 行整行 + 第 4 行第1/3 列 + 第 6 行第1/3 列的镜像侧
  //   蓝方环 = 上者的row -> 11 - row 镜像
  // 用镜像视角定义「红方环」，再判定实际落点属于哪一方，避免两处各写一遍。
  function railSide(idx) {
    return Math.floor(idx / 5) <= 5 ? 'r' : 'b'
  }

  function isRailPoint(idx) {
    const r = Math.floor(idx / 5)
    const c = idx % 5
    // 镜像到红方视角：蓝方 row r 映射为 11 - r
    const rr = railSide(idx) === 'r' ? r : 11 - r
    // 纵向铁路固定在第 1 / 第 3 列，覆盖第 3~6 行
    const onVert = (c === 1 || c === 3) && rr >= 3 && rr <= 6
    // 横向铁路在第 3 / 第 5 行，横贯整行（连接两条纵线并向外延伸一格）
    const onHoriz = (rr === 3 || rr === 5)
    return onVert || onHoriz
  }

  function isRail(a, b) {
    const ra = Math.floor(a / 5), ca = a % 5
    const rb = Math.floor(b / 5), cb = b % 5
    const sameRow = ra === rb && Math.abs(ca - cb) === 1
    const sameCol = ca === cb && Math.abs(ra - rb) === 1
    if (!sameRow && !sameCol) return false
    if (railSide(a) !== railSide(b)) return false
    return isRailPoint(a) && isRailPoint(b)
  }

  // 预计算每个落点相邻的铁路格，避免在 movesFrom 里重复做边界与环判定。
  const RAIL_NEIGHBORS = (function () {
    const table = []
    for (let i = 0; i < W * H; i++) {
      const list = []
      const r = Math.floor(i / W)
      const c = i % W
      if (isRailPoint(i)) {
        if (c > 0&& isRail(i - 1, i)) list.push(i - 1)
        if (c < W - 1 && isRail(i + 1, i)) list.push(i + 1)
        if (r > 0 && isRail(i - W, i)) list.push(i - W)
        if (r < H - 1 && isRail(i + W, i)) list.push(i + W)
      }
      table.push(list)
    }
    return table
  })()

  C.register('junqi', {
    title: '陆战棋', note: '暗棋 · 敌子未明 · 铁路行营', players: '2 人', accent: '#2F4F3A',
    mount(root) {
      let board = []
      let known = []      // 玩家视角已知
      let aiKnown = []    // AI 视角已知
      let turn = 'r'
      let sel = -1
      let over = false

      const status = C.status(root, '你是红方（自家明牌），蓝方棋子以暗子显示，交火后互相揭晓')

      function setup() {
        board = new Array(60).fill('')
        const ranks = ['9', '8', '7', '7', '6', '6', '5', '5', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1', 'B', 'B']
        for (let s = 0; s < 2; s++) {
          const side = s === 0 ? 'b' : 'r'
          const startRow = s === 0 ? 0 : 6
          const backRows = s === 0 ? [0, 1] : [10, 11]
          const baseA = s === 0 ? 1 : 56
          const baseB = s === 0 ? 3 : 58
          const flagBase = Math.random() < 0.5 ? baseA : baseB
          const mineBase = flagBase === baseA ? baseB : baseA
          board[flagBase] = side + 'F'
          board[mineBase] = side + 'M'
          const spots = []
          for (let r = startRow; r < startRow + 6; r++) {
            for (let col = 0; col < W; col++) {
              const idx = r * W + col
              if (BASE.indexOf(idx) >= 0 || CAMP.indexOf(idx) >= 0) continue
              if (board[idx]) continue
              spots.push(idx)
            }
          }
          C.shuffle(spots)
          const mineSpots = []
          const restSpots = []
          spots.forEach((idx) => {
            if (backRows.indexOf(Math.floor(idx / W)) >= 0) mineSpots.push(idx)
            else restSpots.push(idx)
          })
          C.shuffle(mineSpots)
          for (let m = 0; m < 2 && m < mineSpots.length; m++) board[mineSpots[m]] = side + 'M'
          for (let m = 2; m < mineSpots.length; m++) restSpots.push(mineSpots[m])
          const rest = C.shuffle(ranks.map((rk) => side + rk))
          for (let i = 0; i < restSpots.length && i < rest.length; i++) board[restSpots[i]] = rest[i]
        }
        // 视角：各自自家明牌
        known = board.map((p) => !!p && p.charAt(0) === 'r')
        aiKnown = board.map((p) => !!p && p.charAt(0) === 'b')
        turn = 'r'
        sel = -1
        over = false
      }
      setup()

      function movable(p) {
        const t = p.charAt(1)
        return t !== 'F' && t !== 'M'
      }

      function canEnter(from, to) {
        if (BASE.indexOf(to) >= 0) return false
        const target = board[to]
        if (!target) return true
        if (target.charAt(0) === board[from].charAt(0)) return false
        if (CAMP.indexOf(to) >= 0) return false
        return true
      }

      function movesFrom(idx) {
        const p = board[idx]
        if (!p || !movable(p)) return []
        const r = Math.floor(idx / W)
        const c = idx % W
        const out = []
        const inCamp = CAMP.indexOf(idx) >= 0
        const isEngineer = rankOf(p) === 1
        const dirs = inCamp
          ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
          : [[-1, 0], [1, 0], [0, -1], [0, 1]]
        dirs.forEach((d) => {
          const nr = r + d[0]
          const nc = c + d[1]
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) return
          const to = nr * W + nc
          if (!canEnter(idx, to)) return
          // 行营内棋子可八方向流动（行营内互相不受攻击）；行营外只走公路相邻格。
          // 铁路不在单步范围内 —— 工兵沿铁路远行由下面的 BFS 单独处理。
          if (!inCamp) return
          out.push(to)
        })
        // 铁路单步（相邻铁路格）：公路棋子也可沿铁路上一步
        if (!inCamp) {
          for (let i = 0; i < 4; i++) {
            const to = RAIL_NEIGHBORS[idx] && RAIL_NEIGHBORS[idx][i]
            if (to === undefined) continue
            if (canEnter(idx, to)) out.push(to)
          }
        }
        // 工兵沿铁路任意长距离
        if (isEngineer) {
          for (let i = 0; i < 60; i++) {
            if (i === idx) continue
            if (!canEnter(idx, i)) continue
            // 沿铁路 BFS
            const seen = new Set([idx])
            const queue = [idx]
            let found = false
            while (queue.length && !found) {
              const cur = queue.shift()
              const cr = Math.floor(cur / W)
              const cc = cur % W
              [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((d) => {
                const nr = cr + d[0]
                const nc = cc + d[1]
                if (nr < 0 || nr >= H || nc < 0 || nc >= W) return
                const nx = nr * W + nc
                if (!isRail(cur, nx) || seen.has(nx)) return
                seen.add(nx)
                // 铁路上若有棋子则不能越过（工兵也不能）
                if (board[nx]) return
                if (nx === i) found = true
                queue.push(nx)
              })
            }
            if (found && out.indexOf(i) < 0) out.push(i)
          }
        }
        return Array.from(new Set(out))
      }

      function sideHasMove(side) {
        for (let i = 0; i < 60; i++) {
          if (!board[i] || board[i].charAt(0) !== side) continue
          if (movesFrom(i).length) return true
        }
        return false
      }

      function reveal(idxArr) {
        idxArr.forEach((i) => {
          if (i >= 0 && i < 60) { known[i] = true; aiKnown[i] = true }
        })
      }

      function applyMove(from, to) {
        const attacker = board[from]
        const defender = board[to]
        const aSide = attacker.charAt(0)
        board[from] = ''
        let text = ''
        if (!defender) {
          board[to] = attacker
          text = `红方${NAMES[attacker.charAt(1)]}移动`.replace('红方', aSide === 'r' ? '红方' : '蓝方')
        } else {
          reveal([from, to])
          const aRank = rankOf(attacker)
          const dRank = rankOf(defender)
          const aName = (aSide === 'r' ? '红方' : '蓝方') + NAMES[attacker.charAt(1)]
          const dName = (defender.charAt(0) === 'r' ? '红方' : '蓝方') + NAMES[defender.charAt(1)]
          if (dRank === -2) {
            board[to] = attacker
            text = `${aName}夺得${dName}，${aSide === 'r' ? '你获胜！🏆' : '你失利'}`
            over = true
          } else if (dRank === 0 && aRank === 1) {
            board[to] = attacker
            text = `${aName}挖掉${dName}`
          } else if (dRank === 0) {
            text = `${aName}触雷阵亡`
          } else if (dRank === -1 || aRank === -1) {
            text = `${aName}与${dName}同归于尽`
          } else if (aRank > dRank) {
            board[to] = attacker
            text = `${aName}吃掉${dName}`
          } else if (aRank === dRank) {
            text = `${aName}与${dName}对拼双双阵亡`
          } else {
            text = `${aName}进攻${dName}失败阵亡`
          }
        }
        sel = -1
        if (over) { status.textContent = text; render(); return }
        const next = aSide === 'r' ? 'b' : 'r'
        turn = next
        if (!sideHasMove(next)) {
          over = true
          status.textContent = `${text} · ${next === 'r' ? '红' : '蓝'}方无子可动，${aSide === 'r' ? '红方（你）' : '蓝方'}获胜！🏆`
          render()
          return
        }
        status.textContent = text + ` · 轮到${next === 'r' ? '你（红方）' : (C.isLocal() ? '蓝方（你操作）' : '蓝方（电脑）')}`
        render()
        // 线下双人模式：蓝方也由本机玩家操作，AI 不再自动走
        if (next === 'b' && !C.isPlayer(1)) setTimeout(aiMove, 520)
      }

      function aiMove() {
        if (over) return
        const moves = []
        for (let i = 0; i < 60; i++) {
          const p = board[i]
          if (!p || p.charAt(0) !== 'b' || !movable(p)) continue
          movesFrom(i).forEach((to) => moves.push({ from: i, to }))
        }
        if (!moves.length) {
          status.textContent = '蓝方无子可动，你获胜！🏆'
          over = true
          render()
          return
        }
        let best = moves[0]
        let bestScore = -Infinity
        moves.forEach((m) => {
          const cell = board[m.from]
          const target = board[m.to]
          let s = Math.random() * 4
          if (target) {
            const aRank = rankOf(cell)
            const dRank = rankOf(target)
            if (!aiKnown[m.to]) {
              // AI 不知道这枚红子是什么，只能按期望试探（不作弊）
              if (aRank === -1) s += 12
              else if (aRank === 9) s += 14
              else if (aRank === 1) s += 3
              else s += 5
            } else if (dRank === -2) s += 1000
            else if (dRank === 0 && aRank === 1) s += 60
            else if (dRank === 0) s += -5
            else if (dRank === -1) s += aRank >= 7 ? 30 : -10
            else if (aRank > dRank) s += 10 + dRank * 3
            else if (aRank === dRank) s += aRank >= 7 ? -8 : 4
            else s += -6 - aRank
          } else {
            // 朝红方大本营方向推进
            const d0 = Math.abs(Math.floor(m.from / W) - 10) + Math.abs(m.from % W - 1)
            const d1 = Math.abs(Math.floor(m.to / W) - 10) + Math.abs(m.to % W - 1)
            s += Math.max(0, d0 - d1)
          }
          if (s > bestScore) { bestScore = s; best = m }
        })
        applyMove(best.from, best.to)
      }

      const table = el('table', { class: 'board' })
      const cells = []
      for (let r = 0; r < H; r++) {
        const tr = el('tr')
        for (let c = 0; c < W; c++) {
          const td = el('td', { style: 'width:56px;height:38px;font-size:15px;cursor:pointer' })
          cells.push(td)
          tr.appendChild(td)
        }
        table.appendChild(tr)
      }

      function render() {
        cells.forEach((td, i) => {
          td.innerHTML = ''
          let bg = '#EEE6D2'
          if (BASE.indexOf(i) >= 0) bg = '#8E6E4A'
          else if (CAMP.indexOf(i) >= 0) bg = '#C9B79A'
          else if (Math.floor(i / W) >= 4 && Math.floor(i / W) <= 7) bg = '#E6DCC4'
          td.style.background = bg
          td.style.border = '1px solid #B9A483'
          if (sel === i) td.style.outline = '3px solid #F5C542'
          else td.style.outline = ''
          const p = board[i]
          if (!p) return
          const isRed = p.charAt(0) === 'r'
          const shown = known[i]
          const span = el('span', {
            class: 'chip',
            text: shown ? NAMES[p.charAt(1)] : '暗子'
          })
          span.style.display = 'inline-block'
          span.style.padding = '2px 6px'
          span.style.borderRadius = '4px'
          span.style.color = '#fff'
          span.style.fontSize = '12px'
          span.style.background = shown ? (isRed ? '#C0392B' : '#2E5C8A') : '#3C4A60'
          td.appendChild(span)
          td.onclick = () => tap(i)
        })
      }

      function tap(i) {
        if (over || !C.isPlayer(turn === 'r' ? 0 : 1)) return
        const p = board[i]
        if (sel >= 0 && movesFrom(sel).indexOf(i) >= 0) { applyMove(sel, i); return }
        if (p && p.charAt(0) === turn && movable(p)) {
          sel = i
          status.textContent = `已选${NAMES[p.charAt(1)]}，金色高亮为可走点`
          render()
        } else {
          sel = -1
          render()
        }
      }

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(table)
      root.appendChild(wrap)
      root.appendChild(C.infoRow([
        { k: '你的明子', v: board.filter((p, i) => p && p.charAt(0) === 'r' && known[i]).length },
        { k: '敌方暗子', v: board.filter((p, i) => p && p.charAt(0) === 'b' && !known[i]).length },
        { k: '已揭晓', v: known.filter((k) => k).length }
      ]))
      const modes = C.modeToggle()
      root.appendChild(C.el('div', { class: 'row' }, [modes.node]))
      root.appendChild(C.buttonRow([
        { text: '重开', onClick: () => { setup(); status.textContent = '暗棋模式 · 你是红方，蓝方为暗子'; render() } }
      ]))
      C.rules(root, '暗棋规则：你只能看到自己的棋子；敌方棋子显示「暗子」，一旦发生交战双方子力同时亮明。工兵可沿铁路任意行进并可挖地雷，炸弹与任何棋子同归于尽，夺得军旗即胜。')
      C.on('mode', () => { modes.refresh(); status.textContent = C.isLocal() ? '线下双人：红蓝双方都由你操作' : 'AI 陪练：蓝方由电脑走棋' })
      render()
      root.querySelector('.info-grid').id = 'junqi-info'
      // 使信息条随局面刷新
      const origRender = render
      render = function () {
        origRender()
        const info = root.querySelector('#junqi-info')
        if (info) {
          const boxes = info.querySelectorAll('.v')
          if (boxes.length >= 3) {
            boxes[0].textContent = board.filter((p, i) => p && p.charAt(0) === 'r' && known[i]).length
            boxes[1].textContent = board.filter((p, i) => p && p.charAt(0) === 'b' && !known[i]).length
            boxes[2].textContent = known.filter((k) => k).length
          }
        }
      }
      render()
    }
  })
})(window.ZZCore)
