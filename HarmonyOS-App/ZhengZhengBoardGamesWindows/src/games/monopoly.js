// 大富翁：24 格中国城市 · 买地 / 租金 / 盖房 / 抵押 / 破产
(function (C) {
  const el = C.el
  const SQUARES = ['起点', '北京', '机会', '上海', '所得税', '广州', '监狱', '深圳', '命运', '杭州',
    '火车站', '南京', '免费停车', '成都', '机会', '重庆', '奢侈税', '武汉', '去监狱', '西安',
    '命运', '天津', '火车站', '青岛']
  const PRICE = [0, 1200, 0, 1400, 0, 1600, 0, 1800, 0, 2000, 0, 2200, 0, 2400, 0, 2600, 0, 2800, 0, 3000, 0, 3200, 0, 3600]
  const COLORS = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54']

  C.register('monopoly', {
    title: '大富翁', note: '地产经营 · 盖房与抵押', players: '2-4 人', accent: '#B7791F',
    mount(root) {
      let cash = [15000, 15000, 15000, 15000]
      let owner = new Array(24).fill(-1)
      let pos = [0, 0, 0, 0]
      let house = new Array(24).fill(0)
      let mortgaged = new Array(24).fill(false)
      let turn = 0
      let pending = -1
      let over = false

      const status = C.status(root, '四位玩家各有 ¥15,000，你是玩家 1')
      const body = el('div')
      root.appendChild(body)

      function rent(i) {
        const price = PRICE[i]
        if (!price) return 0
        let same = 0
        owner.forEach((o) => { if (o === owner[i] && PRICE[owner.indexOf(o) * 0 + 0] >= 0 && o >= 0) same++ })
        same = 0
        for (let k = 0; k < 24; k++) if (owner[k] === owner[i] && PRICE[k] > 0) same++
        let r = Math.round(price * 0.18 * (1 + (same - 1) * 0.4) * (1 + house[i] * 0.8))
        if (mortgaged[i]) r = Math.round(r / 2)
        return r
      }

      function render() {
        C.clear(body)
        body.appendChild(C.infoRow([0, 1, 2, 3].map((i) => ({
          k: `玩家 ${i + 1}${i === 0 ? '（你）' : ''}`,
          v: '¥' + cash[i]
        }))))

        const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:12px 0' })
        SQUARES.forEach((name, i) => {
          const cell = el('div', {
            style: `padding:6px;text-align:center;font-size:11px;border-radius:6px;border:2px solid ${
              pos.indexOf(i) >= 0 ? '#A4453A' : '#E3DDD2'
            };background:${owner[i] >= 0 ? COLORS[owner[i]] : '#F7F3EA'};color:${owner[i] >= 0 ? '#fff' : '#172033'}`,
            text: name + (PRICE[i] ? ` ¥${PRICE[i]}` : '') + (house[i] ? ` 🏠${house[i]}` : '') +
              (mortgaged[i] ? ' ⛔' : '') + (owner[i] >= 0 ? ` P${owner[i] + 1}` : '')
          })
          grid.appendChild(cell)
        })
        body.appendChild(grid)

        if (pending >= 0) {
          body.appendChild(C.buttonRow([
            { text: `买下 ${SQUARES[pending]} ¥${PRICE[pending]}`, good: true, onClick: () => buy(true) },
            { text: '放弃', onClick: () => buy(false) }
          ]))
        }

        body.appendChild(C.buttonRow([
          { text: '掷骰前进', primary: true, disabled: turn !== 0 || over || pending >= 0, onClick: roll },
          { text: '盖房', disabled: turn !== 0 || over || pending >= 0, onClick: build },
          {
            text: mortgaged[pos[0]] ? '赎回地产' : '抵押地产',
            disabled: turn !== 0 || over,
            onClick: mortgage
          },
          { text: '重开本局', onClick: () => {
            cash = [15000, 15000, 15000, 15000]
            owner = new Array(24).fill(-1)
            pos = [0, 0, 0, 0]
            house = new Array(24).fill(0)
            mortgaged = new Array(24).fill(false)
            turn = 0
            pending = -1
            over = false
            status.textContent = '新的一局'
            render()
          } }
        ]))
      }

      function roll() {
        if (over || turn !== 0 || pending >= 0) return
        const d = C.dice()
        const prev = pos[0]
        const next = (prev + d) % 24
        pos[0] = next
        if (next < prev) {
          cash[0] += 2000
          status.textContent = `掷 ${d}，经过起点领 ¥2000 · `
        } else status.textContent = `掷 ${d} · `
        landing(0, next)
      }

      function landing(p, i) {
        const price = PRICE[i]
        const name = SQUARES[i]
        const own = owner[i]
        if (!price) {
          event(p, i)
          nextTurn()
          return
        }
        if (own < 0) {
          if (cash[p] >= price) {
            pending = i
            status.textContent += `${name} 售价 ¥${price}，要买下吗？`
          } else {
            status.textContent += `${name} 要 ¥${price}，资金不足`
            nextTurn()
          }
          return
        }
        if (own === p) {
          status.textContent += `回到自己的${name}，可盖房升级`
          nextTurn()
          return
        }
        const r = rent(i)
        cash[p] -= r
        cash[own] += r
        status.textContent += `在${name}付租金 ¥${r} 给玩家 ${own + 1}`
        if (cash[p] < 0) {
          over = true
          status.textContent = `玩家 ${p + 1} 资金见底破产，本局结束`
        }
        nextTurn()
      }

      function event(p, i) {
        const name = SQUARES[i]
        if (name === '所得税') { cash[p] -= 1200; status.textContent += '缴纳所得税 ¥1200' }
        else if (name === '奢侈税') { cash[p] -= 800; status.textContent += '缴纳奢侈税 ¥800' }
        else if (name === '去监狱') { pos[p] = 6; status.textContent += '被送去监狱（探监）' }
        else if (name === '免费停车') status.textContent += '免费停车，休息一回合'
        else if (name === '机会' || name === '命运') {
          const delta = [1500, 1000, 500, -500, -800, 2000][Math.floor(Math.random() * 6)]
          cash[p] += delta
          status.textContent += `${name}：${delta >= 0 ? '获得' : '支付'} ¥${Math.abs(delta)}`
        } else status.textContent += `停在${name}`
      }

      function buy(yes) {
        const i = pending
        pending = -1
        if (yes && cash[0] >= PRICE[i]) {
          cash[0] -= PRICE[i]
          owner[i] = 0
          status.textContent = `买下${SQUARES[i]}，花了 ¥${PRICE[i]}`
        } else if (yes) {
          status.textContent = '资金不足'
        } else {
          status.textContent = `放弃购买${SQUARES[i]}`
        }
        nextTurn()
      }

      function build() {
        const i = pos[0]
        if (owner[i] !== 0) { status.textContent = '只能给自己名下的地产盖房'; render(); return }
        if (house[i] >= 3) { status.textContent = '这里已经是酒店了'; render(); return }
        const cost = Math.round(PRICE[i] * 0.5)
        if (cash[0] < cost) { status.textContent = `盖房需要 ¥${cost}，资金不足`; render(); return }
        cash[0] -= cost
        house[i]++
        status.textContent = `${SQUARES[i]}盖到 ${house[i]} 级，租金提升到 ¥${rent(i)}`
        render()
      }

      function mortgage() {
        const i = pos[0]
        if (owner[i] !== 0) { status.textContent = '只能抵押自己名下的地产'; render(); return }
        if (mortgaged[i]) {
          const pay = Math.round(PRICE[i] * 0.55)
          if (cash[0] < pay) { status.textContent = `赎回需要 ¥${pay}，资金不足`; render(); return }
          cash[0] -= pay
          mortgaged[i] = false
          status.textContent = `赎回${SQUARES[i]}，花了 ¥${pay}`
        } else {
          cash[0] += Math.round(PRICE[i] * 0.5)
          mortgaged[i] = true
          status.textContent = `抵押${SQUARES[i]}，获得 ¥${Math.round(PRICE[i] * 0.5)}（租金减半）`
        }
        render()
      }

      function nextTurn() {
        if (over) { render(); return }
        turn = (turn + 1) % 4
        if (turn === 0) { status.textContent += ' · 轮到你了'; render(); return }
        render()
        setTimeout(aiTurn, 620)
      }

      function aiTurn() {
        if (over || turn === 0) return
        const p = turn
        const d = C.dice()
        const prev = pos[p]
        const i = (prev + d) % 24
        pos[p] = i
        if (i < prev) cash[p] += 2000
        const price = PRICE[i]
        if (!price) {
          event(p, i)
        } else if (owner[i] < 0 && cash[p] >= price) {
          cash[p] -= price
          owner[i] = p
          status.textContent = `玩家 ${p + 1} 掷 ${d} 买下${SQUARES[i]}`
        } else if (owner[i] >= 0 && owner[i] !== p) {
          const r = rent(i)
          cash[p] -= r
          cash[owner[i]] += r
          status.textContent = `玩家 ${p + 1} 掷 ${d} 在${SQUARES[i]}付租金 ¥${r}`
        } else if (house[i] < 3 && cash[p] > Math.round(price * 0.9)) {
          cash[p] -= Math.round(price * 0.5)
          house[i]++
          status.textContent = `玩家 ${p + 1} 给${SQUARES[i]}加盖到 ${house[i]} 级`
        } else {
          status.textContent = `玩家 ${p + 1} 掷 ${d} 停在${SQUARES[i]}`
        }
        if (cash[p] < 0) {
          over = true
          status.textContent = `玩家 ${p + 1} 破产，本局结束`
        }
        nextTurn()
      }

      C.rules(root, '规则：经过起点领 ¥2000；买地后可盖房（最高 3 级，租金最高 3.4 倍）；缺钱可抵押（租金减半）；现金跌破 0 即破产。')
      render()
    }
  })
})(window.ZZCore)
