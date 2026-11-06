import { common, ConfigurationConstant } from '@kit.AbilityKit'
import { bundleManager } from '@kit.AbilityKit'
import { analyzeBoard, AnalysisResult, AppliedMove, applyBoardMove, BoardMove, emptyBoard, findBestMove,
  puzzlePosition, PuzzlePosition, setGoBoardSide, validateEditorState } from '../model/BoardAnalysis'
import { analyzeGuandan, guandanBeats, guandanCandidatePlays, guandanComboName, guandanDeck,
  guandanIsWild, guandanShuffle, guandanSortHand, guandanWithWilds, GuandanCombo } from '../model/Guandan'

interface CardCombo {
  type: string
  rank: number
  size: number
}

interface GameInfo {
  id: string
  title: string
  note: string
  players: string
  accent: string
  icon: Resource
}

interface NavigationItem {
  id: string
  title: string
  icon: Resource
}

interface JoinRoomPayload {
  roomId: string
  username: string
  gameType: string
  maxPlayers: number
}

interface MovePayload {
  type: string
  index: number
  piece: number
}

interface SyncActionPayload {
  roomId: string
  action: string
  data: MovePayload
}

interface ChatPayload {
  roomId: string
  username: string
  message: string
}

interface RoomOnlyPayload {
  roomId: string
}

interface ResetVotePayload {
  roomId: string
  approve: boolean
}

interface FeedbackPayload {
  product: string
  platform: string
  version: string
  account: string
  category: string
  message: string
}

interface PassportLoginPayload {
  account: string
  password: string
}

interface PassportRegisterPayload {
  username: string
  nickname: string
  password: string
  email: string
  phone: string
}

@Entry
@Component
struct Index {
  // 版本号从包管理器动态读取，避免改版本时 UI 与包信息脱节
  @State appVersion: string = ''
  @State appBuild: number = 0
  @StorageLink('systemDark') systemDark: boolean = false
  @State page: string = 'lobby'
  @State activeTab: string = 'lobby'
  @State secondaryPage: string = ''
  @State selectedGame: string = 'gobang'
  @State roomId: string = '本地'
  @State playerName: string = '鸿蒙玩家'
  @State connectionText: string = '无需联网 · 随时开一桌'
  @State roomStatus: string = '本地练习'
  @State isOwner: boolean = false
  @State awaitingMove: boolean = false
  @State resetPrompt: string = ''
  @State chatText: string = ''
  @State chatLines: string[] = []
  @State board: number[] = Array(361).fill(0)
  @State goSize: number = 19   // 围棋棋盘路数：13 / 19
  @State currentPiece: number = 1
  @State lastMoveIndex: number = -1
  @State gameStatus: string = '黑方先行'
  @State updateText: string = '单机版不需要联网更新'
  @State latestPackage: string = '尚未检查'
  @State passportAccount: string = ''
  @State passportPassword: string = ''
  @State loginText: string = '未登录铮铮通行证'
  @State feedbackText: string = ''
  @State feedbackStatus: string = '反馈会提交到网站后台'
  @State themeMode: string = 'system'
  @State socketSid: string = ''
  @State socketId: string = ''
  @State socketActive: boolean = false
  @State windowWidth: number = 390
  @State windowHeight: number = 844
  @State gameMoreOpen: boolean = false
  @State inviteFallbackOpen: boolean = false
  @State inviteUrl: string = ''
  @State pendingInviteGame: string = ''
  @State pendingInviteRoom: string = ''
  @State pendingInviteSource: string = ''
  @State scanStatus: string = ''
  @State aiDifficulty: string = '标准'
  @State studyMode: string = 'play'
  @State studyText: string = '可在当前局面进行本地分析'
  @State puzzleGoal: string = ''
  @State puzzleIndex: number = -1
  @State editorTool: string = '1'
  @State editorChessPiece: string = '帥'
  @State localAiEnabled: boolean = true
  @State aiThinking: boolean = false
  @State previousBoard: number[] = []
  @State publicRooms: string[] = ['尚未读取公开房间']
  @State leaderboardRows: string[] = ['尚未读取排行榜']
  @State selectedCell: number = -1
  @State chessPieces: string[] = Array(90).fill('')
  @State rummyHand: number[] = []
  @State rummyRackRows: number = 3      // 牌架行数，可自行增减（1..7）
  @State rummySortMode: boolean = false // 整理模式：点两张牌交换位置
  @State rummySortPick: number = -1
  // 桌面按「组合」分组存放，每组是合法顺子或刻子
  @State rummySets: number[][] = []
  @State rummyDeckCount: number = 106
  @State selectedTile: number = -1
  @State rummySelectedSet: number = -1
  @State rummyOpened: boolean = false
  @State rummyTurn: number = 0
  @State rummyAiCounts: number[] = [14, 14]
  @State rummyWinner: number = -1
  @State rummyPending: number[][] = []
  @State rummyLog: string = ''
  private rummyDeck: number[] = []
  private rummyAiHands: number[][] = [[], []]
  private readonly rummyJoker: number = 99
  @State worldChessPieces: string[] = Array(64).fill('')
  @State ludoPieces: number[][] = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
  @State ludoTurn: number = 0
  @State ludoOptions: number[] = []
  @State ludoNeedPick: boolean = false
  @State ludoPlayerCount: number = 4
  @State junqiBoard: string[] = Array(60).fill('')
  @State junqiSelected: number = -1
  // 陆战棋暗棋模式：玩家（红方）自家 25 子全部明牌；对手（蓝方）棋子以背面显示，
  // 只有在发生碰撞（进攻/被进攻）后才对该子永久揭晓。junqiKnown = 该格对玩家公开。
  @State junqiKnown: boolean[] = Array(60).fill(false)
  // AI 视角的已知表：蓝方（AI）自家明牌，红方棋子只有交火后才被 AI 记住
  private junqiAiKnown: boolean[] = Array(60).fill(false)
  // 中国跳棋（六角星盘 121 孔，三人对弈：红/黄/蓝各 10 子，AI 托管两家）
  @State jumpBoard: number[] = Array(121).fill(0)
  @State jumpSelected: number = -1
  @State jumpMoves: number[] = []
  @State diceValue: number = 0
  @State partyRound: number = 1
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
  @State monopolyHouse: number[] = Array(24).fill(0)
  @State monopolyMortgaged: boolean[] = Array(24).fill(false)
  @State monopolyPendingBuy: number = -1
  @State monopolyLastRoll: number = 0
  // 麻将：玩家 + 3 家 AI，万筒条 108 张
  @State mahjongHand: number[] = []
  @State mahjongMelds: number[] = []
  @State mahjongPool: number[] = []
  @State mahjongTurn: number = 0
  @State mahjongWallCount: number = 0
  @State mahjongDrawn: number = -1
  @State mahjongClaim: number = -1
  @State mahjongCanPon: boolean = false
  @State mahjongCanKan: boolean = false
  @State mahjongCanChi: boolean = false
  @State mahjongCanHu: boolean = false
  @State mahjongAiCounts: number[] = [13, 13, 13]
  @State mahjongWinner: number = -1
  private mahjongWall: number[] = []
  private mahjongAi: number[][] = [[], [], []]
  // 扑克（炸金花）：玩家 + 3 家 AI
  @State pokerHand: number[] = []
  @State pokerAiHands: number[][] = [[], [], []]
  @State pokerPot: number = 0
  @State pokerChip: number = 1000
  @State pokerBet: number = 20
  @State pokerRound: number = 0
  @State pokerWinner: number = -1
  @State pokerReveal: boolean = false
  @State pokerAlive: boolean[] = [true, true, true, true]
  @State pokerLog: string = ''
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
  // 掼蛋（4 人两队，0/2 一队、1/3 一队）
  @State guandanHands: string[][] = []
  @State guandanLevel: number = 2
  @State guandanTurn: number = 0
  @State guandanLastCombo: GuandanCombo | null = null
  @State guandanLastOwner: number = -1
  @State guandanLastCards: string[] = []
  @State guandanPassCount: number = 0
  @State guandanWinner: number = -1
  @State guandanWinnerTeam: string = ''
  @State guandanSelected: boolean[] = []
  @State guandanTribute: string[] = []
  @State guandanPlayed: string[][] = [[], [], [], []]
  @State guandanLog: string = ''
  @State socialRoles: string[] = []
  @State socialAlive: boolean[] = []
  @State socialPhase: string = '发言'
  @State socialVotes: number[] = []
  @State socialWord: string = ''
  private pollTimer: number = -1
  private polling: boolean = false
  private failedPolls: number = 0
  private worldChessRights: string = 'KQkq'
  private worldChessEp: number = -1
  // AI 正在落子的标志：AI 走完不能再次触发 AI，否则会变成 AI 自对局死循环
  private aiApplying: boolean = false
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
  // 国内版飞行棋（经典十字布局）坐标：scripts/gen_ludo_board.py 与底图同源生成，勿手工改单边
  // 主跑道 52 格（4 臂外侧列 + 4 个中列顶格闭环），起飞点 0/13/26/39，
  // 拐弯箭头 = (start+50)%52，终点通道 5 格；相对进度：0..50 跑道 / 51..55 通道 / 56 终点
  // 玩家：0红(左上) 1黄(右上) 2蓝(右下) 3绿(左下)；四角机场色与坐标同序
  private readonly ludoRouteX: number[] = [11.80, 18.17, 24.53, 30.90, 37.27, 43.63, 43.63, 43.63, 43.63, 43.63, 43.63, 50.00, 56.37, 56.37, 56.37, 56.37, 56.37, 56.37, 62.73, 69.10, 75.47, 81.83, 88.20, 94.57, 94.57, 94.57, 88.20, 81.83, 75.47, 69.10, 62.73, 56.37, 56.37, 56.37, 56.37, 56.37, 56.37, 50.00, 43.63, 43.63, 43.63, 43.63, 43.63, 43.63, 37.27, 30.90, 24.53, 18.17, 11.80, 5.43, 5.43, 5.43]
  private readonly ludoRouteY: number[] = [43.63, 43.63, 43.63, 43.63, 43.63, 37.27, 30.90, 24.53, 18.17, 11.80, 5.43, 5.43, 5.43, 11.80, 18.17, 24.53, 30.90, 37.27, 43.63, 43.63, 43.63, 43.63, 43.63, 43.63, 50.00, 56.37, 56.37, 56.37, 56.37, 56.37, 56.37, 62.73, 69.10, 75.47, 81.83, 88.20, 94.57, 94.57, 94.57, 88.20, 81.83, 75.47, 69.10, 62.73, 56.37, 56.37, 56.37, 56.37, 56.37, 56.37, 50.00, 43.63]
  private readonly ludoRouteColor: string[] = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54', '#E94B3C', '#F5A623', '#3B7DD8', '#229B54']
  private readonly ludoHomeX: number[][] = [[11.80, 18.17, 24.53, 30.90, 37.27], [50.00, 50.00, 50.00, 50.00, 50.00], [88.20, 81.83, 75.47, 69.10, 62.73], [50.00, 50.00, 50.00, 50.00, 50.00]]
  private readonly ludoHomeY: number[][] = [[50.00, 50.00, 50.00, 50.00, 50.00], [11.80, 18.17, 24.53, 30.90, 37.27], [50.00, 50.00, 50.00, 50.00, 50.00], [88.20, 81.83, 75.47, 69.10, 62.73]]
  private readonly ludoStartOffset: number[] = [0, 13, 26, 39]
  // 四角停机坪 16 个机位（顺序 player*4+piece）：0红左上 / 1黄右上 / 2蓝右下 / 3绿左下
  private readonly ludoBaseX: number[] = [14.98, 27.72, 14.98, 27.72, 72.28, 85.02, 72.28, 85.02, 72.28, 85.02, 72.28, 85.02, 14.98, 27.72, 14.98, 27.72]
  private readonly ludoBaseY: number[] = [14.98, 14.98, 27.72, 27.72, 14.98, 14.98, 27.72, 27.72, 72.28, 72.28, 85.02, 85.02, 72.28, 72.28, 85.02, 85.02]
  // 终点按玩家区分（各自 home 来向一侧），避免飞机全部叠在同一点
  private readonly ludoFinishX: number[] = [48.09, 51.53, 51.53, 48.09]
  private readonly ludoFinishY: number[] = [48.09, 48.09, 51.53, 51.53]
  private readonly ludoPlayerColor: string[] = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54']
  private readonly ludoPlayerName: string[] = ['红', '黄', '蓝', '绿']

  private games: GameInfo[] = [
    { id: 'gobang', title: '五子棋', note: '15 路 · 本机裁判', players: '1-2 人', accent: '#A4453A', icon: $r('app.media.game_gomoku') },
    { id: 'reversi', title: '黑白棋', note: '翻转棋子 · 终局计数', players: '2 人', accent: '#2F855A', icon: $r('app.media.game_reversi') },
    { id: 'tictactoe', title: '井字棋', note: '三连获胜 · 快速对局', players: '2 人', accent: '#2471A3', icon: $r('app.media.game_tictactoe') },
    { id: 'go', title: '围棋', note: '19 路 · 提子与数目', players: '1-2 人', accent: '#B58B45', icon: $r('app.media.game_go') },
    { id: 'chinese-chess', title: '中国象棋', note: '楚河汉界 · 将帅对决', players: '2 人', accent: '#C0392B', icon: $r('app.media.game_chess') },
    { id: 'world-chess', title: '国际象棋', note: '8×8 · 王车易位与升变', players: '2 人', accent: '#4A5A3A', icon: $r('app.media.game_wchess') },
    { id: 'checkers', title: '中国跳棋', note: '六角星 · 三人连跳对弈', players: '2-3 人', accent: '#5B6FB5', icon: $r('app.media.game_checkers') },
    { id: 'rummy', title: '拉密', note: '106 张标准牌组', players: '2-4 人', accent: '#2471A3', icon: $r('app.media.game_rummy') },
    { id: 'ludo', title: '飞行棋', note: '骰子规则可自定义', players: '2-4 人', accent: '#8E44AD', icon: $r('app.media.game_ludo') },
    { id: 'junqi', title: '陆战棋', note: '暗棋 · 敌子未明 · 铁路行营', players: '2 人', accent: '#2F4F3A', icon: $r('app.media.game_junqi') },
    { id: 'minesweeper', title: '扫雷', note: '三档难度 · 首击必安全', players: '1 人', accent: '#5D6D7E', icon: $r('app.media.game_mine') },
    { id: 'monopoly', title: '大富翁', note: '地产经营与资金管理', players: '2-4 人', accent: '#B7791F', icon: $r('app.media.game_money') },
    { id: 'landlord', title: '斗地主', note: '地主与农民对抗', players: '3 人', accent: '#C05621', icon: $r('app.media.game_cards') },
    { id: 'guandan', title: '掼蛋', note: '两副牌 · 级牌与逢人配', players: '4 人', accent: '#1F7A4D', icon: $r('app.media.game_cards') },
    { id: 'mahjong', title: '麻将', note: '四人牌局', players: '4 人', accent: '#2F855A', icon: $r('app.media.game_mahjong') },
    { id: 'werewolf', title: '狼人杀', note: '身份、发言与投票', players: '6-12 人', accent: '#34495E', icon: $r('app.media.game_party') },
    { id: 'spy', title: '谁是卧底', note: '词语推理与投票', players: '4-10 人', accent: '#D35400', icon: $r('app.media.game_spy') },
    { id: 'poker', title: '扑克牌', note: '房间牌局 · 多人聊天', players: '2-6 人', accent: '#8A3E45', icon: $r('app.media.game_poker') }
  ]
  private navigationItems: NavigationItem[] = [
    { id: 'lobby', title: '大厅', icon: $r('sys.symbol.house') },
    { id: 'games', title: '游戏', icon: $r('sys.symbol.dot_grid_2x2') },
    { id: 'profile', title: '我的', icon: $r('sys.symbol.person_crop_circle_fill_1') }
  ]

  aboutToAppear(): void {
    this.loadAppVersion()
    this.restoreSettings()
    this.resetBoard()
  }

  // 从包信息读取 versionName / versionCode，显示层不再写死
  private loadAppVersion(): void {
    try {
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT)
      this.appVersion = info.versionName
      // versionCode 1010300 → 1300（可读 build 号），避免「build 1010300」太长
      const code = info.versionCode
      this.appBuild = code >= 1000000 ? Math.floor(code / 1000) % 10000 : code
    } catch (e) {
      this.appVersion = '1.3.0'
      this.appBuild = 1300
    }
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
  // 象棋/跳棋/国际象棋本来就是「先点选子、再点目标」的两段式交互，
  // 天然防误碰；再叠加双击确认会让一步棋要点四次，且单点选子毫无反馈，
  // 表现为「棋盘点了没反应、根本玩不了」——这三类必须豁免。
  private confirmCell(index: number): boolean {
    if (!this.confirmPlacement) return true
    const game = this.selectedGame
    if (game === 'minesweeper' || game === 'rummy' || game === 'ludo' || game === 'monopoly' ||
      game === 'landlord' || game === 'guandan' || game === 'mahjong' || game === 'poker' ||
      game === 'werewolf' || game === 'spy' ||
      game === 'chinese-chess' || game === 'checkers' || game === 'world-chess' || game === 'tictactoe') {
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
    if (this.selectedGame === 'junqi') {
      return this.junqiBoard.join('|') + '~' + this.junqiKnown.map((r: boolean) => r ? '1' : '0').join('') +
        '~' + this.junqiAiKnown.map((r: boolean) => r ? '1' : '0').join('')
    }
    if (this.selectedGame === 'checkers') return this.jumpBoard.join(',')
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
    } else if (this.selectedGame === 'junqi') {
      const seg = data.split('~')
      this.junqiBoard = seg[0].split('|')
      this.junqiKnown = seg.length > 1 ? seg[1].split('').map((v: string) => v === '1') : Array(60).fill(true)
      this.junqiAiKnown = seg.length > 2 ? seg[2].split('').map((v: string) => v === '1') : Array(60).fill(true)
      this.junqiSelected = -1
    } else if (this.selectedGame === 'checkers') {
      this.jumpBoard = data.split(',').map((value: string) => Number.parseInt(value) || 0)
      this.jumpSelected = -1
      this.jumpMoves = []
    } else {
      this.board = data.split(',').map((value: string) => Number.parseInt(value) || 0)
    }
    this.selectedCell = -1
  }

