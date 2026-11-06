// 牌类：斗地主 / 麻将 / 扑克（炸金花）
(function (C) {
  const el = C.el

  // ================= 斗地主 =================
  const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'w', 'W']
  const RANK_VALUE = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, '2': 15, w: 16, W: 17 }
  const SUITS = ['♠', '♥', '♣', '♦']

  function deck54() {
    const d = []
    SUITS.forEach((s) => RANKS.slice(0, 13).forEach((r) => d.push(s + r)))
    d.push('🃏小', '🃏大')
    return d
  }
  function rankOf(card) {
    const raw = card.replace('🃏', '')
    if (raw === '小') return 16
    if (raw === '大') return 17
    return RANK_VALUE[card.slice(1)]
  }
  function labelOf(card) {
    return card
  }
  function isRed(card) {
    return card.indexOf('♥') >= 0 || card.indexOf('♦') >= 0 || card.indexOf('🃏') >= 0
  }

  // 牌型：{ type, value, len } type: 1单 2对 3三 4三带一 5三带二 6顺子 7连对 8飞机 9四带二 10炸弹 11王炸
  function parseCombo(cards) {
    const n = cards.length
    if (!n) return null
    const vals = cards.map(rankOf).sort((a, b) => a - b)
    const counts = {}
    vals.forEach((v) => counts[v] = (counts[v] || 0) + 1)
    const groups = Object.keys(counts).map((k) => ({ v: parseInt(k, 10), c: counts[k] }))
      .sort((a, b) => b.c - a.c || b.v - a.v)
    if (n === 2 && vals[0] === 16 && vals[1] === 17) return { type: 11, value: 100, len: 1 }
    if (n === 4 && groups.length === 1) return { type: 10, value: groups[0].v, len: 1 }
    if (n === 1) return { type: 1, value: vals[0], len: 1 }
    if (n === 2 && groups.length === 1) return { type: 2, value: groups[0].v, len: 1 }
    if (n === 3 && groups.length === 1) return { type: 3, value: groups[0].v, len: 1 }
    if (n === 4 && groups.length === 2 && groups[0].c === 3) return { type: 4, value: groups[0].v, len: 1 }
    if (n === 5 && groups.length === 2 && groups[0].c === 3 && groups[1].c === 2) return { type: 5, value: groups[0].v, len: 1 }
    if (n === 6 && groups.length === 2 && groups[0].c === 4) return { type: 9, value: groups[0].v, len: 1 }
    if (n === 8 && groups.length === 2 && groups[0].c === 4 && groups[1].c === 4) return { type: 10, value: groups[0].v, len: 1 }
    // 顺子
    if (n >= 5 && groups.length === n && groups.every((g) => g.c === 1)) {
      const vs = groups.map((g) => g.v).sort((a, b) => a - b)
      let ok = true
      for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1] + 1) ok = false
      if (ok && vs[vs.length - 1] <= 14) return { type: 6, value: vs[vs.length - 1], len: n }
    }
    // 连对
    if (n >= 6 && n % 2 === 0 && groups.length === n / 2 && groups.every((g) => g.c === 2)) {
      const vs = groups.map((g) => g.v).sort((a, b) => a - b)
      let ok = true
      for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1] + 1) ok = false
      if (ok && vs[vs.length - 1] <= 14) return { type: 7, value: vs[vs.length - 1], len: n / 2 }
    }
    // 飞机（连续三张）
    if (n >= 6 && n % 3 === 0 && groups.length === n / 3 && groups.every((g) => g.c === 3)) {
      const vs = groups.map((g) => g.v).sort((a, b) => a - b)
      let ok = true
      for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1] + 1) ok = false
      if (ok && vs[vs.length - 1] <= 14) return { type: 8, value: vs[vs.length - 1], len: n / 3 }
    }
    return null
  }

  function beats(a, b) {
    if (!a) return false
    if (!b) return true
    if (a.type === 11) return true
    if (b.type === 11) return false
    if (a.type === 10 && b.type !== 10) return true
    if (b.type === 10 && a.type !== 10) return false
    return a.type === b.type && a.len === b.len && a.value > b.value
  }

  C.register('landlord', {
    title: '斗地主', note: '叫抢地主 · 完整牌型 · 炸弹', players: '3 人', accent: '#C05621',
    mount(root) {
      let hands = [[], [], []]
      let bottom = []
      let landlord = -1
      let turn = 0
      let lastCombo = null
      let lastPlayer = -1
      let selected = []
      let over = false
      let multiplier = 1

      const status = C.status(root, '发牌完成，点「叫地主」抢地主')
      const body = el('div')
      root.appendChild(body)

      function deal() {
        const d = C.shuffle(deck54())
        hands = [sortCards(d.slice(0, 17)), sortCards(d.slice(17, 34)), sortCards(d.slice(34, 51))]
        bottom = d.slice(51)
        landlord = -1
        turn = 0
        lastCombo = null
        lastPlayer = -1
        selected = []
        over = false
        multiplier = 1
        status.textContent = '发牌完成 · 你是 1 号位，是否叫地主？'
      }
      function sortCards(arr) {
        return arr.slice().sort((a, b) => rankOf(a) - rankOf(b))
      }
      deal()

      function render() {
        C.clear(body)
        body.appendChild(C.infoRow([
          { k: '地主', v: landlord >= 0 ? `${landlord + 1} 号` : '未定' },
          { k: '底牌', v: landlord >= 0 ? bottom.map(labelOf).join(' ') : '???' },
          { k: '倍数', v: '×' + multiplier },
          { k: '剩余', v: `${hands[1].length} / ${hands[2].length}` }
        ]))
        if (landlord < 0) {
          body.appendChild(C.buttonRow([
            { text: '叫地主', primary: true, onClick: () => becomeLandlord(0) },
            { text: '不叫', onClick: () => { becomeLandlord(1) } }
          ]))
        }

        // 对手手牌（背面）
        const oppRow = el('div', { style: 'display:flex;gap:10px;margin:8px 0' })
        ;[1, 2].forEach((i) => {
          const box = el('div', { style: 'flex:1;padding:8px;border:1px solid #E3DDD2;border-radius:8px;background:#F7F3EA' })
          box.appendChild(el('div', { style: 'font-size:12px;color:#6B7280', text: `${i + 1} 号 · ${hands[i].length} 张` }))
          const cards = el('div')
          for (let k = 0; k < Math.min(hands[i].length, 10); k++) {
            cards.appendChild(el('span', { class: 'card-face back', text: '🂠', style: 'width:26px;height:36px;font-size:12px;margin:1px' }))
          }
          box.appendChild(cards)
          oppRow.appendChild(box)
        })
        body.appendChild(oppRow)

        // 我的手牌
        const mine = el('div', { style: 'margin:8px 0' })
        hands[0].forEach((card) => {
          const face = el('div', {
            class: 'card-face ' + (isRed(card) ? 'red' : '') + (selected.indexOf(card) >= 0 ? ' sel' : ''),
            text: labelOf(card)
          })
          face.onclick = () => {
            if (over || turn !== 0 || landlord < 0) return
            const at = selected.indexOf(card)
            if (at >= 0) selected.splice(at, 1)
            else selected.push(card)
            render()
          }
          mine.appendChild(face)
        })
        body.appendChild(mine)

        if (landlord >= 0 && !over) {
          body.appendChild(C.buttonRow([
            { text: '出牌', primary: true, disabled: turn !== 0, onClick: play },
            { text: '不要（过）', disabled: turn !== 0 || !lastCombo, onClick: pass },
            { text: '提示', disabled: turn !== 0, onClick: hint },
            { text: '重开', onClick: () => { deal(); render() } }
          ]))
        }
      }

      function becomeLandlord(who) {
        landlord = who
        hands[who] = sortCards(hands[who].concat(bottom))
        turn = who
        status.textContent = who === 0 ? '你成为地主，拿到 3 张底牌，请出牌' : `${who + 1} 号成为地主`
        render()
        if (who !== 0) setTimeout(aiTurn, 700)
      }

      function removeCards(who, cards) {
        cards.forEach((c) => {
          const at = hands[who].indexOf(c)
          if (at >= 0) hands[who].splice(at, 1)
        })
      }

      function play() {
        if (turn !== 0 || over) return
        const combo = parseCombo(selected)
        if (!combo) { status.textContent = '牌型不合法'; return }
        if (lastCombo && lastPlayer !== 0 && !beats(combo, lastCombo)) {
          status.textContent = '压不过上家的牌'
          return
        }
        if (combo.type === 10 || combo.type === 11) multiplier *= 2
        removeCards(0, selected)
        lastCombo = combo
        lastPlayer = 0
        selected = []
        if (!hands[0].length) {
          over = true
          status.textContent = landlord === 0 ? `你出完了牌，地主获胜！🏆（倍数 ×${multiplier}）` : `你出完了牌，农民获胜！🏆（倍数 ×${multiplier}）`
          render()
          return
        }
        status.textContent = '你出牌：' + comboName(combo)
        turn = 1
        render()
        setTimeout(aiTurn, 720)
      }

      function comboName(c) {
        const names = { 1: '单张', 2: '对子', 3: '三张', 4: '三带一', 5: '三带二', 6: '顺子', 7: '连对', 8: '飞机', 9: '四带二', 10: '炸弹', 11: '王炸' }
        return names[c.type] || '牌'
      }

      function pass() {
        if (turn !== 0 || !lastCombo) return
        status.textContent = '你选择不要'
        turn = 1
        render()
        setTimeout(aiTurn, 620)
      }

      function hint() {
        const beat = findBeat(hands[0], lastCombo && lastPlayer !== 0 ? lastCombo : null)
        if (!beat) { status.textContent = '没有能压过的牌，可以点「不要」'; return }
        selected = beat.slice()
        render()
      }

      // 从手牌找出能压过 target 的最小组合
      function findBeat(hand, target) {
        const counts = {}
        hand.forEach((c) => { const v = rankOf(c); counts[v] = (counts[v] || 0) + 1 })
        const vs = Object.keys(counts).map((k) => parseInt(k, 10)).sort((a, b) => a - b)
        function take(v, n) {
          const out = []
          hand.forEach((c) => { if (rankOf(c) === v && out.length < n) out.push(c) })
          return out.length === n ? out : null
        }
        function kickers(size, exclude, need) {
          const out = []
          const pool = []
          vs.forEach((v) => {
            if (v === exclude) return
            for (let k = 0; k < counts[v]; k++) pool.push(v)
          })
          // 优先用散牌
          const sorted = pool.slice().sort((a, b) => counts[a] - counts[b])
          for (let i = 0; i < sorted.length && out.length < need; i++) {
            const v = sorted[i]
            const used = out.filter((x) => rankOf(x) === v).length
            if (used + 1 > counts[v]) continue
            const c = hand.find((x) => rankOf(x) === v && out.indexOf(x) < 0)
            if (c) out.push(c)
          }
          return out.length === need ? out : null
        }
        if (!target) {
          // 自由出牌：出最小的单张
          const v = vs[0]
          return take(v, 1)
        }
        if (target.type === 1) {
          for (const v of vs) if (v > target.value && counts[v] >= 1) return take(v, 1)
        } else if (target.type === 2) {
          for (const v of vs) if (v > target.value && counts[v] >= 2) return take(v, 2)
        } else if (target.type === 3) {
          for (const v of vs) if (v > target.value && counts[v] >= 3) return take(v, 3)
        } else if (target.type === 4) {
          for (const v of vs) {
            if (v > target.value && counts[v] >= 3) {
              const k = kickers(1, v, 1)
              if (k) return take(v, 3).concat(k)
            }
          }
        } else if (target.type === 5) {
          for (const v of vs) {
            if (v > target.value && counts[v] >= 3) {
              // 找一对
              for (const p of vs) {
                if (p !== v && counts[p] >= 2) return take(v, 3).concat(take(p, 2))
              }
            }
          }
        } else if (target.type === 6 || target.type === 7 || target.type === 8) {
          const need = target.type === 6 ? 1 : (target.type === 7 ? 2 : 3)
          const len = target.len
          for (let start = 0; start + len <= vs.length; start++) {
            let ok = true
            for (let i = 0; i < len; i++) {
              const v = vs[start + i]
              if (v > 15 || counts[v] < need) { ok = false; break }
              if (i > 0 && v !== vs[start + i - 1] + 1) { ok = false; break }
            }
            if (!ok) continue
            if (vs[start + len - 1] <= target.value) continue
            const out = []
            for (let i = 0; i < len; i++) out.push(...take(vs[start + i], need))
            return out
          }
        } else if (target.type === 10) {
          for (const v of vs) if (v > target.value && counts[v] === 4) return take(v, 4)
          if (counts[16] && counts[17]) {
            return hand.filter((c) => rankOf(c) === 16 || rankOf(c) === 17)
          }
        }
        // 炸弹/王炸兜底
        for (const v of vs) if (counts[v] === 4) return take(v, 4)
        if (counts[16] && counts[17]) return hand.filter((c) => rankOf(c) === 16 || rankOf(c) === 17)
        return null
      }

      function aiTurn() {
        if (over || turn === 0) return
        const p = turn
        const need = (lastCombo && lastPlayer !== p) ? lastCombo : null
        const beat = findBeat(hands[p], need)
        if (beat) {
          const combo = parseCombo(beat)
          if (combo && (combo.type === 10 || combo.type === 11)) multiplier *= 2
          removeCards(p, beat)
          lastCombo = combo
          lastPlayer = p
          status.textContent = `${p + 1} 号出牌：${comboName(combo)}`
          if (!hands[p].length) {
            over = true
            const farmerWin = landlord !== p
            status.textContent = farmerWin ? '农民获胜！🏆' : '地主获胜！'
            render()
            return
          }
        } else {
          status.textContent = `${p + 1} 号不要`
          if (lastPlayer === (p + 1) % 3 || lastPlayer === (p + 2) % 3) {
            // 两家都不要，重新自由出牌
            lastCombo = null
            lastPlayer = -1
          }
        }
        turn = (p + 1) % 3
        if (turn === 0) {
          status.textContent += ' · 轮到你'
          render()
          return
        }
        render()
        setTimeout(aiTurn, 640)
      }

      C.rules(root, '规则：三人对局，叫地主者拿 3 张底牌并先出牌；牌型含单张、对子、三带、顺子、连对、飞机、四带二、炸弹与王炸；炸弹与王炸倍数翻倍。')
      render()
    }
  })

  // ================= 麻将 =================
  const MJ_SUIT = ['万', '筒', '条']
  function mjLabel(t) { return `${t % 10 + 1}${MJ_SUIT[Math.floor(t / 10)]}` }
  function mjCounts(hand) {
    const c = new Array(27).fill(0)
    hand.forEach((t) => { if (t >= 0 && t < 27) c[t]++ })
    return c
  }
  function mjDecompose(hand, hasPair) {
    if (!hand.length) return hasPair
    if (hand.length >= 3 && hand[0] === hand[1] && hand[1] === hand[2]) {
      if (mjDecompose(hand.slice(3), hasPair)) return true
    }
    if (!hasPair && hand.length >= 2 && hand[0] === hand[1]) {
      if (mjDecompose(hand.slice(2), true)) return true
    }
    if (hand[0] % 10 <= 6) {
      const a = hand[0] + 1
      const b = hand[0] + 2
      const rest = hand.slice(1)
      const ia = rest.indexOf(a)
      if (ia >= 0) {
        const r2 = rest.slice()
        r2.splice(ia, 1)
        const ib = r2.indexOf(b)
        if (ib >= 0) {
          const r3 = r2.slice()
          r3.splice(ib, 1)
          if (mjDecompose(r3, hasPair)) return true
        }
      }
    }
    return false
  }
  function mjCanWin(hand) {
    const s = hand.slice().sort((a, b) => a - b)
    if (s.length === 14) {
      const c = mjCounts(s)
      let pairs = 0
      let ok = true
      for (let i = 0; i < 27; i++) {
        if (!c[i]) continue
        if (c[i] === 2) pairs++
        else { ok = false; break }
      }
      if (ok && pairs === 7) return true
    }
    return mjDecompose(s, false)
  }

  C.register('mahjong', {
    title: '麻将', note: '摸打 · 吃碰杠胡 · AI 三家', players: '4 人', accent: '#2F855A',
    mount(root) {
      let hand = []
      let melds = []
      let pool = []
      let wal = []
      let ai = [[], [], []]
      let turn = 0
      let drawn = -1
      let claim = -1
      let flags = { pon: false, kan: false, chi: false, hu: false }
      let winner = -1

      const status = C.status(root, '麻将开局 · 点「摸牌」开始')
      const body = el('div')
      root.appendChild(body)

      function deal() {
        const w = []
        for (let s = 0; s < 3; s++) for (let v = 0; v < 9; v++) for (let c = 0; c < 4; c++) w.push(s * 10 + v)
        const s = C.shuffle(w)
        hand = s.slice(0, 13).sort((a, b) => a - b)
        ai = [s.slice(13, 26).sort((a, b) => a - b), s.slice(26, 39).sort((a, b) => a - b), s.slice(39, 52).sort((a, b) => a - b)]
        wal = s.slice(52)
        melds = []
        pool = []
        turn = 0
        drawn = -1
        claim = -1
        flags = { pon: false, kan: false, chi: false, hu: false }
        winner = -1
        status.textContent = '麻将开局 · 点「摸牌」开始你的回合'
      }
      deal()

      function render() {
        C.clear(body)
        body.appendChild(C.infoRow([
          { k: '牌墙', v: wal.length },
          { k: '下家', v: ai[0].length },
          { k: '对家', v: ai[1].length },
          { k: '上家', v: ai[2].length }
        ]))
        if (melds.length) {
          const m = el('div', { style: 'margin:8px 0' })
          melds.forEach((t) => m.appendChild(el('span', { class: 'mahjong-tile small', text: mjLabel(t) })))
          body.appendChild(m)
        }
        const poolBox = el('div', { style: 'min-height:70px;margin:8px 0' })
        poolBox.appendChild(el('div', { class: 'rules', text: '牌河' }))
        pool.forEach((t, i) => poolBox.appendChild(el('span', { class: 'mahjong-tile small', text: mjLabel(t) })))
        body.appendChild(poolBox)

        const handBox = el('div', { style: 'margin:8px 0' })
        hand.forEach((t, i) => {
          const tile = el('span', { class: 'mahjong-tile' + (t === drawn ? ' drawn' : ''), text: mjLabel(t) })
          tile.onclick = () => discard(i)
          handBox.appendChild(tile)
        })
        body.appendChild(handBox)

        body.appendChild(C.buttonRow([
          { text: '摸牌', primary: true, disabled: turn !== 0 || winner >= 0 || claim >= 0 || drawn >= 0, onClick: draw },
          { text: '碰', good: flags.pon, disabled: !flags.pon, onClick: pon },
          { text: '杠', good: flags.kan, disabled: !flags.kan, onClick: kan },
          { text: '吃', good: flags.chi, disabled: !flags.chi, onClick: chi }
        ]))
        body.appendChild(C.buttonRow([
          { text: '胡', warn: true, disabled: !flags.hu, onClick: hu },
          { text: '过', disabled: claim < 0, onClick: pass },
          { text: '重开', onClick: () => { deal(); render() } }
        ]))
      }

      function draw() {
        if (turn !== 0 || winner >= 0 || claim >= 0) return
        if (!wal.length) { status.textContent = '牌墙摸完，流局'; render(); return }
        const t = wal[0]
        wal = wal.slice(1)
        hand = hand.concat([t]).sort((a, b) => a - b)
        drawn = t
        flags.hu = mjCanWin(hand)
        const c = mjCounts(hand)
        flags.kan = c.indexOf(4) >= 0
        status.textContent = flags.hu ? `摸到 ${mjLabel(t)} · 可以自摸胡！` : `摸到 ${mjLabel(t)}，点一张牌打出`
        render()
      }

      function discard(i) {
        if (turn !== 0 || winner >= 0) return
        const t = hand[i]
        hand.splice(i, 1)
        pool.push(t)
        drawn = -1
        flags = { pon: false, kan: false, chi: false, hu: false }
        status.textContent = `你打出 ${mjLabel(t)}`
        render()
        setTimeout(() => aiLoop(1), 600)
      }

      function aiChoose(h) {
        let best = h[0]
        let bestScore = Infinity
        h.forEach((t) => {
          let score = 0
          let same = 0
          let near = 0
          h.forEach((x) => {
            if (x === t) same++
            const d = Math.abs(x - t)
            if ((d === 1 || d === 2) && Math.floor(x / 10) === Math.floor(t / 10)) near++
          })
          score -= same * 6
          score -= near * 3
          if (score < bestScore) { bestScore = score; best = t }
        })
        return best
      }

      function chiOptions(t) {
        const out = []
        if (t % 10 >= 2 && hand.indexOf(t - 2) >= 0 && hand.indexOf(t - 1) >= 0) out.push([t - 2, t - 1, t])
        if (t % 10 >= 1 && t % 10 <= 7 && hand.indexOf(t - 1) >= 0 && hand.indexOf(t + 1) >= 0) out.push([t - 1, t, t + 1])
        if (t % 10 <= 6 && hand.indexOf(t + 1) >= 0 && hand.indexOf(t + 2) >= 0) out.push([t, t + 1, t + 2])
        return out
      }

      function aiLoop(seat) {
        if (winner >= 0) return
        if (seat > 3) { turn = 0; status.textContent = '轮到你摸牌'; render(); return }
        const idx = seat - 1
        if (!wal.length) { status.textContent = '牌墙摸完，流局'; render(); return }
        const t = wal[0]
        wal = wal.slice(1)
        const h = ai[idx].concat([t]).sort((a, b) => a - b)
        if (mjCanWin(h)) {
          winner = seat
          status.textContent = `${seat} 号自摸胡牌，本局结束`
          render()
          return
        }
        const d = aiChoose(h)
        const rest = h.slice()
        rest.splice(rest.indexOf(d), 1)
        ai[idx] = rest
        pool.push(d)
        const mine = mjCounts(hand)
        claim = d
        flags.pon = mine[d] >= 2
        flags.kan = mine[d] >= 3
        flags.hu = mjCanWin(hand.concat([d]).sort((a, b) => a - b))
        flags.chi = seat === 3 && chiOptions(d).length > 0
        if (flags.pon || flags.kan || flags.hu || flags.chi) {
          turn = 0
          status.textContent = `${seat} 号打出 ${mjLabel(d)} · 你可以碰/杠/吃/胡，或点「过」`
          render()
          return
        }
        render()
        setTimeout(() => aiLoop(seat + 1), 580)
      }

      function clearClaim() {
        claim = -1
        flags = { pon: false, kan: false, chi: false, hu: false }
      }

      function pon() {
        const t = claim
        if (t < 0) return
        hand.splice(hand.indexOf(t), 1)
        hand.splice(hand.indexOf(t), 1)
        hand = hand.sort((a, b) => a - b)
        melds = melds.concat([t, t, t])
        const at = pool.lastIndexOf(t)
        if (at >= 0) pool.splice(at, 1)
        clearClaim()
        status.textContent = `碰 ${mjLabel(t)}，请打出一张牌`
        render()
      }

      function kan() {
        const t = claim
        let target = t
        if (t < 0 || mjCounts(hand)[t] < 3) {
          const c = mjCounts(hand)
          target = c.indexOf(4)
          if (target < 0) return
        }
        for (let k = 0; k < 3; k++) {
          const at = hand.indexOf(target)
          if (at >= 0) hand.splice(at, 1)
        }
        if (t >= 0) {
          const at = pool.lastIndexOf(t)
          if (at >= 0) pool.splice(at, 1)
        }
        melds = melds.concat([target, target, target, target])
        if (wal.length) {
          const d = wal[0]
          wal = wal.slice(1)
          hand.push(d)
          drawn = d
        }
        hand = hand.sort((a, b) => a - b)
        clearClaim()
        status.textContent = `杠 ${mjLabel(target)}，请打出一张牌`
        render()
      }

      function chi() {
        const t = claim
        if (t < 0) return
        const opts = chiOptions(t)
        if (!opts.length) return
        const meld = opts[0]
        hand.splice(hand.indexOf(meld[0]), 1)
        hand.splice(hand.indexOf(meld[1]), 1)
        hand = hand.sort((a, b) => a - b)
        melds = melds.concat(meld)
        const at = pool.lastIndexOf(t)
        if (at >= 0) pool.splice(at, 1)
        clearClaim()
        status.textContent = `吃 ${meld.map(mjLabel).join(' ')}，请打出一张牌`
        render()
      }

      function hu() {
        const t = claim
        const h = t >= 0 ? hand.concat([t]) : hand
        if (!mjCanWin(h.slice().sort((a, b) => a - b))) { status.textContent = '这副牌还不能胡'; render(); return }
        winner = 0
        const c = mjCounts(h)
        let triples = 0
        let pairs = 0
        for (let i = 0; i < 27; i++) { if (c[i] >= 3) triples++; if (c[i] === 2) pairs++ }
        const first = Math.floor(h[0] / 10)
        const oneSuit = h.every((x) => Math.floor(x / 10) === first)
        const fan = pairs === 7 ? '七对' : oneSuit ? '清一色' : triples === 4 ? '碰碰胡' : '平胡'
        status.textContent = `胡牌！🏆 ${fan}`
        render()
      }

      function pass() {
        clearClaim()
        render()
        setTimeout(() => aiLoop(1), 520)
      }

      C.rules(root, '规则：万筒条 108 张，四人麻将。摸牌后打出一张；别家打出的牌可以碰、杠、胡，上家打出的还可以吃；凑成 4 副面子 + 1 对将即可胡牌，另有七对。')
      render()
    }
  })

  // ================= 扑克：炸金花 =================
  function pkRank(t) { const r = t % 13; return r === 0 ? 14 : r }
  function pkLabel(t) {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
    const suits = ['♠', '♥', '♣', '♦']
    return ranks[t % 13] + suits[Math.floor(t / 13)]
  }
  function pkType(h) {
    const vs = h.map(pkRank).sort((a, b) => a - b)
    const flush = Math.floor(h[0] / 13) === Math.floor(h[1] / 13) && Math.floor(h[1] / 13) === Math.floor(h[2] / 13)
    const straight = (vs[1] === vs[0] + 1 && vs[2] === vs[1] + 1) || (vs[0] === 2 && vs[1] === 3 && vs[2] === 14)
    const triple = vs[0] === vs[1] && vs[1] === vs[2]
    const pair = !triple && (vs[0] === vs[1] || vs[1] === vs[2])
    if (triple) return 5
    if (flush && straight) return 4
    if (flush) return 3
    if (straight) return 2
    if (pair) return 1
    return 0
  }
  const PK_TYPE_NAME = ['散牌', '对子', '顺子', '金花', '顺金', '豹子']
  function pkScore(h) {
    const type = pkType(h)
    const vs = h.map(pkRank).sort((a, b) => a - b)
    let power = 0
    if (type === 5) power = vs[2] * 10000
    else if (type === 1) {
      const pv = vs[0] === vs[1] ? vs[0] : vs[1]
      power = pv * 10000 + (vs[0] + vs[1] + vs[2] - pv * 2)
    } else if (type === 2 || type === 4) {
      const top = (vs[0] === 2 && vs[1] === 3 && vs[2] === 14) ? 3 : vs[2]
      power = top * 10000
    } else power = vs[2] * 10000 + vs[1] * 100 + vs[0]
    return type * 1000000 + power
  }

  C.register('poker', {
    title: '扑克牌', note: '炸金花 · 下注与开牌', players: '2-6 人', accent: '#8A3E45',
    mount(root) {
      let hand = []
      let ai = [[], [], []]
      let pot = 0
      let chip = 1000
      let bet = 20
      let round = 1
      let alive = [true, true, true, true]
      let winner = -1
      let reveal = false

      const status = C.status(root, '炸金花：3 张比牌型，比大小')
      const body = el('div')
      root.appendChild(body)

      function deal() {
        const d = C.shuffle(Array.from({ length: 52 }, (_, i) => i))
        hand = d.slice(0, 3)
        ai = [d.slice(3, 6), d.slice(6, 9), d.slice(9, 12)]
        pot = 80
        chip = 980
        bet = 20
        round = 1
        alive = [true, true, true, true]
        winner = -1
        reveal = false
        status.textContent = '底注已下，选择跟注 / 加注 / 开牌 / 弃牌'
      }
      deal()

      function render() {
        C.clear(body)
        body.appendChild(C.infoRow([
          { k: '底池', v: '¥' + pot },
          { k: '我的筹码', v: '¥' + chip },
          { k: '当前注', v: '¥' + bet },
          { k: '我的牌型', v: PK_TYPE_NAME[pkType(hand)] }
        ]))
        const mine = el('div', { style: 'margin:10px 0' })
        hand.forEach((c) => {
          const face = el('div', { class: 'card-face ' + (Math.floor(c / 13) === 1 || Math.floor(c / 13) === 3 ? 'red' : ''), text: pkLabel(c) })
          mine.appendChild(face)
        })
        body.appendChild(mine)

        const oppRow = el('div', { style: 'display:flex;gap:8px;margin:10px 0' })
        ai.forEach((h, i) => {
          const box = el('div', { style: 'flex:1;padding:8px;border:1px solid #E3DDD2;border-radius:8px;background:#F7F3EA;text-align:center' })
          box.appendChild(el('div', { style: 'font-size:12px;color:#6B7280', text: `对手 ${i + 1}` }))
          if (reveal && alive[i + 1]) {
            box.appendChild(el('div', { style: 'font-size:13px', text: h.map(pkLabel).join(' ') }))
            box.appendChild(el('div', { style: 'font-size:11px;color:#A4453A', text: PK_TYPE_NAME[pkType(h)] }))
          } else {
            box.appendChild(el('div', { text: alive[i + 1] ? '🂠 🂠 🂠' : '已弃牌' }))
          }
          oppRow.appendChild(box)
        })
        body.appendChild(oppRow)

        body.appendChild(C.buttonRow([
          { text: `跟注 ¥${bet}`, primary: true, disabled: winner >= 0, onClick: call },
          { text: '加注 +40', good: true, disabled: winner >= 0, onClick: raise },
          { text: '开牌', warn: true, disabled: winner >= 0, onClick: showdown },
          { text: '弃牌', disabled: winner >= 0, onClick: fold }
        ]))
        body.appendChild(C.buttonRow([{ text: '重开一局', onClick: () => { deal(); render() } }]))
      }

      function afterPlayer() {
        // AI 决策
        for (let i = 1; i < 4; i++) {
          if (!alive[i]) continue
          const type = pkType(ai[i - 1])
          if (type === 0 && Math.random() < 0.55) alive[i] = false
          else if (type <= 1 && bet > 60 && Math.random() < 0.35) alive[i] = false
        }
        round++
        if (round > 3) showdown()
        else status.textContent = `第 ${round} 轮 · 底池 ¥${pot}`
      }

      function call() {
        if (chip < bet) { status.textContent = '筹码不足'; return }
        chip -= bet
        pot += bet
        afterPlayer()
        render()
      }
      function raise() {
        if (chip < bet + 40) { status.textContent = '筹码不足'; return }
        chip -= bet + 40
        pot += bet + 40
        bet += 40
        afterPlayer()
        render()
      }
      function fold() {
        alive[0] = false
        winner = 1
        reveal = true
        status.textContent = '你弃牌了'
        render()
      }
      function showdown() {
        reveal = true
        let best = -1
        let bestScore = -1
        for (let i = 0; i < 4; i++) {
          if (!alive[i]) continue
          const h = i === 0 ? hand : ai[i - 1]
          const s = pkScore(h)
          if (s > bestScore) { bestScore = s; best = i }
        }
        winner = best
        if (best === 0) {
          chip += pot
          status.textContent = `你赢下底池 ¥${pot}！🏆 ${PK_TYPE_NAME[pkType(hand)]}`
        } else if (best > 0) {
          status.textContent = `对手 ${best} 以${PK_TYPE_NAME[pkType(ai[best - 1])]}赢下底池 ¥${pot}`
        } else status.textContent = '所有人都弃牌了'
        render()
      }

      C.rules(root, '牌型：豹子 > 顺金 > 金花 > 顺子 > 对子 > 散牌；A 最大，A23 也算顺子。可跟注、加注、开牌（双倍注）或弃牌。')
      render()
    }
  })
})(window.ZZCore)
