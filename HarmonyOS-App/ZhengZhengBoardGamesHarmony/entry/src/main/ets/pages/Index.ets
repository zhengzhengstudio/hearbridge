import http from '@ohos.net.http'
import webSocket from '@ohos.net.webSocket'
import audio from '@ohos.multimedia.audio'
import util from '@ohos.util'
import preferences from '@ohos.data.preferences'
import { abilityAccessCtrl, common, ConfigurationConstant, Permissions } from '@kit.AbilityKit'
import { deviceInfo } from '@kit.BasicServicesKit'
import { harmonyShare, systemShare } from '@kit.ShareKit'
import { scanBarcode, scanCore } from '@kit.ScanKit'
import { createRoomInvite, parseRoomInvite, RoomInvite, roomWebUrl } from '../model/RoomInvite'
import { analyzeBoard, AnalysisResult, AppliedMove, applyBoardMove, BoardMove, emptyBoard, findBestMove,
  editBoardPosition, puzzlePosition, PuzzlePosition, setGoBoardSide, standardBoard,
  validateEditorState } from '../model/BoardAnalysis'

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

interface StringPair {
  id: string
  title: string
}

interface JoinRoomPayload {
  roomId: string
  username: string
  clientDeviceId: string
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

interface VoiceJoinPayload {
  roomId: string
  muted: boolean
  transport: string
}

interface VoiceFramePayload {
  roomId: string
  codec: string
  sampleRate: number
  sequence: number
  data: string
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
  private readonly appVersion: string = '1.3.0'
  private readonly appBuild: number = 31
  @StorageLink('pendingRoomInvite') pendingRoomInvite: string = ''
  @StorageLink('mainWindowId') mainWindowId: number = 0
  @StorageLink('systemDark') systemDark: boolean = false
  @State page: string = 'lobby'
  @State activeTab: string = 'lobby'
  @State secondaryPage: string = ''
  @State selectedGame: string = 'gobang'
  @State gameSearchText: string = ''
  @State gameCategory: string = 'all'
  @State roomId: string = '1234'
  @State playerName: string = '鸿蒙玩家'
  @State connectionText: string = '主站优先 · 尚未加入房间'
  @State roomStatus: string = '未加入'
  @State isOwner: boolean = false
  @State awaitingMove: boolean = false
  @State resetPrompt: string = ''
  @State chatText: string = ''
  @State chatLines: string[] = ['系统：欢迎来到铮铮桌游中心']
  @State board: number[] = Array(361).fill(0)
  @State currentPiece: number = 1
  @State lastMoveIndex: number = -1
  @State gameStatus: string = '黑方先行'
  @State updateText: string = '当前版本 1.3.0'
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
  @State voiceJoined: boolean = false
  @State voiceText: string = '语音'
  @State inviteFallbackOpen: boolean = false
  @State inviteUrl: string = ''
  @State pendingInviteGame: string = ''
  @State pendingInviteRoom: string = ''
  @State pendingInviteSource: string = ''
  @State scanStatus: string = ''
  @State aiDifficulty: string = '标准'
  @State studyMode: string = 'play'
  @State studySide: string = 'first'
  @State studyText: string = '可在当前局面进行本地分析'
  @State puzzleGoal: string = ''
  @State puzzleIndex: number = -1
  @State editorTool: string = '1'
  @State editorChessPiece: string = '帥'
  @State editorHistory: string[] = []
  @State editorOrigin: string = ''
  @State localAiEnabled: boolean = true
  @State goSize: number = 19   // 围棋棋盘路数：13 / 19
  @State aiThinking: boolean = false
  @State previousBoard: number[] = []
  @State publicRooms: string[] = ['尚未读取公开房间']
  @State leaderboardRows: string[] = ['尚未读取排行榜']
  @State selectedCell: number = -1
  @State chessPieces: string[] = Array(90).fill('')
  @State rummyHand: number[] = []
  @State rummyTable: number[] = []
  @State rummyDeckCount: number = 106
  @State selectedTile: number = -1
  @State rummyRackRows: number = 3      // 牌架行数，可自行增减（1..7）
  @State rummySortMode: boolean = false // 整理模式：点两张牌交换位置
  @State rummySortPick: number = -1
  @State worldChessPieces: string[] = Array(64).fill('')
  @State ludoPieces: number[][] = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]
  @State ludoTurn: number = 0
  @State junqiBoard: string[] = Array(60).fill('')
  @State junqiSelected: number = -1
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
  private shareRegistered: boolean = false
  private receiveRegistered: boolean = false
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
  // 国内版飞行棋（经典十字布局）坐标：scripts/gen_ludo_cn_classic.py 与底图同源生成
  // 标准 Ludo 几何：15×15 网格，主跑道 52 格闭环（四内角为对角过渡），起飞点 0/13/26/39
  // 相对进度：0..50 跑道 / 51..55 归航通道 / 56 终点
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
  private socketClient: webSocket.WebSocket | null = null
  private reconnectTimer: number = -1
  private clientDeviceId: string = ''
  private voiceCapturer: audio.AudioCapturer | null = null
  private voiceRenderer: audio.AudioRenderer | null = null
  private voiceSequence: number = 0
  private voiceLoopActive: boolean = false
  private base64Helper: util.Base64Helper = new util.Base64Helper()

