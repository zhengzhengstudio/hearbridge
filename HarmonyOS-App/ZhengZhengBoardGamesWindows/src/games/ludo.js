// 飞行棋（中国飞行棋）：标准经典十字棋盘
// · 15×15 网格，52 格主跑道闭环（四内角为对角过渡），四色起点相隔 13 格
// · 四条归航通道各 5 格 → 中央四色风车终点
// · 四角机场（大色块 + 白色内框 + 2×2 停机圆点）
// · 四个起飞格带白色方向箭头；机场 → 中央 对角虚线航线
// 几何与底图同源：scripts/gen_ludo_cn_classic.py（SIZE/MARGIN/CS 完全一致）
// 玩家：0 红(左上) 1 黄(右上) 2 蓝(右下) 3 绿(左下)
(function (C) {
  const el = C.el

  // ===== 画布与网格（与 scripts/gen_ludo_cn_classic.py 完全一致）=====
  const SIZE = 800
  const MARGIN = 18
  const CS = (SIZE - 2 * MARGIN) / 15

  const COLORS = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54']
  const NAMES = ['红', '黄', '蓝', '绿']
  const CREAM = '#F4EDDD'
  const BROWN = '#5A3C28'
  const WHITE = '#FFFFFF'

  const START_OFFSET = [0, 13, 26, 39]  // 各方起飞格在主跑道上的下标
  const RING = 52                       // 主跑道总格数
  const MAIN = 51                       // 主跑道可停留步数（progress 0..50）
  const FINISH = 56                     // 到达中心终点

  // ===== 52 格主跑道（顺时针，15×15 网格 [行, 列]）=====
  const TRACK = []
  function run(r, c, dr, dc, n) {
    for (let i = 0; i < n; i++) TRACK.push([r + dr * i, c + dc * i])
  }
  run(6, 1, 0, 1, 5); run(5, 6, -1, 0, 6); TRACK.push([0, 7])
  run(0, 8, 1, 0, 6); run(6, 9, 0, 1, 6); TRACK.push([7, 14])
  run(8, 14, 0, -1, 6); run(9, 8, 1, 0, 6); TRACK.push([14, 7])
  run(14, 6, -1, 0, 6); run(8, 5, 0, -1, 6); TRACK.push([7, 0]); TRACK.push([6, 0])

  // 四条归航通道（从边缘走向中央）：0红左 / 1黄上 / 2蓝右 / 3绿下
  const HOME = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]
  ]

  // 四角机场 6×6 区域起点：0 左上 / 1 右上 / 2 右下 / 3 左下
  const YARD = [[0, 0], [0, 9], [9, 9], [9, 0]]

  // 中央风车四象限对应的玩家（上黄 / 右蓝 / 下绿 / 左红）
  const WIND = { top: 1, right: 2, bottom: 3, left: 0 }

  // ===== 坐标工具：与底图 1:1 对应 =====
  function cellX(rc) { return MARGIN + (rc[1] + 0.5) * CS }
  function cellY(rc) { return MARGIN + (rc[0] + 0.5) * CS }
  function cellRect(rc, inset) {
    const k = inset === undefined ? 0.06 : inset
    return [
      MARGIN + rc[1] * CS + CS * k,
      MARGIN + rc[0] * CS + CS * k,
      MARGIN + (rc[1] + 1) * CS - CS * k,
      MARGIN + (rc[0] + 1) * CS - CS * k
    ]
  }
  const CENTER = { x: MARGIN + 7.5 * CS, y: MARGIN + 7.5 * CS }

  // 跑道格归属玩家：i%4，且 0/13/26/39 恰为四方起飞格 → 起飞格自动是本方色
  function cellOwner(i) { return ((i % RING) + RING) % RING % 4 }

  function ringPos(abs) { return TRACK[((abs % RING) + RING) % RING] }
  function basePos(player, piece) {
    const y = YARD[player]
    const dx = (piece % 2 === 0 ? -1 : 1) * CS
    const dy = (piece < 2 ? -1 : 1) * CS
    return { x: cellX([y[0] + 2, y[1] + 2]) + dx, y: cellY([y[0] + 2, y[1] + 2]) + dy }
  }
  function planePos(player, piece, progress) {
    if (progress < 0) return basePos(player, piece)
    if (progress >= FINISH) {
      const f = {
        x: CENTER.x + (cellX([YARD[player][0] + 2, YARD[player][1] + 2]) - CENTER.x) * 0.06,
        y: CENTER.y + (cellY([YARD[player][0] + 2, YARD[player][1] + 2]) - CENTER.y) * 0.06
      }
      return f
    }
    if (progress < MAIN) {
      const p = ringPos(progress + START_OFFSET[player])
      return { x: cellX(p), y: cellY(p) }
    }
    const h = HOME[player][progress - MAIN]
    return { x: cellX(h), y: cellY(h) }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return }
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  // 飞机造型棋子（朝上）：机身 + 机翼 + 尾翼，颜色按方、选中高亮金边
  function drawPlane(ctx, x, y, r, color, selected) {
    ctx.save()
    ctx.translate(x, y)
    const stroke = selected ? '#F5C542' : 'rgba(255,255,255,.95)'
    const lw = selected ? 4 : 1.8
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.05)
    ctx.lineTo(r * 0.95, r * 0.35)
    ctx.lineTo(r * 0.25, r * 0.5)
    ctx.lineTo(-r * 0.25, r * 0.5)
    ctx.lineTo(-r * 0.95, r * 0.35)
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -r * 1.05)
    ctx.lineTo(r * 0.3, r * 0.55)
    ctx.lineTo(0, r * 0.35)
    ctx.lineTo(-r * 0.3, r * 0.55)
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, r * 0.45)
    ctx.lineTo(r * 0.4, r * 0.85)
    ctx.lineTo(-r * 0.4, r * 0.85)
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke()
    ctx.restore()
  }

  // ===== 棋盘绘制（与底图 gen_ludo_cn_classic.py 同一套几何）=====
  function drawBoard(ctx) {
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = CREAM
    ctx.fillRect(0, 0, SIZE, SIZE)
    // 外框
    ctx.strokeStyle = BROWN; ctx.lineWidth = 8
    roundRect(ctx, 4, 4, SIZE - 8, SIZE - 8, 22); ctx.stroke()

    // ---- 中央风车（上黄 / 右蓝 / 下绿 / 左红）----
    const cx0 = MARGIN + 6 * CS, cy0 = MARGIN + 6 * CS
    const cx1 = MARGIN + 9 * CS, cy1 = MARGIN + 9 * CS
    const tris = {
      top: [[cx0, cy0], [cx1, cy0], [CENTER.x, CENTER.y]],
      right: [[cx1, cy0], [cx1, cy1], [CENTER.x, CENTER.y]],
      bottom: [[cx1, cy1], [cx0, cy1], [CENTER.x, CENTER.y]],
      left: [[cx0, cy1], [cx0, cy0], [CENTER.x, CENTER.y]]
    }
    Object.keys(tris).forEach((k) => {
      const p = tris[k]
      ctx.beginPath()
      ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1])
      ctx.closePath()
      ctx.fillStyle = COLORS[WIND[k]]; ctx.fill()
      ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.stroke()
    })
    ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, CS * 0.9, 0, Math.PI * 2)
    ctx.fillStyle = WHITE; ctx.fill()
    ctx.strokeStyle = BROWN; ctx.lineWidth = 3; ctx.stroke()

    // ---- 归航通道（各 5 格，本方色）----
    for (let pl = 0; pl < 4; pl++) {
      HOME[pl].forEach((cell) => {
        const r = cellRect(cell)
        ctx.fillStyle = COLORS[pl]
        ctx.strokeStyle = WHITE; ctx.lineWidth = 3
        roundRect(ctx, r[0], r[1], r[2] - r[0], r[3] - r[1], CS * 0.18); ctx.fill(); ctx.stroke()
      })
    }

    // ---- 主跑道 52 格（四色循环）----
    for (let i = 0; i < RING; i++) {
      const r = cellRect(TRACK[i])
      ctx.fillStyle = COLORS[cellOwner(i)]
      ctx.strokeStyle = WHITE; ctx.lineWidth = 3
      roundRect(ctx, r[0], r[1], r[2] - r[0], r[3] - r[1], CS * 0.18); ctx.fill(); ctx.stroke()
    }

    // ---- 起飞格白色方向箭头 ----
    START_OFFSET.forEach((off) => {
      const c1 = TRACK[off], c2 = TRACK[(off + 1) % RING]
      const x = cellX(c1), y = cellY(c1)
      const ang = Math.atan2(cellY(c2) - y, cellX(c2) - x)
      const L = CS * 0.62, w = CS * 0.34
      const ca = Math.cos(ang), sa = Math.sin(ang)
      const rot = (px, py) => [x + px * ca - py * sa, y + px * sa + py * ca]
      const pts = [[-L / 2, -w / 2], [L / 2 - w * 0.4, -w / 2], [L / 2 - w * 0.4, -w * 0.85],
        [L / 2, 0], [L / 2 - w * 0.4, w * 0.85], [L / 2 - w * 0.4, w / 2], [-L / 2, w / 2]]
      ctx.beginPath()
      pts.forEach((p, i) => { const q = rot(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]) })
      ctx.closePath()
      ctx.fillStyle = WHITE; ctx.fill()
    })

    // ---- 四角机场（本色大块 + 白色内框 + 2×2 停机圆点）----
    for (let pl = 0; pl < 4; pl++) {
      const y0 = MARGIN + YARD[pl][0] * CS
      const x0 = MARGIN + YARD[pl][1] * CS
      const bx0 = x0, by0 = y0, bx1 = x0 + 6 * CS, by1 = y0 + 6 * CS
      ctx.fillStyle = COLORS[pl]
      ctx.strokeStyle = WHITE; ctx.lineWidth = 4
      roundRect(ctx, bx0, by0, bx1 - bx0, by1 - by0, CS * 0.5); ctx.fill(); ctx.stroke()
      const fi = CS * 0.55
      ctx.fillStyle = WHITE
      roundRect(ctx, bx0 + fi, by0 + fi, bx1 - bx0 - 2 * fi, by1 - by0 - 2 * fi, CS * 0.35); ctx.fill()
      const rad = CS * 0.55
      const dots = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]]
      dots.forEach((d) => {
        const cx = MARGIN + (YARD[pl][1] + d[1] + 0.5) * CS
        const cy = MARGIN + (YARD[pl][0] + d[0] + 0.5) * CS
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
        ctx.fillStyle = COLORS[pl]; ctx.fill()
      })
    }

    // ---- 机场 → 中央 对角虚线航线 ----
    for (let pl = 0; pl < 4; pl++) {
      const sx = cellX([YARD[pl][0] + 2, YARD[pl][1] + 2])
      const sy = cellY([YARD[pl][0] + 2, YARD[pl][1] + 2])
      const ex = CENTER.x + (sx - CENTER.x) * 0.25
      const ey = CENTER.y + (sy - CENTER.y) * 0.25
      ctx.setLineDash([CS * 0.32, CS * 0.26])
      ctx.strokeStyle = COLORS[pl]; ctx.lineWidth = 4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  C.register('ludo', {
    title: '飞行棋', note: '骰子规则 · 撞子 · 连跳', players: '2-4 人', accent: '#8E44AD',
    mount(root) {
      let pieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
      let turn = 0
      let dice = 0
      let options = []
      let needPick = false
      let count = 4
      let over = false

      const canvas = el('canvas', { width: SIZE, height: SIZE })
      canvas.style.maxWidth = '100%'
      const ctx = canvas.getContext('2d')
      const status = C.status(root, '你是红方，点「掷骰子」开始')

      function draw() {
        drawBoard(ctx)
        for (let pl = 0; pl < 4; pl++) {
          for (let pc = 0; pc < 4; pc++) {
            const prog = pieces[pl][pc]
            const p = planePos(pl, pc, prog)
            const pickable = needPick && pl === turn && C.isPlayer(turn) && options.indexOf(pc) >= 0
            drawPlane(ctx, p.x, p.y, pickable ? CS * 0.46 : CS * 0.4, COLORS[pl], pickable)
          }
        }
      }

      function captureAt(abs, player) {
        let msg = ''
        for (let opp = 0; opp < count; opp++) {
          if (opp === player) continue
          for (let j = 0; j < 4; j++) {
            const op = pieces[opp][j]
            if (op >= 0 && op < MAIN && (op + START_OFFSET[opp]) % RING === abs) {
              pieces[opp][j] = -1
              msg += `，撞回${NAMES[opp]}家第 ${j + 1} 架！`
            }
          }
        }
        return msg
      }

      function legalMoves(player, d) {
        const out = []
        for (let i = 0; i < 4; i++) {
          const p = pieces[player][i]
          if (p >= FINISH) continue
          if (p < 0 && d !== 6) continue
          out.push(i)
        }
        return out
      }

      function applyMove(player, piece, d) {
        const old = pieces[player][piece]
        let np
        let msg = ''
        if (old < 0) {
          np = 0
          msg = `${NAMES[player]}家第 ${piece + 1} 架起飞（掷 6）`
        } else {
          np = old + d
          if (np > FINISH) { np = 2 * FINISH - np; msg = `${NAMES[player]}家第 ${piece + 1} 架超程反弹` }
          else msg = `${NAMES[player]}家第 ${piece + 1} 架前进 ${d} 格`
        }
        if (np >= 0 && np < MAIN) {
          const abs = (np + START_OFFSET[player]) % RING
          msg += captureAt(abs, player)
          if (cellOwner(abs) === player && np + 4 < MAIN) {
            np += 4
            msg += '，同色连跳 4 格！'
            if (np < MAIN) msg += captureAt((np + START_OFFSET[player]) % RING, player)
          }
        }
        if (np === FINISH) msg += '，到达终点！'
        pieces[player][piece] = np
        status.textContent = msg
        if (pieces[player].every((v) => v === FINISH)) {
          over = true
          status.textContent = `${NAMES[player]}家 4 架飞机全部到达终点，${player === 0 ? '你获胜！🏆' : '本局失利'}`
          draw()
          return false
        }
        return d === 6
      }

      function roll() {
        if (over || needPick || !C.isPlayer(turn)) return
        dice = C.dice()
        const opts = legalMoves(turn, dice)
        if (!opts.length) {
          status.textContent = `${NAMES[turn]}方掷出 ${dice}，没有可动的飞机`
          next()
          return
        }
        if (opts.length === 1) { commit(turn, opts[0]); return }
        options = opts
        needPick = true
        status.textContent = `${NAMES[turn]}方掷出 ${dice} · 点选一架飞机移动`
        draw()
      }

      function commit(player, piece) {
        const again = applyMove(player, piece, dice)
        options = []
        needPick = false
        if (over) { draw(); return }
        if (player === 0 && again) {
          status.textContent += ' · 掷 6 再掷一次'
          draw()
          return
        }
        next()
      }

      function next() {
        if (over) return
        turn = (turn + 1) % count
        draw()
        if (!C.isPlayer(turn)) setTimeout(aiTurn, 620)
        else status.textContent = `${NAMES[turn]}方行动 · 点「掷骰子」`
      }

      function aiTurn() {
        if (over || C.isPlayer(turn)) return
        const d = C.dice()
        dice = d
        const opts = legalMoves(turn, d)
        if (!opts.length) { status.textContent = `${NAMES[turn]}家掷 ${d}，无可动飞机`; next(); return }
        let best = opts[0]
        let bestScore = -1
        opts.forEach((pc) => {
          const p = pieces[turn][pc]
          let s = Math.random()
          if (p < 0) s = 3
          else {
            let np = p + d
            if (np > FINISH) np = 2 * FINISH - np
            if (np >= FINISH) s = 20
            if (np < MAIN) {
              const abs = (np + START_OFFSET[turn]) % RING
              for (let opp = 0; opp < count; opp++) {
                if (opp === turn) continue
                for (let j = 0; j < 4; j++) {
                  const op = pieces[opp][j]
                  if (op >= 0 && op < MAIN && (op + START_OFFSET[opp]) % RING === abs) s = 10
                }
              }
            }
          }
          if (s > bestScore) { bestScore = s; best = pc }
        })
        const again = applyMove(turn, best, d)
        if (over) { draw(); return }
        if (again) { setTimeout(() => aiTurn(), 500); return }
        next()
      }

      canvas.addEventListener('click', (e) => {
        if (!needPick || !C.isPlayer(turn)) return
        const rect = canvas.getBoundingClientRect()
        const mx = (e.clientX - rect.left) * (SIZE / rect.width)
        const my = (e.clientY - rect.top) * (SIZE / rect.height)
        options.forEach((pc) => {
          const p = planePos(turn, pc, pieces[turn][pc])
          if (Math.hypot(p.x - mx, p.y - my) < CS * 0.6) commit(turn, pc)
        })
      })

      const wrap = el('div', { class: 'board-wrap' })
      wrap.appendChild(canvas)
      root.appendChild(wrap)
      const diceBox = C.infoRow([{ k: '骰子', v: '—' }])
      root.appendChild(diceBox)
      root.appendChild(C.buttonRow([
        { text: '掷骰子', primary: true, onClick: roll },
        { text: '2 人', onClick: () => setCount(2) },
        { text: '3 人', onClick: () => setCount(3) },
        { text: '4 人', onClick: () => setCount(4) }
      ]))
      const modes = C.modeToggle()
      root.appendChild(C.el('div', { class: 'row' }, [modes.node]))
      C.rules(root, '规则：中国飞行棋 52 格环形跑道，四色起点相隔 13 格；掷 6 起飞并再掷一次；落在敌机格把对方撞回机场；落在己方同色格再跳 4 格；走完 5 格终点通道到达中心风车；超过终点会反弹；4 架全部到达终点获胜。')
      C.on('mode', () => { modes.refresh(); status.textContent = C.isLocal() ? `线下模式：${NAMES[turn]}方由你操作` : 'AI 陪练：只有红方由你操作' })

      function setCount(n) {
        count = n
        pieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
        turn = 0
        dice = 0
        needPick = false
        over = false
        status.textContent = `切换为 ${n} 人局，你是红方`
        draw()
      }

      const origDraw = draw
      draw = function () {
        origDraw()
        const v = diceBox.querySelector('.v')
        if (v) v.textContent = dice ? dice : '—'
      }
      draw()
    }
  })
})(window.ZZCore)