  private pushBoardHistory(): void {
    const snapshot = `${this.currentPiece}#${this.boardSnapshot()}`
    if (this.boardHistory.length > 0 && this.boardHistory[this.boardHistory.length - 1] === snapshot) return
    this.boardHistory.push(snapshot)
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

  onPageShow(): void {
    this.roomId = '本地'
  }

  private startRoomScan(): void {
    this.scanStatus = '单机版无需扫码，直接选择游戏即可开始'
  }

  private acceptPendingInvite(): void {
    this.pendingInviteGame = ''
    this.pendingInviteRoom = ''
    this.pendingInviteSource = ''
  }

  private openSystemInvite(): void {
    this.scanStatus = '单机版不提供房间邀请'
  }

  private continueOnWeb(): void {
    this.scanStatus = '单机版不会打开网页'
  }

  private showInviteFallback(): void {
    this.inviteFallbackOpen = false
    this.gameMoreOpen = false
  }

  private layoutRatio(): number {
    return this.windowWidth / Math.max(this.windowHeight, 1)
  }

  private gameColumns(): string {
    if (this.windowWidth < 520) {
      return '1fr 1fr'
    }
    if (this.windowWidth < 900) {
      return '1fr 1fr 1fr'
    }
    return '1fr 1fr 1fr 1fr'
  }

  private contentMaxWidth(): number {
    if (this.layoutRatio() >= 1.65 && this.windowHeight <= 720) {
      return 1400
    }
    if (this.windowWidth >= 700) {
      return 1180
    }
    return 980
  }

  private pagePadding(): number {
    return this.windowWidth < 420 ? 10 : (this.windowWidth >= 700 ? 22 : 14)
  }

  private boardWidth(): number {
    const pageChrome = (this.pagePadding() + 10) * 2
    const contentWidth = Math.min(this.contentMaxWidth(), Math.max(280, this.windowWidth - pageChrome))
    // 棋盘优先：手机上让棋盘尽量吃满可用高度（0.62 -> 0.72），宽屏放宽上限到 780
    const heightLimit = Math.max(300, this.windowHeight * (this.isWideWorkspace() ? 0.78 : 0.72))
    return Math.floor(Math.min(contentWidth, heightLimit, 780))
  }

  // 只有真正叠在底图上的棋盘才需要底图资源；rummy_table / property_board / card_table
  // 三个大图没有任何 Builder 使用，已从资源目录删除（包体 -2.8MB）。
  private boardArtwork(game: string): Resource {
    if (game === 'reversi') return $r('app.media.reversi_board')
    if (game === 'tictactoe') return $r('app.media.tictactoe_board')
    if (game === 'gobang') return $r('app.media.gobang_board')
    if (game === 'go') return this.goSize === 13 ? $r('app.media.go_board_13') : $r('app.media.go_board_19')
    if (game === 'chinese-chess') return $r('app.media.xiangqi_board')
    if (game === 'checkers') return $r('app.media.jump_board')
    if (game === 'ludo') return $r('app.media.ludo_board')
    if (game === 'junqi') return $r('app.media.junqi_board')
    return $r('app.media.reversi_board')
  }

  private isWideWorkspace(): boolean {
    return this.windowWidth >= 900 && this.layoutRatio() >= 1.12
  }

  private chatPanelHeight(): number {
    return this.isWideWorkspace() ? 360 : 116
  }

  private darkTheme(): boolean {
    return this.themeMode === 'dark' || (this.themeMode === 'system' && this.systemDark)
  }
  private pageColor(): string { return this.darkTheme() ? '#121715' : '#F4F3EE' }
  private cardColor(): string { return this.darkTheme() ? '#1C221F' : '#FFFEFA' }
  private inputColor(): string { return this.darkTheme() ? '#252C28' : '#E9ECE7' }
  private controlColor(): string { return this.darkTheme() ? '#29312D' : '#E3E7E1' }
  private textColor(): string { return this.darkTheme() ? '#F7F6F1' : '#19221E' }
  private controlTextColor(): string { return this.darkTheme() ? '#E8EBE6' : '#29352F' }
  private mutedColor(): string { return this.darkTheme() ? '#A6AFA9' : '#657169' }
  private themeBorderColor(): string { return this.darkTheme() ? '#46504A' : '#CDD2CB' }
  private selectedCardColor(): string { return this.darkTheme() ? '#263A30' : '#E7EEE8' }
  private selectedBorderColor(): string { return this.darkTheme() ? '#6B9B7F' : '#28694B' }
  private accentColor(): string { return this.darkTheme() ? '#438563' : '#28694B' }
  private accentPressedColor(): string { return this.darkTheme() ? '#356D51' : '#1E523B' }
  private positiveSurfaceColor(): string { return this.darkTheme() ? '#253A30' : '#E4EEE7' }
  private warningSurfaceColor(): string { return this.darkTheme() ? '#3A3022' : '#F2E8D2' }
  private tableColor(): string { return this.darkTheme() ? '#234A38' : '#28694B' }
  private tableInkColor(): string { return this.darkTheme() ? '#F4F1E7' : '#FFFDF5' }
  private brassColor(): string { return this.darkTheme() ? '#C5A15D' : '#B58B45' }
  private lacquerColor(): string { return this.darkTheme() ? '#C25F52' : '#A4453A' }

  private setTheme(mode: string): void {
    this.themeMode = mode
    this.persistSettings()
    const colorMode = mode === 'dark'
      ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
      : mode === 'light'
        ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
        : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET
    const context = getContext(this) as common.UIAbilityContext
    try {
      context.getApplicationContext().setColorMode(colorMode)
    } catch (_) {
      this.feedbackStatus = '外观切换失败，请稍后重试'
    }
  }

  private gameTitle(): string {
    let title = '五子棋'
    this.games.forEach((game: GameInfo) => {
      if (game.id === this.selectedGame) {
        title = game.title
      }
    })
    return title
  }

  private selectedGameInfo(): GameInfo {
    let selected: GameInfo = this.games[0]
    this.games.forEach((game: GameInfo) => {
      if (game.id === this.selectedGame) {
        selected = game
      }
    })
    return selected
  }

  private offlineGames(): GameInfo[] {
    return this.games
  }

  private stepText(): string {
    if (this.page === 'game') {
      if (this.roomStatus === '对局中' || this.roomId === '本地') {
        return '对局中'
      }
      return '等待开局'
    }
    if (this.activeTab === 'room') {
      return '开局准备'
    }
    return '选局'
  }

  private screenTitle(): string {
    if (this.page === 'game') return this.gameTitle()
    if (this.secondaryPage === 'public') return '公开房间'
    if (this.secondaryPage === 'leaderboard') return '排行榜'
    if (this.secondaryPage === 'passport') return '铮铮通行证'
    if (this.secondaryPage === 'preferences') return '外观与操作'
    if (this.secondaryPage === 'update') return '软件更新'
    if (this.secondaryPage === 'feedback') return '反馈问题'
    if (this.secondaryPage === 'about') return '关于桌游中心'
    if (this.activeTab === 'lobby') return '铮铮单机桌游'
    if (this.activeTab === 'room') return '联机房间'
    if (this.activeTab === 'games') return '游戏'
    return '我的'
  }

  private openSecondary(panel: string): void {
    this.secondaryPage = panel
    if (panel === 'public') this.loadPublicRooms()
    if (panel === 'leaderboard') this.loadLeaderboard()
    if (panel === 'update') this.checkUpdate()
  }

  private loadPublicRooms(): void {
    this.publicRooms = ['正在读取公开房间…']
    this.requestText(`https://zhengzhengstudio.cn/api/boardgames/public-rooms?gameType=${this.selectedGame}`,
      (body: string) => {
        const rows: string[] = []
        const pattern = /"roomId"\s*:\s*"([^"]+)"/g
        let match = pattern.exec(body)
        while (match && rows.length < 8) {
          rows.push(`${this.gameTitle()} · 房间 ${match[1]}`)
          match = pattern.exec(body)
        }
        this.publicRooms = rows.length > 0 ? rows : ['当前没有等待中的公开房间']
      })
  }

  private loadLeaderboard(): void {
    this.leaderboardRows = ['正在读取排行榜…']
    this.requestText(`https://zhengzhengstudio.cn/api/boardgames/leaderboard?gameType=${this.selectedGame}`,
      (body: string) => {
        const rows: string[] = []
        const pattern = /"(?:name|username)"\s*:\s*"([^"]+)"/g
        let match = pattern.exec(body)
        while (match && rows.length < 12) {
          rows.push(`${rows.length + 1}. ${match[1]}`)
          match = pattern.exec(body)
        }
        this.leaderboardRows = rows.length > 0 ? rows : ['这个游戏还没有排行记录']
      })
  }

  private selectGame(game: GameInfo): void {
    this.selectedGame = game.id
    this.studyText = ''
    this.studyMode = 'play'
    this.resetBoard()
    this.connectionText = `已选择 ${game.title} · 可立即开始本地对局`
  }

  private shuffleTiles(): number[] {
    const tiles: number[] = []
    for (let copy = 0; copy < 2; copy++) {
      for (let color = 0; color < 4; color++) {
        for (let value = 1; value <= 13; value++) {
          tiles.push(color * 20 + value)
        }
      }
    }
    tiles.push(99)
    tiles.push(99)
    for (let index = tiles.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      const current = tiles[index]
      tiles[index] = tiles[swapIndex]
      tiles[swapIndex] = current
    }
    return tiles
  }

  private tileLabel(tile: number): string {
    return tile === 99 ? '★' : `${tile % 20}`
  }

  private tileColor(tile: number): string {
    if (tile === 99) return '#202522'
    const color = Math.floor(tile / 20)
    if (color === 0) return '#C2413A'
    if (color === 1) return '#2B67A0'
    if (color === 2) return '#B7791F'
    return '#202522'
  }

  private requestText(url: string, success: (body: string) => void): void {
    this.connectionText = '单机版不访问网络'
  }

  private postJson(url: string, payload: object, success: (body: string) => void, failure?: (message: string) => void): void {
    if (failure) {
      failure('单机版不访问网络')
    }
  }

  private socketUrl(): string {
    let suffix = this.socketSid.length > 0 ? `&sid=${this.socketSid}` : `&t=${Date.now()}`
    return `https://zhengzhengstudio.cn/socket.io/?EIO=4&transport=polling${suffix}`
  }

  private socketRequest(method: string, body: string, success: (text: string) => void, failure?: () => void): void {
    if (failure) {
      failure()
    }
  }

  private emitSocket(eventName: string, payload: object): void {
    if (!this.socketActive || this.socketSid.length === 0) {
      return
    }
    let packet = `42${JSON.stringify([eventName, payload])}`
    this.socketRequest('POST', packet, () => {})
  }

  private connectRoom(): void {
    this.socketActive = false
    this.socketSid = ''
    if (this.pollTimer >= 0) {
      clearInterval(this.pollTimer)
      this.pollTimer = -1
    }
    this.socketRequest('GET', '', (opening: string) => {
      let sidMatch = opening.match(/"sid":"([^"]+)"/)
      if (!sidMatch || sidMatch.length < 2) {
        this.connectionText = `房间 ${this.roomId} · 主站握手失败`
        return
      }
      this.socketSid = sidMatch[1]
      this.socketRequest('POST', '40', () => {
        this.socketActive = true
        this.failedPolls = 0
        this.polling = false
        let joinPayload: JoinRoomPayload = {
          roomId: this.roomId,
          username: this.playerName,
          gameType: this.selectedGame,
          maxPlayers: this.maxPlayersForGame(this.selectedGame)
        }
        this.emitSocket('join-room', joinPayload)
        this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · 主站已连接`
        this.chatLines = [...this.chatLines, `系统：已加入主站房间 ${this.roomId}`].slice(-30)
        this.pollSocket()
        this.pollTimer = setInterval(() => this.pollSocket(), 2600)
      })
    })
  }

  private maxPlayersForGame(gameId: string): number {
    if (gameId === 'werewolf') {
      return 12
    }
    if (gameId === 'spy') {
      return 10
    }
    if (gameId === 'landlord') {
      return 3
    }
    if (gameId === 'guandan') {
      return 4
    }
    if (gameId === 'rummy' || gameId === 'ludo' || gameId === 'mahjong' || gameId === 'monopoly') {
      return 4
    }
    return 2
  }

  private pollSocket(): void {
    if (!this.socketActive || this.socketSid.length === 0 || this.polling) {
      return
    }
    this.polling = true
    this.socketRequest('GET', '', (packets: string) => {
      this.polling = false
      this.failedPolls = 0
      packets.split('\u001e').forEach((packet: string) => {
        if (packet === '2') {
          this.socketRequest('POST', '3', () => {})
        } else if (packet.startsWith('40')) {
          let socketMatch = packet.match(/"sid":"([^"]+)"/)
          if (socketMatch && socketMatch.length > 1) {
            this.socketId = socketMatch[1]
          }
        } else if (packet.startsWith('42')) {
          this.handleSocketEvent(packet.substring(2))
        }
      })
    }, () => {
      this.polling = false
      this.failedPolls += 1
      if (this.failedPolls >= 3) {
        this.socketActive = false
        if (this.pollTimer >= 0) {
          clearInterval(this.pollTimer)
          this.pollTimer = -1
        }
        this.connectionText = `房间 ${this.roomId} · 主站暂时不可用，可本地练习`
      }
    })
  }

  private handleSocketEvent(raw: string): void {
    let chatMatch = raw.match(/^\["chat-message",\{.*?"username":"([^"]*)".*?"message":"([^"]*)"/)
    if (chatMatch && chatMatch.length > 2) {
      this.chatLines = [...this.chatLines, `${chatMatch[1]}：${chatMatch[2]}`].slice(-30)
      return
    }
    let moveMatch = raw.match(/^\["(?:sync-action|game-event)",\{.*?"action":"(?:move|place)".*?"index":(\d+).*?"(?:side|piece)":(-?\d+)/)
    if (moveMatch && moveMatch.length > 2) {
      let index = Number(moveMatch[1])
      let piece = Number(moveMatch[2]) === -1 ? 2 : 1
      if (index >= 0 && index < this.board.length && this.board[index] === 0) {
        let next = this.board.slice()
        next[index] = piece
        this.board = next
        this.lastMoveIndex = index
        if (this.selectedGame === 'gobang' && this.hasWon(index, piece)) {
          this.gameStatus = piece === 1 ? '黑方获胜' : '白方获胜'
        } else {
          this.currentPiece = piece === 1 ? 2 : 1
          this.gameStatus = this.currentPiece === 1 ? '轮到黑方' : '轮到白方'
        }
      }
      this.awaitingMove = false
      return
    }
    if (raw.indexOf('"game-state"') >= 0 || raw.indexOf('"game-started"') >= 0 || raw.indexOf('"game-start"') >= 0) {
      this.syncBoardFromEvent(raw)
    }
    if (raw.indexOf('"room-info"') >= 0 || raw.indexOf('"room-update"') >= 0) {
      let ownerPattern = new RegExp(`"id":"${this.socketId}"[^}]*"isOwner":true`)
      this.isOwner = ownerPattern.test(raw)
      if (raw.indexOf('"status":"playing"') >= 0) {
        this.roomStatus = '对局中'
        this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · 对局中`
      } else if (raw.indexOf('"status":"finished"') >= 0) {
        this.roomStatus = '本局已结束'
      } else {
        this.roomStatus = this.isOwner ? '等待玩家，准备后由你开局' : '等待房主开始'
        this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · ${this.roomStatus}`
      }
    } else if (raw.indexOf('"game-started"') >= 0 || raw.indexOf('"game-start"') >= 0) {
      this.roomStatus = '对局中'
      this.gameStatus = '黑方先行'
      this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · 对局中`
    } else if (raw.indexOf('"player-left"') >= 0) {
      this.chatLines = [...this.chatLines, '系统：有玩家暂时离开，保留席位 60 秒'].slice(-30)
    } else if (raw.indexOf('"player-forfeit"') >= 0) {
      this.gameStatus = '对方超时未返回，你已获胜'
      this.roomStatus = '本局已结束'
    } else if (raw.indexOf('"game-over"') >= 0 || raw.indexOf('"game-finished"') >= 0) {
      let winner = raw.match(/"winner":"([^"]*)"/)
      this.gameStatus = winner && winner.length > 1 && winner[1].length > 0 ? `${winner[1]} 获胜` : '本局平局'
      this.roomStatus = '本局已结束'
      this.awaitingMove = false
    } else if (raw.indexOf('"reset-requested"') >= 0) {
      let requester = raw.match(/"requester":"([^"]*)"/)
      this.resetPrompt = `${requester && requester.length > 1 ? requester[1] : '房主'}申请重开`
    } else if (raw.indexOf('"reset-approved"') >= 0) {
      this.resetPrompt = ''
      this.resetBoard()
      this.roomStatus = '等待房主开始'
      this.chatLines = [...this.chatLines, '系统：所有玩家已同意重开'].slice(-30)
    } else if (raw.indexOf('"reset-rejected"') >= 0) {
      this.resetPrompt = ''
      this.chatLines = [...this.chatLines, '系统：重开申请未通过'].slice(-30)
    } else if (raw.indexOf('["error",') === 0) {
      let error = raw.match(/^\["error","([^"]*)"/)
      this.gameStatus = error && error.length > 1 ? error[1] : '服务器拒绝了本次操作'
      this.awaitingMove = false
    }
  }

  private syncBoardFromEvent(raw: string): void {
    let boardMatch = raw.match(/"boardFlat":\[([0-9,\-\s]+)\]/)
    if (!boardMatch || boardMatch.length < 2) {
      boardMatch = raw.match(/"board":\[([0-9,\-\s]+)\]/)
    }
    if (boardMatch && boardMatch.length > 1) {
      let values: number[] = boardMatch[1].split(',').map((value: string) => Number(value.trim()) === -1 ? 2 : Number(value.trim()))
      if (values.length === 225) {
        this.board = [...values, ...Array(136).fill(0)]
      }
    }
    let playerMatch = raw.match(/"currentPlayer":(-?\d+)/)
    if (playerMatch && playerMatch.length > 1) {
      this.currentPiece = Number(playerMatch[1]) === -1 ? 2 : 1
      this.gameStatus = this.currentPiece === 1 ? '轮到黑方' : '轮到白方'
    }
    this.awaitingMove = false
    this.previousBoard = []
  }

  private quickMatch(): void {
    this.connectionText = '单机版暂不提供在线匹配，点「本地练习」马上开局'
  }

  private joinRoom(): void {
    this.connectionText = '单机版暂不支持联机房间，点「本地练习」马上开局'
  }

  private localGame(): void {
    this.roomId = '本地'
    this.connectionText = `${this.gameTitle()} · 本地 AI 练习`
    this.roomStatus = '本地练习'
    this.isOwner = true
    this.studyMode = 'play'
    this.studyText = ''
    this.localAiEnabled = true
    if (this.selectedGame === 'go') setGoBoardSide(this.goSize)
    this.resetBoard()
    this.page = 'game'
  }

  private resetBoard(): void {
    // 围棋按当前路数建盘（13/19），其余棋种沿用各自尺寸
    this.board = Array(this.selectedGame === 'go' ? this.goSize * this.goSize : 361).fill(0)
    if (this.selectedGame === 'reversi') {
      this.board[27] = 2
      this.board[28] = 1
      this.board[35] = 1
      this.board[36] = 2
    }
    if (this.selectedGame === 'checkers') {
      // 中国跳棋：红占顶角、黄占左下、蓝占右下，目标是正对面营地
      const jump: number[] = Array(121).fill(0)
      this.jumpHomes.forEach((home: number[], p: number) => {
        home.forEach((i: number) => { jump[i] = p + 1 })
      })
      this.jumpBoard = jump
      this.jumpSelected = -1
      this.jumpMoves = []
    }
    this.chessPieces = Array(90).fill('')
    if (this.selectedGame === 'chinese-chess') {
      const top = ['車', '馬', '象', '士', '將', '士', '象', '馬', '車']
      const bottom = ['俥', '傌', '相', '仕', '帥', '仕', '相', '傌', '俥']
      top.forEach((piece: string, index: number) => this.chessPieces[index] = piece)
      bottom.forEach((piece: string, index: number) => this.chessPieces[81 + index] = piece)
      this.chessPieces[19] = '砲'
      this.chessPieces[25] = '砲'
      this.chessPieces[64] = '炮'
      this.chessPieces[70] = '炮'
      for (let index = 0; index < 5; index++) {
        this.chessPieces[27 + index * 2] = '卒'
        this.chessPieces[54 + index * 2] = '兵'
      }
    }
    this.worldChessPieces = Array(64).fill('')
    this.worldChessRights = 'KQkq'
    this.worldChessEp = -1
    if (this.selectedGame === 'world-chess') {
      const wcBack = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
      for (let index = 0; index < 8; index++) {
        this.worldChessPieces[index] = 'b' + wcBack[index]
        this.worldChessPieces[8 + index] = 'bP'
        this.worldChessPieces[48 + index] = 'wP'
        this.worldChessPieces[56 + index] = 'w' + wcBack[index]
      }
    }
    if (this.selectedGame === 'rummy') {
      const tiles = this.shuffleTiles()
      this.rummyHand = tiles.slice(0, 14)
      this.rummySets = []
      this.rummyDeck = tiles.slice(42)
      this.rummyDeckCount = this.rummyDeck.length
      this.selectedTile = -1
      this.rummySelectedSet = -1
      this.rummyOpened = false
      this.rummyTurn = 0
      this.rummyAiHands = [tiles.slice(14, 28), tiles.slice(28, 42)]
      this.rummyAiCounts = [14, 14]
      this.rummyWinner = -1
      this.rummyPending = []
      this.rummyRackRows = 3
      this.rummySortMode = false
      this.rummySortPick = -1
      this.rummyLog = '首次出牌需 ≥30 分（百搭按替代牌计分）'
    }
    this.ludoPieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
    this.ludoTurn = 0
    this.diceValue = 0
    this.selectedCell = -1
    this.partyRound = 1
    this.boardHistory = []
    this.startMinesweeper(this.mineLevel)
    this.startMonopoly()
    this.startLandlord()
    this.startGuandan()
    this.startMahjong()
    this.startPoker()
    this.startSocialGame()
    this.currentPiece = 1
    this.lastMoveIndex = -1
    this.gameStatus = this.selectedGame === 'world-chess' ? '白方先行' :
      this.selectedGame === 'checkers' ? '红方先行 · 点己方棋子，再点高亮位置（可连跳）' : '黑方先行'
    this.awaitingMove = false
    if (this.selectedGame === 'junqi') {
      this.junqiReset()
    }
  }


  // ===== 陆战棋（军棋） =====
  // 60 个落点：index = row * 5 + col；上方 0-5 行蓝方，下方 6-11 行红方
  // 棋子编码 '<side><rank>'：9司令 8军长 7师长 6旅长 5团长 4营长 3连长 2排长 1工兵 M地雷 B炸弹 F军旗
  // 铁路：两侧第 0/4 列、中间第 5/6 行；工兵沿铁路可任意行走，行营内棋子不可被攻击，大本营不可进入
  private readonly junqiBase: number[] = [1, 3, 56, 58]
  private readonly junqiCamp: number[] = [5, 7, 9, 16, 18, 41, 43, 50, 52, 54]
  private readonly junqiPosX: number[] = [11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46, 11.54, 30.77, 50.0, 69.23, 88.46]
  private readonly junqiPosY: number[] = [4.62, 4.62, 4.62, 4.62, 4.62, 12.33, 12.33, 12.33, 12.33, 12.33, 20.03, 20.03, 20.03, 20.03, 20.03, 27.73, 27.73, 27.73, 27.73, 27.73, 35.44, 35.44, 35.44, 35.44, 35.44, 43.14, 43.14, 43.14, 43.14, 43.14, 56.86, 56.86, 56.86, 56.86, 56.86, 64.56, 64.56, 64.56, 64.56, 64.56, 72.27, 72.27, 72.27, 72.27, 72.27, 79.97, 79.97, 79.97, 79.97, 79.97, 87.67, 87.67, 87.67, 87.67, 87.67, 95.38, 95.38, 95.38, 95.38, 95.38]

  private junqiSideOf(cell: string): string {
    return cell.length > 0 ? cell.charAt(0) : ''
  }

  private junqiRankOf(cell: string): number {
    if (cell.length < 2) return 0
    const t = cell.charAt(1)
    if (t === 'F') return -2
    if (t === 'B') return -1
    if (t === 'M') return 0
    if (t === '1') return 1
    if (t === '2') return 2
    if (t === '3') return 3
    if (t === '4') return 4
    if (t === '5') return 5
    if (t === '6') return 6
    if (t === '7') return 7
    if (t === '8') return 8
    return 9
  }

  private junqiNameOf(cell: string): string {
    const t = cell.charAt(1)
    if (t === 'F') return '军旗'
    if (t === 'B') return '炸弹'
    if (t === 'M') return '地雷'
    if (t === '9') return '司令'
    if (t === '8') return '军长'
    if (t === '7') return '师长'
    if (t === '6') return '旅长'
    if (t === '5') return '团长'
    if (t === '4') return '营长'
    if (t === '3') return '连长'
    if (t === '2') return '排长'
    return '工兵'
  }

  private junqiShortName(cell: string): string {
    const t = cell.charAt(1)
    if (t === 'F') return '旗'
    if (t === 'B') return '炸'
    if (t === 'M') return '雷'
    if (t === '9') return '令'
    if (t === '8') return '军'
    if (t === '7') return '师'
    if (t === '6') return '旅'
    if (t === '5') return '团'
    if (t === '4') return '营'
    if (t === '3') return '连'
    if (t === '2') return '排'
    return '兵'
  }

  // 面向玩家的显示名：已公开的真实名，未公开的统称「暗子」
  private junqiLabelOf(cell: string, index: number): string {
    if (cell.length === 0) return ''
    if (this.junqiKnown[index]) return this.junqiNameOf(cell)
    return '暗子'
  }

  private junqiMovable(cell: string): boolean {
    const t = cell.charAt(1)
    return t !== 'F' && t !== 'M'
  }

  private junqiReset(): void {
    this.junqiBoard = this.junqiSetup()
    // 红方（玩家）全部明牌；蓝方（对手）全部暗子，碰撞后才揭晓
    const known: boolean[] = Array(60).fill(false)
    for (let i = 0; i < 60; i++) {
      if (this.junqiBoard[i].length > 0 && this.junqiSideOf(this.junqiBoard[i]) === 'r') known[i] = true
    }
    this.junqiKnown = known
    // AI 视角：蓝方自家明牌，红方开局全暗
    const aiKnown: boolean[] = Array(60).fill(false)
    for (let i = 0; i < 60; i++) {
      if (this.junqiBoard[i].length > 0 && this.junqiSideOf(this.junqiBoard[i]) === 'b') aiKnown[i] = true
    }
    this.junqiAiKnown = aiKnown
    this.junqiSelected = -1
    this.currentPiece = 1
    this.gameStatus = '暗棋模式 · 你是红方（明牌），蓝方为暗子，碰撞后即揭晓 · 红方先手'
  }

  // 暗棋布局：红方 25 子布于下方 6 排（row 6-11），蓝方 25 子布于上方 6 排（row 0-5）。
  // 军旗固定放一个本营，另一个本营放地雷；地雷限后两排；行营开局必须为空。
  private junqiSetup(): string[] {
    const board: string[] = Array(60).fill('')
    // 每方 25 子：司令1 军长1 师长2 旅长2 团长2 营长2 连长3 排长3 工兵3 地雷3 炸弹2 军旗1
    const rankList: string[] = ['9', '8', '7', '7', '6', '6', '5', '5', '4', '4',
      '3', '3', '3', '2', '2', '2', '1', '1', '1', 'B', 'B']
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 'b' : 'r'
      const startRow = s === 0 ? 0 : 6
      const backRows = s === 0 ? [0, 1] : [10, 11]
      const baseA = s === 0 ? 1 : 56
      const baseB = s === 0 ? 3 : 58
      // 军旗随机放一个本营，另一个本营放地雷
      const flagBase = Math.random() < 0.5 ? baseA : baseB
      const mineBase = flagBase === baseA ? baseB : baseA
      board[flagBase] = side + 'F'
      board[mineBase] = side + 'M'
      // 收集本方 6 排内可用格（排除本营与行营）
      const spots: number[] = []
      for (let r = startRow; r < startRow + 6; r++) {
        for (let col = 0; col < 5; col++) {
          const idx = r * 5 + col
          if (this.junqiBase.indexOf(idx) >= 0 || this.junqiCamp.indexOf(idx) >= 0) continue
          if (board[idx].length > 0) continue
          spots.push(idx)
        }
      }
      for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = spots[i]
        spots[i] = spots[j]
        spots[j] = tmp
      }
      // 剩余 2 枚地雷必须落在后两排
      const mineSpots: number[] = []
      const restSpots: number[] = []
      spots.forEach((idx: number) => {
        if (backRows.indexOf(Math.floor(idx / 5)) >= 0) mineSpots.push(idx)
        else restSpots.push(idx)
      })
      for (let i = mineSpots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = mineSpots[i]
        mineSpots[i] = mineSpots[j]
        mineSpots[j] = tmp
      }
      for (let m = 0; m < 2 && m < mineSpots.length; m++) board[mineSpots[m]] = side + 'M'
      for (let m = 2; m < mineSpots.length; m++) restSpots.push(mineSpots[m])
      // 其余 21 枚（含 2 炸弹）随机填剩余格
      const rest: string[] = []
      rankList.forEach((rk: string) => rest.push(side + rk))
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = rest[i]
        rest[i] = rest[j]
        rest[j] = tmp
      }
      for (let i = 0; i < restSpots.length && i < rest.length; i++) board[restSpots[i]] = rest[i]
    }
    return board
  }

  // 铁路拓扑（与 scripts/gen_junqi_board.py is_rail 同源）：
  // 横向铁路为每方前线两排（row4/5/6/7 全线）；两侧 col0/col4 纵向全程贯通；
  // 每方前线两排之间（行对 4-5、6-7）任意列的竖向段也是铁路，形成铁路环。
  private junqiIsRail(a: number, b: number): boolean {
    const ra = Math.floor(a / 5)
    const ca = a % 5
    const rb = Math.floor(b / 5)
    const cb = b % 5
    if (ra === rb) return ra >= 4 && ra <= 7
    if (Math.abs(ra - rb) !== 1) return false
    const hi = Math.max(ra, rb)
    if (hi === 5 || hi === 7) return true
    return ca === cb && (ca === 0 || ca === 4)
  }

  private junqiCanEnter(from: number, to: number): boolean {
    if (this.junqiBase.indexOf(to) >= 0) return false
    const target = this.junqiBoard[to]
    if (target.length === 0) return true
    // 暗棋：可以进攻暗子，碰撞时会揭晓（暗子同样可能是己方？不可能——己方明牌，
    // 所以玩家点击到的暗子必是敌方，AI 侧同理）
    if (this.junqiSideOf(target) === this.junqiSideOf(this.junqiBoard[from])) return false
    if (this.junqiCamp.indexOf(to) >= 0) return false
    return true
  }

  private junqiEngineerTargets(from: number): number[] {
    const out: number[] = []
    const seen: boolean[] = Array(60).fill(false)
    seen[from] = true
    const queue: number[] = [from]
    let head = 0
    const dirs: number[][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    while (head < queue.length) {
      const cur = queue[head]
      head += 1
      const r = Math.floor(cur / 5)
      const col = cur % 5
      dirs.forEach((d: number[]) => {
        const nr = r + d[0]
        const nc = col + d[1]
        if (nr < 0 || nr > 11 || nc < 0 || nc > 4) return
        const to = nr * 5 + nc
        if (seen[to] || !this.junqiIsRail(cur, to)) return
        seen[to] = true
        const t = this.junqiBoard[to]
        if (t.length === 0) {
          if (this.junqiBase.indexOf(to) < 0) out.push(to)
          queue.push(to)
        } else if (this.junqiCanEnter(from, to)) {
          out.push(to)
        }
      })
    }
    return out
  }

  private junqiMovesFrom(index: number): number[] {
    const cell = this.junqiBoard[index]
    if (cell.length === 0 || !this.junqiMovable(cell)) return []
    const r = Math.floor(index / 5)
    const col = index % 5
    const out: number[] = []
    // 行营是八向连通：行营内的子可斜向进出，其余兵站只能正交一步
    const inCamp = this.junqiCamp.indexOf(index) >= 0
    const dirs: number[][] = inCamp ?
      [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] :
      [[-1, 0], [1, 0], [0, -1], [0, 1]]
    dirs.forEach((d: number[]) => {
      const nr = r + d[0]
      const nc = col + d[1]
      if (nr < 0 || nr > 11 || nc < 0 || nc > 4) return
      const to = nr * 5 + nc
      if (d[0] !== 0 && d[1] !== 0 && !inCamp && this.junqiCamp.indexOf(to) < 0) return
      if (this.junqiCanEnter(index, to)) out.push(to)
    })
    if (this.junqiRankOf(cell) === 1) {
      this.junqiEngineerTargets(index).forEach((t: number) => {
        if (out.indexOf(t) < 0) out.push(t)
      })
    }
    return out
  }

  // 有无行动：该方是否还有棋子能走动（暗子也在内，AI 知道自己子力）
  private junqiSideHasMove(side: string): boolean {
    for (let i = 0; i < 60; i++) {
      const cell = this.junqiBoard[i]
      if (cell.length === 0) continue
      if (this.junqiSideOf(cell) !== side) continue
      if (this.junqiMovesFrom(i).length > 0) return true
    }
    return false
  }

  // 暗棋揭晓：交火双方互相亮明，两个视角的已知表同时更新（AI 不作弊）
  private junqiReveal(indexes: number[]): void {
    const next = this.junqiKnown.slice()
    indexes.forEach((i: number) => {
      if (i >= 0 && i < 60) next[i] = true
    })
    this.junqiKnown = next
    indexes.forEach((i: number) => {
      if (i >= 0 && i < 60) this.junqiAiKnown[i] = true
    })
  }

  private junqiApplyMove(from: number, to: number): void {
    this.pushBoardHistory()
    const attacker = this.junqiBoard[from]
    if (attacker.length === 0) return
    const defender = this.junqiBoard[to]
    const aSide = this.junqiSideOf(attacker) === 'r' ? '红' : '蓝'
    this.junqiBoard[from] = ''
    let text = ''
    if (defender.length === 0) {
      this.junqiBoard[to] = attacker
      // 己方明牌要跟着棋子走，否则移动后自己人反而显示成暗子
      if (this.junqiSideOf(attacker) === 'r') {
        this.junqiKnown[to] = true
      } else {
        this.junqiAiKnown[to] = true
      }
      this.junqiKnown[from] = false
      this.junqiAiKnown[from] = false
      text = `${aSide}方${this.junqiNameOf(attacker)}移动`
    } else {
      // 暗棋：一旦交火，双方子力同时亮明——这是暗棋获取情报的唯一途径
      this.junqiReveal([from, to])
      const name = `${aSide}方${this.junqiNameOf(attacker)}`
      const aRank = this.junqiRankOf(attacker)
      const dRank = this.junqiRankOf(defender)
      const dSide = this.junqiSideOf(defender) === 'r' ? '红' : '蓝'
      const dName = `${dSide}方${this.junqiNameOf(defender)}`
      if (dRank === -2) {
        this.junqiBoard[to] = attacker
        if (this.junqiSideOf(attacker) === 'r') {
          this.junqiKnown[to] = true
        } else {
          this.junqiAiKnown[to] = true
        }
        text = `${name}夺得${dName}，获胜！🏆`
      } else if (dRank === 0 && aRank === 1) {
        this.junqiBoard[to] = attacker
        if (this.junqiSideOf(attacker) === 'r') {
          this.junqiKnown[to] = true
        } else {
          this.junqiAiKnown[to] = true
        }
        text = `${name}挖掉${dName}`
      } else if (dRank === 0) {
        text = `${name}触雷阵亡`
      } else if (dRank === -1 || aRank === -1) {
        text = `${name}与${dName}同归于尽`
      } else if (aRank > dRank) {
        this.junqiBoard[to] = attacker
        if (this.junqiSideOf(attacker) === 'r') {
          this.junqiKnown[to] = true
        } else {
          this.junqiAiKnown[to] = true
        }
        text = `${name}吃掉${dName}`
      } else if (aRank === dRank) {
        text = `${name}与${dName}对拼，双双阵亡`
      } else {
        text = `${name}进攻${dName}失败，阵亡`
      }
    }
    this.junqiSelected = -1
    if (text.indexOf('获胜') >= 0) {
      this.gameStatus = text
      return
    }
    const moverSide = this.junqiSideOf(attacker)
    const nextSide = moverSide === 'r' ? 'b' : 'r'
    this.currentPiece = nextSide === 'r' ? 1 : 2
    if (!this.junqiSideHasMove(nextSide)) {
      this.gameStatus = `${text} · ${nextSide === 'r' ? '红' : '蓝'}方无子可动，${moverSide === 'r' ? '红' : '蓝'}方获胜！🏆`
      return
    }
    this.gameStatus = `${text} · 轮到${nextSide === 'r' ? '红' : '蓝'}方`
    if (!this.aiApplying && this.roomId === '本地' && this.localAiEnabled && this.supportsLocalAi()) {
      this.scheduleLocalAi()
    }
  }

  private junqiTap(index: number): void {
    if (this.gameStatus.indexOf('获胜') >= 0) return
    if (this.roomId === '本地' && this.aiThinking) return
    const cell = this.junqiBoard[index]
    if (this.junqiSelected >= 0) {
      if (index === this.junqiSelected) {
        this.junqiSelected = -1
        this.gameStatus = '已取消选择'
        return
      }
      if (this.junqiMovesFrom(this.junqiSelected).indexOf(index) >= 0) {
        this.junqiApplyMove(this.junqiSelected, index)
        return
      }
    }
    if (cell.length > 0 && this.junqiMovable(cell)) {
      const isRed = this.junqiSideOf(cell) === 'r'
      const humanTurn = this.roomId !== '本地' || this.currentPiece === 1
      if (isRed === (this.currentPiece === 1) && humanTurn) {
        this.junqiSelected = index
        this.gameStatus = `已选${this.junqiNameOf(cell)}，金色高亮为可走点`
      }
    }
  }

  private junqiHint(): void {
    const side = this.currentPiece === 1 ? 'r' : 'b'
    for (let i = 0; i < 60; i++) {
      const cell = this.junqiBoard[i]
      if (cell.length === 0 || this.junqiSideOf(cell) !== side || !this.junqiMovable(cell)) continue
      if (this.junqiMovesFrom(i).length > 0) {
        this.junqiSelected = i
        this.gameStatus = `已选中${this.junqiNameOf(cell)}，金色高亮为可走点`
        return
      }
    }
    this.gameStatus = `${side === 'r' ? '红' : '蓝'}方没有可动的棋子`
  }

  private junqiFindFlag(side: string): number {
    for (let i = 0; i < 60; i++) {
      if (this.junqiBoard[i] === side + 'F') return i
    }
    return -1
  }

  private pickJunqiMove(): BoardMove | null {
    const side = this.currentPiece === 1 ? 'r' : 'b'
    let best: BoardMove | null = null
    let bestScore = -1.0
    for (let i = 0; i < 60; i++) {
      const cell = this.junqiBoard[i]
      if (cell.length === 0 || this.junqiSideOf(cell) !== side || !this.junqiMovable(cell)) continue
      const moves = this.junqiMovesFrom(i)
      for (let m = 0; m < moves.length; m++) {
        const dst = moves[m]
        let score = Math.random() * 2
        const target = this.junqiBoard[dst]
        if (target.length > 0) {
          const dRank = this.junqiRankOf(target)
          const aRank = this.junqiRankOf(cell)
          if (!this.junqiAiKnown[dst]) {
            // 情报不明：AI 也不知道这枚红子是什么，只能按期望值试探（不作弊）
            if (aRank === -1) {
              score += 12
            } else if (aRank === 9) {
              score += 14
            } else if (aRank === 1) {
              score += 3
            } else {
              score += 5
            }
          } else if (dRank === -2) {
            score += 1000
          } else if (dRank === 0 && aRank === 1) {
            score += 60
          } else if (dRank === 0) {
            score -= 5
          } else if (dRank === -1) {
            score += aRank >= 7 ? 30 : -10
          } else if (aRank > dRank) {
            score += 10 + dRank * 3
          } else if (aRank === dRank) {
            score += aRank >= 7 ? -8 : 4
          } else {
            score -= 6 + aRank
          }
        } else {
          // 军旗位置只有侦察到才知道，否则朝对方大本营方向推进（不作弊）
          const foe = side === 'r' ? 'b' : 'r'
          let enemyFlag = this.junqiFindFlag(foe)
          if (enemyFlag >= 0 && side === 'b' && !this.junqiAiKnown[enemyFlag]) {
            enemyFlag = 57
          }
          if (enemyFlag >= 0) {
            const dr = Math.abs(Math.floor(dst / 5) - Math.floor(enemyFlag / 5)) + Math.abs(dst % 5 - enemyFlag % 5)
            const dr0 = Math.abs(Math.floor(i / 5) - Math.floor(enemyFlag / 5)) + Math.abs(i % 5 - enemyFlag % 5)
            score += Math.max(0, dr0 - dr)
          }
        }
        if (score > bestScore) {
          bestScore = score
          const mv: BoardMove = { from: i, to: dst }
          best = mv
        }
      }
    }
    return best
  }

  private junqiBoardWidth(): number {
    const ratio = 1298.0 / 520.0
    const maxByHeight = Math.max(220, this.windowHeight * 0.78 / ratio)
    return Math.min(this.boardWidth(), Math.floor(maxByHeight))
  }
  // 象棋棋子字号：Grid 宽 92.25%、9 列 → 格宽 ≈ 棋盘宽 10.25%；
  // Grid 高 81.88%、10 行 → 格高 ≈ 8.19%。棋子取格高的 92%，
  // 字取棋子直径的 56%（实物标定）。两端夹逼，防止小屏字溢出、大屏字过小。
  private xiangqiPieceFont(): number {
    const cell = this.boardWidth() * 0.9225 / 9
    const disc = Math.min(cell, this.boardWidth() * 0.8188 / 10) * 0.92
    return Math.max(11, Math.min(30, Math.round(disc * 0.56)))
  }

  private supportsBoardStudy(): boolean {
    return this.selectedGame === 'gobang' || this.selectedGame === 'go' || this.selectedGame === 'chinese-chess'
  }

  private analysisBoard(): number[] | string[] {
    return this.selectedGame === 'chinese-chess' ? this.chessPieces : this.board
  }

  private startStudyMode(mode: string): void {
    if (!this.supportsBoardStudy() || this.roomId !== '本地') return
    this.studyMode = mode
    this.selectedCell = -1
    if (mode === 'play') {
      this.localAiEnabled = false
      this.resetBoard()
      this.studyText = '本地 AI 已就绪'
      return
    }
    if (mode === 'analysis') {
      this.localAiEnabled = false
      this.studyText = '当前棋局已复制为分析局面，不会访问网络'
      this.analyzeCurrentBoard()
      return
    }
    if (mode === 'puzzle') {
      const puzzle: PuzzlePosition = puzzlePosition(this.selectedGame)
      if (this.selectedGame === 'chinese-chess') {
        this.chessPieces = puzzle.board as string[]
      } else {
        this.board = puzzle.board as number[]
      }
      this.currentPiece = puzzle.player
      this.previousBoard = []
      this.lastMoveIndex = -1
      this.localAiEnabled = true
      this.puzzleGoal = puzzle.goal
      this.studyText = `题面已摆好，只需走下一步 · ${puzzle.title} · ${puzzle.difficulty} · ${puzzle.goal}`
      this.gameStatus = puzzle.goal
      return
    }
    this.localAiEnabled = false
    const blank = emptyBoard(this.selectedGame)
    if (this.selectedGame === 'chinese-chess') {
      this.chessPieces = blank as string[]
      this.editorChessPiece = '帥'
    } else {
      this.board = blank as number[]
      this.editorTool = '1'
    }
    this.currentPiece = 1
    this.previousBoard = []
    this.lastMoveIndex = -1
    this.studyText = '第一步选择棋子，第二步点击棋盘摆放，第三步检查并开始'
    this.gameStatus = '自建棋盘'
  }

  private analyzeCurrentBoard(): void {
    if (!this.supportsBoardStudy()) return
    const result: AnalysisResult = analyzeBoard(this.selectedGame, this.analysisBoard(), this.currentPiece,
      this.aiDifficulty, this.previousBoard)
    if (!result.recommended) {
      this.studyText = '当前没有合法着法，请检查局面或切换执棋方'
      return
    }
    const moveText = result.recommended.index !== undefined ? `第 ${result.recommended.index + 1} 点` :
      `${(result.recommended.from || 0) + 1} → ${(result.recommended.to || 0) + 1}`
    this.studyText = `${result.explanation} · 推荐 ${moveText} · 已检查 ${result.nodes} 个节点`
  }

  private resetPuzzle(): void {
    if (this.studyMode !== 'puzzle' || this.puzzleIndex < 0) return
    const puzzle: PuzzlePosition = puzzlePosition(this.selectedGame, this.puzzleIndex)
    if (this.selectedGame === 'chinese-chess') this.chessPieces = (puzzle.board as string[]).slice()
    else this.board = (puzzle.board as number[]).slice()
    this.currentPiece = puzzle.player
    this.previousBoard = []
    this.lastMoveIndex = -1
    this.studyText = `已重新开始本题 · 题面已摆好，只需走下一步 · ${puzzle.goal}`
  }

  private showPuzzleHint(): void {
    if (this.studyMode !== 'puzzle' || this.puzzleIndex < 0) return
    const puzzle: PuzzlePosition = puzzlePosition(this.selectedGame, this.puzzleIndex)
    const move: BoardMove | undefined = puzzle.solution[0]
    if (!move) return
    this.studyText = move.index !== undefined ? `提示：第 ${move.index + 1} 点` : `提示：${(move.from || 0) + 1} → ${(move.to || 0) + 1}`
  }

  private exitPuzzle(): void {
    this.studyMode = 'play'
    this.localAiEnabled = true
    this.resetBoard()
    this.studyText = '已退出残局，本地 AI 已就绪'
  }

  private applyRecommendedMove(): void {
    const move: BoardMove | null = findBestMove(this.selectedGame, this.analysisBoard(), this.currentPiece,
      this.aiDifficulty, this.previousBoard)
    if (!move) {
      this.studyText = '当前没有合法着法'
      return
    }
    this.applyLocalMove(move, false)
  }

  private applyLocalMove(move: BoardMove, byAi: boolean): boolean {
    this.pushBoardHistory()
    const before: number[] = this.selectedGame === 'go' ? (this.analysisBoard() as number[]).slice() : []
    const applied: AppliedMove = applyBoardMove(this.selectedGame, this.analysisBoard(), move, this.currentPiece,
      this.previousBoard)
    if (!applied.legal) {
      this.gameStatus = applied.message
      return false
    }
    if (this.selectedGame === 'chinese-chess') {
      this.chessPieces = applied.board as string[]
      this.lastMoveIndex = move.to === undefined ? -1 : move.to
    } else {
      this.board = applied.board as number[]
      this.lastMoveIndex = move.index === undefined ? -1 : move.index
      if (this.selectedGame === 'go') this.previousBoard = before
    }
    // winner 必须是「获胜方棋子号」（1/2），0 表示未结束。
    // 旧写法把 hasWon() 的 boolean 直接塞进 winner：false !== 0 在 JS 里恒成立，
    // 于是黑棋刚落一子就判「白方获胜」。这里显式把 boolean 折成棋子号。
    const winner: number = this.selectedGame === 'gobang' && this.lastMoveIndex >= 0 ?
      (this.hasWon(this.lastMoveIndex, this.currentPiece) ? this.currentPiece : 0) :
      (this.selectedGame === 'chinese-chess' ? (this.chessPieces.includes('帥') ? (this.chessPieces.includes('將') ? 0 : 1) : 2) : 0)
    if (winner !== 0) {
      this.gameStatus = this.selectedGame === 'chinese-chess' ? `${winner === 1 ? '红方' : '黑方'}获胜` :
        `${winner === 1 ? '黑方' : '白方'}获胜`
      return true
    }
    this.currentPiece = this.currentPiece === 1 ? 2 : 1
    const sideText = this.selectedGame === 'chinese-chess' ? (this.currentPiece === 1 ? '红方' : '黑方') :
      (this.currentPiece === 1 ? '黑方' : '白方')
    this.gameStatus = `${byAi ? 'AI 已走子' : applied.message} · 轮到${sideText}`
    return true
  }

  // 能开 AI 陪练的棋种：引擎三款（五子棋/围棋/象棋）+ 内置轻量 AI 四款
  private supportsLocalAi(): boolean {
    const game = this.selectedGame
    return this.supportsBoardStudy() || game === 'reversi' || game === 'tictactoe' ||
      game === 'checkers' || game === 'world-chess' || game === 'junqi'
  }

  // 对局模式一键切换：AI 陪练 <-> 线下多人（双人/多人同屏，无 AI）
  private setLocalAiMode(enabled: boolean): void {
    if (this.localAiEnabled === enabled) {
      return
    }
    this.localAiEnabled = enabled
    this.persistSettings()
    this.aiThinking = false
    if (!enabled) {
      this.gameStatus = '已切换：线下多人 · 同屏轮流走子，无 AI'
      return
    }
    if (!this.supportsLocalAi()) {
      this.gameStatus = '本局暂未内置 AI，可玩五子棋、围棋、象棋、黑白棋、井字棋、跳棋、国际象棋、陆战棋'
      return
    }
    this.gameStatus = '已切换：AI 陪练'
    this.runLocalAi()
  }

  private runLocalAi(): void {
    if (this.roomId !== '本地' || !this.localAiEnabled || !this.supportsLocalAi() || this.aiThinking) return
    this.aiThinking = true
    this.gameStatus = `${this.aiDifficulty} AI 正在思考…`
    setTimeout(() => {
      // 等待期间用户可能已切到“线下多人”，不能再替人走子
      if (!this.localAiEnabled) {
        this.aiThinking = false
        return
      }
      const move: BoardMove | null = this.supportsBoardStudy() ?
        findBestMove(this.selectedGame, this.analysisBoard(), this.currentPiece, this.aiDifficulty,
          this.previousBoard) :
        this.pickLightAiMove()
      this.aiThinking = false
      if (!move) {
        // 黑白棋无子可下只是跳过一轮，不是终局
        if (this.selectedGame === 'reversi' && this.reversiAdvanceTurn()) return
        this.gameStatus = 'AI 没有合法着法，本局结束'
        return
      }
      this.applyAiMove(move)
    }, 80)
  }

  private applyAiMove(move: BoardMove): void {
    if (this.supportsBoardStudy()) {
      this.applyLocalMove(move, true)
      return
    }
    this.aiApplying = true
    if (this.selectedGame === 'junqi') {
      const jf = move.from === undefined ? -1 : move.from
      const jt = move.to === undefined ? -1 : move.to
      if (jf >= 0 && jt >= 0) this.junqiApplyMove(jf, jt)
      this.aiApplying = false
      return
    }
    if (this.selectedGame === 'tictactoe' || this.selectedGame === 'reversi') {
      const index = move.index === undefined ? -1 : move.index
      if (index >= 0) {
        if (this.selectedGame === 'tictactoe') this.placeSimple(index, 3)
        else this.placeReversi(index)
      }
    } else {
      const from = move.from === undefined ? -1 : move.from
      const to = move.to === undefined ? -1 : move.to
      if (from >= 0 && to >= 0) {
        if (this.selectedGame === 'checkers') {
          this.jumpMakeMove(from, to)
          // 三人局：AI 走完若轮到另一家 AI（非红方玩家），继续托管
          if (this.currentPiece !== 1 && this.gameStatus.indexOf('获胜') < 0) {
            this.aiApplying = false
            this.scheduleLocalAi()
            return
          }
        } else if (this.selectedGame === 'world-chess') this.applyWorldChessMove(from, to)
      }
    }
    this.aiApplying = false
  }

  private scheduleLocalAi(): void {
    if (this.roomId === '本地' && this.localAiEnabled && this.supportsLocalAi() &&
      this.studyMode !== 'editor' && this.studyMode !== 'analysis') {
      this.aiThinking = true
      this.gameStatus = `${this.aiDifficulty} AI 正在思考…`
      setTimeout(() => {
        this.aiThinking = false
        this.runLocalAi()
      }, 80)
    }
  }

  // ---- 内置轻量 AI：黑白棋 / 井字棋 / 跳棋 / 国际象棋 ----

  private pickLightAiMove(): BoardMove | null {
    if (this.selectedGame === 'tictactoe') return this.pickTicTacToeMove()
    if (this.selectedGame === 'reversi') return this.pickReversiMove()
    if (this.selectedGame === 'checkers') return this.pickCheckersMove()
    if (this.selectedGame === 'world-chess') return this.pickWorldChessMove()
    if (this.selectedGame === 'junqi') return this.pickJunqiMove()
    return null
  }

  private tttWinner(b: number[], piece: number): boolean {
    const lines: number[][] = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (b[line[0]] === piece && b[line[1]] === piece && b[line[2]] === piece) return true
    }
    return false
  }

  private tttScore(b: number[], me: number, opp: number, mine: boolean, depth: number): number {
    if (this.tttWinner(b, me)) return 10 - depth
    if (this.tttWinner(b, opp)) return depth - 10
    let empty = 0
    for (let i = 0; i < 9; i++) if (b[i] === 0) empty++
    if (empty === 0) return 0
    let best = mine ? -99 : 99
    for (let i = 0; i < 9; i++) {
      if (b[i] !== 0) continue
      const next = b.slice()
      next[i] = mine ? me : opp
      const score = this.tttScore(next, me, opp, !mine, depth + 1)
      best = mine ? Math.max(best, score) : Math.min(best, score)
    }
    return best
  }

  private pickTicTacToeMove(): BoardMove | null {
    const me = this.currentPiece
    const opp = me === 1 ? 2 : 1
    const board = this.board.slice(0, 9)
    const empties: number[] = []
    for (let i = 0; i < 9; i++) if (board[i] === 0) empties.push(i)
    if (empties.length === 0) return null
    if (this.aiDifficulty === '简单') {
      // 简单：一半概率随手下，否则只做一步攻防
      if (Math.random() < 0.5) return { index: empties[Math.floor(Math.random() * empties.length)] }
    }
    for (let i = 0; i < empties.length; i++) {
      const probe = board.slice()
      probe[empties[i]] = me
      if (this.tttWinner(probe, me)) return { index: empties[i] }
    }
    for (let i = 0; i < empties.length; i++) {
      const probe = board.slice()
      probe[empties[i]] = opp
      if (this.tttWinner(probe, opp)) return { index: empties[i] }
    }
    let bestIndex = empties[0]
    let bestScore = -99
    for (let i = 0; i < empties.length; i++) {
      const probe = board.slice()
      probe[empties[i]] = me
      const score = this.tttScore(probe, me, opp, false, 0)
      if (score > bestScore) {
        bestScore = score
        bestIndex = empties[i]
      }
    }
    return { index: bestIndex }
  }

  private reversiFlips(board: number[], index: number, piece: number): number[] {
    const side = 8
    const row = Math.floor(index / side)
    const column = index % side
    const opponent = piece === 1 ? 2 : 1
    const directions: number[][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    const flips: number[] = []
    directions.forEach((direction: number[]) => {
      let r = row + direction[0]
      let c = column + direction[1]
      const captured: number[] = []
      while (r >= 0 && r < side && c >= 0 && c < side && board[r * side + c] === opponent) {
        captured.push(r * side + c)
        r += direction[0]
        c += direction[1]
      }
      if (captured.length > 0 && r >= 0 && r < side && c >= 0 && c < side && board[r * side + c] === piece) {
        captured.forEach((capturedIndex: number) => flips.push(capturedIndex))
      }
    })
    return flips
  }

  private pickReversiMove(): BoardMove | null {
    const piece = this.currentPiece
    const board = this.board
    const corners: number[] = [0, 7, 56, 63]
    const cSquares: number[] = [1, 6, 8, 9, 14, 15, 48, 49, 54, 55, 62]
    const candidates: number[] = []
    for (let i = 0; i < 64; i++) {
      if (board[i] !== 0) continue
      if (this.reversiFlips(board, i, piece).length > 0) candidates.push(i)
    }
    if (candidates.length === 0) return null
    const freeCorners: number[] = []
    corners.forEach((corner: number) => {
      if (board[corner] === 0) freeCorners.push(corner)
    })
    for (let i = 0; i < freeCorners.length; i++) {
      if (candidates.includes(freeCorners[i])) return { index: freeCorners[i] }
    }
    let bestIndex = candidates[0]
    let bestValue = -9999
    candidates.forEach((index: number) => {
      let value = this.reversiFlips(board, index, piece).length
      const row = Math.floor(index / 8)
      const column = index % 8
      if (row === 0 || row === 7 || column === 0 || column === 7) value += 4
      if (cSquares.includes(index)) value -= 6
      if (this.aiDifficulty === '简单') value = Math.floor(value / 3)
      if (value > bestValue) {
        bestValue = value
        bestIndex = index
      }
    })
    return { index: bestIndex }
  }

  // ===== 中国跳棋（六角星 121 孔，三人对弈：1红 2黄 3蓝） =====
  // 17 行网格：相邻行错开半格，孔间六邻接；行起点/孔数与 scripts/gen_jump_board.py 同源
  private readonly jumpRowStart: number[] =
    [0, -0.5, -1, -1.5, -6, -5.5, -5, -4.5, -4, -4.5, -5, -5.5, -6, -1.5, -1, -0.5, 0]
  private readonly jumpRowCount: number[] =
    [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]
  // 起始角（红=顶、黄=左下、蓝=右下），目标角为正对面（隔 180°）
  private readonly jumpHomes: number[][] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [65, 75, 76, 86, 87, 88, 98, 99, 100, 101],
    [74, 84, 85, 95, 96, 97, 107, 108, 109, 110]
  ]
  private readonly jumpGoals: number[][] = [
    [111, 112, 113, 114, 115, 116, 117, 118, 119, 120],
    [19, 20, 21, 22, 32, 33, 34, 44, 45, 55],
    [10, 11, 12, 13, 23, 24, 25, 35, 36, 46]
  ]
  private jumpIndexRow: number[] = []
  private jumpIndexUx: number[] = []
  private jumpNeighbors: number[][] = []
  private jumpGridReady: boolean = false
  // 121 孔中心坐标（百分比），与 scripts/gen_jump_board.py 生成的 jump_board.png 同源
  private readonly jumpPosX: number[] = [50.0, 46.32, 53.68, 42.65, 50.0, 57.35, 38.97, 46.32, 53.68, 61.03, 5.88, 13.24, 20.59, 27.94, 35.29, 42.65, 50.0, 57.35, 64.71, 72.06, 79.41, 86.76, 94.12, 9.56, 16.91, 24.26, 31.62, 38.97, 46.32, 53.68, 61.03, 68.38, 75.74, 83.09, 90.44, 13.24, 20.59, 27.94, 35.29, 42.65, 50.0, 57.35, 64.71, 72.06, 79.41, 86.76, 16.91, 24.26, 31.62, 38.97, 46.32, 53.68, 61.03, 68.38, 75.74, 83.09, 20.59, 27.94, 35.29, 42.65, 50.0, 57.35, 64.71, 72.06, 79.41, 16.91, 24.26, 31.62, 38.97, 46.32, 53.68, 61.03, 68.38, 75.74, 83.09, 13.24, 20.59, 27.94, 35.29, 42.65, 50.0, 57.35, 64.71, 72.06, 79.41, 86.76, 9.56, 16.91, 24.26, 31.62, 38.97, 46.32, 53.68, 61.03, 68.38, 75.74, 83.09, 90.44, 5.88, 13.24, 20.59, 27.94, 35.29, 42.65, 50.0, 57.35, 64.71, 72.06, 79.41, 86.76, 94.12, 38.97, 46.32, 53.68, 61.03, 42.65, 50.0, 57.35, 46.32, 53.68, 50.0]
  private readonly jumpPosY: number[] = [5.02, 10.46, 10.46, 15.9, 15.9, 15.9, 21.33, 21.33, 21.33, 21.33, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 26.77, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 32.21, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 37.64, 43.08, 43.08, 43.08, 43.08, 43.08, 43.08, 43.08, 43.08, 43.08, 43.08, 48.52, 48.52, 48.52, 48.52, 48.52, 48.52, 48.52, 48.52, 48.52, 53.95, 53.95, 53.95, 53.95, 53.95, 53.95, 53.95, 53.95, 53.95, 53.95, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 59.39, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 64.83, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 70.26, 75.7, 75.7, 75.7, 75.7, 81.14, 81.14, 81.14, 86.57, 86.57, 92.01]

  private jumpBuildGrid(): void {
    if (this.jumpGridReady) return
    this.jumpGridReady = true
    this.jumpIndexRow = []
    this.jumpIndexUx = []
    for (let r = 0; r < 17; r++) {
      for (let c = 0; c < this.jumpRowCount[r]; c++) {
        this.jumpIndexRow.push(r)
        this.jumpIndexUx.push(this.jumpRowStart[r] + c)
      }
    }
    this.jumpNeighbors = []
    for (let i = 0; i < 121; i++) {
      const list: number[] = []
      for (let j = 0; j < 121; j++) {
        if (i === j) continue
        const dr = Math.abs(this.jumpIndexRow[i] - this.jumpIndexRow[j])
        const dx = Math.abs(this.jumpIndexUx[i] - this.jumpIndexUx[j])
        if ((dr === 0 && Math.abs(dx - 1) < 0.01) || (dr === 1 && Math.abs(dx - 0.5) < 0.01)) list.push(j)
      }
      this.jumpNeighbors.push(list)
    }
  }

  // 从 from 出发的全部落点：正交一步 + 任意长度连跳（跳过相邻 1 子）
  // 目标区约束：已在对面营地内的子不许再离开营地
  private jumpReachable(from: number, piece: number): number[] {
    this.jumpBuildGrid()
    const board = this.jumpBoard
    const goal = this.jumpGoals[piece - 1]
    const inGoal = goal.indexOf(from) >= 0
    const out: number[] = []
    const seen: boolean[] = Array(121).fill(false)
    seen[from] = true
    this.jumpNeighbors[from].forEach((n: number) => {
      if (board[n] === 0 && (!inGoal || goal.indexOf(n) >= 0)) {
        out.push(n)
        seen[n] = true
      }
    })
    const queue: number[] = [from]
    let head = 0
    while (head < queue.length) {
      const cur = queue[head]
      head += 1
      this.jumpNeighbors[cur].forEach((mid: number) => {
        if (board[mid] === 0) return
        const landRow = 2 * this.jumpIndexRow[mid] - this.jumpIndexRow[cur]
        const landUx = 2 * this.jumpIndexUx[mid] - this.jumpIndexUx[cur]
        if (landRow < 0 || landRow > 16) return
        for (let land = 0; land < 121; land++) {
          if (seen[land] || this.jumpIndexRow[land] !== landRow) continue
          if (Math.abs(this.jumpIndexUx[land] - landUx) > 0.01) continue
          if (board[land] !== 0) continue
          if (inGoal && goal.indexOf(land) < 0) break
          seen[land] = true
          out.push(land)
          queue.push(land)
          break
        }
      })
    }
    return out
  }

  private jumpGoalFull(piece: number): boolean {
    const goal = this.jumpGoals[piece - 1]
    for (let i = 0; i < goal.length; i++) {
      if (this.jumpBoard[goal[i]] !== piece) return false
    }
    return true
  }

  private jumpMakeMove(from: number, to: number): void {
    this.pushBoardHistory()
    const next = this.jumpBoard.slice()
    next[to] = next[from]
    next[from] = 0
    this.jumpBoard = next
    this.jumpSelected = -1
    this.jumpMoves = []
    this.lastMoveIndex = to
    const names: string[] = ['红方', '黄方', '蓝方']
    for (let p = 1; p <= 3; p++) {
      if (this.jumpGoalFull(p)) {
        this.gameStatus = `${names[p - 1]}率先占满对面营地，获胜！`
        return
      }
    }
    this.currentPiece = this.currentPiece === 3 ? 1 : this.currentPiece + 1
    this.gameStatus = `轮到${names[this.currentPiece - 1]}走子（点己方棋子，再点高亮位置）`
  }

  private jumpTap(index: number): void {
    if (this.roomId === '本地' && this.aiThinking) return
    if (this.jumpSelected < 0) {
      if (this.jumpBoard[index] !== this.currentPiece) return
      this.jumpSelected = index
      this.jumpMoves = this.jumpReachable(index, this.currentPiece)
      this.gameStatus = this.jumpMoves.length > 0 ? '已选棋子，高亮位置可直达（含连跳）' : '这枚棋子暂无合法走法，换一枚试试'
      return
    }
    if (index === this.jumpSelected) {
      this.jumpSelected = -1
      this.jumpMoves = []
      return
    }
    if (this.jumpBoard[index] === this.currentPiece) {
      this.jumpSelected = index
      this.jumpMoves = this.jumpReachable(index, this.currentPiece)
      return
    }
    if (this.jumpMoves.indexOf(index) >= 0) {
      this.jumpMakeMove(this.jumpSelected, index)
      if (this.gameStatus.indexOf('获胜') < 0) this.scheduleLocalAi()
      return
    }
    this.gameStatus = '只能走到高亮位置；点另一枚己方棋子可换选择'
  }

  // 中国跳棋 AI：以「目标角距离场」评分，优先缩短进营距离，优先跳占营地
  private pickCheckersMove(): BoardMove | null {
    const piece = this.currentPiece
    this.jumpBuildGrid()
    const goal = this.jumpGoals[piece - 1]
    const dist: number[] = Array(121).fill(999)
    const queue: number[] = []
    goal.forEach((g: number) => {
      dist[g] = 0
      queue.push(g)
    })
    let head = 0
    while (head < queue.length) {
      const cur = queue[head]
      head += 1
      this.jumpNeighbors[cur].forEach((n: number) => {
        if (dist[n] > dist[cur] + 1) {
          dist[n] = dist[cur] + 1
          queue.push(n)
        }
      })
    }
    let bestFrom = -1
    let bestTo = -1
    let bestValue = -9999
    for (let from = 0; from < 121; from++) {
      if (this.jumpBoard[from] !== piece) continue
      const targets = this.jumpReachable(from, piece)
      for (let t = 0; t < targets.length; t++) {
        const to = targets[t]
        let value = (dist[from] - dist[to]) * 10
        if (goal.indexOf(to) >= 0) value += 6
        value += this.aiDifficulty === '简单' ? -Math.random() * 9 : Math.random() * 2
        if (value > bestValue) {
          bestValue = value
          bestFrom = from
          bestTo = to
        }
      }
    }
    return bestFrom >= 0 ? { from: bestFrom, to: bestTo } : null
  }

  private worldChessValue(piece: string): number {
    const type = piece.slice(1)
    if (type === 'P') return 1
    if (type === 'N' || type === 'B') return 3
    if (type === 'R') return 5
    if (type === 'Q') return 9
    if (type === 'K') return 100
    return 0
  }

  private pickWorldChessMove(): BoardMove | null {
    const white = this.currentPiece === 1
    const board = this.worldChessPieces
    let bestFrom = -1
    let bestTo = -1
    let bestValue = -9999
    for (let from = 0; from < 64; from++) {
      const piece = board[from]
      if (piece.length === 0 || piece.startsWith('w') !== white) continue
      const targets = this.worldChessLegalTargets(from)
      targets.forEach((to: number) => {
        let value = 0
        const captured = board[to]
        if (captured.length > 0) value += 8 + this.worldChessValue(captured)
        const toRow = Math.floor(to / 8)
        if (piece.slice(1) === 'P') value += white ? (6 - toRow) : (toRow - 1)
        if (to === 27 || to === 28 || to === 35 || to === 36) value += 1
        value += Math.random()
        if (value > bestValue) {
          bestValue = value
          bestFrom = from
          bestTo = to
        }
      })
    }
    if (bestFrom < 0) return null
    return { from: bestFrom, to: bestTo }
  }

  private editBoardCell(index: number): void {
    if (this.studyMode !== 'editor') return
    if (this.selectedGame === 'chinese-chess') {
      const next = this.chessPieces.slice()
      next[index] = this.editorChessPiece === '清除' ? '' : this.editorChessPiece
      this.chessPieces = next
    } else {
      const next = this.board.slice()
      next[index] = this.editorTool === '0' ? 0 : Number(this.editorTool)
      this.board = next
    }
    this.studyText = '局面已修改，完成后请检查规则'
  }

  private checkEditorBoard(): void {
    const result = validateEditorState(this.selectedGame, this.analysisBoard())
    this.studyText = result.message
    if (result.valid) this.gameStatus = '自建局面可用'
  }


  private goNeighbors(index: number): number[] {
    const neighbors: number[] = []
    const row = Math.floor(index / 19)
    const column = index % 19
    if (row > 0) neighbors.push(index - 19)
    if (row < 18) neighbors.push(index + 19)
    if (column > 0) neighbors.push(index - 1)
    if (column < 18) neighbors.push(index + 1)
    return neighbors
  }

  private goGroup(start: number, board: number[]): number[] {
    const color = board[start]
    const group: number[] = []
    const queue: number[] = [start]
    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined || group.includes(current)) continue
      group.push(current)
      this.goNeighbors(current).forEach((neighbor: number) => {
        if (board[neighbor] === color && !group.includes(neighbor)) queue.push(neighbor)
      })
    }
    return group
  }

  private goHasLiberty(group: number[], board: number[]): boolean {
    for (let stone of group) {
      for (let neighbor of this.goNeighbors(stone)) {
        if (board[neighbor] === 0) return true
      }
    }
    return false
  }

  private placePiece(index: number): void {
    if (this.selectedGame !== 'gobang') return
    if (this.studyMode === 'editor') {
      this.editBoardCell(index)
      return
    }
    if (this.board[index] !== 0 || this.gameStatus.indexOf('获胜') >= 0 || this.awaitingMove || this.aiThinking) {
      return
    }
    if (this.roomId !== '本地') {
      if (this.roomStatus !== '对局中') {
        this.gameStatus = '请等待房主开始游戏'
        return
      }
      this.awaitingMove = true
      let movePayload: MovePayload = {
        type: 'move',
        index: index,
        piece: this.currentPiece
      }
      let syncPayload: SyncActionPayload = {
        roomId: this.roomId,
        action: 'move',
        data: movePayload
      }
      this.emitSocket('sync-action', syncPayload)
      this.gameStatus = '等待服务器确认'
      return
    }
    if (this.applyLocalMove({ index: index }, false) && this.gameStatus.indexOf('获胜') < 0) this.scheduleLocalAi()
  }

  private placeSimple(index: number, side: number): void {
    if (this.board[index] !== 0 || this.awaitingMove) return
    this.pushBoardHistory()
    const next = this.board.slice()
    next[index] = this.currentPiece
    this.board = next
    this.lastMoveIndex = index
    if (this.selectedGame === 'tictactoe' && this.simpleWon(index, side, this.currentPiece)) {
      this.gameStatus = this.currentPiece === 1 ? '先手获胜' : '后手获胜'
      return
    }
    this.currentPiece = this.currentPiece === 1 ? 2 : 1
    this.gameStatus = this.currentPiece === 1 ? '轮到先手' : '轮到后手'
    if (this.selectedGame === 'tictactoe' && !this.aiApplying && this.roomId === '本地' &&
      this.localAiEnabled && this.supportsLocalAi() && this.gameStatus.indexOf('获胜') < 0) {
      this.scheduleLocalAi()
    }
  }

  private simpleWon(index: number, side: number, piece: number): boolean {
    const row = Math.floor(index / side)
    const column = index % side
    let rowWon = true
    let columnWon = true
    for (let cursor = 0; cursor < side; cursor++) {
      rowWon = rowWon && this.board[row * side + cursor] === piece
      columnWon = columnWon && this.board[cursor * side + column] === piece
    }
    let diagonalWon = row === column
    let reverseWon = row + column === side - 1
    for (let cursor = 0; cursor < side; cursor++) {
      diagonalWon = diagonalWon && this.board[cursor * side + cursor] === piece
      reverseWon = reverseWon && this.board[cursor * side + (side - cursor - 1)] === piece
    }
    return rowWon || columnWon || diagonalWon || reverseWon
  }

  private placeReversi(index: number): void {
    if (this.board[index] !== 0 || this.gameStatus.indexOf('终局') >= 0) return
    this.pushBoardHistory()
    const side = 8
    const row = Math.floor(index / side)
    const column = index % side
    const opponent = this.currentPiece === 1 ? 2 : 1
    const next = this.board.slice()
    let changed = false
    const directions: number[][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    directions.forEach((direction: number[]) => {
      let r = row + direction[0]
      let c = column + direction[1]
      const captured: number[] = []
      while (r >= 0 && r < side && c >= 0 && c < side && next[r * side + c] === opponent) {
        captured.push(r * side + c)
        r += direction[0]
        c += direction[1]
      }
      if (captured.length > 0 && r >= 0 && r < side && c >= 0 && c < side && next[r * side + c] === this.currentPiece) {
        captured.forEach((capturedIndex: number) => next[capturedIndex] = this.currentPiece)
        changed = true
      }
    })
    if (!changed) {
      this.gameStatus = '这里不能落子，需要夹住对方棋子'
      return
    }
    next[index] = this.currentPiece
    this.board = next
    this.lastMoveIndex = index
    this.currentPiece = opponent
    if (!this.reversiAdvanceTurn()) return
    if (!this.aiApplying && this.roomId === '本地' && this.localAiEnabled && this.supportsLocalAi()) {
      this.scheduleLocalAi()
    }
  }

  // 某一步落子后判断：有子可下则轮到该方，无子可下自动跳过，双方都无子可下则终局计数
  private reversiHasMove(piece: number): boolean {
    for (let i = 0; i < 64; i++) {
      if (this.board[i] !== 0) continue
      if (this.reversiFlips(this.board, i, piece).length > 0) return true
    }
    return false
  }

  private reversiAdvanceTurn(): boolean {
    if (this.reversiHasMove(this.currentPiece)) {
      this.gameStatus = this.currentPiece === 1 ? '轮到黑方' : '轮到白方'
      return true
    }
    const other = this.currentPiece === 1 ? 2 : 1
    if (this.reversiHasMove(other)) {
      this.gameStatus = `${this.currentPiece === 1 ? '黑' : '白'}方无子可下，自动跳过一轮`
      this.currentPiece = other
      return true
    }
    let black = 0
    let white = 0
    for (let i = 0; i < 64; i++) {
      if (this.board[i] === 1) black += 1
      if (this.board[i] === 2) white += 1
    }
    this.gameStatus = black === white ?
      `终局：双方各 ${black} 子，平局` :
      (black > white ? `终局：黑方 ${black} : ${white} 获胜` : `终局：白方 ${white} : ${black} 获胜`)
    return false
  }

  private placeGo(index: number): void {
    this.pushBoardHistory()
    if (this.studyMode === 'editor') {
      this.editBoardCell(index)
      return
    }
    if (this.awaitingMove || this.aiThinking) return
    if (this.applyLocalMove({ index: index }, false)) this.scheduleLocalAi()
  }

  private moveChess(index: number): void {
    this.pushBoardHistory()
    if (this.studyMode === 'editor') {
      this.editBoardCell(index)
      return
    }
    const piece = this.chessPieces[index]
    if (this.selectedCell < 0) {
      if (piece.length === 0 || (this.roomId === '本地' && this.aiThinking)) return
      this.selectedCell = index
      this.gameStatus = `已选 ${piece}，点目标位置移动`
      return
    }
    if (index === this.selectedCell) {
      this.selectedCell = -1
      this.gameStatus = '已取消选择'
      return
    }
    const from = this.selectedCell
    this.selectedCell = -1
    if (this.applyLocalMove({ from: from, to: index }, false) && this.gameStatus.indexOf('获胜') < 0) this.scheduleLocalAi()
  }

  // 白方用空心字形（U+2654 起）、黑方用实心字形（U+265A 起），
  // 否则白子在浅色格上是"白字+深阴影"，视觉上像黑子。
  private worldChessGlyph(piece: string): string {
    const type = piece.slice(1)
    const offset = type === 'K' ? 0 : type === 'Q' ? 1 : type === 'R' ? 2 : type === 'B' ? 3 : type === 'N' ? 4 : 5
    return String.fromCharCode((piece.startsWith('w') ? 0x2654 : 0x265A) + offset)
  }

  private worldChessAttacked(board: string[], index: number, byWhite: boolean): boolean {
    const row = Math.floor(index / 8)
    const col = index % 8
    const pre = byWhite ? 'w' : 'b'
    const pawnRow = byWhite ? row + 1 : row - 1
    for (let dc = -1; dc <= 1; dc += 2) {
      const c = col + dc
      if (pawnRow >= 0 && pawnRow < 8 && c >= 0 && c < 8 && board[pawnRow * 8 + c] === pre + 'P') {
        return true
      }
    }
    const knightDeltas: number[][] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
    for (const d of knightDeltas) {
      const r = row + d[0]
      const c = col + d[1]
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === pre + 'N') return true
    }
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = row + dr
        const c = col + dc
        if (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === pre + 'K') return true
      }
    }
    const rookDirs: number[][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    const bishopDirs: number[][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    for (const d of rookDirs) {
      let r = row + d[0]
      let c = col + d[1]
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r * 8 + c]
        if (p.length > 0) {
          if (p === pre + 'R' || p === pre + 'Q') return true
          break
        }
        r += d[0]
        c += d[1]
      }
    }
    for (const d of bishopDirs) {
      let r = row + d[0]
      let c = col + d[1]
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r * 8 + c]
        if (p.length > 0) {
          if (p === pre + 'B' || p === pre + 'Q') return true
          break
        }
        r += d[0]
        c += d[1]
      }
    }
    return false
  }

  private worldChessPseudo(board: string[], index: number): number[] {
    const piece = board[index]
    if (piece.length === 0) return []
    const white = piece.startsWith('w')
    const type = piece.slice(1)
    const row = Math.floor(index / 8)
    const col = index % 8
    const enemy = white ? 'b' : 'w'
    const moves: number[] = []
    const push = (r: number, c: number): void => {
      if (r < 0 || r > 7 || c < 0 || c > 7) return
      const t = board[r * 8 + c]
      if (t.length === 0 || t.startsWith(enemy)) moves.push(r * 8 + c)
    }
    const slide = (dirs: number[][]): void => {
      for (const d of dirs) {
        let r = row + d[0]
        let c = col + d[1]
        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const t = board[r * 8 + c]
          if (t.length === 0) {
            moves.push(r * 8 + c)
          } else {
            if (t.startsWith(enemy)) moves.push(r * 8 + c)
            break
          }
          r += d[0]
          c += d[1]
        }
      }
    }
    if (type === 'P') {
      const dir = white ? -1 : 1
      const startRow = white ? 6 : 1
      const one = (row + dir) * 8 + col
      if (row + dir >= 0 && row + dir < 8 && board[one].length === 0) {
        moves.push(one)
        const two = (row + 2 * dir) * 8 + col
        if (row === startRow && board[two].length === 0) moves.push(two)
      }
      for (let dc = -1; dc <= 1; dc += 2) {
        const r = row + dir
        const c = col + dc
        if (r < 0 || r > 7 || c < 0 || c > 7) continue
        const t = board[r * 8 + c]
        if (t.length > 0 && t.startsWith(enemy)) moves.push(r * 8 + c)
        else if (r * 8 + c === this.worldChessEp && t.length === 0) moves.push(r * 8 + c)
      }
    } else if (type === 'N') {
      const deltas: number[][] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
      for (const d of deltas) push(row + d[0], col + d[1])
    } else if (type === 'B') {
      slide([[-1, -1], [-1, 1], [1, -1], [1, 1]])
    } else if (type === 'R') {
      slide([[-1, 0], [1, 0], [0, -1], [0, 1]])
    } else if (type === 'Q') {
      slide([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]])
    } else if (type === 'K') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          push(row + dr, col + dc)
        }
      }
    }
    return moves
  }

  private worldChessKingIndex(board: string[], white: boolean): number {
    const target = white ? 'wK' : 'bK'
    for (let index = 0; index < 64; index++) {
      if (board[index] === target) return index
    }
    return -1
  }

  private worldChessLegalTargets(index: number): number[] {
    const board = this.worldChessPieces
    const piece = board[index]
    if (piece.length === 0) return []
    const white = piece.startsWith('w')
    const candidates = this.worldChessPseudo(board, index)
    const result: number[] = []
    for (const to of candidates) {
      const next = board.slice()
      const moving = next[index]
      const isPawn = moving === 'wP' || moving === 'bP'
      const isEpCapture = isPawn && to === this.worldChessEp && next[to].length === 0
      next[to] = moving
      next[index] = ''
      if (isEpCapture) {
        const capRow = Math.floor(index / 8)
        next[capRow * 8 + (to % 8)] = ''
      }
      const king = this.worldChessKingIndex(next, white)
      if (king >= 0 && !this.worldChessAttacked(next, king, !white)) result.push(to)
    }
    // 王车易位
    if (piece === 'wK' && index === 60) {
      if (this.worldChessRights.includes('K') && board[61].length === 0 && board[62].length === 0 && board[63] === 'wR') {
        if (!this.worldChessAttacked(board, 60, false) && !this.worldChessAttacked(board, 61, false) && !this.worldChessAttacked(board, 62, false)) result.push(62)
      }
      if (this.worldChessRights.includes('Q') && board[59].length === 0 && board[58].length === 0 && board[57].length === 0 && board[56] === 'wR') {
        if (!this.worldChessAttacked(board, 60, false) && !this.worldChessAttacked(board, 59, false) && !this.worldChessAttacked(board, 58, false)) result.push(58)
      }
    }
    if (piece === 'bK' && index === 4) {
      if (this.worldChessRights.includes('k') && board[5].length === 0 && board[6].length === 0 && board[7] === 'bR') {
        if (!this.worldChessAttacked(board, 4, true) && !this.worldChessAttacked(board, 5, true) && !this.worldChessAttacked(board, 6, true)) result.push(6)
      }
      if (this.worldChessRights.includes('q') && board[3].length === 0 && board[2].length === 0 && board[1].length === 0 && board[0] === 'bR') {
        if (!this.worldChessAttacked(board, 4, true) && !this.worldChessAttacked(board, 3, true) && !this.worldChessAttacked(board, 2, true)) result.push(2)
      }
    }
    return result
  }

  private worldChessSideHasMove(white: boolean): boolean {
    for (let index = 0; index < 64; index++) {
      const piece = this.worldChessPieces[index]
      if (piece.length === 0) continue
      if (piece.startsWith('w') !== white) continue
      if (this.worldChessLegalTargets(index).length > 0) return true
    }
    return false
  }

  private moveWorldChess(index: number): void {
    if (this.selectedGame !== 'world-chess') return
    const piece = this.worldChessPieces[index]
    if (this.selectedCell < 0) {
      if (piece.length === 0) return
      if (this.roomId === '本地' && this.aiThinking) return
      if (piece.startsWith('w') !== (this.currentPiece === 1)) {
        this.gameStatus = this.currentPiece === 1 ? '轮到白方行棋' : '轮到黑方行棋'
        return
      }
      this.selectedCell = index
      this.gameStatus = `已选 ${piece.slice(1) === 'P' ? '兵' : piece.slice(1)}，选择落点`
      return
    }
    if (index === this.selectedCell) {
      this.selectedCell = -1
      this.gameStatus = '已取消选择'
      return
    }
    const from = this.selectedCell
    const moving = this.worldChessPieces[from]
    const white = moving.startsWith('w')
    if (piece.length > 0 && piece.startsWith('w') === white) {
      this.selectedCell = index
      this.gameStatus = '已切换所选棋子'
      return
    }
    if (!this.applyWorldChessMove(from, index)) return
    this.selectedCell = -1
    if (!this.aiApplying && this.roomId === '本地' && this.localAiEnabled && this.supportsLocalAi() &&
      this.gameStatus.indexOf('获胜') < 0 && this.gameStatus.indexOf('将死') < 0) {
      this.scheduleLocalAi()
    }
  }

  // 国际象棋走子的唯一实现：玩家点击与 AI 共用一套规则
  private applyWorldChessMove(from: number, index: number): boolean {
    this.pushBoardHistory()
    const moving = this.worldChessPieces[from]
    const white = moving.startsWith('w')
    const targets = this.worldChessLegalTargets(from)
    if (!targets.includes(index)) {
      this.gameStatus = '该落点不合规则（会导致被将军或走法不合法）'
      return false
    }
    const next = this.worldChessPieces.slice()
    const isPawn = moving === 'wP' || moving === 'bP'
    const isEpCapture = isPawn && index === this.worldChessEp && next[index].length === 0
    next[index] = moving
    next[from] = ''
    if (isEpCapture) {
      const capRow = Math.floor(from / 8)
      next[capRow * 8 + (index % 8)] = ''
    }
    // 王车易位：移动对应的车
    if (moving === 'wK' && from === 60 && index === 62) {
      next[63] = ''
      next[61] = 'wR'
    }
    if (moving === 'wK' && from === 60 && index === 58) {
      next[56] = ''
      next[59] = 'wR'
    }
    if (moving === 'bK' && from === 4 && index === 6) {
      next[7] = ''
      next[5] = 'bR'
    }
    if (moving === 'bK' && from === 4 && index === 2) {
      next[0] = ''
      next[3] = 'bR'
    }
    // 升变：到底线自动升变为后
    const toRow = Math.floor(index / 8)
    if (moving === 'wP' && toRow === 0) next[index] = 'wQ'
    if (moving === 'bP' && toRow === 7) next[index] = 'bQ'
    // 记录吃过路兵目标格
    if (isPawn && Math.abs(toRow - Math.floor(from / 8)) === 2) {
      this.worldChessEp = (Math.floor(from / 8) + (white ? -1 : 1)) * 8 + (index % 8)
    } else {
      this.worldChessEp = -1
    }
    // 更新易位权
    if (moving === 'wK') this.worldChessRights = this.worldChessRights.replace('K', '').replace('Q', '')
    if (moving === 'bK') this.worldChessRights = this.worldChessRights.replace('k', '').replace('q', '')
    if (from === 63 || index === 63) this.worldChessRights = this.worldChessRights.replace('K', '')
    if (from === 56 || index === 56) this.worldChessRights = this.worldChessRights.replace('Q', '')
    if (from === 7 || index === 7) this.worldChessRights = this.worldChessRights.replace('k', '')
    if (from === 0 || index === 0) this.worldChessRights = this.worldChessRights.replace('q', '')
    this.worldChessPieces = next
    this.selectedCell = -1
    this.currentPiece = white ? 2 : 1
    const oppWhite = !white
    const oppKing = this.worldChessKingIndex(next, oppWhite)
    const inCheck = oppKing >= 0 && this.worldChessAttacked(next, oppKing, white)
    const hasMove = this.worldChessSideHasMove(oppWhite)
    if (!hasMove) {
      if (inCheck) this.gameStatus = white ? '将死 · 白方获胜' : '将死 · 黑方获胜'
      else this.gameStatus = '逼和 · 平局'
    } else if (inCheck) {
      this.gameStatus = white ? '将军！黑方行棋' : '将军！白方行棋'
    } else {
      this.gameStatus = white ? '黑方行棋' : '白方行棋'
    }
    return true
  }

  // ---------- 拉密（Rummikub）完整规则 ----------
  // 牌编码：color*20 + value（color 0-3，value 1-13）；百搭 = 100
  private rummyValueOf(tile: number): number {
    return tile === this.rummyJoker ? 0 : tile % 20
  }

  private rummyColorOf(tile: number): number {
    return tile === this.rummyJoker ? -1 : Math.floor(tile / 20)
  }

  // 把百搭替换成具体牌后是否构成合法组合（顺子或刻子）
  private rummyNormalSet(tiles: number[]): boolean {
    const n = tiles.length
    if (n < 3) return false
    // 刻子：同数字、不同颜色，3-4 张
    const v0 = tiles[0] % 20
    let sameValue = true
    const colors: number[] = []
    for (let i = 0; i < n; i++) {
      if (tiles[i] % 20 !== v0) {
        sameValue = false
        break
      }
      if (colors.indexOf(Math.floor(tiles[i] / 20)) >= 0) {
        sameValue = false
        break
      }
      colors.push(Math.floor(tiles[i] / 20))
    }
    if (sameValue && n <= 4) return true
    // 顺子：同色、连续、3-13 张
    const c0 = Math.floor(tiles[0] / 20)
    const values: number[] = []
    for (let i = 0; i < n; i++) {
      if (Math.floor(tiles[i] / 20) !== c0) return false
      values.push(tiles[i] % 20)
    }
    values.sort((a: number, b: number) => a - b)
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) return false
    }
    return values.length >= 3 && values.length <= 13
  }

  // 含百搭时枚举百搭可能的牌（1-13 × 4 色）来判定
  private rummyValidSet(tiles: number[]): boolean {
    if (tiles.length < 3 || tiles.length > 13) return false
    const jokers = tiles.filter((t: number) => t === this.rummyJoker)
    if (jokers.length > 1) return false
    if (jokers.length === 0) return this.rummyNormalSet(tiles)
    const rest = tiles.filter((t: number) => t !== this.rummyJoker)
    for (let color = 0; color < 4; color++) {
      for (let value = 1; value <= 13; value++) {
        const candidate = rest.concat([color * 20 + value])
        if (this.rummyNormalSet(candidate)) return true
      }
    }
    return false
  }

  // 组合分数（百搭按它替代的牌计分）
  private rummyScoreOf(tiles: number[]): number {
    const jokers = tiles.filter((t: number) => t === this.rummyJoker)
    const rest = tiles.filter((t: number) => t !== this.rummyJoker)
    if (jokers.length === 0) {
      let sum = 0
      rest.forEach((t: number) => sum += t % 20)
      return sum
    }
    let best = 0
    for (let color = 0; color < 4; color++) {
      for (let value = 1; value <= 13; value++) {
        const candidate = rest.concat([color * 20 + value])
        if (this.rummyNormalSet(candidate)) {
          let sum = 0
          candidate.forEach((t: number) => sum += t % 20)
          if (sum > best) best = sum
        }
      }
    }
    return best
  }

  private rummyPickedTiles(): number[] {
    // 目前支持一次出一张或多张（多张需连选，用 rummyPending 暂存）
    return this.rummyPending.length > 0 ? this.rummyPending[this.rummyPending.length - 1] : []
  }

  // 选中手牌：已选中的再次点击表示加入/移出待出牌组
  private rummyPick(index: number): void {
    if (this.rummyTurn !== 0 || this.rummyWinner >= 0) return
    const tile = this.rummyHand[index]
    if (this.rummyPending.length === 0) {
      this.rummyPending = [[tile]]
      this.selectedTile = index
      this.rummyLog = `已选 ${this.tileLabel(tile)}，可「出新组合」或「并入组合」`
      return
    }
    const last = this.rummyPending[this.rummyPending.length - 1].slice()
    const at = last.indexOf(tile)
    if (at >= 0) {
      last.splice(at, 1)
    } else {
      last.push(tile)
    }
    const next = this.rummyPending.slice(0, -1)
    this.rummyPending = next.concat([last])
    this.rummyLog = `待出 ${last.length} 张：${last.map((t: number) => this.tileLabel(t)).join(' ')}`
  }

  private rummyClearPick(): void {
    this.rummyPending = []
    this.selectedTile = -1
    this.rummySelectedSet = -1
    this.rummyLog = '已清空待出牌'
  }

  // 出成新组合
  private rummyPlayNewSet(): void {
    if (this.rummyTurn !== 0 || this.rummyWinner >= 0) return
    const picked = this.rummyPickedTiles()
    if (picked.length < 3) {
      this.rummyLog = '新组合至少要 3 张牌'
      return
    }
    if (!this.rummyValidSet(picked)) {
      this.rummyLog = '牌型不合法：需要同色连续顺子，或同数字不同色的刻子'
      return
    }
    const score = this.rummyScoreOf(picked)
    if (!this.rummyOpened && score < 30) {
      this.rummyLog = `首次出牌需 ≥30 分，这组只有 ${score} 分`
      return
    }
    const hand = this.rummyHand.slice()
    picked.forEach((t: number) => {
      const at = hand.indexOf(t)
      if (at >= 0) hand.splice(at, 1)
    })
    this.rummyHand = hand
    this.rummySets = this.rummySets.concat([picked.slice()])
    if (!this.rummyOpened) {
      this.rummyOpened = true
      this.rummyLog = `开局打出 ${score} 分，之后可自由组合`
    } else {
      this.rummyLog = `出新组合 ${score} 分`
    }
    this.rummyPending = []
    this.selectedTile = -1
    this.rummyCheckWin()
  }

  // 把待出牌并入已有组合（放头部或尾部）
  private rummyAddToSet(setIndex: number): void {
    if (this.rummyTurn !== 0 || this.rummyWinner >= 0) return
    const picked = this.rummyPickedTiles()
    if (picked.length === 0) {
      this.rummyLog = '先在牌架上选牌，再选要并入的组合'
      return
    }
    if (!this.rummyOpened) {
      const total = this.rummyScoreOf(picked) + this.rummyScoreOf(this.rummySets[setIndex])
      if (total < 30) {
        this.rummyLog = `首次出牌需 ≥30 分，并入后只有 ${total} 分`
        return
      }
    }
    const base = this.rummySets[setIndex]
    const head = picked.concat(base)
    const tail = base.concat(picked)
    let merged: number[] = []
    if (this.rummyValidSet(head)) merged = head
    else if (this.rummyValidSet(tail)) merged = tail
    if (merged.length === 0) {
      this.rummyLog = '并入后不是合法组合（只能接在顺子两端或补进刻子）'
      return
    }
    const hand = this.rummyHand.slice()
    picked.forEach((t: number) => {
      const at = hand.indexOf(t)
      if (at >= 0) hand.splice(at, 1)
    })
    this.rummyHand = hand
    const sets = this.rummySets.slice()
    sets[setIndex] = merged
    this.rummySets = sets
    this.rummyOpened = true
    this.rummyLog = `已并入组合 ${setIndex + 1}，共 ${merged.length} 张`
    this.rummyPending = []
    this.selectedTile = -1
    this.rummySelectedSet = -1
    this.rummyCheckWin()
  }

  // 摸牌并结束本回合（本回合没出牌时必须摸一张）
  private drawRummyTile(): void {
    if (this.rummyTurn !== 0 || this.rummyWinner >= 0) return
    this.rummyPending = []
    this.selectedTile = -1
    if (this.rummyDeck.length === 0) {
      this.rummyLog = '牌堆已空，本局结束'
      this.rummyEndGameByCount()
      return
    }
    const tile = this.rummyDeck[0]
    this.rummyDeck = this.rummyDeck.slice(1)
    this.rummyDeckCount = this.rummyDeck.length
    this.rummyHand = this.rummyHand.concat([tile])
    this.rummyLog = `摸到 ${this.tileLabel(tile)}，轮到对手`
    this.rummyTurn = 1
    this.rummyAiLoop(1)
  }

  private rummyEndGameByCount(): void {
    let best = 0
    let bestCount = this.rummyHand.length
    for (let i = 0; i < 2; i++) {
      if (this.rummyAiHands[i].length < bestCount) {
        bestCount = this.rummyAiHands[i].length
        best = i + 1
      }
    }
    this.rummyWinner = best
    this.gameStatus = best === 0 ? `牌堆摸完 · 你手牌最少（${this.rummyHand.length} 张）获胜！🏆` :
      `牌堆摸完 · 对手 ${best} 手牌最少（${bestCount} 张）获胜`
  }

  private rummyCheckWin(): void {
    if (this.rummyHand.length === 0) {
      this.rummyWinner = 0
      this.gameStatus = '你出完了所有牌，获胜！🏆'
      return
    }
  }

  // AI 回合：先尝试出牌（贪心枚举），否则摸一张
  private rummyAiLoop(seat: number): void {
    if (seat > 2 || this.rummyWinner >= 0) {
      this.rummyTurn = 0
      return
    }
    setTimeout(() => {
      if (this.rummyWinner >= 0) return
      this.rummyAiAct(seat)
      const next = seat + 1
      if (this.rummyWinner >= 0) return
      if (next > 2) {
        this.rummyTurn = 0
        this.rummyLog = '轮到你了'
      } else {
        this.rummyTurn = next
        this.rummyAiLoop(next)
      }
    }, 550)
  }

  private rummyAiAct(seat: number): void {
    const idx = seat - 1
    const hand = this.rummyAiHands[idx].slice()
    let played = false
    // 1) 尝试并入桌面已有组合
    for (let s = 0; s < this.rummySets.length && !played; s++) {
      for (let i = 0; i < hand.length && !played; i++) {
        const base = this.rummySets[s]
        const head = [hand[i]].concat(base)
        const tail = base.concat([hand[i]])
        if (this.rummyValidSet(head) || this.rummyValidSet(tail)) {
          if (!this.rummyOpened) {
            const total = this.rummyScoreOf([hand[i]]) + this.rummyScoreOf(base)
            if (total < 30) continue
          }
          this.rummySets = this.rummySets.map((set: number[], at: number) =>
            at === s ? (this.rummyValidSet(head) ? head : tail) : set)
          hand.splice(i, 1)
          this.rummyOpened = true
          played = true
        }
      }
    }
    // 2) 尝试从手牌里凑出新组合（枚举 3-5 张的组合）
    if (!played) {
      const found = this.rummyAiFindSet(hand)
      if (found.length >= 3 && (!this.rummyOpened ? this.rummyScoreOf(found) >= 30 : true)) {
        found.forEach((t: number) => {
          const at = hand.indexOf(t)
          if (at >= 0) hand.splice(at, 1)
        })
        this.rummySets = this.rummySets.concat([found])
        this.rummyOpened = true
        played = true
        this.rummyLog = `对手 ${seat} 打出一组 ${found.length} 张`
      }
    }
    // 3) 都不行就摸牌
    if (!played && this.rummyDeck.length > 0) {
      hand.push(this.rummyDeck[0])
      this.rummyDeck = this.rummyDeck.slice(1)
      this.rummyDeckCount = this.rummyDeck.length
    }
    this.rummyAiHands[idx] = hand
    const counts = this.rummyAiCounts.slice()
    counts[idx] = hand.length
    this.rummyAiCounts = counts
    if (hand.length === 0) {
      this.rummyWinner = seat
      this.gameStatus = `对手 ${seat} 出完了所有牌，本局结束`
    }
  }

  // 从 AI 手牌里贪心找出一组合法组合
  private rummyAiFindSet(hand: number[]): number[] {
    for (let size = 5; size >= 3; size--) {
      for (let i = 0; i < hand.length; i++) {
        const pick: number[] = [hand[i]]
        const color = this.rummyColorOf(hand[i])
        const value = this.rummyValueOf(hand[i])
        // 顺子：同色连续
        if (color >= 0) {
          for (let step = 1; step < size; step++) {
            const want = color * 20 + (value + step)
            const at = hand.indexOf(want)
            if (at < 0) break
            pick.push(want)
          }
          if (pick.length === size && this.rummyValidSet(pick)) return pick
        }
        // 刻子：同数字不同色
        const group: number[] = [hand[i]]
        for (let c = 0; c < 4; c++) {
          const want = c * 20 + value
          if (want === hand[i]) continue
          if (hand.indexOf(want) >= 0 && group.indexOf(want) < 0) group.push(want)
        }
        if (group.length === size && this.rummyValidSet(group)) return group
      }
    }
    return []
  }

  // 掷骰后玩家可自行选择走哪架飞机：先列出所有合法走法
  private ludoLegalMoves(player: number, dice: number): number[] {
    const pieces = this.ludoPieces[player]
    const out: number[] = []
    for (let i = 0; i < 4; i++) {
      const p = pieces[i]
      if (p === 56) {
        continue
      }
      if (p < 0 && dice !== 6) {
        continue
      }
      out.push(i)
    }
    return out
  }

  private rollLudoDice(): void {
    // AI 陪练：只有红家（玩家）掷骰；线下多人：四家轮流由人掷骰
    if (this.ludoNeedPick || (this.localAiEnabled && this.ludoTurn !== 0)) {
      return
    }
    this.diceValue = Math.floor(Math.random() * 6) + 1
    const options = this.ludoLegalMoves(this.ludoTurn, this.diceValue)
    if (options.length === 0) {
      this.gameStatus = `${this.ludoPlayerName[this.ludoTurn]}家掷出 ${this.diceValue}，没有可动的飞机`
      this.ludoTurn = (this.ludoTurn + 1) % this.ludoPlayerCount
      this.ludoKickTurn()
      return
    }
    if (options.length === 1) {
      this.ludoCommit(this.ludoTurn, options[0])
      return
    }
    this.ludoOptions = options
    this.ludoNeedPick = true
    this.gameStatus = `${this.ludoPlayerName[this.ludoTurn]}家掷出 ${this.diceValue} · 点选一架飞机移动`
  }

  // 非玩家回合的推进：AI 陪练交给 AI，线下多人提示下一位掷骰
  private ludoKickTurn(): void {
    if (this.ludoGameOver()) {
      return
    }
    if (this.ludoTurn !== 0 && this.localAiEnabled) {
      this.ludoAiLoop()
      return
    }
    if (this.ludoTurn !== 0) {
      this.gameStatus += ` · 轮到${this.ludoPlayerName[this.ludoTurn]}家掷骰`
    }
  }

  private ludoCommit(player: number, piece: number): void {
    const again = this.ludoApplyMove(player, piece, this.diceValue)
    this.ludoOptions = []
    this.ludoNeedPick = false
    if (this.ludoGameOver()) {
      return
    }
    if (again && (player === 0 || !this.localAiEnabled)) {
      this.gameStatus += ' · 掷 6 再掷一次'
      return
    }
    this.ludoTurn = (player + 1) % this.ludoPlayerCount
    if (!this.ludoGameOver()) {
      this.ludoKickTurn()
    }
  }

  // 玩家点击飞机时调用
  private ludoPlaneTap(index: number): void {
    if (!this.ludoNeedPick || this.ludoTurn !== 0) {
      return
    }
    const player = Math.floor(index / 4)
    const piece = index % 4
    if (player !== this.ludoTurn || this.ludoOptions.indexOf(piece) < 0) {
      return
    }
    this.ludoCommit(player, piece)
  }

  private ludoAiLoop(): void {
    if (this.ludoTurn === 0 || !this.localAiEnabled || this.ludoGameOver()) {
      return
    }
    setTimeout(() => {
      if (!this.localAiEnabled || this.ludoGameOver()) {
        return
      }
      const again = this.ludoTakeTurn(this.ludoTurn)
      if (again && !this.ludoGameOver()) {
        this.ludoAiLoop()
      } else if (!this.ludoGameOver()) {
        this.ludoTurn = (this.ludoTurn + 1) % this.ludoPlayerCount
        if (this.ludoTurn === 0) {
          this.gameStatus = '轮到你了 · 点「掷骰子」'
          return
        }
        this.ludoAiLoop()
      }
    }, 700)
  }

  private ludoGameOver(): boolean {
    for (let p = 0; p < this.ludoPlayerCount; p++) {
      if (this.ludoPieces[p].every((v: number) => v === 56)) {
        return true
      }
    }
    return false
  }

  private ludoCaptureAt(absCell: number, player: number): string {
    let msg = ''
    for (let opp = 0; opp < 4; opp++) {
      if (opp === player) {
        continue
      }
      const row = this.ludoPieces[opp].slice()
      let hit = false
      for (let j = 0; j < 4; j++) {
        const op = row[j]
        if (op >= 0 && op < 51 && (op + this.ludoStartOffset[opp]) % 52 === absCell) {
          row[j] = -1
          hit = true
          msg += `，撞回${this.ludoPlayerName[opp]}家第 ${j + 1} 架！`
        }
      }
      if (hit) {
        this.ludoPieces[opp] = row
      }
    }
    return msg
  }

  // 国内规则：掷 6 起飞并再掷一次；撞子回基地；落同色格连跳 4 格；超程反弹；恰好 50 到达
  private ludoTakeTurn(player: number): boolean {
    this.diceValue = Math.floor(Math.random() * 6) + 1
    const dice = this.diceValue
    const pieces = this.ludoPieces[player].slice()
    const name = this.ludoPlayerName[player]
    let best = -1
    let bestScore = -1
    for (let i = 0; i < 4; i++) {
      const p = pieces[i]
      if (p === 56) {
        continue
      }
      if (p < 0 && dice !== 6) {
        continue
      }
      let score = 0
      if (p < 0) {
        score = 1
      } else {
        let np = p + dice
        if (np > 56) {
          np = 112 - np
        }
        score = 2
        if (np < 51) {
          const abs = (np + this.ludoStartOffset[player]) % 52
          for (let opp = 0; opp < 4; opp++) {
            if (opp === player) {
              continue
            }
            for (let j = 0; j < 4; j++) {
              const op = this.ludoPieces[opp][j]
              if (op >= 0 && op < 51 && (op + this.ludoStartOffset[opp]) % 52 === abs) {
                score = 10
              }
            }
          }
          if (this.ludoRouteColor[abs] === this.ludoPlayerColor[player]) {
            score = Math.max(score, 5)
          }
        }
        if (np === 56) {
          score = 20
        }
      }
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best < 0) {
      this.gameStatus = `${name}家掷出 ${dice}，无可动飞机`
      return false
    }
    return this.ludoApplyMove(player, best, dice)
  }

  // 执行一架飞机的移动：起飞 / 前进 / 超程反弹 / 撞子 / 同色连跳 / 到达终点
  private ludoApplyMove(player: number, piece: number, dice: number): boolean {
    const name = this.ludoPlayerName[player]
    const pieces = this.ludoPieces[player].slice()
    const old = pieces[piece]
    let np: number
    let msg = ''
    if (old < 0) {
      np = 0
      msg = `${name}家第 ${piece + 1} 架起飞（掷 6）`
    } else {
      np = old + dice
      if (np > 56) {
        np = 112 - np
        msg = `${name}家第 ${piece + 1} 架超程反弹`
      } else {
        msg = `${name}家第 ${piece + 1} 架前进 ${dice} 格`
      }
    }
    if (np >= 0 && np < 51) {
      const abs = (np + this.ludoStartOffset[player]) % 52
      msg += this.ludoCaptureAt(abs, player)
      if (this.ludoRouteColor[abs] === this.ludoPlayerColor[player] && np + 4 <= 50) {
        np += 4
        msg += '，同色连跳 4 格！'
        if (np < 51) {
          msg += this.ludoCaptureAt((np + this.ludoStartOffset[player]) % 52, player)
        }
      }
    }
    if (np === 56) {
      msg += '，到达终点！'
    }
    pieces[piece] = np
    this.ludoPieces[player] = pieces
    this.gameStatus = msg
    if (pieces.every((v: number) => v === 56)) {
      this.gameStatus = `${name}家 4 架飞机全部到达终点，获胜！🏆`
      return true
    }
    return dice === 6
  }

  private startGame(): void {
    if (!this.socketActive || !this.isOwner) {
      this.gameStatus = '只有房主可以开始游戏'
      return
    }
    let payload: RoomOnlyPayload = { roomId: this.roomId }
    this.emitSocket('start-game', payload)
    this.gameStatus = '正在等待服务器开局'
  }

  private hasWon(index: number, piece: number): boolean {
    let row = Math.floor(index / 15)
    let column = index % 15
    let directions: number[][] = [[1, 0], [0, 1], [1, 1], [1, -1]]
    for (let direction of directions) {
      let count = 1
      count += this.countDirection(row, column, direction[0], direction[1], piece)
      count += this.countDirection(row, column, -direction[0], -direction[1], piece)
      if (count >= 5) {
        return true
      }
    }
    return false
  }

  private countDirection(row: number, column: number, rowStep: number, columnStep: number, piece: number): number {
    let count = 0
    let nextRow = row + rowStep
    let nextColumn = column + columnStep
    while (nextRow >= 0 && nextRow < 15 && nextColumn >= 0 && nextColumn < 15 &&
      this.board[nextRow * 15 + nextColumn] === piece) {
      count++
      nextRow += rowStep
      nextColumn += columnStep
    }
    return count
  }

  private sendChat(): void {
    let message = this.chatText.trim()
    if (message.length === 0) {
      return
    }
    if (this.roomId !== '本地') {
      let chatPayload: ChatPayload = {
        roomId: this.roomId,
        username: this.playerName,
        message: message
      }
      this.emitSocket('chat-message', chatPayload)
    } else {
      this.chatLines = [...this.chatLines, `${this.playerName}：${message}`].slice(-30)
    }
    this.chatText = ''
  }

  private voteReset(approve: boolean): void {
    if (!this.socketActive) {
      return
    }
    let payload: ResetVotePayload = { roomId: this.roomId, approve: approve }
    this.emitSocket('reset-vote', payload)
    this.resetPrompt = ''
  }

  private checkUpdate(): void {
    this.updateText = '正在检查站内最新安装包…'
    this.requestText('https://zhengzhengstudio.cn/api/apps/manifest.json', (body: string) => {
      let version = body.match(/ZhengZhengBoardGames-HarmonyOS[^"]*?v?([0-9]+\.[0-9]+\.[0-9]+)/i)
      this.latestPackage = version && version.length > 1 ? `发现版本 ${version[1]}` : '已读取站内安装清单'
      this.updateText = '未签名开发包不会直接安装；正式签名包可通过无线调试升级'
    })
  }

  private loginPassport(): void {
    if (this.passportAccount.trim().length === 0 || this.passportPassword.length === 0) {
      this.loginText = '请输入通行证账号和密码'
      return
    }
    this.loginText = '正在登录铮铮通行证…'
    let payload: PassportLoginPayload = {
      account: this.passportAccount.trim(),
      password: this.passportPassword
    }
    this.postJson('https://zhengzhengstudio.cn/api/zz-pass/login', payload, (body: string) => {
      let nickname = body.match(/"nickname":"([^"]+)"/)
      let username = body.match(/"username":"([^"]+)"/)
      let name = nickname && nickname.length > 1 ? nickname[1] : (username && username.length > 1 ? username[1] : this.passportAccount.trim())
      this.playerName = name
      this.loginText = `已登录：${name}`
      this.passportPassword = ''
    }, (message: string) => {
      this.loginText = `登录失败：${message}`
    })
  }

  private registerPassport(): void {
    let account = this.passportAccount.trim()
    if (account.length < 3 || this.passportPassword.length < 8) {
      this.loginText = '注册账号至少 3 位，密码至少 8 位'
      return
    }
    this.loginText = '正在注册铮铮通行证…'
    let payload: PassportRegisterPayload = {
      username: account,
      nickname: account,
      password: this.passportPassword,
      email: '',
      phone: ''
    }
    this.postJson('https://zhengzhengstudio.cn/api/auth/register', payload, () => {
      this.loginText = '注册成功，正在登录…'
      this.loginPassport()
    }, (message: string) => {
      this.loginText = `注册失败：${message}`
    })
  }

  private submitFeedback(): void {
    let message = this.feedbackText.trim()
    if (message.length === 0) {
      this.feedbackStatus = '请先输入反馈内容'
      return
    }
    this.feedbackStatus = '正在提交反馈…'
    let payload: FeedbackPayload = {
      product: 'boardgames',
      platform: 'HarmonyOS',
      version: `${this.appVersion} (${this.appBuild})`,
      account: this.playerName,
      category: '鸿蒙端体验反馈',
      message: message
    }
    this.postJson('https://zhengzhengstudio.cn/api/feedback', payload, () => {
      this.feedbackText = ''
      this.feedbackStatus = '已提交，后台可在“用户反馈”里查看'
    }, (error: string) => {
      this.feedbackStatus = `提交失败：${error}`
    })
  }

  @Builder
  TopBar() {
    Row({ space: 12 }) {
      if (this.page === 'game' || this.activeTab !== 'lobby' || this.secondaryPage.length > 0) {
        Button() {
          Row({ space: 5 }) {
            SymbolGlyph($r('sys.symbol.chevron_backward'))
              .fontSize(18)
              .fontColor([this.controlTextColor()])
            Text('返回')
              .fontSize(14)
              .fontColor(this.controlTextColor())
          }
        }
          .height(40)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .borderRadius(8)
          .onClick(() => {
            if (this.secondaryPage.length > 0) {
              this.secondaryPage = ''
            } else {
              this.page = 'lobby'
              this.activeTab = 'lobby'
            }
          })
      }
      Column({ space: 2 }) {
        Text(this.screenTitle())
          .fontSize(this.windowWidth < 520 ? 25 : 30)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text(this.activeTab === 'lobby' && this.secondaryPage.length === 0 ? '铮铮实验室 · 一台设备也能开局' : this.connectionText)
          .fontSize(12)
          .fontColor(this.mutedColor())
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      Blank()
      if (this.page === 'game') {
        Text('本地局')
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.tableInkColor())
          .padding({ left: 10, right: 10, top: 6, bottom: 6 })
          .backgroundColor(this.tableColor())
          .borderRadius(4)
      }
    }
    .width('100%')
  }

  @Builder
  GameCard(game: GameInfo) {
    Column({ space: 10 }) {
      Row() {
        Stack() {
          Image(game.icon)
            .width(38)
            .height(38)
            .objectFit(ImageFit.Contain)
        }
          .width(48)
          .height(48)
          .backgroundColor(this.darkTheme() ? '#313A35' : '#F0EEE7')
          .borderRadius(6)
        Blank()
        Text(this.selectedGame === game.id ? '已选' : game.players)
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.selectedGame === game.id ? this.tableInkColor() : this.mutedColor())
          .padding({ left: 7, right: 7, top: 4, bottom: 4 })
          .backgroundColor(this.selectedGame === game.id ? this.tableColor() : this.controlColor())
          .borderRadius(3)
      }
      .width('100%')
      Text(game.title)
        .width('100%')
        .fontSize(19)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(game.note)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
        .maxLines(1)
      Text('')
        .width(this.selectedGame === game.id ? 44 : 18)
        .height(3)
        .backgroundColor(this.selectedGame === game.id ? this.lacquerColor() : game.accent)
        .borderRadius(1)
    }
    .width('100%')
    .padding(15)
    .backgroundColor(this.selectedGame === game.id ? this.selectedCardColor() : this.cardColor())
    .border({
      width: this.selectedGame === game.id ? 2 : 0,
      color: this.selectedGame === game.id ? this.selectedBorderColor() : this.themeBorderColor()
    })
    .borderRadius(7)
    .onClick(() => this.selectGame(game))
  }

  @Builder
  Lobby() {
    Column({ space: 16 }) {
      Column({ space: 14 }) {
        Row() {
          Column({ space: 4 }) {
            Text('开始一桌')
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.textColor())
            Text(`${this.gameTitle()} · ${this.selectedGameInfo().players} · ${this.stepText()}`)
              .fontSize(13)
              .fontColor(this.mutedColor())
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Text('单机模式')
            .fontSize(12)
            .fontColor(this.accentColor())
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.controlColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(6)
        }
        .width('100%')
        Row({ space: 10 }) {
          Button('加入房间')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.accentColor())
            .fontColor('#FFFFFF')
            .borderRadius(8)
            .onClick(() => this.activeTab = 'room')
          Button('本地练习')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.localGame())
          Button() {
            SymbolGlyph($r('sys.symbol.line_viewfinder'))
              .fontSize(22)
              .fontColor([this.controlTextColor()])
          }
            .width(48)
            .height(42)
            .backgroundColor(this.controlColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .accessibilityText('扫一扫')
            .onClick(() => this.startRoomScan())
        }
        .width('100%')
        if (this.scanStatus.length > 0) {
          Text(this.scanStatus)
            .width('100%')
            .fontSize(12)
            .fontColor(this.mutedColor())
        }
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)

      Row() {
        Text('开局游戏')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Text(`当前：${this.gameTitle()}`)
          .fontSize(12)
          .fontColor(this.accentColor())
      }
      .width('100%')

      Column({ space: 10 }) {
        Row() {
          Column({ space: 3 }) {
            Text(this.gameTitle())
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.textColor())
            Text(`${this.selectedGameInfo().note} · ${this.selectedGameInfo().players}`)
              .fontSize(13)
              .fontColor(this.mutedColor())
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Text('已选')
            .fontSize(12)
            .fontColor(this.accentColor())
            .padding({ left: 9, right: 9, top: 5, bottom: 5 })
            .backgroundColor(this.positiveSurfaceColor())
            .border({ width: 1, color: this.selectedBorderColor() })
            .borderRadius(6)
        }
        .width('100%')
        Row({ space: 10 }) {
          Button('本地练习')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .borderRadius(8)
            .onClick(() => this.localGame())
          Button('联机开局')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.accentColor())
            .borderRadius(8)
            .onClick(() => this.activeTab = 'room')
        }
        .width('100%')
        Row({ space: 8 }) {
          Text('公开房间、排行榜和通行证仍在底部入口；大厅只给常用动作。')
            .layoutWeight(1)
            .fontSize(12)
            .fontColor(this.mutedColor())
          Button('快速匹配')
            .height(36)
            .backgroundColor(this.accentPressedColor())
            .borderRadius(8)
            .onClick(() => this.quickMatch())
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)

      Row() {
        Text('发现')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Text('更多功能')
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      Row({ space: 10 }) {
        Button('公开房间')
          .layoutWeight(1)
          .height(44)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => this.openSecondary('public'))
        Button('排行榜')
          .layoutWeight(1)
          .height(44)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => this.openSecondary('leaderboard'))
      }
      .width('100%')

    }
    .width('100%')
  }

  @Builder
  GameLibrary() {
    Column({ space: 16 }) {
      Column({ space: 8 }) {
        Text(this.gameTitle())
          .width('100%')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text(`${this.selectedGameInfo().note} · ${this.selectedGameInfo().players}`)
          .width('100%')
          .fontSize(13)
          .fontColor(this.mutedColor())
        Row({ space: 10 }) {
          Button('本地练习')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .borderRadius(8)
            .onClick(() => this.localGame())
          Button('联机开局')
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.accentColor())
            .borderRadius(8)
            .onClick(() => this.activeTab = 'room')
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
      Grid() {
        ForEach(this.games, (game: GameInfo) => {
          GridItem() { this.GameCard(game) }
        }, (game: GameInfo) => game.id)
      }
      .columnsTemplate(this.gameColumns())
      .columnsGap(12)
      .rowsGap(12)
      .width('100%')
    }
    .width('100%')
  }

  @Builder
  GomokuBoard() {
    Column({ space: 10 }) {
      Row() {
        Text(this.gameStatus)
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#3D2B15')
        Blank()
        Text(this.currentPiece === 1 ? '黑方' : '白方')
          .fontSize(12)
          .fontColor('#6F4F25')
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor('#F7E5B9')
          .borderRadius(6)
      }
      .width('100%')

      // 底图画线与星位，棋子叠在校准网格上。网格宽 = 首末交叉点跨度 78.2% * 15/14 = 83.79%，
      // 由 scripts/gen_board_artwork.py 同源算出（改底图必须重跑脚本，不要手改这里）。
      Stack() {
        Image(this.boardArtwork('gobang'))
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Fill)
        Grid() {
          ForEach(this.board, (piece: number, index: number) => {
            GridItem() {
              Stack() {
                if (piece !== 0) {
                  Text('')
                    .width('86%')
                    .height('86%')
                    .backgroundColor(piece === 1 ? '#111315' : '#F8F4E8')
                    .border({ width: piece === 1 ? 1 : 1.5, color: piece === 1 ? '#000000' : '#A08F72' })
                    .borderRadius(99)
                    .shadow({ radius: 8, color: '#4A4036', offsetX: 0, offsetY: 3 })
                  Text('')
                    .width('30%')
                    .height('30%')
                    .backgroundColor(piece === 1 ? '#4A4D50' : '#FFFFFF')
                    .borderRadius(99)
                    .translate({ x: -4, y: -4 })
                  if (this.lastMoveIndex === index) {
                    Text('')
                      .width('38%')
                      .height('38%')
                      .border({ width: 2, color: piece === 1 ? '#F7D36A' : '#B7791F' })
                      .borderRadius(99)
                  }
                }
              }
              .onClick(() => { if (this.confirmCell(index)) this.placePiece(index) })
            }
          }, (piece: number, index: number) => `${index}-${piece}-${this.lastMoveIndex}`)
        }
        .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
        .rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
        .width(`${(78.2 * 15 / 14).toFixed(2)}%`)
        .aspectRatio(1)
      }
      .width('100%')
      .aspectRatio(1)
    }
    .width(this.boardWidth())
    .padding(12)
    .backgroundColor('#C79243')
    .border({ width: 1, color: '#71491F' })
    .borderRadius(12)
  }

  @Builder
  ReversiBoard() {
    Stack() {
      Image(this.boardArtwork('reversi'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Fill)
      Grid() {
      ForEach(Array(64).fill(0), (_: number, index: number) => {
        GridItem() {
          Stack() {
            Text('')
              .width('100%')
              .height('100%')
              .backgroundColor('#2F7655')
              .opacity(0.72)
              .border({ width: 0.75, color: '#1D5139' })
            if (this.board[index] !== 0) {
              Text('')
                .width('72%')
                .height('72%')
                .backgroundColor(this.board[index] === 1 ? '#121513' : '#F4F1E8')
                .border({ width: 1, color: this.board[index] === 1 ? '#050605' : '#B8B2A5' })
                .borderRadius(99)
            }
          }
          .onClick(() => { if (this.confirmCell(index)) this.placeReversi(index) })
        }
      }, (_: number, index: number) => `reversi-${index}-${this.board[index]}`)
      }
      .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .width('83%')
      .aspectRatio(1)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .backgroundColor('#2F7655')
    .border({ width: 1, color: '#143D2B' })
    .borderRadius(8)
  }

  @Builder
  TicTacToeBoard() {
    Stack() {
      Image(this.boardArtwork('tictactoe'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Fill)
      Grid() {
      ForEach(Array(9).fill(0), (_: number, index: number) => {
        GridItem() {
          Text(this.board[index] === 1 ? '×' : this.board[index] === 2 ? '○' : '')
            .width('100%')
            .height('100%')
            .fontSize(this.windowWidth < 520 ? 44 : 62)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.board[index] === 1 ? '#B4473D' : '#2F6C91')
            .textAlign(TextAlign.Center)
            .backgroundColor('#F5F0E6')
            .border({ width: 1.5, color: this.themeBorderColor() })
            .onClick(() => { if (this.confirmCell(index)) this.placeSimple(index, 3) })
        }
      }, (_: number, index: number) => `tic-${index}-${this.board[index]}`)
      }
      .columnsTemplate('1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr')
      .width('86%')
      .aspectRatio(1)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .backgroundColor('#F5F0E6')
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  GoBoard() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('棋盘')
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.mutedColor())
        Button('13 路')
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .fontColor(this.goSize === 13 ? '#FFFFFF' : this.controlTextColor())
          .backgroundColor(this.goSize === 13 ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.goSize === 13 ? this.selectedBorderColor() : this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => this.setGoSize(13))
        Button('19 路')
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .fontColor(this.goSize === 19 ? '#FFFFFF' : this.controlTextColor())
          .backgroundColor(this.goSize === 19 ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.goSize === 19 ? this.selectedBorderColor() : this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => this.setGoSize(19))
      }
      .width('100%')

      // 底图画线与星位，棋子落在校准网格交叉点上。
      // 网格宽 = 首末交叉点跨度 78.2% * n/(n-1)，由 scripts/gen_board_artwork.py 同源算出
      // （13 路 84.72% / 19 路 82.54%），改底图必须重跑脚本，不要手改这里。
      Stack() {
        Image(this.boardArtwork('go'))
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Fill)
        Grid() {
          ForEach(this.board, (piece: number, index: number) => {
            GridItem() {
              Stack() {
                if (piece !== 0) {
                  Text('')
                    .width('88%')
                    .height('88%')
                    .backgroundColor(piece === 1 ? '#121412' : '#F5F1E6')
                    .borderRadius(99)
                    .shadow({ radius: 4, color: 'rgba(0,0,0,0.35)', offsetX: 1, offsetY: 2 })
                  if (this.lastMoveIndex === index) {
                    Text('')
                      .width('40%')
                      .height('40%')
                      .border({ width: 2, color: piece === 1 ? '#F7D36A' : '#B7791F' })
                      .borderRadius(99)
                  }
                }
              }
              .onClick(() => { if (this.confirmCell(index)) this.placeGo(index) })
            }
          }, (piece: number, index: number) => `go-${index}-${piece}-${this.lastMoveIndex}`)
        }
        .columnsTemplate(this.goGridTemplate())
        .rowsTemplate(this.goGridTemplate())
        .width(this.goGridWidthPct())
        .aspectRatio(1)
      }
      .width(this.boardWidth())
      .aspectRatio(1)
    }
  }

  private goGridTemplate(): string {
    const cols: string[] = []
    for (let i = 0; i < this.goSize; i++) {
      cols.push('1fr')
    }
    return cols.join(' ')
  }

  // 网格宽必须等于「首末交叉点跨度 × n/(n-1)」，棋子才落在交叉点上。
  // 数值来自 scripts/gen_board_artwork.py 生成的 coords_go*.json（与底图同源）。
  private goGridWidthPct(): string {
    const span = 78.2
    const width = span * this.goSize / (this.goSize - 1)
    return `${width.toFixed(2)}%`
  }

  private setGoSize(size: number): void {
    if (this.goSize === size) {
      return
    }
    this.goSize = size
    setGoBoardSide(size)
    this.resetBoard()
    this.gameStatus = `已切换 ${size} 路棋盘 · 黑方先行`
  }

  @Builder
  ChineseChessBoard() {
    Stack() {
      Image(this.boardArtwork('chinese-chess'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Fill)
      Grid() {
      ForEach(Array(90).fill(0), (_: number, index: number) => {
        GridItem() {
          Stack() {
            Text('')
              .width('100%')
              .height('100%')
            if (this.chessPieces[index].length > 0) {
              // ⚠️ 象棋格是「扁」的：格宽 10.25% × 格高 8.19%（Grid 宽 92.25% / 高 81.88%）。
              // 所以棋子直径必须以**格高**为基准，用 .height('92%')，
              // 若写成 .width('92%') 会比格高大 15%，底部一排棋子直接溢出棋盘下沿。
              // 数值按实物（直径 2.6~3.8cm 扁圆木片，字约占盘径 56%）标定。
              Text(this.chessPieces[index])
                .height('92%')
                .width('92%')
                .fontSize(this.xiangqiPieceFont())
                .fontWeight(FontWeight.Bold)
                .fontColor(index < 45 ? '#2B2118' : '#B3271E')
                .textAlign(TextAlign.Center)
                .backgroundColor('#F3E0B4')
                // 细环线：实物棋子是刻一道细圈，粗描边会显得笨重
                .border({ width: this.selectedCell === index ? 3 : 1.5, color: this.selectedCell === index ? '#1F7A4D' : (index < 45 ? '#2B2118' : '#B3271E') })
                .borderRadius(99)
                .shadow({ radius: 3, color: 'rgba(45,28,8,0.35)', offsetX: 1, offsetY: 2 })
            }
          }
          .onClick(() => { if (this.confirmCell(index)) this.moveChess(index) })
        }
      }, (_: number, index: number) => `xiangqi-${index}-${this.chessPieces[index]}-${this.selectedCell}`)
      }
      // ⚠️ 必须 9 列 × 10 行。引擎用 index = row*9 + col（见 BoardAnalysis 的 from/9、from%9），
      // 初始局面也印证：黑底线 0-8、红底线 81-89、炮在 19/25 即第 2 行。
      // 旧代码这里写了 10 列，于是 90 个格子从 index 9 起整体错位一行，
      // 且最后一行永远空白 —— 棋子跟交叉点对不上，就是「象棋下不好」的真正原因。
      .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      // 按 xiangqi_board.png 实测（scripts/measure_xiangqi.py，线间距 82px / 65.5px 完全等差）：
      // 9 条纵线跨 82.00%（8.875%~90.875%），10 条横线跨 73.69%（13.00%~86.69%）。
      // 要让格心落在交叉点上：宽 = 82.00% * 9/8 = 92.25%，高 = 73.69% * 10/9 = 81.88%，
      // 故 aspectRatio = 92.25 / 81.88 ≈ 1.1269。
      .width('92.25%')
      .aspectRatio(1.1269)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .backgroundColor('#E5BD76')
    .border({ width: 5, color: '#76502A' })
    .borderRadius(8)
  }

  @Builder
  CheckersBoard() {
    // 中国跳棋：六角星底图（952×1115）+ 121 孔绝对定位棋子。
    // ⚠️ 底图高度曾是 1081，生成器后来给底部加了 34px 留白变成 1115，
    // 但 jumpPosY 没跟着重算，导致底部棋子整体下移近 3%（92.01% 被当成 94.90%）。
    // 底图一改就必须重跑 `scripts/gen_jump_board.py --no-render` 再把坐标同步进来。
    // jumpPosX/jumpPosY 均出自 scripts/coords_jump.json，与底图同源。
    Stack() {
      Image(this.boardArtwork('checkers'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Fill)
      ForEach(Array(121).fill(0), (_: number, index: number) => {
        // 可达落点高亮（含连跳终点）
        if (this.jumpSelected >= 0 && this.jumpMoves.indexOf(index) >= 0) {
          Circle({ width: '4.4%', height: '4.0%' })
            .fill('rgba(245,199,66,0.55)')
            .stroke('#C9920E')
            .strokeWidth(1.5)
            .position({ x: `${this.jumpPosX[index]}%`, y: `${this.jumpPosY[index]}%` })
            .markAnchor({ x: '50%', y: '50%' })
        }
      }, (_: number, index: number) => `jump-dot-${index}-${this.jumpMoves.indexOf(index) >= 0 ? 1 : 0}`)
      ForEach(Array(121).fill(0), (_: number, index: number) => {
        if (this.jumpBoard[index] > 0) {
          Circle({ width: '5.0%', height: '4.5%' })
            .fill(this.jumpBoard[index] === 1 ? '#E94B3C' : this.jumpBoard[index] === 2 ? '#F5A623' : '#3B7DD8')
            .stroke(this.jumpSelected === index ? '#1D1D1F' : '#FFFFFF')
            .strokeWidth(this.jumpSelected === index ? 2.5 : 1.2)
            .shadow({ radius: 3, color: 'rgba(40,20,5,0.35)', offsetX: 1, offsetY: 1.5 })
            .position({ x: `${this.jumpPosX[index]}%`, y: `${this.jumpPosY[index]}%` })
            .markAnchor({ x: '50%', y: '50%' })
        }
      }, (_: number, index: number) => `jump-piece-${index}-${this.jumpBoard[index]}-${this.jumpSelected}`)
      ForEach(Array(121).fill(0), (_: number, index: number) => {
        // 统一透明热区：覆盖全部孔位，负责选子 / 走子
        Circle({ width: '6.2%', height: '5.6%' })
          .fill('rgba(0,0,0,0.001)')
          .position({ x: `${this.jumpPosX[index]}%`, y: `${this.jumpPosY[index]}%` })
          .markAnchor({ x: '50%', y: '50%' })
          .onClick(() => this.jumpTap(index))
      }, (_: number, index: number) => `jump-hit-${index}`)
    }
    .width(this.jumpBoardWidth())
    .aspectRatio(0.88)
  }

  // 六角星盘是竖长图（0.88 宽高比），宽度按可用高度的 0.88 倍折算，避免纵向溢出
  private jumpBoardWidth(): number {
    const contentWidth = Math.min(this.windowWidth - 32, 560)
    const heightLimit = Math.max(320, this.windowHeight * (this.isWideWorkspace() ? 0.78 : 0.72)) * 0.88
    return Math.floor(Math.min(contentWidth, heightLimit))
  }

  @Builder
  WorldChessBoard() {
    Stack() {
      Grid() {
        ForEach(Array(64).fill(0), (_: number, index: number) => {
          GridItem() {
            Stack() {
              Text('')
                .width('100%')
                .height('100%')
                .backgroundColor((Math.floor(index / 8) + index % 8) % 2 === 0 ? '#EFE0BE' : '#A8794E')
              if (this.worldChessPieces[index].length > 0) {
                Text(this.worldChessGlyph(this.worldChessPieces[index]))
                  .width('86%')
                  .height('86%')
                  .fontSize(this.windowWidth < 520 ? 24 : 32)
                  .textAlign(TextAlign.Center)
                  .fontColor(this.worldChessPieces[index].startsWith('w') ? '#332A1E' : '#26221C')
                  .shadow({ radius: 2, color: this.worldChessPieces[index].startsWith('w') ? '#FFFDF6' : '#D8C49E', offsetX: 0, offsetY: 1 })
                  .border({ width: this.selectedCell === index ? 3 : 0, color: '#2F7655' })
                  .borderRadius(8)
              } else if (this.selectedCell === index) {
                Text('')
                  .width('100%')
                  .height('100%')
                  .backgroundColor('#2F7655')
                  .opacity(0.3)
              }
            }
            .onClick(() => { if (this.confirmCell(index)) this.moveWorldChess(index) })
          }
        }, (_: number, index: number) => `wchess-${index}-${this.worldChessPieces[index]}-${this.selectedCell}`)
      }
      .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .width('94%')
      .aspectRatio(1)
      .padding(6)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .backgroundColor('#A8794E')
    .border({ width: 5, color: '#6B4A2B' })
    .borderRadius(8)
  }

  // 牌架按行切分：返回每行对应的**全局手牌下标**（同值牌可重复，必须用下标区分）
  private rummyRackRowsOf(): number[][] {
    const n = this.rummyHand.length
    if (n === 0) return [[]]
    const rows = Math.max(1, Math.min(this.rummyRackRows, n))
    const per = Math.ceil(n / rows)
    const out: number[][] = []
    for (let r = 0; r < rows; r++) {
      const row: number[] = []
      for (let i = r * per; i < Math.min((r + 1) * per, n); i++) {
        row.push(i)
      }
      out.push(row)
    }
    return out
  }

  // 牌架单张牌：普通模式点击=选牌出组合；整理模式点击=两两交换位置
  @Builder
  RummyTile(index: number, tile: number) {
    Text(this.tileLabel(tile))
      .width(46)
      .height(66)
      .margin(3)
      .fontSize(19)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.tileColor(tile))
      .textAlign(TextAlign.Center)
      .backgroundColor('#F6F2E8')
      .border({
        width: this.rummyPending.length > 0 && this.rummyPending[this.rummyPending.length - 1].indexOf(tile) >= 0 ? 3 : 1.5,
        color: this.rummyPending.length > 0 && this.rummyPending[this.rummyPending.length - 1].indexOf(tile) >= 0 ?
          this.accentColor() : (this.rummySortPick === index ? '#B7791F' : '#BBAE98')
      })
      .borderRadius(6)
      .onClick(() => {
        if (this.rummySortMode) {
          if (this.rummySortPick < 0) {
            this.rummySortPick = index
          } else if (this.rummySortPick === index) {
            this.rummySortPick = -1
          } else {
            const hand = this.rummyHand.slice()
            const tmp = hand[this.rummySortPick]
            hand[this.rummySortPick] = hand[index]
            hand[index] = tmp
            this.rummyHand = hand
            this.rummySortPick = -1
          }
          return
        }
        this.rummyPick(index)
      })
  }

  @Builder
  RummyTable() {
    Column({ space: 12 }) {
      Row() {
        Text(`牌堆 ${this.rummyDeckCount}`)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Text(`对手1 ${this.rummyAiCounts[0]} 张 · 对手2 ${this.rummyAiCounts[1]} 张`)
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      Text(this.rummyTurn === 0 ? (this.rummyWinner >= 0 ? '本局结束' : '你的回合') : `对手 ${this.rummyTurn} 思考中…`)
        .width('100%')
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.rummyTurn === 0 ? '#2E7D5B' : this.mutedColor())
      Text(this.rummyLog)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())

      Text('公共组合区（点组合可并入待出牌）')
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.mutedColor())
      if (this.rummySets.length === 0) {
        Text('还没有任何组合')
          .width('100%')
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      ForEach(this.rummySets, (set: number[], setIndex: number) => {
        Row({ space: 4 }) {
          ForEach(set, (tile: number) => {
            Text(this.tileLabel(tile))
              .width(38)
              .height(52)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.tileColor(tile))
              .textAlign(TextAlign.Center)
              .backgroundColor('#F6F2E8')
              .border({ width: 1.5, color: '#BBAE98' })
              .borderRadius(6)
          }, (tile: number, index: number) => `set${setIndex}-${index}-${tile}`)
        }
        .width('100%')
        .padding(4)
        .borderRadius(6)
        .border({ width: this.rummySelectedSet === setIndex ? 2 : 0, color: '#F5C542' })
        .backgroundColor(this.rummySelectedSet === setIndex ? 'rgba(245,197,66,0.18)' : 'rgba(0,0,0,0)')
        .onClick(() => {
          this.rummySelectedSet = this.rummySelectedSet === setIndex ? -1 : setIndex
          if (this.rummySelectedSet >= 0) this.rummyAddToSet(setIndex)
        })
      }, (set: number[], setIndex: number) => `rummy-set-${setIndex}-${set.length}`)

      Text(`你的牌架 · ${this.rummyHand.length} 张`)
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.mutedColor())
      // 牌架行数可自行增减；「整理」模式下点两张牌交换位置，方便归组
      Column({ space: 6 }) {
        ForEach(this.rummyRackRowsOf(), (rowIdx: number[], rowIndex: number) => {
          Row({ space: 4 }) {
            ForEach(rowIdx, (gi: number) => {
              this.RummyTile(gi, this.rummyHand[gi])
            }, (gi: number) => `rack-${rowIndex}-${gi}-${this.rummyHand[gi]}`)
          }
          .width('100%')
          .height(72)
          .padding(3)
          .borderRadius(6)
          .border({ width: 1, color: this.themeBorderColor() })
        }, (rowIdx: number[], rowIndex: number) => `rack-row-${rowIndex}-${rowIdx.length}-${rowIdx[0]}`)
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('－ 一排')
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => {
            this.rummyRackRows = Math.max(1, this.rummyRackRows - 1)
          })
        Text(`${this.rummyRackRows} 排`)
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.mutedColor())
        Button('＋ 一排')
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => {
            this.rummyRackRows = Math.min(7, this.rummyRackRows + 1)
          })
        Button(this.rummySortMode ? '完成整理' : '整理')
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .backgroundColor(this.rummySortMode ? '#B7791F' : this.controlColor())
          .fontColor(this.rummySortMode ? '#FFFFFF' : this.controlTextColor())
          .borderRadius(8)
          .onClick(() => {
            this.rummySortMode = !this.rummySortMode
            this.rummyPending = []
            this.rummyLog = this.rummySortMode ? '整理模式：点两张牌交换位置' : '已退出整理模式'
          })
      }
      .width('100%')

      Row({ space: 8 }) {
        Button('出新组合')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .enabled(this.rummyTurn === 0 && this.rummyWinner < 0)
          .onClick(() => this.rummyPlayNewSet())
        Button('清空选择')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .onClick(() => this.rummyClearPick())
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('摸牌结束回合')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .enabled(this.rummyTurn === 0 && this.rummyWinner < 0)
          .onClick(() => this.drawRummyTile())
        Button('重开')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .onClick(() => this.resetBoard())
      }
      .width('100%')
      Text('规则：3 张以上同色连续为顺子，3-4 张同数字不同色为刻子；首次出牌需 ≥30 分；每回合没出牌就要摸一张。')
        .width('100%')
        .fontSize(11)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.darkTheme() ? '#193229' : '#E7EFE9')
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  LudoBoard() {
    Column({ space: 12 }) {
      Stack() {
        Image(this.boardArtwork('ludo'))
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Fill)
        ForEach(Array(16).fill(0), (_: number, index: number) => {
          if (this.ludoPlaneVisible(index)) {
            Text('✈')
              .fontSize(this.windowWidth < 520 ? 11 : 14)
              .fontColor('#FFFFFF')
              .fontWeight(FontWeight.Bold)
              .textAlign(TextAlign.Center)
              .width('4.6%')
              .height('4.6%')
              .backgroundColor(this.ludoPlayerColor[Math.floor(index / 4)])
              .borderRadius(99)
              .border({
                width: this.ludoPickable(index) ? 3 : 1.5,
                color: this.ludoPickable(index) ? '#F5C542' : '#FFFFFF'
              })
              .shadow(this.ludoPickable(index) ?
                { radius: 8, color: '#F5C542', offsetX: 0, offsetY: 0 } :
                { radius: 0, color: '#00000000', offsetX: 0, offsetY: 0 })
              .position({ x: `${this.ludoPlanePos(index)[0]}%`, y: `${this.ludoPlanePos(index)[1]}%` })
              .markAnchor({ x: '50%', y: '50%' })
              .onClick(() => this.ludoPlaneTap(index))
          }
        }, (_: number, index: number) => `ludo-plane-${index}`)
      }
      .aspectRatio(1)
      .width('100%')
      Text(this.ludoStatusText())
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor('#172033')
        .textAlign(TextAlign.Center)
        .width('100%')
        .padding(10)
        .backgroundColor('#FFFFFF')
        .borderRadius(8)
      Row({ space: 10 }) {
        Text(this.diceValue > 0 ? `${this.diceValue}` : '—')
          .width(48)
          .height(48)
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .textAlign(TextAlign.Center)
          .backgroundColor(this.controlColor())
          .borderRadius(8)
        Button(this.ludoNeedPick ? '请选择飞机' :
          (this.ludoTurn === 0 ? `掷骰子（${this.ludoPlayerName[0]}家）` :
            (this.localAiEnabled ? 'AI 行动中…' : `掷骰子（${this.ludoPlayerName[this.ludoTurn]}家）`)))
          .layoutWeight(1)
          .height(48)
          .backgroundColor(this.accentColor())
          .enabled(!this.localAiEnabled || (this.ludoTurn === 0 && !this.ludoGameOver() && !this.ludoNeedPick))
          .onClick(() => this.rollLudoDice())
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('2 人')
          .layoutWeight(1)
          .height(38)
          .fontSize(13)
          .backgroundColor(this.ludoPlayerCount === 2 ? this.accentColor() : this.controlColor())
          .fontColor(this.ludoPlayerCount === 2 ? '#FFFFFF' : this.controlTextColor())
          .onClick(() => this.ludoSetPlayers(2))
        Button('3 人')
          .layoutWeight(1)
          .height(38)
          .fontSize(13)
          .backgroundColor(this.ludoPlayerCount === 3 ? this.accentColor() : this.controlColor())
          .fontColor(this.ludoPlayerCount === 3 ? '#FFFFFF' : this.controlTextColor())
          .onClick(() => this.ludoSetPlayers(3))
        Button('4 人')
          .layoutWeight(1)
          .height(38)
          .fontSize(13)
          .backgroundColor(this.ludoPlayerCount === 4 ? this.accentColor() : this.controlColor())
          .fontColor(this.ludoPlayerCount === 4 ? '#FFFFFF' : this.controlTextColor())
          .onClick(() => this.ludoSetPlayers(4))
        Button('重开')
          .layoutWeight(1)
          .height(38)
          .fontSize(13)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .onClick(() => this.resetBoard())
      }
      .width('100%')
      Text('规则：掷 6 起飞并再掷一次；撞敌机回基地；踩同色格连跳 4 格；超过终点反弹；4 架全部到达中心获胜。')
        .width('100%')
        .fontSize(11)
        .fontColor(this.mutedColor())
    }
    .width(this.boardWidth())
    .padding(8)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  // 当前回合该架飞机是否可被点选移动
  private ludoPickable(index: number): boolean {
    if (!this.ludoNeedPick || this.ludoTurn !== Math.floor(index / 4)) {
      return false
    }
    return this.ludoOptions.indexOf(index % 4) >= 0
  }

  private ludoSetPlayers(count: number): void {
    this.ludoPlayerCount = count
    this.resetBoard()
  }

  // 飞机 index = player*4 + piece；进度：-1 基地 / 0-50 主跑道 / 51-55 终点通道 / 56 终点
  private ludoPlanePos(index: number): number[] {
    const player = Math.floor(index / 4)
    const piece = index % 4
    const p = this.ludoPieces[player][piece]
    if (p < 0) {
      return [this.ludoBaseX[index], this.ludoBaseY[index]]
    }
    if (p <= 50) {
      const cell = (p + this.ludoStartOffset[player]) % 52
      const x = this.ludoRouteX[cell]
      const y = this.ludoRouteY[cell]
      // 同格叠子横向错开
      let stack = 0
      for (let k = 0; k < piece; k++) {
        const q = this.ludoPieces[player][k]
        if (q >= 0 && q <= 50 && (q + this.ludoStartOffset[player]) % 52 === cell) {
          stack += 1
        }
      }
      return [x + stack * 2.4, y]
    }
    if (p < 56) {
      return [this.ludoHomeX[player][p - 51], this.ludoHomeY[player][p - 51]]
    }
    return [this.ludoFinishX[player], this.ludoFinishY[player]]
  }

  private ludoPlaneVisible(index: number): boolean {
    return true
  }

  private ludoStatusText(): string {
    if (this.ludoGameOver()) {
      return this.gameStatus
    }
    const done = this.ludoPieces[0].filter((v: number) => v === 56).length
    return `${this.gameStatus} · 红家已到 ${done}/4`
  }

  private propertySquareName(index: number): string {
    const names: string[] = ['起点', '北京', '机会', '上海', '所得税', '广州', '监狱', '深圳', '命运', '杭州', '火车站', '南京', '免费停车', '成都', '机会', '重庆', '奢侈税', '武汉', '去监狱', '西安', '命运', '天津', '火车站', '青岛']
    return names[index % names.length]
  }

  // ===== 扫雷 =====
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
    const houses = this.monopolyHouse[index] > 0 ? this.monopolyHouse[index] : 0
    return Math.round(price * 0.18 * (1 + (sameColor - 1) * 0.4) * (1 + houses * 0.8))
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
    this.monopolyHouse = Array(24).fill(0)
    this.monopolyMortgaged = Array(24).fill(false)
    this.monopolyPendingBuy = -1
    this.monopolyLastRoll = 0
  }

  private monopolyRoll(): void {
    if (this.monopolyOver()) {
      this.gameStatus = '已有玩家破产，本局结束，点“重开本局”'
      return
    }
    if (this.monopolyPendingBuy >= 0) {
      this.gameStatus = '请先决定要不要买下这块地'
      return
    }
    const player = this.monopolyTurn
    const roll = Math.floor(Math.random() * 6) + 1
    this.monopolyLastRoll = roll
    const prev = this.monopolyPos[player]
    const nextPos = (prev + roll) % 24
    const positions = this.monopolyPos.slice()
    positions[player] = nextPos
    this.monopolyPos = positions
    if (nextPos < prev || (prev + roll) >= 24) {
      const cash = this.monopolyCash.slice()
      cash[player] += 2000
      this.monopolyCash = cash
      this.gameStatus = `经过起点，获得工资 ¥2000 · `
    } else {
      this.gameStatus = ''
    }
    this.monopolyLanding(player, nextPos)
  }

  // 落地结算：可买地 → 等玩家决策；他人地 → 付租金；特殊格 → 事件
  private monopolyLanding(player: number, pos: number): void {
    const name = this.propertySquareName(pos)
    const price = this.monopolyPrice(pos)
    const owner = this.monopolyOwner[pos]
    if (price === 0) {
      this.monopolyEvent(player, pos)
      this.monopolyNextTurn()
      return
    }
    if (owner < 0) {
      if (this.monopolyCash[player] >= price) {
        this.monopolyPendingBuy = pos
        this.gameStatus += `${name} 售价 ¥${price}，要买下吗？`
      } else {
        this.gameStatus += `${name} 要 ¥${price}，资金不足，跳过`
        this.monopolyNextTurn()
      }
      return
    }
    if (owner === player) {
      this.gameStatus += `回到自己的${name}，可盖房升级`
      this.monopolyNextTurn()
      return
    }
    let rent = this.monopolyRent(pos)
    if (this.monopolyMortgaged[pos]) rent = Math.round(rent / 2)
    const cash = this.monopolyCash.slice()
    cash[player] -= rent
    cash[owner] += rent
    this.monopolyCash = cash
    this.gameStatus += `在${name}付租金 ¥${rent} 给玩家 ${owner + 1}`
    if (cash[player] < 0) {
      this.gameStatus = `玩家 ${player + 1} 资金见底破产，本局结束`
    }
    this.monopolyNextTurn()
  }

  // 特殊格事件
  private monopolyEvent(player: number, pos: number): void {
    const cash = this.monopolyCash.slice()
    const name = this.propertySquareName(pos)
    if (name === '所得税') {
      cash[player] -= 1200
      this.gameStatus += '缴纳所得税 ¥1200'
    } else if (name === '奢侈税') {
      cash[player] -= 800
      this.gameStatus += '缴纳奢侈税 ¥800'
    } else if (name === '去监狱') {
      const positions = this.monopolyPos.slice()
      positions[player] = 6
      this.monopolyPos = positions
      this.gameStatus += '被送去监狱（探监）'
    } else if (name === '免费停车') {
      this.gameStatus += '免费停车，休息一回合'
    } else if (name === '机会' || name === '命运') {
      const delta = [1500, 1000, 500, -500, -800, 2000][Math.floor(Math.random() * 6)]
      cash[player] += delta
      this.gameStatus += `${name}：${delta >= 0 ? '获得' : '支付'} ¥${Math.abs(delta)}`
    } else {
      this.gameStatus += `停在${name}`
    }
    this.monopolyCash = cash
  }

  private monopolyBuy(yes: boolean): void {
    const pos = this.monopolyPendingBuy
    if (pos < 0) {
      return
    }
    const player = this.monopolyTurn
    this.monopolyPendingBuy = -1
    if (yes) {
      const price = this.monopolyPrice(pos)
      const cash = this.monopolyCash.slice()
      if (cash[player] < price) {
        this.gameStatus = '资金不足，买不起'
      } else {
        cash[player] -= price
        const owners = this.monopolyOwner.slice()
        owners[pos] = player
        this.monopolyOwner = owners
        this.monopolyCash = cash
        this.gameStatus = `买下${this.propertySquareName(pos)}，花了 ¥${price}`
      }
    } else {
      this.gameStatus = `放弃购买${this.propertySquareName(pos)}`
    }
    this.monopolyNextTurn()
  }

  // 盖房：每级提升租金，最多 3 级（4 级视为酒店）
  private monopolyBuild(): void {
    const player = this.monopolyTurn
    const pos = this.monopolyPos[player]
    if (this.monopolyOwner[pos] !== player) {
      this.gameStatus = '只能给自己名下的地产盖房'
      return
    }
    if (this.monopolyHouse[pos] >= 3) {
      this.gameStatus = '这里已经是酒店了'
      return
    }
    const cost = Math.round(this.monopolyPrice(pos) * 0.5)
    if (this.monopolyCash[player] < cost) {
      this.gameStatus = `盖房需要 ¥${cost}，资金不足`
      return
    }
    const cash = this.monopolyCash.slice()
    cash[player] -= cost
    this.monopolyCash = cash
    const houses = this.monopolyHouse.slice()
    houses[pos] += 1
    this.monopolyHouse = houses
    this.gameStatus = `${this.propertySquareName(pos)}盖到 ${houses[pos]} 级，租金提升到 ¥${this.monopolyRent(pos)}`
  }

  // 抵押 / 赎回：抵押拿回半价，赎回多付 10%
  private monopolyMortgage(): void {
    const player = this.monopolyTurn
    const pos = this.monopolyPos[player]
    if (this.monopolyOwner[pos] !== player) {
      this.gameStatus = '只能抵押自己名下的地产'
      return
    }
    const cash = this.monopolyCash.slice()
    const flags = this.monopolyMortgaged.slice()
    const price = this.monopolyPrice(pos)
    if (flags[pos]) {
      const pay = Math.round(price * 0.55)
      if (cash[player] < pay) {
        this.gameStatus = `赎回需要 ¥${pay}，资金不足`
        return
      }
      cash[player] -= pay
      flags[pos] = false
      this.gameStatus = `赎回${this.propertySquareName(pos)}，花了 ¥${pay}`
    } else {
      cash[player] += Math.round(price * 0.5)
      flags[pos] = true
      this.gameStatus = `抵押${this.propertySquareName(pos)}，获得 ¥${Math.round(price * 0.5)}（租金减半）`
    }
    this.monopolyCash = cash
    this.monopolyMortgaged = flags
  }

  // 结束当前玩家回合：轮到 AI 依次行动，再回到玩家
  private monopolyNextTurn(): void {
    if (this.monopolyOver()) {
      return
    }
    const next = (this.monopolyTurn + 1) % 4
    this.monopolyTurn = next
    if (next === 0) {
      this.gameStatus += ' · 轮到你了'
      return
    }
    this.monopolyAiLoop()
  }

  private monopolyAiLoop(): void {
    if (this.monopolyTurn === 0 || this.monopolyOver()) {
      return
    }
    setTimeout(() => {
      if (this.monopolyOver() || this.monopolyTurn === 0) {
        return
      }
      this.monopolyAiAct()
      this.monopolyNextTurn()
    }, 650)
  }

  private monopolyAiAct(): void {
    const player = this.monopolyTurn
    const roll = Math.floor(Math.random() * 6) + 1
    const prev = this.monopolyPos[player]
    const pos = (prev + roll) % 24
    const positions = this.monopolyPos.slice()
    positions[player] = pos
    this.monopolyPos = positions
    const price = this.monopolyPrice(pos)
    const owner = this.monopolyOwner[pos]
    const cash = this.monopolyCash.slice()
    if (price === 0) {
      const name = this.propertySquareName(pos)
      if (name === '所得税') cash[player] -= 1200
      else if (name === '奢侈税') cash[player] -= 800
      else if (name === '机会' || name === '命运') {
        cash[player] += [1500, 1000, 500, -500, -800, 2000][Math.floor(Math.random() * 6)]
      } else if (pos < prev) cash[player] += 2000
      this.monopolyCash = cash
      return
    }
    if (owner < 0 && cash[player] >= price) {
      cash[player] -= price
      const owners = this.monopolyOwner.slice()
      owners[pos] = player
      this.monopolyOwner = owners
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll} 买下${this.propertySquareName(pos)}`
    } else if (owner >= 0 && owner !== player) {
      let rent = this.monopolyRent(pos)
      if (this.monopolyMortgaged[pos]) rent = Math.round(rent / 2)
      cash[player] -= rent
      cash[owner] += rent
      this.gameStatus = `玩家 ${player + 1} 掷 ${roll} 在${this.propertySquareName(pos)}付租金 ¥${rent}`
    } else {
      // 自己的地：有钱就升级
      if (this.monopolyHouse[pos] < 3 && cash[player] > Math.round(price * 0.9)) {
        cash[player] -= Math.round(price * 0.5)
        const houses = this.monopolyHouse.slice()
        houses[pos] += 1
        this.monopolyHouse = houses
        this.gameStatus = `玩家 ${player + 1} 给${this.propertySquareName(pos)}加盖到 ${houses[pos]} 级`
      } else {
        this.gameStatus = `玩家 ${player + 1} 掷 ${roll} 停在${this.propertySquareName(pos)}`
      }
    }
    this.monopolyCash = cash
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
      if (this.monopolyPendingBuy >= 0) {
        Row({ space: 10 }) {
          Button(`买下 ¥${this.monopolyPrice(this.monopolyPendingBuy)}`)
            .layoutWeight(1)
            .height(44)
            .backgroundColor('#2E7D5B')
            .onClick(() => this.monopolyBuy(true))
          Button('放弃')
            .layoutWeight(1)
            .height(44)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .onClick(() => this.monopolyBuy(false))
        }
        .width('100%')
      }
      Row({ space: 10 }) {
        Button('掷骰前进')
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.accentColor())
          .enabled(this.monopolyTurn === 0 && this.monopolyPendingBuy < 0 && !this.monopolyOver())
          .onClick(() => this.monopolyRoll())
        Button('盖房')
          .layoutWeight(1)
          .height(44)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .enabled(this.monopolyTurn === 0 && this.monopolyPendingBuy < 0)
          .onClick(() => this.monopolyBuild())
      }
      .width('100%')
      Row({ space: 10 }) {
        Button(this.monopolyMortgaged[this.monopolyPos[this.monopolyTurn]] ? '赎回地产' : '抵押地产')
          .layoutWeight(1)
          .height(44)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .enabled(this.monopolyTurn === 0)
          .onClick(() => this.monopolyMortgage())
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
      Text(this.gameStatus)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
        .maxLines(3)
      Text('规则：经过起点领 ¥2000；买地后可盖房（租金最高 3.4 倍）；缺钱可抵押（租金减半）；现金跌破 0 即破产。')
        .width('100%')
        .fontSize(11)
        .fontColor(this.mutedColor())
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
    this.landlordSelected = Array(hands[master].length).fill(false)
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

  // ===== 掼蛋 =====
  // 4 人两队：座位 0/2 一队（我方），1/3 一队（对方）。
  // 掼蛋的关键差异：级牌随对局变化、红桃级牌是「逢人配」（万能牌）、
  // 炸弹按张数分级（4 炸 < 5 炸 < 同花顺 < 6 炸 < 7 炸 < 8 炸 < 四大天王）。

  private startGuandan(): void {
    const deck = guandanShuffle(guandanDeck())
    const hands: string[][] = [[], [], [], []]
    for (let i = 0; i < 108; i++) {
      hands[i % 4].push(deck[i])
    }
    // 首局默认打 2；级牌由本家选定后会重排手牌
    this.guandanLevel = 2
    this.guandanHands = hands.map((h: string[]) => guandanSortHand(h, this.guandanLevel))
    this.guandanTurn = 0
    this.guandanLastCombo = null
    this.guandanLastOwner = -1
    this.guandanLastCards = []
    this.guandanPassCount = 0
    this.guandanWinner = -1
    this.guandanWinnerTeam = ''
    this.guandanSelected = Array(this.guandanHands[0].length).fill(false)
    this.guandanTribute = []
    this.guandanPlayed = [[], [], [], []]
    this.guandanLog = '本局打 2，红桃 2 为逢人配。可在上方切换级牌。'
  }

  /** 切换级牌并重排四家手牌 */
  private setGuandanLevel(level: number): void {
    if (this.guandanWinner >= 0) return
    this.guandanLevel = level
    this.guandanHands = this.guandanHands.map(
      (h: string[]) => guandanSortHand(h, level))
    this.guandanSelected = Array(this.guandanHands[0].length).fill(false)
    this.guandanLog = `本局打 ${this.guandanFaceText(level)}，红桃 ${this.guandanFaceText(level)} 为逢人配。`
  }

  /** 2..14 → 牌面文字（14 = A） */
  private guandanFaceText(level: number): string {
    const faces: string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
    if (level >= 2 && level <= 14) return faces[level - 2]
    return String(level)
  }

  private guandanTeamName(seat: number): string {
    return seat % 2 === 0 ? '我方' : '对方'
  }

  private guandanSelectedCards(): string[] {
    const hand = this.guandanHands[0]
    const cards: string[] = []
    for (let i = 0; i < hand.length; i++) {
      if (i < this.guandanSelected.length && this.guandanSelected[i]) cards.push(hand[i])
    }
    return cards
  }

  /** 上家牌型的文字提示 */
  private guandanLastText(): string {
    if (this.guandanLastCombo === null || this.guandanLastCombo === undefined) {
      return '自由出牌'
    }
    const who = this.guandanLastOwner >= 0 ? `${this.guandanTeamName(this.guandanLastOwner)}玩家${this.guandanLastOwner + 1}` : ''
    return `${who} 出 ${guandanComboName(this.guandanLastCombo.type)} · ${this.guandanLastCards.join(' ')}`
  }

  private applyGuandanPlay(seat: number, cards: string[], combo: GuandanCombo): void {
    const hands = this.guandanHands.slice()
    // ⚠️ 必须在**副本**上消费：直接对入参 cards 做 splice 会把调用方的数组清空，
    //    导致 guandanPlayed / guandanLastCards / 日志全都记成空（出牌记录凭空消失）。
    const remain: string[] = cards.slice()
    const left: string[] = []
    hands[seat].forEach((card: string) => {
      // 按值逐张剔除（两张同点牌要按张数扣，不能一次全删）
      const idx = remain.indexOf(card)
      if (idx >= 0) remain.splice(idx, 1)
      else left.push(card)
    })
    hands[seat] = left
    this.guandanHands = hands
    const played = this.guandanPlayed.slice()
    played[seat] = played[seat].concat(cards)
    this.guandanPlayed = played
    this.guandanLastCombo = combo
    this.guandanLastOwner = seat
    this.guandanLastCards = cards.slice()
    this.guandanPassCount = 0
    this.guandanLog = `玩家${seat + 1}（${this.guandanTeamName(seat)}）出 ${guandanComboName(combo.type)}：${cards.join(' ')}`

    if (left.length === 0) {
      this.guandanWinner = seat
      this.guandanWinnerTeam = this.guandanTeamName(seat)
      this.gameStatus = `${this.guandanWinnerTeam}获胜！`
    }
  }

  private guandanPlay(): void {
    if (this.guandanTurn !== 0 || this.guandanWinner >= 0) return
    const cards = this.guandanSelectedCards()
    if (cards.length === 0) {
      this.gameStatus = '请先选牌'
      return
    }
    const combo = guandanWithWilds(cards, this.guandanLevel)
    if (combo === null) {
      this.gameStatus = '不是合法牌型'
      return
    }
    if (!guandanBeats(combo, this.guandanLastCombo)) {
      this.gameStatus = '压不过上家'
      return
    }
    this.applyGuandanPlay(0, cards, combo)
    this.guandanSelected = Array(this.guandanHands[0].length).fill(false)
    if (this.guandanWinner >= 0) return
    this.guandanTurn = 1
    this.guandanAiTurn()
  }

  private guandanPass(): void {
    if (this.guandanTurn !== 0 || this.guandanWinner >= 0) return
    this.guandanSelected = Array(this.guandanHands[0].length).fill(false)
    this.guandanPassCount += 1
    this.guandanLog = '你选择了过'
    if (this.guandanPassCount >= 3) {
      // 三家全过 → 上一手出牌者重新自由出牌
      // ⚠️ 必须**先算出nxt 再清状态**：清完 lastOwner 就变成 -1，
      //    之前写成「先清 lastOwner 再读」导致永远轮不到正确的人自由出牌。
      const nxt = this.guandanLastOwner >= 0 ? this.guandanLastOwner : 0
      this.guandanPassCount = 0
      this.guandanLastCombo = null
      this.guandanLastOwner = -1
      this.guandanLastCards = []
      this.guandanTurn = nxt
      this.guandanLog = `${nxt === 0 ? '你' : `玩家${nxt + 1}`} 自由出牌`
      if (this.guandanTurn !== 0) this.guandanAiTurn()
      return
    }
    this.guandanTurn = 1
    this.guandanAiTurn()
  }

  /**
 * 下家座位：**顺时针 0→1→2→3→0**。
   *
   * ⚠️ 曾写成「同队优先」（0→2、1→3），导致全桌只在两个小圈里转，
   *    座位 2 的队友整局一次牌都出不了（实测 900 局我方胜率 0%）。
   *掼蛋出牌顺序就是逆时针/顺时针轮流，不存在同队连坐的规则。
   */
  private guandanNextSeat(from: number): number {
    return (from + 1) % 4
  }

  private guandanAiTurn(): void {
    if (this.guandanWinner >= 0) return
    if (this.guandanTurn === 0) {
      this.gameStatus = this.guandanLastCombo === null || this.guandanLastCombo === undefined
        ? '轮到你自由出牌' : '轮到你，出牌或过'
      return
    }
    // 连续跑完剩余 AI 座位（1/2/3，直到转回玩家 0）
    // guard 给到 4：转回 0 时 while 条件自然退出，4 足够覆盖 3 个 AI 座位
    let guard = 0
    while (this.guandanTurn !== 0 && this.guandanWinner < 0 && guard < 4) {
      guard += 1
      const seat = this.guandanTurn
      const hand = this.guandanHands[seat]
      // 队友（座位 2）让牌：简单档一律让牌权，普通/困难只在牌型很大时才让
      const isTeammate = seat === 2
      const canPass = this.guandanLastCombo !== null && this.guandanLastCombo !== undefined
      const plays = guandanCandidatePlays(hand, this.guandanLevel, this.guandanLastCombo)
      let yieldBig = false
      if (isTeammate && canPass && this.aiDifficulty !== '困难') {
        // 让牌条件：简单档任何情况都让；普通档只有「无牌可出」才让
        yieldBig = this.aiDifficulty === '简单'
        if (!yieldBig && plays.length === 0) yieldBig = true
      }
      if (yieldBig) {
        this.guandanPassCount += 1
        this.guandanLog = `队友玩家${seat + 1} 过`
        if (this.guandanPassCount >= 3) {
          // ⚠️ 先算 nxt 再清状态（清完 lastOwner 就丢了）
          const nxt = this.guandanLastOwner >= 0 ? this.guandanLastOwner : 0
          this.guandanPassCount = 0
          this.guandanLastCombo = null
          this.guandanLastOwner = -1
          this.guandanLastCards = []
          this.guandanTurn = nxt
          return
        }
        this.guandanTurn = this.guandanNextSeat(seat)
        continue
      }
      if (plays.length === 0) {
        this.guandanPassCount += 1
        this.guandanLog = `玩家${seat + 1}（${this.guandanTeamName(seat)}）过`
        if (this.guandanPassCount >= 3) {
          const nxt = this.guandanLastOwner >= 0 ? this.guandanLastOwner : 0
          this.guandanPassCount = 0
          this.guandanLastCombo = null
          this.guandanLastOwner = -1
          this.guandanLastCards = []
          this.guandanTurn = nxt
          continue
        }
        this.guandanTurn = this.guandanNextSeat(seat)
        continue
      }
      const chosen = this.guandanAiPick(plays)
      const combo = analyzeGuandan(chosen, this.guandanLevel)
      if (combo === null) {
        this.guandanPassCount += 1
        this.guandanTurn = this.guandanNextSeat(seat)
        continue
      }
      this.applyGuandanPlay(seat, chosen.slice(), combo)
      this.guandanTurn = this.guandanNextSeat(seat)
    }
  }

  /**
   * AI 选牌策略（三档，对应设置里的简单 / 普通 / 困难）。
   *
   * 关键：**自由出牌不能无脑出最小单张**。候选是按「张数少 → rank 低」排的，
   * 取plays[0] 等于每轮白送最小的一张，AI 永远打不赢（实测 400 局 100% 让玩家赢）。
   * 所以自由出牌要挑「张数多、点数低」的候选，顺手把散牌清出去。
   *
   * 跟牌时取 plays[0]（最小应牌）是对的 —— 浪费最少。
   */
  private guandanAiPick(plays: string[][]): string[] {
    if (plays.length === 0) return []
    const seat = this.guandanTurn
    const hand = this.guandanHands[seat]
    const free = this.guandanLastCombo === null || this.guandanLastCombo === undefined

    // 能一趟走完就直接走完
    const finish = plays.find((p: string[]) => p.length >= hand.length)
    if (finish !== undefined) return finish

    if (this.aiDifficulty === '简单') return plays[0]

    if (free) {
      let best = plays[0]
      let bestScore = -1e9
      plays.forEach((p: string[]) => {
        const combo = analyzeGuandan(p, this.guandanLevel)
        if (combo === null) return
        const s = this.aiDifficulty === '困难'
          ? p.length * 100 - combo.rank
          : p.length * 50 - combo.rank * 2
        if (s > bestScore) { bestScore = s; best = p }
      })
      return best
    }
    return plays[0]
  }

  @Builder
  GuandanTable() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 3 }) {
          Text('掼蛋')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.guandanLastText())
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
      // 级牌选择
      Row({ space: 4 }) {
        Text('级牌')
          .fontSize(12)
          .fontColor(this.mutedColor())
        ForEach(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
          (face: string, index: number) => {
            Text(face)
              .layoutWeight(1)
              .height(28)
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .textAlign(TextAlign.Center)
              .fontColor(this.guandanLevel === index + 2 ? '#FFFFFF' : this.textColor())
              .backgroundColor(this.guandanLevel === index + 2 ? this.accentColor() : this.controlColor())
              .borderRadius(6)
              .onClick(() => this.setGuandanLevel(index + 2))
          }, (face: string) => `guandan-level-${face}`)
      }
      .width('100%')
      // 四家座位
      Row({ space: 6 }) {
        ForEach(['1', '2', '3', '4'], (seat: string, index: number) => {
          Column({ space: 2 }) {
            Text(`玩家${index + 1} · ${this.guandanTeamName(index)}`)
              .fontSize(10)
              .fontColor(this.guandanTurn === index ? '#FFFFFF' : this.mutedColor())
            Text(`${this.guandanHands.length > index ? this.guandanHands[index].length : 0} 张`)
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.guandanTurn === index ? '#FFFFFF' : this.textColor())
          }
          .layoutWeight(1)
          .height(50)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.guandanTurn === index ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
        }, (seat: string) => `guandan-seat-${seat}`)
      }
      .width('100%')
      // 我方手牌
      Scroll() {
        Row({ space: 5 }) {
          ForEach(this.guandanHands.length > 0 ? this.guandanHands[0] : [],
            (card: string, index: number) => {
              Text(this.guandanIsWildCard(card))
                .width(44)
                .height(this.guandanSelected[index] ? 74 : 64)
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor(card.indexOf('♥') >= 0 || card.indexOf('♦') >= 0 ? '#C83434' : '#172033')
                .textAlign(TextAlign.Center)
                .backgroundColor(this.guandanIsWildCard(card) ? '#FFF3D6' : '#FFFDF7')
                .border({
                  width: this.guandanSelected[index] ? 2.5 : 1.5,
                  color: this.guandanSelected[index] ? this.accentColor() : '#B9AD99'
                })
                .borderRadius(6)
                .onClick(() => {
                  if (this.guandanTurn !== 0 || this.guandanWinner >= 0) return
                  const selected = this.guandanSelected.slice()
                  selected[index] = !selected[index]
                  this.guandanSelected = selected
                })
            }, (card: string, index: number) => `guandan-card-${index}-${card}`)
        }
        .padding({ top: 6, bottom: 6 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      Text(this.guandanLog.length > 0 ? this.guandanLog : '选牌后点「出牌」，压不过可以点「过」。')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
      Row({ space: 8 }) {
        Button('出牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .onClick(() => this.guandanPlay())
        Button('过')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => this.guandanPass())
        Button('重开')
          .layoutWeight(1)
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .onClick(() => {
            this.startGuandan()
            this.gameStatus = '已重新发牌，本局打 2'
          })
      }
      .width('100%')
      Text('规则：4 人两队，0/2 与 1/3 各为一队。级牌最大（红桃级牌是万能「逢人配」）。' +
        '牌力：四大天王 > 8炸 > 7炸 > 6炸 > 同花顺 > 5炸 > 4炸 > 普通牌型。' +
        '先出完牌的一方获胜。')
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

  /** 逢人配（红桃级牌）在手牌里标出来 */
  private guandanIsWildCard(card: string): string {
    return guandanIsWild(card, this.guandanLevel) ? `${card}★` : card
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

  // ===== 麻将（万筒条 108 张 · 玩家 + 3 家 AI）=====
  private mahjongLabel(t: number): string {
    const suit = Math.floor(t / 10)
    const rank = t % 10 + 1
    const marks: string[] = ['万', '筒', '条']
    return `${rank}${marks[suit]}`
  }

  private mahjongCounts(hand: number[]): number[] {
    const counts: number[] = Array(27).fill(0)
    hand.forEach((t: number) => {
      if (t >= 0 && t < 27) counts[t] += 1
    })
    return counts
  }

  private mahjongCanWin(hand: number[]): boolean {
    const sorted = hand.slice().sort((a: number, b: number) => a - b)
    if (sorted.length === 14) {
      const counts = this.mahjongCounts(sorted)
      let pairs = 0
      let ok = true
      for (let i = 0; i < 27; i++) {
        if (counts[i] === 0) continue
        if (counts[i] === 2) pairs += 1
        else {
          ok = false
          break
        }
      }
      if (ok && pairs === 7) return true
    }
    return this.mahjongDecompose(sorted, false)
  }

  // 递归拆解：4 面子 + 1 将
  private mahjongDecompose(hand: number[], hasPair: boolean): boolean {
    if (hand.length === 0) return hasPair
    if (hand.length >= 3 && hand[0] === hand[1] && hand[1] === hand[2]) {
      if (this.mahjongDecompose(hand.slice(3), hasPair)) return true
    }
    if (!hasPair && hand.length >= 2 && hand[0] === hand[1]) {
      if (this.mahjongDecompose(hand.slice(2), true)) return true
    }
    if (hand[0] % 10 <= 6) {
      const a = hand[0] + 1
      const b = hand[0] + 2
      const rest = hand.slice(1)
      const ia = rest.indexOf(a)
      if (ia >= 0) {
        const rest2 = rest.slice()
        rest2.splice(ia, 1)
        const ib = rest2.indexOf(b)
        if (ib >= 0) {
          const rest3 = rest2.slice()
          rest3.splice(ib, 1)
          if (this.mahjongDecompose(rest3, hasPair)) return true
        }
      }
    }
    return false
  }

  private startMahjong(): void {
    const wall: number[] = []
    for (let s = 0; s < 3; s++) {
      for (let v = 0; v < 9; v++) {
        for (let c = 0; c < 4; c++) wall.push(s * 10 + v)
      }
    }
    for (let i = wall.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = wall[i]
      wall[i] = wall[j]
      wall[j] = tmp
    }
    this.mahjongHand = wall.slice(0, 13).sort((a: number, b: number) => a - b)
    this.mahjongAi = [
      wall.slice(13, 26).sort((a: number, b: number) => a - b),
      wall.slice(26, 39).sort((a: number, b: number) => a - b),
      wall.slice(39, 52).sort((a: number, b: number) => a - b)
    ]
    this.mahjongWall = wall.slice(52)
    this.mahjongWallCount = this.mahjongWall.length
    this.mahjongMelds = []
    this.mahjongPool = []
    this.mahjongTurn = 0
    this.mahjongDrawn = -1
    this.mahjongClaim = -1
    this.mahjongCanPon = false
    this.mahjongCanKan = false
    this.mahjongCanChi = false
    this.mahjongCanHu = false
    this.mahjongAiCounts = [13, 13, 13]
    this.mahjongWinner = -1
    this.gameStatus = '麻将开局 · 点「摸牌」开始你的回合'
  }

  private mahjongDraw(): void {
    if (this.mahjongTurn !== 0 || this.mahjongWinner >= 0) return
    if (this.mahjongClaim >= 0) {
      this.gameStatus = '先处理别人打出的牌（碰/杠/胡/过）'
      return
    }
    if (this.mahjongWall.length === 0) {
      this.gameStatus = '牌墙已经摸完，流局'
      return
    }
    const tile = this.mahjongWall[0]
    this.mahjongWall = this.mahjongWall.slice(1)
    this.mahjongWallCount = this.mahjongWall.length
    this.mahjongHand = this.mahjongHand.concat([tile]).sort((a: number, b: number) => a - b)
    this.mahjongDrawn = tile
    this.mahjongCanHu = this.mahjongCanWin(this.mahjongHand)
    const counts = this.mahjongCounts(this.mahjongHand)
    let kan = false
    for (let i = 0; i < 27; i++) {
      if (counts[i] === 4) kan = true
    }
    this.mahjongCanKan = kan
    this.gameStatus = this.mahjongCanHu ?
      `摸到 ${this.mahjongLabel(tile)} · 自摸可以胡！` : `摸到 ${this.mahjongLabel(tile)}，点一张牌打出`
  }

  private mahjongDiscard(index: number): void {
    if (this.mahjongTurn !== 0 || this.mahjongWinner >= 0) return
    if (index < 0 || index >= this.mahjongHand.length) return
    const tile = this.mahjongHand[index]
    const hand = this.mahjongHand.slice()
    hand.splice(index, 1)
    this.mahjongHand = hand
    this.mahjongPool = this.mahjongPool.concat([tile])
    this.mahjongDrawn = -1
    this.mahjongCanHu = false
    this.mahjongCanKan = false
    this.mahjongCanChi = false
    this.gameStatus = `你打出 ${this.mahjongLabel(tile)}`
    this.mahjongAiLoop(1)
  }

  private mahjongAiLoop(seat: number): void {
    if (this.mahjongWinner >= 0) return
    if (seat > 3) {
      this.mahjongTurn = 0
      this.gameStatus = '轮到你摸牌'
      return
    }
    setTimeout(() => {
      if (this.mahjongWinner >= 0) return
      const idx = seat - 1
      if (this.mahjongWall.length === 0) {
        this.gameStatus = '牌墙已经摸完，流局'
        return
      }
      const tile = this.mahjongWall[0]
      this.mahjongWall = this.mahjongWall.slice(1)
      this.mahjongWallCount = this.mahjongWall.length
      const hand = this.mahjongAi[idx].concat([tile]).sort((a: number, b: number) => a - b)
      if (this.mahjongCanWin(hand)) {
        this.mahjongWinner = seat
        this.gameStatus = `对手 ${seat} 自摸胡牌，本局结束`
        return
      }
      const discard = this.mahjongAiChooseDiscard(hand)
      const rest = hand.slice()
      rest.splice(rest.indexOf(discard), 1)
      this.mahjongAi[idx] = rest
      const counts = this.mahjongAiCounts.slice()
      counts[idx] = rest.length
      this.mahjongAiCounts = counts
      this.mahjongPool = this.mahjongPool.concat([discard])
      const mine = this.mahjongCounts(this.mahjongHand)
      this.mahjongClaim = discard
      this.mahjongCanPon = mine[discard] >= 2
      this.mahjongCanKan = mine[discard] >= 3
      this.mahjongCanHu = this.mahjongCanWin(this.mahjongHand.concat([discard]).sort((a: number, b: number) => a - b))
      this.mahjongCanChi = seat === 3 && this.mahjongChiOptions(discard).length > 0
      if (this.mahjongCanPon || this.mahjongCanKan || this.mahjongCanHu || this.mahjongCanChi) {
        this.mahjongTurn = 0
        this.gameStatus = `对手 ${seat} 打出 ${this.mahjongLabel(discard)} · 你可以碰/杠/吃/胡，或点「过」`
        return
      }
      this.mahjongAiLoop(seat + 1)
    }, 620)
  }

  // 吃：只有上家（左家，seat 3）打出的牌能吃
  private mahjongChiOptions(tile: number): number[][] {
    const out: number[][] = []
    if (tile % 10 >= 2) {
      const a = tile - 2
      const b = tile - 1
      if (this.mahjongHand.indexOf(a) >= 0 && this.mahjongHand.indexOf(b) >= 0) out.push([a, b, tile])
    }
    if (tile % 10 >= 1 && tile % 10 <= 7) {
      const a = tile - 1
      const b = tile + 1
      if (this.mahjongHand.indexOf(a) >= 0 && this.mahjongHand.indexOf(b) >= 0) out.push([a, tile, b])
    }
    if (tile % 10 <= 6) {
      const a = tile + 1
      const b = tile + 2
      if (this.mahjongHand.indexOf(a) >= 0 && this.mahjongHand.indexOf(b) >= 0) out.push([tile, a, b])
    }
    return out
  }

  private mahjongAiChooseDiscard(hand: number[]): number {
    let best = hand[0]
    let bestScore = 999
    for (let i = 0; i < hand.length; i++) {
      const t = hand[i]
      let score = 0
      let same = 0
      let near = 0
      hand.forEach((x: number) => {
        if (x === t) same += 1
        const d = x - t
        if ((d === 1 || d === 2 || d === -1 || d === -2) && Math.floor(x / 10) === Math.floor(t / 10)) near += 1
      })
      score -= same * 6
      score -= near * 3
      if (score < bestScore) {
        bestScore = score
        best = t
      }
    }
    return best
  }

  private mahjongPon(): void {
    const tile = this.mahjongClaim
    if (tile < 0 || this.mahjongCounts(this.mahjongHand)[tile] < 2) return
    const hand = this.mahjongHand.slice()
    hand.splice(hand.indexOf(tile), 1)
    hand.splice(hand.indexOf(tile), 1)
    this.mahjongHand = hand.sort((a: number, b: number) => a - b)
    this.mahjongMelds = this.mahjongMelds.concat([tile, tile, tile])
    const pool = this.mahjongPool.slice()
    const at = pool.lastIndexOf(tile)
    if (at >= 0) pool.splice(at, 1)
    this.mahjongPool = pool
    this.mahjongClearClaim()
    this.gameStatus = `碰 ${this.mahjongLabel(tile)}，请打出一张牌`
  }

  private mahjongKan(): void {
    const tile = this.mahjongClaim
    const mine = this.mahjongCounts(this.mahjongHand)
    if (tile >= 0 && mine[tile] < 3) return
    const target = tile >= 0 ? tile : this.mahjongFirstFour()
    if (target < 0) return
    const hand = this.mahjongHand.slice()
    for (let k = 0; k < 3; k++) {
      const at = hand.indexOf(target)
      if (at >= 0) hand.splice(at, 1)
    }
    if (tile >= 0) {
      const pool = this.mahjongPool.slice()
      const at = pool.lastIndexOf(tile)
      if (at >= 0) pool.splice(at, 1)
      this.mahjongPool = pool
    }
    this.mahjongMelds = this.mahjongMelds.concat([target, target, target, target])
    // 杠后补摸一张
    if (this.mahjongWall.length > 0) {
      const draw = this.mahjongWall[0]
      this.mahjongWall = this.mahjongWall.slice(1)
      this.mahjongWallCount = this.mahjongWall.length
      hand.push(draw)
      this.mahjongDrawn = draw
    }
    this.mahjongHand = hand.sort((a: number, b: number) => a - b)
    this.mahjongClearClaim()
    this.gameStatus = `杠 ${this.mahjongLabel(target)}，请打出一张牌`
  }

  private mahjongFirstFour(): number {
    const counts = this.mahjongCounts(this.mahjongHand)
    for (let i = 0; i < 27; i++) {
      if (counts[i] === 4) return i
    }
    return -1
  }

  private mahjongChi(): void {
    const tile = this.mahjongClaim
    if (tile < 0) return
    const options = this.mahjongChiOptions(tile)
    if (options.length === 0) return
    const meld = options[0]
    const hand = this.mahjongHand.slice()
    hand.splice(hand.indexOf(meld[0]), 1)
    hand.splice(hand.indexOf(meld[1]), 1)
    this.mahjongHand = hand.sort((a: number, b: number) => a - b)
    this.mahjongMelds = this.mahjongMelds.concat(meld)
    const pool = this.mahjongPool.slice()
    const at = pool.lastIndexOf(tile)
    if (at >= 0) pool.splice(at, 1)
    this.mahjongPool = pool
    this.mahjongClearClaim()
    this.gameStatus = `吃 ${meld.map((t: number) => this.mahjongLabel(t)).join(' ')}，请打出一张牌`
  }

  private mahjongHu(): void {
    const tile = this.mahjongClaim
    const hand = tile >= 0 ? this.mahjongHand.concat([tile]) : this.mahjongHand
    if (!this.mahjongCanWin(hand.slice().sort((a: number, b: number) => a - b))) {
      this.gameStatus = '这副牌还不能胡'
      return
    }
    this.mahjongWinner = 0
    this.gameStatus = `胡牌！🏆 ${this.mahjongFanText(hand)}`
  }

  private mahjongFanText(hand: number[]): string {
    const counts = this.mahjongCounts(hand)
    let suits = 0
    for (let s = 0; s < 3; s++) {
      for (let v = 0; v < 9; v++) {
        if (counts[s * 10 + v] > 0) {
          suits = s + 1
          break
        }
      }
    }
    let oneSuit = true
    const first = Math.floor(hand[0] / 10)
    hand.forEach((t: number) => {
      if (Math.floor(t / 10) !== first) oneSuit = false
    })
    let pairs = 0
    let triples = 0
    for (let i = 0; i < 27; i++) {
      if (counts[i] === 2) pairs += 1
      if (counts[i] >= 3) triples += 1
    }
    if (pairs === 7) return '七对'
    if (oneSuit) return '清一色'
    if (triples === 4) return '碰碰胡'
    return '平胡'
  }

  private mahjongClearClaim(): void {
    this.mahjongClaim = -1
    this.mahjongCanPon = false
    this.mahjongCanKan = false
    this.mahjongCanChi = false
    this.mahjongCanHu = false
  }

  private mahjongPass(): void {
    this.mahjongClearClaim()
    this.mahjongAiLoop(1)
  }

  @Builder
  MahjongTable() {
    Column({ space: 12 }) {
      Row() {
        Text(`牌墙 ${this.mahjongWallCount}`)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        ForEach(['下家', '对家', '上家'], (seat: string, index: number) => {
          Text(`${seat} ${this.mahjongAiCounts[index]}张`)
            .fontSize(12)
            .fontColor(this.mutedColor())
        }, (seat: string) => `mj-seat-${seat}`)
      }
      .width('100%')
      Text(this.mahjongWinner === 0 ? '你胡牌了！🏆' :
        (this.mahjongWinner > 0 ? `对手 ${this.mahjongWinner} 胡牌` :
          (this.mahjongTurn === 0 ? '你的回合' : '对手思考中…')))
        .width('100%')
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      if (this.mahjongMelds.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.mahjongMelds, (tile: number, index: number) => {
            Text(this.mahjongLabel(tile))
              .width(34)
              .height(46)
              .margin(2)
              .fontSize(13)
              .fontColor('#172033')
              .textAlign(TextAlign.Center)
              .backgroundColor('#DCE6DF')
              .borderRadius(4)
          }, (tile: number, index: number) => `mj-meld-${index}-${tile}`)
        }
        .width('100%')
      }
      Text('牌河')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.mahjongPool, (tile: number, index: number) => {
          Text(this.mahjongLabel(tile))
            .width(30)
            .height(40)
            .margin(2)
            .fontSize(11)
            .fontColor('#5A6672')
            .textAlign(TextAlign.Center)
            .backgroundColor('#EDE7DA')
            .borderRadius(4)
        }, (tile: number, index: number) => `mj-pool-${index}-${tile}`)
      }
      .width('100%')
      .height(88)
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.mahjongHand, (tile: number, index: number) => {
          Text(this.mahjongLabel(tile))
            .width(44)
            .height(60)
            .margin(3)
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor('#172033')
            .textAlign(TextAlign.Center)
            .backgroundColor(tile === this.mahjongDrawn ? '#F5C542' : '#FFFDF7')
            .border({ width: 1.5, color: '#B9AD99' })
            .borderRadius(6)
            .onClick(() => this.mahjongDiscard(index))
        }, (tile: number, index: number) => `mj-hand-${index}-${tile}`)
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('摸牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .enabled(this.mahjongTurn === 0 && this.mahjongWinner < 0 && this.mahjongClaim < 0 && this.mahjongDrawn < 0)
          .onClick(() => this.mahjongDraw())
        Button('碰')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.mahjongCanPon ? '#2E7D5B' : this.controlColor())
          .fontColor(this.mahjongCanPon ? '#FFFFFF' : this.controlTextColor())
          .enabled(this.mahjongCanPon)
          .onClick(() => this.mahjongPon())
        Button('杠')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.mahjongCanKan ? '#2E7D5B' : this.controlColor())
          .fontColor(this.mahjongCanKan ? '#FFFFFF' : this.controlTextColor())
          .enabled(this.mahjongCanKan)
          .onClick(() => this.mahjongKan())
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('吃')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.mahjongCanChi ? '#2E7D5B' : this.controlColor())
          .fontColor(this.mahjongCanChi ? '#FFFFFF' : this.controlTextColor())
          .enabled(this.mahjongCanChi)
          .onClick(() => this.mahjongChi())
        Button('胡')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.mahjongCanHu ? '#C0392B' : this.controlColor())
          .fontColor(this.mahjongCanHu ? '#FFFFFF' : this.controlTextColor())
          .enabled(this.mahjongCanHu)
          .onClick(() => this.mahjongHu())
        Button('过')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .enabled(this.mahjongClaim >= 0)
          .onClick(() => this.mahjongPass())
      }
      .width('100%')
      Button('重开一局')
        .width('100%')
        .height(40)
        .backgroundColor(this.controlColor())
        .fontColor(this.controlTextColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .onClick(() => this.startMahjong())
      Text(this.gameStatus)
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

  // ===== 扑克：炸金花（3 张比牌型）=====
  private pokerLabel(t: number): string {
    const ranks: string[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
    const suits: string[] = ['♠', '♥', '♣', '♦']
    return `${ranks[t % 13]}${suits[Math.floor(t / 13)]}`
  }

  private pokerRankValue(t: number): number {
    const r = t % 13
    return r === 0 ? 14 : r
  }

  // 牌型：0 散牌 / 1 对子 / 2 顺子 / 3 金花 / 4 顺金 / 5 豹子
  private pokerTypeOf(hand: number[]): number {
    if (hand.length !== 3) return 0
    const a = this.pokerRankValue(hand[0])
    const b = this.pokerRankValue(hand[1])
    const c = this.pokerRankValue(hand[2])
    const vs: number[] = [a, b, c].sort((x: number, y: number) => x - y)
    const flush = Math.floor(hand[0] / 13) === Math.floor(hand[1] / 13) &&
      Math.floor(hand[1] / 13) === Math.floor(hand[2] / 13)
    const straight = (vs[1] === vs[0] + 1 && vs[2] === vs[1] + 1) || (vs[0] === 2 && vs[1] === 3 && vs[2] === 14)
    const triple = a === b && b === c
    const pair = !triple && (a === b || b === c || a === c)
    if (triple) return 5
    if (flush && straight) return 4
    if (flush) return 3
    if (straight) return 2
    if (pair) return 1
    return 0
  }

  private pokerTypeName(type: number): string {
    const names: string[] = ['散牌', '对子', '顺子', '金花', '顺金', '豹子']
    return names[type]
  }

  // 比较用分值：类型 * 1e6 + 牌力
  private pokerScoreOf(hand: number[]): number {
    const type = this.pokerTypeOf(hand)
    const vs: number[] = hand.map((t: number) => this.pokerRankValue(t)).sort((x: number, y: number) => x - y)
    let power = 0
    if (type === 5) {
      power = vs[2] * 10000
    } else if (type === 1) {
      let pairV = vs[0]
      if (vs[0] === vs[1]) pairV = vs[0]
      else if (vs[1] === vs[2]) pairV = vs[1]
      power = pairV * 10000 + vs[0] + vs[1] + vs[2] - pairV
    } else if (type === 2 || type === 4) {
      const top = (vs[0] === 2 && vs[1] === 3 && vs[2] === 14) ? 3 : vs[2]
      power = top * 10000
    } else {
      power = vs[2] * 10000 + vs[1] * 100 + vs[0]
    }
    return type * 1000000 + power
  }

  private startPoker(): void {
    const deck: number[] = []
    for (let i = 0; i < 52; i++) deck.push(i)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = deck[i]
      deck[i] = deck[j]
      deck[j] = tmp
    }
    this.pokerHand = deck.slice(0, 3)
    this.pokerAiHands = [deck.slice(3, 6), deck.slice(6, 9), deck.slice(9, 12)]
    this.pokerPot = 60
    this.pokerChip = 1000 - 20
    this.pokerBet = 20
    this.pokerRound = 1
    this.pokerWinner = -1
    this.pokerReveal = false
    this.pokerAlive = [true, true, true, true]
    this.pokerLog = '底注 ¥20 已下，请选择跟注 / 加注 / 弃牌'
  }

  private pokerCall(): void {
    if (this.pokerWinner >= 0) return
    const bet = this.pokerBet
    if (this.pokerChip < bet) {
      this.pokerLog = '筹码不足，只能弃牌'
      return
    }
    this.pokerChip -= bet
    this.pokerPot += bet
    this.pokerLog = `你跟注 ¥${bet}，底池 ¥${this.pokerPot}`
    this.pokerAiAct()
  }

  private pokerRaise(): void {
    if (this.pokerWinner >= 0) return
    const add = 40
    if (this.pokerChip < this.pokerBet + add) {
      this.pokerLog = '筹码不足，只能跟注或弃牌'
      return
    }
    this.pokerChip -= this.pokerBet + add
    this.pokerPot += this.pokerBet + add
    this.pokerBet += add
    this.pokerLog = `你加注到 ¥${this.pokerBet}，底池 ¥${this.pokerPot}`
    this.pokerAiAct()
  }

  private pokerView(): void {
    if (this.pokerWinner >= 0) return
    const fee = this.pokerBet * 2
    if (this.pokerChip < fee) {
      this.pokerLog = '开牌需要双倍注，筹码不足'
      return
    }
    this.pokerChip -= fee
    this.pokerPot += fee
    this.pokerShowdown()
  }

  private pokerFold(): void {
    if (this.pokerWinner >= 0) return
    const alive = this.pokerAlive.slice()
    alive[0] = false
    this.pokerAlive = alive
    this.pokerWinner = 1
    this.pokerReveal = true
    this.pokerLog = '你弃牌了，本局由对手拿下底池'
  }

  private pokerAiAct(): void {
    setTimeout(() => {
      let aliveCount = 0
      this.pokerAlive.forEach((a: boolean) => {
        if (a) aliveCount += 1
      })
      for (let i = 1; i < 4; i++) {
        if (!this.pokerAlive[i]) continue
        const score = this.pokerScoreOf(this.pokerAiHands[i - 1])
        const type = this.pokerTypeOf(this.pokerAiHands[i - 1])
        const alive = this.pokerAlive.slice()
        if (type === 0 && score % 1000000 < 100000) {
          if (Math.random() < 0.5) {
            alive[i] = false
            this.pokerAlive = alive
          }
        }
      }
      this.pokerRound += 1
      if (this.pokerRound > 2) {
        this.pokerShowdown()
        return
      }
      this.pokerLog = `第 ${this.pokerRound} 轮下注 · 底池 ¥${this.pokerPot}`
    }, 500)
  }

  private pokerShowdown(): void {
    this.pokerReveal = true
    let best = -1
    let bestScore = -1
    for (let i = 0; i < 4; i++) {
      if (!this.pokerAlive[i]) continue
      const hand = i === 0 ? this.pokerHand : this.pokerAiHands[i - 1]
      const score = this.pokerScoreOf(hand)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    this.pokerWinner = best
    if (best === 0) {
      this.pokerChip += this.pokerPot
      this.pokerLog = `你赢下底池 ¥${this.pokerPot}！🏆 ${this.pokerTypeName(this.pokerTypeOf(this.pokerHand))}`
    } else if (best > 0) {
      this.pokerLog = `对手 ${best} 以${this.pokerTypeName(this.pokerTypeOf(this.pokerAiHands[best - 1]))}赢下底池 ¥${this.pokerPot}`
    } else {
      this.pokerLog = '所有人都弃牌了'
    }
  }

  @Builder
  PokerTable() {
    Column({ space: 12 }) {
      Row() {
        Text(`底池 ¥${this.pokerPot}`)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Text(`我的筹码 ¥${this.pokerChip}`)
          .fontSize(14)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      Text(`当前注 ¥${this.pokerBet} · ${this.pokerTypeName(this.pokerTypeOf(this.pokerHand))}`)
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.accentColor())
      Row({ space: 8 }) {
        ForEach(this.pokerHand, (card: number, index: number) => {
          Text(this.pokerLabel(card))
            .width(58)
            .height(80)
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(card % 13 === 1 || card % 13 === 3 ? '#C0392B' : '#172033')
            .textAlign(TextAlign.Center)
            .backgroundColor('#FFFDF7')
            .border({ width: 1.5, color: '#B9AD99' })
            .borderRadius(6)
        }, (card: number, index: number) => `poker-my-${index}-${card}`)
      }
      .width('100%')
      Text('对手（开牌后亮出）')
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
      Row({ space: 8 }) {
        ForEach(['对手1', '对手2', '对手3'], (name: string, index: number) => {
          Column({ space: 4 }) {
            Text(name)
              .fontSize(12)
              .fontColor(this.mutedColor())
            if (this.pokerReveal && this.pokerAlive[index + 1]) {
              Text(this.pokerAiHands[index].map((c: number) => this.pokerLabel(c)).join(' '))
                .fontSize(11)
                .fontColor(this.textColor())
            } else {
              Text(this.pokerAlive[index + 1] ? '🂠 🂠 🂠' : '已弃牌')
                .fontSize(14)
                .fontColor(this.pokerAlive[index + 1] ? '#5A6672' : '#9AA5B1')
            }
          }
          .layoutWeight(1)
          .padding(6)
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(6)
        }, (name: string) => `poker-ai-${name}`)
      }
      .width('100%')
      Text(this.pokerLog)
        .width('100%')
        .fontSize(13)
        .fontColor(this.textColor())
        .maxLines(2)
      Row({ space: 8 }) {
        Button(`跟注 ¥${this.pokerBet}`)
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .enabled(this.pokerWinner < 0)
          .onClick(() => this.pokerCall())
        Button('加注 +40')
          .layoutWeight(1)
          .height(42)
          .backgroundColor('#2E7D5B')
          .enabled(this.pokerWinner < 0)
          .onClick(() => this.pokerRaise())
      }
      .width('100%')
      Row({ space: 8 }) {
        Button('开牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor('#B7791F')
          .enabled(this.pokerWinner < 0)
          .onClick(() => this.pokerView())
        Button('弃牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .enabled(this.pokerWinner < 0)
          .onClick(() => this.pokerFold())
      }
      .width('100%')
      Button('重开一局')
        .width('100%')
        .height(40)
        .backgroundColor(this.controlColor())
        .fontColor(this.controlTextColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .onClick(() => this.startPoker())
      Text('牌型：豹子 > 顺金 > 金花 > 顺子 > 对子 > 散牌；A 算最大，A23 也算顺子。')
        .width('100%')
        .fontSize(11)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }


  @Builder
  PartyTable() {
    Column({ space: 14 }) {
      Text(this.gameTitle())
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(this.selectedGameInfo().note)
        .fontSize(14)
        .fontColor(this.mutedColor())
      Row({ space: 10 }) {
        ForEach(['1', '2', '3', '4'], (seat: string) => {
          Column({ space: 6 }) {
            Text(seat)
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
            Text(seat === '1' ? '你' : '空位')
              .fontSize(12)
              .fontColor('#FFFFFF')
          }
          .layoutWeight(1)
          .height(96)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(seat === '1' ? this.accentColor() : this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
        })
      }
      .width('100%')
      Button(this.roomId === '本地' ?
        (this.localAiEnabled ? '关闭 AI 陪练' : '加入 AI 玩家') : '邀请玩家')
        .width('100%')
        .height(44)
        .backgroundColor(this.accentColor())
        .onClick(() => {
          if (this.roomId === '本地') {
            this.setLocalAiMode(!this.localAiEnabled)
            return
          }
          this.openSystemInvite()
        })
    }
    .width('100%')
    .padding(18)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  // 军棋棋子宽度（vp）。底图 5 列跨 11.54%~88.46%（4 个间隔），列距 = 19.23% 宽。
  // 实物军棋子为 2.6 × 1.9 × 0.9 cm 的**长方牌**（宽高比 1.37:1），不是正方形；
  // 棋子宽约为列距的 0.73。旧代码写死 12.6% × 5.4%（宽高比 2.33，被压成扁条）
  // 且字号只有 13fp，结果又小又扁、字挤在中间。
  private junqiPieceSize(): number {
    return Math.max(28, Math.round(this.junqiBoardWidth() * 0.1923 * 0.73))
  }

  // 棋子高度 = 宽 / 1.37（实物比例）
  private junqiPieceHeight(): number {
    return Math.max(20, Math.round(this.junqiPieceSize() / 1.37))
  }

  @Builder
  JunqiBoard() {
    Column({ space: 10 }) {
      Stack() {
        Image(this.boardArtwork('junqi'))
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Fill)
        ForEach(Array(60).fill(0), (_: number, index: number) => {
          if (this.junqiBoard[index].length > 0) {
            // 长方牌（宽高比 1.37:1，仿实物），字号跟着棋子高度走而不是写死。
            Text(this.junqiKnown[index] ? this.junqiShortName(this.junqiBoard[index]) : '?')
              .fontSize(Math.max(12, Math.min(34, this.junqiPieceHeight() * 0.64)))
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Center)
              .width(this.junqiPieceSize())
              .height(this.junqiPieceHeight())
              // 未揭晓的敌方棋子一律显示深色背面（带 ?），己方与已交火过的才显示真实字
              .backgroundColor(!this.junqiKnown[index] ? '#2F3A4A' :
                (this.junqiSideOf(this.junqiBoard[index]) === 'r' ? '#B23A2E' : '#2E5C8A'))
              .borderRadius(5)
              // 米色细边：实物是浅木色边，深色描边会显得像塑料按钮
              .border({ width: this.junqiSelected === index ? 3 : 1.5, color: this.junqiSelected === index ? '#F5C542' : '#F2E6CE' })
              .shadow({ radius: 3, color: 'rgba(30,35,45,0.45)', offsetX: 1, offsetY: 1.5 })
              .position({ x: `${this.junqiPosX[index]}%`, y: `${this.junqiPosY[index]}%` })
              .markAnchor({ x: '50%', y: '50%' })
              .onClick(() => this.junqiTap(index))
          }
        }, (_: number, index: number) => `junqi-piece-${index}`)
        ForEach(Array(60).fill(0), (_: number, index: number) => {
          if (this.junqiBoard[index].length === 0 && this.junqiSelected >= 0 &&
            this.junqiMovesFrom(this.junqiSelected).indexOf(index) >= 0) {
            Text('·')
              .fontSize(Math.max(14, Math.min(40, this.junqiPieceHeight() * 0.78)))
              .fontWeight(FontWeight.Bold)
              .fontColor('#F5C542')
              .textAlign(TextAlign.Center)
              // 与棋子同尺寸同形状，可落点提示才能准确框住落点
              .width(this.junqiPieceSize())
              .height(this.junqiPieceHeight())
              .backgroundColor('rgba(245,197,66,0.25)')
              .borderRadius(5)
              .border({ width: 1.5, color: '#F5C542' })
              .position({ x: `${this.junqiPosX[index]}%`, y: `${this.junqiPosY[index]}%` })
              .markAnchor({ x: '50%', y: '50%' })
              .onClick(() => this.junqiTap(index))
          }
        }, (_: number, index: number) => `junqi-target-${index}`)
      }
      // junqi_board.png 实测 520×1298（含山界 GAP 78），比例 0.40
      .aspectRatio(0.40)
      // 军棋是「窄长条」棋盘。若沿用其它棋类的 width('100%')，宽度顶满屏幕后
      // 两侧会留出大片空白（真机截图里就是这样，棋盘只占中间一条）。
      // 宽度封顶 520vp（底图原始宽度）并限高，棋盘就会居中显示、不留空。
      .constraintSize({ maxWidth: 520, minWidth: 220, maxHeight: '78%' })
      Text(this.gameStatus)
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor('#172033')
        .textAlign(TextAlign.Center)
        .width('100%')
        .padding(10)
        .backgroundColor('#FFFFFF')
        .borderRadius(8)
      Row({ space: 10 }) {
        Button('重新布局')
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .onClick(() => this.junqiReset())
        Button('提示可动棋子')
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.accentColor())
          .onClick(() => this.junqiHint())
      }
      .width('100%')
    }
    .width(this.junqiBoardWidth())
    .padding(8)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  PlayArea() {
    if (this.selectedGame === 'gobang') {
      Column() {
        this.GomokuBoard()
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
    } else if (this.selectedGame === 'reversi') {
      this.ReversiBoard()
    } else if (this.selectedGame === 'tictactoe') {
      this.TicTacToeBoard()
    } else if (this.selectedGame === 'go') {
      this.GoBoard()
    } else if (this.selectedGame === 'chinese-chess') {
      this.ChineseChessBoard()
    } else if (this.selectedGame === 'checkers') {
      this.CheckersBoard()
    } else if (this.selectedGame === 'world-chess') {
      this.WorldChessBoard()
    } else if (this.selectedGame === 'rummy') {
      this.RummyTable()
    } else if (this.selectedGame === 'ludo') {
      this.LudoBoard()
    } else if (this.selectedGame === 'junqi') {
      this.JunqiBoard()
    } else if (this.selectedGame === 'minesweeper') {
      this.MinesweeperBoard()
    } else if (this.selectedGame === 'monopoly') {
      this.MonopolyTable()
    } else if (this.selectedGame === 'landlord') {
      this.LandlordTable()
    } else if (this.selectedGame === 'guandan') {
      this.GuandanTable()
    } else if (this.selectedGame === 'mahjong') {
      this.MahjongTable()
    } else if (this.selectedGame === 'poker') {
      this.PokerTable()
    } else if (this.selectedGame === 'werewolf' || this.selectedGame === 'spy') {
      this.SocialDeductionTable()
    } else {
      this.PartyTable()
    }
  }

  @Builder
  ChatPanel() {
      Column({ space: 10 }) {
        Text('局内聊天')
          .width('100%')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        List({ space: 5 }) {
          ForEach(this.chatLines, (line: string) => {
            ListItem() {
              Text(line)
                .width('100%')
                .fontSize(13)
                .fontColor(this.mutedColor())
            }
          }, (line: string, index: number) => `${index}-${line}`)
        }
        .width('100%')
        .height(this.chatPanelHeight())
        Row({ space: 8 }) {
          TextInput({ text: this.chatText, placeholder: '输入消息' })
            .layoutWeight(1)
            .height(42)
            .backgroundColor(this.inputColor())
            .borderRadius(8)
            .onChange((value: string) => this.chatText = value)
          Button('发送')
            .height(42)
            .backgroundColor(this.accentColor())
            .borderRadius(8)
            .onClick(() => this.sendChat())
        }
        .width('100%')
      }
      .width('100%')
      .padding(14)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
  }

  @Builder
  InviteConfirmation() {
    Row({ space: 12 }) {
      Column({ space: 3 }) {
        Text(`${this.pendingInviteSource}邀请`)
          .fontSize(12)
          .fontColor(this.accentColor())
        Text(`${this.pendingInviteGame} · 房间 ${this.pendingInviteRoom}`)
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Button('取消')
        .height(38)
        .backgroundColor(this.controlColor())
        .fontColor(this.controlTextColor())
        .borderRadius(8)
        .onClick(() => {
          this.pendingInviteGame = ''
          this.pendingInviteRoom = ''
          this.pendingInviteSource = ''
        })
      Button('加入')
        .height(38)
        .backgroundColor(this.accentColor())
        .borderRadius(8)
        .onClick(() => this.acceptPendingInvite())
    }
    .width('100%')
    .padding(14)
    .backgroundColor(this.positiveSurfaceColor())
    .border({ width: 1, color: this.selectedBorderColor() })
    .borderRadius(8)
  }

  @Builder
  BoardStudyPanel() {
    Column({ space: 10 }) {
      Row({ space: 6 }) {
        ForEach([['play', '对局'], ['analysis', '分析'], ['puzzle', '残局'], ['editor', '自建']], (item: string[]) => {
          Button(item[1])
            .layoutWeight(1)
            .height(36)
            .fontSize(12)
            .fontColor(this.studyMode === item[0] ? '#FFFFFF' : this.controlTextColor())
            .backgroundColor(this.studyMode === item[0] ? this.accentColor() : this.controlColor())
            .border({ width: 1, color: this.studyMode === item[0] ? this.selectedBorderColor() : this.themeBorderColor() })
            .borderRadius(7)
            .onClick(() => this.startStudyMode(item[0]))
        })
      }
      .width('100%')
      if (this.studyMode === 'editor') {
        if (this.selectedGame === 'chinese-chess') {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
            ForEach(['帥', '仕', '相', '傌', '俥', '炮', '兵', '將', '士', '象', '馬', '車', '砲', '卒', '清除'], (piece: string) => {
              Button(piece)
                .width(42)
                .height(34)
                .margin({ right: 5, bottom: 5 })
                .fontSize(12)
                .fontColor(this.editorChessPiece === piece ? '#FFFFFF' : this.controlTextColor())
                .backgroundColor(this.editorChessPiece === piece ? this.lacquerColor() : this.controlColor())
                .borderRadius(6)
                .onClick(() => this.editorChessPiece = piece)
            })
          }
          .width('100%')
        } else {
          Row({ space: 8 }) {
            ForEach([['1', '黑子'], ['2', '白子'], ['0', '清除']], (tool: string[]) => {
              Button(tool[1])
                .layoutWeight(1)
                .height(34)
                .fontSize(12)
                .fontColor(this.editorTool === tool[0] ? '#FFFFFF' : this.controlTextColor())
                .backgroundColor(this.editorTool === tool[0] ? this.accentColor() : this.controlColor())
                .borderRadius(6)
                .onClick(() => this.editorTool = tool[0])
            })
          }
          .width('100%')
        }
        Row({ space: 8 }) {
          Button(this.currentPiece === 1 ? '执棋：先手' : '执棋：后手')
            .layoutWeight(1)
            .height(36)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .borderRadius(7)
            .onClick(() => this.currentPiece = this.currentPiece === 1 ? 2 : 1)
          Button('检查局面')
            .layoutWeight(1)
            .height(36)
            .backgroundColor(this.accentColor())
            .borderRadius(7)
            .onClick(() => this.checkEditorBoard())
        }
        .width('100%')
      } else if (this.studyMode === 'analysis' || this.studyMode === 'puzzle') {
        Row({ space: 8 }) {
          Button('分析当前局面')
            .layoutWeight(1)
            .height(36)
            .fontColor(this.controlTextColor())
            .backgroundColor(this.controlColor())
            .borderRadius(7)
            .onClick(() => this.analyzeCurrentBoard())
          Button('走推荐着')
            .layoutWeight(1)
            .height(36)
            .backgroundColor(this.accentColor())
            .borderRadius(7)
            .onClick(() => this.applyRecommendedMove())
        }
        .width('100%')
        if (this.studyMode === 'puzzle') {
          Text('题面已摆好，只需走下一步；自建棋盘请切换到“自建”。')
            .width('100%')
            .fontSize(12)
            .fontColor(this.mutedColor())
          Row({ space: 6 }) {
            Button('提示')
              .layoutWeight(1)
              .height(34)
              .fontColor(this.controlTextColor())
              .backgroundColor(this.controlColor())
              .onClick(() => this.showPuzzleHint())
            Button('重新开始本题')
              .layoutWeight(1)
              .height(34)
              .fontColor(this.controlTextColor())
              .backgroundColor(this.controlColor())
              .onClick(() => this.resetPuzzle())
            Button('下一题')
              .layoutWeight(1)
              .height(34)
              .backgroundColor(this.accentColor())
              .onClick(() => this.startStudyMode('puzzle'))
            Button('退出残局')
              .layoutWeight(1)
              .height(34)
              .fontColor(this.controlTextColor())
              .backgroundColor(this.controlColor())
              .onClick(() => this.exitPuzzle())
          }
          .width('100%')
        }
      }
      Text(this.studyText)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
        .lineHeight(18)
    }
    .width('100%')
    .padding(10)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  GameRoom() {
    Column({ space: 14 }) {
      Column({ space: 5 }) {
        Row() {
          Text(this.roomId === '本地' ? '本地练习' : `房间 ${this.roomId}`)
            .fontSize(13)
            .fontColor(this.mutedColor())
          Blank()
          Text(this.roomStatus)
            .fontSize(12)
            .fontColor(this.roomStatus === '对局中' ? '#176B45' : '#8A5A1F')
        }
        .width('100%')
        Text(this.gameStatus)
          .width('100%')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
      }
      .width('100%')

      Row() {
        if (this.roomId !== '本地' && this.isOwner && this.roomStatus !== '对局中') {
          Button('开始游戏')
            .height(38)
            .backgroundColor(this.accentColor())
            .borderRadius(8)
            .onClick(() => this.startGame())
        }
        Blank()
        Button(this.roomId === '本地' ? '重开' : '申请重开')
          .height(36)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .borderRadius(8)
          .onClick(() => {
            if (this.roomId === '本地') {
              this.resetBoard()
            } else {
              let payload: RoomOnlyPayload = { roomId: this.roomId }
              this.emitSocket('reset-request', payload)
            }
          })
        if (this.roomId !== '本地') {
          Button('更多')
            .height(36)
            .margin({ left: 8 })
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .border({ width: 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.gameMoreOpen = !this.gameMoreOpen)
        }
      }
      .width('100%')

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

      if (this.roomId === '本地' && this.supportsLocalAi()) {
        Row({ space: 8 }) {
          Button('🤖 AI 陪练')
            .layoutWeight(1)
            .height(44)
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.localAiEnabled ? '#FFFFFF' : this.controlTextColor())
            .backgroundColor(this.localAiEnabled ? this.accentColor() : this.controlColor())
            .border({ width: this.localAiEnabled ? 0 : 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.setLocalAiMode(true))
          Button('👥 线下多人')
            .layoutWeight(1)
            .height(44)
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor(!this.localAiEnabled ? '#FFFFFF' : this.controlTextColor())
            .backgroundColor(!this.localAiEnabled ? this.accentColor() : this.controlColor())
            .border({ width: !this.localAiEnabled ? 0 : 1, color: this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.setLocalAiMode(false))
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }

      if (this.roomId === '本地') {
        Row({ space: 8 }) {
          Text('AI 难度')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.mutedColor())
          ForEach(['轻松', '标准', '困难'], (level: string) => {
            Button(level)
              .layoutWeight(1)
              .height(36)
              .fontSize(12)
              .fontColor(this.aiDifficulty === level ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.aiDifficulty === level ? this.accentColor() : this.controlColor())
              .border({ width: 1, color: this.aiDifficulty === level ? this.selectedBorderColor() : this.themeBorderColor() })
              .borderRadius(8)
              .onClick(() => {
                this.aiDifficulty = level
                this.persistSettings()
                this.gameStatus = `${level} AI 已就绪`
              })
          })
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }

      if (this.roomId === '本地' && this.supportsBoardStudy()) {
        this.BoardStudyPanel()
      }

      if (this.roomId !== '本地' && this.gameMoreOpen) {
        Column({ space: 8 }) {
          Text('跨设备继续')
            .width('100%')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.mutedColor())
          Row({ space: 8 }) {
            Button('隔空投送邀请')
              .layoutWeight(1)
              .height(40)
              .backgroundColor(this.accentColor())
              .borderRadius(8)
              .onClick(() => this.openSystemInvite())
            Button('在网页中继续')
              .layoutWeight(1)
              .height(40)
              .backgroundColor(this.accentPressedColor())
              .borderRadius(8)
              .onClick(() => this.continueOnWeb())
          }
          .width('100%')
          Button('显示二维码 / 房间号')
            .width('100%')
            .height(40)
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .borderRadius(8)
            .onClick(() => this.showInviteFallback())
        }
        .width('100%')
        .padding(12)
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }

      if (this.roomId !== '本地' && this.inviteFallbackOpen) {
        Column({ space: 10 }) {
          Row() {
            Column({ space: 3 }) {
              Text('邀请这一桌')
                .fontSize(17)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.textColor())
              Text(`${this.gameTitle()} · 房间 ${this.roomId}`)
                .fontSize(13)
                .fontColor(this.mutedColor())
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            Button('关闭')
              .height(34)
              .backgroundColor(this.controlColor())
              .fontColor(this.controlTextColor())
              .borderRadius(8)
              .onClick(() => this.inviteFallbackOpen = false)
          }
          .width('100%')
          QRCode(this.inviteUrl)
            .width(this.windowWidth < 520 ? 176 : 210)
            .height(this.windowWidth < 520 ? 176 : 210)
            .color('#172033')
            .backgroundColor(this.cardColor())
          Text(`房间号 ${this.roomId}`)
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text('另一台设备可扫一扫，或手动输入房间号。邀请链接 10 分钟内有效。')
            .fontSize(12)
            .fontColor(this.mutedColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(16)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
        .alignItems(HorizontalAlign.Center)
      }

      if (this.resetPrompt.length > 0) {
        Row({ space: 10 }) {
          Text(this.resetPrompt)
            .layoutWeight(1)
            .fontSize(13)
            .fontColor(this.mutedColor())
          Button('拒绝')
            .height(36)
            .backgroundColor(this.controlColor())
            .fontColor(this.controlTextColor())
            .borderRadius(8)
            .onClick(() => this.voteReset(false))
          Button('同意')
            .height(36)
            .backgroundColor('#247A52')
            .borderRadius(8)
            .onClick(() => this.voteReset(true))
        }
        .width('100%')
        .padding(12)
        .backgroundColor(this.warningSurfaceColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }

      if (this.isWideWorkspace()) {
        Row({ space: 16 }) {
          Column() {
            this.PlayArea()
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Center)
          if (this.roomId !== '本地') {
            Column() {
              this.ChatPanel()
            }
            .width(360)
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
      } else {
        Column({ space: 14 }) {
          this.PlayArea()
          if (this.roomId !== '本地') {
            this.ChatPanel()
          }
        }
        .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  UpdateCenter() {
    Column({ space: 16 }) {
      Text('软件更新')
        .width('100%')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(this.updateText)
        .width('100%')
        .fontSize(14)
        .fontColor(this.mutedColor())
      Text(this.latestPackage)
        .width('100%')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.accentColor())
        .padding(16)
        .backgroundColor(this.positiveSurfaceColor())
        .border({ width: 1, color: this.selectedBorderColor() })
        .borderRadius(8)
      Button('检查站内最新安装包')
        .width('100%')
        .height(46)
        .backgroundColor(this.accentColor())
        .borderRadius(8)
        .onClick(() => this.checkUpdate())
      Column({ space: 8 }) {
        Text('无线调试升级')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text('正式签名包可通过已授权的无线 HDC 设备覆盖升级。未签名包会在安装前被阻止，避免损坏现有安装。')
          .width('100%')
          .fontSize(13)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
    }
    .width('100%')
  }

  @Builder
  RoomHub() {
    Column({ space: 16 }) {
      Column({ space: 10 }) {
        Text(this.gameTitle())
          .width('100%')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text(`建议人数 ${this.games.find((game: GameInfo) => game.id === this.selectedGame)?.players || '2 人'} · ${this.roomStatus}`)
          .width('100%')
          .fontSize(13)
          .fontColor(this.mutedColor())
        TextInput({ text: this.roomId, placeholder: '输入房间号' })
          .width('100%')
          .height(48)
          .backgroundColor(this.inputColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onChange((value: string) => this.roomId = value)
        Row({ space: 10 }) {
          Button('加入房间')
            .layoutWeight(1)
            .height(46)
            .backgroundColor(this.accentColor())
            .borderRadius(8)
            .onClick(() => this.joinRoom())
          Button('快速匹配')
            .layoutWeight(1)
            .height(46)
            .backgroundColor(this.accentPressedColor())
            .borderRadius(8)
            .onClick(() => this.quickMatch())
        }
        .width('100%')
        Button('本地 AI 练习')
          .width('100%')
          .height(44)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .borderRadius(8)
          .onClick(() => this.localGame())
      }
      .width('100%')
      .padding(18)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)

      Text('最近状态')
        .width('100%')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(this.connectionText)
        .width('100%')
        .fontSize(14)
        .fontColor(this.mutedColor())
        .padding(16)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
    }
    .width('100%')
  }

  @Builder
  MenuRow(title: string, detail: string, panel: string, icon: Resource) {
    Row({ space: 12 }) {
      SymbolGlyph(icon)
        .fontSize(22)
        .fontColor([this.accentColor()])
        .width(32)
      Column({ space: 3 }) {
        Text(title)
          .width('100%')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Text(detail)
          .width('100%')
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      SymbolGlyph($r('sys.symbol.chevron_forward'))
        .fontSize(18)
        .fontColor([this.mutedColor()])
    }
    .width('100%')
    .height(64)
    .padding({ left: 14, right: 14, top: 10, bottom: 10 })
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
    .onClick(() => this.openSecondary(panel))
  }

  @Builder
  Profile() {
    Column({ space: 16 }) {
      Row({ space: 14 }) {
        Text(this.playerName.substring(0, 1))
          .width(52)
          .height(52)
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .textAlign(TextAlign.Center)
          .backgroundColor(this.accentColor())
          .borderRadius(26)
        Column({ space: 4 }) {
          Text(this.playerName)
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(this.loginText)
            .fontSize(13)
            .fontColor(this.loginText.startsWith('已登录') ? this.accentColor() : this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(18)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)

      Text('账号')
        .width('100%')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      this.MenuRow('通行证账号', '登录、注册并同步房间身份', 'passport', $r('sys.symbol.key_horizontal'))

      Text('联机与战绩')
        .width('100%')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      this.MenuRow('公开房间', '查看正在等待玩家的房间', 'public', $r('sys.symbol.person_2'))
      this.MenuRow('排行榜', '查看当前游戏的积分排行', 'leaderboard', $r('sys.symbol.list_bullet_square'))

      Text('应用')
        .width('100%')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      this.MenuRow('外观与操作', '深浅色、玩家名称和 AI 难度', 'preferences', $r('sys.symbol.ai_edit'))
      this.MenuRow('检查更新', `HarmonyOS ${this.appVersion} · build ${this.appBuild}`, 'update', $r('sys.symbol.repeat_1'))
      this.MenuRow('反馈问题', '提交后可在网站后台查看和回复', 'feedback', $r('sys.symbol.message'))
      this.MenuRow('关于桌游中心', '版本、平台支持和服务说明', 'about', $r('sys.symbol.info_circle'))
    }
    .width('100%')
  }

  @Builder
  PassportPanel() {
    Column({ space: 14 }) {
      Text(this.loginText)
        .width('100%')
        .fontSize(14)
        .fontColor(this.loginText.startsWith('已登录') ? this.accentColor() : this.mutedColor())
        .padding(14)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      TextInput({ text: this.passportAccount, placeholder: '通行证账号 / 邮箱 / 手机' })
        .width('100%')
        .height(48)
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
        .onChange((value: string) => this.passportAccount = value)
      TextInput({ text: this.passportPassword, placeholder: '密码' })
        .width('100%')
        .height(48)
        .type(InputType.Password)
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
        .onChange((value: string) => this.passportPassword = value)
      Row({ space: 10 }) {
        Button('注册')
          .layoutWeight(1)
          .height(46)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => this.registerPassport())
        Button('登录')
          .layoutWeight(1)
          .height(46)
          .backgroundColor(this.accentColor())
          .borderRadius(8)
          .onClick(() => this.loginPassport())
      }
      .width('100%')
    }
    .width('100%')
  }

  @Builder
  PublicRoomsPanel() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 3 }) {
          Text(this.gameTitle())
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text('选择一间房直接加入')
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Button('刷新')
          .height(38)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .borderRadius(8)
          .onClick(() => this.loadPublicRooms())
      }
      .width('100%')
      ForEach(this.publicRooms, (room: string) => {
        Row() {
          Text(room)
            .layoutWeight(1)
            .fontSize(15)
            .fontColor(this.textColor())
          if (room.indexOf('房间 ') >= 0) {
            Button('加入')
              .height(38)
              .backgroundColor(this.accentColor())
              .borderRadius(8)
              .onClick(() => {
                this.roomId = room.substring(room.lastIndexOf('房间 ') + 3)
                this.joinRoom()
              })
          }
        }
        .width('100%')
        .height(60)
        .padding(14)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }, (room: string) => room)
      Button('快速匹配')
        .width('100%')
        .height(46)
        .backgroundColor(this.accentColor())
        .borderRadius(8)
        .onClick(() => this.quickMatch())
    }
    .width('100%')
  }

  @Builder
  LeaderboardPanel() {
    Column({ space: 12 }) {
      Row() {
        Text(`${this.gameTitle()}排行榜`)
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Button('刷新')
          .height(38)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .borderRadius(8)
          .onClick(() => this.loadLeaderboard())
      }
      .width('100%')
      ForEach(this.leaderboardRows, (row: string, index: number) => {
        Row({ space: 12 }) {
          Text(index < 3 ? `${index + 1}` : '·')
            .width(30)
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(index < 3 ? this.accentColor() : this.mutedColor())
          Text(row)
            .layoutWeight(1)
            .fontSize(15)
            .fontColor(this.textColor())
        }
        .width('100%')
        .height(56)
        .padding(12)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
      }, (row: string) => row)
    }
    .width('100%')
  }

  @Builder
  PreferencesPanel() {
    Column({ space: 16 }) {
      Column({ space: 10 }) {
        Text('外观')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], (item: string[]) => {
            Button(item[1])
              .layoutWeight(1)
              .height(42)
              .fontSize(12)
              .fontColor(this.themeMode === item[0] ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.themeMode === item[0] ? this.accentColor() : this.controlColor())
              .border({ width: 1, color: this.themeMode === item[0] ? this.selectedBorderColor() : this.themeBorderColor() })
              .borderRadius(8)
              .onClick(() => this.setTheme(item[0]))
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
        Text('玩家名称')
          .width('100%')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        TextInput({ text: this.playerName, placeholder: '输入玩家名称' })
          .width('100%')
          .height(46)
          .backgroundColor(this.inputColor())
          .borderRadius(8)
          .onChange((value: string) => {
            this.playerName = value
            this.persistSettings()
          })
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
      Column({ space: 10 }) {
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

  @Builder
  FeedbackPanel() {
    Column({ space: 12 }) {
      Text('问题会随平台和版本信息提交，登录后可在网站后台继续查看回复。')
        .width('100%')
        .fontSize(13)
        .fontColor(this.mutedColor())
      TextArea({ text: this.feedbackText, placeholder: '描述发生了什么，以及当时所在的页面或游戏。' })
        .width('100%')
        .height(160)
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
        .onChange((value: string) => this.feedbackText = value)
      Text(this.feedbackStatus)
        .width('100%')
        .fontSize(13)
        .fontColor(this.feedbackStatus.startsWith('已提交') ? this.accentColor() : this.mutedColor())
      Button('提交反馈')
        .width('100%')
        .height(46)
        .backgroundColor(this.accentColor())
        .borderRadius(8)
        .onClick(() => this.submitFeedback())
    }
    .width('100%')
  }

  @Builder
  AboutPanel() {
    Column({ space: 12 }) {
      Text('铮铮桌游单机版')
        .width('100%')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(`HarmonyOS ${this.appVersion} · build ${this.appBuild}`)
        .width('100%')
        .fontSize(15)
        .fontColor(this.accentColor())
      Text('支持 HarmonyOS 手机、平板与 2in1。无需网络或账号，游戏进度和偏好保存在本机。')
        .width('100%')
        .fontSize(14)
        .fontColor(this.mutedColor())
        .lineHeight(22)
      Text('铮铮实验室')
        .width('100%')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
    }
    .width('100%')
    .padding(18)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
  }

  @Builder
  BottomBar() {
    Row() {
      ForEach(this.navigationItems, (item: NavigationItem) => {
        Button() {
          Column({ space: 2 }) {
            SymbolGlyph(item.icon)
              .fontSize(21)
              .fontColor([this.activeTab === item.id ? this.accentColor() : this.mutedColor()])
            Text(item.title)
              .fontSize(11)
              .fontWeight(this.activeTab === item.id ? FontWeight.Bold : FontWeight.Regular)
              .fontColor(this.activeTab === item.id ? this.textColor() : this.mutedColor())
          }
        }
          .layoutWeight(1)
          .height(54)
          .backgroundColor(this.activeTab === item.id ? this.selectedCardColor() : this.cardColor())
          .borderRadius(5)
          .onClick(() => {
            this.page = 'lobby'
            this.secondaryPage = ''
            this.activeTab = item.id
          })
      }, (item: NavigationItem) => item.id)
    }
    .width('100%')
    .padding(6)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(7)
  }

  @Builder
  OfflineLobby() {
    Column({ space: 22 }) {
      Stack({ alignContent: Alignment.TopStart }) {
        Circle()
          .width(this.windowWidth < 520 ? 170 : 230)
          .height(this.windowWidth < 520 ? 170 : 230)
          .fill(Color.Transparent)
          .stroke(this.darkTheme() ? '#47715D' : '#4A8065')
          .strokeWidth(1)
          .opacity(0.55)
          .translate({ x: this.windowWidth < 520 ? 210 : 520, y: -56 })
        Circle()
          .width(this.windowWidth < 520 ? 112 : 154)
          .height(this.windowWidth < 520 ? 112 : 154)
          .fill(Color.Transparent)
          .stroke(this.brassColor())
          .strokeWidth(1)
          .opacity(0.45)
          .translate({ x: this.windowWidth < 520 ? 238 : 558, y: -28 })
        Column({ space: 16 }) {
          Row() {
            Text('TODAY / LOCAL TABLE')
              .fontSize(10)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.brassColor())
            Blank()
            Text('不联网')
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.tableInkColor())
          }
          .width('100%')
          Row({ space: 16 }) {
            Column({ space: 5 }) {
              Text('现在开一桌')
                .fontSize(this.windowWidth < 520 ? 28 : 36)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.tableInkColor())
              Text(`${this.gameTitle()} · ${this.selectedGameInfo().players}`)
                .fontSize(14)
                .fontColor(this.darkTheme() ? '#D8E1DA' : '#DCE8E0')
              Text(this.selectedGameInfo().note)
                .fontSize(12)
                .fontColor(this.darkTheme() ? '#B8C8BF' : '#BFD2C6')
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            Stack() {
              Image(this.selectedGameInfo().icon)
                .width(this.windowWidth < 520 ? 68 : 88)
                .height(this.windowWidth < 520 ? 68 : 88)
                .objectFit(ImageFit.Contain)
            }
            .width(this.windowWidth < 520 ? 82 : 104)
            .height(this.windowWidth < 520 ? 82 : 104)
            .backgroundColor(this.darkTheme() ? '#315C47' : '#3C7658')
            .border({ width: 1, color: this.brassColor() })
            .borderRadius(8)
          }
          .width('100%')
          Row({ space: 10 }) {
            Button('开始对局')
              .layoutWeight(1)
              .height(48)
              .fontColor(this.textColor())
              .backgroundColor(this.darkTheme() ? '#F2EFE5' : '#FFFEF8')
              .borderRadius(6)
              .onClick(() => this.localGame())
            Button('换游戏')
              .height(48)
              .fontColor(this.tableInkColor())
              .backgroundColor(this.darkTheme() ? '#315C47' : '#3A7457')
              .border({ width: 1, color: this.brassColor() })
              .borderRadius(6)
              .onClick(() => this.activeTab = 'games')
          }
          .width('100%')
        }
        .width('100%')
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 18, bottom: 20 })
      .backgroundColor(this.tableColor())
      .borderRadius(8)

      Row() {
        Column({ space: 3 }) {
          Text('桌游书架')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(`${this.offlineGames().length} 款本地游戏 · 进度留在这台设备`)
            .fontSize(12)
            .fontColor(this.mutedColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Button() {
          SymbolGlyph($r('sys.symbol.chevron_forward'))
            .fontSize(18)
            .fontColor([this.controlTextColor()])
        }
          .width(40)
          .height(40)
          .backgroundColor(this.controlColor())
          .borderRadius(5)
          .accessibilityText('查看全部游戏')
          .onClick(() => this.activeTab = 'games')
      }
      .width('100%')

      Grid() {
        ForEach(this.offlineGames().slice(0, this.windowWidth < 520 ? 4 : 8), (game: GameInfo) => {
          GridItem() {
            this.GameCard(game)
          }
        }, (game: GameInfo) => `offline-featured-${game.id}`)
      }
      .columnsTemplate(this.gameColumns())
      .columnsGap(10)
      .rowsGap(10)
      .width('100%')

      Row({ space: 14 }) {
        Stack() {
          SymbolGlyph($r('sys.symbol.ai_edit'))
            .fontSize(25)
            .fontColor([this.brassColor()])
        }
        .width(48)
        .height(48)
        .backgroundColor(this.darkTheme() ? '#332D21' : '#F1E7D3')
        .borderRadius(6)
        Column({ space: 3 }) {
          Text(`陪练强度 · ${this.aiDifficulty}`)
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text('难度与防误碰可在“我的”中调整')
            .fontSize(12)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .borderRadius(7)
    }
    .width('100%')
  }

  @Builder
  OfflineLibrary() {
    Column({ space: 16 }) {
      Row() {
        Column({ space: 3 }) {
          Text('选择桌游')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text('选择后直接开始，不需要房间号')
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Button('开始')
          .height(42)
          .backgroundColor(this.accentColor())
          .borderRadius(8)
          .onClick(() => this.localGame())
      }
      .width('100%')
      Grid() {
        ForEach(this.offlineGames(), (game: GameInfo) => {
          GridItem() {
            this.GameCard(game)
          }
        }, (game: GameInfo) => `offline-${game.id}`)
      }
      .columnsTemplate(this.gameColumns())
      .columnsGap(12)
      .rowsGap(12)
      .width('100%')
    }
    .width('100%')
  }

  @Builder
  OfflineProfile() {
    Column({ space: 16 }) {
      Row({ space: 14 }) {
        Image($r('app.media.app_icon'))
          .width(58)
          .height(58)
          .borderRadius(12)
        Column({ space: 4 }) {
          Text('铮铮桌游单机版')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text(`HarmonyOS ${this.appVersion} · build ${this.appBuild}`)
            .fontSize(13)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.cardColor())
      .border({ width: 1, color: this.themeBorderColor() })
      .borderRadius(8)
      this.MenuRow('外观与操作', '深浅色、玩家名称和 AI 难度', 'preferences', $r('sys.symbol.ai_edit'))
      this.MenuRow('关于单机版', '版本、支持设备与本地数据说明', 'about', $r('sys.symbol.info_circle'))
    }
    .width('100%')
  }

  build() {
    Column({ space: 10 }) {
      Scroll() {
        Column({ space: 20 }) {
          this.TopBar()
          if (this.secondaryPage === 'preferences') {
            this.PreferencesPanel()
          } else if (this.secondaryPage === 'about') {
            this.AboutPanel()
          } else if (this.page === 'game') {
            this.GameRoom()
          } else if (this.activeTab === 'lobby') {
            this.OfflineLobby()
          } else if (this.activeTab === 'games') {
            this.OfflineLibrary()
          } else if (this.activeTab === 'profile') {
            this.OfflineProfile()
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: this.contentMaxWidth() })
        .padding({ left: this.pagePadding(), right: this.pagePadding(), top: this.windowHeight < 620 ? 12 : 22, bottom: 18 })
      }
      .width('100%')
      .layoutWeight(1)
      if (this.page !== 'game' && this.secondaryPage.length === 0) {
        this.BottomBar()
      }
    }
    .padding({ left: 10, right: 10, bottom: 10 })
    .width('100%')
    .height('100%')
    .backgroundColor(this.pageColor())
    .onAreaChange((oldArea: Area, newArea: Area) => {
      this.windowWidth = Number(newArea.width)
      this.windowHeight = Number(newArea.height)
    })
  }
}
