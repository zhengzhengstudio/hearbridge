import {
  _decorator,
  builtinResMgr,
  Camera,
  Color,
  Component,
  CurveRange,
  director,
  DirectionalLight,
  game,
  GradientRange,
  Material,
  MeshRenderer,
  Node,
  ParticleSystem,
  SphereLight,
  sys,
  tween,
  primitives,
  utils,
  Vec3,
  view,
} from 'cc';
import { AIM_CONVERGENCE_DISTANCE, computeAimRay } from '../core/AimConvergence';
import {
  CombatSimulation,
  PRIMARY_OUTPOST_POSITION,
  type CombatSnapshot,
  type MissionDefinition,
  type OutpostService,
} from '../core/CombatSimulation';
import { neutralFlightCommand } from '../core/FlightCommand';
import { COMBAT_FEEL, PLAYER_HIT_TUNING } from '../core/FlightTuning';
import { resolveLoadout } from '../core/WeaponCatalog';
import type { CombatLoadout } from '../core/WeaponCatalog';
import { awardStarportTickets, loadEconomy, spendStarportTickets } from '../core/PlayerEconomy';
import { BrowserInputBridge } from '../input/BrowserInputBridge';
import { CocosInputBridge, NATIVE_SAFE_INSETS } from '../input/CocosInputBridge';
import { CocosGamepadBridge } from '../input/CocosGamepadBridge';
import { DesktopFlightInput } from '../input/DesktopFlightInput';
import {
  DEFAULT_GAMEPAD_CALIBRATION,
  GamepadFlightInput,
  normalizeGamepadCalibration,
} from '../input/GamepadFlightInput';
import { InputRouter } from '../input/InputRouter';
import {
  DEFAULT_INPUT_SETTINGS,
  loadInputSettings,
  saveInputSettings,
  type InputSettings,
} from '../input/InputSettings';
import { TouchFlightInput } from '../input/TouchFlightInput';
import {
  resolveGraphicsDecision,
  resolveRuntimePlatform,
  type CapabilityInput,
  type GraphicsSimulationState,
} from '../performance/CapabilityPolicy';
import {
  graphicsAdviceChannel,
  type GraphicsAdviceAction,
} from '../performance/GraphicsAdviceChannel';
import {
  GRAPHICS_PROFILES,
  resolveRenderScale,
  type GraphicsProfile,
  type GraphicsTier,
} from '../performance/GraphicsProfile';
import { resolveViewportLayout } from '../performance/DeviceFormFactor';
import type { DeviceFormFactor } from '../performance/DeviceFormFactor';
import { bootstrapPlatformBridge, dismissNativeLaunchScreen } from '../platform/PlatformBootstrap';
import type { DeviceSnapshot, PlatformBridge, PlatformName } from '../platform/PlatformBridge';
import {
  CoopPresenceBuffer,
  activeCoopTransport,
  type CoopMessage,
  type CoopPresence,
} from '../core/CoopNetwork';
import { CombatFeedbackPresenter } from './CombatFeedbackPresenter';
import { CombatVisuals } from './CombatVisuals';
import { ProjectilePresenter } from './ProjectilePresenter';
import { ShipPresenter } from './ShipPresenter';
import { WorldStreamer } from './WorldStreamer';
import { createWorldStreamProfile } from './WorldStreamProfile';
import {
  NativeCombatHud,
  type CoopHudBridge,
  type CoopHudState,
  type NativeHudActions,
  type StationServiceId,
} from './NativeCombatHud';
import { GameAudio } from './GameAudio';
import { LootPresenter } from './LootPresenter';
import { parseCoopInvite, WebCoopSession } from '../platform/WebCoopSession';

const { ccclass } = _decorator;

const GRAPHICS_PROMPT_PREFERENCE_KEY = 'spacefight.graphics.prompt.v1';
const GAMEPAD_CALIBRATION_KEY = 'spacefight.gamepad.v1';
const CAPABILITY_TIMEOUT_MS = 1200;
const UNKNOWN_DEVICE: DeviceSnapshot = {
  memoryGB: null,
  availableMemoryGB: null,
  lowRamDevice: null,
  emulator: null,
  logicalCores: null,
  gpuRenderer: null,
  viewportWidth: 0,
  viewportHeight: 0,
  pixelRatio: 1,
};

export type MissionPreset = 'salvage' | 'assault' | 'hunt' | 'survive' | 'defense' | 'escort';

/**
 * 六个任务预设的**玩法循环各不相同**（此前只有三个，且三者都是「打够 N 个敌人」，
 * 换汤不换药，打完就没事了）：
 * - salvage 采集：必须装满货舱再清场，逼玩家在贪战与带货之间取舍
 * - assault 歼灭：经典推进，熟悉者优先上手
 * - hunt    猎杀：只有击落精英才推进，杂兵无限补，逼出「优先处理威胁」的决策
 * - survive 存活：撑够时间即可，敌人持续增援，给玩家喘息与「苟住也是策略」的选项
 * - defense 守点：守住空间站，敌人靠近核心就掉进度，**逼玩家留在原地**而不是往前冲
 * - escort  护送：带一具运输船，挨打或被甩开都掉进度，逼玩家在清场与护送之间取舍
 */
const MISSION_PRESETS: Readonly<Record<MissionPreset, MissionDefinition>> = {
  salvage: {
    id: 'shattered-lane-expedition',
    seed: 1337,
    primaryEvent: 'intercept',
    enemies: [
      {
        id: 'scout-alpha',
        kind: 'scout',
        position: { x: 18, y: 4, z: -92 },
        health: 42,
      },
      {
        id: 'suppressor-beta',
        kind: 'suppressor',
        position: { x: -34, y: -3, z: -118 },
        health: 54,
      },
      {
        id: 'bomber-gamma',
        kind: 'bomber',
        position: { x: 42, y: 9, z: -146 },
        health: 68,
      },
    ],
    pickups: [
      {
        id: 'energy-cache-alpha',
        kind: 'energy',
        position: { x: 14, y: 0, z: 8 },
        value: 25,
      },
      // 采集目标需要场上有足够战利品可捡，否则目标从一开始就不可能完成
      { id: 'salvage-cache-bravo', kind: 'loot', position: { x: -18, y: 2, z: -58 }, value: 32 },
      { id: 'salvage-cache-charlie', kind: 'loot', position: { x: 26, y: -3, z: -84 }, value: 28 },
      { id: 'salvage-cache-delta', kind: 'loot', position: { x: -8, y: 4, z: -104 }, value: 30 },
      // 维修包与护盾包：让「贪战」与「保命」成为可选项
      { id: 'salvage-repair', kind: 'repair', position: { x: 30, y: 1, z: -120 }, value: 28 },
      { id: 'salvage-shield', kind: 'shield', position: { x: -32, y: -2, z: -66 }, value: 34 },
    ],
    objective: { type: 'collect', requiredKills: 3, cargoRatio: 0.55 },
  },
  assault: {
    id: 'relay-breach',
    seed: 2407,
    primaryEvent: 'breach',
    enemies: [
      { id: 'guard-alpha', kind: 'suppressor', position: { x: -30, y: 5, z: -82 }, health: 58 },
      { id: 'guard-beta', kind: 'scout', position: { x: 28, y: -4, z: -96 }, health: 46 },
      { id: 'gunship-delta', kind: 'gunship', position: { x: 4, y: 10, z: -136 }, health: 88 },
      { id: 'bomber-epsilon', kind: 'bomber', position: { x: 46, y: 2, z: -158 }, health: 74 },
    ],
    pickups: [
      { id: 'relay-scrap', kind: 'scrap', position: { x: -12, y: 0, z: -48 }, value: 38 },
      { id: 'relay-energy', kind: 'energy', position: { x: 22, y: 2, z: -70 }, value: 28 },
    ],
    objective: { type: 'eliminate', requiredKills: 4 },
  },
  hunt: {
    id: 'black-signal-hunt',
    seed: 9413,
    primaryEvent: 'hunt',
    enemies: [
      { id: 'hunter-escort-alpha', kind: 'scout', position: { x: -42, y: 6, z: -108 }, health: 50 },
      { id: 'hunter-escort-beta', kind: 'suppressor', position: { x: 38, y: -5, z: -124 }, health: 62 },
      { id: 'black-signal-ace', kind: 'boss', position: { x: 0, y: 14, z: -176 }, health: 180 },
    ],
    pickups: [
      { id: 'ace-data-core', kind: 'data', position: { x: 0, y: 4, z: -132 }, value: 64 },
    ],
    // 猎杀目标：progress 只认精英击落，escort 打的再多也不涨
    objective: { type: 'hunt', requiredKills: 4, eliteKind: 'gunship' },
  },
  survive: {
    id: 'silent-drift-holdout',
    seed: 3151,
    primaryEvent: 'intercept',
    enemies: [
      { id: 'holdout-scout', kind: 'scout', position: { x: 24, y: 5, z: -96 }, health: 40 },
      { id: 'holdout-suppressor', kind: 'suppressor', position: { x: -28, y: -4, z: -110 }, health: 56 },
    ],
    pickups: [
      { id: 'holdout-energy', kind: 'energy', position: { x: 12, y: 0, z: 6 }, value: 30 },
      { id: 'holdout-repair', kind: 'repair', position: { x: -16, y: 2, z: -74 }, value: 28 },
      { id: 'holdout-shield', kind: 'shield', position: { x: 20, y: -2, z: -88 }, value: 34 },
    ],
    // 存活目标：撑够 60 秒，敌人持续增援，不要求清场
    objective: { type: 'survive', surviveSeconds: 60 },
  },
  defense: {
    id: 'outpost-siege-guard',
    seed: 5279,
    primaryEvent: 'breach',
    enemies: [
      { id: 'siege-raider', kind: 'fighter', position: { x: -36, y: 6, z: -104 }, health: 52 },
      { id: 'siege-gunship', kind: 'gunship', position: { x: 38, y: -5, z: -128 }, health: 90 },
      { id: 'siege-bomber', kind: 'bomber', position: { x: 4, y: 10, z: -150 }, health: 76 },
    ],
    pickups: [
      { id: 'siege-repair', kind: 'repair', position: { x: 34, y: 1, z: -96 }, value: 28 },
      { id: 'siege-shield', kind: 'shield', position: { x: -30, y: -3, z: -100 }, value: 34 },
    ],
    // 守点目标：核心就是空间站，敌人靠近就掉进度
    objective: {
      type: 'defense',
      surviveSeconds: 60,
      defensePoint: { x: 22, y: -6, z: -72 },
      defenseRadius: 40,
    },
  },
  escort: {
    id: 'convoy-escort-run',
    seed: 8191,
    primaryEvent: 'intercept',
    enemies: [
      { id: 'raider-alpha', kind: 'scout', position: { x: -22, y: 4, z: -88 }, health: 44 },
      { id: 'raider-beta', kind: 'fighter', position: { x: 26, y: -3, z: -104 }, health: 56 },
      { id: 'raider-gunship', kind: 'gunship', position: { x: -8, y: 9, z: -142 }, health: 92 },
    ],
    pickups: [
      { id: 'convoy-energy', kind: 'energy', position: { x: 10, y: 0, z: 4 }, value: 30 },
      { id: 'convoy-repair', kind: 'repair', position: { x: -14, y: 2, z: -70 }, value: 28 },
    ],
    // 护送目标：运输船跟着玩家走，它挨打或被甩开都掉进度
    objective: {
      type: 'escort',
      surviveSeconds: 60,
      escortStart: { x: 0, y: 0, z: 20 },
      escortFollowDistance: 46,
    },
  },
};

