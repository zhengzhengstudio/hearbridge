  // 通用工具：DOM 构建、洗牌、存档
(function (global) {
  const Core = {}

  // 版本号：Electron 下由 preload 从 package.json 注入；浏览器/单文件版回退到内置值
  Core.version = (global.ZZDesktop && global.ZZDesktop.version) ||
    global.ZZ_VERSION ||
    document.documentElement.getAttribute('data-version') ||
    '1.6.0'
  Core.runtime = global.ZZDesktop
    ? `${global.ZZDesktop.platform}/${global.ZZDesktop.arch}`
    : 'browser'

  Core.el = function (tag, attrs, children) {
    const node = document.createElement(tag)
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') node.className = attrs[k]
        else if (k === 'text') node.textContent = attrs[k]
        else if (k === 'html') node.innerHTML = attrs[k]
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k])
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k])
        }
      })
    }
    const list = Array.isArray(children) ? children : (children ? [children] : [])
    list.forEach((c) => {
      if (c === null || c === undefined) return
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return node
  }

  Core.shuffle = function (arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    return a
  }

  Core.dice = function () { return Math.floor(Math.random() * 6) + 1 }

  Core.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild) }

  // 每个游戏模块的结构：{ title, note, players, mount(root, ctx) }
  Core.games = {}
  Core.register = function (id, def) { Core.games[id] = def }

  // 简单的对局存档（localStorage）
  Core.save = function (key, value) {
    try { localStorage.setItem('zzbg:' + key, JSON.stringify(value)) } catch (e) { /* 忽略 */ }
  }
  Core.load = function (key, fallback) {
    try {
      const raw = localStorage.getItem('zzbg:' + key)
      return raw ? JSON.parse(raw) : fallback
    } catch (e) { return fallback }
  }

  // ---- 对局模式：AI 陪练（'ai'）↔ 线下多人（'local'）----
  // 以前每个游戏都把「只有 1 号是玩家」写死在守卫里（turn !== 1就return），
  // 导致 AI 陪练无法关闭。改成全局开关后，各模块用Core.isPlayer(side) 判断。
  Core.mode = Core.load('mode', 'ai')
  Core.isAi = function () { return Core.mode === 'ai' }
  Core.isLocal = function () { return Core.mode === 'local' }
  Core.setMode = function (mode) {
    Core.mode = mode === 'local' ? 'local' : 'ai'
    Core.save('mode', Core.mode)
    Core.emit('mode', Core.mode)
    return Core.mode
  }
  Core.toggleMode = function () { return Core.setMode(Core.isAi() ? 'local' : 'ai') }

  // side: 0 起算的座位号。AI 模式下只有 0 号是玩家，其余交给 AI；
  // 线下多人模式下所有座位都由本机玩家操作，AI 不再自动落子。
  Core.isPlayer = function (side) {
    if (Core.isAi()) return side === 0
    return true
  }

  // 轻量事件总线：模式切换后正在对局的游戏需要据此重绘按钮、接管回合。
  Core._listeners = {}
  Core.on = function (evt, fn) {
    if (!Core._listeners[evt]) Core._listeners[evt] = []
    Core._listeners[evt].push(fn)
  }
  Core.emit = function (evt, payload) {
    (Core._listeners[evt] || []).forEach((fn) => {
      try { fn(payload) } catch (e) { /* 单个订阅者出错不影响其他 */ }
    })
  }

  // 生成一个「AI 陪练 ↔ 线下多人」开关按钮，返回 { node, refresh }。
  // 用法：const modes = Core.modeToggle(); modes.refresh()
  Core.modeToggle = function () {
    const label = Core.el('span', { class: 'mode-toggle-label' })
    const btn = Core.el('button', {
      class: 'grow mode-toggle',
      onclick: () => { Core.toggleMode(); refresh() }
    }, [label])
    function refresh() {
      const local = Core.isLocal()
      label.textContent = local ? '当前：线下多人（AI 已关闭）' : '当前：AI 陪练'
      btn.classList.toggle('local', local)
      Core.emit('modeRender')
    }
    refresh()
    return { node: btn, refresh: refresh }
  }

  // 通用状态条
  Core.status = function (root, text) {
    let bar = root.querySelector('.status')
    if (!bar) {
      bar = Core.el('div', { class: 'status' })
      root.insertBefore(bar, root.firstChild)
    }
    bar.textContent = text
    return bar
  }

  Core.infoRow = function (items) {
    return Core.el('div', { class: 'info-grid' }, items.map((it) =>
      Core.el('div', { class: 'info-box' }, [
        Core.el('div', { class: 'k', text: it.k }),
        Core.el('div', { class: 'v', text: String(it.v) })
      ])))
  }

  Core.buttonRow = function (buttons) {
    return Core.el('div', { class: 'row' }, buttons.map((b) =>
      Core.el('button', {
        class: 'grow' + (b.primary ? ' primary' : '') + (b.good ? ' good' : '') + (b.warn ? ' warn' : ''),
        text: b.text,
        disabled: b.disabled ? 'disabled' : null,
        onclick: b.onClick
      })))
  }

  Core.rules = function (root, text) {
    root.appendChild(Core.el('div', { class: 'rules', text }))
  }

  // 简易 minimax（用于五子棋/井字棋等小规模搜索）
  Core.minimaxScore = function (line, me, opp) {
    let score = 0
    let mine = 0
    let theirs = 0
    line.forEach((v) => {
      if (v === me) mine++
      else if (v === opp) theirs++
    })
    if (mine > 0 && theirs > 0) return 0
    if (mine === 1) score = 1
    else if (mine === 2) score = 12
    else if (mine === 3) score = 90
    else if (mine === 4) score = 900
    if (theirs === 1) score = -2
    else if (theirs === 2) score = -20
    else if (theirs === 3) score = -140
    else if (theirs === 4) score = -1200
    return score
  }

  global.ZZCore = Core
})(window)
