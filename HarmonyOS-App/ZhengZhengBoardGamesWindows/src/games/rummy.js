// 拉密 Rummikub：106 张牌（13×4色×2 + 2 百搭），顺子/刻子，首次出牌 30 分
(function (C) {
  const el = C.el
  const JOKER = 99
  const SUIT_MARK = ['●', '■', '▲', '◆']
  const SUIT_CLASS = ['c0', 'c1', 'c2', 'c3']

  function valueOf(t) { return t === JOKER ? 0 : t % 20 }
  function colorOf(t) { return t === JOKER ? -1 : Math.floor(t / 20) }
  function label(t) { return t === JOKER ? '🃏' : SUIT_MARK[colorOf(t)] + valueOf(t) }
  function cls(t) { return t === JOKER ? 'joker' : SUIT_CLASS[colorOf(t)] }

  function normalSet(tiles) {
    const n = tiles.length
    if (n < 3) return false
    // 刻子：同数字不同色，3-4 张
    const v0 = tiles[0] % 20
    let same = true
    const colors = []
    for (let i = 0; i < n; i++) {
      if (tiles[i] % 20 !== v0 || colors.indexOf(Math.floor(tiles[i] / 20)) >= 0) { same = false; break }
      colors.push(Math.floor(tiles[i] / 20))
    }
    if (same) return true
    // 顺子：同色连续
    const c0 = Math.floor(tiles[0] / 20)
    const vs = []
    for (let i = 0; i < n; i++) {
      if (Math.floor(tiles[i] / 20) !== c0) return false
      vs.push(tiles[i] % 20)
    }
    vs.sort((a, b) => a - b)
    for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1] + 1) return false
    return vs.length >= 3
  }

  function validSet(tiles) {
    if (tiles.length < 3) return false
    const jokers = tiles.filter((t) => t === JOKER)
    if (jokers.length > 1) return false
    if (!jokers.length) return normalSet(tiles)
    const rest = tiles.filter((t) => t !== JOKER)
    for (let c = 0; c < 4; c++) {
      for (let v = 1; v <= 13; v++) {
        if (normalSet(rest.concat([c * 20 + v]))) return true
      }
    }
    return false
  }

  function scoreOf(tiles) {
    const jokers = tiles.filter((t) => t === JOKER)
    const rest = tiles.filter((t) => t !== JOKER)
    if (!jokers.length) return rest.reduce((a, t) => a + (t % 20), 0)
    let best = 0
    for (let c = 0; c < 4; c++) {
      for (let v = 1; v <= 13; v++) {
        const cand = rest.concat([c * 20 + v])
        if (normalSet(cand)) {
          const s = cand.reduce((a, t) => a + (t % 20), 0)
          if (s > best) best = s
        }
      }
    }
    return best
  }

  C.register('rummy', {
    title: '拉密', note: '106 张标准牌组 · 顺子与刻子', players: '2-4 人', accent: '#2471A3',
    mount(root) {
      let hand = []
      let sets = []
      let deck = []
      let ai = [[], []]
      let picked = []
      let opened = false
      let turn = 0
      let winner = -1
      let selSet = -1

      // 牌架行数：默认 2 行 × 每行 8 张 = 16 张位。用户可自行增减行数（1~4），
      // 之前是一维流式铺满，换行完全由窗口宽度决定，想留出整齐的牌架做不到。
      const COLS = 8
      let rackRows = 2

      const status = C.status(root, '首次出牌需要 ≥30 分')

      function build() {
        const tiles = []
        for (let copy = 0; copy < 2; copy++) {
          for (let c = 0; c < 4; c++) for (let v = 1; v <= 13; v++) tiles.push(c * 20 + v)
        }
        tiles.push(JOKER, JOKER)
        const s = C.shuffle(tiles)
        hand = s.slice(0, 14).sort((a, b) => a - b)
        ai = [s.slice(14, 28), s.slice(28, 42)]
        deck = s.slice(42)
        sets = []
        picked = []
        opened = false
        turn = 0
        winner = -1
        selSet = -1
        status.textContent = '首次出牌需要 ≥30 分；点手牌选中，再点「出新组合」或点桌面组合并入'
      }
      build()

      function render() {
        C.clear(root.querySelector('.rummy-body'))
        const body = root.querySelector('.rummy-body')

        body.appendChild(C.infoRow([
          { k: '牌堆', v: deck.length },
          { k: '对手1', v: ai[0].length },
          { k: '对手2', v: ai[1].length },
          { k: '你的手牌', v: hand.length }
        ]))

        const turnLine = el('div', { class: 'status', text: winner === 0 ? '你出完了所有牌，获胜！🏆'
          : winner > 0 ? `对手 ${winner} 出完了所有牌，本局结束`
            : (turn === 0 ? '你的回合' : `对手 ${turn} 思考中…`) })
        body.appendChild(turnLine)

        body.appendChild(el('div', { class: 'rules', text: '公共组合区（点一组可把待出牌并入）' }))
        const tableWrap = el('div')
        if (!sets.length) tableWrap.appendChild(el('div', { class: 'rules', text: '还没有任何组合' }))
        sets.forEach((set, si) => {
          const row = el('div', { style: 'display:inline-block;padding:4px;margin:3px;border-radius:6px;background:' + (selSet === si ? 'rgba(245,197,66,.25)' : 'transparent') })
          set.forEach((t) => {
            row.appendChild(el('span', { class: 'tile ' + cls(t), text: label(t) }))
          })
          row.onclick = () => { selSet = si; addToSet(si) }
          tableWrap.appendChild(row)
        })
        body.appendChild(tableWrap)

        body.appendChild(el('div', { class: 'rules', text: `你的牌架 · ${hand.length} 张（已选 ${picked.length} 张）· ${rackRows} 行 × ${COLS} 张` }))
        // 牌架按行分格渲染：行数由用户控制，空位显示占位框，方便看清牌架容量
        const handWrap = el('div', { class: 'rack' })
        for (let r = 0; r < rackRows; r++) {
          const line = el('div', { class: 'rack-row' })
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c
            if (i < hand.length) {
              const t = hand[i]
              const tile = el('span', { class: 'tile ' + cls(t) + (picked.indexOf(t) >= 0 ? ' sel' : ''), text: label(t) })
              tile.onclick = () => {
                if (turn !== 0 || winner >= 0) return
                const at = picked.indexOf(t)
                if (at >= 0) picked.splice(at, 1)
                else picked.push(t)
                render()
              }
              line.appendChild(tile)
            } else {
              line.appendChild(el('span', { class: 'tile empty', text: '' }))
            }
          }
          handWrap.appendChild(line)
        }
        body.appendChild(handWrap)

        // 牌架维护：行数增减 + 整理（按颜色/数值排序）
        body.appendChild(C.buttonRow([
          { text: '减少一行', disabled: rackRows <= 1, onClick: () => { rackRows--; render() } },
          { text: '增加一行', disabled: rackRows >= 4, onClick: () => { rackRows++; render() } },
          { text: '整理牌架', onClick: () => { sortHand(); render() } }
        ]))

        body.appendChild(C.buttonRow([
          { text: '出新组合', primary: true, disabled: turn !== 0 || winner >= 0, onClick: playNewSet },
          { text: '清空选择', onClick: () => { picked = []; render() } }
        ]))
        const modes = C.modeToggle()
        body.appendChild(C.el('div', { class: 'row' }, [modes.node]))
        body.appendChild(C.buttonRow([
          { text: '摸牌结束回合', disabled: turn !== 0 || winner >= 0, onClick: draw },
          { text: '重开', onClick: () => { build(); render() } }
        ]))
        C.on('mode', () => {
          modes.refresh()
          status.textContent = C.isLocal() ? '线下模式：三位玩家都由你操作' : 'AI 陪练：两位对手由电脑出牌'
        })
      }

      // 整理：同色成组、组内按数值升序（JOKER 排最后），便于凑顺子/刻子
      function sortHand() {
        hand.sort((a, b) => {
          const ca = colorOf(a), cb = colorOf(b)
          if (ca !== cb) {
            if (ca === -1) return 1
            if (cb === -1) return -1
            return ca - cb
          }
          return valueOf(a) - valueOf(b)
        })
        status.textContent = '已按颜色与数值整理牌架'
      }

      function playNewSet() {
        if (picked.length < 3) { status.textContent = '新组合至少要 3 张牌'; render(); return }
        if (!validSet(picked)) { status.textContent = '牌型不合法：需要同色连续顺子，或同数字不同色的刻子'; render(); return }
        const s = scoreOf(picked)
        if (!opened && s < 30) { status.textContent = `首次出牌需 ≥30 分，这组只有 ${s} 分`; render(); return }
        picked.forEach((t) => {
          const at = hand.indexOf(t)
          if (at >= 0) hand.splice(at, 1)
        })
        sets.push(picked.slice())
        opened = true
        picked = []
        status.textContent = `出新组合 ${s} 分`
        checkWin()
        render()
      }

      function addToSet(si) {
        if (turn !== 0 || winner >= 0 || !picked.length) {
          if (!picked.length) status.textContent = '先在牌架上选牌，再点要并入的组合'
          render()
          return
        }
        const base = sets[si]
        if (!opened && scoreOf(picked) + scoreOf(base) < 30) {
          status.textContent = '首次出牌需 ≥30 分，并入后仍不足'
          render()
          return
        }
        const head = picked.concat(base)
        const tail = base.concat(picked)
        let merged = null
        if (validSet(head)) merged = head
        else if (validSet(tail)) merged = tail
        if (!merged) { status.textContent = '并入后不是合法组合（只能接在顺子两端或补进刻子）'; render(); return }
        picked.forEach((t) => {
          const at = hand.indexOf(t)
          if (at >= 0) hand.splice(at, 1)
        })
        sets[si] = merged
        opened = true
        picked = []
        selSet = -1
        status.textContent = `已并入组合 ${si + 1}`
        checkWin()
        render()
      }

      function draw() {
        picked = []
        if (!deck.length) {
          let best = 0
          let bestCount = hand.length
          ai.forEach((h, i) => { if (h.length < bestCount) { bestCount = h.length; best = i + 1 } })
          winner = best
          status.textContent = best === 0 ? `牌堆摸完 · 你手牌最少（${hand.length} 张）获胜！🏆` : `牌堆摸完 · 对手 ${best} 手牌最少`
          render()
          return
        }
        hand.push(deck[0])
        deck = deck.slice(1)
        hand.sort((a, b) => a - b)
        // 线下模式下不再把回合交给 AI，回合仍回到本机玩家
        turn = C.isAi() ? 1 : 0
        status.textContent = C.isAi() ? '摸了一张牌，轮到对手' : '摸了一张牌（线下模式：你继续操作）'
        render()
        if (C.isAi()) setTimeout(() => aiLoop(1), 520)
      }

      function checkWin() {
        if (!hand.length) { winner = 0; status.textContent = '你出完了所有牌，获胜！🏆' }
      }

      function aiFindSet(h) {
        for (let size = 5; size >= 3; size--) {
          for (let i = 0; i < h.length; i++) {
            const t = h[i]
            const color = colorOf(t)
            const value = valueOf(t)
            if (color >= 0) {
              const pick = [t]
              for (let k = 1; k < size; k++) {
                const want = color * 20 + (value + k)
                if (h.indexOf(want) < 0) break
                pick.push(want)
              }
              if (pick.length === size && validSet(pick)) return pick
            }
            if (value > 0) {
              const group = [t]
              for (let c = 0; c < 4; c++) {
                const want = c * 20 + value
                if (want === t) continue
                if (h.indexOf(want) >= 0 && group.indexOf(want) < 0) group.push(want)
              }
              if (group.length === size && validSet(group)) return group
            }
          }
        }
        return []
      }

      function aiAct(seat) {
        const h = ai[seat - 1].slice()
        let played = false
        for (let s = 0; s < sets.length && !played; s++) {
          for (let i = 0; i < h.length && !played; i++) {
            const base = sets[s]
            const head = [h[i]].concat(base)
            const tail = base.concat([h[i]])
            if (validSet(head) || validSet(tail)) {
              if (!opened && scoreOf([h[i]]) + scoreOf(base) < 30) continue
              sets[s] = validSet(head) ? head : tail
              h.splice(i, 1)
              opened = true
              played = true
            }
          }
        }
        if (!played) {
          const found = aiFindSet(h)
          if (found.length >= 3 && (opened || scoreOf(found) >= 30)) {
            found.forEach((t) => {
              const at = h.indexOf(t)
              if (at >= 0) h.splice(at, 1)
            })
            sets.push(found)
            opened = true
            played = true
            status.textContent = `对手 ${seat} 打出一组 ${found.length} 张`
          }
        }
        if (!played && deck.length) {
          h.push(deck[0])
          deck = deck.slice(1)
        }
        ai[seat - 1] = h
        if (!h.length) winner = seat
      }

      function aiLoop(seat) {
        if (seat > 2 || winner >= 0) { turn = 0; render(); return }
        aiAct(seat)
        render()
        if (winner >= 0) return
        const next = seat + 1
        if (next > 2) { turn = 0; render(); return }
        turn = next
        setTimeout(() => aiLoop(next), 480)
      }

      const body = el('div', { class: 'rummy-body' })
      root.appendChild(body)
      C.rules(root, '规则：3 张以上同色连续为顺子，3-4 张同数字不同色为刻子；百搭可替代任意一张；首次出牌需 ≥30 分；每回合没出牌就要摸一张。')
      render()
    }
  })
})(window.ZZCore)
