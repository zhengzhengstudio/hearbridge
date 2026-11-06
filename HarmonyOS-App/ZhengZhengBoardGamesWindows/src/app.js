// 大厅路由 + WinUI NavigationView 侧栏
(function (C) {
  const el = C.el
  const grid = document.getElementById('game-grid')
  const lobby = document.getElementById('lobby')
  const stage = document.getElementById('stage')
  const root = document.getElementById('game-root')
  const titleEl = document.getElementById('stage-title')
  const noteEl = document.getElementById('stage-note')
  const crumbTitle = document.getElementById('crumb-title')
  const crumbNote = document.getElementById('crumb-note')
  const navList = document.getElementById('nav-list')
  const btnBack = document.getElementById('btn-back')
  const btnHome = document.getElementById('btn-home')

  const ORDER = ['gobang', 'reversi', 'tictactoe', 'go', 'chinese-chess', 'world-chess', 'jump',
    'junqi', 'minesweeper', 'ludo', 'rummy', 'monopoly', 'landlord', 'mahjong', 'poker', 'werewolf', 'spy']

  const ICONS = {
    gobang: '⚫', reversi: '🌗', tictactoe: '✕', go: '⚪',
    'chinese-chess': '♟️', 'world-chess': '♞', jump: '🔺', junqi: '🎖️',
    minesweeper: '💣', ludo: '🎲', rummy: '🔢', monopoly: '🏨',
    landlord: '🃏', mahjong: '🀇', poker: '♠️', werewolf: '🐺', spy: '🕵️'
  }

  const navItems = new Map()
  let homeItem = null

  function buildLobby() {
    C.clear(grid)
    ORDER.forEach((id) => {
      const def = C.games[id]
      if (!def) return
      grid.appendChild(el('div', { class: 'game-card', onclick: () => open(id) }, [
        el('span', { class: 'badge', style: `background:${def.accent}`, text: def.players }),
        el('h3', { text: def.title }),
        el('p', { text: def.note })
      ]))
    })
  }

  function buildNav() {
    C.clear(navList)
    navItems.clear()

    navList.appendChild(el('div', { class: 'nav-section', text: '开始' }))
    homeItem = el('div', { class: 'nav-item', onclick: backToLobby }, [
      el('span', { class: 'ico', text: '🏠' }),
      el('span', { class: 'txt', text: '大厅' })
    ])
    navList.appendChild(homeItem)

    navList.appendChild(el('div', { class: 'nav-section', text: '棋牌' }))
    ORDER.forEach((id) => {
      const def = C.games[id]
      if (!def) return
      const item = el('div', { class: 'nav-item', onclick: () => open(id) }, [
        el('span', { class: 'ico', text: ICONS[id] || '🎮' }),
        el('span', { class: 'txt', text: def.title })
      ])
      navItems.set(id, item)
      navList.appendChild(item)
    })
  }

  function setActive(id) {
    navItems.forEach((node, key) => node.classList.toggle('active', key === id))
    if (homeItem) homeItem.classList.toggle('active', !id)
  }

  function open(id) {
    const def = C.games[id]
    if (!def) return
    lobby.classList.add('hidden')
    stage.classList.remove('hidden')
    btnBack.classList.remove('hidden')
    btnHome.classList.add('hidden')
    titleEl.textContent = def.title
    noteEl.textContent = def.note + ' · ' + def.players
    crumbTitle.textContent = def.title
    crumbNote.textContent = def.note
    C.clear(root)
    def.mount(root)
    window.__currentGame = id
    setActive(id)
  }

  function backToLobby() {
    lobby.classList.remove('hidden')
    stage.classList.add('hidden')
    btnBack.classList.add('hidden')
    btnHome.classList.remove('hidden')
    crumbTitle.textContent = '大厅'
    crumbNote.textContent = '全部游戏均为单机版，内置 AI 对手，无需联网'
    C.clear(root)
    window.__currentGame = null
    setActive(null)
    if (location.hash) history.replaceState(null, '', location.pathname)
  }

  window.__backToLobby = backToLobby

  btnBack.onclick = backToLobby
  btnHome.onclick = backToLobby
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.__currentGame) backToLobby()
  })

  // 版本号统一由 src/core.js 提供，桌面端来自 package.json，改一处即可全局生效
  const versionTag = document.getElementById('version-tag')
  if (versionTag) {
    versionTag.textContent = 'v' + C.version
    versionTag.title = `铮铮桌游合集 v${C.version} · ${C.runtime}`
  }
  const brandSub = document.getElementById('brand-sub')
  if (brandSub) brandSub.textContent = `17 种棋牌 · 单机畅玩 · ${C.runtime}`

  buildNav()
  buildLobby()
  setActive(null)

  // 支持 index.html#ludo 直达某游戏
  const hash = decodeURIComponent(location.hash.replace('#', ''))
  if (hash && C.games[hash]) open(hash)
})(window.ZZCore)
