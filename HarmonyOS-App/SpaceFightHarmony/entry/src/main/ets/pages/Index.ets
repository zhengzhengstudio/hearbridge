import http from '@ohos.net.http'
import webSocket from '@ohos.net.webSocket'
import preferences from '@ohos.data.preferences'

const LOCAL_MAX_TURN_RATE: number = Math.PI * 1.25
const ANALOG_DEADZONE: number = 0.05
const ANALOG_RESPONSE_EXPONENT: number = 0.72

/**
 * 飞行手感（与 Cocos 端 FlightTuning 对齐）。
 *
 * 之前速度是**无状态瞬时值**：位置每帧直接用 throttle × 常量速度积分，
 * 松开摇杆速度立刻归零 → 表现为「像在冰面上滑」「飘不起来」，没有飞船该有的惯性。
 *
 * 现在改成「当前速度 → 目标速度」的一阶追赶：
 *  - 推油门时向最大速度逼近，耗时 throttleResponse（越小越跟手）
 *  - 松手时目标速度为 **0**，按 coastDrag 衰减 → 先滑行一段再停住
 *
 * ⚠️ 松手目标必须是 0，不能是某个「保底比例」：
 * 用保底比例会让玩家不操作时永远匀速飘走，既无法悬停也会飞出战场。
 * 惯性的价值在于「松手后滑行一段」，而不是「永远在动」。
 */
const FLIGHT_THROTTLE_RESPONSE: number = 0.28
const FLIGHT_COAST_DRAG: number = 0.5

/** 每次受击后的短暂无敌时间，防止被同一次齐射瞬间打死。 */
const PLAYER_HIT_GRACE_SECONDS: number = 0.42

type MissionKind = 'survival' | 'boss' | 'escort' | 'defense' | 'timed' | 'raid'
type CameraMode = 'cockpit' | 'chase'
type RegionKind = 'canyon' | 'storm'

interface MissionItem {
  id: MissionKind
  title: string
  detail: string
  objective: string
}

interface ObjectiveState {
  label: string
  progress: number
  escortHealth: number
  controlProgress: number
  timeRemaining: number
  raidCollected: number
  bossComponents: number
}

interface BattleEntity {
  id: string
  type: string
  x: number
  z: number
  rotation: number
  health: number
  maxHealth: number
  owner: string
  weapon: string
}

interface LocalBody extends BattleEntity {
  vx: number
  vz: number
  life: number
}

interface BattleState {
  wave: number
  score: number
  health: number
  shield: number
  energy: number
  players: BattleEntity[]
  enemies: BattleEntity[]
  bullets: BattleEntity[]
  powerups: BattleEntity[]
  objective: ObjectiveState
  missionComplete: boolean
  missionFailed: boolean
}

interface DownloadEntry {
  id: string
  build: number
  version: string
  downloadURL: string
}

interface JoinPacket {
  type: string
  mode: string
  difficulty: string
  name: string
}

interface InputPayload {
  throttle: number
  strafe: number
  turn: number
  boost: boolean
  fire: boolean
  weapon: number
}

interface InputPacket {
  type: string
  input: InputPayload
}

interface LeavePacket {
  type: string
}

