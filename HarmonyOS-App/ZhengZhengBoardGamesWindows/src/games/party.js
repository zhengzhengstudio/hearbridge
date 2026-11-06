// 聚会类：狼人杀（流程引擎）与谁是卧底
(function (C) {
  const el = C.el

  // ================= 狼人杀 =================
  const WOLF_ROLES = [
    { id: 'wolf', name: '狼人', camp: '狼', desc: '每晚共同击倒一名玩家' },
    { id: 'seer', name: '预言家', camp: '神', desc: '每晚查验一名玩家的身份' },
    { id: 'witch', name: '女巫', camp: '神', desc: '拥有一瓶解药与一瓶毒药' },
    { id: 'hunter', name: '猎人', camp: '神', desc: '出局时可开枪带走一人' },
    { id: 'guard', name: '守卫', camp: '神', desc: '每晚守护一名玩家' },
    { id: 'vil1', name: '村民', camp: '民', desc: '白天通过讨论找出狼人' },
    { id: 'vil2', name: '村民', camp: '民', desc: '白天通过讨论找出狼人' },
    { id: 'vil3', name: '村民', camp: '民', desc: '白天通过讨论找出狼人' },
    { id: 'vil4', name: '村民', camp: '民', desc: '白天通过讨论找出狼人' }
  ]

  C.register('werewolf', {
    title: '狼人杀', note: '身份 · 发言 · 投票', players: '6-12 人', accent: '#34495E',
    mount(root) {
      let seats = []
      let phase = 'night'
      let day = 1
      let selected = -1
      let log = []
      let over = false

      const status = C.status(root, '夜晚：狼人请选择要击倒的玩家')

      function setup(n) {
        const roles = C.shuffle(WOLF_ROLES).slice(0, n)
        // 保证至少 2 狼 2 神
        seats = roles.map((r, i) => ({ seat: i + 1, role: r, alive: true, revealed: false }))
        phase = 'night'
        day = 1
        selected = -1
        log = ['游戏开始：天黑请闭眼']
        over = false
      }
      setup(9)

      function aliveList() { return seats.filter((s) => s.alive) }
      function wolves() { return seats.filter((s) => s.alive && s.role.camp === '狼') }
      function gods() { return seats.filter((s) => s.alive && s.role.camp === '神') }

      function checkEnd() {
        const w = wolves().length
        const g = aliveList().filter((s) => s.role.camp !== '狼').length
        if (w === 0) { over = true; log.push('所有狼人出局，好人阵营获胜！🏆') }
        else if (w >= g) { over = true; log.push('狼人数量达到好人数量，狼人阵营获胜') }
      }

      function render() {
        C.clear(root.querySelector('.party-body'))
        const body = root.querySelector('.party-body')
        body.appendChild(C.infoRow([
          { k: '阶段', v: phase === 'night' ? `第 ${day} 夜` : `第 ${day} 天` },
          { k: '存活', v: aliveList().length },
          { k: '狼人', v: wolves().length },
          { k: '神职', v: gods().length }
        ]))

        const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0' })
        seats.forEach((s) => {
          const card = el('div', {
            style: `width:118px;padding:10px;border-radius:8px;cursor:pointer;border:2px solid ${
              selected === s.seat - 1 ? '#A4453A' : '#E3DDD2'
            };background:${s.alive ? '#F7F3EA' : '#E6E1D7'};opacity:${s.alive ? 1 : .55}`,
            onclick: () => { if (s.alive && !over) { selected = s.seat - 1; render() } }
          }, [
            el('div', { style: 'font-weight:700;font-size:14px', text: `${s.seat} 号` }),
            el('div', { style: 'font-size:12px;color:#6B7280;margin-top:2px', text: s.alive ? (s.revealed ? s.role.name : '身份未公开') : '已出局' }),
            s.revealed || !s.alive ? el('div', { style: 'font-size:11px;margin-top:4px', text: s.role.desc }) : null
          ])
          wrap.appendChild(card)
        })
        body.appendChild(wrap)

        if (!over) {
          if (phase === 'night') {
            body.appendChild(C.buttonRow([
              { text: '狼人击倒', primary: true, disabled: selected < 0, onClick: () => nightKill() },
              { text: '预言家查验', disabled: selected < 0, onClick: () => seerCheck() },
              { text: '进入白天', onClick: () => { phase = 'day'; log.push('天亮了，进入讨论与投票'); render() } }
            ]))
          } else {
            body.appendChild(C.buttonRow([
              { text: '投票出局', primary: true, disabled: selected < 0, onClick: () => voteOut() },
              { text: '进入夜晚', onClick: () => { phase = 'night'; day++; log.push('天黑请闭眼'); render() } }
            ]))
          }
        }
        body.appendChild(C.buttonRow([
          { text: '亮明身份', disabled: selected < 0, onClick: () => { seats[selected].revealed = true; render() } },
          { text: '重开', onClick: () => { setup(9); status.textContent = '夜晚：狼人请选择要击倒的玩家'; render() } }
        ]))

        const logBox = el('div', { class: 'status', style: 'min-height:120px;max-height:160px;overflow:auto' })
        log.forEach((l) => logBox.appendChild(el('div', { text: '· ' + l, style: 'font-size:12px' })))
        body.appendChild(logBox)
      }

      function nightKill() {
        const s = seats[selected]
        s.alive = false
        log.push(`第 ${day} 夜：${s.seat} 号被狼人击倒（身份：${s.role.name}）`)
        selected = -1
        checkEnd()
        render()
      }
      function seerCheck() {
        const s = seats[selected]
        log.push(`预言家查验 ${s.seat} 号：${s.role.camp === '狼' ? '是狼人 🐺' : '不是狼人'}`)
        render()
      }
      function voteOut() {
        const s = seats[selected]
        s.alive = false
        log.push(`第 ${day} 天：${s.seat} 号被投票出局（身份：${s.role.name}）`)
        selected = -1
        checkEnd()
        render()
      }

      const body = el('div', { class: 'party-body' })
      root.appendChild(body)
      C.rules(root, '这是线下聚会的流程助手：由主持人操作夜晚与白天的流程，座位身份默认不公开，点「亮明身份」可公示。')
      render()
    }
  })

  // ================= 谁是卧底 =================
  const SPY_WORDS = [
    ['矿泉水', '气泡水'], ['汉堡', '三明治'], ['微信', 'QQ'], ['电影', '电视剧'],
    ['篮球', '足球'], ['咖啡', '奶茶'], ['火锅', '烧烤'], ['空调', '风扇'],
    ['苹果', '梨'], ['地铁', '公交'], ['医生', '护士'], ['钢琴', '小提琴']
  ]

  C.register('spy', {
    title: '谁是卧底', note: '词语推理与投票', players: '4-10 人', accent: '#D35400',
    mount(root) {
      let players = []
      let pair = ['', '']
      let round = 1
      let votes = {}
      let over = false

      const status = C.status(root, '设置人数后发词，每人记住自己的词，轮流描述')

      function setup(n) {
        pair = SPY_WORDS[Math.floor(Math.random() * SPY_WORDS.length)]
        const spyIndex = Math.floor(Math.random() * n)
        players = []
        for (let i = 0; i < n; i++) {
          players.push({ seat: i + 1, word: i === spyIndex ? pair[1] : pair[0], spy: i === spyIndex, alive: true, shown: false })
        }
        round = 1
        votes = {}
        over = false
        status.textContent = '词语已发放，依次描述自己的词（不要直接说出）'
      }
      setup(6)

      function render() {
        C.clear(root.querySelector('.spy-body'))
        const body = root.querySelector('.spy-body')
        body.appendChild(C.infoRow([
          { k: '人数', v: players.length },
          { k: '当前轮次', v: round },
          { k: '存活', v: players.filter((p) => p.alive).length }
        ]))

        const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0' })
        players.forEach((p, i) => {
          const card = el('div', {
            style: `width:120px;padding:10px;border-radius:8px;cursor:pointer;border:2px solid ${
              votes[p.seat] ? '#A4453A' : '#E3DDD2'
            };background:${p.alive ? '#F7F3EA' : '#E6E1D7'};opacity:${p.alive ? 1 : .55}`,
            onclick: () => {
              if (!p.alive || over) return
              if (votes[p.seat]) delete votes[p.seat]
              else votes[p.seat] = true
              render()
            }
          }, [
            el('div', { style: 'font-weight:700', text: `${p.seat} 号` }),
            el('div', { style: 'font-size:12px;color:#6B7280;margin-top:3px', text: p.alive ? (p.shown ? p.word : '点击查看词语') : '已出局' }),
            votes[p.seat] ? el('div', { style: 'font-size:11px;color:#A4453A', text: '已投给 TA' }) : null
          ])
          wrap.appendChild(card)
        })
        body.appendChild(wrap)

        body.appendChild(C.buttonRow([
          { text: '查看/隐藏词语', onClick: () => {
            const idx = Object.keys(votes).map(Number)[0]
            status.textContent = '请在卡片上点击自己对应的号码查看（主持人协助）'
            render()
          } },
          { text: '本轮投票', primary: true, disabled: Object.keys(votes).length === 0, onClick: () => doVote() },
          { text: '公布身份', onClick: () => {
            over = true
            const spy = players.find((p) => p.spy)
            status.textContent = `卧底是 ${spy.seat} 号，词语「${pair[1]}」，平民词「${pair[0]}」`
            render()
          } }
        ]))
        body.appendChild(C.buttonRow([
          { text: '4 人', onClick: () => { setup(4); render() } },
          { text: '6 人', onClick: () => { setup(6); render() } },
          { text: '8 人', onClick: () => { setup(8); render() } },
          { text: '重开', onClick: () => { setup(players.length); render() } }
        ]))
      }

      function doVote() {
        const keys = Object.keys(votes).map((k) => parseInt(k, 10))
        const target = keys[0]
        const p = players.find((x) => x.seat === target)
        p.alive = false
        round++
        votes = {}
        if (p.spy) {
          over = true
          status.textContent = `${p.seat} 号就是卧底，平民获胜！🏆`
        } else if (players.filter((x) => x.alive).length <= 2) {
          over = true
          const spy = players.find((x) => x.spy)
          status.textContent = `卧底 ${spy.seat} 号存活到最后，卧底获胜`
        } else {
          status.textContent = `${p.seat} 号出局（不是卧底），进入第 ${round} 轮`
        }
        render()
      }

      const body = el('div', { class: 'spy-body' })
      root.appendChild(body)
      C.rules(root, '玩法：除卧底外所有人拿到同一个词，卧底拿到相近词。每轮各用一句话描述，投票淘汰疑似卧底；卧底被投出则平民胜，卧底撑到剩 2 人则卧底胜。')
      render()
    }
  })
})(window.ZZCore)
