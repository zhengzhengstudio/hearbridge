#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为鸿蒙桌游（单机版 / 联网版）补齐：扫雷、保存载入与撤销、防误碰、四款玩法补全。

用法:
  python3 patch_boardgames_features.py <项目根目录> [...]
每个项目根目录下需有 entry/src/main/ets/pages/Index.ets
"""
import sys
import os

# ---------------- 补丁片段 ----------------

CARD_COMBO = """interface CardCombo {
  type: string
  rank: number
  size: number
}

interface GameInfo {"""

NEW_STATES = """  @State partyRound: number = 1
  @State confirmPlacement: boolean = true
  @State mineBoard: boolean[] = []
  @State mineRevealed: boolean[] = []
  @State mineFlagged: boolean[] = []
  @State mineCounts: number[] = []
  @State mineFinished: boolean = false
  @State mineFirstTap: boolean = true
  @State mineLevel: number = 0
  @State mineSeconds: number = 0
  @State mineFlagMode: boolean = false
  @State monopolyCash: number[] = []
  @State monopolyOwner: number[] = []
  @State monopolyPos: number[] = []
  @State monopolyTurn: number = 0
  @State landlordHands: string[][] = []
  @State landlordBottom: string[] = []
  @State landlordTurn: number = 0
  @State landlordMaster: number = -1
  @State landlordLastType: string = ''
  @State landlordLastRank: number = 0
  @State landlordLastSize: number = 0
  @State landlordLastOwner: number = -1
  @State landlordPassCount: number = 0
  @State landlordWinner: number = -1
  @State landlordSelected: boolean[] = []
  @State socialRoles: string[] = []
  @State socialAlive: boolean[] = []
  @State socialPhase: string = '发言'
  @State socialVotes: number[] = []
  @State socialWord: string = ''
"""

NEW_PRIVATES = """  private aiApplying: boolean = false
  private pendingTapIndex: number = -1
  private pendingTapAt: number = 0
  private mineTimer: number = -1
  private boardHistory: string[] = []
  private readonly socialWordPairs: string[][] = [['可乐', '雪碧'], ['火锅', '麻辣烫'], ['熊猫', '考拉'],
    ['西瓜', '冬瓜'], ['老师', '教授'], ['咖啡', '奶茶'], ['篮球', '足球'], ['电影院', '剧院']]
  private readonly werewolfRoles: string[] = ['狼人', '狼人', '预言家', '女巫', '平民', '平民', '平民', '平民']
  private readonly monopolyPlayerColor: string[] = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54']
  private readonly mineNumberColor: string[] = ['#2F4F7F', '#2F7A4F', '#B03A2E', '#1F3A5F', '#7D3C1F', '#1F6F6B',
    '#3B3B3B', '#6C3483']
"""

GAME_ENTRY_OLD = "    { id: 'monopoly', title: '大富翁',"
GAME_ENTRY_NEW = """    { id: 'minesweeper', title: '扫雷', note: '三档难度 · 首击必安全', players: '1 人', accent: '#5D6D7E', icon: $r('app.media.game_mine') },
    { id: 'monopoly', title: '大富翁',"""

RESET_TAIL_OLD = """    this.ludoPieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
    this.ludoTurn = 0
    this.diceValue = 0
    this.selectedCell = -1
    this.partyRound = 1
"""
RESET_TAIL_NEW = """    this.ludoPieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
    this.ludoTurn = 0
    this.diceValue = 0
    this.selectedCell = -1
    this.partyRound = 1
    this.boardHistory = []
    this.startMinesweeper(this.mineLevel)
    this.startMonopoly()
    this.startLandlord()
    this.startSocialGame()
"""

ABOUT_OLD = """  aboutToAppear(): void {
    this.resetBoard()
  }
"""
ABOUT_NEW = """  aboutToAppear(): void {
    this.restoreSettings()
    this.resetBoard()
  }

  // 本地设置：PersistentStorage（EntryAbility 里初始化）→ AppStorage，冷启动自动恢复
  private restoreSettings(): void {
    const theme = AppStorage.get<string>('settingTheme')
    if (theme !== undefined && theme.length > 0) this.themeMode = theme
    const name = AppStorage.get<string>('settingPlayerName')
    if (name !== undefined && name.length > 0) this.playerName = name
    const level = AppStorage.get<string>('settingAiDifficulty')
    if (level !== undefined && level.length > 0) this.aiDifficulty = level
    const confirm = AppStorage.get<boolean>('settingConfirmPlacement')
    this.confirmPlacement = confirm === undefined ? true : confirm
    const ai = AppStorage.get<boolean>('settingLocalAi')
    this.localAiEnabled = ai === undefined ? true : ai
  }

  private persistSettings(): void {
    AppStorage.set('settingTheme', this.themeMode)
    AppStorage.set('settingPlayerName', this.playerName)
    AppStorage.set('settingAiDifficulty', this.aiDifficulty)
    AppStorage.set('settingConfirmPlacement', this.confirmPlacement)
    AppStorage.set('settingLocalAi', this.localAiEnabled)
  }

  // 防误碰：同一格 1200ms 内点两次才真正落子（扫雷/牌桌/聚会类不参与）
  private confirmCell(index: number): boolean {
    if (!this.confirmPlacement) return true
    const game = this.selectedGame
    if (game === 'minesweeper' || game === 'rummy' || game === 'ludo' || game === 'monopoly' ||
      game === 'landlord' || game === 'mahjong' || game === 'poker' || game === 'werewolf' || game === 'spy') {
      return true
    }
    const now = new Date().getTime()
    if (this.pendingTapIndex === index && now - this.pendingTapAt <= 1200) {
      this.pendingTapIndex = -1
      this.pendingTapAt = 0
      return true
    }
    this.pendingTapIndex = index
    this.pendingTapAt = now
    this.gameStatus = '再点一次同一格确认落子（可在设置里关闭防误碰）'
    return false
  }

  private boardSnapshot(): string {
    if (this.selectedGame === 'chinese-chess') return this.chessPieces.join('|')
    if (this.selectedGame === 'world-chess') return this.worldChessPieces.join('|')
    return this.board.join(',')
  }

  private applySnapshot(snapshot: string): void {
    const parts = snapshot.split('#')
    const piece = Number.parseInt(parts[0])
    this.currentPiece = Number.isNaN(piece) ? 1 : piece
    const data = parts.slice(1).join('#')
    if (this.selectedGame === 'chinese-chess') {
      this.chessPieces = data.split('|')
    } else if (this.selectedGame === 'world-chess') {
      this.worldChessPieces = data.split('|')
    } else {
      this.board = data.split(',').map((value: string) => Number.parseInt(value) || 0)
    }
    this.selectedCell = -1
  }

  private pushBoardHistory(): void {
    this.boardHistory.push(`${this.currentPiece}#${this.boardSnapshot()}`)
    if (this.boardHistory.length > 200) this.boardHistory = this.boardHistory.slice(-200)
  }

  private saveBoard(): void {
    AppStorage.set('savedBoardSnapshot', `${this.selectedGame}#${this.currentPiece}#${this.boardSnapshot()}`)
    this.gameStatus = '局面已保存，下次进入同一款游戏可以载入'
  }

  private loadBoard(): void {
    const saved = AppStorage.get<string>('savedBoardSnapshot')
    if (saved === undefined || saved.length === 0) {
      this.gameStatus = '还没有保存过局面'
      return
    }
    const parts = saved.split('#')
    if (parts.length < 3 || parts[0] !== this.selectedGame) {
      this.gameStatus = '保存的局面属于其他游戏，请先切换到对应游戏'
      return
    }
    this.pushBoardHistory()
    this.applySnapshot(parts.slice(1).join('#'))
    this.gameStatus = '已载入上次保存的局面'
  }

  private undoBoard(): void {
    if (this.boardHistory.length === 0) {
      this.gameStatus = '没有可以撤销的走子'
      return
    }
    const last = this.boardHistory[this.boardHistory.length - 1]
    this.boardHistory = this.boardHistory.slice(0, this.boardHistory.length - 1)
    this.applySnapshot(last)
    this.gameStatus = '已撤销一步'
  }
"""

PLAYAREA_OLD = """    } else if (this.selectedGame === 'monopoly') {
      this.MonopolyTable()
    } else if (this.selectedGame === 'landlord' || this.selectedGame === 'mahjong' || this.selectedGame === 'poker') {
      this.CardTable()
"""
PLAYAREA_NEW = """    } else if (this.selectedGame === 'minesweeper') {
      this.MinesweeperBoard()
    } else if (this.selectedGame === 'monopoly') {
      this.MonopolyTable()
    } else if (this.selectedGame === 'landlord') {
      this.LandlordTable()
    } else if (this.selectedGame === 'mahjong' || this.selectedGame === 'poker') {
      this.CardTable()
"""

# 落子入口加确认包装
TAP_OLD_NEW = [
    (".onClick(() => this.placePiece(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.placePiece(index) })"),
    (".onClick(() => this.placeReversi(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.placeReversi(index) })"),
    (".onClick(() => this.placeSimple(index, 3))",
     ".onClick(() => { if (this.confirmCell(index)) this.placeSimple(index, 3) })"),
    (".onClick(() => this.placeGo(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.placeGo(index) })"),
    (".onClick(() => this.moveChess(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.moveChess(index) })"),
    (".onClick(() => this.moveChecker(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.moveChecker(index) })"),
    (".onClick(() => this.moveWorldChess(index))",
     ".onClick(() => { if (this.confirmCell(index)) this.moveWorldChess(index) })"),
]

# 大富翁 / 牌桌 / 聚会桌 完整替换
MONOPOLY_OLD_START = "  @Builder\n  MonopolyTable() {"
CARD_TABLE_OLD_START = "  @Builder\n  CardTable() {"
SOCIAL_OLD_START = "  @Builder\n  SocialDeductionTable() {"

NEW_GAME_BLOCK = r"""  // ===== 扫雷 =====
  private mineSize(): number {
    return [9, 12, 16][this.mineLevel]
  }

  private mineTotal(): number {
    return [10, 24, 40][this.mineLevel]
  }

  private startMinesweeper(level: number): void {
    const size = [9, 12, 16][level]
    this.mineLevel = level
    this.mineBoard = Array(size * size).fill(false)
    this.mineRevealed = Array(size * size).fill(false)
    this.mineFlagged = Array(size * size).fill(false)
    this.mineCounts = Array(size * size).fill(0)
    this.mineFinished = false
    this.mineFirstTap = true
    this.mineSeconds = 0
    this.mineFlagMode = false
    this.stopMineTimer()
  }

  private startMineTimer(): void {
    this.stopMineTimer()
    this.mineTimer = setInterval(() => {
      if (!this.mineFinished) this.mineSeconds += 1
    }, 1000)
  }

  private stopMineTimer(): void {
    if (this.mineTimer >= 0) {
      clearInterval(this.mineTimer)
      this.mineTimer = -1
    }
  }

  private mineNeighbors(index: number): number[] {
    const size = this.mineSize()
    const row = Math.floor(index / size)
    const col = index % size
    const result: number[] = []
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = row + dr
        const nc = col + dc
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
        result.push(nr * size + nc)
      }
    }
    return result
  }

  private placeMines(safeIndex: number): void {
    const size = this.mineSize()
    const safeRow = Math.floor(safeIndex / size)
    const safeCol = safeIndex % size
    const mines: boolean[] = Array(size * size).fill(false)
    let placed = 0
    let guard = 0
    while (placed < this.mineTotal() && guard < 5000) {
      guard += 1
      const row = Math.floor(Math.random() * size)
      const col = Math.floor(Math.random() * size)
      const index = row * size + col
      if (mines[index]) continue
      if (Math.abs(row - safeRow) <= 1 && Math.abs(col - safeCol) <= 1) continue
      mines[index] = true
      placed += 1
    }
    const counts: number[] = Array(size * size).fill(0)
    for (let index = 0; index < size * size; index++) {
      let count = 0
      const neighbors = this.mineNeighbors(index)
      for (let i = 0; i < neighbors.length; i++) {
        if (mines[neighbors[i]]) count += 1
      }
      counts[index] = count
    }
    this.mineBoard = mines
    this.mineCounts = counts
  }

  private revealMineCell(index: number): void {
    const size = this.mineSize()
    if (index < 0 || index >= size * size) return
    if (this.mineRevealed[index] || this.mineFlagged[index] || this.mineBoard[index]) return
    const revealed = this.mineRevealed.slice()
    const stack: number[] = [index]
    while (stack.length > 0) {
      const current = stack[stack.length - 1]
      stack.pop()
      if (current < 0 || current >= size * size) continue
      if (revealed[current] || this.mineFlagged[current] || this.mineBoard[current]) continue
      revealed[current] = true
      if (this.mineCounts[current] !== 0) continue
      const neighbors = this.mineNeighbors(current)
      for (let i = 0; i < neighbors.length; i++) stack.push(neighbors[i])
    }
    this.mineRevealed = revealed
  }

  private mineRevealedSafeCount(): number {
    let count = 0
    for (let i = 0; i < this.mineRevealed.length; i++) {
      if (this.mineRevealed[i] && !this.mineBoard[i]) count += 1
    }
    return count
  }

  private mineRemaining(): number {
    let flags = 0
    for (let i = 0; i < this.mineFlagged.length; i++) {
      if (this.mineFlagged[i]) flags += 1
    }
    return this.mineTotal() - flags
  }

  private tapMine(index: number): void {
    if (this.mineFinished) {
      this.gameStatus = '本局已结束，点“重开”再来一局'
      return
    }
    if (this.mineFlagMode) {
      this.toggleMineFlag(index)
      return
    }
    if (this.mineFirstTap) {
      this.placeMines(index)
      this.mineFirstTap = false
      this.startMineTimer()
    }
    if (this.mineFlagged[index]) {
      this.gameStatus = '这格插着旗，切回挖开模式或先取消'
      return
    }
    if (this.mineBoard[index]) {
      this.mineRevealed = this.mineBoard.slice()
      this.mineFinished = true
      this.stopMineTimer()
      this.gameStatus = `踩到雷了，本局结束（坚持 ${this.mineSeconds} 秒）`
      return
    }
    this.revealMineCell(index)
    const total = this.mineSize() * this.mineSize()
    if (this.mineRevealedSafeCount() >= total - this.mineTotal()) {
      this.mineFinished = true
      this.stopMineTimer()
      this.gameStatus = `全部扫清！用时 ${this.mineSeconds} 秒`
      return
    }
    this.gameStatus = `已展开 · 还剩 ${this.mineRemaining()} 颗雷`
  }

  private toggleMineFlag(index: number): void {
    if (this.mineFinished || this.mineRevealed[index]) return
    const next = this.mineFlagged.slice()
    next[index] = !next[index]
    this.mineFlagged = next
    this.gameStatus = next[index] ? '已插旗' : '已取消插旗'
  }

  private mineCellText(index: number): string {
    if (this.mineFlagged[index]) return '⚑'
    if (!this.mineRevealed[index]) return ''
    if (this.mineBoard[index]) return '●'
    return this.mineCounts[index] > 0 ? `${this.mineCounts[index]}` : ''
  }

  private mineCellTextColor(index: number): string {
    if (this.mineFlagged[index]) return '#C0392B'
    if (this.mineBoard[index] && this.mineRevealed[index]) return '#172033'
    if (!this.mineRevealed[index]) return '#172033'
    const count = this.mineCounts[index]
    return count > 0 ? this.mineNumberColor[count - 1] : '#172033'
  }

  private mineGridTemplate(): string {
    const size = this.mineSize()
    let template = ''
    for (let i = 0; i < size; i++) template += '1fr '
    return template
  }

  @Builder
  MinesweeperBoard() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 3 }) {
          Text('扫雷')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(`${this.mineSize()}×${this.mineSize()} · ${this.mineTotal()} 颗雷 · ${this.mineSeconds}s · 剩余 ${this.mineRemaining()}`)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Image($r('app.media.game_mine'))
          .width(48)
          .height(48)
      }
      .width('100%')
      Row({ space: 8 }) {
        ForEach(['初级', '中级', '高级'], (level: string, index: number) => {
          Button(level)
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .fontColor(this.mineLevel === index ? '#FFFFFF' : this.controlTextColor())
            .backgroundColor(this.mineLevel === index ? this.accentColor() : this.controlColor())
            .border({ width: 1, color: this.mineLevel === index ? this.selectedBorderColor() : this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => {
              this.stopMineTimer()
              this.startMinesweeper(index)
              this.gameStatus = `已切到${level}（${[9, 12, 16][index]}×${[9, 12, 16][index]}，${[10, 24, 40][index]} 颗雷）`
            })
        }, (level: string, index: number) => `mine-level-${index}`)
      }
      .width('100%')
      Row({ space: 8 }) {
        Button(this.mineFlagMode ? '当前：插旗' : '当前：挖开')
          .layoutWeight(1)
          .height(38)
          .fontSize(12)
          .fontColor(this.mineFlagMode ? '#FFFFFF' : this.controlTextColor())
          .backgroundColor(this.mineFlagMode ? '#C0392B' : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => {
            this.mineFlagMode = !this.mineFlagMode
            this.gameStatus = this.mineFlagMode ? '插旗模式：点格子插旗或取消' : '挖开模式：点格子翻开'
          })
        Button('重开')
          .layoutWeight(1)
          .height(38)
          .fontSize(12)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => {
            this.stopMineTimer()
            this.startMinesweeper(this.mineLevel)
            this.gameStatus = '新的一局，第一下必定安全'
          })
      }
      .width('100%')
      Grid() {
        ForEach(this.mineBoard, (_: boolean, index: number) => {
          GridItem() {
            Text(this.mineCellText(index))
              .fontSize(this.mineSize() > 12 ? 11 : 14)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.mineCellTextColor(index))
              .textAlign(TextAlign.Center)
              .width('100%')
              .height('100%')
          }
          .backgroundColor(this.mineRevealed[index] ? '#EBEBE2' : '#9CA49A')
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(3)
          .onClick(() => this.tapMine(index))
        }, (_: boolean, index: number) => `mine-cell-${this.mineLevel}-${index}`)
      }
      .columnsTemplate(this.mineGridTemplate())
      .rowsTemplate(this.mineGridTemplate())
      .columnsGap(2)
      .rowsGap(2)
      .width('100%')
      .aspectRatio(1)
      Text('提示：第一下永远不会踩雷；切到插旗模式可以标记可疑的格子。')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  // ===== 大富翁 =====
  private monopolyPrice(index: number): number {
    const prices: number[] = [0, 1200, 0, 1400, 0, 1600, 0, 1800, 0, 2000, 2200, 2400, 0, 2600, 0, 2800, 0, 3000, 0,
      3200, 0, 3400, 2400, 3600]
    return prices[index % prices.length]
  }

  private monopolyRent(index: number): number {
    const price = this.monopolyPrice(index)
    if (price === 0) return 0
    const owner = this.monopolyOwner[index]
    if (owner < 0) return Math.round(price * 0.18)
    let sameColor = 0
    for (let i = 0; i < this.monopolyOwner.length; i++) {
      if (this.monopolyOwner[i] === owner && this.monopolyPrice(i) > 0) sameColor += 1
    }
    return Math.round(price * 0.18 * (1 + (sameColor - 1) * 0.4))
  }

  private monopolyOver(): boolean {
    for (let i = 0; i < this.monopolyCash.length; i++) {
      if (this.monopolyCash[i] < 0) return true
    }
    return false
  }

  private startMonopoly(): void {
    this.monopolyCash = [15000, 15000, 15000, 15000]
    this.monopolyOwner = Array(24).fill(-1)
    this.monopolyPos = [0, 0, 0, 0]
    this.monopolyTurn = 0
  }

  private monopolyRoll(): void {
    if (this.monopolyOver()) {
      this.gameStatus = '已有玩家破产，本局结束，点“重开本局”'
      return
    }
    const player = this.monopolyTurn
    const roll = Math.floor(Math.random() * 6) + 1
    const nextPos = (this.monopolyPos[player] + roll) % 24
    const positions = this.monopolyPos.slice()
    positions[player] = nextPos
    this.monopolyPos = positions
    const name = this.propertySquareName(nextPos)
    const price = this.monopolyPrice(nextPos)
    const owner = this.monopolyOwner[nextPos]
    const cash = this.monopolyCash.slice()
    if (price > 0 && owner < 0 && cash[player] >= price) {
      cash[player] -= price
      const owners = this.monopolyOwner.slice()
      owners[nextPos] = player
      this.monopolyOwner = owners
      this.monopolyCash = cash
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll}，花 ¥${price} 买下${name}`
    } else if (price > 0 && owner >= 0 && owner !== player) {
      const rent = this.monopolyRent(nextPos)
      cash[player] -= rent
      cash[owner] += rent
      this.monopolyCash = cash
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll}，在${name}付租金 ¥${rent} 给玩家 ${owner + 1}`
      if (this.monopolyCash[player] < 0) {
        this.gameStatus = `玩家 ${player + 1} 资金见底已破产，本局结束`
      }
    } else if (price > 0 && owner === player) {
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll}，回到自己的${name}`
    } else if (price > 0) {
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll}，${name}要 ¥${price}，资金不够先跳过`
    } else {
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll}，停在${name}`
    }
    this.monopolyTurn = (player + 1) % 4
  }

  private monopolyAssetText(): string {
    let text = ''
    for (let i = 0; i < 24; i++) {
      if (this.monopolyOwner[i] >= 0) {
        text += `${this.propertySquareName(i)}(玩家 ${this.monopolyOwner[i] + 1}) `
      }
    }
    return text.length === 0 ? '还没有人买下地产' : text
  }

  @Builder
  MonopolyTable() {
    Column({ space: 14 }) {
      Row() {
        Column({ space: 3 }) {
          Text('中国城市环游')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(`轮到玩家 ${this.monopolyTurn + 1} · 当前在${this.propertySquareName(this.monopolyPos[this.monopolyTurn])}`)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Image($r('app.media.game_money'))
          .width(48)
          .height(48)
      }
      .width('100%')
      Row({ space: 6 }) {
        ForEach(['1', '2', '3', '4'], (seat: string, index: number) => {
          Column({ space: 2 }) {
            Text(`玩家 ${seat}`)
              .fontSize(11)
              .fontColor(this.monopolyTurn === index ? '#FFFFFF' : this.mutedColor())
            Text(`¥${this.monopolyCash[index]}`)
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.monopolyTurn === index ? '#FFFFFF' : this.textColor())
          }
          .layoutWeight(1)
          .height(52)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.monopolyTurn === index ? this.monopolyPlayerColor[index] : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
        }, (seat: string) => `monopoly-cash-${seat}`)
      }
      .width('100%')
      Grid() {
        ForEach(Array(24).fill(0), (_: number, index: number) => {
          GridItem() {
            Column({ space: 2 }) {
              Text(this.propertySquareName(index))
                .fontSize(10)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.monopolyOwner[index] >= 0 ? '#FFFFFF' : this.textColor())
              if (this.monopolyOwner[index] >= 0) {
                Text(`P${this.monopolyOwner[index] + 1}`)
                  .fontSize(9)
                  .fontColor('#FFFFFF')
              } else if (this.monopolyPrice(index) > 0) {
                Text(`¥${this.monopolyPrice(index)}`)
                  .fontSize(9)
                  .fontColor(this.mutedColor())
              }
            }
            .width('100%')
            .height('100%')
            .justifyContent(FlexAlign.Center)
            .backgroundColor(this.monopolyOwner[index] >= 0 ? this.monopolyPlayerColor[this.monopolyOwner[index]] :
              this.controlColor())
            .border({
              width: this.monopolyPos.indexOf(index) >= 0 ? 2 : 1,
              color: this.monopolyPos.indexOf(index) >= 0 ? this.accentColor() : this.themeBorderColor()
            })
          }
        }, (_: number, index: number) => `property-${index}-${this.monopolyOwner[index]}`)
      }
      .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr 1fr')
      .width('100%')
      .aspectRatio(1.5)
      Text(this.monopolyAssetText())
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
        .maxLines(2)
      Row({ space: 10 }) {
        Button('掷骰前进')
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.accentColor())
          .onClick(() => this.monopolyRoll())
        Button('重开本局')
          .layoutWeight(1)
          .height(44)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => {
            this.startMonopoly()
            this.gameStatus = '新的一局，四位玩家各有 ¥15,000'
          })
      }
      .width('100%')
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  // ===== 斗地主 =====
  private buildDeck(): string[] {
    const suits: string[] = ['♠', '♥', '♣', '♦']
    const faces: string[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
    const deck: string[] = []
    suits.forEach((suit: string) => {
      faces.forEach((face: string) => deck.push(suit + face))
    })
    deck.push('小王')
    deck.push('大王')
    return deck
  }

  private cardRank(card: string): number {
    if (card === '小王') return 14
    if (card === '大王') return 15
    const order: string[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
    const rank = order.indexOf(card.substring(1))
    return rank < 0 ? 0 : rank + 1
  }

  private sortHand(hand: string[]): string[] {
    return hand.slice().sort((a: string, b: string) => this.cardRank(b) - this.cardRank(a))
  }

  private shuffleStringDeck(deck: string[]): string[] {
    const result = deck.slice()
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = result[i]
      result[i] = result[j]
      result[j] = temp
    }
    return result
  }

  private startLandlord(): void {
    const deck = this.shuffleStringDeck(this.buildDeck())
    this.landlordHands = [this.sortHand(deck.slice(0, 17)), this.sortHand(deck.slice(17, 34)),
      this.sortHand(deck.slice(34, 51))]
    this.landlordBottom = deck.slice(51, 54)
    this.landlordTurn = 0
    this.landlordMaster = -1
    this.landlordLastType = ''
    this.landlordLastRank = 0
    this.landlordLastSize = 0
    this.landlordLastOwner = -1
    this.landlordPassCount = 0
    this.landlordWinner = -1
    this.landlordSelected = Array(17).fill(false)
  }

  private landlordBid(master: number): void {
    if (this.landlordMaster >= 0) return
    const hands = this.landlordHands.slice()
    hands[master] = this.sortHand(hands[master].concat(this.landlordBottom))
    this.landlordHands = hands
    this.landlordMaster = master
    this.landlordTurn = master
    this.gameStatus = master === 0 ? '你叫了地主，3 张底牌已并入你的手牌' : `玩家 ${master + 1} 叫了地主`
  }

  private analyzeCombo(cards: string[]): CardCombo | null {
    if (cards.length === 0) return null
    if (cards.length === 2 && cards.indexOf('小王') >= 0 && cards.indexOf('大王') >= 0) {
      return { type: 'rocket', rank: 100, size: 2 }
    }
    const ranks: number[] = cards.map((card: string) => this.cardRank(card))
    const counts: number[] = []
    for (let i = 0; i < ranks.length; i++) {
      let count = 0
      for (let j = 0; j < ranks.length; j++) {
        if (ranks[j] === ranks[i]) count += 1
      }
      counts.push(count)
    }
    let maxCount = 0
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > maxCount) maxCount = counts[i]
    }
    const size = cards.length
    if (maxCount === 4 && size === 4) {
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] === 4) return { type: 'bomb', rank: ranks[i], size: 4 }
      }
      return null
    }
    if (size === 1) return { type: 'single', rank: ranks[0], size: 1 }
    if (size === 2 && maxCount === 2) return { type: 'pair', rank: ranks[0], size: 2 }
    if (size === 3 && maxCount === 3) return { type: 'trio', rank: ranks[0], size: 3 }
    if (size === 4 && maxCount === 3) {
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] === 3) return { type: 'trio_single', rank: ranks[i], size: 4 }
      }
      return null
    }
    if (size >= 5 && maxCount === 1) {
      let min = ranks[0]
      let max = ranks[0]
      for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] < min) min = ranks[i]
        if (ranks[i] > max) max = ranks[i]
      }
      if (max <= 12 && max - min === size - 1) return { type: 'straight', rank: max, size: size }
    }
    return null
  }

  private comboBeats(combo: CardCombo): boolean {
    const lastType = this.landlordLastType
    if (lastType.length === 0 || this.landlordLastOwner === 0) return true
    if (combo.type === 'rocket') return true
    if (lastType === 'rocket') return false
    if (combo.type === 'bomb') return lastType !== 'bomb' || combo.rank > this.landlordLastRank
    if (lastType === 'bomb') return false
    if (combo.type !== lastType || combo.size !== this.landlordLastSize) return false
    return combo.rank > this.landlordLastRank
  }

  private landlordSelectedCards(): string[] {
    const cards: string[] = []
    const hand = this.landlordHands[0]
    for (let i = 0; i < hand.length; i++) {
      if (i < this.landlordSelected.length && this.landlordSelected[i]) cards.push(hand[i])
    }
    return cards
  }

  private applyLandlordPlay(seat: number, cards: string[], combo: CardCombo): void {
    const hands = this.landlordHands.slice()
    const remain = hands[seat].slice()
    cards.forEach((card: string) => {
      const at = remain.indexOf(card)
      if (at >= 0) remain.splice(at, 1)
    })
    hands[seat] = remain
    this.landlordHands = hands
    this.landlordLastType = combo.type
    this.landlordLastRank = combo.rank
    this.landlordLastSize = combo.size
    this.landlordLastOwner = seat
    this.landlordPassCount = 0
    if (remain.length === 0) {
      this.landlordWinner = seat
      this.gameStatus = seat === this.landlordMaster ? '地主获胜！' : '农民获胜！'
      return
    }
    this.gameStatus = `玩家 ${seat + 1} 出 ${cards.join(' ')}`
  }

  private landlordPlay(): void {
    if (this.landlordMaster < 0) {
      this.gameStatus = '先叫地主再出牌'
      return
    }
    if (this.landlordWinner >= 0) return
    const cards = this.landlordSelectedCards()
    const combo = this.analyzeCombo(cards)
    if (combo === null) {
      this.gameStatus = '这手牌不构成合法牌型（单张/对子/三张/三带一/顺子/炸弹/王炸）'
      return
    }
    if (!this.comboBeats(combo)) {
      this.gameStatus = '压不过上家，可以点“过”'
      return
    }
    this.applyLandlordPlay(0, cards, combo)
    this.landlordSelected = Array(this.landlordHands[0].length).fill(false)
    if (this.landlordWinner >= 0) return
    this.landlordTurn = 1
    this.landlordAiTurn()
  }

  private landlordPass(): void {
    if (this.landlordMaster < 0 || this.landlordWinner >= 0) return
    this.landlordSelected = Array(this.landlordHands[0].length).fill(false)
    this.landlordPassCount += 1
    if (this.landlordPassCount >= 2) {
      this.landlordPassCount = 0
      this.landlordLastType = ''
      this.landlordLastOwner = -1
    }
    this.landlordTurn = 1
    this.gameStatus = '你选择过牌'
    this.landlordAiTurn()
  }

  private findBeatCombo(hand: string[], last: CardCombo | null): string[] {
    if (last === null) {
      const sorted = this.sortHand(hand)
      return sorted.length > 0 ? [sorted[sorted.length - 1]] : []
    }
    const groups: string[][] = []
    const used: boolean[] = Array(hand.length).fill(false)
    for (let i = 0; i < hand.length; i++) {
      if (used[i]) continue
      const group: string[] = []
      for (let j = 0; j < hand.length; j++) {
        if (!used[j] && this.cardRank(hand[j]) === this.cardRank(hand[i])) {
          group.push(hand[j])
          used[j] = true
        }
      }
      groups.push(group)
    }
    groups.sort((a: string[], b: string[]) => this.cardRank(a[0]) - this.cardRank(b[0]))
    if (last.type === 'single') {
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].length < 4 && this.cardRank(groups[i][0]) > last.rank) return [groups[i][0]]
      }
    } else if (last.type === 'pair') {
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].length >= 2 && groups[i].length < 4 && this.cardRank(groups[i][0]) > last.rank) {
          return [groups[i][0], groups[i][1]]
        }
      }
    } else if (last.type === 'trio') {
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].length >= 3 && this.cardRank(groups[i][0]) > last.rank) {
          return [groups[i][0], groups[i][1], groups[i][2]]
        }
      }
    }
    if (last.type !== 'rocket') {
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].length === 4 && (last.type !== 'bomb' || this.cardRank(groups[i][0]) > last.rank)) {
          return groups[i].slice(0, 4)
        }
      }
      if (hand.indexOf('小王') >= 0 && hand.indexOf('大王') >= 0) return ['小王', '大王']
    }
    return []
  }

  private landlordAiTurn(): void {
    if (this.landlordWinner >= 0) return
    if (this.landlordTurn === 0) {
      this.gameStatus = this.landlordLastType.length === 0 ? '轮到你出牌' : '轮到你，出牌或过'
      return
    }
    setTimeout(() => {
      const seat = this.landlordTurn
      const hand = this.landlordHands[seat]
      const last: CardCombo | null = this.landlordLastType.length === 0 ? null :
        { type: this.landlordLastType, rank: this.landlordLastRank, size: this.landlordLastSize }
      const beat = this.findBeatCombo(hand, last)
      if (beat.length > 0) {
        const combo = this.analyzeCombo(beat)
        if (combo !== null) this.applyLandlordPlay(seat, beat, combo)
      } else {
        this.landlordPassCount += 1
        this.gameStatus = `玩家 ${seat + 1} 过牌`
      }
      if (this.landlordWinner >= 0) return
      const next = seat + 1
      if (next > 2) {
        if (this.landlordPassCount >= 2) {
          this.landlordPassCount = 0
          this.landlordLastType = ''
          this.landlordLastOwner = -1
          this.landlordTurn = this.landlordLastOwner < 0 ? 0 : this.landlordLastOwner
          if (this.landlordTurn === 0) return
        } else {
          this.landlordTurn = this.landlordLastOwner >= 0 ? this.landlordLastOwner : 0
        }
      } else {
        this.landlordTurn = next
      }
      if (this.landlordTurn === 0) return
      this.landlordAiTurn()
    }, 500)
  }

  private landlordLastText(): string {
    if (this.landlordLastType.length === 0) return '自由出牌'
    return `${this.landlordLastType} · ${this.landlordLastSize} 张 · 来自玩家 ${this.landlordLastOwner + 1}`
  }

  @Builder
  LandlordTable() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 3 }) {
          Text('斗地主')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.landlordMaster < 0 ? '等待叫地主' :
            `地主是玩家 ${this.landlordMaster + 1} · ${this.landlordLastText()}`)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Image($r('app.media.game_cards'))
          .width(48)
          .height(48)
      }
      .width('100%')
      Row({ space: 6 }) {
        ForEach(['1', '2', '3'], (seat: string, index: number) => {
          Column({ space: 2 }) {
            Text(index === this.landlordMaster ? '地主' : '农民')
              .fontSize(10)
              .fontColor(this.landlordTurn === index ? '#FFFFFF' : this.mutedColor())
            Text(`${this.landlordHands[index].length} 张`)
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.landlordTurn === index ? '#FFFFFF' : this.textColor())
          }
          .layoutWeight(1)
          .height(50)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.landlordTurn === index ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
        }, (seat: string) => `landlord-seat-${seat}`)
      }
      .width('100%')
      if (this.landlordMaster < 0) {
        Row({ space: 8 }) {
          Button('叫地主')
            .layoutWeight(1)
            .height(42)
            .backgroundColor(this.accentColor())
            .onClick(() => this.landlordBid(0))
          Button('不叫')
            .layoutWeight(1)
            .height(42)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .onClick(() => this.landlordBid(1))
        }
        .width('100%')
      }
      Scroll() {
        Row({ space: 6 }) {
          ForEach(this.landlordHands[0], (card: string, index: number) => {
            Text(card)
              .width(46)
              .height(this.landlordSelected[index] ? 76 : 66)
              .fontSize(15)
              .fontWeight(FontWeight.Bold)
              .fontColor(card.indexOf('♥') >= 0 || card.indexOf('♦') >= 0 ? '#C83434' : '#172033')
              .textAlign(TextAlign.Center)
              .backgroundColor('#FFFDF7')
              .border({
                width: this.landlordSelected[index] ? 2.5 : 1.5,
                color: this.landlordSelected[index] ? this.accentColor() : '#B9AD99'
              })
              .borderRadius(6)
              .onClick(() => {
                if (this.landlordTurn !== 0 || this.landlordWinner >= 0) return
                const selected = this.landlordSelected.slice()
                selected[index] = !selected[index]
                this.landlordSelected = selected
              })
          }, (card: string, index: number) => `landlord-card-${index}-${card}`)
        }
        .padding({ top: 6, bottom: 6 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      Text(this.landlordMaster === 0 ? `底牌：${this.landlordBottom.join(' ')}` : '底牌在地主确定后公开')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
      Row({ space: 8 }) {
        Button('出牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .onClick(() => this.landlordPlay())
        Button('过')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => this.landlordPass())
        Button('重开')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => {
            this.startLandlord()
            this.gameStatus = '已重新发牌，先叫地主'
          })
      }
      .width('100%')
      Text('规则：单张、对子、三张、三带一、五张以上顺子、炸弹与王炸，压不过可以过。')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  // ===== 狼人杀 / 谁是卧底 =====
  private socialSeats(): number {
    return this.selectedGame === 'werewolf' ? 8 : 6
  }

  private startSocialGame(): void {
    const seats = this.socialSeats()
    if (this.selectedGame === 'werewolf') {
      this.socialRoles = this.shuffleStringDeck(this.werewolfRoles.slice(0, seats))
      this.socialWord = ''
    } else {
      const pair = this.socialWordPairs[Math.floor(Math.random() * this.socialWordPairs.length)]
      const roles: string[] = Array(seats).fill('平民')
      const spyCount = seats >= 7 ? 2 : 1
      for (let i = 0; i < spyCount; i++) roles[i] = '卧底'
      const shuffled = this.shuffleStringDeck(roles)
      this.socialRoles = shuffled
      this.socialWord = shuffled[0] === '卧底' ? pair[1] : pair[0]
    }
    this.socialAlive = Array(seats).fill(true)
    this.socialPhase = '发言'
    this.socialVotes = Array(seats).fill(0)
  }

  private socialCheckEnd(): string {
    let evil = 0
    let good = 0
    for (let i = 0; i < this.socialRoles.length; i++) {
      if (!this.socialAlive[i]) continue
      if (this.socialRoles[i] === '狼人' || this.socialRoles[i] === '卧底') evil += 1
      else good += 1
    }
    if (this.selectedGame === 'werewolf') {
      if (evil === 0) return '狼人全部出局，好人阵营获胜'
      if (evil >= good) return '狼人已不输于好人，狼人阵营获胜'
      return ''
    }
    if (evil === 0) return '卧底全部出局，平民获胜'
    if (good <= 1) return '卧底活到最后，卧底获胜'
    return ''
  }

  private socialVote(seat: number): void {
    if (this.socialPhase !== '投票') {
      this.gameStatus = '先点“进入投票”再选择要投的人'
      return
    }
    if (!this.socialAlive[seat]) return
    const votes = this.socialVotes.slice()
    votes[seat] += 1
    for (let i = 1; i < votes.length; i++) {
      if (this.socialAlive[i]) votes[i] += Math.floor(Math.random() * 3)
    }
    this.socialVotes = votes
    let target = -1
    let best = -1
    for (let i = 0; i < votes.length; i++) {
      if (this.socialAlive[i] && votes[i] > best) {
        best = votes[i]
        target = i
      }
    }
    if (target < 0) return
    const alive = this.socialAlive.slice()
    alive[target] = false
    this.socialAlive = alive
    this.socialVotes = Array(votes.length).fill(0)
    this.socialPhase = '发言'
    this.partyRound += 1
    this.gameStatus = `${target + 1} 号被投出局，身份是${this.socialRoles[target]}`
    const result = this.socialCheckEnd()
    if (result.length > 0) this.gameStatus = `${this.gameStatus} · ${result}`
  }

  @Builder
  SocialDeductionTable() {
    Column({ space: 14 }) {
      Row() {
        Column({ space: 3 }) {
          Text(this.gameTitle())
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.selectedGame === 'werewolf' ?
            `第 ${this.partyRound} 天 · ${this.socialPhase}阶段` :
            `第 ${this.partyRound} 轮 · ${this.socialPhase}阶段`)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Image($r('app.media.game_party'))
          .width(48)
          .height(48)
      }
      .width('100%')
      if (this.socialWord.length > 0) {
        Text(`你的词：${this.socialWord}`)
          .width('100%')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .padding(10)
          .backgroundColor(this.controlColor())
          .borderRadius(8)
      } else if (this.socialRoles.length > 0) {
        Text(`你的身份：${this.socialRoles[0]}`)
          .width('100%')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .padding(10)
          .backgroundColor(this.controlColor())
          .borderRadius(8)
      }
      Grid() {
        ForEach(this.socialRoles, (role: string, index: number) => {
          GridItem() {
            Column({ space: 4 }) {
              SymbolGlyph(index === 0 ? $r('sys.symbol.person_fill') : $r('sys.symbol.person'))
                .fontSize(22)
                .fontColor([index === 0 ? '#FFFFFF' : this.mutedColor()])
              Text(index === 0 ? '你' : `${index + 1} 号`)
                .fontSize(12)
                .fontColor(index === 0 ? '#FFFFFF' : this.textColor())
              Text(this.socialAlive[index] ? (this.socialVotes[index] > 0 ? `${this.socialVotes[index]} 票` : '存活') :
                `出局 · ${role}`)
                .fontSize(10)
                .fontColor(index === 0 ? '#E7F1EB' : this.mutedColor())
            }
            .width('100%')
            .height(90)
            .justifyContent(FlexAlign.Center)
            .backgroundColor(this.socialAlive[index] ? (index === 0 ? this.accentColor() : this.controlColor()) :
              '#7A7A7A')
            .border({
              width: this.socialPhase === '投票' && this.socialAlive[index] ? 2 : 1,
              color: this.socialPhase === '投票' && this.socialAlive[index] ? this.accentColor() :
                this.themeBorderColor()
            })
            .borderRadius(8)
            .onClick(() => this.socialVote(index))
          }
        }, (role: string, index: number) => `social-seat-${index}-${role}-${this.socialAlive[index]}`)
      }
      .columnsTemplate(this.windowWidth < 520 ? '1fr 1fr 1fr' : '1fr 1fr 1fr 1fr')
      .columnsGap(8)
      .rowsGap(8)
      .width('100%')
      Row({ space: 8 }) {
        Button(this.socialPhase === '投票' ? '投票中' : '进入投票')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .onClick(() => {
            this.socialPhase = '投票'
            this.socialVotes = Array(this.socialRoles.length).fill(0)
            this.gameStatus = '投票阶段：点座位把票投给TA'
          })
        Button('发言完毕')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => {
            this.socialPhase = '发言'
            this.partyRound += 1
            this.gameStatus = '轮换到下一位玩家发言'
          })
        Button('新的一局')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => {
            this.startSocialGame()
            this.gameStatus = this.selectedGame === 'werewolf' ? '身份已重新分配' : '词条已重新分配'
          })
      }
      .width('100%')
      Text(this.selectedGame === 'werewolf' ?
        '规则：8 人局 2 狼人 + 预言家 + 女巫 + 4 平民，白天投票放逐，狼人出尽或人数持平即分胜负。' :
        '规则：每人拿到一个词，卧底的词不同，轮流描述后投票找出卧底。')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  CardTable() {
    Column({ space: 14 }) {
      Row() {
        Column({ space: 3 }) {
          Text(this.gameTitle())
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.selectedGameInfo().note)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Image($r('app.media.game_cards'))
          .width(48)
          .height(48)
      }
      .width('100%')
      Row({ space: 10 }) {
        ForEach(['东', '南', '西', '北'], (seat: string, index: number) => {
          Column({ space: 5 }) {
            SymbolGlyph(index === 0 ? $r('sys.symbol.person_fill') : $r('sys.symbol.person'))
              .fontSize(24)
              .fontColor([index === 0 ? '#FFFFFF' : this.mutedColor()])
            Text(seat)
              .fontSize(12)
              .fontColor(index === 0 ? '#FFFFFF' : this.textColor())
          }
          .layoutWeight(1)
          .height(82)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(index === 0 ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
        }, (seat: string) => `card-seat-${seat}`)
      }
      .width('100%')
      Scroll() {
        Row({ space: 7 }) {
          ForEach(['一万', '二万', '三万', '四筒', '五筒', '六筒', '东', '东'], (card: string, index: number) => {
            Text(card).width(44).height(60).fontSize(15).fontWeight(FontWeight.Bold).fontColor('#172033').textAlign(TextAlign.Center).backgroundColor('#FFFDF7').border({ width: 1.5, color: '#B9AD99' }).borderRadius(6)
          }, (card: string, index: number) => `hand-card-${index}-${card}`)
        }
        .padding({ top: 6, bottom: 6 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      Row({ space: 8 }) {
        Button('摸牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .onClick(() => {
            this.partyRound += 1
            this.gameStatus = `第 ${this.partyRound} 巡 · 等待下一位`
          })
        Button('过')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => this.gameStatus = '已过，本回合不操作')
      }
      .width('100%')
      Text('四人牌局正在制作中，当前可以先体验斗地主的完整对局。')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

"""

# 局面操作行（插在“重开”按钮行之后）
BOARD_ROW_ANCHOR = """      .width('100%')

      if (this.roomId === '本地') {
        Row({ space: 8 }) {
          Text('AI 难度')"""
BOARD_ROW_NEW = """      .width('100%')

      if (this.roomId === '本地') {
        Row({ space: 8 }) {
          Button('撤销一步')
            .layoutWeight(1)
            .height(36)
            .fontSize(12)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.undoBoard())
          Button('保存局面')
            .layoutWeight(1)
            .height(36)
            .fontSize(12)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.saveBoard())
          Button('载入局面')
            .layoutWeight(1)
            .height(36)
            .fontSize(12)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.loadBoard())
        }
        .width('100%')
      }

      if (this.roomId === '本地') {
        Row({ space: 8 }) {
          Text('AI 难度')"""

# 设置面板新增两项
PREF_TAIL_OLD = """      Column({ space: 10 }) {
        Text('AI 难度')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach(['轻松', '标准', '困难'], (difficulty: string) => {
            Button(difficulty)
              .layoutWeight(1)
              .height(42)
              .fontColor(this.aiDifficulty === difficulty ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.aiDifficulty === difficulty ? this.accentColor() : this.controlColor())
              .borderRadius(8)
              .onClick(() => this.aiDifficulty = difficulty)
          })
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
    }
    .width('100%')
  }
"""
PREF_TAIL_NEW = """      Column({ space: 10 }) {
        Text('AI 难度')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach(['轻松', '标准', '困难'], (difficulty: string) => {
            Button(difficulty)
              .layoutWeight(1)
              .height(42)
              .fontColor(this.aiDifficulty === difficulty ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.aiDifficulty === difficulty ? this.accentColor() : this.controlColor())
              .borderRadius(8)
              .onClick(() => {
                this.aiDifficulty = difficulty
                this.persistSettings()
              })
          })
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
      Column({ space: 10 }) {
        Text('落子确认')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text('开启后需要连点同一格两次才落子，避免手滑；扫雷、牌桌与聚会玩法不受影响。')
          .width('100%')
          .fontSize(12)
          .fontColor(this.mutedColor())
        Row({ space: 8 }) {
          ForEach([['on', '开启'], ['off', '关闭']], (item: string[]) => {
            Button(item[1])
              .layoutWeight(1)
              .height(42)
              .fontColor((this.confirmPlacement ? 'on' : 'off') === item[0] ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor((this.confirmPlacement ? 'on' : 'off') === item[0] ? this.accentColor() :
                this.controlColor())
              .borderRadius(8)
              .onClick(() => {
                this.confirmPlacement = item[0] === 'on'
                this.persistSettings()
              })
          })
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
      Column({ space: 10 }) {
        Text('AI 陪练')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach([['on', '默认开启'], ['off', '默认关闭']], (item: string[]) => {
            Button(item[1])
              .layoutWeight(1)
              .height(42)
              .fontColor((this.localAiEnabled ? 'on' : 'off') === item[0] ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor((this.localAiEnabled ? 'on' : 'off') === item[0] ? this.accentColor() :
                this.controlColor())
              .borderRadius(8)
              .onClick(() => {
                this.localAiEnabled = item[0] === 'on'
                this.persistSettings()
              })
          })
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
    }
    .width('100%')
  }
"""

# 玩家名称与主题写入持久化
NAME_ONCHANGE_OLD = """          .onChange((value: string) => this.playerName = value)"""
NAME_ONCHANGE_NEW = """          .onChange((value: string) => {
            this.playerName = value
            this.persistSettings()
          })"""


def cut_block(text: str, start_marker: str, end_marker: str) -> tuple:
    """返回 (before, block, after)，block 为 start_marker 到 end_marker(不含) 之间的内容。"""
    i = text.find(start_marker)
    if i < 0:
        return None
    j = text.find(end_marker, i + len(start_marker))
    if j < 0:
        return None
    return text[:i], text[i:j], text[j:]


def patch(path: str) -> None:
    src = open(path, encoding="utf-8").read()
    report = []

    def rep(old, new, label):
        nonlocal src
        n = src.count(old)
        if n == 0:
            report.append("MISS  " + label)
            return False
        src = src.replace(old, new, 1)
        report.append("OK    %s (x%d)" % (label, n))
        return True

    rep("interface GameInfo {", CARD_COMBO, "CardCombo 接口")
    rep("  @State partyRound: number = 1\n", NEW_STATES, "新增状态字段")
    rep("  private aiApplying: boolean = false\n", NEW_PRIVATES, "新增私有字段")
    rep(GAME_ENTRY_OLD, GAME_ENTRY_NEW, "游戏清单加扫雷")
    rep(RESET_TAIL_OLD, RESET_TAIL_NEW, "resetBoard 初始化")
    rep(ABOUT_OLD, ABOUT_NEW, "aboutToAppear + 存档 + 防误碰")
    rep(PLAYAREA_OLD, PLAYAREA_NEW, "PlayArea 分支")
    for old, new in TAP_OLD_NEW:
        rep(old, new, "落子确认 " + old[:44])
    rep(BOARD_ROW_ANCHOR, BOARD_ROW_NEW, "局面操作行")
    rep(PREF_TAIL_OLD, PREF_TAIL_NEW, "设置面板新增项")
    rep(NAME_ONCHANGE_OLD, NAME_ONCHANGE_NEW, "玩家名称持久化")

    # 替换 MonopolyTable / CardTable / SocialDeductionTable 三块
    seg = src
    marker = "  private propertySquareName(index: number): string {"
    k = seg.find(marker)
    if k < 0:
        report.append("MISS  propertySquareName 锚点")
        return
    # 找到 MonopolyTable 起点
    m_start = seg.find(MONOPOLY_OLD_START)
    s_start = seg.find(SOCIAL_OLD_START)
    if m_start < 0 or s_start < 0:
        report.append("MISS  Builder 定位")
        return
    s_end = seg.find("  @Builder\n  PartyTable() {", s_start)
    if s_end < 0:
        report.append("MISS  PartyTable 定位")
        return
    seg = seg[:m_start] + NEW_GAME_BLOCK + seg[s_end:]
    src = seg
    report.append("OK    替换大富翁/牌桌/聚会三块，插入扫雷与斗地主")

    open(path, "w", encoding="utf-8").write(src)
    print("=== %s ===" % path)
    for line in report:
        print("  " + line)


if __name__ == "__main__":
    for root in sys.argv[1:]:
        p = os.path.join(root, "entry/src/main/ets/pages/Index.ets")
        if not os.path.exists(p):
            print("跳过（不存在）:", p)
            continue
        patch(p)