@Entry
@Component
struct Index {
  private readonly appVersion: string = '0.12.0'
  private readonly appBuild: number = 20
  private readonly updateId: string = 'spacefight-harmonyos'
  private readonly manifestUrl: string = 'https://zhengzhengstudio.cn/api/apps/manifest.json'
  private readonly passportUrl: string = 'https://zhengzhengstudio.cn/api/auth/login'
  private settings: RenderingContextSettings = new RenderingContextSettings(true)
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings)
  private socket: webSocket.WebSocket = webSocket.createWebSocket()
  private frameTimer: number = -1
  private inputTimer: number = -1
  private playerId: string = ''
  private canvasWidth: number = 1
  private canvasHeight: number = 1
  private throttle: number = 0
  private strafe: number = 0
  private turn: number = 0
  private firing: boolean = false
  private weapon: number = 0
  private joystickX: number = 0
  private joystickY: number = 0
  private stars: number[][] = []
  private localRunning: boolean = false
  private localX: number = 0
  private localZ: number = 8
  private localRotation: number = 0
  private localCooldown: number = 0
  private enemyFireCooldown: number = 0.7
  private localWaveDelay: number = 0.6
  private localNextId: number = 1
  private localElapsed: number = 0
  private escortProgress: number = 0
  private previousBossHealth: number = 0
  private region: RegionKind = 'canyon'
  private lockRange: number = 30
  private energyRecovery: number = 20
  private maxHealth: number = 100
  private maxShield: number = 80
  private speedFactor: number = 1
  private turnFactor: number = 1
  private damageFactor: number = 1
  private energyCostFactor: number = 1
  private pickupRadius: number = 2.2
  private scoreFactor: number = 1
  private hullRegen: number = 0
  private shieldRegen: number = 3.5
  private energyRecoveryFactor: number = 1
  private localEnemies: LocalBody[] = []
  private localBullets: LocalBody[] = []
  private localResources: LocalBody[] = []
  private timeRemaining: number = 0
  private localKills: number = 0
  private hitFlashUntil: number = 0
  /** 当前纵向速度标量（一阶收敛的结果，范围约 -1 ~ 1.5）。 */
  private currentSpeed: number = 0
  /** 受击后剩余无敌时间，> 0 时免疫伤害。 */
  private hitGraceRemaining: number = 0
  /** 本步内累积的玩家伤害，步末由 flushPlayerDamage() 一次性结算。 */
  private pendingPlayerDamage: number = 0
  private battlefieldImage: ImageBitmap = new ImageBitmap('spacefight-battlefield.png')
  private interceptorImage: ImageBitmap = new ImageBitmap('ships/interceptor.png')
  private scoutImage: ImageBitmap = new ImageBitmap('ships/scout.png')
  private fighterImage: ImageBitmap = new ImageBitmap('ships/fighter.png')
  private bomberImage: ImageBitmap = new ImageBitmap('ships/bomber.png')
  private gunshipImage: ImageBitmap = new ImageBitmap('ships/gunship.png')
  private bossImage: ImageBitmap = new ImageBitmap('ships/boss.png')
  private battle: BattleState = {
    wave: 0,
    score: 0,
    health: 100,
    shield: 100,
    energy: 100,
    players: [],
    enemies: [],
    bullets: [],
    powerups: [],
    objective: {
      label: '等待部署', progress: 0, escortHealth: 100, controlProgress: 0,
      timeRemaining: 90, raidCollected: 0, bossComponents: 4
    },
    missionComplete: false,
    missionFailed: false
  }

  private readonly missionItems: MissionItem[] = [
    { id: 'survival', title: '边境生存', detail: '无限升级敌潮', objective: '坚持更久并刷新本机纪录' },
    { id: 'boss', title: '组件猎杀', detail: '拆解三个武器组件', objective: '摧毁组件后击穿旗舰核心' },
    { id: 'escort', title: '护航走廊', detail: '保护运输舰穿越战区', objective: '压制贴近运输舰的敌机' },
    { id: 'defense', title: '阵地控制', detail: '稳住信标控制权', objective: '清空中心区并完成占领' },
    { id: 'timed', title: '限时歼灭', detail: '连杀延长倒计时', objective: '倒计时内击毁 18 个目标' },
    { id: 'raid', title: '资源突袭', detail: '夺取 8 份战区资源', objective: '扫描并回收散布的能源容器' }
  ]

  @State private screen: string = 'launch'
  @State private statusText: string = '本地任务已就绪 · 在线协作可用'
  @State private selectedMode: string = 'survival'
  @State private loadoutWeapon: number = 0
  @State private loadoutDevice: number = 0
  @State private loadoutCore: number = 0
  @State private leftHanded: boolean = false
  @State private aimSensitivity: number = 1
  @State private keyboardPreset: number = 0
  @State private fireKeyPreset: number = 0
  @State private cameraKeyPreset: number = 0
  @State private cameraMode: CameraMode = 'chase'
  @State private compactDeck: boolean = true
  @State private pilotName: string = 'Player'
  @State private account: string = ''
  @State private password: string = ''
  @State private loginText: string = ''
  @State private updateText: string = '版本 0.12.0 · build 63'
  @State private paused: boolean = false
  @State private trainingStep: number = -1
  private trainingCompleted: boolean = false
  private leftTouchId: number = -1
  private rightTouchId: number = -1
  private fireTouchId: number = -1
  private aimStartX: number = 0
  private pressedKeys: number[] = []

  aboutToAppear(): void {
    for (let i = 0; i < 110; i++) {
      this.stars.push([
        ((i * 47) % 997) / 997,
        ((i * 83 + 19) % 991) / 991,
        0.6 + (i % 5) * 0.25
      ])
    }
    preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
      store.get('display_name', 'Player').then((value: preferences.ValueType) => {
        this.pilotName = String(value)
      })
      store.get('flight_training_complete', false).then((value: preferences.ValueType) => {
        this.trainingCompleted = Boolean(value)
      })
      store.get('camera_mode', 'chase').then((value: preferences.ValueType) => {
        this.cameraMode = String(value) === 'cockpit' ? 'cockpit' : 'chase'
      })
      store.get('starting_weapon', 0).then((value: preferences.ValueType) => {
        this.loadoutWeapon = Math.max(0, Math.min(4, Number(value)))
      })
      store.get('tactical_device', 0).then((value: preferences.ValueType) => {
        this.loadoutDevice = Math.max(0, Math.min(4, Number(value)))
      })
      store.get('frame_core', 0).then((value: preferences.ValueType) => {
        this.loadoutCore = Math.max(0, Math.min(5, Number(value)))
      })
      store.get('left_handed', false).then((value: preferences.ValueType) => this.leftHanded = Boolean(value))
      store.get('aim_sensitivity', 1).then((value: preferences.ValueType) => {
        this.aimSensitivity = Math.max(0.65, Math.min(1.6, Number(value)))
      })
      store.get('keyboard_preset', 0).then((value: preferences.ValueType) => this.keyboardPreset = Number(value) % 3)
      store.get('fire_key_preset', 0).then((value: preferences.ValueType) => this.fireKeyPreset = Number(value) % 3)
      store.get('camera_key_preset', 0).then((value: preferences.ValueType) => this.cameraKeyPreset = Number(value) % 3)
    })
    this.checkUpdates(false)
  }

  aboutToDisappear(): void {
    this.disconnect()
  }

  private modeName(mode: string): string {
    if (mode === 'public') return '公开协作'
    let mission = this.missionItems.find((item: MissionItem) => item.id === mode)
    return mission ? mission.title : '边境生存'
  }

  private weaponName(value: number): string {
    return ['脉冲炮', '散射炮', '追踪导弹', '磁轨炮', '等离子炮'][Math.max(0, Math.min(4, value))]
  }

  private deviceName(value: number): string {
    return ['猎手阵列', '纳米修复', '弹药织机', '牵引收集器', '神盾投射器'][Math.max(0, Math.min(4, value))]
  }

  private coreName(value: number): string {
    return ['均衡核心', '矢量核心', '堡垒核心', '反应堆核心', '幻影核心', '无畏核心'][Math.max(0, Math.min(5, value))]
  }

  private startGame(): void {
    this.resetInput()
    this.weapon = this.loadoutWeapon
    this.screen = 'game'
    this.paused = false
    if (this.selectedMode === 'public') {
      this.statusText = '正在连接战区'
      this.connectSocket()
    } else {
      this.resetLocalBattle()
      this.localRunning = true
      this.trainingStep = this.trainingCompleted ? -1 : 0
      this.statusText = this.trainingStep >= 0 ? '飞行校准 · 完成三项操作后敌潮抵达' : '离线战斗 · 本机 60 Hz'
      if (this.inputTimer >= 0) clearInterval(this.inputTimer)
      this.inputTimer = setInterval(() => this.stepLocalBattle(), 16)
    }
    if (this.frameTimer >= 0) clearInterval(this.frameTimer)
    this.frameTimer = setInterval(() => this.draw(), 16)
  }

  private connectSocket(): void {
    this.socket = webSocket.createWebSocket()
    this.socket.on('open', (error: BusinessError) => {
      if (error) {
        this.statusText = '无法连接服务器'
        return
      }
      this.statusText = `已连接 · ${this.modeName(this.selectedMode)}`
      let joinPacket: JoinPacket = {
        type: 'join',
        mode: this.selectedMode,
        difficulty: 'normal',
        name: this.pilotName
      }
      this.send(joinPacket)
      if (this.inputTimer >= 0) clearInterval(this.inputTimer)
      this.inputTimer = setInterval(() => {
        let inputPayload: InputPayload = {
          throttle: this.throttle,
          strafe: this.strafe,
          turn: this.turn,
          boost: Math.hypot(this.throttle, this.strafe) > 0.82,
          fire: this.firing,
          weapon: this.weapon
        }
        let inputPacket: InputPacket = {
          type: 'input',
          input: inputPayload
        }
        this.send(inputPacket)
      }, 33)
    })
    this.socket.on('message', (error: BusinessError, value: Object) => {
      if (error) return
      this.parseMessage(String(value))
    })
    this.socket.on('close', () => {
      this.statusText = '连接已结束'
      if (this.inputTimer >= 0) clearInterval(this.inputTimer)
      this.inputTimer = -1
    })
    this.socket.connect('wss://spacefight.zhengzhengstudio.cn/ws', (error: BusinessError) => {
      if (error) this.statusText = '无法连接服务器'
    })
  }

  private disconnect(): void {
    this.localRunning = false
    if (this.inputTimer >= 0) clearInterval(this.inputTimer)
    if (this.frameTimer >= 0) clearInterval(this.frameTimer)
    this.inputTimer = -1
    this.frameTimer = -1
    this.resetInput()
    try {
      let leavePacket: LeavePacket = { type: 'leave' }
      this.socket.send(JSON.stringify(leavePacket))
      this.socket.close()
    } catch (_) {
    }
  }

  private resetLocalBattle(): void {
    this.configureLoadout()
    this.playerId = 'local'
    this.localX = 0
    this.localZ = 8
    this.localRotation = 0
    this.localCooldown = 0
    // 重开局必须清零惯性速度与无敌时间，否则会带着上一局的滑行/无敌进场。
    this.currentSpeed = 0
    this.hitGraceRemaining = 0
    this.pendingPlayerDamage = 0
    this.enemyFireCooldown = 0.7
    this.localWaveDelay = 0.6
    this.localNextId = 1
    this.localElapsed = 0
    this.escortProgress = 0
    this.previousBossHealth = 0
    this.region = Math.random() > 0.5 ? 'canyon' : 'storm'
    this.lockRange = 30
    this.energyRecovery = 20 * this.energyRecoveryFactor
    this.localEnemies = []
    this.localBullets = []
    this.localResources = []
    this.timeRemaining = this.selectedMode === 'timed' ? 55 : 0
    this.localKills = 0
    this.battle = {
      wave: 0, score: 0, health: this.maxHealth, shield: this.maxShield, energy: 100,
      players: [], enemies: [], bullets: [], powerups: [],
      objective: {
        label: this.objectiveLabel(), progress: 0, escortHealth: 100, controlProgress: 0,
        timeRemaining: this.timeRemaining, raidCollected: 0, bossComponents: 3
      },
      missionComplete: false,
      missionFailed: false
    }
    if (this.selectedMode === 'raid') this.spawnRaidResources()
    this.publishLocalBattle()
  }

  private configureLoadout(): void {
    this.maxHealth = 100
    this.maxShield = 80
    this.speedFactor = 1
    this.turnFactor = 1
    this.damageFactor = 1
    this.energyCostFactor = 1
    this.pickupRadius = 2.2
    this.scoreFactor = 1
    this.hullRegen = 0
    this.shieldRegen = 3.5
    this.energyRecoveryFactor = 1
    if (this.loadoutCore === 1) {
      this.maxHealth = 85; this.speedFactor = 1.18; this.turnFactor = 1.1
    } else if (this.loadoutCore === 2) {
      this.maxHealth = 135; this.maxShield = 95; this.speedFactor = 0.85
    } else if (this.loadoutCore === 3) {
      this.energyRecoveryFactor = 1.45
    } else if (this.loadoutCore === 4) {
      this.maxShield = 64; this.speedFactor = 1.08; this.turnFactor = 1.25
    } else if (this.loadoutCore === 5) {
      this.maxHealth = 155; this.maxShield = 110; this.speedFactor = 0.72; this.turnFactor = 0.82
    }
    if (this.loadoutDevice === 0) this.damageFactor = 1.12
    else if (this.loadoutDevice === 1) this.hullRegen = 1.15
    else if (this.loadoutDevice === 2) this.energyCostFactor = 0.72
    else if (this.loadoutDevice === 3) {
      this.pickupRadius = 4.2; this.scoreFactor = 1.25
    } else if (this.loadoutDevice === 4) {
      this.maxShield += 28; this.shieldRegen = 6.2
    }
  }

  private objectiveLabel(): string {
    if (this.selectedMode === 'boss') return '破坏旗舰组件'
    if (this.selectedMode === 'escort') return '护送运输舰'
    if (this.selectedMode === 'defense') return '占领战术信标'
    if (this.selectedMode === 'timed') return '倒计时内击毁 18 个目标'
    if (this.selectedMode === 'raid') return '回收 8 份资源'
    return '坚持更久并刷新纪录'
  }

  private localId(prefix: string): string {
    let value = `${prefix}${this.localNextId}`
    this.localNextId++
    return value
  }

  private stepLocalBattle(): void {
    if (!this.localRunning || this.paused) return
    let dt = 1 / 60
    if (this.trainingStep < 0) this.localElapsed += dt
    this.localRotation += this.turn * dt * LOCAL_MAX_TURN_RATE * this.turnFactor
    let boost = Math.hypot(this.throttle, this.strafe) > 0.82 && this.battle.energy > 1
    let speed = (boost ? 15 : 9) * this.speedFactor
    let forwardX = Math.sin(this.localRotation)
    let forwardZ = -Math.cos(this.localRotation)
    let rightX = Math.cos(this.localRotation)
    let rightZ = Math.sin(this.localRotation)
    // 速度一阶收敛：有推力时朝最大速度追赶，松手时目标归零、按 coastDrag 自然减速至停。
    const hasThrust = Math.hypot(this.throttle, this.strafe) > 0.01
    const targetSpeed = hasThrust ? (boost ? 1.5 : 1) : 0
    const response = hasThrust ? FLIGHT_THROTTLE_RESPONSE : FLIGHT_COAST_DRAG
    this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, dt / response)
    const moveSpeed = speed * this.currentSpeed
    // ⚠️ 松手滑行必须独立于输入驱动位移：若位移继续乘 throttle/strafe，
    //    松手后输入为 0 → 位移恒为 0，coastDrag 与 idleSpeedFloor 形同虚设。
    const driveX = hasThrust ? forwardX * this.throttle : forwardX
    const driveZ = hasThrust ? forwardZ * this.throttle : forwardZ
    this.localX += (driveX + rightX * this.strafe * 0.86) * moveSpeed * dt
    this.localZ += (driveZ + rightZ * this.strafe * 0.86) * moveSpeed * dt
    if (this.hitGraceRemaining > 0) {
      this.hitGraceRemaining = Math.max(0, this.hitGraceRemaining - dt)
    }
    this.updateRegionRules(dt)
    this.battle.energy = Math.max(0, Math.min(100,
      this.battle.energy + (boost ? -34 : this.energyRecovery) * dt))
    this.battle.health = Math.min(this.maxHealth, this.battle.health + this.hullRegen * dt)
    this.battle.shield = Math.min(this.maxShield, this.battle.shield + this.shieldRegen * dt)
    this.localCooldown = Math.max(0, this.localCooldown - dt)
    if (this.firing && this.localCooldown <= 0 && this.battle.energy >= 4) {
      this.fireLocal(forwardX, forwardZ)
    }
    if (this.trainingStep >= 0) {
      this.publishLocalBattle()
      return
    }
    if (this.trainingStep < 0 && this.localEnemies.length === 0 && !this.battle.missionComplete) {
      this.localWaveDelay -= dt
      if (this.localWaveDelay <= 0) this.beginLocalWave()
    }
    this.localEnemies.forEach((enemy: LocalBody) => {
      let escortZ = 18 - this.escortProgress * 0.36
      let assignedObjective = enemy.id.charCodeAt(enemy.id.length - 1) % 2 === 0
      let targetsEscort = this.selectedMode === 'escort' && assignedObjective
      let targetsDefense = this.selectedMode === 'defense' && assignedObjective
      let targetX = targetsEscort || targetsDefense ? 0 : this.localX
      let targetZ = targetsEscort ? escortZ : (targetsDefense ? 0 : this.localZ)
      let dx = targetX - enemy.x
      let dz = targetZ - enemy.z
      let distance = Math.max(0.001, Math.hypot(dx, dz))
      let base = enemy.type === 'boss' ? 2 : (enemy.type === 'bomber' ? 3.4 : 5)
      let enemySpeed = base + Math.min(4, this.battle.wave * 0.22)
      enemy.x += dx / distance * enemySpeed * dt
      enemy.z += dz / distance * enemySpeed * dt
      enemy.rotation = Math.atan2(dx, -dz)
      if (distance < (enemy.type === 'boss' ? 3.2 : 1.25)) {
        if (targetsEscort) {
          this.battle.objective.escortHealth = Math.max(0,
            this.battle.objective.escortHealth - (enemy.type === 'boss' ? 24 : 12) * dt)
        } else if (targetsDefense) {
          this.battle.objective.controlProgress = Math.max(0,
            this.battle.objective.controlProgress - (enemy.type === 'boss' ? 9 : 4) * dt)
        } else {
          this.damageLocal((enemy.type === 'boss' ? 28 : 13) * dt)
        }
      }
    })
    this.enemyFireCooldown -= dt
    if (this.enemyFireCooldown <= 0) {
      let shooter: LocalBody | undefined = this.localEnemies
        .filter((enemy: LocalBody) => enemy.type !== 'boss_component')
        .sort((left: LocalBody, right: LocalBody) => Math.hypot(left.x - this.localX, left.z - this.localZ) - Math.hypot(right.x - this.localX, right.z - this.localZ))[0]
      if (shooter) {
        let dx = this.localX - shooter.x; let dz = this.localZ - shooter.z
        let distance = Math.max(0.001, Math.hypot(dx, dz))
        if (distance < 27) {
          let speed = shooter.type === 'boss' ? 18 : 15
          let damage = shooter.type === 'boss' ? 16 : (shooter.type === 'scout' ? 6 : 9)
          this.localBullets.push({ id: this.localId('eb'), type: 'bullet', x: shooter.x, z: shooter.z,
            rotation: Math.atan2(dx, -dz), health: damage, maxHealth: 16,
            owner: 'enemy', weapon: 'enemy', vx: dx / distance * speed, vz: dz / distance * speed, life: 2.4 })
          this.enemyFireCooldown = Math.max(0.32, 1.05 - this.battle.wave * 0.035)
        } else this.enemyFireCooldown = 0.2
      }
    }
    this.localBullets.forEach((bullet: LocalBody) => {
      bullet.x += bullet.vx * dt
      bullet.z += bullet.vz * dt
      bullet.life -= dt
      if (bullet.owner === 'enemy') {
        if (Math.hypot(bullet.x - this.localX, bullet.z - this.localZ) < 1.05) {
          this.damageLocal(bullet.health)
          bullet.life = 0
        }
      } else for (let index = 0; index < this.localEnemies.length; index++) {
        let enemy = this.localEnemies[index]
        let hitRadius = enemy.type === 'boss' ? 3.6 : 1.15
        if (Math.hypot(bullet.x - enemy.x, bullet.z - enemy.z) < hitRadius) {
          let coreShielded = enemy.type === 'boss' &&
            this.localEnemies.some((part: LocalBody) => part.type === 'boss_component' && part.health > 0)
          if (!coreShielded) enemy.health -= bullet.health
          bullet.life = 0
          break
        }
      }
    })
    this.localBullets = this.localBullets.filter((bullet: LocalBody) => bullet.life > 0 && Math.hypot(bullet.x - this.localX, bullet.z - this.localZ) <= 64)
    // 步末统一结算本步累积的伤害，再开启短暂无敌帧（与 Cocos 端一致）。
    this.flushPlayerDamage()
    let remaining: LocalBody[] = []
    this.localEnemies.forEach((enemy: LocalBody) => {
      if (enemy.health <= 0) {
        this.battle.score += Math.floor((enemy.type === 'boss' ? 2500 : (enemy.type === 'boss_component' ? 450 : 120)) * this.scoreFactor)
        this.localKills++
        if (this.selectedMode === 'timed') this.timeRemaining = Math.min(70, this.timeRemaining + 2.5)
      } else {
        remaining.push(enemy)
      }
    })
    if (remaining.length === 0 && this.localEnemies.length > 0) {
      this.localWaveDelay = this.selectedMode === 'timed' || this.selectedMode === 'raid' ? 0.45 : 1.15
    }
    this.localEnemies = remaining
    this.collectRaidResources()
    if (this.trainingStep < 0) this.updateMissionObjective(dt)
    this.publishLocalBattle()
    if (this.battle.missionComplete || this.battle.missionFailed) {
      this.localRunning = false
      if (this.inputTimer >= 0) clearInterval(this.inputTimer)
      this.inputTimer = -1
      this.statusText = this.battle.missionComplete ?
        `${this.modeName(this.selectedMode)}完成 · 战区已稳定` : '任务失败 · 返回飞行甲板整备'
      this.screen = 'gameover'
    }
  }

  private updateRegionRules(dt: number): void {
    let sector = Math.floor((Math.abs(this.localZ) + this.battle.wave * 11) / 30)
    this.region = sector % 2 === 0 ? 'canyon' : 'storm'
    if (this.region === 'canyon') {
      let corridor = 16 + Math.sin(this.localZ * 0.16) * 3
      let collision = Math.abs(this.localX) - corridor
      if (collision > 0) {
        this.localX = Math.max(-corridor, Math.min(corridor, this.localX))
        this.damageLocal(Math.min(18, 4 + collision * 2) * dt)
      }
      this.lockRange = 34
      this.energyRecovery = 20 * this.energyRecoveryFactor
    } else if (this.region === 'storm') {
      let cloudPulse = Math.sin(this.localElapsed * 2.7 + this.localZ * 0.12)
      let electricInterference = Math.abs(cloudPulse)
      this.lockRange = 16 - electricInterference * 4
      this.energyRecovery = 8 * this.energyRecoveryFactor
      if (cloudPulse > 0.995) this.battle.energy = Math.max(0, this.battle.energy - 0.8)
    }
  }

  private updateMissionObjective(dt: number): void {
    let objective = this.battle.objective
    if (this.selectedMode === 'survival') {
      objective.progress = Math.min(100, this.battle.wave / 12 * 100)
    } else if (this.selectedMode === 'boss') {
      let boss = this.localEnemies.find((enemy: LocalBody) => enemy.type === 'boss')
      let components = this.localEnemies.filter((enemy: LocalBody) => enemy.type === 'boss_component' && enemy.health > 0).length
      objective.bossComponents = components
      if (boss) {
        this.previousBossHealth = boss.health
        objective.progress = components > 0 ? (3 - components) / 3 * 70 : 70 + Math.max(0, 30 - boss.health / boss.maxHealth * 30)
      } else if (this.battle.wave > 0) {
        objective.bossComponents = 0
        objective.progress = 100
        this.battle.missionComplete = true
      }
    } else if (this.selectedMode === 'escort') {
      let escortZ = 18 - this.escortProgress * 0.36
      let threatClose = this.localEnemies.some((enemy: LocalBody) => Math.hypot(enemy.x, enemy.z - escortZ) < 6)
      this.escortProgress = Math.min(100, this.escortProgress + (threatClose ? 0.75 : 2.4) * dt)
      objective.progress = this.escortProgress
      this.battle.missionComplete = this.escortProgress >= 100
      this.battle.missionFailed = objective.escortHealth <= 0
    } else if (this.selectedMode === 'defense') {
      let playerNear = Math.hypot(this.localX, this.localZ) < 8
      let contesting = this.localEnemies.some((enemy: LocalBody) => Math.hypot(enemy.x, enemy.z) < 8)
      objective.controlProgress = Math.max(0, Math.min(100,
        objective.controlProgress + (contesting ? -4 : (playerNear ? 7 : -1.5)) * dt))
      objective.progress = objective.controlProgress
      this.battle.missionComplete = objective.controlProgress >= 100
    } else if (this.selectedMode === 'timed') {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt)
      objective.timeRemaining = this.timeRemaining
      objective.progress = Math.min(100, this.localKills / 18 * 100)
      this.battle.missionComplete = this.localKills >= 18
      this.battle.missionFailed = objective.timeRemaining <= 0 && !this.battle.missionComplete
    } else if (this.selectedMode === 'raid') {
      objective.progress = Math.min(100, objective.raidCollected / 8 * 100)
      this.battle.missionComplete = objective.raidCollected >= 8
    }
    if (this.battle.health <= 0) this.battle.missionFailed = true
  }

  private fireLocal(forwardX: number, forwardZ: number): void {
    let rates: number[] = [0.13, 0.38, 0.58, 0.7, 0.26]
    let speeds: number[] = [48, 38, 28, 82, 34]
    let damages: number[] = [12, 9, 34, 52, 27]
    let selected = Math.max(0, Math.min(4, this.weapon))
    this.localCooldown = rates[selected]
    this.battle.energy -= (selected === 0 || selected === 4 ? 5 : 2) * this.energyCostFactor
    let output = damages[selected] * this.damageFactor
    this.localBullets.push({
      id: this.localId('b'), type: 'bullet', x: this.localX + forwardX * 1.4,
      z: this.localZ + forwardZ * 1.4, rotation: this.localRotation,
      health: output, maxHealth: output, owner: 'player',
      weapon: selected === 2 ? 'missile' : String(selected),
      vx: forwardX * speeds[selected], vz: forwardZ * speeds[selected], life: 1.5
    })
  }

  private beginLocalWave(): void {
    this.battle.wave++
    if (this.battle.wave > 1 && (this.battle.wave - 1) % 3 === 0) {
      this.region = this.region === 'canyon' ? 'storm' : 'canyon'
    }
    if (this.selectedMode === 'boss') {
      let hp = 1250
      this.previousBossHealth = hp
      this.localEnemies.push({
        id: this.localId('boss'), type: 'boss', x: this.localX + Math.sin(this.localRotation) * 28,
        z: this.localZ - Math.cos(this.localRotation) * 28, rotation: Math.PI,
        health: hp, maxHealth: hp, owner: 'enemy', weapon: 'boss', vx: 0, vz: 0, life: 0
      })
      for (let index = 0; index < 3; index++) {
        let angle = index * Math.PI * 2 / 3
        this.localEnemies.push({
          id: this.localId('component'), type: 'boss_component', x: this.localX + Math.sin(this.localRotation) * 28 + Math.cos(angle) * 6,
          z: this.localZ - Math.cos(this.localRotation) * 28 + Math.sin(angle) * 6, rotation: angle, health: 180, maxHealth: 180,
          owner: 'enemy', weapon: 'component', vx: 0, vz: 0, life: 0
        })
      }
      return
    }
    let pressure = this.selectedMode === 'timed' || this.selectedMode === 'raid' ? 2 : 1
    let count = Math.min(20, 4 + this.battle.wave * pressure)
    let phase = Math.random() * Math.PI * 2
    let formation = Math.floor(Math.random() * 3)
    for (let index = 0; index < count; index++) {
      let spread = formation === 0 ? (index - count / 2) * 0.11 : index / Math.max(1, count) * Math.PI * 2
      let angle = phase + spread + Math.random() * 0.18
      let radius = 31 + Math.random() * 7
      let type = 'scout'
      if (this.battle.wave >= 4 && index % 7 === 0) type = 'gunship'
      else if (this.battle.wave >= 3 && index % 5 === 0) type = 'bomber'
      else if (index % 3 === 0) type = 'fighter'
      let hp = type === 'gunship' ? 110 : (type === 'bomber' ? 78 : (type === 'fighter' ? 42 : 24))
      this.localEnemies.push({
        id: this.localId('e'), type: type, x: this.localX + Math.cos(angle) * radius, z: this.localZ + Math.sin(angle) * radius,
        rotation: angle, health: hp, maxHealth: hp, owner: 'enemy', weapon: type,
        vx: 0, vz: 0, life: 0
      })
    }
  }

  private spawnRaidResources(): void {
    for (let index = 0; index < 10; index++) {
      let angle = index * Math.PI * 2 / 10 + 0.3
      let radius = 10 + index % 3 * 6
      this.localResources.push({
        id: this.localId('resource'), type: 'resource', x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius, rotation: angle, health: 1, maxHealth: 1,
        owner: 'neutral', weapon: 'resource', vx: 0, vz: 0, life: 0
      })
    }
  }

  private collectRaidResources(): void {
    if (this.selectedMode !== 'raid') return
    let remaining: LocalBody[] = []
    this.localResources.forEach((resource: LocalBody) => {
      if (Math.hypot(this.localX - resource.x, this.localZ - resource.z) < this.pickupRadius) {
        this.battle.objective.raidCollected++
        this.battle.score += Math.floor(300 * this.scoreFactor)
      } else remaining.push(resource)
    })
    this.localResources = remaining
  }

  /**
 * 玩家受伤入口：只**累积**本步伤害，不立即扣血。
 *
 * 步末由 flushPlayerDamage() 一次性结算。这样同一帧多颗子弹/多个敌机接触
 * 只会扣一次血（防瞬秒），而跨帧的持续伤害仍然生效。
 * 若在这里直接扣血并开启无敌帧，持续伤害会被完全挡住，玩家可能永远不死。
 */