  private games: GameInfo[] = [
    { id: 'gobang', title: '五子棋', note: '15 路 · 服务器裁判', players: '2 人', accent: '#16A085', icon: $r('app.media.game_gomoku') },
    { id: 'reversi', title: '黑白棋', note: '翻转棋子 · 终局计数', players: '2 人', accent: '#2F855A', icon: $r('app.media.game_reversi') },
    { id: 'tictactoe', title: '井字棋', note: '三连获胜 · 快速对局', players: '2 人', accent: '#2471A3', icon: $r('app.media.game_tictactoe') },
    { id: 'go', title: '围棋', note: '19 路 · 吃子与数目', players: '2 人', accent: '#B7791F', icon: $r('app.media.game_go') },
    { id: 'chinese-chess', title: '中国象棋', note: '楚河汉界 · 将帅对决', players: '2 人', accent: '#C0392B', icon: $r('app.media.game_chess') },
    { id: 'world-chess', title: '国际象棋', note: '8×8 · 王车易位与升变', players: '2 人', accent: '#4A5A3A', icon: $r('app.media.game_wchess') },
    { id: 'checkers', title: '跳棋', note: '跨越与占位', players: '2 人', accent: '#5B6FB5', icon: $r('app.media.game_checkers') },
    { id: 'rummy', title: '拉密', note: '106 张标准牌组', players: '2-4 人', accent: '#2471A3', icon: $r('app.media.game_rummy') },
    { id: 'ludo', title: '飞行棋', note: '骰子规则可自定义', players: '2-4 人', accent: '#8E44AD', icon: $r('app.media.game_ludo') },
    { id: 'junqi', title: '陆战棋', note: '军棋 · 工兵挖雷扛旗', players: '2-4 人', accent: '#2F4F3A', icon: $r('app.media.game_junqi') },
    { id: 'minesweeper', title: '扫雷', note: '三档难度 · 首击必安全', players: '1 人', accent: '#5D6D7E', icon: $r('app.media.game_mine') },
    { id: 'monopoly', title: '大富翁', note: '地产经营与资金管理', players: '2-4 人', accent: '#B7791F', icon: $r('app.media.game_money') },
    { id: 'landlord', title: '斗地主', note: '地主与农民对抗', players: '3 人', accent: '#C05621', icon: $r('app.media.game_cards') },
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

  private knockShareCallback: (target: harmonyShare.SharableTarget) => void =
    (target: harmonyShare.SharableTarget): void => this.shareCurrentRoom(target)

  private receiveCallback: (target: harmonyShare.ReceivableTarget) => void =
    (target: harmonyShare.ReceivableTarget): void => {
      const context = getContext(this) as common.UIAbilityContext
      target.receive(`file://${context.filesDir}/boardgame-room-invite`, {
        onDataReceived: (data: systemShare.SharedData): void => {
          const records = data.getRecords()
          if (records.length > 0) this.offerInvite(records[0].content || '', '碰一碰')
        },
        onResult: (): void => {}
      }).catch(() => {
        this.scanStatus = '碰一碰接收失败，可改用扫一扫或房间号'
      })
    }

  aboutToAppear(): void {
    this.restoreSettings()
    this.loadClientDeviceId()
    this.registerRoomSharing()
    this.consumePendingInvite()
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
      game === 'landlord' || game === 'mahjong' || game === 'poker' || game === 'werewolf' || game === 'spy' ||
      game === 'tictactoe') {
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

  private loadClientDeviceId(): void {
    preferences.getPreferences(getContext(this), 'zz_boardgames_identity').then((store: preferences.Preferences) => {
      const saved = String(store.getSync('zz_boardgame_device_id', ''))
      if (saved.length > 0) {
        this.clientDeviceId = saved
      } else {
        this.stableClientDeviceId()
      }
    }).catch(() => {})
  }

  private stableClientDeviceId(): string {
    if (this.clientDeviceId.length > 0) return this.clientDeviceId
    this.clientDeviceId = `hmos-${Date.now()}-${Math.floor(Math.random() * 1000000000).toString(36)}`
    preferences.getPreferences(getContext(this), 'zz_boardgames_identity').then((store: preferences.Preferences) => {
      store.putSync('zz_boardgame_device_id', this.clientDeviceId)
      store.flush().catch(() => {})
    }).catch(() => {})
    return this.clientDeviceId
  }

  onPageShow(): void {
    this.consumePendingInvite()
  }

  aboutToDisappear(): void {
    this.leaveVoice()
    this.disconnectRoomSocket()
    if (this.shareRegistered) harmonyShare.off('knockShare', this.knockShareCallback)
    if (this.receiveRegistered && deviceInfo.sdkApiVersion >= 20) {
      harmonyShare.off('dataReceive', {
        windowId: this.mainWindowId,
        capabilities: [{ utd: 'general.hyperlink', maxSupportedCount: 1 }]
      }, this.receiveCallback)
    }
    this.shareRegistered = false
    this.receiveRegistered = false
  }

  private registerRoomSharing(): void {
    if (!this.shareRegistered) {
      harmonyShare.on('knockShare', this.knockShareCallback)
      this.shareRegistered = true
    }
    if (!this.receiveRegistered && this.mainWindowId > 0 && deviceInfo.sdkApiVersion >= 20) {
      harmonyShare.on('dataReceive', {
        windowId: this.mainWindowId,
        capabilities: [{ utd: 'general.hyperlink', maxSupportedCount: 1 }]
      }, this.receiveCallback)
      this.receiveRegistered = true
    }
  }

  private currentInvite(): RoomInvite | null {
    if (this.roomId === '本地' || this.roomId.trim().length === 0) return null
    return createRoomInvite(this.selectedGame, this.roomId)
  }

  private shareCurrentRoom(target: harmonyShare.SharableTarget): void {
    const invite = this.currentInvite()
    if (!invite) {
      target.reject(harmonyShare.SharableErrorCode.NO_CONTENT_ERROR)
      this.scanStatus = '请先加入联机房间，再使用碰一碰邀请'
      return
    }
    const url = roomWebUrl(invite)
    const data = new systemShare.SharedData({
      utd: 'general.hyperlink',
      content: url,
      title: `${this.gameTitle()} · 房间 ${invite.room}`,
      label: '铮铮桌游房间',
      description: '碰一下，在铮铮桌游中心继续对战',
      extraData: {
        game: invite.game,
        room: invite.room,
        invite: invite.token,
        expires: invite.expiresAt
      }
    })
    target.share(data).then(() => {
      this.scanStatus = `已发送房间 ${invite.room}`
    }).catch(() => {
      this.showInviteFallback()
      this.scanStatus = '碰一碰未完成，已显示二维码和房间号'
    })
  }

  private showInviteFallback(): void {
    const invite = this.currentInvite()
    if (!invite) {
      this.scanStatus = '请先加入联机房间'
      return
    }
    this.inviteUrl = roomWebUrl(invite)
    this.inviteFallbackOpen = true
    this.gameMoreOpen = false
  }

  private offerInvite(value: string, source: string): void {
    const invite = parseRoomInvite(value)
    if (!invite) {
      this.scanStatus = `${source}没有识别到铮铮桌游房间`
      return
    }
    if (invite.expiresAt > 0 && invite.expiresAt < Date.now()) {
      this.scanStatus = '邀请已过期，请让房主重新分享'
      return
    }
    this.pendingInviteGame = invite.game
    this.pendingInviteRoom = invite.room
    this.pendingInviteSource = source
    this.scanStatus = `${source}识别成功，确认后加入房间 ${invite.room}`
  }

  private consumePendingInvite(): void {
    if (this.pendingRoomInvite.length === 0) return
    const value = this.pendingRoomInvite
    this.pendingRoomInvite = ''
    this.offerInvite(value, 'App 链接')
  }

  private acceptPendingInvite(): void {
    if (this.pendingInviteRoom.length === 0) return
    this.selectedGame = this.pendingInviteGame
    this.roomId = this.pendingInviteRoom
    this.pendingInviteGame = ''
    this.pendingInviteRoom = ''
    this.pendingInviteSource = ''
    this.joinRoom()
  }

  private startRoomScan(): void {
    const context = getContext(this) as common.UIAbilityContext
    this.scanStatus = '正在打开扫一扫…'
    scanBarcode.startScanForResult(context, {
      scanTypes: [scanCore.ScanType.QR_CODE],
      enableMultiMode: false,
      enableAlbum: true
    }).then((result: scanBarcode.ScanResult) => {
      this.offerInvite(result.originalValue, '扫一扫')
    }).catch(() => {
      this.scanStatus = '扫码已取消或暂时不可用'
    })
  }

  private openSystemInvite(): void {
    const invite = this.currentInvite()
    if (!invite) {
      this.scanStatus = '请先加入联机房间'
      return
    }
    const data = new systemShare.SharedData({
      utd: 'general.hyperlink',
      content: roomWebUrl(invite),
      title: `${this.gameTitle()} · 房间 ${invite.room}`,
      label: '铮铮桌游房间',
      description: '在另一台设备继续对战'
    })
    const controller = new systemShare.ShareController(data)
    const context = getContext(this) as common.UIAbilityContext
    controller.show(context, {
      selectionMode: systemShare.SelectionMode.SINGLE,
      previewMode: systemShare.SharePreviewMode.DEFAULT
    }).catch(() => {
      this.showInviteFallback()
      this.scanStatus = '隔空投送未完成，已显示二维码和房间号'
    })
  }

  private continueOnWeb(): void {
    const invite = this.currentInvite()
    if (!invite) {
      this.scanStatus = '当前不是联机房间，无法转到网页继续'
      return
    }
    const context = getContext(this) as common.UIAbilityContext
    context.startAbility({
      action: 'ohos.want.action.viewData',
      uri: roomWebUrl(invite)
    }).catch(() => {
      this.scanStatus = '暂时无法打开网页端'
    })
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
    const chatWidth = this.isWideWorkspace() && this.roomId !== '本地' ? 376 : 0
    const availableWidth = Math.max(280, contentWidth - chatWidth)
    // 棋盘优先：手机上让棋盘尽量吃满可用高度（0.62 -> 0.72），宽屏放宽上限到 780
    const heightLimit = Math.max(300, this.windowHeight * (this.isWideWorkspace() ? 0.78 : 0.72))
    return Math.floor(Math.min(availableWidth, heightLimit, 780))
  }

  // 只有真正叠在底图上的棋盘才需要底图资源；rummy_table / property_board / card_table
  // 三个大图没有任何 Builder 使用，已从资源目录删除（包体 -2.8MB）。
  private boardArtwork(game: string): Resource {
    if (game === 'gobang') return $r('app.media.gobang_board')
    if (game === 'go') return this.goSize === 13 ? $r('app.media.go_board_13') : $r('app.media.go_board_19')
    if (game === 'reversi') return $r('app.media.reversi_board')
    if (game === 'tictactoe') return $r('app.media.tictactoe_board')
    if (game === 'chinese-chess') return $r('app.media.xiangqi_board')
    if (game === 'checkers') return $r('app.media.checkers_board')
    if (game === 'ludo') return $r('app.media.ludo_board')
    if (game === 'junqi') return $r('app.media.junqi_board')
    return $r('app.media.reversi_board')
  }

  private boardSideLength(): number {
    if (this.selectedGame === 'tictactoe') return 3
    if (this.selectedGame === 'reversi' || this.selectedGame === 'checkers') return 8
    // 围棋有 13/19 两种路数，必须跟着 goSize 走；
    // 旧写法写死 19，切到 13 路后棋盘格数与落子下标全部错位。
    if (this.selectedGame === 'go') return this.goSize
    return 15
  }

  private boardCellCount(): number {
    const side = this.boardSideLength()
    return side * side
  }

  private gridTemplate(size: number): string {
    return Array(size).fill('1fr').join(' ')
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
  private pageColor(): string { return this.darkTheme() ? '#101412' : '#F5F6F4' }
  private cardColor(): string { return this.darkTheme() ? '#1B201E' : '#FFFFFF' }
  private inputColor(): string { return this.darkTheme() ? '#242A27' : '#F0F2EF' }
  private controlColor(): string { return this.darkTheme() ? '#2A312E' : '#E9ECE9' }
  private textColor(): string { return this.darkTheme() ? '#F5F7F5' : '#18201D' }
  private controlTextColor(): string { return this.darkTheme() ? '#E5EAE7' : '#24302B' }
  private mutedColor(): string { return this.darkTheme() ? '#AAB5B0' : '#64716B' }
  private themeBorderColor(): string { return this.darkTheme() ? '#3B4541' : '#D8DEDA' }
  private selectedCardColor(): string { return this.darkTheme() ? '#20372D' : '#E7F1EB' }
  private selectedBorderColor(): string { return this.darkTheme() ? '#61A982' : '#397A5B' }
  private accentColor(): string { return this.darkTheme() ? '#4B9B72' : '#2F7655' }
  private accentPressedColor(): string { return this.darkTheme() ? '#397A5B' : '#255F45' }
  private positiveSurfaceColor(): string { return this.darkTheme() ? '#20372D' : '#E7F1EB' }
  private warningSurfaceColor(): string { return this.darkTheme() ? '#3B3020' : '#F7EEDC' }

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

  private categoryForGame(gameId: string): string {
    if (['rummy', 'landlord', 'mahjong', 'poker'].indexOf(gameId) >= 0) return 'cards'
    if (['werewolf', 'spy'].indexOf(gameId) >= 0) return 'party'
    if (['ludo', 'monopoly'].indexOf(gameId) >= 0) return 'casual'
    return 'board'
  }

  private filteredGames(): GameInfo[] {
    const term = this.gameSearchText.trim().toLowerCase()
    return this.games.filter((game: GameInfo) => {
      const categoryMatches = this.gameCategory === 'all' || this.categoryForGame(game.id) === this.gameCategory
      const searchMatches = term.length === 0 || `${game.title} ${game.note} ${game.players}`.toLowerCase().indexOf(term) >= 0
      return categoryMatches && searchMatches
    })
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
    if (this.secondaryPage === 'study') return '棋局研习'
    if (this.activeTab === 'lobby') return '铮铮桌游中心'
    if (this.activeTab === 'room') return '联机房间'
    if (this.activeTab === 'games') return '游戏'
    return '我的'
  }

  private openSecondary(panel: string): void {
    this.secondaryPage = panel
    if (panel === 'public') this.loadPublicRooms()
    if (panel === 'leaderboard') this.loadLeaderboard()
    if (panel === 'update') this.checkUpdate()
    if (panel === 'study' && !this.supportsBoardStudy()) {
      this.selectedGame = 'gobang'
      this.studyMode = 'puzzle'
      this.studySide = 'first'
    }
  }

  private studyModes(): StringPair[] {
    if (this.selectedGame === 'chinese-chess') {
      return [
        { id: 'puzzle', title: '残局闯关' },
        { id: 'editor', title: '自建残局' },
        { id: 'play', title: 'AI 对弈' },
        { id: 'analysis', title: '局面分析' }
      ]
    }
    if (this.selectedGame === 'go') {
      return [
        { id: 'puzzle', title: '死活题' },
        { id: 'editor', title: '自建局面' },
        { id: 'play', title: 'AI 对弈' },
        { id: 'analysis', title: '形势分析' }
      ]
    }
    return [
      { id: 'puzzle', title: '残局闯关' },
      { id: 'editor', title: '自建局面' },
      { id: 'play', title: 'AI 对弈' },
      { id: 'analysis', title: '胜率分析' }
    ]
  }

  private beginStudy(): void {
    this.roomId = '本地'
    this.connectionText = `${this.gameTitle()} · 棋局研习`
    this.roomStatus = '本地研习'
    this.isOwner = true
    this.resetBoard()
    this.page = 'game'
    this.secondaryPage = ''
    this.activeTab = 'lobby'
    this.startStudyMode(this.studyMode)
    if (this.studyMode === 'play' && this.studySide === 'second') {
      this.scheduleLocalAi()
    }
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
    this.connectionText = `已选择 ${game.title} · 可本地练习或加入联机房间`
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
    let client = http.createHttp()
    client.request(url, {
      method: http.RequestMethod.GET,
      connectTimeout: 5000,
      readTimeout: 6000
    }).then((result: http.HttpResponse) => {
      if (Number(result.responseCode) < 200 || Number(result.responseCode) >= 300) {
        this.connectionText = `主站响应异常：HTTP ${result.responseCode}`
        client.destroy()
        return
      }
      success(String(result.result))
      client.destroy()
    }).catch(() => {
      this.connectionText = '主站暂时不可用，可继续本地练习'
      client.destroy()
    })
  }

  private postJson(url: string, payload: object, success: (body: string) => void, failure?: (message: string) => void): void {
    let client = http.createHttp()
    client.request(url, {
      method: http.RequestMethod.POST,
      header: {
        'Content-Type': 'application/json',
        // 通行证接口用这个头识别原生客户端：App 里没有 Turnstile 小组件，
        // 不带该头会被判成「安全验证无效」而返回 400。
        'X-Passport-Client': 'boardgames-harmony'
      },
      extraData: JSON.stringify(payload),
      connectTimeout: 6000,
      readTimeout: 8000
    }).then((result: http.HttpResponse) => {
      if (Number(result.responseCode) < 200 || Number(result.responseCode) >= 300) {
        if (failure) {
          failure(`HTTP ${result.responseCode}`)
        }
        client.destroy()
        return
      }
      success(String(result.result))
      client.destroy()
    }).catch((error: Error) => {
      if (failure) {
        failure(error.message || '网络不可用')
      }
      client.destroy()
    })
  }

  private socketUrl(): string {
    return `wss://zhengzhengstudio.cn/socket.io/?EIO=4&transport=websocket&t=${Date.now()}`
  }

  private socketRequest(method: http.RequestMethod, body: string, success: (text: string) => void, failure?: () => void): void {
    let client = http.createHttp()
    client.request(this.socketUrl(), {
      method: method,
      header: {
        'Content-Type': 'text/plain;charset=UTF-8'
      },
      extraData: body,
      connectTimeout: 5000,
      readTimeout: method === http.RequestMethod.GET ? 45000 : 8000
    }).then((result: http.HttpResponse) => {
      if (Number(result.responseCode) < 200 || Number(result.responseCode) >= 300) {
        if (failure) {
          failure()
        } else {
          this.connectionText = `房间 ${this.roomId} · HTTP ${result.responseCode}`
        }
        client.destroy()
        return
      }
      success(String(result.result))
      client.destroy()
    }).catch(() => {
      if (failure) {
        failure()
      } else {
        this.connectionText = `房间 ${this.roomId} · 正在重连主站`
      }
      client.destroy()
    })
  }

  private emitSocket(eventName: string, payload: object): void {
    if (!this.socketActive || this.socketClient === null) {
      return
    }
    let packet = `42${JSON.stringify([eventName, payload])}`
    this.socketClient.send(packet).catch(() => {
      this.connectionText = `房间 ${this.roomId} · 消息发送失败，正在恢复`
    })
  }

  private connectRoom(): void {
    this.disconnectRoomSocket(false)
    this.socketActive = false
    this.socketSid = ''
    this.socketId = ''
    const client = webSocket.createWebSocket()
    this.socketClient = client
    client.on('message', (error: Error, value: string | ArrayBuffer): void => {
      if (error) return
      const packet = typeof value === 'string' ? value : ''
      if (packet.startsWith('0')) {
        const sidMatch = packet.match(/"sid":"([^"]+)"/)
        if (sidMatch && sidMatch.length > 1) this.socketSid = sidMatch[1]
        client.send('40').catch(() => {})
      } else if (packet === '2') {
        client.send('3').catch(() => {})
      } else if (packet.startsWith('40')) {
        const socketMatch = packet.match(/"sid":"([^"]+)"/)
        if (socketMatch && socketMatch.length > 1) this.socketId = socketMatch[1]
        this.socketActive = true
        this.failedPolls = 0
        const joinPayload: JoinRoomPayload = {
          roomId: this.roomId,
          username: this.playerName,
          clientDeviceId: this.stableClientDeviceId(),
          gameType: this.selectedGame,
          maxPlayers: this.maxPlayersForGame(this.selectedGame)
        }
        this.emitSocket('join-room', joinPayload)
        this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · 主站已连接`
        this.chatLines = [...this.chatLines, `系统：已加入主站房间 ${this.roomId}`].slice(-30)
      } else if (packet.startsWith('42')) {
        this.handleSocketEvent(packet.substring(2))
      }
    })
    client.on('close', (): void => this.handleSocketClosed())
    client.on('error', (): void => this.handleSocketClosed())
    client.connect(this.socketUrl(), {
      header: {
        'Origin': 'https://zhengzhengstudio.cn'
      }
    }).catch(() => this.handleSocketClosed())
  }

  private handleSocketClosed(): void {
    if (this.socketClient === null && !this.socketActive) return
    this.socketClient = null
    this.socketActive = false
    this.connectionText = `房间 ${this.roomId} · 主站连接恢复中`
    if (this.reconnectTimer >= 0) clearTimeout(this.reconnectTimer)
    if (this.page === 'game' && this.roomId !== '本地') {
      this.reconnectTimer = setTimeout(() => this.connectRoom(), 1200)
    }
  }

  private disconnectRoomSocket(clearReconnect: boolean = true): void {
    if (clearReconnect && this.reconnectTimer >= 0) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = -1
    }
    const client = this.socketClient
    this.socketClient = null
    this.socketActive = false
    if (client !== null) client.close().catch(() => {})
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
    this.socketRequest(http.RequestMethod.GET, '', (packets: string) => {
      this.polling = false
      this.failedPolls = 0
      packets.split('\u001e').forEach((packet: string) => {
        if (packet === '2') {
          this.socketRequest(http.RequestMethod.POST, '3', () => {})
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
    let voiceMatch = raw.match(/^\["voice-frame",\{.*?"from":"([^"]*)".*?"data":"([^"]+)"/)
    if (voiceMatch && voiceMatch.length > 2 && voiceMatch[1] !== this.socketId) {
      this.playVoiceFrame(voiceMatch[2])
      return
    }
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

  private audioStreamInfo(): audio.AudioStreamInfo {
    return {
      samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
      channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
      encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
    }
  }

  private async toggleVoice(): Promise<void> {
    if (this.voiceJoined) {
      this.leaveVoice()
      return
    }
    if (!this.socketActive || this.roomId === '本地') {
      this.voiceText = '联机后可加入语音'
      return
    }
    const context = getContext(this) as common.UIAbilityContext
    const atManager = abilityAccessCtrl.createAtManager()
    const permissions: Array<Permissions> = ['ohos.permission.MICROPHONE']
    const result = await atManager.requestPermissionsFromUser(context, permissions)
    if (result.authResults.length === 0 || result.authResults[0] !== 0) {
      this.voiceText = '未获得麦克风权限'
      return
    }
    try {
      this.voiceCapturer = await audio.createAudioCapturer({
        streamInfo: this.audioStreamInfo(),
        capturerInfo: {
          source: audio.SourceType.SOURCE_TYPE_VOICE_COMMUNICATION,
          capturerFlags: 0
        }
      })
      this.voiceRenderer = await audio.createAudioRenderer({
        streamInfo: this.audioStreamInfo(),
        rendererInfo: {
          usage: audio.StreamUsage.STREAM_USAGE_VOICE_COMMUNICATION,
          rendererFlags: 0
        }
      })
      await this.voiceCapturer.start()
      await this.voiceRenderer.start()
      this.voiceJoined = true
      this.voiceLoopActive = true
      this.voiceText = '语音已加入'
      const joinPayload: VoiceJoinPayload = { roomId: this.roomId, muted: false, transport: 'pcm16' }
      this.emitSocket('voice-join', joinPayload)
      this.captureVoiceLoop()
    } catch {
      this.voiceText = '语音启动失败'
      this.leaveVoice()
    }
  }

  private async captureVoiceLoop(): Promise<void> {
    while (this.voiceLoopActive && this.voiceCapturer !== null) {
      try {
        const buffer = await this.voiceCapturer.read(2048, true)
        if (!this.voiceLoopActive || buffer.byteLength === 0) continue
        this.voiceSequence += 1
        const framePayload: VoiceFramePayload = {
          roomId: this.roomId,
          codec: 'pcm16',
          sampleRate: 16000,
          sequence: this.voiceSequence,
          data: this.base64Helper.encodeToStringSync(new Uint8Array(buffer))
        }
        this.emitSocket('voice-frame', framePayload)
      } catch {
        if (this.voiceLoopActive) this.voiceText = '语音采集已中断'
        break
      }
    }
  }

  private playVoiceFrame(data: string): void {
    if (!this.voiceJoined || this.voiceRenderer === null) return
    try {
      const decoded = this.base64Helper.decodeSync(data)
      this.voiceRenderer.write(decoded.buffer as ArrayBuffer).catch(() => {})
    } catch {}
  }

  private leaveVoice(): void {
    if (this.voiceJoined && this.socketActive) {
      const leavePayload: RoomOnlyPayload = { roomId: this.roomId }
      this.emitSocket('voice-leave', leavePayload)
    }
    this.voiceJoined = false
    this.voiceLoopActive = false
    this.voiceText = '语音'
    const capturer = this.voiceCapturer
    const renderer = this.voiceRenderer
    this.voiceCapturer = null
    this.voiceRenderer = null
    if (capturer !== null) {
      capturer.stop().then(() => capturer.release()).catch(() => {})
    }
    if (renderer !== null) {
      renderer.stop().then(() => renderer.release()).catch(() => {})
    }
  }

  private syncBoardFromEvent(raw: string): void {
    let boardMatch = raw.match(/"boardFlat":\[([0-9,\-\s]+)\]/)
    if (!boardMatch || boardMatch.length < 2) {
      boardMatch = raw.match(/"board":\[([0-9,\-\s]+)\]/)
    }
    if (boardMatch && boardMatch.length > 1) {
      let values: number[] = boardMatch[1].split(',').map((value: string) => Number(value.trim()) === -1 ? 2 : Number(value.trim()))
      if (values.length === this.boardCellCount()) {
        // 尺寸必须跟当前棋种一致：13 路围棋只该有 169 个点，
        // 硬编码 361 会让落子下标和棋盘格对不上。
        const nextBoard: number[] = Array(this.boardCellCount()).fill(0)
        values.forEach((value: number, index: number) => nextBoard[index] = value)
        this.board = nextBoard
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
    this.connectionText = `正在为 ${this.gameTitle()} 匹配房间…`
    this.requestText(`https://zhengzhengstudio.cn/api/boardgames/matchmaking?gameType=${this.selectedGame}`,
      (body: string) => {
        let match = body.match(/"roomId"\s*:\s*"([^"]+)"/)
        if (match && match.length > 1) {
          this.roomId = match[1]
          this.joinRoom()
        } else {
          this.connectionText = '主站未返回房间号，可手动输入房间号'
        }
      })
  }

  private joinRoom(): void {
    if (this.roomId.trim().length === 0) {
      this.connectionText = '请先输入房间号'
      return
    }
    this.connectionText = `${this.gameTitle()} · 房间 ${this.roomId} · 正在连接主站`
    this.roomStatus = '正在连接'
    this.chatLines = [...this.chatLines, `系统：正在加入主站房间 ${this.roomId}`].slice(-30)
    this.page = 'game'
    this.connectRoom()
  }

  private localGame(): void {
    this.roomId = '本地'
    this.connectionText = `${this.gameTitle()} · 本地 AI 练习`
    this.roomStatus = '本地练习'
    this.isOwner = true
    this.studyMode = 'play'
    this.localAiEnabled = true
    if (this.selectedGame === 'go') setGoBoardSide(this.goSize)
    this.resetBoard()
    this.page = 'game'
  }

  private resetBoard(): void {
    this.board = Array(this.selectedGame === 'go' ? this.goSize * this.goSize : 361).fill(0)
    if (this.selectedGame === 'reversi') {
      this.board[27] = 2
      this.board[28] = 1
      this.board[35] = 1
      this.board[36] = 2
    }
    if (this.selectedGame === 'checkers') {
      const checkers: number[] = Array(361).fill(0)
      for (let index = 0; index < 64; index++) {
        if ((Math.floor(index / 8) + index % 8) % 2 === 1) {
          if (index < 24) checkers[index] = 1
          if (index >= 40) checkers[index] = 2
        }
      }
      this.board = checkers
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
      this.rummyTable = []
      this.rummyDeckCount = 92
      this.selectedTile = -1
      this.rummyRackRows = 3
      this.rummySortMode = false
      this.rummySortPick = -1
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
    this.startSocialGame()
    this.currentPiece = 1
    this.lastMoveIndex = -1
    this.gameStatus = this.selectedGame === 'world-chess' ? '白方先行' : '黑方先行'
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
  private readonly junqiPosY: number[] = [4.92, 4.92, 4.92, 4.92, 4.92, 13.11, 13.11, 13.11, 13.11, 13.11, 21.31, 21.31, 21.31, 21.31, 21.31, 29.51, 29.51, 29.51, 29.51, 29.51, 37.7, 37.7, 37.7, 37.7, 37.7, 45.9, 45.9, 45.9, 45.9, 45.9, 54.1, 54.1, 54.1, 54.1, 54.1, 62.3, 62.3, 62.3, 62.3, 62.3, 70.49, 70.49, 70.49, 70.49, 70.49, 78.69, 78.69, 78.69, 78.69, 78.69, 86.89, 86.89, 86.89, 86.89, 86.89, 95.08, 95.08, 95.08, 95.08, 95.08]

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

  private junqiMovable(cell: string): boolean {
    const t = cell.charAt(1)
    return t !== 'F' && t !== 'M'
  }

  private junqiReset(): void {
    this.junqiBoard = this.junqiSetup()
    this.junqiSelected = -1
    this.currentPiece = 1
    this.gameStatus = '红方先行 · 点选己方棋子，再点高亮目标位'
  }

  // 每方 25 子：司令1 军长1 师长2 旅长2 团长2 营长2 连长3 排长3 工兵3 地雷3 炸弹2 军旗1
  // 军旗固定放一个本营，另一个本营放地雷；地雷限后两排；行营开局必须为空
  private junqiSetup(): string[] {
    const board: string[] = Array(60).fill('')
    const rankList: string[] = ['9', '8', '7', '7', '6', '6', '5', '5', '4', '4',
      '3', '3', '3', '2', '2', '2', '1', '1', '1', 'B', 'B']
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 'b' : 'r'
      const flagBase = s === 0 ? 1 : 56
      const otherBase = s === 0 ? 3 : 58
      const backRows = s === 0 ? [0, 1] : [10, 11]
      const startRow = s === 0 ? 0 : 6
      board[flagBase] = side + 'F'
      board[otherBase] = side + 'M'
      const spots: number[] = []
      for (let r = startRow; r < startRow + 6; r++) {
        for (let col = 0; col < 5; col++) {
          const idx = r * 5 + col
          if (this.junqiBase.indexOf(idx) >= 0 || this.junqiCamp.indexOf(idx) >= 0) continue
          spots.push(idx)
        }
      }
      for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = spots[i]
        spots[i] = spots[j]
        spots[j] = tmp
      }
      const mineSpots: number[] = []
      const restSpots: number[] = []
      spots.forEach((idx: number) => {
        const row = Math.floor(idx / 5)
        if (backRows.indexOf(row) >= 0) {
          mineSpots.push(idx)
        } else {
          restSpots.push(idx)
        }
      })
      for (let i = mineSpots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = mineSpots[i]
        mineSpots[i] = mineSpots[j]
        mineSpots[j] = tmp
      }
      for (let m = 0; m < 2 && m < mineSpots.length; m++) {
        board[mineSpots[m]] = side + 'M'
      }
      const rest: string[] = []
      rankList.forEach((rk: string) => rest.push(side + rk))
      for (let m = 2; m < mineSpots.length; m++) {
        restSpots.push(mineSpots[m])
      }
      for (let i = 0; i < restSpots.length && i < rest.length; i++) {
        board[restSpots[i]] = rest[i]
      }
    }
    return board
  }

  private junqiIsRail(a: number, b: number): boolean {
    const ra = Math.floor(a / 5)
    const ca = a % 5
    const rb = Math.floor(b / 5)
    const cb = b % 5
    if (ra === rb) return ra === 5 || ra === 6
    if (ca === cb) return ca === 0 || ca === 4
    return false
  }

  private junqiCanEnter(from: number, to: number): boolean {
    if (this.junqiBase.indexOf(to) >= 0) return false
    const target = this.junqiBoard[to]
    if (target.length === 0) return true
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
    const dirs: number[][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    dirs.forEach((d: number[]) => {
      const nr = r + d[0]
      const nc = col + d[1]
      if (nr < 0 || nr > 11 || nc < 0 || nc > 4) return
      const to = nr * 5 + nc
      if (this.junqiCanEnter(index, to)) out.push(to)
    })
    if (this.junqiRankOf(cell) === 1) {
      this.junqiEngineerTargets(index).forEach((t: number) => {
        if (out.indexOf(t) < 0) out.push(t)
      })
    }
    return out
  }

  private junqiSideHasMove(side: string): boolean {
    for (let i = 0; i < 60; i++) {
      const cell = this.junqiBoard[i]
      if (cell.length === 0 || this.junqiSideOf(cell) !== side) continue
      if (this.junqiMovesFrom(i).length > 0) return true
    }
    return false
  }

  private junqiApplyMove(from: number, to: number): void {
    const attacker = this.junqiBoard[from]
    if (attacker.length === 0) return
    const defender = this.junqiBoard[to]
    const aSide = this.junqiSideOf(attacker) === 'r' ? '红' : '蓝'
    const name = `${aSide}方${this.junqiNameOf(attacker)}`
    this.junqiBoard[from] = ''
    let text = ''
    if (defender.length === 0) {
      this.junqiBoard[to] = attacker
      text = `${name}移动`
    } else {
      const aRank = this.junqiRankOf(attacker)
      const dRank = this.junqiRankOf(defender)
      const dSide = this.junqiSideOf(defender) === 'r' ? '红' : '蓝'
      const dName = `${dSide}方${this.junqiNameOf(defender)}`
      if (dRank === -2) {
        this.junqiBoard[to] = attacker
        text = `${name}夺得${dName}，获胜！🏆`
      } else if (dRank === 0 && aRank === 1) {
        this.junqiBoard[to] = attacker
        text = `${name}挖掉${dName}`
      } else if (dRank === 0) {
        text = `${name}触雷阵亡`
      } else if (dRank === -1 || aRank === -1) {
        text = `${name}与${dName}同归于尽`
      } else if (aRank > dRank) {
        this.junqiBoard[to] = attacker
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
          if (dRank === -2) {
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
          const enemyFlag = this.junqiFindFlag(side === 'r' ? 'b' : 'r')
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
    const ratio = 1220.0 / 520.0
    const maxByHeight = Math.max(220, this.windowHeight * 0.78 / ratio)
    return Math.min(this.boardWidth(), Math.floor(maxByHeight))
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
      this.localAiEnabled = true
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
      this.puzzleIndex = (this.puzzleIndex + 1) % 3
      const puzzle: PuzzlePosition = puzzlePosition(this.selectedGame, this.puzzleIndex)
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
      this.gameStatus = `残局 ${this.puzzleIndex + 1}/3 · ${puzzle.title}`
      return
    }
    this.localAiEnabled = false
    this.editorOrigin = JSON.stringify({ game: this.selectedGame, board: this.analysisBoard(), player: this.currentPiece })
    this.editorHistory = []
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
    const confidence = Math.round(result.confidence * 100)
    this.studyText = `${result.tactical} · 推荐 ${moveText} · 置信度 ${confidence}% · 主线 ${result.principalVariation.length} 手 · ${result.nodes} 节点`
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
    this.puzzleGoal = ''
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
        if (this.selectedGame === 'checkers') this.applyCheckerMove(from, to)
        else if (this.selectedGame === 'world-chess') this.applyWorldChessMove(from, to)
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

  private checkerMovesFor(piece: number): number[][] {
    const board = this.board
    const moves: number[][] = []
    for (let from = 0; from < 64; from++) {
      if (board[from] !== piece) continue
      const fromRow = Math.floor(from / 8)
      const fromColumn = from % 8
      const steps: number[][] = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-2, -2], [-2, 2], [2, -2], [2, 2]]
      steps.forEach((step: number[]) => {
        const toRow = fromRow + step[0]
        const toColumn = fromColumn + step[1]
        if (toRow < 0 || toRow > 7 || toColumn < 0 || toColumn > 7) return
        const to = toRow * 8 + toColumn
        if (board[to] !== 0) return
        const distance = Math.abs(step[0])
        if (distance === 2) {
          const middle = (fromRow + toRow) / 2 * 8 + (fromColumn + toColumn) / 2
          if (board[middle] === 0 || board[middle] === piece) return
        }
        moves.push([from, to])
      })
    }
    return moves
  }

  private pickCheckersMove(): BoardMove | null {
    const piece = this.currentPiece
    const moves = this.checkerMovesFor(piece)
    if (moves.length === 0) return null
    const jumps: number[][] = []
    moves.forEach((move: number[]) => {
      if (Math.abs(Math.floor(move[1] / 8) - Math.floor(move[0] / 8)) === 2) jumps.push(move)
    })
    const pool = jumps.length > 0 ? jumps : moves
    if (this.aiDifficulty === '简单' && pool.length > 1) {
      return { from: pool[0][0], to: pool[0][1] }
    }
    let best = pool[0]
    let bestValue = -9999
    pool.forEach((move: number[]) => {
      let value = Math.abs(Math.floor(move[1] / 8) - Math.floor(move[0] / 8)) === 2 ? 10 : 0
      const toRow = Math.floor(move[1] / 8)
      if ((piece === 1 && toRow === 7) || (piece === 2 && toRow === 0)) value += 6
      if (toRow === 0 || toRow === 7) value += 1
      value += Math.random()
      if (value > bestValue) {
        bestValue = value
        best = move
      }
    })
    return { from: best[0], to: best[1] }
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
    this.editorHistory = this.editorHistory.concat([JSON.stringify({ board: this.analysisBoard(), player: this.currentPiece })])
    if (this.selectedGame === 'chinese-chess') {
      this.chessPieces = editBoardPosition(this.selectedGame, this.chessPieces, index,
        this.editorChessPiece === '清除' ? '' : this.editorChessPiece) as string[]
    } else {
      this.board = editBoardPosition(this.selectedGame, this.board, index,
        this.editorTool === '0' ? 0 : Number(this.editorTool)) as number[]
    }
    this.studyText = '局面已修改，完成后请检查规则'
  }

  private restoreEditorSnapshot(encoded: string): void {
    try {
      const snapshot = JSON.parse(encoded) as Record<string, Object>
      const board = snapshot['board'] as number[] | string[]
      if (this.selectedGame === 'chinese-chess') this.chessPieces = board as string[]
      else this.board = board as number[]
      this.currentPiece = snapshot['player'] as number
    } catch (_) {
      this.studyText = '保存的局面无法读取'
    }
  }

  private undoEditorBoard(): void {
    if (this.editorHistory.length === 0) {
      this.studyText = '没有可以撤销的操作'
      return
    }
    const history = this.editorHistory.slice()
    const encoded = history.pop()
    this.editorHistory = history
    if (encoded) this.restoreEditorSnapshot(encoded)
    this.studyText = '已撤销一步'
  }

  private replaceEditorBoard(standard: boolean): void {
    this.editorHistory = this.editorHistory.concat([JSON.stringify({ board: this.analysisBoard(), player: this.currentPiece })])
    const replacement = standard ? standardBoard(this.selectedGame) : emptyBoard(this.selectedGame)
    if (this.selectedGame === 'chinese-chess') this.chessPieces = replacement as string[]
    else this.board = replacement as number[]
    this.currentPiece = 1
    this.studyText = standard ? '已恢复标准局面' : '已清空棋盘'
  }

  private saveEditorBoard(): void {
    preferences.getPreferences(getContext(this), 'zz_boardgames_editor').then((store: preferences.Preferences) => {
      store.putSync(`position_${this.selectedGame}`, JSON.stringify({ board: this.analysisBoard(), player: this.currentPiece }))
      store.flush().then(() => this.studyText = '保存局面完成').catch(() => this.studyText = '保存局面失败')
    }).catch(() => this.studyText = '保存局面失败')
  }

  private loadEditorBoard(): void {
    preferences.getPreferences(getContext(this), 'zz_boardgames_editor').then((store: preferences.Preferences) => {
      const encoded = store.getSync(`position_${this.selectedGame}`, '') as string
      if (!encoded) {
        this.studyText = '还没有保存的局面'
        return
      }
      this.editorHistory = this.editorHistory.concat([JSON.stringify({ board: this.analysisBoard(), player: this.currentPiece })])
      this.restoreEditorSnapshot(encoded)
      this.studyText = '载入局面完成'
    }).catch(() => this.studyText = '载入局面失败')
  }

  private startEditorGame(): void {
    const result = validateEditorState(this.selectedGame, this.analysisBoard())
    this.studyText = result.message
    if (!result.valid) return
    this.studyMode = 'play'
    this.localAiEnabled = false
    this.gameStatus = '自建局面 · 开始对局'
    this.editorHistory = []
    this.editorOrigin = ''
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
    this.pushBoardHistory()
    if (this.board[index] !== 0 || this.awaitingMove) return
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

  private moveChecker(index: number): void {
    if (this.selectedCell < 0) {
      if (this.board[index] === 0) return
      if (this.roomId === '本地' && this.aiThinking) return
      this.selectedCell = index
      this.gameStatus = '已选棋子，点斜前方空格移动'
      return
    }
    const from = this.selectedCell
    if (!this.applyCheckerMove(from, index)) return
    this.selectedCell = -1
    if (!this.aiApplying && this.roomId === '本地' && this.localAiEnabled && this.supportsLocalAi() &&
      this.gameStatus.indexOf('获胜') < 0) {
      this.scheduleLocalAi()
    }
  }

  // 跳棋走子的唯一实现：玩家点击与 AI 都走这里，避免两套规则漂移
  private applyCheckerMove(from: number, index: number): boolean {
    this.pushBoardHistory()
    const piece = this.board[from]
    if (piece === 0) return false
    const fromRow = Math.floor(from / 8)
    const fromColumn = from % 8
    const toRow = Math.floor(index / 8)
    const toColumn = index % 8
    const rowDistance = Math.abs(toRow - fromRow)
    const columnDistance = Math.abs(toColumn - fromColumn)
    if (this.board[index] !== 0 || rowDistance !== columnDistance || rowDistance > 2) {
      this.gameStatus = '只能沿对角线走一步，或跨过一枚棋子'
      return false
    }
    const next = this.board.slice()
    if (rowDistance === 2) {
      const middle = (fromRow + toRow) / 2 * 8 + (fromColumn + toColumn) / 2
      if (next[middle] === 0 || next[middle] === piece) {
        this.gameStatus = '跨越时中间必须是对方棋子'
        return false
      }
      next[middle] = 0
      this.gameStatus = '吃掉一枚棋子'
    } else {
      this.gameStatus = '移动完成'
    }
    next[index] = piece
    next[from] = 0
    this.board = next
    this.currentPiece = this.currentPiece === 1 ? 2 : 1
    return true
  }

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

  private drawRummyTile(): void {
    if (this.rummyDeckCount <= 0) {
      this.gameStatus = '牌堆已摸完'
      return
    }
    const color = Math.floor(Math.random() * 4)
    const value = Math.floor(Math.random() * 13) + 1
    this.rummyHand = [...this.rummyHand, color * 20 + value]
    this.rummyDeckCount -= 1
    this.gameStatus = `已摸牌 · 牌堆剩 ${this.rummyDeckCount}`
  }

  private playRummyTile(): void {
    if (this.selectedTile < 0 || this.selectedTile >= this.rummyHand.length) {
      this.gameStatus = '先在牌架上选择一张牌'
      return
    }
    const tile = this.rummyHand[this.selectedTile]
    this.rummyTable = [...this.rummyTable, tile]
    this.rummyHand = this.rummyHand.filter((_: number, index: number) => index !== this.selectedTile)
    this.selectedTile = -1
    this.gameStatus = this.rummyHand.length === 0 ? '你的牌已出完' : '已放到公共组合区'
  }

  private rollLudoDice(): void {
    // AI 陪练：只有红家（玩家）掷骰；线下多人：四家轮流由人掷骰
    if (this.localAiEnabled && this.ludoTurn !== 0) {
      return
    }
    const again = this.ludoTakeTurn(this.ludoTurn)
    if (again && !this.ludoGameOver()) {
      return
    }
    if (!this.ludoGameOver()) {
      this.ludoTurn = (this.ludoTurn + 1) % 4
      this.ludoKickTurn()
    }
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

  private ludoAiLoop(): void {
    if (this.ludoTurn === 0 || this.ludoGameOver() || !this.localAiEnabled) {
      return
    }
    setTimeout(() => {
      // 等待期间用户可能已切到「线下多人」，不能再替人走子
      if (!this.localAiEnabled || this.ludoTurn === 0 || this.ludoGameOver()) {
        return
      }
      const again = this.ludoTakeTurn(this.ludoTurn)
      if (again && !this.ludoGameOver()) {
        this.ludoAiLoop()
      } else if (!this.ludoGameOver()) {
        this.ludoTurn = (this.ludoTurn + 1) % 4
        this.ludoKickTurn()
      }
    }, 700)
  }

  private ludoGameOver(): boolean {
    for (let p = 0; p < 4; p++) {
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

  // 国内规则：掷 6 起飞并再掷一次；撞子回基地；落同色格连跳 4 格；超程反弹；恰好 56 到达
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
    const old = pieces[best]
    let np: number
    let msg = ''
    if (old < 0) {
      np = 0
      msg = `${name}家第 ${best + 1} 架起飞（掷 6）`
    } else {
      np = old + dice
      if (np > 56) {
        np = 112 - np
        msg = `${name}家第 ${best + 1} 架超程反弹`
      } else {
        msg = `${name}家第 ${best + 1} 架前进 ${dice} 格`
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
    pieces[best] = np
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
      // 不再发送 bypassValidation：服务端已明确不信任该字段，
      // 原生端凭 X-Passport-Client 标识走受控通道，可只填账号密码。
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
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text(this.connectionText)
          .fontSize(12)
          .fontColor(this.mutedColor())
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      Blank()
      Text(this.socketActive ? '主站在线' : '主站待连接')
        .fontSize(12)
        .fontColor(this.socketActive ? this.accentColor() : this.mutedColor())
        .padding({ left: 10, right: 10, top: 6, bottom: 6 })
        .backgroundColor(this.socketActive ? this.positiveSurfaceColor() : this.warningSurfaceColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(6)
    }
    .width('100%')
  }

  @Builder
  GameCard(game: GameInfo) {
    Column({ space: 8 }) {
      Row() {
        Stack() {
          Image(game.icon)
            .width(32)
            .height(32)
            .objectFit(ImageFit.Contain)
        }
          .width(40)
          .height(40)
          .backgroundColor(this.darkTheme() ? '#303733' : '#F0F3F0')
          .borderRadius(8)
        Blank()
        Text(game.players)
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      Text(game.title)
        .width('100%')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(game.note)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
    }
    .width('100%')
    .padding(14)
    .backgroundColor(this.selectedGame === game.id ? this.selectedCardColor() : this.cardColor())
    .border({
      width: this.selectedGame === game.id ? 2 : 1,
      color: this.selectedGame === game.id ? this.selectedBorderColor() : this.themeBorderColor()
    })
    .borderRadius(8)
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
          Text(this.socketActive ? '主站在线' : '待连接')
            .fontSize(12)
            .fontColor(this.socketActive ? this.accentColor() : this.mutedColor())
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.socketActive ? this.positiveSurfaceColor() : this.controlColor())
            .border({ width: 1, color: this.socketActive ? this.selectedBorderColor() : this.themeBorderColor() })
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

      Row({ space: 14 }) {
        Column({ space: 4 }) {
          Text('棋局研习')
            .fontSize(19)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Text('五子棋、围棋、中国象棋 · 残局与分析')
            .fontSize(12)
            .fontColor(this.mutedColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Button('进入研习')
          .height(42)
          .fontColor(this.controlTextColor())
          .backgroundColor(this.controlColor())
          .border({ width: 1, color: this.selectedBorderColor() })
          .borderRadius(8)
          .onClick(() => this.openSecondary('study'))
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.positiveSurfaceColor())
      .border({ width: 1, color: this.selectedBorderColor() })
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
        Text('主站实时数据')
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
  StudyHub() {
    Column({ space: 18 }) {
      Column({ space: 5 }) {
        Text('先选棋种，再选研习方式')
          .width('100%')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text('研习不会加入联机房间，残局、自建局面和 AI 对弈保持独立。')
          .width('100%')
          .fontSize(13)
          .fontColor(this.mutedColor())
      }
      .width('100%')

      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(this.games.filter((game: GameInfo) =>
          game.id === 'gobang' || game.id === 'go' || game.id === 'chinese-chess'), (game: GameInfo) => {
          Row({ space: 12 }) {
            Image(game.icon)
              .width(42)
              .height(42)
              .objectFit(ImageFit.Contain)
            Column({ space: 3 }) {
              Text(game.title)
                .fontSize(17)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.textColor())
              Text(game.id === 'go' ? '死活、形势与自建' :
                (game.id === 'chinese-chess' ? '残局、杀法与自建' : '连五、防守与自建'))
                .fontSize(12)
                .fontColor(this.mutedColor())
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
          }
          .width(this.isWideWorkspace() ? '32%' : '100%')
          .height(76)
          .padding(14)
          .margin({ bottom: 8 })
          .backgroundColor(this.selectedGame === game.id ? this.selectedCardColor() : this.cardColor())
          .border({ width: this.selectedGame === game.id ? 2 : 1,
            color: this.selectedGame === game.id ? this.selectedBorderColor() : this.themeBorderColor() })
          .borderRadius(8)
          .onClick(() => {
            this.selectGame(game)
            this.studyMode = 'puzzle'
          })
        }, (game: GameInfo) => game.id)
      }
      .width('100%')

      Column({ space: 12 }) {
        Text(`${this.gameTitle()} 研习方式`)
          .width('100%')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
          ForEach(this.studyModes(), (mode: StringPair) => {
            Button(mode.title)
              .width(this.isWideWorkspace() ? '24%' : '49%')
              .height(42)
              .margin({ right: this.isWideWorkspace() ? 6 : 2, bottom: 8 })
              .fontColor(this.studyMode === mode.id ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.studyMode === mode.id ? this.accentColor() : this.controlColor())
              .border({ width: 1, color: this.studyMode === mode.id ? this.selectedBorderColor() : this.themeBorderColor() })
              .borderRadius(8)
              .onClick(() => this.studyMode = mode.id)
          }, (mode: StringPair) => mode.id)
        }
        .width('100%')

        Text('执棋顺序')
          .width('100%')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach([
            { id: 'first', title: this.selectedGame === 'chinese-chess' ? '我执红先手' : '我执黑先手' },
            { id: 'second', title: this.selectedGame === 'chinese-chess' ? '我执黑后手' : '我执白后手' }
          ], (side: StringPair) => {
            Button(side.title)
              .layoutWeight(1)
              .height(42)
              .fontSize(13)
              .fontColor(this.studySide === side.id ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.studySide === side.id ? this.accentColor() : this.controlColor())
              .borderRadius(8)
              .onClick(() => this.studySide = side.id)
          }, (side: StringPair) => side.id)
        }
        .width('100%')

        Text('AI 难度')
          .width('100%')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Row({ space: 8 }) {
          ForEach(['轻松', '标准', '困难'], (level: string) => {
            Button(level)
              .layoutWeight(1)
              .height(40)
              .fontColor(this.aiDifficulty === level ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.aiDifficulty === level ? this.accentColor() : this.controlColor())
              .borderRadius(8)
              .onClick(() => this.aiDifficulty = level)
          })
        }
        .width('100%')

        Button('开始研习')
          .width('100%')
          .height(48)
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .backgroundColor(this.accentColor())
          .borderRadius(8)
          .onClick(() => this.beginStudy())
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
      TextInput({ text: this.gameSearchText, placeholder: '搜索桌游' })
        .width('100%')
        .height(44)
        .fontColor(this.textColor())
        .placeholderColor(this.mutedColor())
        .backgroundColor(this.controlColor())
        .border({ width: 1, color: this.themeBorderColor() })
        .borderRadius(8)
        .onChange((value: string) => this.gameSearchText = value)
      Scroll() {
        Row({ space: 8 }) {
          ForEach([
            { id: 'all', title: '全部' },
            { id: 'board', title: '棋类' },
            { id: 'cards', title: '牌类' },
            { id: 'party', title: '聚会' },
            { id: 'casual', title: '休闲' }
          ], (category: StringPair) => {
            Button(category.title)
              .height(36)
              .fontSize(13)
              .fontColor(this.gameCategory === category.id ? '#FFFFFF' : this.controlTextColor())
              .backgroundColor(this.gameCategory === category.id ? this.accentColor() : this.controlColor())
              .border({ width: 1, color: this.gameCategory === category.id ? this.accentColor() : this.themeBorderColor() })
              .borderRadius(6)
              .onClick(() => this.gameCategory = category.id)
          }, (category: StringPair) => category.id)
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      Text(`找到 ${this.filteredGames().length} 款桌游`)
        .width('100%')
        .fontSize(12)
        .fontColor(this.mutedColor())
      Grid() {
        ForEach(this.filteredGames(), (game: GameInfo) => {
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
  BoardIntersection(index: number, size: number, lineColor: string) {
    Stack() {
      Row({ space: 0 }) {
        if (index % size > 0) {
          Text('')
            .layoutWeight(1)
            .height(1)
            .backgroundColor(lineColor)
        } else {
          Blank().layoutWeight(1)
        }
        if (index % size < size - 1) {
          Text('')
            .layoutWeight(1)
            .height(1)
            .backgroundColor(lineColor)
        } else {
          Blank().layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .alignItems(VerticalAlign.Center)
      Column({ space: 0 }) {
        if (Math.floor(index / size) > 0) {
          Text('')
            .layoutWeight(1)
            .width(1)
            .backgroundColor(lineColor)
        } else {
          Blank().layoutWeight(1)
        }
        if (Math.floor(index / size) < size - 1) {
          Text('')
            .layoutWeight(1)
            .width(1)
            .backgroundColor(lineColor)
        } else {
          Blank().layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
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
      // 居中后每格中心正好落在交叉点（与 xiangqi_board 校准推导相同）
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
              .border({ width: 0.75, color: '#162B20' })
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
      .columnsTemplate(this.gridTemplate(8))
      .rowsTemplate(this.gridTemplate(8))
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
            .backgroundColor('#111111')
            .opacity(this.board[index] === 0 ? 0.04 : 0.92)
            .border({ width: 1, color: '#2A2A2A' })
            .onClick(() => { if (this.confirmCell(index)) this.placeSimple(index, 3) })
        }
      }, (_: number, index: number) => `tic-${index}-${this.board[index]}`)
      }
      .columnsTemplate(this.gridTemplate(3))
      .rowsTemplate(this.gridTemplate(3))
      .width('86%')
      .aspectRatio(1)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .backgroundColor(this.darkTheme() ? '#171A1D' : '#F2EEE5')
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

      // 底图画线与星位，棋子落在校准网格交叉点上：
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

  // 象棋棋子字号：Grid 宽 92.25%、9 列 → 格宽 ≈ 棋盘宽 10.25%；
  // Grid 高 81.88%、10 行 → 格高 ≈ 8.19%。棋子取格高的 92%，
  // 字取棋子直径的 56%（实物标定）。两端夹逼，防止小屏字溢出、大屏字过小。
  private xiangqiPieceFont(): number {
    const cell = this.boardWidth() * 0.9225 / 9
    const disc = Math.min(cell, this.boardWidth() * 0.8188 / 10) * 0.92
    return Math.max(11, Math.min(30, Math.round(disc * 0.56)))
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
      // 按 xiangqi_board.png 实测（线间距 82px / 65.5px 完全等差）：
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
    Stack() {
      Image(this.boardArtwork('checkers'))
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
              .backgroundColor((Math.floor(index / 8) + index % 8) % 2 === 0 ? '#E8D5AE' : '#755038')
              .opacity(0.22)
            if (this.board[index] !== 0) {
              Text('')
                .width('68%')
                .height('68%')
                .backgroundColor(this.board[index] === 1 ? '#313A45' : '#B5443D')
                .border({ width: this.selectedCell === index ? 4 : 2, color: this.selectedCell === index ? '#F1C75B' : (this.board[index] === 1 ? '#151A20' : '#7A2925') })
                .borderRadius(99)
            }
          }
          .onClick(() => { if (this.confirmCell(index)) this.moveChecker(index) })
        }
      }, (_: number, index: number) => `checkers-${index}-${this.board[index]}-${this.selectedCell}`)
      }
      .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr')
      .width('86%')
      .aspectRatio(1)
    }
    .width(this.boardWidth())
    .aspectRatio(1)
    .borderRadius(8)
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
                  .fontColor(this.worldChessPieces[index].startsWith('w') ? '#FFFFFF' : '#26221C')
                  .shadow({ radius: 2, color: this.worldChessPieces[index].startsWith('w') ? '#6B5335' : '#D8C49E', offsetX: 0, offsetY: 1 })
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

  // 牌架单张牌：普通模式点击=选牌出牌；整理模式点击=两两交换位置
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
        width: this.selectedTile === index ? 3 : 1.5,
        color: this.selectedTile === index ?
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
        this.selectedTile = index
      })
  }

  @Builder
  RummyTable() {
    Column({ space: 14 }) {
      Row() {
        Text(`牌堆 ${this.rummyDeckCount}`)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Blank()
        Text(this.gameStatus)
          .fontSize(12)
          .fontColor(this.mutedColor())
      }
      .width('100%')
      Text('公共组合区')
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.mutedColor())
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
        ForEach(this.rummyTable, (tile: number, index: number) => {
          Text(this.tileLabel(tile))
            .width(42)
            .height(58)
            .margin(4)
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.tileColor(tile))
            .textAlign(TextAlign.Center)
            .backgroundColor('#F6F2E8')
            .border({ width: 1.5, color: '#BBAE98' })
            .borderRadius(6)
        }, (tile: number, index: number) => `table-tile-${index}-${tile}`)
      }
      .width('100%')
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
            this.selectedTile = -1
            this.gameStatus = this.rummySortMode ? '整理模式：点两张牌交换位置' : '已退出整理模式'
          })
      }
      .width('100%')
      Row({ space: 10 }) {
        Button('摸牌')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.controlColor())
          .fontColor(this.controlTextColor())
          .border({ width: 1, color: this.themeBorderColor() })
          .onClick(() => this.drawRummyTile())
        Button('放到桌面')
          .layoutWeight(1)
          .height(42)
          .backgroundColor(this.accentColor())
          .onClick(() => this.playRummyTile())
      }
      .width('100%')
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
              .border({ width: 1.5, color: '#FFFFFF' })
              .position({ x: `${this.ludoPlanePos(index)[0]}%`, y: `${this.ludoPlanePos(index)[1]}%` })
              .markAnchor({ x: '50%', y: '50%' })
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
        Button(this.ludoTurn === 0 ? '掷骰子（红家）' :
          (this.localAiEnabled ? 'AI 行动中…' : `掷骰子（${this.ludoPlayerName[this.ludoTurn]}家）`))
          .layoutWeight(1)
          .height(48)
          .backgroundColor(this.accentColor())
          .enabled((this.ludoTurn === 0 || !this.localAiEnabled) && !this.ludoGameOver())
          .onClick(() => this.rollLudoDice())
      }
      .width('100%')
    }
    .width(this.boardWidth())
    .padding(8)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.themeBorderColor() })
    .borderRadius(8)
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
            Text(this.junqiShortName(this.junqiBoard[index]))
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Center)
              .width('12.6%')
              .height('5.4%')
              .backgroundColor(this.junqiSideOf(this.junqiBoard[index]) === 'r' ? '#C0392B' : '#2E5C8A')
              .borderRadius(5)
              .border({ width: this.junqiSelected === index ? 2.5 : 1, color: this.junqiSelected === index ? '#F5C542' : '#FFFFFF' })
              .position({ x: `${this.junqiPosX[index]}%`, y: `${this.junqiPosY[index]}%` })
              .markAnchor({ x: '50%', y: '50%' })
              .onClick(() => this.junqiTap(index))
          }
        }, (_: number, index: number) => `junqi-piece-${index}`)
        ForEach(Array(60).fill(0), (_: number, index: number) => {
          if (this.junqiBoard[index].length === 0 && this.junqiSelected >= 0 &&
            this.junqiMovesFrom(this.junqiSelected).indexOf(index) >= 0) {
            Text('·')
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor('#F5C542')
              .textAlign(TextAlign.Center)
              .width('12.6%')
              .height('5.4%')
              .backgroundColor('rgba(245,197,66,0.25)')
              .borderRadius(5)
              .border({ width: 1.5, color: '#F5C542' })
              .position({ x: `${this.junqiPosX[index]}%`, y: `${this.junqiPosY[index]}%` })
              .markAnchor({ x: '50%', y: '50%' })
              .onClick(() => this.junqiTap(index))
          }
        }, (_: number, index: number) => `junqi-target-${index}`)
      }
      // 军棋底图 junqi_board.png 实测 520x1298（宽/高 ≈ 0.401），容器必须与底图同比例，
      // 否则 imageFit(Fill) 会拉伸棋子与文字变形（旧值 0.44 偏大，纵向被压扁）。
      //
      // 该棋盘是「窄长条」形：若沿用其它棋类的 width('100%') + aspectRatio，
      // 宽度会顶满屏幕而两侧留出大片空白（真机截图里就是这样）。
      // 改为按可用高度定尺寸、以高度反推宽度，宽度上限 520（与底图原始像素宽一致，
      // HarmonyOS 默认 vp 即按 1:1 映射），窄长棋盘就会居中显示且不留空。
      .constraintSize({ maxWidth: 520, minWidth: 220, maxHeight: '78%' })
      .aspectRatio(0.401)
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
    } else if (this.selectedGame === 'mahjong' || this.selectedGame === 'poker') {
      this.CardTable()
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
                .backgroundColor(this.editorChessPiece === piece ? this.accentColor() : this.controlColor())
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
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          Button('撤销')
            .width('24%').height(36).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.undoEditorBoard())
          Button('清空')
            .width('24%').height(36).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.replaceEditorBoard(false))
          Button('标准局面')
            .width('24%').height(36).fontSize(11).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.replaceEditorBoard(true))
          Button(this.currentPiece === 1 ? '先手' : '后手')
            .width('24%').height(36).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.currentPiece = this.currentPiece === 1 ? 2 : 1)
          Button('保存局面')
            .width('24%').height(36).margin({ top: 6 }).fontSize(11).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.saveEditorBoard())
          Button('载入局面')
            .width('24%').height(36).margin({ top: 6 }).fontSize(11).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.loadEditorBoard())
          Button('检查局面')
            .width('24%').height(36).margin({ top: 6 }).fontSize(11).fontColor(this.controlTextColor()).backgroundColor(this.controlColor()).borderRadius(7)
            .onClick(() => this.checkEditorBoard())
          Button('开始对局')
            .width('24%').height(36).margin({ top: 6 }).fontSize(11).backgroundColor(this.accentColor()).borderRadius(7)
            .onClick(() => this.startEditorGame())
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
          Button(this.voiceJoined ? '退出语音' : this.voiceText)
            .height(36)
            .margin({ left: 8 })
            .backgroundColor(this.voiceJoined ? this.accentColor() : this.controlColor())
            .fontColor(this.voiceJoined ? '#FFFFFF' : this.controlTextColor())
            .border({ width: 1, color: this.voiceJoined ? this.selectedBorderColor() : this.themeBorderColor() })
            .borderRadius(8)
            .onClick(() => this.toggleVoice())
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
      Text('铮铮桌游中心')
        .width('100%')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
      Text(`HarmonyOS ${this.appVersion} · build ${this.appBuild}`)
        .width('100%')
        .fontSize(15)
        .fontColor(this.accentColor())
      Text('支持 HarmonyOS 手机、平板与 2in1。联机房间优先连接 zhengzhengstudio.cn；本地练习不显示邀请和聊天控件。')
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
              .fontColor([this.activeTab === item.id ? '#FFFFFF' : this.mutedColor()])
            Text(item.title)
              .fontSize(11)
              .fontColor(this.activeTab === item.id ? '#FFFFFF' : this.mutedColor())
          }
        }
          .layoutWeight(1)
          .height(54)
          .backgroundColor(this.activeTab === item.id ? this.accentColor() : this.cardColor())
          .borderRadius(6)
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
    .borderRadius(8)
  }

  build() {
    Column({ space: 10 }) {
      Scroll() {
        Column({ space: 20 }) {
          this.TopBar()
          if (this.pendingInviteRoom.length > 0) {
            this.InviteConfirmation()
          }
          if (this.secondaryPage === 'public') {
            this.PublicRoomsPanel()
          } else if (this.secondaryPage === 'leaderboard') {
            this.LeaderboardPanel()
          } else if (this.secondaryPage === 'passport') {
            this.PassportPanel()
          } else if (this.secondaryPage === 'preferences') {
            this.PreferencesPanel()
          } else if (this.secondaryPage === 'update') {
            this.UpdateCenter()
          } else if (this.secondaryPage === 'feedback') {
            this.FeedbackPanel()
          } else if (this.secondaryPage === 'about') {
            this.AboutPanel()
          } else if (this.secondaryPage === 'study') {
            this.StudyHub()
          } else if (this.page === 'game') {
            this.GameRoom()
          } else if (this.activeTab === 'lobby') {
            this.Lobby()
          } else if (this.activeTab === 'room') {
            this.RoomHub()
          } else if (this.activeTab === 'games') {
            this.GameLibrary()
          } else if (this.activeTab === 'profile') {
            this.Profile()
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: this.contentMaxWidth() })
        .padding({ left: this.pagePadding(), right: this.pagePadding(), top: this.windowHeight < 620 ? 12 : 22, bottom: 18 })
      }
      .width('100%')
      .layoutWeight(1)
      if (this.page !== 'game' && this.activeTab !== 'room' && this.secondaryPage.length === 0) {
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