const MISSION_PRESET_IDS: readonly MissionPreset[] = [
  'salvage', 'assault', 'hunt', 'survive', 'defense', 'escort',
];

function readBrowserMissionPreset(): MissionPreset {
  const preset = browserDataset()?.missionPreset;
  return MISSION_PRESET_IDS.includes(preset as MissionPreset)
    ? (preset as MissionPreset)
    : 'salvage';
}

function constantCurve(value: number): CurveRange {
  const curve = new CurveRange();
  curve.mode = CurveRange.Mode.Constant;
  curve.constant = value;
  return curve;
}

function constantColor(value: Color): GradientRange {
  const gradient = new GradientRange();
  gradient.mode = GradientRange.Mode.Color;
  gradient.color = value;
  return gradient;
}

function cockpitMaterial(color: Color): Material | null {
  const parent = builtinResMgr.get<Material>('missing-material');
  if (!parent) return null;
  const material = new Material();
  material.copy(parent);
  material.setProperty('mainColor', color);
  return material;
}

function browserDataset(): DOMStringMap | undefined {
  if (sys.isNative || typeof document === 'undefined') return undefined;
  return document.body?.dataset;
}

function dispatchBrowserEvent(name: string, detail?: unknown): void {
  if (sys.isNative || typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
}

function readBrowserLoadout(): CombatLoadout | undefined {
  const dataset = browserDataset();
  if (!dataset) return undefined;
  const {
    loadoutShip,
    loadoutWeapon,
    loadoutSecondary,
    loadoutDevice,
    loadoutCore,
    loadoutEngine,
    loadoutShield,
    loadoutUtility,
    loadoutBoost,
    loadoutSkin,
  } = dataset;
  if (!loadoutWeapon || !loadoutDevice || !loadoutCore) return undefined;
  return {
    ship: loadoutShip,
    weapon: loadoutWeapon,
    device: loadoutDevice,
    core: loadoutCore,
    secondary: loadoutSecondary,
    engine: loadoutEngine,
    shield: loadoutShield,
    utility: loadoutUtility,
    boost: loadoutBoost,
    skin: loadoutSkin,
  } as CombatLoadout;
}

function prefersTouchControls(): boolean {
  if (sys.isNative) return sys.isMobile;
  return typeof window !== 'undefined' && (
    window.matchMedia('(pointer: coarse)').matches
    || window.navigator.maxTouchPoints > 0
    || (
      window.innerWidth <= 900
      && window.innerHeight <= 540
      && window.innerWidth > window.innerHeight
    )
  );
}

function requestedGraphicsTier(): GraphicsTier | undefined {
  const tier = browserDataset()?.graphicsTier;
  return tier === 'low' || tier === 'high' ? tier : undefined;
}

function benchmarkFrameMs(): number | null {
  const value = Number(browserDataset()?.graphicsBenchmarkFrameMs);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function runtimePlatform(): PlatformName | null {
  const candidate = (globalThis as unknown as {
    __SPACEFIGHT_PLATFORM__?: unknown;
  }).__SPACEFIGHT_PLATFORM__;
  return resolveRuntimePlatform(candidate, sys) || null;
}

function browserStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export class CombatBootstrap extends Component {
  private simulation = this.createSimulation();
  private snapshot: CombatSnapshot = this.simulation.step({}, 0);
  private shipPresenter: ShipPresenter | null = null;
  private projectilePresenter: ProjectilePresenter | null = null;
  private combatFeedbackPresenter: CombatFeedbackPresenter | null = null;
  /** 贴图视觉层：星空 / 火球 / 炮口火光 / 命中火花 */
  private combatVisuals: CombatVisuals | null = null;
  private lootPresenter: LootPresenter | null = null;
  private gameAudio: GameAudio | null = null;
  private worldStreamer: WorldStreamer | null = null;
  private cameraNode: Node | null = null;
  private cockpitInterior: Node | null = null;
  private speedParticles: ParticleSystem | null = null;
  private damageLight: SphereLight | null = null;
  private keyLight: DirectionalLight | null = null;
  private worldRoot: Node | null = null;
  private platform: PlatformBridge | null = null;
  private graphicsTier: GraphicsTier = 'high';
  private graphicsProfile: GraphicsProfile = GRAPHICS_PROFILES.high;
  /** 当前设备形态；网页端由 shell 连续派发，原生端首帧自行推断。 */
  private viewportFormFactor: DeviceFormFactor | null = null;
  private graphicsPrepared = false;
  private initialized = false;
  private pausedByLaunchGate = false;
  private inputRouter: InputRouter | null = null;
  private browserInput: BrowserInputBridge | null = null;
  private cocosInput: CocosInputBridge | null = null;
  private gamepadInput: GamepadFlightInput | null = null;
  /** 桌面输入源：需要每帧同步战斗阶段，供决策阶段按键复用。 */
  private desktopInput: DesktopFlightInput | null = null;
  private gamepadBridge: CocosGamepadBridge | null = null;
  private nativeHud: NativeCombatHud | null = null;
  private nativeInputSettings: InputSettings = { ...DEFAULT_INPUT_SETTINGS };
  private browserEventsAttached = false;
  private hudDispatchElapsed = 0;
  private pendingBrowserCombatEvents: CombatSnapshot['combatEvents'] = [];
  private togglePauseRequested = false;
  private dockedAtOutpost = false;
  /**
   * 返航闩锁：轻点一次「返航」即开始返航并持续到完成，不再要求一直按住。
   * 之前必须按住 2.4s 且挨打会重置进度，在碎石/敌机连续擦碰时进度被永久冻结，
   * 表现为「返航没反应、没有动画、进不了前哨」。主动开火/加速/推进下一波会取消返航。
   */
  private returnLatched = false;
  private currentMissionPreset: MissionPreset = readBrowserMissionPreset();
  private previousHealth = this.snapshot.player.health + this.snapshot.player.shield;
  private readonly touchOptimized = prefersTouchControls();

  // Reactive camera feel: recoil punch on firing, shake on impact damage.
  private recoilOffset = new Vec3();
  private recoilElapsed = 1;
  private recoilDuration = 1;
  private recoilDirection = new Vec3();
  private shakeOffset = new Vec3();
  private shakeElapsed = 1;
  private shakeDuration = 1;
  private shakeStrength = 0;
  private hitStopElapsed = 0;
  private hitStopRemaining = 0;
  /**
   * 玩家视觉宽限计时（毫秒）。战斗开始后用仿真时间累计；若玩家模型在宽限内仍未就绪，
   * 则退化为 fallback 机体继续推进，避免原生端模型加载失败/超时导致战斗被永久冻结。
   */
  private combatVisualWaitMs = 0;
  /** FOV 冲击（度）：开火 / 受击 / 击毁时短暂推近，给命中一点「顶」的感觉 */
  private fovPunch = 0;
  private lastCameraEventId = 0;
  private coopPresenceBuffer = new CoopPresenceBuffer();
  private coopSeq = 0;
  private coopStreamElapsed = 0;
  private coopRemote: CoopPresence | null = null;
  private coopSignalHandler: ((message: CoopMessage) => void) | null = null;
  private coopSession: WebCoopSession | null = null;
  /** 联机邀请码 / 应答码，供 HUD 显示与「复制邀请码」使用。 */
  private coopCode = '';
  /**
   * 联机入口桥：native 无 WebRTC，available 传 false，HUD 明确提示改用 Web 版；
   * web 端按钮直接复用已有的 spacefight:coop-command 事件通道。
   */
  private readonly coopBridge: CoopHudBridge = {
    available: !sys.isNative && typeof RTCPeerConnection !== 'undefined',
    host: () => this.sendCoopCommand({ action: 'host', room: 'tower-1', name: 'Host' }),
    join: () => {
      const invite = this.promptCoopCode('join');
      if (invite) this.sendCoopCommand({ action: 'join', invite });
    },
    accept: () => {
      const invite = this.promptCoopCode('accept');
      if (invite) this.sendCoopCommand({ action: 'accept', invite });
    },
    close: () => this.sendCoopCommand({ action: 'close' }),
    copyCode: () => {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(this.coopCode);
      }
    },
  };
  /** 前哨服务 / 返回主页 / 联机入口统一从这里接进 native HUD。 */
  private readonly hudActions: NativeHudActions = {
    onReturnHome: () => this.returnHome(),
    onStationService: (service) => this.applyStationService(service),
    coop: this.coopBridge,
  };

  protected onLoad(): void {
    console.info('[SpaceFight boot] scene loaded');
    this.initializePlatformRuntime();
    if (sys.isNative) {
      try {
        this.initializeCocosInput();
      } catch (error: unknown) {
        console.error('[SpaceFight boot] native input unavailable; startup will retry before combat', error);
        this.cocosInput = null;
        this.inputRouter = null;
      }
    } else {
      this.initializeBrowserRuntime();
    }
  }

  protected start(): void {
    console.info('[SpaceFight boot] combat bootstrap starting');
    if (!sys.isNative) this.initializeBrowserRuntime();
    void this.initialize().catch((error: unknown) => {
      console.error('SpaceFight combat initialization failed', error);
      this.nativeHud?.showBootError(error instanceof Error ? error.message : 'unknown error');
      dispatchBrowserEvent('spacefight:engine-error');
    });
  }

  private initializeBrowserRuntime(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const launchGate = document.getElementById('LaunchGate');
    if (!launchGate) {
      return;
    }
    this.pausedByLaunchGate = browserDataset()?.playing !== 'true';
    if (!this.browserEventsAttached) {
      window.addEventListener('spacefight:fullscreen-enter', this.handleFullscreenEnter);
      window.addEventListener('spacefight:fullscreen-exit', this.handleFullscreenExit);
      // 网页覆盖层的"离港"按钮触发，与游戏内离港逻辑统一走 leaveOutpost。
      window.addEventListener('spacefight:outpost-exit', this.handleOutpostExit);
      window.addEventListener('spacefight:toggle-pause', this.handleTogglePause);
      window.addEventListener('spacefight:loadout-change', this.handleLoadoutChange);
      window.addEventListener('spacefight:mission-change', this.handleMissionChange);
      window.addEventListener('spacefight:restart', this.handleRestart);
      window.addEventListener('spacefight:graphics-tier', this.handleGraphicsTier);
      window.addEventListener('spacefight:viewport-layout', this.handleViewportLayout);
      window.addEventListener('spacefight:input-settings', this.handleInputSettings);
      window.addEventListener('spacefight:gamepad-calibration', this.handleInputSettings);
      window.addEventListener('spacefight:graphics-advice-action', this.handleGraphicsAdviceAction);
      window.addEventListener('spacefight:coop-command', this.handleCoopCommand);
      // 会话状态/邀请码回灌到 HUD 联机面板（此前只有 command 监听，UI 入口完全缺失）。
      window.addEventListener('spacefight:coop-invite', this.handleCoopInvite);
      window.addEventListener('spacefight:coop-answer', this.handleCoopAnswer);
      window.addEventListener('spacefight:coop-connected', this.handleCoopConnected);
      window.addEventListener('spacefight:coop-state', this.handleCoopState);
      this.browserEventsAttached = true;
    }
    this.initializeBrowserInput();
  }

  protected update(deltaTime: number): void {
    this.cocosInput?.refreshInteractionState();
    // 暂停/恢复必须最先处理：任意覆盖面板打开时下面的闸门会直接 return，
    // 旧版把 togglePauseRequested 的消费放在 return 之后，导致暂停后「继续战斗」
    // 永远消费不到、仿真永不推进 —— 游戏彻底冻死。这里绕过闸门直接翻转仿真暂停。
    if (this.togglePauseRequested) {
      this.togglePauseRequested = false;
      if (this.initialized) {
        this.snapshot = this.simulation.setPaused(!this.snapshot.paused);
        this.dispatchCombatState(0, true);
      }
      return;
    }
    if (
      this.pausedByLaunchGate
      || browserDataset()?.orientationBlocked === 'true'
      || !this.initialized
      || !this.shipPresenter
      || this.nativeHud?.isLoadoutOpen()
    ) {
      return;
    }

    // 玩家视觉宽限：模型未在宽限内加载成功时，退化为 fallback 机体后继续推进。
    // 否则原生端一旦玩家模型加载失败/超时，仿真会被 isPlayerVisualReady 闸门永久冻住
    // （表现为「一点 Deploy 就定格、飞船和敌机都不动」）。
    const PLAYER_VISUAL_GRACE_MS = 5000;
    this.combatVisualWaitMs += deltaTime * 1000;
    if (!this.shipPresenter.isPlayerVisualReady()) {
      if (this.combatVisualWaitMs < PLAYER_VISUAL_GRACE_MS) {
        this.shipPresenter.sync(this.snapshot);
        return;
      }
      this.shipPresenter.ensureFallbackVisual();
    }

    const command = this.inputRouter?.consumeCommand() || neutralFlightCommand();
    // 返航闩锁：点一下即持续返航（不必一直按住，松手也不会中断）。
    // 主动开火 / 加速 / 推进下一波视为「不返航了」，取消闩锁，避免误锁死。
    if (command.returnRequested) this.returnLatched = true;
    if (command.primaryFire || command.boost || command.advanceRequested) this.returnLatched = false;
    command.returnRequested = command.returnRequested || this.returnLatched;
    if (command.returnRequested && this.snapshot.navigation.canDock) {
      this.enterOutpost();
      return;
    }
    // 命中停顿：命中 / 破盾 / 击毁的瞬间把模拟冻结一小会儿（deltaTime 传 0 即不推进）。
    // 之前 hitStopRemaining 只被递减、从未用于暂停 —— 「打到了」完全没有实感。
    const frozen = this.hitStopRemaining > 0;
    this.snapshot = this.simulation.step(command, frozen ? 0 : deltaTime);
    // 把当前阶段回灌给输入层：决策阶段里空格/Enter 才是"继续深入"，
    // 其他阶段保持纯射击语义，避免改动主武器手感。
    this.desktopInput?.setSnapshotPhase(this.snapshot.expedition.phase);
    // 已停靠时不要每帧重复入港：否则 serviceAtOutpost / 发券 / 事件会被反复触发。
    if (this.snapshot.mission.status === 'complete' && !this.dockedAtOutpost) {
      this.enterOutpost();
      return;
    }
    if (!sys.isNative && this.snapshot.combatEvents.length > 0) {
      this.pendingBrowserCombatEvents.push(...this.snapshot.combatEvents);
      this.pendingBrowserCombatEvents = this.pendingBrowserCombatEvents.slice(-24);
    }
    this.syncCoopNetwork(deltaTime);
    this.dispatchCombatFeedback(this.snapshot);
    this.triggerCameraFeel(this.snapshot, deltaTime);
    this.cocosInput?.refreshInteractionState();
    this.dispatchCombatState(deltaTime);
    this.shipPresenter.sync(this.snapshot);
    this.projectilePresenter?.sync(this.snapshot);
    this.combatFeedbackPresenter?.sync(this.snapshot);
    this.combatVisuals?.sync(this.snapshot, deltaTime);
    this.lootPresenter?.sync(this.snapshot, deltaTime);
    this.gameAudio?.sync(this.snapshot);
    this.worldStreamer?.update(this.shipPresenter.player.worldPosition, deltaTime);
    this.updateCamera(this.snapshot);
    this.updateDamageFeedback(this.snapshot);
    if (this.speedParticles) {
      this.speedParticles.rateOverTime.constant = command.boost
        ? this.graphicsBoostParticleRate()
        : this.graphicsParticleRate();
    }
  }

  protected onDestroy(): void {
    graphicsAdviceChannel.clear();
    this.cocosInput?.detach();
    this.cocosInput = null;
    this.gamepadBridge?.detach();
    this.gamepadBridge = null;
    this.gamepadInput = null;
    this.nativeHud?.destroy();
    this.nativeHud = null;
    this.gameAudio?.destroy();
    this.gameAudio = null;
    if (typeof window === 'undefined') {
      this.inputRouter = null;
      return;
    }
    window.removeEventListener('spacefight:fullscreen-enter', this.handleFullscreenEnter);
    window.removeEventListener('spacefight:fullscreen-exit', this.handleFullscreenExit);
    window.removeEventListener('spacefight:outpost-exit', this.handleOutpostExit);
    window.removeEventListener('spacefight:toggle-pause', this.handleTogglePause);
    window.removeEventListener('spacefight:loadout-change', this.handleLoadoutChange);
    window.removeEventListener('spacefight:mission-change', this.handleMissionChange);
    window.removeEventListener('spacefight:restart', this.handleRestart);
    window.removeEventListener('spacefight:graphics-tier', this.handleGraphicsTier);
    window.removeEventListener('spacefight:viewport-layout', this.handleViewportLayout);
    window.removeEventListener('spacefight:input-settings', this.handleInputSettings);
    window.removeEventListener('spacefight:gamepad-calibration', this.handleInputSettings);
    window.removeEventListener('spacefight:graphics-advice-action', this.handleGraphicsAdviceAction);
    window.removeEventListener('spacefight:coop-command', this.handleCoopCommand);
    window.removeEventListener('spacefight:coop-invite', this.handleCoopInvite);
    window.removeEventListener('spacefight:coop-answer', this.handleCoopAnswer);
    window.removeEventListener('spacefight:coop-connected', this.handleCoopConnected);
    window.removeEventListener('spacefight:coop-state', this.handleCoopState);
    this.coopSession?.close();
    this.coopSession = null;
    this.browserEventsAttached = false;
    this.browserInput?.detach();
    this.browserInput = null;
    this.inputRouter = null;
  }

  private readonly handleFullscreenEnter = (): void => {
    this.leaveOutpost();
    this.pausedByLaunchGate = false;
    void this.shipPresenter?.enableHighQuality(this.graphicsTier).catch((error: unknown) => {
      console.warn('SpaceFight high-quality models remain unavailable', error);
    });
  };

  private readonly handleFullscreenExit = (): void => {
    this.pausedByLaunchGate = true;
    this.inputRouter?.releaseAll();
  };

  // 网页覆盖层的"离港"按钮通过派发该事件触发，统一走 leaveOutpost，
  // 与游戏内 R 键离港共用同一套逻辑（含 pausedByLaunchGate 复位）。
  private readonly handleOutpostExit = (): void => {
    this.leaveOutpost();
  };

  private readonly handleTogglePause = (): void => {
    this.togglePauseRequested = true;
  };

  private readonly handleLoadoutChange = (event: Event): void => {
    if (browserDataset()?.playing === 'true') return;
    const loadout = (event as CustomEvent<CombatLoadout>).detail || readBrowserLoadout();
    this.shipPresenter?.setPlayerShipKind(resolveLoadout(loadout).ship);
    this.simulation = this.createSimulation(loadout);
    this.snapshot = this.simulation.step({}, 0);
    this.previousHealth = this.snapshot.player.health + this.snapshot.player.shield;
    this.dispatchCombatState(0, true);
  };

  private readonly handleMissionChange = (): void => {
    if (browserDataset()?.playing === 'true') return;
    this.resetSimulation(readBrowserLoadout(), readBrowserMissionPreset());
    this.dispatchCombatState(0, true);
  };

  private readonly applyNativeLoadout = (loadout: CombatLoadout): void => {
    this.resetSimulation(loadout, this.currentMissionPreset);
    if (this.dockedAtOutpost) this.snapshot = this.simulation.serviceAtOutpost();
    this.shipPresenter?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
  };

  private readonly applyNativeMission = (preset: MissionPreset): void => {
    this.currentMissionPreset = preset;
    // 不能传 undefined：原生端 readBrowserLoadout() 恒为 undefined，会把玩家
    // 自定义装配静默重置成默认配置。
    this.resetSimulation(this.snapshot.loadout, preset);
    this.shipPresenter?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
  };

  private readonly applyNativeEconomy = (): void => {
    this.resetSimulation(this.snapshot.loadout, this.currentMissionPreset);
    this.shipPresenter?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
  };

  /**
   * Cooperative matchmaking entry point driven by the web shell.
   *
   * The shell scans/renders QR codes; this scene only orchestrates the WebRTC
   * transport. Commands:
   *   void { action: 'host' }                      -> create a room, emit invite event
   *   void { action: 'join', invite }              -> consume scanned host invite, emit answer
   *   void { action: 'accept', invite }            -> host consumes guest answer
   *   void { action: 'close' }                     -> tear down the session
   * Events emitted:
   *   spacefight:coop-invite  { room, name, invite }
   *   spacefight:coop-answer  { invite }
   *   spacefight:coop-state   { state, detail? }
   */
  private readonly handleCoopCommand = async (event: Event): Promise<void> => {
    if (typeof window === 'undefined') return;
    const { action, invite, room, name } = (event as CustomEvent<{
      action: 'host' | 'join' | 'accept' | 'close';
      invite?: string;
      room?: string;
      name?: string;
    }>).detail || {};
    if (action === 'close') {
      this.coopSession?.close();
      this.coopSession = null;
      dispatchBrowserEvent('spacefight:coop-state', { state: 'idle' });
      return;
    }
    let session = this.coopSession;
    if (!session) {
      session = new WebCoopSession({
        onInvite: (payload) => dispatchBrowserEvent('spacefight:coop-invite', { session: payload }),
        onAnswer: (payload) => dispatchBrowserEvent('spacefight:coop-answer', { session: payload }),
        onConnected: () => dispatchBrowserEvent('spacefight:coop-connected', {}),
        onState: (state, detail) => dispatchBrowserEvent('spacefight:coop-state', { state, detail }),
      }, { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      this.coopSession = session;
    }
    try {
      if (action === 'host') {
        await session.host(room || 'tower-1', name || 'Host');
      } else if (action === 'join' && typeof invite === 'string') {
        await session.join(invite);
      } else if (action === 'accept' && typeof invite === 'string') {
        await session.acceptAnswer(invite);
      }
    } catch (error: unknown) {
      dispatchBrowserEvent('spacefight:coop-state', { state: 'error', detail: String(error) });
    }
  };

  /** HUD 联机按钮统一走已有的 DOM 事件通道，避免再写一套会话管理。 */
  private sendCoopCommand(detail: {
    action: 'host' | 'join' | 'accept' | 'close';
    invite?: string;
    room?: string;
    name?: string;
  }): void {
    if (typeof window === 'undefined') return;
    dispatchBrowserEvent('spacefight:coop-command', detail);
  }

  /** 扫码/粘贴由浏览器侧提供；native 无 WebRTC，按钮已禁用，不会走到这里。 */
  private promptCoopCode(kind: 'join' | 'accept'): string | null {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
    const value = window.prompt(kind === 'join' ? '粘贴主机邀请码' : '粘贴客机应答码');
    return value && value.trim() ? value.trim() : null;
  }

  private readonly handleCoopInvite = (event: Event): void => {
    this.coopCode = String((event as CustomEvent<{ session?: string }>).detail?.session || '');
    this.nativeHud?.setCoopState('hosting', undefined, this.coopCode);
  };

  private readonly handleCoopAnswer = (event: Event): void => {
    this.coopCode = String((event as CustomEvent<{ session?: string }>).detail?.session || '');
    this.nativeHud?.setCoopState('joining', undefined, this.coopCode);
  };

  private readonly handleCoopConnected = (): void => {
    this.nativeHud?.setCoopState('connected', undefined, this.coopCode);
  };

  private readonly handleCoopState = (event: Event): void => {
    const detail = (event as CustomEvent<{ state?: string; detail?: string }>).detail || {};
    this.nativeHud?.setCoopState(
      (detail.state as CoopHudState) || 'idle',
      detail.detail,
      this.coopCode,
    );
  };

  /** 前哨站内服务：返航不再自动回满三量，玩家花星港券决定修哪一项。 */
  private readonly applyStationService = (service: StationServiceId): void => {
    if (!this.dockedAtOutpost) return;
    this.snapshot = this.simulation.serviceStation(service as OutpostService);
    this.gameAudio?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
    this.dispatchCombatState(0, true);
  };

  /** 站内「返回主页」：保持停靠态，主页点「进入战场」时再走 leaveOutpost 离港。 */
  private readonly returnHome = (): void => {
    this.nativeHud?.showPreflight();
  };

  /** 站内 3D 已经建好但相机从不切过去；这里按实际节点世界坐标切机位。 */
  private focusOutpostInterior(): void {
    if (!this.cameraNode) return;
    const interior = this.worldRoot
      ? this.findNodeByName(this.worldRoot, 'StationInterior', 7)
      : null;
    const target = interior
      ? interior.worldPosition
      : new Vec3(PRIMARY_OUTPOST_POSITION.x, PRIMARY_OUTPOST_POSITION.y, PRIMARY_OUTPOST_POSITION.z);
    this.cameraNode.setWorldPosition(new Vec3(target.x, target.y + 1.6, target.z + 10.5));
    this.cameraNode.lookAt(new Vec3(target.x, target.y - 0.2, target.z - 2.5));
    const camera = this.cameraNode.getComponent(Camera);
    if (camera) camera.fov = 64;
  }

  private findNodeByName(root: Node, name: string, depth: number): Node | null {
    if (depth <= 0) return null;
    for (const child of root.children) {
      if (child.name === name) return child;
      const nested = this.findNodeByName(child, name, depth - 1);
      if (nested) return nested;
    }
    return null;
  }

  private resetSimulation(loadout = readBrowserLoadout(), preset = readBrowserMissionPreset()): void {
    this.shipPresenter?.setPlayerShipKind(resolveLoadout(loadout).ship);
    this.simulation = this.createSimulation(loadout, preset);
    this.snapshot = this.simulation.step({}, 0);
    this.previousHealth = this.snapshot.player.health + this.snapshot.player.shield;
    this.inputRouter?.releaseAll();
    this.projectilePresenter?.recycleAll();
    this.combatFeedbackPresenter?.recycleAll();
    this.combatVisuals?.recycleAll();
    this.lootPresenter?.recycleAll();
    this.pendingBrowserCombatEvents = [];
  }

  private enterOutpost(): void {
    // 幂等：status 在停靠期间仍是 complete，旧版每帧重跑结算/发券/事件。
    if (this.dockedAtOutpost) return;
    this.returnLatched = false;
    this.inputRouter?.releaseAll();
    this.projectilePresenter?.recycleAll();
    this.combatFeedbackPresenter?.recycleAll();
    this.combatVisuals?.recycleAll();
    this.pendingBrowserCombatEvents = [];
    this.dockedAtOutpost = true;
    this.snapshot = this.simulation.serviceAtOutpost();
    awardStarportTickets(
      this.snapshot.navigation.securedCargoValue,
      `${this.snapshot.mission.id}:${this.snapshot.tick}:${this.snapshot.player.score}`,
    );
    this.gameAudio?.sync(this.snapshot);
    this.lootPresenter?.sync(this.snapshot, 0);
    this.shipPresenter?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
    // 站内 3D 场景早已建好，相机必须真正切过去，否则「返航进站」只是换了一张 2D 结算图。
    this.focusOutpostInterior();
    if (sys.isNative) {
      this.nativeHud?.enterOutpost();
      this.cocosInput?.refreshInteractionState();
      return;
    }
    this.pausedByLaunchGate = true;
    dispatchBrowserEvent('spacefight:outpost-entered', {
      cargo: { ...this.snapshot.cargo },
      mission: { ...this.snapshot.mission },
      player: { ...this.snapshot.player },
      navigation: { ...this.snapshot.navigation },
    });
  }

  private readonly leaveOutpost = (): void => {
    // 战斗（含从主页/机库部署）开始即重置玩家视觉宽限计时，
    // 让宽限从"这一局"起算，而非沿用上一局的累计值。
    this.combatVisualWaitMs = 0;
    this.returnLatched = false;
    // 从暂停面板回主页再部署时，dockedAtOutpost 为 false 会在下面直接 return；
    // 必须先把仿真暂停解掉，否则新一局开场就是静止战场。
    if (this.snapshot.paused) this.simulation.setPaused(false);
    if (!this.dockedAtOutpost) {
      this.updateCamera(this.snapshot);
      return;
    }
    this.dockedAtOutpost = false;
    // 离港必须解除启动闸门，否则战斗主循环会一直停在暂停分支，
    // 玩家"离港"后游戏仍冻结 —— 表现为进哨站后无法离开太空。
    this.pausedByLaunchGate = false;
    this.snapshot = this.simulation.departOutpost();
    this.previousHealth = this.snapshot.player.health + this.snapshot.player.shield;
    this.inputRouter?.releaseAll();
    this.projectilePresenter?.recycleAll();
    this.combatFeedbackPresenter?.recycleAll();
    this.combatVisuals?.recycleAll();
    this.shipPresenter?.sync(this.snapshot);
    this.nativeHud?.syncCombat(this.snapshot);
    this.dispatchCombatState(0, true);
  };

  private readonly handleRestart = (): void => {
    this.dockedAtOutpost = false;
    this.returnLatched = false;
    // 重新出击必须沿用玩家当前所选任务与装配：旧版 createSimulation() 走默认参数，
    // 原生端恒回落到 salvage + 默认装配，主页却仍显示旧任务名。
    this.simulation = this.createSimulation(this.snapshot.loadout, this.currentMissionPreset);
    this.snapshot = this.simulation.step({}, 0);
    this.previousHealth = this.snapshot.player.health + this.snapshot.player.shield;
    this.inputRouter?.releaseAll();
    this.projectilePresenter?.recycleAll();
    this.combatFeedbackPresenter?.recycleAll();
    this.combatVisuals?.recycleAll();
    this.shipPresenter?.sync(this.snapshot);
    this.dispatchCombatState(0, true);
  };

  private readonly handleGraphicsTier = (event: Event): void => {
    const tier = (event as CustomEvent<{ tier?: unknown }>).detail?.tier;
    if (tier === 'low' || tier === 'high') {
      this.applyGraphicsTier(tier);
    }
  };

  /** 折叠/展开、跨屏拖拽会连续改变可视宽高比，形态需要跟着更新。 */
  private readonly handleViewportLayout = (event: Event): void => {
    const formFactor = (event as CustomEvent<{ formFactor?: unknown }>).detail?.formFactor;
    if (typeof formFactor === 'string') {
      this.viewportFormFactor = formFactor as DeviceFormFactor;
    }
  };

  private detectNativeFormFactor(): DeviceFormFactor | null {
    if (!sys.isNative) return null;
    const size = view.getVisibleSize();
    if (!size || size.width <= 0 || size.height <= 0) return null;
    return resolveViewportLayout({ width: size.width, height: size.height }).formFactor;
  }

  private readonly handleInputSettings = (): void => {
    if (sys.isNative) return;
    this.browserInput?.detach();
    this.browserInput = null;
    this.gamepadBridge?.detach();
    this.gamepadBridge = null;
    this.gamepadInput = null;
    this.inputRouter = null;
    this.initializeBrowserInput();
  };

  private readonly applyNativeInputSettings = (settings: InputSettings): void => {
    if (!sys.isNative) return;
    this.nativeInputSettings = saveInputSettings(sys.localStorage, settings);
    this.cocosInput?.detach();
    this.gamepadBridge?.detach();
    this.cocosInput = null;
    this.gamepadBridge = null;
    this.gamepadInput = null;
    this.inputRouter = null;
    this.initializeCocosInput();
    (this.cocosInput as CocosInputBridge | null)?.setFeedback(this.nativeHud || undefined);
  };

  private readonly handleGraphicsAdviceAction = (event: Event): void => {
    const action = (event as CustomEvent<{ action?: GraphicsAdviceAction }>).detail?.action;
    if (action === 'switch-now' || action === 'not-now' || action === 'never') {
      void graphicsAdviceChannel.perform(action).catch((error: unknown) => {
        console.error('SpaceFight graphics advice action failed', error);
      });
    }
  };

  private readonly applyAdvisedGraphicsTier = (tier: GraphicsTier): void => {
    this.applyGraphicsTier(tier);
  };

  private createSimulation(
    loadout = readBrowserLoadout(),
    preset: MissionPreset = readBrowserMissionPreset(),
  ): CombatSimulation {
    const mission = MISSION_PRESETS[preset];
    const economy = loadEconomy();
    return new CombatSimulation({
      mission,
      seed: mission.seed,
      loadout,
      cargoCapacityBonus: economy.cargoExpansion * 2,
      pickupRadiusBonus: economy.tractorCalibration * 2,
      shieldCapacityBonus: economy.shieldExpansion * 6,
      // 站内维修/补给/改装与商城共用同一份星港券，不再走仿真内置假余额。
      economy: {
        getTickets: () => loadEconomy().starportTickets,
        spendTickets: (amount, receipt) => spendStarportTickets(amount, receipt).ok,
      },
    });
  }

  public applyGraphicsTier(tier: GraphicsTier): void {
    this.graphicsTier = tier;
    this.graphicsProfile = GRAPHICS_PROFILES[tier];
    game.frameRate = this.graphicsProfile.targetFps;
    const renderScale = resolveRenderScale(this.graphicsProfile);
    const pipeline = director.root?.pipeline;
    if (pipeline) {
      pipeline.shadingScale = renderScale;
    }
    if (this.keyLight) {
      const shadowsEnabled = !sys.isBrowser && this.graphicsProfile.shadows;
      this.keyLight.shadowEnabled = shadowsEnabled;
      this.keyLight.enableCSM = shadowsEnabled;
    }
    if (this.speedParticles) {
      this.speedParticles.capacity = this.graphicsProfile.particleCapacity;
      this.speedParticles.rateOverTime.constant = this.graphicsParticleRate();
    }
    // 降档时复位高模 flag 与敌机预算；切档前显式释放 WorldStreamer 自建网格/材质。
    if (tier === 'low') this.shipPresenter?.disableHighQuality();
    if (this.initialized && this.worldRoot) {
      this.worldStreamer?.dispose();
      const staleWorldChunks = [...this.worldRoot.children];
      this.worldRoot.removeAllChildren();
      for (const chunk of staleWorldChunks) {
        chunk.destroy();
      }
      this.worldStreamer = new WorldStreamer(
        this.worldRoot,
        createWorldStreamProfile(this.graphicsProfile),
      );
      if (this.shipPresenter) {
        this.worldStreamer.update(this.shipPresenter.player.worldPosition);
      }
    }
  }

  private initializePlatformRuntime(): void {
    if (this.platform) return;
    this.platform = bootstrapPlatformBridge({
      platform: runtimePlatform() || undefined,
      storage: browserStorage(),
    });
  }

  private async prepareGraphicsProfile(): Promise<void> {
    if (this.graphicsPrepared) return;
    this.initializePlatformRuntime();
    const platform = this.platform;
    if (!platform) return;
    const [promptPreference, device] = await Promise.race([
      Promise.all([
        platform.readText(GRAPHICS_PROMPT_PREFERENCE_KEY),
        platform.deviceSnapshot(),
      ]),
      new Promise<[string | null, DeviceSnapshot]>((resolve) => {
        setTimeout(() => resolve([null, UNKNOWN_DEVICE]), CAPABILITY_TIMEOUT_MS);
      }),
    ]);
    const input: CapabilityInput = {
      platform: runtimePlatform() || platform.platform,
      memoryGB: device.memoryGB,
      availableMemoryGB: device.availableMemoryGB,
      lowRamDevice: device.lowRamDevice,
      emulator: device.emulator,
      benchmarkFrameMs: benchmarkFrameMs(),
      promptPreference: promptPreference === 'never' ? 'never' : 'ask',
      requestedTier: requestedGraphicsTier(),
      formFactor: (this.viewportFormFactor ?? this.detectNativeFormFactor()) ?? undefined,
    };
    const decision = resolveGraphicsDecision(input);
    this.graphicsTier = decision.tier;
    this.graphicsProfile = GRAPHICS_PROFILES[decision.tier];
    console.info('[SpaceFight performance]', JSON.stringify({
      tier: decision.tier,
      reason: decision.reason,
      formFactor: input.formFactor ?? null,
      memoryGB: device.memoryGB,
      availableMemoryGB: device.availableMemoryGB,
      lowRamDevice: device.lowRamDevice,
      emulator: device.emulator,
    }));
    this.graphicsPrepared = true;
    graphicsAdviceChannel.setPromptSuppressed(promptPreference === 'never');
    const advicePublished = graphicsAdviceChannel.publish(decision, {
      simulationState: () => this.graphicsSimulationState(),
      applyTier: this.applyAdvisedGraphicsTier,
      persistNever: async () => {
        await platform.writeText(GRAPHICS_PROMPT_PREFERENCE_KEY, 'never');
      },
    });
    if (advicePublished) {
      dispatchBrowserEvent('spacefight:graphics-advice', graphicsAdviceChannel.current());
    }
  }

  private graphicsParticleRate(): number {
    return this.graphicsTier === 'low' ? 24 : 38;
  }

  private graphicsBoostParticleRate(): number {
    return this.graphicsTier === 'low' ? 54 : 86;
  }

  private graphicsSimulationState(): GraphicsSimulationState {
    if (browserDataset()?.playing === 'true') {
      return 'playing';
    }
    return this.initialized && !this.pausedByLaunchGate ? 'playing' : 'pre-combat';
  }

  private initializeBrowserInput(): void {
    if (this.browserInput || this.inputRouter) {
      return;
    }
    const canvas = document.getElementById('GameCanvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }
    const settings = typeof localStorage === 'undefined'
      ? DEFAULT_INPUT_SETTINGS
      : loadInputSettings(localStorage);
    let calibration = DEFAULT_GAMEPAD_CALIBRATION;
    try {
      calibration = typeof localStorage === 'undefined'
        ? DEFAULT_GAMEPAD_CALIBRATION
        : normalizeGamepadCalibration(JSON.parse(localStorage.getItem(GAMEPAD_CALIBRATION_KEY) || '{}'));
    } catch (_) {}
    const desktop = new DesktopFlightInput(settings);
    this.desktopInput = desktop;
    const touch = new TouchFlightInput({
      width: window.innerWidth,
      height: window.innerHeight,
    }, settings);
    this.gamepadInput = new GamepadFlightInput(settings, calibration);
    this.inputRouter = new InputRouter(desktop, touch, this.gamepadInput);
    this.browserInput = new BrowserInputBridge(this.inputRouter, desktop, touch, settings);
    this.browserInput.attach(canvas);
    this.gamepadBridge = new CocosGamepadBridge(this.gamepadInput);
    this.gamepadBridge.attach();
  }

  private initializeCocosInput(): void {
    if (!sys.isNative || this.cocosInput || this.inputRouter) return;
    const scene = this.node.scene;
    if (!scene) return;
    const size = view.getVisibleSize();
    const settings = loadInputSettings(sys.localStorage);
    this.nativeInputSettings = settings;
    const desktop = new DesktopFlightInput(settings);
    this.desktopInput = desktop;
    const touch = new TouchFlightInput({
      width: size.width,
      height: size.height,
      safeLeft: NATIVE_SAFE_INSETS.left,
      safeRight: NATIVE_SAFE_INSETS.right,
      safeTop: NATIVE_SAFE_INSETS.top,
      safeBottom: NATIVE_SAFE_INSETS.bottom,
    }, settings);
    this.gamepadInput = new GamepadFlightInput(settings, DEFAULT_GAMEPAD_CALIBRATION);
    this.inputRouter = new InputRouter(desktop, touch, this.gamepadInput);
    this.cocosInput = new CocosInputBridge(
      this.inputRouter,
      desktop,
      touch,
      settings,
      undefined,
      () => {
        void this.platform?.haptic('ui-light');
      },
    );
    this.cocosInput.attach(sys.isMobile ? 'touch' : 'desktop');
    this.gamepadBridge = new CocosGamepadBridge(this.gamepadInput);
    this.gamepadBridge.attach();
  }

  private initializeNativeHud(scene: Node): void {
    if (!sys.isNative || this.nativeHud) return;
    try {
      this.nativeHud = new NativeCombatHud(
        scene,
        sys.isMobile,
        this.applyNativeLoadout,
        this.applyNativeMission,
        this.handleRestart,
        this.nativeInputSettings,
        this.applyNativeInputSettings,
        this.leaveOutpost,
        this.applyNativeEconomy,
        () => this.gameAudio?.ui(),
        this.handleTogglePause,
        this.hudActions,
      );
      this.cocosInput?.setFeedback(this.nativeHud);
      this.nativeHud.syncCombat(this.snapshot);
      console.info('[SpaceFight boot] native HUD ready');
    } catch (error: unknown) {
      console.error('[SpaceFight boot] native HUD unavailable; combat remains playable', error);
    }
  }

  private async initialize(): Promise<void> {
    const scene = this.node.scene;
    if (!scene) {
      throw new Error('Combat scene root is unavailable');
    }
    this.initializeNativeHud(scene);
    this.nativeHud?.showBootState('正在建立战斗系统', 0.42);
    if (sys.isNative && (!this.cocosInput || !this.inputRouter)) {
      this.initializeCocosInput();
      if (!this.cocosInput || !this.inputRouter) {
        throw new Error('Native combat input could not be initialized');
      }
      if (this.nativeHud) this.cocosInput.setFeedback(this.nativeHud);
    }

    console.info('[SpaceFight boot] preparing graphics');
    await this.prepareGraphicsProfile();

    const cameraNode = scene.getChildByName('CombatCamera');
    const keyLightNode = scene.getChildByName('KeyLight');
    const camera = cameraNode?.getComponent(Camera);
    const keyLight = keyLightNode?.getComponent(DirectionalLight);
    if (!cameraNode || !camera || !keyLight) {
      throw new Error('Combat scene requires a real camera and directional light');
    }
    this.cameraNode = cameraNode;
    this.keyLight = keyLight;
    camera.fov = 62;
    camera.near = 0.08;
    camera.far = 2400;
    // 清屏色从近纯黑 rgb(3,7,11) 抬成深空蓝：之前「飞出去一片死黑」、画面没有层次，
    // 是「没观感」的直接原因。只抬背景底色，不改任何模型/玩法。
    camera.clearColor = new Color(14, 23, 38, 255);
    keyLight.illuminance = 52000;
    keyLight.shadowEnabled = !sys.isBrowser && !this.touchOptimized;
    keyLight.shadowDistance = 180;
    keyLight.enableCSM = !sys.isBrowser && !this.touchOptimized;
    // 提亮环境光：此前场景 _skyIllum 仅 8500，暗部全死黑，战机/敌机/建筑看不清（用户「没观感」主因）。
    // 抬高 ambient 给所有材质一层基础亮度，不改变造型，只让画面「能看清、有层次」。
    try {
      const globals = scene.globals;
      if (globals?.ambient) {
        globals.ambient.skyIllum = 26000;
        globals.ambient.groundAlbedo = new Color(48, 60, 78, 255);
      }
    } catch (error: unknown) {
      console.warn('[SpaceFight] ambient lift skipped', error);
    }
    this.applyGraphicsTier(this.graphicsTier);
    this.cockpitInterior = this.createCockpitInterior(cameraNode);

    const combatRoot = new Node('CombatRuntime');
    combatRoot.setParent(scene);
    const shipRoot = new Node('Ships');
    const projectileRoot = new Node('Projectiles');
    const feedbackRoot = new Node('CombatFeedback');
    const lootRoot = new Node('LootAndCargo');
    const worldRoot = new Node('WorldChunks');
    shipRoot.setParent(combatRoot);
    projectileRoot.setParent(combatRoot);
    feedbackRoot.setParent(combatRoot);
    lootRoot.setParent(combatRoot);
    worldRoot.setParent(combatRoot);
    this.worldRoot = worldRoot;

    console.info('[SpaceFight boot] loading essential ships');
    this.shipPresenter = new ShipPresenter(shipRoot, this.graphicsProfile.maxVisibleEnemies);
    this.shipPresenter.setPlayerShipKind(resolveLoadout(readBrowserLoadout()).ship);
    const player = this.shipPresenter.initialize();
    // 让尾焰辉光每帧朝向相机（与 CombatVisuals 共用同一 CombatCamera 节点）。
    this.shipPresenter.setCamera(this.cameraNode);
    this.shipPresenter.sync(this.snapshot);
    this.updateCamera(this.snapshot);
    this.initializeOptionalProjectiles(projectileRoot);
    this.initializeOptionalCombatFeedback(feedbackRoot);
    this.initializeOptionalCombatVisuals(feedbackRoot, this.cameraNode);
    this.lootPresenter = new LootPresenter(lootRoot);
    this.gameAudio = new GameAudio(combatRoot);
    this.gameAudio.sync(this.snapshot);
    this.initializeOptionalEffects(combatRoot, player);

    this.nativeHud?.showBootState('正在装载战机与敌机', 0.78);
    const visualMode = await this.shipPresenter.ensurePlayerVisual();
    console.info(`[SpaceFight boot] combat visual mode: ${visualMode}`);
    this.shipPresenter.applyPlayerSkin(readBrowserLoadout()?.skin);

    this.shipPresenter.sync(this.snapshot);
    this.initialized = true;
    void this.shipPresenter.loadInitialEnemyVisuals(this.snapshot).catch((error: unknown) => {
      console.error('[SpaceFight boot] initial enemy visuals are still loading', error);
    });
    this.dispatchCombatState(0, true);
    this.nativeHud?.showPreflight();
    this.cocosInput?.refreshInteractionState();
    dismissNativeLaunchScreen(runtimePlatform());
    console.info('[SpaceFight boot] combat presentation ready');
    dispatchBrowserEvent('spacefight:engine-ready');
    this.scheduleOnce(
      () => this.initializeOptionalWorld(worldRoot, player),
      this.graphicsTier === 'low' ? 0.8 : 0,
    );
  }

  private initializeOptionalWorld(worldRoot: Node, player: Node): void {
    try {
      this.worldStreamer = new WorldStreamer(
        worldRoot,
        createWorldStreamProfile(this.graphicsProfile),
      );
      this.worldStreamer.update(player.worldPosition);
      console.info('[SpaceFight boot] world rendering ready');
    } catch (error: unknown) {
      this.worldStreamer = null;
      console.error('[SpaceFight boot] world rendering unavailable; combat remains playable', error);
    }
  }

  private initializeOptionalProjectiles(projectileRoot: Node): void {
    try {
      this.projectilePresenter = new ProjectilePresenter(projectileRoot, {
        poolSize: this.graphicsProfile.projectilePoolSize,
        trails: this.graphicsProfile.projectileTrails,
        physics: this.graphicsTier === 'high',
      });
      console.info('[SpaceFight boot] projectile rendering ready');
    } catch (error: unknown) {
      this.projectilePresenter = null;
      console.error('[SpaceFight boot] projectile rendering unavailable; combat remains playable', error);
    }
  }

  private initializeOptionalCombatFeedback(feedbackRoot: Node): void {
    try {
      this.combatFeedbackPresenter = new CombatFeedbackPresenter(
        feedbackRoot,
        this.graphicsProfile.feedbackPoolSize,
        this.graphicsProfile.feedbackLights,
      );
      console.info('[SpaceFight boot] combat feedback rendering ready');
    } catch (error: unknown) {
      this.combatFeedbackPresenter = null;
      console.error('[SpaceFight boot] combat feedback rendering unavailable', error);
    }
  }

  /**
   * 贴图视觉层：星空背景 + 火球爆炸 + 炮口火光 + 命中火花。
   * 任何一步失败都只是「少一层特效」，绝不能影响战斗本身。
   */
  private initializeOptionalCombatVisuals(visualsRoot: Node, camera: Node): void {
    try {
      this.combatVisuals = new CombatVisuals(visualsRoot);
      this.combatVisuals.loadTextures();
      this.combatVisuals.attachStarfield(camera);
      console.info('[SpaceFight boot] combat visuals ready');
    } catch (error: unknown) {
      this.combatVisuals = null;
      console.error('[SpaceFight boot] combat visuals unavailable', error);
    }
  }

  private initializeOptionalEffects(combatRoot: Node, player: Node): void {
    try {
      if (this.graphicsTier === 'high') {
        this.createFillLight(combatRoot);
        this.createDamageFeedback(player);
        if (!sys.isBrowser) this.createSpeedParticles(player);
      }
    } catch (error: unknown) {
      console.warn('[SpaceFight boot] optional combat effects disabled', error);
    }
  }

  private dispatchCombatState(deltaTime: number, force = false): void {
    // 原生端 HUD 必须按帧刷新：此前 native 在这里直接 return，HUD 只在少数事件点
    // （换装/换任务/进出前哨）同步，导致返航进度环、前哨距离、血条等完全不实时 →
    // 表现为「返航没有动画」「不知道离前哨多远、进不去」。这里给原生端补上按帧同步。
    if (sys.isNative) {
      this.hudDispatchElapsed += deltaTime;
      if (!force && this.hudDispatchElapsed < 0.05) {
        return;
      }
      this.hudDispatchElapsed = 0;
      this.nativeHud?.syncCombat(this.snapshot);
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    this.hudDispatchElapsed += deltaTime;
    if (!force && this.hudDispatchElapsed < 0.08) {
      return;
    }
    this.hudDispatchElapsed = 0;
    dispatchBrowserEvent('spacefight:combat-state', {
      tick: this.snapshot.tick,
      health: this.snapshot.player.health,
      shield: this.snapshot.player.shield,
      energy: this.snapshot.player.energy,
      maxHealth: this.snapshot.player.maxHealth,
      maxShield: this.snapshot.player.maxShield,
      maxEnergy: this.snapshot.player.maxEnergy,
      weapon: this.snapshot.loadout.weapon,
      kills: this.snapshot.mission.kills,
      requiredKills: this.snapshot.mission.requiredKills,
      paused: this.snapshot.paused,
      cameraMode: this.snapshot.cameraMode,
      missionStatus: this.snapshot.mission.status,
      aimDistance: Math.hypot(
        this.snapshot.aimPoint.x - this.snapshot.player.position.x,
        this.snapshot.aimPoint.y - this.snapshot.player.position.y,
        this.snapshot.aimPoint.z - this.snapshot.player.position.z,
      ),
      aimPoint: { ...this.snapshot.aimPoint },
      wave: this.snapshot.mission.wave,
      sector: this.snapshot.mission.sector,
      sectorName: this.snapshot.mission.sectorName,
      eventName: this.snapshot.mission.eventName,
      expedition: { ...this.snapshot.expedition },
      cargo: { ...this.snapshot.cargo },
      navigation: { ...this.snapshot.navigation },
      dockedAtOutpost: this.dockedAtOutpost,
      spawnProtection: this.snapshot.player.spawnProtection,
      target: this.snapshot.target ? { ...this.snapshot.target } : null,
      combatEvents: this.pendingBrowserCombatEvents.map((event) => ({ ...event })),
      coop: this.coopRemote ? { ...this.coopRemote } : null,
    });
    this.pendingBrowserCombatEvents = [];
  }

  private createFillLight(parent: Node): void {
    const fillNode = new Node('EnvironmentFillLight');
    fillNode.setParent(parent);
    fillNode.setPosition(-8, 5, 6);
    const fill = fillNode.addComponent(SphereLight);
    fill.color = new Color(66, 154, 194, 255);
    fill.luminance = 1500;
    fill.range = 42;
    fill.size = 2.2;
  }

  private createDamageFeedback(player: Node): void {
    const feedbackNode = new Node('DamageFeedback');
    feedbackNode.setParent(player);
    const light = feedbackNode.addComponent(SphereLight);
    light.color = new Color(255, 38, 32, 255);
    light.range = 8;
    light.size = 0.2;
    light.luminance = 0;
    this.damageLight = light;
  }

  private createSpeedParticles(player: Node): void {
    const particleNode = new Node('SpeedParticles');
    particleNode.setParent(player);
    particleNode.setPosition(0, 0, 2.8);
    particleNode.setRotationFromEuler(0, 180, 0);
    const particles = particleNode.addComponent(ParticleSystem);
    particles.capacity = this.touchOptimized ? 72 : 160;
    particles.capacity = this.graphicsProfile.particleCapacity;
    particles.duration = 2;
    particles.loop = true;
    particles.playOnAwake = true;
    particles.startLifetime = constantCurve(0.55);
    particles.startSpeed = constantCurve(18);
    particles.startSizeX = constantCurve(0.035);
    particles.startSizeY = constantCurve(0.035);
    particles.startSizeZ = constantCurve(1.1);
    particles.startColor = constantColor(new Color(91, 211, 255, 170));
    particles.rateOverTime = constantCurve(this.touchOptimized ? 24 : 38);
    particles.rateOverTime.constant = this.graphicsParticleRate();
    particles.play();
    this.speedParticles = particles;
  }

  private createCockpitInterior(camera: Node): Node {
    const interior = new Node('CockpitInterior');
    interior.setParent(camera);
    const frame = cockpitMaterial(new Color(24, 34, 40, 255));
    const trim = cockpitMaterial(new Color(91, 108, 116, 255));
    const recess = cockpitMaterial(new Color(9, 17, 22, 255));
    const display = cockpitMaterial(new Color(32, 174, 196, 255));
    const displayDim = cockpitMaterial(new Color(20, 76, 86, 255));
    const warning = cockpitMaterial(new Color(232, 132, 37, 255));
    const part = (
      name: string,
      position: Vec3,
      size: Vec3,
      material: Material | null,
      rotation?: Vec3,
    ): void => {
      const node = new Node(name);
      node.setParent(interior);
      node.setPosition(position);
      if (rotation) node.setRotationFromEuler(rotation.x, rotation.y, rotation.z);
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = utils.createMesh(primitives.box({
        width: size.x,
        height: size.y,
        length: size.z,
      }));
      if (material) renderer.setMaterial(material, 0);
    };
    const cylinderPart = (
      name: string,
      position: Vec3,
      radius: number,
      height: number,
      material: Material | null,
      rotation?: Vec3,
    ): void => {
      const node = new Node(name);
      node.setParent(interior);
      node.setPosition(position);
      if (rotation) node.setRotationFromEuler(rotation.x, rotation.y, rotation.z);
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = utils.createMesh(primitives.cylinder(radius, radius, height, { radialSegments: 10 }));
      if (material) renderer.setMaterial(material, 0);
    };

    // Keep the central sight picture clear while the structure wraps the lower and outer view.
    part('Cockpit.Dashboard', new Vec3(0, -0.54, -1.02), new Vec3(1.64, 0.16, 0.54), frame, new Vec3(-8, 0, 0));
    part('Cockpit.Dashboard.Brow', new Vec3(0, -0.34, -1.21), new Vec3(0.68, 0.08, 0.15), trim, new Vec3(-15, 0, 0));
    part('Cockpit.Display.Center.Bezel', new Vec3(0, -0.4, -1.25), new Vec3(0.53, 0.055, 0.2), recess, new Vec3(-16, 0, 0));
    part('Cockpit.Display.Center', new Vec3(0, -0.368, -1.265), new Vec3(0.44, 0.018, 0.145), display, new Vec3(-16, 0, 0));
    part('Cockpit.Console.Left', new Vec3(-0.62, -0.48, -0.9), new Vec3(0.48, 0.16, 0.62), frame, new Vec3(-5, 12, -7));
    part('Cockpit.Console.Right', new Vec3(0.62, -0.48, -0.9), new Vec3(0.48, 0.16, 0.62), frame, new Vec3(-5, -12, 7));
    part('Cockpit.Display.Left.Bezel', new Vec3(-0.52, -0.415, -1.18), new Vec3(0.32, 0.05, 0.18), recess, new Vec3(-14, 12, 0));
    part('Cockpit.Display.Right.Bezel', new Vec3(0.52, -0.415, -1.18), new Vec3(0.32, 0.05, 0.18), recess, new Vec3(-14, -12, 0));
    part('Cockpit.Display.Left', new Vec3(-0.52, -0.382, -1.2), new Vec3(0.25, 0.016, 0.12), displayDim, new Vec3(-14, 12, 0));
    part('Cockpit.Display.Right', new Vec3(0.52, -0.382, -1.2), new Vec3(0.25, 0.016, 0.12), display, new Vec3(-14, -12, 0));
    part('Cockpit.Throttle.Rail', new Vec3(-0.72, -0.34, -0.77), new Vec3(0.08, 0.05, 0.38), warning, new Vec3(-12, 0, 0));
    part('Cockpit.Throttle.Handle', new Vec3(-0.72, -0.25, -0.82), new Vec3(0.13, 0.17, 0.1), frame, new Vec3(-12, 0, 0));
    for (let index = 0; index < 4; index += 1) {
      const offset = (index - 1.5) * 0.105;
      part(`Cockpit.Button.Left.${index + 1}`, new Vec3(-0.54 + offset, -0.31, -1.03), new Vec3(0.055, 0.028, 0.055), index === 0 ? warning : display);
      part(`Cockpit.Button.Right.${index + 1}`, new Vec3(0.54 + offset, -0.31, -1.03), new Vec3(0.055, 0.028, 0.055), index === 3 ? warning : display);
    }
    part('Cockpit.SwitchBank', new Vec3(0, -0.52, -0.72), new Vec3(0.42, 0.055, 0.12), frame);
    part('Cockpit.SwitchBank.Trim', new Vec3(0, -0.485, -0.72), new Vec3(0.35, 0.018, 0.075), trim);
    part('Cockpit.Strut.Left', new Vec3(-0.79, 0.02, -1.16), new Vec3(0.075, 1.28, 0.09), frame, new Vec3(0, 0, -16));
    part('Cockpit.Strut.Right', new Vec3(0.79, 0.02, -1.16), new Vec3(0.075, 1.28, 0.09), frame, new Vec3(0, 0, 16));
    part('Cockpit.CanopyRail.Left', new Vec3(-0.58, 0.46, -1.22), new Vec3(0.055, 0.62, 0.07), trim, new Vec3(0, 0, -51));
    part('Cockpit.CanopyRail.Right', new Vec3(0.58, 0.46, -1.22), new Vec3(0.055, 0.62, 0.07), trim, new Vec3(0, 0, 51));
    part('Cockpit.CanopyHeader', new Vec3(0, 0.71, -1.26), new Vec3(0.72, 0.055, 0.08), frame);
    cylinderPart('Cockpit.ControlStick.Shaft', new Vec3(0.43, -0.35, -0.68), 0.035, 0.3, trim, new Vec3(-18, 0, 8));
    part('Cockpit.ControlStick.Grip', new Vec3(0.46, -0.19, -0.73), new Vec3(0.12, 0.14, 0.09), frame, new Vec3(-12, -4, 6));
    cylinderPart('Cockpit.ControlStick.Trigger', new Vec3(0.42, -0.17, -0.79), 0.018, 0.07, warning, new Vec3(90, 0, 0));
    for (let index = 0; index < 5; index += 1) {
      part(`Cockpit.StatusStrip.${index + 1}`, new Vec3(-0.24 + index * 0.12, -0.455, -1.31), new Vec3(0.075, 0.012, 0.025), index === 4 ? warning : displayDim);
    }
    part('Cockpit.Warning.Left', new Vec3(-0.5, -0.42, -1.3), new Vec3(0.16, 0.035, 0.08), warning);
    part('Cockpit.Warning.Right', new Vec3(0.5, -0.42, -1.3), new Vec3(0.16, 0.035, 0.08), warning);
    interior.active = false;
    return interior;
  }

  private updateCamera(snapshot: CombatSnapshot): void {
    if (!this.cameraNode) {
      return;
    }
    // 停靠期间所有刷新路径都必须保持站内机位，否则服务/发券后的 dispatchCombatState
    // 会把相机拉回追尾视角，玩家又看不到前哨内部了。
    if (this.dockedAtOutpost) {
      this.focusOutpostInterior();
      return;
    }
    const player = snapshot.player;
    const aimForward = computeAimRay({
      position: player.position,
      aimYaw: player.aimYaw,
      aimPitch: player.aimPitch,
    }).direction;
    const cockpit = snapshot.cameraMode === 'cockpit';
    const hullForward = computeAimRay({
      position: player.position,
      aimYaw: player.yaw,
      aimPitch: player.pitch,
    }).direction;
    const desired = cockpit && this.shipPresenter
      ? this.shipPresenter.cockpitWorldPosition
      // 拉近追尾距离：旧版 10 单位 + FOV 62 让机体只占画面中央很小一点，
      // 配合 ShipPresenter 的 COMBAT_VISUAL_SCALE 让玩家舰真正可辨、看得见涂装。
      : new Vec3(
        player.position.x - aimForward.x * 7.2,
        player.position.y - aimForward.y * 3 + 2.6,
        player.position.z - aimForward.z * 7.2,
      );
    // Reactive feel: recede the camera along aim on recoil and rattle it on impact.
    const recoil = this.recoilAmount();
    const shake = this.shakeAmount();
    // 注意：Cocos 3.x 已移除 `Vec3.mulScalar` 静态方法，必须手动相乘。
    if (recoil > 0 || shake > 0) {
      desired.add(new Vec3(
        aimForward.x * recoil,
        aimForward.y * recoil,
        aimForward.z * recoil,
      ));
      desired.add(new Vec3(
        this.shakeOffset.x * shake,
        this.shakeOffset.y * shake,
        this.shakeOffset.z * shake,
      ));
    }
    this.cameraNode.setWorldPosition(desired);
    if (this.cockpitInterior) this.cockpitInterior.active = cockpit;
    // 座舱视角把相机放进机体内部，必须隐藏外部模型，否则 near=0.08 直接穿模。
    this.shipPresenter?.setCockpitMode(cockpit);
    const camera = this.cameraNode.getComponent(Camera);
    if (camera) {
      // FOV = 基础值 + 命中冲击 + 速度扩张。
      // 之前固定 62/70，加速时视野完全不变 → 推背感全靠尾迹，机身毫无反应。
      const baseFov = cockpit ? 70 : COMBAT_FEEL.fovBase;
      const boostFov = COMBAT_FEEL.fovBoost
        * Math.max(0, this.snapshot.player.speedScale - 0.6) / 0.4;
      // 收紧 FOV 波动：宽屏（≈2.25:1）下 FOV 每被顶大一度，横向视野就明显外扩，
      // 连续开火/受击/加速会让画面「一抽一抽地往外拉」。给总 FOV 加上限，
      // 镜头在移动时保持稳定，不再越拉越伸。
      camera.fov = Math.min(baseFov + 3.5, baseFov + this.fovPunch + boostFov);
    }
    this.cameraNode.lookAt(cockpit
      ? new Vec3(
        desired.x + hullForward.x * 80,
        desired.y + hullForward.y * 80,
        desired.z + hullForward.z * 80,
      )
      : new Vec3(snapshot.aimPoint.x, snapshot.aimPoint.y, snapshot.aimPoint.z));
  }

  private updateDamageFeedback(snapshot: CombatSnapshot): void {
    const currentHealth = snapshot.player.health + snapshot.player.shield;
    if (currentHealth < this.previousHealth && this.damageLight) {
      this.damageLight.luminance = 1400;
      tween(this.damageLight)
        .to(0.16, { luminance: 0 })
        .start();
    }
    this.previousHealth = currentHealth;
  }

  private dispatchCombatFeedback(snapshot: CombatSnapshot): void {
    if (!this.platform?.capabilities.haptics || snapshot.combatEvents.length === 0) return;
    if (snapshot.combatEvents.some((event) => event.type === 'shield-break')) {
      void this.platform.haptic('shield-break');
    } else if (snapshot.combatEvents.some((event) => event.type === 'destroyed' && event.source === 'player')) {
      void this.platform.haptic('weapon-heavy');
    } else if (snapshot.combatEvents.some((event) => event.type === 'hit' && event.source === 'player')) {
      void this.platform.haptic('impact-medium');
    }
  }

  /**
   * Cooperative multiplayer hook: stream the local pilot's presence to the
   * active transport (when present) at a throttled rate, and consume remote
   * presence so the renderer can place a friendly ship. Signals (join/ready)
   * are surfaced by re-arming the handler whenever the transport changes so a
   * later `setActiveCoopTransport` still works after a late scene load.
   */
  private syncCoopNetwork(deltaTime: number): void {
    const transport = activeCoopTransport();
    if (transport) {
      const incoming: ((message: CoopMessage) => void) | null = this.coopSignalHandler;
      if (!incoming) {
        const handler = (message: CoopMessage): void => {
          // CoopMessage 是联合类型，TS 4.9 无法靠 `t` 判别式自动收窄，
          // 这里显式守卫出 presence 分支再交给 buffer。
          if ((message as CoopPresence).t === 'presence') {
            this.coopPresenceBuffer.push(message as CoopPresence);
            this.coopRemote = this.coopPresenceBuffer.latest();
          }
        };
        this.coopSignalHandler = handler;
        transport.onMessage(handler);
      }
      this.coopStreamElapsed += deltaTime;
      if (this.coopStreamElapsed >= 0.16) {
        this.coopStreamElapsed = 0;
        this.coopSeq += 1;
        const player = this.snapshot.player;
        const forward = new Vec3(
          Math.sin(player.aimYaw) * Math.cos(player.aimPitch),
          Math.sin(player.aimPitch),
          Math.cos(player.aimYaw) * Math.cos(player.aimPitch),
        );
        const presence: CoopPresence = {
          t: 'presence',
          seq: this.coopSeq,
          elapsed: this.snapshot.elapsed,
          health: player.health,
          shield: player.shield,
          energy: player.energy,
          score: player.score,
          position: { x: player.position.x, y: player.position.y, z: player.position.z },
          velocity: { x: 0, y: 0, z: 0 },
          forward: { x: forward.x, y: forward.y, z: forward.z },
          firing: false,
          boosting: false,
        };
        transport.send(presence);
      }
    } else {
      this.coopSignalHandler = null;
      this.coopPresenceBuffer.clear();
      this.coopRemote = null;
    }
  }

  // Kick the camera on firing and rattle it on damage for a punchy, tactile feel.
  private triggerCameraFeel(snapshot: CombatSnapshot, deltaTime: number): void {
    const events = snapshot.combatEvents;
    if (events.length === 0) {
      this.decayCameraFeel(deltaTime);
      return;
    }
    if (events[events.length - 1].id <= this.lastCameraEventId) {
      this.decayCameraFeel(deltaTime);
      return;
    }
    for (const event of events) {
      if (event.id <= this.lastCameraEventId) continue;
      this.lastCameraEventId = event.id;
      if (event.type === 'weapon-fired' && event.source === 'player') {
        this.applyRecoil(0.16, 0.09);
        this.punchFov(COMBAT_FEEL.fovPunchOnFire);
      } else if (event.type === 'hit' && event.source === 'player') {
        // Player lands a hit: short hit-stop + small snap for punch.
        this.hitStopRemaining = Math.max(this.hitStopRemaining, COMBAT_FEEL.hitStopOnHit);
        this.applyShake(PLAYER_HIT_TUNING.shakeLight * 0.32, 0.1, 0.14);
        this.punchFov(COMBAT_FEEL.fovPunchOnKill * 0.45);
      } else if (event.type === 'hit' && event.source === 'enemy') {
        // 挨打：震动随这一发伤害占比放大，重击才有「被打疼」的分量
        const ratio = Number(event.damage || 0) / Math.max(1, this.snapshot.player.maxHealth);
        const scale = Math.min(COMBAT_FEEL.shakeDamageScale, 1 + ratio * COMBAT_FEEL.shakeDamageScale);
        this.applyShake(
          PLAYER_HIT_TUNING.shakeLight * scale,
          0.16 * scale,
          0.24 * scale,
        );
        this.punchFov(COMBAT_FEEL.fovPunchOnHitTaken * scale);
      } else if (event.type === 'shield-break') {
        this.applyShake(PLAYER_HIT_TUNING.shakeShieldBreak, 0.3, 0.4);
        this.hitStopRemaining = Math.max(this.hitStopRemaining, COMBAT_FEEL.hitStopOnShieldBreak);
        this.punchFov(COMBAT_FEEL.fovPunchOnHitTaken * 1.4);
      } else if (event.type === 'destroyed' && event.source === 'enemy') {
        const isBoss = event.targetId ? this.snapshot.enemies.some(enemy => enemy.id === event.targetId) : false;
        this.applyShake(
          COMBAT_FEEL.shakeOnKill,
          COMBAT_FEEL.shakeOnKillDuration,
          0.5,
        );
        this.hitStopRemaining = Math.max(
          this.hitStopRemaining,
          isBoss ? COMBAT_FEEL.hitStopOnKillBoss : COMBAT_FEEL.hitStopOnKill,
        );
        this.punchFov(COMBAT_FEEL.fovPunchOnKill * (isBoss ? 1.8 : 1));
      } else if (event.type === 'destroyed' && event.source === 'player') {
        this.applyShake(0.26, 0.42, 0.6);
        this.punchFov(COMBAT_FEEL.fovPunchOnHitTaken * 2);
      } else if (event.type === 'weapons-swapped') {
        // 主副武器互换：轻微 FOV 冲击 + UI 提示音，强化换枪手感
        this.punchFov(COMBAT_FEEL.fovPunchOnWeaponSwap);
        this.gameAudio?.ui();
      }
    }
    this.decayCameraFeel(deltaTime);
  }

  // Set the camera pitch-back as a short recoil kick opposite to aim direction.
  private applyRecoil(forwardOffset: number, duration: number): void {
    this.recoilElapsed = 0;
    this.recoilDuration = duration;
    this.recoilDirection.set(-forwardOffset, forwardOffset * 0.45, forwardOffset * 0.2);
  }

  private applyShake(amplitude: number, strength: number, duration: number): void {
    this.shakeElapsed = 0;
    this.shakeDuration = duration;
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeOffset.set(
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
    );
  }

  /** FOV 冲击：累加一个正向尖峰，随后按 fovPunchDecay 回落 */
  private punchFov(amount: number): void {
    this.fovPunch = Math.max(this.fovPunch, amount);
  }

  private decayCameraFeel(deltaTime: number): void {
    if (this.recoilElapsed < this.recoilDuration) {
      this.recoilElapsed += deltaTime;
    }
    if (this.shakeElapsed < this.shakeDuration) {
      this.shakeElapsed += deltaTime;
      this.shakeStrength = Math.max(0, this.shakeStrength * (1 - deltaTime * 6));
    }
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= deltaTime;
    }
    if (this.fovPunch > 0) {
      this.fovPunch = Math.max(0, this.fovPunch - deltaTime * COMBAT_FEEL.fovPunchDecay);
    }
  }

  // Amplitude of the decayed recoil kick at the current moment in its timeline.
  private recoilAmount(): number {
    if (this.recoilElapsed >= this.recoilDuration) return 0;
    const t = this.recoilElapsed / this.recoilDuration;
    return Math.max(0, Math.sin((1 - t) * Math.PI)) * 1.6;
  }

  // Strength of the decaying camera shake at the current frame.
  private shakeAmount(): number {
    if (this.shakeElapsed >= this.shakeDuration) return 0;
    const t = this.shakeElapsed / this.shakeDuration;
    return this.shakeStrength * (1 - t);
  }

}

ccclass('CombatBootstrap')(CombatBootstrap);