private damageLocal(value: number): void {
    this.pendingPlayerDamage += Math.max(0, value)
  }

  /** 步末统一应用累积伤害，并开启短暂无敌时间。 */
  private flushPlayerDamage(): void {
    const damage = this.pendingPlayerDamage
    this.pendingPlayerDamage = 0
    if (damage <= 0 || this.hitGraceRemaining > 0) {
      return
    }
    let shieldHit = Math.min(this.battle.shield, damage)
    this.battle.shield -= shieldHit
    this.battle.health = Math.max(0, this.battle.health - Math.max(0, damage - shieldHit))
    this.hitFlashUntil = Date.now() + 130
    this.hitGraceRemaining = PLAYER_HIT_GRACE_SECONDS
  }

  private publishLocalBattle(): void {
    this.battle.players = [{
      id: 'local', type: 'player', x: this.localX, z: this.localZ, rotation: this.localRotation,
      health: this.battle.health, maxHealth: this.maxHealth, owner: 'local', weapon: 'player'
    }]
    this.battle.enemies = this.localEnemies
    this.battle.bullets = this.localBullets
    this.battle.powerups = this.localResources
  }

  private send(payload: Object): void {
    try {
      this.socket.send(JSON.stringify(payload))
    } catch (_) {
    }
  }

  private parseMessage(raw: string): void {
    try {
      let root = JSON.parse(raw) as Record<string, Object>
      let type = String(root['type'])
      if (type === 'welcome') {
        this.playerId = String(root['playerId'])
        return
      }
      if (type !== 'snapshot') return
      let room = root['room'] as Record<string, Object>
      this.battle.wave = Number(room['wave'])
      this.battle.players = this.readEntities(root['players'], 'player')
      this.battle.enemies = this.readEntities(root['enemies'], 'enemy')
      this.battle.bullets = this.readEntities(root['bullets'], 'bullet')
      this.battle.powerups = this.readEntities(root['powerups'], 'powerup')
      let rows = root['players'] as Array<Record<string, Object>>
      rows.forEach((row: Record<string, Object>) => {
        if (String(row['id']) === this.playerId) {
          this.battle.score = Number(row['score'])
          this.battle.health = Number(row['health'])
          this.battle.shield = Number(row['shield'])
          this.battle.energy = Number(row['energy'])
        }
      })
    } catch (_) {
    }
  }

  private readEntities(value: Object, fallback: string): BattleEntity[] {
    let output: BattleEntity[] = []
    let rows = value as Array<Record<string, Object>>
    rows.forEach((row: Record<string, Object>) => {
      let point = row['position'] as Record<string, Object>
      output.push({
        id: String(row['id']),
        type: row['type'] ? String(row['type']) : fallback,
        x: Number(point['x']),
        z: Number(point['z']),
        rotation: Number(row['rotation'] || 0),
        health: Number(row['health'] || 1),
        maxHealth: Number(row['maxHealth'] || 1),
        owner: row['owner'] ? String(row['owner']) : '',
        weapon: row['weapon'] ? String(row['weapon']) : ''
      })
    })
    return output
  }

  private draw(): void {
    let c = this.canvas
    let width = this.canvasWidth
    let height = this.canvasHeight
    c.fillStyle = '#070A0D'
    c.fillRect(0, 0, width, height)
    c.globalAlpha = 0.58
    c.drawImage(this.battlefieldImage, 0, 0, width, height)
    c.globalAlpha = 1
    this.stars.forEach((star: number[], index: number) => {
      let pulse = Math.sin(Date.now() / 850 + index) * 0.18 + 0.58
      c.globalAlpha = pulse
      c.fillStyle = '#BECBD1'
      c.beginPath()
      c.arc(star[0] * width, star[1] * height, star[2], 0, Math.PI * 2)
      c.fill()
    })
    c.globalAlpha = 1
    if (this.screen !== 'game') {
      this.drawFlightDeck(c, width, height)
      return
    }
    this.drawRegion(c, width, height)
    this.battle.powerups.filter((entity: BattleEntity) => this.isVisible(entity)).forEach((entity: BattleEntity) => this.drawPowerup(c, entity, width, height))
    this.battle.bullets.filter((entity: BattleEntity) => this.isVisible(entity)).forEach((entity: BattleEntity) => this.drawBullet(c, entity, width, height))
    this.battle.enemies.filter((entity: BattleEntity) => this.isVisible(entity)).forEach((entity: BattleEntity) => this.drawEnemy(c, entity, width, height))
    this.battle.players.filter((entity: BattleEntity) => this.isVisible(entity)).forEach((entity: BattleEntity) => {
      let localShip = entity.id === this.playerId
      if (!localShip || this.cameraMode === 'chase') this.drawShip(c, entity, localShip, width, height)
    })
    this.drawFireVector(c, width, height)
    this.drawTargetCue(c, width, height)
    if (this.cameraMode === 'cockpit') this.drawCockpitFrame(c, width, height)
    this.drawHud(c, width, height)
    this.drawDamageVignette(c, width, height)
  }

  private drawFlightDeck(c: CanvasRenderingContext2D, width: number, height: number): void {
    let size = Math.min(width * 0.72, height * 0.72)
    let centerX = width * 0.65
    let centerY = height * 0.52
    c.save()
    c.translate(centerX, centerY)
    c.rotate(-0.22)
    c.shadowColor = '#F0A44B'
    c.shadowBlur = 26
    c.globalAlpha = 0.96
    c.drawImage(this.interceptorImage, -size / 2, -size / 2, size, size)
    c.shadowBlur = 0
    c.restore()
    c.strokeStyle = 'rgba(122, 203, 214, 0.32)'
    c.lineWidth = 1
    c.beginPath()
    c.arc(centerX, centerY, size * 0.42, -0.3, 2.45)
    c.stroke()
    c.fillStyle = 'rgba(7,10,13,0.56)'
    c.fillRect(0, 0, width * 0.54, height)
    c.fillStyle = 'rgba(240,164,75,0.72)'
    c.fillRect(Math.max(16, width * 0.04), height * 0.17, Math.min(230, width * 0.36), 1)
  }

  private worldPoint(entity: BattleEntity, width: number, height: number): number[] {
    let originX = this.localX
    let originZ = this.localZ
    let originRotation = this.localRotation
    let own = this.battle.players.find((player: BattleEntity) => player.id === this.playerId)
    if (own) {
      originX = own.x
      originZ = own.z
      originRotation = own.rotation
    }
    let dx = entity.x - originX
    let dz = entity.z - originZ
    let right = dx * Math.cos(originRotation) + dz * Math.sin(originRotation)
    let forward = dx * Math.sin(originRotation) - dz * Math.cos(originRotation)
    let scale = Math.min(width, height) * 0.022
    if (this.cameraMode === 'cockpit') {
      return [width * 0.5 + right * scale, height * 0.57 - forward * scale * 0.72]
    }
    return [
      width * 0.5 + right * scale,
      height * 0.69 - forward * scale * 0.68
    ]
  }

  private drawFireVector(c: CanvasRenderingContext2D, width: number, height: number): void {
    let own = this.battle.players.find((player: BattleEntity) => player.id === this.playerId)
    let originX = own ? own.x : this.localX
    let originZ = own ? own.z : this.localZ
    let rotation = own ? own.rotation : this.localRotation
    let forwardX = Math.sin(rotation)
    let forwardZ = -Math.cos(rotation)
    let muzzle: BattleEntity = {
      id: '__muzzle', type: 'guide', x: originX + forwardX * 1.4, z: originZ + forwardZ * 1.4,
      rotation: rotation, health: 1, maxHealth: 1, owner: 'local', weapon: ''
    }
    let aim: BattleEntity = {
      id: '__aim', type: 'guide', x: originX + forwardX * 22, z: originZ + forwardZ * 22,
      rotation: rotation, health: 1, maxHealth: 1, owner: 'local', weapon: ''
    }
    let origin = this.worldPoint(muzzle, width, height)
    let pipper = this.worldPoint(aim, width, height)
    c.strokeStyle = 'rgba(240,164,75,0.62)'
    c.lineWidth = 1.2
    c.beginPath()
    c.moveTo(origin[0], origin[1])
    c.lineTo(pipper[0], pipper[1])
    c.stroke()
    c.beginPath()
    c.arc(origin[0], origin[1], 5, 0, Math.PI * 2)
    c.arc(pipper[0], pipper[1], 12, 0, Math.PI * 2)
    c.moveTo(pipper[0] - 19, pipper[1]); c.lineTo(pipper[0] - 8, pipper[1])
    c.moveTo(pipper[0] + 8, pipper[1]); c.lineTo(pipper[0] + 19, pipper[1])
    c.moveTo(pipper[0], pipper[1] - 19); c.lineTo(pipper[0], pipper[1] - 8)
    c.moveTo(pipper[0], pipper[1] + 8); c.lineTo(pipper[0], pipper[1] + 19)
    c.stroke()
    c.fillStyle = '#F0A44B'
    c.font = 'bold 8vp monospace'
    c.textAlign = 'center'
    c.fillText('炮口', origin[0], origin[1] + 17)
    c.fillText('主炮', pipper[0], pipper[1] + 27)
    c.textAlign = 'left'
  }

  private isVisible(entity: BattleEntity): boolean {
    if (entity.id === this.playerId) return this.cameraMode === 'chase'
    if (this.cameraMode === 'chase') return true
    let own = this.battle.players.find((player: BattleEntity) => player.id === this.playerId)
    let originX = own ? own.x : this.localX
    let originZ = own ? own.z : this.localZ
    let rotation = own ? own.rotation : this.localRotation
    let dx = entity.x - originX
    let dz = entity.z - originZ
    return dx * Math.sin(rotation) - dz * Math.cos(rotation) > -2.5
  }

  private cameraRotation(): number {
    let own = this.battle.players.find((player: BattleEntity) => player.id === this.playerId)
    return own ? own.rotation : this.localRotation
  }

  private drawRegion(c: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.region === 'canyon') {
      c.fillStyle = 'rgba(45,38,31,0.86)'
      c.beginPath()
      c.moveTo(0, height * 0.16)
      c.lineTo(width * 0.23, height * 0.34)
      c.lineTo(width * 0.31, height)
      c.lineTo(0, height)
      c.closePath()
      c.fill()
      c.beginPath()
      c.moveTo(width, height * 0.16)
      c.lineTo(width * 0.77, height * 0.34)
      c.lineTo(width * 0.69, height)
      c.lineTo(width, height)
      c.closePath()
      c.fill()
      c.strokeStyle = '#9B7951'
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(width * 0.23, height * 0.34)
      c.lineTo(width * 0.31, height)
      c.moveTo(width * 0.77, height * 0.34)
      c.lineTo(width * 0.69, height)
      c.stroke()
    } else {
      c.fillStyle = 'rgba(28,49,56,0.72)'
      for (let index = 0; index < 5; index++) {
        let cloudY = (index * 0.23 + (this.localElapsed * 0.012) % 1) * height
        c.fillRect(0, cloudY, width, Math.max(18, height * 0.08))
      }
      let electric = Math.sin(this.localElapsed * 2.7 + this.localZ * 0.12)
      if (electric > 0.92) {
        c.strokeStyle = '#AEEAF1'
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(width * 0.68, 0)
        c.lineTo(width * 0.61, height * 0.2)
        c.lineTo(width * 0.66, height * 0.31)
        c.lineTo(width * 0.56, height * 0.48)
        c.stroke()
      }
    }
    if (this.selectedMode === 'escort') {
      let escort: BattleEntity = {
        id: 'escort', type: 'escort', x: 0, z: 18 - this.escortProgress * 0.36,
        rotation: 0, health: this.battle.objective.escortHealth, maxHealth: 100,
        owner: 'friendly', weapon: ''
      }
      let point = this.worldPoint(escort, width, height)
      c.fillStyle = '#55D4B1'
      c.fillRect(point[0] - 16, point[1] - 5, 32, 10)
      c.strokeStyle = '#D8FFF4'
      c.strokeRect(point[0] - 20, point[1] - 9, 40, 18)
    } else if (this.selectedMode === 'defense') {
      let beacon: BattleEntity = {
        id: 'beacon', type: 'beacon', x: 0, z: 0, rotation: 0,
        health: 100, maxHealth: 100, owner: 'friendly', weapon: ''
      }
      let point = this.worldPoint(beacon, width, height)
      c.strokeStyle = '#55D4B1'
      c.lineWidth = 3
      c.beginPath()
      c.arc(point[0], point[1], 34, 0, Math.PI * 2)
      c.stroke()
    }
  }

  private drawShip(c: CanvasRenderingContext2D, entity: BattleEntity, local: boolean, width: number, height: number): void {
    let point = this.worldPoint(entity, width, height)
    let size = Math.min(width, height) * (local ? 0.13 : 0.09)
    c.save()
    c.translate(point[0], point[1])
    c.rotate(entity.rotation - this.cameraRotation())
    if (local) {
      c.shadowColor = '#59D7E6'
      c.shadowBlur = 18
    }
    c.drawImage(local ? this.interceptorImage : this.fighterImage, -size / 2, -size / 2, size, size)
    c.shadowBlur = 0
    c.restore()
  }

  private drawEnemy(c: CanvasRenderingContext2D, entity: BattleEntity, width: number, height: number): void {
    let point = this.worldPoint(entity, width, height)
    let size = Math.min(width, height) * (entity.type === 'boss' ? 0.23 : 0.09)
    c.save()
    c.translate(point[0], point[1])
    c.rotate(entity.rotation - this.cameraRotation())
    c.drawImage(this.enemyImage(entity.type), -size / 2, -size / 2, size, size)
    c.restore()
    if (entity.maxHealth > 1) {
      let ratio = Math.max(0, Math.min(1, entity.health / entity.maxHealth))
      let barWidth = size * 0.72
      c.fillStyle = 'rgba(23,28,31,0.8)'
      c.fillRect(point[0] - barWidth / 2, point[1] + size * 0.44, barWidth, 3)
      c.fillStyle = '#CD5748'
      c.fillRect(point[0] - barWidth / 2, point[1] + size * 0.44, barWidth * ratio, 3)
    }
    if (entity.type === 'boss' && this.selectedMode === 'boss') {
      for (let component = 0; component < 3; component++) {
        c.fillStyle = component < this.battle.objective.bossComponents ? '#F0A44B' : '#344047'
        c.fillRect(point[0] - 18 + component * 10, point[1] - size * 0.58, 7, 7)
      }
    }
  }

  private enemyImage(type: string): ImageBitmap {
    if (type === 'boss') return this.bossImage
    if (type === 'bomber') return this.bomberImage
    if (type === 'gunship') return this.gunshipImage
    if (type === 'fighter') return this.fighterImage
    return this.scoutImage
  }

  private drawBullet(c: CanvasRenderingContext2D, entity: BattleEntity, width: number, height: number): void {
    let point = this.worldPoint(entity, width, height)
    let color = entity.owner === 'enemy' ? '#DC5C4A' :
      (entity.weapon === '1' ? '#FFC06A' : (entity.weapon === 'missile' ? '#FF6845' :
        (entity.weapon === '3' ? '#EAF7FF' : (entity.weapon === '4' ? '#63D9D2' : '#F1E9C9'))))
    let trail = entity.weapon === '3' ? 36 : (entity.weapon === 'missile' ? 26 : (entity.weapon === '1' ? 8 : 18))
    c.fillStyle = color
    c.shadowColor = c.fillStyle
    c.shadowBlur = 8
    c.strokeStyle = c.fillStyle
    c.lineWidth = entity.weapon === '3' ? 2 : (entity.weapon === 'missile' ? 3 : 1.5)
    c.globalAlpha = 0.64
    c.beginPath()
    c.moveTo(point[0], point[1])
    c.lineTo(point[0] - Math.sin(entity.rotation) * trail, point[1] + Math.cos(entity.rotation) * trail)
    c.stroke()
    c.globalAlpha = 1
    c.beginPath()
    c.arc(point[0], point[1], entity.weapon === '4' ? 6 : (entity.weapon === 'missile' ? 5 : (entity.weapon === '1' ? 2 : 3)), 0, Math.PI * 2)
    c.fill()
    if (entity.weapon === '4') { c.strokeStyle = color; c.lineWidth = 1.2; c.beginPath(); c.arc(point[0], point[1], 9, 0, Math.PI * 2); c.stroke() }
    c.shadowBlur = 0
  }

  private drawPowerup(c: CanvasRenderingContext2D, entity: BattleEntity, width: number, height: number): void {
    let point = this.worldPoint(entity, width, height)
    c.strokeStyle = '#67C6B2'
    c.lineWidth = 3
    c.beginPath()
    c.arc(point[0], point[1], 11, 0, Math.PI * 2)
    c.stroke()
  }

  private drawHud(c: CanvasRenderingContext2D, width: number, height: number): void {
    let inset = Math.max(16, Math.min(34, width * 0.035))
    let meterWidth = Math.max(116, Math.min(250, width * (width < 600 ? 0.39 : 0.24)))
    c.fillStyle = '#E6070A0D'
    c.fillRect(inset - 8, inset - 8, meterWidth + 16, 96)
    c.strokeStyle = '#6C7B83'
    c.lineWidth = 1
    c.strokeRect(inset - 8, inset - 8, meterWidth + 16, 96)
    c.fillStyle = '#ECEFEF'
    c.font = 'bold 16vp sans-serif'
    c.textAlign = 'left'
    c.fillText(`WAVE ${this.battle.wave.toString().padStart(2, '0')}`, inset, inset + 17)
    c.textAlign = 'right'
    c.font = 'bold 18vp monospace'
    c.fillStyle = '#F0A44B'
    c.fillText(this.battle.score.toString().padStart(7, '0'), width - inset, inset + 17)
    c.fillStyle = '#D0DADF'
    c.font = 'bold 11vp monospace'
    c.fillText(`${this.region === 'canyon' ? 'CANYON' : 'ION STORM'} // ${this.cameraMode.toUpperCase()}`,
      width - inset, inset + 36)
    c.textAlign = 'left'
    this.drawMeter(c, inset, inset + 30, meterWidth, 'HULL', this.battle.health, '#D6604C')
    this.drawMeter(c, inset, inset + 53, meterWidth, 'SHIELD', this.battle.shield, '#5EB8C5')
    this.drawMeter(c, inset, inset + 76, meterWidth, 'ENERGY', this.battle.energy, '#EDA84C')
    this.drawObjectiveHud(c, width, height, inset, meterWidth)
  }

  private drawObjectiveHud(c: CanvasRenderingContext2D, width: number, height: number,
    inset: number, meterWidth: number): void {
    if (this.selectedMode === 'public') return
    let panelWidth = Math.max(138, Math.min(290, width * (width < 600 ? 0.42 : 0.27)))
    let x = width - inset - panelWidth
    let y = inset + 48
    c.fillStyle = '#F0080C0F'
    c.fillRect(x, y, panelWidth, 74)
    c.strokeStyle = '#6C7B83'
    c.strokeRect(x, y, panelWidth, 74)
    c.fillStyle = '#F0A44B'
    c.font = 'bold 10vp sans-serif'
    c.textAlign = 'left'
    c.fillText('PRIMARY OBJECTIVE', x + 9, y + 16)
    c.fillStyle = '#F3F6F7'
    c.font = 'bold 12vp sans-serif'
    c.fillText(this.battle.objective.label, x + 9, y + 34)
    c.fillStyle = '#1C272C'
    c.fillRect(x + 9, y + 44, panelWidth - 18, 8)
    c.fillStyle = '#55D4B1'
    c.fillRect(x + 9, y + 44, (panelWidth - 18) * this.battle.objective.progress / 100, 8)
    c.fillStyle = '#B9C7CD'
    c.font = '10vp monospace'
    c.fillText(this.objectiveValue(), x + 9, y + 66)
    c.textAlign = 'left'
  }

  private objectiveValue(): string {
    let objective = this.battle.objective
    if (this.selectedMode === 'boss') return `COMPONENTS ${objective.bossComponents}/3`
    if (this.selectedMode === 'escort') return `ESCORT ${Math.round(objective.escortHealth)}%`
    if (this.selectedMode === 'defense') return `CONTROL ${Math.round(objective.controlProgress)}%`
    if (this.selectedMode === 'timed') return `TIME ${Math.ceil(objective.timeRemaining)}s · KILLS ${this.localKills}/18`
    if (this.selectedMode === 'raid') return `SALVAGE ${objective.raidCollected}/8`
    return `WAVE ${this.battle.wave} · ENDLESS`
  }

  private drawCockpitFrame(c: CanvasRenderingContext2D, width: number, height: number): void {
    let horizon = height * 0.58
    c.fillStyle = '#F20A0E11'
    c.beginPath()
    c.moveTo(0, height)
    c.lineTo(0, horizon * 0.82)
    c.lineTo(width * 0.18, horizon)
    c.lineTo(width * 0.33, height)
    c.closePath()
    c.fill()
    c.beginPath()
    c.moveTo(width, height)
    c.lineTo(width, horizon * 0.82)
    c.lineTo(width * 0.82, horizon)
    c.lineTo(width * 0.67, height)
    c.closePath()
    c.fill()
    c.fillRect(width * 0.28, height * 0.87, width * 0.44, height * 0.13)
    c.strokeStyle = '#8A9AA1'
    c.lineWidth = Math.max(2, width * 0.004)
    c.beginPath()
    c.moveTo(0, horizon * 0.82)
    c.lineTo(width * 0.18, horizon)
    c.lineTo(width * 0.33, height)
    c.moveTo(width, horizon * 0.82)
    c.lineTo(width * 0.82, horizon)
    c.lineTo(width * 0.67, height)
    c.stroke()
    c.strokeStyle = '#F0A44B'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(width * 0.5 - 13, height * 0.48)
    c.lineTo(width * 0.5 + 13, height * 0.48)
    c.moveTo(width * 0.5, height * 0.48 - 13)
    c.lineTo(width * 0.5, height * 0.48 + 13)
    c.stroke()
  }

  private drawTargetCue(c: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.battle.enemies.length === 0) return
    let target = this.battle.enemies[0]
    let shortest = Number.MAX_VALUE
    let originX = this.localX
    let originZ = this.localZ
    let own = this.battle.players.find((player: BattleEntity) => player.id === this.playerId)
    if (own) {
      originX = own.x
      originZ = own.z
    }
    this.battle.enemies.forEach((enemy: BattleEntity) => {
      let distance = Math.hypot(enemy.x - originX, enemy.z - originZ)
      if (distance < shortest) {
        shortest = distance
        target = enemy
      }
    })
    if (shortest > this.lockRange) return
    let point = this.worldPoint(target, width, height)
    let radius = Math.max(16, Math.min(31, Math.min(width, height) * 0.035))
    c.strokeStyle = '#F0A44B'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(point[0], point[1], radius, 0, Math.PI * 2)
    c.stroke()
    c.beginPath()
    c.moveTo(point[0] - radius - 10, point[1])
    c.lineTo(point[0] - radius + 1, point[1])
    c.moveTo(point[0] + radius - 1, point[1])
    c.lineTo(point[0] + radius + 10, point[1])
    c.stroke()
  }

  private drawDamageVignette(c: CanvasRenderingContext2D, width: number, height: number): void {
    let remaining = this.hitFlashUntil - Date.now()
    if (remaining <= 0) return
    c.globalAlpha = Math.max(0, Math.min(0.32, remaining / 350))
    c.fillStyle = '#C6473B'
    c.fillRect(0, 0, width, 12)
    c.fillRect(0, height - 12, width, 12)
    c.fillRect(0, 0, 12, height)
    c.fillRect(width - 12, 0, 12, height)
    c.globalAlpha = 1
  }

  private drawMeter(c: CanvasRenderingContext2D, x: number, y: number, width: number,
    title: string, value: number, color: string): void {
    c.fillStyle = 'rgba(20,27,32,0.82)'
    c.fillRect(x, y, width, 16)
    c.fillStyle = color
    c.fillRect(x, y, width * Math.max(0, Math.min(1, value / 100)), 16)
    c.fillStyle = '#ECEFEF'
    c.font = 'bold 10vp sans-serif'
    c.fillText(`${title}  ${value}`, x + 6, y + 12)
  }

  private updateMove(event: TouchEvent): void {
    if (event.type === TouchType.Cancel) {
      this.leftTouchId = -1
      this.throttle = 0
      this.strafe = 0
      return
    }
    if (event.type === TouchType.Up) {
      let ended = event.changedTouches.some((touch: TouchObject) => touch.id === this.leftTouchId)
      let stillActive = event.touches.some((touch: TouchObject) => touch.id === this.leftTouchId)
      if (ended || !stillActive) {
        this.leftTouchId = -1
        this.throttle = 0
        this.strafe = 0
      }
      return
    }
    if (event.type === TouchType.Down && this.leftTouchId < 0) {
      let touch = event.changedTouches.length > 0 ? event.changedTouches[0] : event.touches[0]
      if (!touch) return
      this.leftTouchId = touch.id
      this.joystickX = this.compactDeck ? 58 : 68
      this.joystickY = this.compactDeck ? 59 : 68
    }
    let touch = event.touches.find((item: TouchObject) => item.id === this.leftTouchId)
    if (!touch) return
    let radius = Math.min(this.canvasWidth, this.canvasHeight) * 0.11
    let dx = touch.x - this.joystickX
    let dy = touch.y - this.joystickY
    let length = Math.max(0.001, Math.hypot(dx, dy))
    let raw = Math.min(1, length / radius)
    let response = raw <= ANALOG_DEADZONE ? 0 : Math.pow(
      (raw - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE), ANALOG_RESPONSE_EXPONENT)
    this.strafe = Math.max(-1, Math.min(1, dx / length * response))
    this.throttle = Math.max(-1, Math.min(1, -dy / length * response))
    if (this.trainingStep === 0 && Math.hypot(this.strafe, this.throttle) > 0.22) {
      this.trainingStep = 1
    }
  }

  private updateAim(event: TouchEvent): void {
    if (event.type === TouchType.Cancel) {
      this.rightTouchId = -1
      this.turn = 0
      return
    }
    if (event.type === TouchType.Up) {
      let ended = event.changedTouches.some((touch: TouchObject) => touch.id === this.rightTouchId)
      let stillActive = event.touches.some((touch: TouchObject) => touch.id === this.rightTouchId)
      if (ended || !stillActive) {
        this.rightTouchId = -1
        this.turn = 0
      }
      return
    }
    if (event.type === TouchType.Down && this.rightTouchId < 0) {
      let changed = event.changedTouches.length > 0 ? event.changedTouches[0] : event.touches[0]
      if (!changed) return
      this.rightTouchId = changed.id
      this.aimStartX = changed.x
    }
    let touch = event.touches.find((item: TouchObject) => item.id === this.rightTouchId)
    if (!touch) return
    let raw = Math.max(-1, Math.min(1,
      (touch.x - this.aimStartX) / (this.canvasWidth * 0.13) * this.aimSensitivity))
    let magnitude = Math.abs(raw)
    let shaped = magnitude <= ANALOG_DEADZONE ? 0 : Math.pow(
      (magnitude - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE), ANALOG_RESPONSE_EXPONENT)
    this.turn = raw < 0 ? -shaped : shaped
  }

  private updateFire(event: TouchEvent): void {
    if (event.type === TouchType.Cancel || event.type === TouchType.Up) {
      this.fireTouchId = -1
      this.firing = this.pressedKeys.indexOf(this.fireKeyCode()) >= 0
      return
    }
    if (event.type === TouchType.Down && this.fireTouchId < 0) {
      let touch = event.changedTouches.length > 0 ? event.changedTouches[0] : event.touches[0]
      if (!touch) return
      this.fireTouchId = touch.id
      this.firing = true
      if (this.trainingStep === 1) this.trainingStep = 2
    }
  }

  private movementKeys(): number[] {
    if (this.keyboardPreset === 1) return [2012, 2013, 2014, 2015]
    if (this.keyboardPreset === 2) return [2025, 2027, 2026, 2028]
    return [2039, 2035, 2017, 2020]
  }

  private fireKeyCode(): number {
    return [2050, 2054, 2072][this.fireKeyPreset]
  }

  private cameraKeyCode(): number {
    return [2038, 2019, 2049][this.cameraKeyPreset]
  }

  private handleKey(event: KeyEvent): boolean {
    let down = event.type === KeyType.Down
    if (down && event.keyCode === this.cameraKeyCode()) {
      this.toggleCamera()
      return true
    }
    let recognized = this.movementKeys().indexOf(event.keyCode) >= 0 || event.keyCode === this.fireKeyCode()
    if (!recognized) return false
    if (down && this.pressedKeys.indexOf(event.keyCode) < 0) this.pressedKeys.push(event.keyCode)
    if (!down) this.pressedKeys = this.pressedKeys.filter((code: number) => code !== event.keyCode)
    let keys = this.movementKeys()
    this.throttle = (this.pressedKeys.indexOf(keys[0]) >= 0 ? 1 : 0) - (this.pressedKeys.indexOf(keys[1]) >= 0 ? 1 : 0)
    this.strafe = (this.pressedKeys.indexOf(keys[3]) >= 0 ? 1 : 0) - (this.pressedKeys.indexOf(keys[2]) >= 0 ? 1 : 0)
    this.firing = this.fireTouchId >= 0 || this.pressedKeys.indexOf(this.fireKeyCode()) >= 0
    return true
  }

  private resetInput(): void {
    this.leftTouchId = -1
    this.rightTouchId = -1
    this.fireTouchId = -1
    this.pressedKeys = []
    this.throttle = 0
    this.strafe = 0
    this.turn = 0
    this.firing = false
  }

  private selectWeapon(value: number): void {
    this.weapon = value
    if (this.trainingStep === 2) {
      this.trainingStep = -1
      this.trainingCompleted = true
      this.statusText = '校准完成 · 敌潮接近'
      preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
        store.put('flight_training_complete', true)
        store.flush()
      })
    }
  }

  private toggleCamera(): void {
    this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit'
    this.statusText = this.cameraMode === 'cockpit' ? '驾驶舱视角 · 战术框架已启用' : '追尾视角 · 本机拦截机可见'
    preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
      store.put('camera_mode', this.cameraMode)
      store.flush()
    })
    this.draw()
  }

  private login(): void {
    if (!this.account.trim() || !this.password) {
      this.loginText = '请填写账号和密码'
      return
    }
    this.loginText = '正在登录'
    let client = http.createHttp()
    client.request(this.passportUrl, {
      method: http.RequestMethod.POST,
      header: {
        'Content-Type': 'application/json',
        // 通行证接口用这个头识别原生客户端：App 里没有 Turnstile 小组件，
        // 不带该头会被判成「安全验证无效」而返回 400。
        'X-Passport-Client': 'spacefight-harmony'
      },
      extraData: JSON.stringify({ 'username': this.account.trim(), 'password': this.password }),
      connectTimeout: 8000,
      readTimeout: 10000
    }).then((response: http.HttpResponse) => {
      try {
        let payload = JSON.parse(String(response.result)) as Record<string, Object>
        if (Boolean(payload['success'])) {
          let user = payload['user'] as Record<string, Object>
          let display = user['nickname'] ? String(user['nickname']) : String(user['username'])
          this.pilotName = display || this.account.trim()
          this.loginText = `已登录为 ${this.pilotName}`
          this.screen = 'launch'
          preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
            store.put('display_name', this.pilotName)
            store.flush()
          })
        } else {
          this.loginText = payload['error'] ? String(payload['error']) : '登录失败'
        }
      } catch (_) {
        this.loginText = '登录响应无法读取'
      }
      client.destroy()
    }).catch(() => {
      this.loginText = '连接通行证失败'
      client.destroy()
    })
  }

  private checkUpdates(manual: boolean): void {
    let client = http.createHttp()
    client.request(`${this.manifestUrl}?release=${Date.now()}`, {
      method: http.RequestMethod.GET,
      connectTimeout: 6000,
      readTimeout: 6000
    }).then((result: http.HttpResponse) => {
      try {
        let payload = JSON.parse(String(result.result)) as Record<string, Object>
        let apps = payload['apps'] as DownloadEntry[]
        let entry = apps.find((item: DownloadEntry) => item.id === this.updateId)
        if (entry && this.isRemoteReleaseNewer(entry.version, Number(entry.build))) {
          this.updateText = `发现新版本 ${entry.version}`
        } else if (manual) {
          this.updateText = '已是最新版本'
        }
      } catch (_) {
        if (manual) this.updateText = '暂时无法检查更新'
      }
      client.destroy()
    }).catch(() => {
      if (manual) this.updateText = '暂时无法检查更新'
      client.destroy()
    })
  }

  private isRemoteReleaseNewer(version: string, build: number): boolean {
    let remote = version.split('.').map((part: string) => Number(part) || 0)
    let local = this.appVersion.split('.').map((part: string) => Number(part) || 0)
    let count = Math.max(remote.length, local.length)
    for (let index = 0; index < count; index++) {
      let remotePart = index < remote.length ? remote[index] : 0
      let localPart = index < local.length ? local[index] : 0
      if (remotePart !== localPart) return remotePart > localPart
    }
    return build > this.appBuild
  }

  @Builder
  private utilityButton(icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Image(icon)
        .width(20)
        .height(20)
        .objectFit(ImageFit.Contain)
    }
    .width(38)
    .height(38)
    .backgroundColor('#C90B1015')
    .border({ width: 1, color: '#596670' })
    .borderRadius(3)
    .accessibilityText(label)
    .onClick(action)
  }

  @Builder
  private flightUtility() {
    Row({ space: 8 }) {
      this.utilityButton($r('app.media.profile'), '飞行员档案', () => this.screen = 'profile')
      this.utilityButton($r('app.media.update'), '检查更新', () => this.checkUpdates(true))
    }
    .align(Alignment.TopEnd)
    .margin({ top: this.compactDeck ? 12 : 18, right: this.compactDeck ? 12 : 18 })
  }

  @Builder
  private missionCard(item: MissionItem, compact: boolean) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 3 }) {
        Text(item.title)
          .width('100%')
          .fontSize(compact ? 13 : 15)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.selectedMode === item.id ? '#111619' : '#F0F5F6')
          .maxLines(1)
        Text(item.detail)
          .width('100%')
          .fontSize(10)
          .fontColor(this.selectedMode === item.id ? '#49361E' : '#A7B6BC')
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
    }
    .width(compact ? 156 : '100%')
    .height(compact ? 58 : 60)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.selectedMode === item.id ? '#F0A44B' : '#F00B1015')
    .border({ width: 1, color: this.selectedMode === item.id ? '#F8C47F' : '#53616A' })
    .borderRadius(3)
    .onClick(() => this.selectedMode = item.id)
  }

  @Builder
  private missionRail() {
    if (this.compactDeck) {
      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.missionItems, (item: MissionItem) => {
            this.missionCard(item, true)
          }, (item: MissionItem) => item.id)
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
    } else {
      Column({ space: 7 }) {
        ForEach(this.missionItems, (item: MissionItem) => {
          this.missionCard(item, false)
        }, (item: MissionItem) => item.id)
      }
      .width('100%')
    }
  }

  @Builder
  private launchButton() {
    Button(this.selectedMode === 'public' ? '进入公开协作战区' : `执行任务 · ${this.modeName(this.selectedMode)}`)
      .width('100%')
      .height(50)
      .fontSize(14)
      .fontWeight(FontWeight.Bold)
      .fontColor('#101518')
      .backgroundColor('#F0A44B')
      .border({ width: 1, color: '#FFD39A' })
      .borderRadius(3)
      .onClick(() => this.startGame())
  }

  @Builder
  private launch() {
    Column({ space: 10 }) {
      Row() {
        Column({ space: 2 }) {
          Text('SPACEFIGHT')
            .fontSize(this.compactDeck ? 24 : 28)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F4F7F8')
          Text('TACTICAL FLIGHT DECK // ONLINE')
            .fontSize(10)
            .fontColor('#F0A44B')
        }
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height(44)
      Scroll() {
        Column({ space: 12 }) {
          Text(this.statusText)
            .width('100%')
            .fontSize(11)
            .fontColor('#C3CED3')
            .maxLines(2)
          Text('LOCAL OPERATIONS // 6 MISSIONS')
            .width('100%')
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .fontColor('#55D4B1')
          this.missionRail()
          Row({ space: 7 }) {
            Button(`装配台 · ${this.weaponName(this.loadoutWeapon)}`)
              .layoutWeight(1)
              .height(42)
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .fontColor('#F2D3A4')
              .backgroundColor('#E011171C')
              .border({ width: 1, color: '#B67C39' })
              .borderRadius(2)
              .onClick(() => this.screen = 'armory')
            Button('控制中心')
              .width(108)
              .height(42)
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .fontColor('#CFE5E8')
              .backgroundColor('#E011171C')
              .border({ width: 1, color: '#4D6670' })
              .borderRadius(2)
              .onClick(() => this.screen = 'settings')
          }
          .width('100%')
          Column({ space: 7 }) {
            Text(this.modeName(this.selectedMode))
              .width('100%')
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor('#F2F5F6')
            Text(this.missionItems.find((item: MissionItem) => item.id === this.selectedMode)?.objective ||
              '与其他飞行员进入服务器战区')
              .width('100%')
              .fontSize(12)
              .fontColor('#C0CCD1')
              .maxLines(2)
            Text('移动、瞄准、开火独立操作 · 支持实体键盘')
              .width('100%')
              .fontSize(10)
              .fontColor('#F0A44B')
          }
          .width('100%')
          .padding(14)
          .alignItems(HorizontalAlign.Start)
          .backgroundColor('#F20A0F13')
          .border({ width: 1, color: '#4E5B63' })
          .borderRadius(3)
          Button('公开协作战区 · 通行证身份')
            .width('100%')
            .height(40)
            .fontSize(12)
            .fontColor('#DCE7EA')
            .backgroundColor('#E0131B20')
            .border({ width: 1, color: '#53616A' })
            .borderRadius(3)
            .onClick(() => {
              this.selectedMode = 'public'
              this.startGame()
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      this.launchButton()
    }
    .width(this.compactDeck ? '100%' : 430)
    .height('100%')
    .padding({
      left: this.compactDeck ? 14 : 22,
      right: this.compactDeck ? 14 : 22,
      top: this.compactDeck ? 10 : 20,
      bottom: this.compactDeck ? 12 : 20
    })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.compactDeck ? '#F4070A0D' : '#E8070A0D')
    .align(Alignment.TopStart)
  }

  @Builder
  private armoryPanel() {
    Column({ space: 10 }) {
      Text('战备整备台')
        .width('100%')
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor('#F2F5F6')
      Text('主武器、战术设备与机体核心都会直接改变本地战斗参数')
        .width('100%')
        .fontSize(11)
        .fontColor('#A7B6BC')
      Scroll() {
        Column({ space: 8 }) {
          Text('01  主武器').width('100%').fontSize(11).fontWeight(FontWeight.Bold).fontColor('#F0A44B')
          Row({ space: 4 }) {
            ForEach([0, 1, 2, 3, 4], (index: number) => {
              Button(this.weaponName(index))
              .layoutWeight(1)
              .height(44)
              .fontSize(10)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.loadoutWeapon === index ? '#15191B' : '#DDE6E9')
              .backgroundColor(this.loadoutWeapon === index ? '#F0A44B' : '#E010161B')
              .border({ width: 1, color: this.loadoutWeapon === index ? '#F7C278' : '#4A5962' })
              .borderRadius(2)
              .onClick(() => this.loadoutWeapon = index)
            }, (index: number) => `w${index}`)
          }.width('100%')
          Text('02  战术设备').width('100%').fontSize(11).fontWeight(FontWeight.Bold).fontColor('#F0A44B')
          Row({ space: 4 }) {
            ForEach([0, 1, 2, 3, 4], (index: number) => {
              Button(this.deviceName(index))
                .layoutWeight(1).height(44).fontSize(10).fontWeight(FontWeight.Bold)
                .fontColor(this.loadoutDevice === index ? '#15191B' : '#DDE6E9')
                .backgroundColor(this.loadoutDevice === index ? '#F0A44B' : '#E010161B')
                .border({ width: 1, color: this.loadoutDevice === index ? '#F7C278' : '#4A5962' })
                .borderRadius(2).onClick(() => this.loadoutDevice = index)
            }, (index: number) => `d${index}`)
          }.width('100%')
          Text('03  机体核心').width('100%').fontSize(11).fontWeight(FontWeight.Bold).fontColor('#F0A44B')
          Row({ space: 4 }) {
            ForEach([0, 1, 2, 3, 4, 5], (index: number) => {
              Button(this.coreName(index))
                .layoutWeight(1).height(44).fontSize(9).fontWeight(FontWeight.Bold)
                .fontColor(this.loadoutCore === index ? '#15191B' : '#DDE6E9')
                .backgroundColor(this.loadoutCore === index ? '#F0A44B' : '#E010161B')
                .border({ width: 1, color: this.loadoutCore === index ? '#F7C278' : '#4A5962' })
                .borderRadius(2).onClick(() => this.loadoutCore = index)
            }, (index: number) => `c${index}`)
          }.width('100%')
          Text(`${this.weaponName(this.loadoutWeapon)} / ${this.deviceName(this.loadoutDevice)} / ${this.coreName(this.loadoutCore)}`)
            .width('100%').fontSize(11).fontColor('#D5E0E4').padding(10)
            .backgroundColor('#D90B1116').border({ width: 1, color: '#42515A' })
        }
        .width('100%')
      }
      .width('100%')
      .layoutWeight(1)
      Button('确认装配')
        .width('100%')
        .height(48)
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor('#15191B')
        .backgroundColor('#F0A44B')
        .borderRadius(2)
        .onClick(() => {
          preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
            store.put('starting_weapon', this.loadoutWeapon)
            store.put('tactical_device', this.loadoutDevice)
            store.put('frame_core', this.loadoutCore)
            store.flush()
          })
          this.statusText = `整备完成 · ${this.weaponName(this.loadoutWeapon)} / ${this.deviceName(this.loadoutDevice)} / ${this.coreName(this.loadoutCore)}`
          this.screen = 'launch'
        })
      Button('返回机库')
        .width('100%')
        .height(38)
        .fontSize(12)
        .fontColor('#CBD5D9')
        .backgroundColor('#E010161B')
        .border({ width: 1, color: '#4A5962' })
        .borderRadius(2)
        .onClick(() => this.screen = 'launch')
    }
    .width(this.compactDeck ? '96%' : '76%')
    .height(this.compactDeck ? '92%' : '82%')
    .constraintSize({ maxWidth: 760 })
    .padding(this.compactDeck ? 16 : 24)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor('#F4070B0E')
    .border({ width: 1, color: '#6B563C' })
    .borderRadius(3)
    .align(Alignment.Center)
  }

  @Builder
  private settingsPanel() {
    Column({ space: 9 }) {
      Text('控制中心').width('100%').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#F2F5F6')
      Text('触控布局与实体键盘方案会保存在本机').width('100%').fontSize(11).fontColor('#A7B6BC')
      Scroll() {
        Column({ space: 7 }) {
          Button(`触控布局    ${this.leftHanded ? '左手开火' : '右手开火'}`)
            .width('100%').height(42).fontSize(12).fontColor('#DDE7EA')
            .backgroundColor('#E010171C').border({ width: 1, color: '#4B5D66' }).borderRadius(2)
            .onClick(() => this.leftHanded = !this.leftHanded)
          Button(`瞄准灵敏度    ${this.aimSensitivity < 0.85 ? '稳健' : (this.aimSensitivity < 1.2 ? '标准' : '迅捷')}`)
            .width('100%').height(42).fontSize(12).fontColor('#DDE7EA')
            .backgroundColor('#E010171C').border({ width: 1, color: '#4B5D66' }).borderRadius(2)
            .onClick(() => this.aimSensitivity = this.aimSensitivity < 0.85 ? 1 : (this.aimSensitivity < 1.2 ? 1.35 : 0.75))
          Button(`移动键位    ${['WASD', '方向键', 'IJKL'][this.keyboardPreset]}`)
            .width('100%').height(42).fontSize(12).fontColor('#DDE7EA')
            .backgroundColor('#E010171C').border({ width: 1, color: '#4B5D66' }).borderRadius(2)
            .onClick(() => this.keyboardPreset = (this.keyboardPreset + 1) % 3)
          Button(`开火键    ${['空格', '回车', '左 Control'][this.fireKeyPreset]}`)
            .width('100%').height(42).fontSize(12).fontColor('#DDE7EA')
            .backgroundColor('#E010171C').border({ width: 1, color: '#4B5D66' }).borderRadius(2)
            .onClick(() => this.fireKeyPreset = (this.fireKeyPreset + 1) % 3)
          Button(`视角键    ${['V', 'C', 'Tab'][this.cameraKeyPreset]}`)
            .width('100%').height(42).fontSize(12).fontColor('#DDE7EA')
            .backgroundColor('#E010171C').border({ width: 1, color: '#4B5D66' }).borderRadius(2)
            .onClick(() => this.cameraKeyPreset = (this.cameraKeyPreset + 1) % 3)
        }.width('100%')
      }.width('100%').layoutWeight(1)
      Button('保存控制方案')
        .width('100%').height(46).fontSize(13).fontWeight(FontWeight.Bold)
        .fontColor('#15191B').backgroundColor('#F0A44B').borderRadius(2)
        .onClick(() => {
          preferences.getPreferences(getContext(this), 'spacefight').then((store: preferences.Preferences) => {
            store.put('left_handed', this.leftHanded)
            store.put('aim_sensitivity', this.aimSensitivity)
            store.put('keyboard_preset', this.keyboardPreset)
            store.put('fire_key_preset', this.fireKeyPreset)
            store.put('camera_key_preset', this.cameraKeyPreset)
            store.flush()
          })
          this.statusText = '控制方案已保存 · 触控与键盘可混合输入'
          this.screen = 'launch'
        })
      Button('返回机库').width('100%').height(38).fontSize(12).fontColor('#CBD5D9')
        .backgroundColor('#E010161B').border({ width: 1, color: '#4A5962' }).borderRadius(2)
        .onClick(() => this.screen = 'launch')
    }
    .width(this.compactDeck ? '94%' : 520)
    .height(this.compactDeck ? '92%' : '82%')
    .constraintSize({ maxWidth: 520 })
    .padding(this.compactDeck ? 16 : 24)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor('#F4070B0E')
    .border({ width: 1, color: '#53646D' })
    .borderRadius(3)
    .align(Alignment.Center)
  }

  @Builder
  private loginPanel() {
    Column() {
      Text('铮铮通行证')
        .fontSize(27)
        .fontWeight(FontWeight.Bold)
        .fontColor('#F2F0EA')
      Text('在 App 内直接登录，不会打开网页。')
        .fontSize(13)
        .fontColor('#91A0AC')
        .margin({ top: 4, bottom: 20 })
      TextInput({ text: this.account, placeholder: '用户名 / 邮箱 / 手机号' })
        .height(48)
        .fontColor('#E8ECEE')
        .placeholderColor('#71808C')
        .backgroundColor('#141C23')
        .border({ width: 1, color: '#3A4650' })
        .borderRadius(6)
        .onChange((value: string) => this.account = value)
      TextInput({ text: this.password, placeholder: '密码' })
        .type(InputType.Password)
        .height(48)
        .fontColor('#E8ECEE')
        .placeholderColor('#71808C')
        .backgroundColor('#141C23')
        .border({ width: 1, color: '#3A4650' })
        .borderRadius(6)
        .margin({ top: 10 })
        .onChange((value: string) => this.password = value)
      Text(this.loginText)
        .fontSize(12)
        .fontColor('#DCA85B')
        .height(24)
        .margin({ top: 8 })
      Button('登录')
        .width('100%')
        .height(50)
        .fontColor('#14171A')
        .fontWeight(FontWeight.Bold)
        .backgroundColor('#F0A44B')
        .borderRadius(6)
        .onClick(() => this.login())
      Button('返回')
        .width('100%')
        .height(44)
        .fontColor('#DCE2E6')
        .backgroundColor('#182028')
        .borderRadius(6)
        .margin({ top: 10 })
        .onClick(() => this.screen = 'launch')
    }
    .width(this.compactDeck ? '90%' : 390)
    .constraintSize({ maxWidth: 390 })
    .padding(this.compactDeck ? 20 : 28)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor('#F40F151B')
    .border({ width: 1, color: '#3A454F' })
    .borderRadius(8)
    .align(Alignment.Center)
  }

  @Builder
  private profilePanel() {
    Column() {
      Text('我的 SpaceFight')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor('#F2F0EA')
      Text(this.pilotName === 'Player' ? '未登录通行证' : `飞行员：${this.pilotName}`)
        .fontSize(15)
        .fontColor('#DCE2E6')
        .margin({ top: 18 })
      Text(this.updateText)
        .fontSize(13)
        .fontColor('#91A0AC')
        .margin({ top: 8 })
      Text('包名 cn.zhengzhengstudio.spacefight.hmos')
        .fontSize(12)
        .fontColor('#71808C')
        .margin({ top: 4, bottom: 22 })
      Button(this.pilotName === 'Player' ? '通行证登录' : '切换账号')
        .width('100%')
        .height(48)
        .fontColor('#14171A')
        .backgroundColor('#F0A44B')
        .borderRadius(6)
        .onClick(() => this.screen = 'login')
      Button('检查更新')
        .width('100%')
        .height(44)
        .fontColor('#DCE2E6')
        .backgroundColor('#182028')
        .borderRadius(6)
        .margin({ top: 10 })
        .onClick(() => this.checkUpdates(true))
      Button('返回')
        .width('100%')
        .height(44)
        .fontColor('#DCE2E6')
        .backgroundColor('#182028')
        .borderRadius(6)
        .margin({ top: 10 })
        .onClick(() => this.screen = 'launch')
    }
    .width(this.compactDeck ? '90%' : 390)
    .constraintSize({ maxWidth: 390 })
    .padding(this.compactDeck ? 20 : 28)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor('#F40F151B')
    .border({ width: 1, color: '#3A454F' })
    .borderRadius(8)
    .align(Alignment.Center)
  }

  @Builder
  private weaponStrip() {
    Row({ space: 5 }) {
      ForEach([
        { id: 0, name: 'PULSE' },
        { id: 1, name: 'SCATTER' },
        { id: 2, name: 'MISSILE' },
        { id: 3, name: 'RAIL' },
        { id: 4, name: 'PLASMA' }
      ], (item: Record<string, string | number>) => {
        Button(String(item.name))
          .width(62)
          .height(32)
          .fontSize(9)
          .fontColor(this.weapon === Number(item.id) ? '#16191B' : '#C5D0D4')
          .backgroundColor(this.weapon === Number(item.id) ? '#F0A44B' : '#CA0B1015')
          .border({ width: 1, color: this.weapon === Number(item.id) ? '#F0A44B' : '#44515A' })
          .borderRadius(2)
          .onClick(() => this.selectWeapon(Number(item.id)))
      }, (item: Record<string, string | number>) => String(item.id))
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ bottom: 10 })
  }

  private pauseCombat(): void {
    this.paused = true
    this.resetInput()
    AlertDialog.show({
      title: 'COMBAT PAUSED',
      message: '操作：左侧移动 · 右侧瞄准并自动开火 · 底部切换武器',
      primaryButton: {
        value: '继续',
        action: () => this.paused = false
      },
      secondaryButton: {
        value: '返回甲板',
        action: () => {
          this.disconnect()
          this.screen = 'launch'
          this.statusText = '离线战区已就绪 · 本机 60 Hz'
        }
      }
    })
  }

  @Builder
  private combatOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        this.weaponStrip()
        this.gameControls()
      }
      .width('100%')
      .align(Alignment.Bottom)
      Row({ space: 7 }) {
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.camera'))
            .width(20)
            .height(20)
        }
          .width(38)
          .height(38)
          .backgroundColor('#F00B1015')
          .border({ width: 1, color: '#6B7B83' })
          .borderRadius(3)
          .accessibilityText(this.cameraMode === 'cockpit' ? '切换到追尾视角' : '切换到驾驶舱视角')
          .onClick(() => this.toggleCamera())
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.pause'))
            .width(20)
            .height(20)
        }
        .width(38)
        .height(38)
        .backgroundColor('#F00B1015')
        .border({ width: 1, color: '#6B7B83' })
        .borderRadius(3)
        .accessibilityText('暂停战斗')
        .onClick(() => this.pauseCombat())
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
      .padding({ top: 14, right: this.compactDeck ? 12 : 18 })
      .align(Alignment.TopEnd)
      if (this.trainingStep >= 0) {
        this.trainingPanel()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private trainingPanel() {
    Column({ space: 5 }) {
      Text(`飞行校准 ${this.trainingStep + 1}/3`)
        .width('100%')
        .fontSize(11)
        .fontColor('#F0A44B')
      Text(['移动校准', '瞄准并开火', '切换武器'][this.trainingStep])
        .width('100%')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor('#F2F5F6')
      Text(['拖动移动杆推进与横移', '拖动瞄准区并按独立开火键', '点选底部武器'][this.trainingStep])
        .width('100%')
        .fontSize(12)
        .fontColor('#AEBCC3')
    }
    .width(this.compactDeck ? '88%' : '52%')
    .constraintSize({ maxWidth: 460 })
    .padding({ left: 18, right: 18, top: 13, bottom: 13 })
    .backgroundColor('#EC0A0F13')
    .border({ width: { left: 4, top: 1, right: 1, bottom: 1 }, color: '#F0A44B' })
    .borderRadius(3)
    .position({ x: this.compactDeck ? '6%' : '24%', y: this.compactDeck ? 64 : 78 })
  }

  @Builder
  private moveControl() {
    Stack() {
      Circle()
          .width(this.compactDeck ? 86 : 104)
          .height(this.compactDeck ? 86 : 104)
          .fill('#245C6870')
          .stroke('#6691A3AC')
          .strokeWidth(2)
      Circle()
          .width(34)
          .height(34)
          .fill('#80F0A44B')
          .translate({
            x: this.strafe * (this.compactDeck ? 24 : 30),
            y: -this.throttle * (this.compactDeck ? 24 : 30)
          })
      Text('推进 · 平移')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#D9E1E4')
          .position({ x: this.compactDeck ? 23 : 32, y: this.compactDeck ? 88 : 104 })
    }
      .width(this.compactDeck ? 108 : 126)
      .height(this.compactDeck ? 108 : 126)
      .onTouch((event: TouchEvent) => this.updateMove(event))
  }

  @Builder
  private aimControl() {
    Stack() {
      Circle()
          .width(this.compactDeck ? 72 : 88)
          .height(this.compactDeck ? 72 : 88)
          .fill('#245C6870')
          .stroke('#6691A3AC')
          .strokeWidth(2)
      Text('机头转向')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#E6EAEB')
    }
      .width(this.compactDeck ? 92 : 108)
      .height(this.compactDeck ? 108 : 126)
      .onTouch((event: TouchEvent) => this.updateAim(event))
  }

  @Builder
  private fireControl() {
    Stack() {
      Circle()
        .width(this.compactDeck ? 64 : 76)
        .height(this.compactDeck ? 64 : 76)
        .fill(this.firing ? '#80F0A44B' : '#34434A')
        .stroke(this.firing ? '#F0A44B' : '#77909A')
        .strokeWidth(2)
      Text('主武器').fontSize(10).fontWeight(FontWeight.Bold).fontColor('#F2F5F6')
    }
      .width(this.compactDeck ? 82 : 94)
      .height(this.compactDeck ? 108 : 126)
      .onTouch((event: TouchEvent) => this.updateFire(event))
  }

  @Builder
  private gameControls() {
    Row({ space: this.compactDeck ? 2 : 8 }) {
      if (this.leftHanded) {
        this.fireControl()
        this.aimControl()
        Blank()
        this.moveControl()
      } else {
        this.moveControl()
        Blank()
        this.aimControl()
        this.fireControl()
      }
    }
    .width('100%')
    .padding({ left: this.compactDeck ? 12 : 18, right: this.compactDeck ? 12 : 18, bottom: 8 })
    .align(Alignment.Bottom)
  }

  @Builder
  private gameOverPanel() {
    Column({ space: 10 }) {
      Text(this.battle.missionComplete ? 'MISSION COMPLETE' : 'MISSION FAILED')
        .fontSize(27)
        .fontWeight(FontWeight.Bold)
        .fontColor('#F2F5F6')
      Text(`最终评分  ${this.battle.score.toString().padStart(7, '0')}`)
        .fontSize(15)
        .fontColor('#F0A44B')
      Text(this.statusText)
        .fontSize(12)
        .fontColor('#9AA9B0')
        .margin({ bottom: 12 })
      Button('重新部署')
        .width('100%')
        .height(46)
        .fontWeight(FontWeight.Bold)
        .fontColor('#15191B')
        .backgroundColor('#F0A44B')
        .borderRadius(3)
        .onClick(() => this.startGame())
      Button('返回飞行甲板')
        .width('100%')
        .height(42)
        .fontColor('#D9E3E6')
        .backgroundColor('#C80B1015')
        .border({ width: 1, color: '#49565E' })
        .borderRadius(3)
        .onClick(() => {
          this.disconnect()
          this.screen = 'launch'
          this.statusText = '离线战区已就绪 · 本机 60 Hz'
        })
    }
    .width('82%')
    .constraintSize({ maxWidth: 360 })
    .padding(24)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor('#E80B1015')
    .border({ width: 1, color: '#5E4731' })
    .borderRadius(3)
    .align(Alignment.Center)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Canvas(this.canvas)
        .width('100%')
        .height('100%')
        .onReady(() => this.draw())
        .onAreaChange((_oldValue: Area, newValue: Area) => {
          this.canvasWidth = Number(newValue.width)
          this.canvasHeight = Number(newValue.height)
          let nextCompact = this.canvasWidth < 720 || this.canvasHeight < 620
          if (this.compactDeck !== nextCompact) this.compactDeck = nextCompact
          this.draw()
        })
      if (this.screen === 'launch') {
        this.launch()
        this.flightUtility()
      } else if (this.screen === 'login') {
        this.loginPanel()
      } else if (this.screen === 'profile') {
        this.profilePanel()
      } else if (this.screen === 'armory') {
        this.armoryPanel()
      } else if (this.screen === 'settings') {
        this.settingsPanel()
      } else if (this.screen === 'game') {
        this.combatOverlay()
      } else if (this.screen === 'gameover') {
        this.gameOverPanel()
      }
    }
    .backgroundColor('#070A0D')
    .width('100%')
    .height('100%')
    .focusable(true)
    .focusOnTouch(true)
    .onKeyEvent((event: KeyEvent) => this.handleKey(event))
  }
}
