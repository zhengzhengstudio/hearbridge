import {
  Camera,
  Canvas,
  Color,
  EditBox,
  EventKeyboard,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  Input,
  input as cocosInput,
  Label,
  Layers,
  Node,
  resources,
  Sprite,
  SpriteFrame,
  sys,
  Texture2D,
  UIOpacity,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  tween,
  view,
} from 'cc';
import { nativeTrace } from '../platform/NativeDiagnostics';
import { attachGraphics, graphicsLayerReady, graphicsOf } from '../platform/NativeGraphicsShim';
import type { CargoItem } from '../core/LootAndCargoSystem';
import type { CombatSnapshot } from '../core/CombatSimulation';
import {
  BOOST_MODULES,
  ENGINE_MODULES,
  FRAME_CORES,
  PRIMARY_WEAPONS,
  PRIMARY_WEAPON_BEHAVIORS,
  SECONDARY_WEAPON_BEHAVIORS,
  deviceAbilityFor,
  resolveLoadout,
  SECONDARY_WEAPONS,
  SHIELD_MODULES,
  TACTICAL_DEVICES,
  UTILITY_MODULES,
} from '../core/WeaponCatalog';
import type { CombatLoadout, ResolvedCombatLoadout } from '../core/WeaponCatalog';
import { PLAYER_SHIP_IDS, resolvePlayerShip } from '../core/ShipCatalog';
import { BUILD_INFO } from '../core/BuildInfo';
import { buyStoreItem, loadEconomy, storePrice, type StoreItemId } from '../core/PlayerEconomy';
import type { StationSystem, StationSave, ContractDef, TradeGoodId, FacilityId, Result } from '../core/StationSystem';
import { CONTRACTS, TRADE_GOODS, FACILITIES } from '../core/StationSystem';
import { AUDIO_ENGINE_KEY, AUDIO_SFX_KEY, audioSettingEnabled, toggleAudioSetting } from './GameAudio';
import {
  movementControlCircle,
  returnControlCircle,
  touchActionLayout,
  type BrowserPointerRole,
  type ControlCircle,
  type TouchSafeInsets,
} from '../input/BrowserInputBridge';
import type { NativeInputFeedback, NativeTouchLayout } from '../input/CocosInputBridge';
import {
  DEFAULT_INPUT_SETTINGS,
  normalizeInputSettings,
  type InputSettings,
} from '../input/InputSettings';
import { cocosKeyCodeToDesktopCode } from '../input/CocosInputBridge';
import {
  bindActionKey,
  displayBinding,
  GAME_ACTIONS,
  GAME_ACTION_LABELS,
  resetKeyBindings,
  setTouchControlPosition,
  type GameAction,
  type TouchControlId,
} from '../input/KeyBindings';
import {
  copyRunLogText,
  formatRunLog,
  formatTimestamp,
  nativeRunLogs,
  readRunLogs,
  runLogSummary,
  RUN_LOG_LIMIT,
  type NativeRunLog,
  type RunLogEntry,
  type RunLogStorage,
} from '../platform/RunLog';
import { requestNativeUpdateCheck } from '../platform/PlatformBootstrap';
import {
  touchStickFeedback,
  type TouchStickFeedbackSnapshot,
  type TouchStickThreshold,
} from '../input/TouchStickFeedback';
import {
  combatText,
  detectCombatLocale,
  type CombatMessageKey,
} from '../ui/Localization';

// 战术界面色板：与网页端 TACTICAL SKIN 同源（青蓝数据色 #4fd6e0 / 琥珀警戒色 #f0a83c）
const HUD_WHITE = new Color(233, 243, 244, 235);
const HUD_CYAN = new Color(79, 214, 224, 210);
const HUD_DARK = new Color(5, 18, 24, 168);
const HUD_ACTIVE = new Color(240, 168, 60, 228);
const HUD_RED = new Color(224, 90, 79, 235);
const HUD_GREEN = new Color(91, 211, 170, 230);

// 联机/前哨服务接口：外层 CombatBootstrap 与 web shell 负责接线；native 无 WebRTC 时 available 传 false。
export type StationServiceId = 'repair' | 'resupply' | 'refit';
export type CoopHudState = 'idle' | 'hosting' | 'joining' | 'connected' | 'peer-left' | 'error';
export interface CoopHudBridge {
  readonly available: boolean;
  host(): void;
  join(code?: string): void;
  close(): void;
  copyCode?(): void;
}
/** 站内玩法 HUD 桥接：外层用 StationSystem 实现，HUD 只拿快照与派发操作。 */
export interface StationHudBridge {
  snapshot(): StationSave;
  tickets(): number;
  acceptContract(id: string): Result;
  claimContract(id: string): Result;
  buy(good: TradeGoodId, qty: number): Result;
  sell(good: TradeGoodId, qty: number): Result;
  interactFacility(id: FacilityId): Result;
  completeRefit(accuracy: number): Result;
  contractDefs(): readonly ContractDef[];
  tradeGoods(): readonly { id: TradeGoodId; basePrice: number; volatility: number; titleKey: string }[];
  facilityDefs(): readonly { id: FacilityId; titleKey: string; descKey: string; ticketReward: number }[];
  market(): Readonly<Record<TradeGoodId, { buy: number; sell: number }>>;
}

/** 站内自由行走 HUD 桥接：Bootstrap 每帧把化身位置/接近终端推给 HUD 画提示。 */
export interface WalkHudBridge {
  /** 玩家当前是否处于 3D 站内行走模式（相机跟随、摇杆驱动）。 */
  isWalking(): boolean;
  /** 当前半径内最近终端的本地化名称；没有则空串。 */
  nearLabel(): string;
  /** 终端四项方位文字（含未接近项），用于小地图列表。 */
  terminalRows(): string[];
}

export interface NativeHudActions {
  onReturnHome?: () => void;
  onStationService?: (service: StationServiceId) => void;
  /** 设置里的「开始新手教学」：由 CombatBootstrap 切到 tutorial 预设并重置战局。 */
  onStartTutorial?: () => void;
  coop?: CoopHudBridge;
  station?: StationHudBridge;
  walk?: WalkHudBridge;
  /** 在前哨面板点「站内玩法」时进入 3D 自由行走（由 Bootstrap 切相机/建化身）。 */
  onEnterWalk?: () => void;
}

type NativeHomeView = 'operations' | 'hangar' | 'cargo' | 'market' | 'settings' | 'coop';
type NativeOverlay = 'home' | 'loadout' | 'outpost' | 'defeat' | 'pause' | 'keybind' | 'runlog' | 'station';
/** 站内玩法四个页签：任务板 / 交易 / 设施 / 校准改装。 */
type StationTab = 'contracts' | 'trade' | 'facilities' | 'refit';
type PanelButtonKind = 'standard' | 'primary' | 'nav' | 'slot' | 'danger';

interface ActionVisual {
  node: Node;
  graphics: Graphics;
  /** 图标层（独立子节点，偏上摆放），底板与图标分开才能让文字有位置。 */
  glyph: Graphics | null;
  radius: number;
}

// 触屏布局编辑区里显示的控件；顺序与默认布局一致。
const TOUCH_DOT_IDS: readonly TouchControlId[] = [
  'movement', 'primaryFire', 'secondaryFire', 'boost',
  'swapWeapons', 'deviceAbility', 'cameraToggle', 'pause',
];
const TOUCH_DOT_LABELS: Readonly<Record<string, string>> = {
  movement: '摇杆', primaryFire: '主炮', secondaryFire: '副炮', boost: '加速',
  swapWeapons: '切枪', deviceAbility: '技能', cameraToggle: '视角', pause: '暂停',
};

const LOADOUT_OPTIONS = {
  ship: [...PLAYER_SHIP_IDS],
  weapon: ['pulse', 'scatter', 'missile', 'rail', 'plasma', 'ion', 'beam', 'rotary'],
  secondary: ['missile', 'torpedo', 'flak', 'swarm', 'mine', 'rocket'],
  device: ['targeter', 'repair', 'fabricator', 'collector', 'aegis', 'jammer', 'overclock', 'decoy'],
  core: ['balanced', 'vector', 'bastion', 'reactor', 'phantom', 'dreadnought', 'vanguard', 'specter'],
  engine: ['vector-drive', 'afterburner', 'cruise-drive', 'inertial-drive', 'ion-drive'],
  shield: ['pulse-screen', 'aegis-screen', 'reflector', 'phase-screen', 'kinetic-screen'],
  utility: ['scanner', 'tractor', 'repair-drone', 'decoy-drone', 'survey-probe'],
  boost: ['overdrive', 'coolant', 'capacitor', 'stabilizer', 'emergency-cell'],
  skin: ['graphite', 'rescue', 'void', 'hazard', 'azure', 'desert'],
} as const;

type NativeLoadoutSlot = keyof typeof LOADOUT_OPTIONS;
// 2026-11-04：新增 survive（存活）/ defense（守点）/ escort（护送）三种任务。
// 2026-11-09：追加 tutorial（设置面板里的新手教学关）。
// 与 CombatBootstrap.MissionPreset 保持一致 —— 少一个就会出现「点了没反应」，
// 且 missions 数组里已有 'tutorial'，严格类型检查会直接报 not assignable。
type MissionPreset = 'salvage' | 'assault' | 'hunt' | 'survive' | 'defense' | 'escort' | 'tutorial';

const LOADOUT_NAME_KEYS: Readonly<Record<string, CombatMessageKey>> = {
  interceptor: 'ship.interceptor', scout: 'ship.scout', fighter: 'ship.fighter',
  bomber: 'ship.bomber', gunship: 'ship.gunship',
  pulse: 'item.pulse', scatter: 'item.scatter', missile: 'item.missile', rail: 'item.rail', plasma: 'item.plasma',
  torpedo: 'item.torpedo', flak: 'item.flak', balanced: 'item.balanced', vector: 'item.vector',
  targeter: 'item.targeter', repair: 'item.repair', fabricator: 'item.fabricator', collector: 'item.collector', aegis: 'item.aegis',
  bastion: 'item.bastion', reactor: 'item.reactor', phantom: 'item.phantom', dreadnought: 'item.dreadnought',
  'vector-drive': 'item.vector-drive', afterburner: 'item.afterburner', 'cruise-drive': 'item.cruise-drive',
  'pulse-screen': 'item.pulse-screen', 'aegis-screen': 'item.aegis-screen', reflector: 'item.reflector',
  scanner: 'item.scanner', tractor: 'item.tractor', 'repair-drone': 'item.repair-drone',
  overdrive: 'item.overdrive', coolant: 'item.coolant', capacitor: 'item.capacitor',
  graphite: 'item.graphite', rescue: 'item.rescue', void: 'item.void',
  ion: 'item.ion', beam: 'item.beam', rotary: 'item.rotary', swarm: 'item.swarm', mine: 'item.mine', rocket: 'item.rocket',
  jammer: 'item.jammer', overclock: 'item.overclock', decoy: 'item.decoy', vanguard: 'item.vanguard', specter: 'item.specter',
  'inertial-drive': 'item.inertial-drive', 'ion-drive': 'item.ion-drive', 'phase-screen': 'item.phase-screen',
  'kinetic-screen': 'item.kinetic-screen', 'decoy-drone': 'item.decoy-drone', 'survey-probe': 'item.survey-probe',
  stabilizer: 'item.stabilizer', 'emergency-cell': 'item.emergency-cell', hazard: 'item.hazard', azure: 'item.azure', desert: 'item.desert',
};

const LOADOUT_SLOT_KEYS: Readonly<Record<NativeLoadoutSlot, CombatMessageKey>> = {
  ship: 'slot.ship',
  weapon: 'slot.weapon', secondary: 'slot.secondary', device: 'slot.device', core: 'slot.core', engine: 'slot.engine', shield: 'slot.shield',
  utility: 'slot.utility', boost: 'slot.boost', skin: 'slot.skin',
};

interface LoadoutMetrics {
  primaryDamage: number;
  primaryRate: number;
  secondaryDamage: number;
  health: number;
  shield: number;
  speedMultiplier: number;
  energyMultiplier: number;
  shieldRegen: number;
}

export class NativeCombatHud implements NativeInputFeedback {
  private readonly locale = detectCombatLocale();
  private readonly root = new Node('NativeCombatHud');
  /** 触控动作视觉表（原字段名 actions，因构造函数新增同名 actions 桥接参数而改名避免冲突）。 */
  private readonly actionVisuals = new Map<BrowserPointerRole, ActionVisual>();
  private readonly touchEnabled: boolean;
  /** 战斗 HUD 是否可见（打开装配台/前哨/暂停时收起）。默认关闭，避免启动页叠出摇杆。 */
  private combatChromeVisible = false;
  /** 启动 / 初始化阶段：期间一律不渲染战斗控件，直到 showPreflight() 收口。 */
  private startupVisible = true;
  /** resize 打点节流：只在尺寸变化时写轨迹，避免每帧文件 IO。 */
  private lastTraceSize = '';
  /** 首次按帧同步的执行轨迹：只在第一次 syncCombat 打点，崩在原生层时可定位到具体绘制。 */
  private syncTraceDone = false;
  /** 主面板矢量绘制打点节流：layoutHomePanel 会被 resize 反复调用，只记首次首尾。 */
  private homeLayoutTraceDone = false;
  /** 返航过场中：期间收起开火/切武器/加速/摇杆，避免「返航中还能开火」的状态矛盾。 */
  private returning = false;
  /** 返航压暗的第二层（靠近屏幕外沿），用于做两级羽化。 */
  private returnVeilInner: Graphics | null = null;
  private statusLabel: Label | null = null;
  private objectiveLabel: Label | null = null;
  private sectorLabel: Label | null = null;
  private targetLabel: Label | null = null;
  private cargoLabel: Label | null = null;
  private hullStatusBar: Graphics | null = null;
  private shieldStatusBar: Graphics | null = null;
  private energyStatusBar: Graphics | null = null;
  private targetHealthBar: Graphics | null = null;
  private hitMarker: Graphics | null = null;
  private combatFeedLabel: Label | null = null;
  private navigationLabel: Label | null = null;
  /** 顶部信息区（主要目标 / 航区 / 目标）统一底板，让三行读数成为一个整体而不是散字。 */
  private objectivePlate: Graphics | null = null;
  /** 矢量绘制层降级徽标：只在白纹理帧不可用时出现（Label 是真机唯一稳渲染的元素）。 */
  private graphicsBadge: Label | null = null;
  /** 连击计数（顶部中央，战斗多样性 / 手感反馈） */
  private comboLabel: Label | null = null;
  /** 局内强化条（底部中央，捡到精英/Boss 掉落后短期生效） */
  private upgradeLabel: Label | null = null;
  /** 当前主/副武器读数（左下角，战斗中可一键互换） */
  private weaponLabel: Label | null = null;
  private abilityLabel: Label | null = null;
  private lastWeaponSignature = '';
  private reticleGraphics: Graphics | null = null;
  private lastPlayerProjectileId = '';
  private shotFeedbackFrames = 0;
  private hitFeedbackFrames = 0;
  private hitFeedbackLethal = false;
  private combatFeedFrames = 0;
  private lastCombatEventId = 0;
  private lastTargetId = '';
  private lastTargetHealth = Number.POSITIVE_INFINITY;
  private lastPickupCount = 0;
  private stickThumb: Node | null = null;
  private stickDirection: Graphics | null = null;
  private stickThreshold: TouchStickThreshold = 'center';
  private stickReturnTween: ReturnType<typeof tween> | null = null;
  private loadoutPanel: Node | null = null;
  private loadoutHangarArt: Sprite | null = null;
  private loadoutBackdrop: Graphics | null = null;
  private loadoutSlotRail: Graphics | null = null;
  private loadoutSchematic: Graphics | null = null;
  private loadoutDetailLabel: Label | null = null;
  private loadoutButton: Node | null = null;
  private applyLoadoutButton: Node | null = null;
  private closeLoadoutButton: Node | null = null;
  private loadoutSummaryLabel: Label | null = null;
  private loadoutFeedbackLabel: Label | null = null;
  private homePanel: Node | null = null;
  private homeBackdrop: Graphics | null = null;
  private homeKeyArt: Sprite | null = null;
  private outpostArtFrame: SpriteFrame | null = null;
  /** 停靠结算面板专用：站内机库内景图，替代空间站外景图，让"建筑内"可见。 */
  private outpostInteriorFrame: SpriteFrame | null = null;
  private combatZoneArtFrame: SpriteFrame | null = null;
  private hangarArtFrame: SpriteFrame | null = null;
  private marketArtFrame: SpriteFrame | null = null;
  private homeViewTitle: Label | null = null;
  private homeViewDetail: Label | null = null;
  private homeCargoLabel: Label | null = null;
  private homeProfileLabel: Label | null = null;
  private homeMissionLabel: Label | null = null;
  private homeControllerLabel: Label | null = null;
  private outpostPanel: Node | null = null;
  /** 最近一次远征结算发券数；0 表示尚未结算，不显示「本趟 +N」。 */
  private lastTicketGain = 0;
  /** 前哨站「舱内物资」视图：true 时货物读数行改为按五类分组的台账。 */
  private interiorOpen = false;
  /** 新手关实时引导：显示在目标读数行，不弹遮罩、不冻结飞行输入。 */
  private tutorialHint: { current: number; total: number; key: CombatMessageKey } | null = null;
  private outpostKeyArt: Sprite | null = null;
  private outpostBackdrop: Graphics | null = null;
  private outpostStatusLabel: Label | null = null;
  private outpostCargoLabel: Label | null = null;
  private outpostUndockButton: Node | null = null;
  private outpostLoadoutButton: Node | null = null;
  private outpostInteriorButton: Node | null = null;
  private deployButton: Node | null = null;
  private hangarButton: Node | null = null;
  private readonly homeNavButtons = new Map<NativeHomeView, Node>();
  private readonly settingsButtons: Node[] = [];
  private readonly marketButtons = new Map<StoreItemId, Node>();
  private homeView: NativeHomeView = 'operations';
  private bootPanel: Node | null = null;
  private bootKeyArt: Sprite | null = null;
  private bootStatusLabel: Label | null = null;
  private bootProgress: Graphics | null = null;
  private defeatPanel: Node | null = null;
  private defeatBackdrop: Graphics | null = null;
  private defeatOpen = false;
  private pausePanel: Node | null = null;
  private pauseBackdrop: Graphics | null = null;
  private pauseOpen = false;
  private readonly missionButtons = new Map<MissionPreset, Node>();
  private readonly loadoutLabels = new Map<NativeLoadoutSlot, Label>();
  private selectedLoadoutSlot: NativeLoadoutSlot = 'weapon';
  private pendingLoadout: ResolvedCombatLoadout = resolveLoadout();
  private appliedLoadout: ResolvedCombatLoadout = resolveLoadout();
  private loadoutOpen = false;
  private homeOpen = false;
  private outpostOpen = false;
  private loadoutFromOutpost = false;
  private preflight = false;
  private missionPreset: MissionPreset = 'salvage';
  private width = 1280;
  private height = 720;
  private safeInsets: TouchSafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  private leftHanded = false;
  private controlScale = 1;
  private canReturn = false;
  private canDock = false;
  private latestSnapshot: CombatSnapshot | null = null;
  // 真机调试叠层（验证版，确认后可移除）：显示敌机数 / 最近敌距 / 速度比例 /
  // 前哨距离 / 可否停靠 / 可否返航，用于排查「敌机不显」「卡 XXm 不前进」「无法停靠」。
  private debugTelemetryLabel: Label | null = null;
  // 返航过场：返航阶段压暗四周 + 中央大号「返航中 xx%」动画，避免「按了返航没反应」。
  private returnOverlay: Node | null = null;
  private returnBanner: Label | null = null;
  private returnVeil: Graphics | null = null;
  private readonly inputSettings: InputSettings;
  private readonly buttonKinds = new Map<Node, PanelButtonKind>();
  private trainingPanel: Node | null = null;
  private trainingBackdrop: Graphics | null = null;
  private trainingTitleLabel: Label | null = null;
  private trainingStepLabel: Label | null = null;
  private trainingHintLabel: Label | null = null;
  private trainingNextButton: Node | null = null;
  private trainingSkipButton: Node | null = null;
  private trainingStep = 0;
  private trainingDone = false;
  /** 销毁标记：异步贴图回调销毁后不得再写节点。 */
  private destroyed = false;
  /** 首飞校准当前开合状态：setTrainingOpen 的守卫，避免每帧重置摇杆回中。 */
  private trainingOpen = false;
  /** 前哨服务按钮与「从战场带回」的真实三量 / 星港券读数。 */
  private outpostRepairButton: Node | null = null;
  private outpostResupplyButton: Node | null = null;
  private outpostRefitButton: Node | null = null;
  private outpostHomeButton: Node | null = null;
  private outpostStationButton: Node | null = null;
  private outpostVitalsLabel: Label | null = null;
  private outpostTicketsLabel: Label | null = null;
  /** 主页「行动」视图的远征档案读数。 */
  private homeOpsLabel: Label | null = null;
  /** 联机面板按钮 / 标签，以及外层回灌的状态缓存。 */
  private coopHostButton: Node | null = null;
  private coopJoinButton: Node | null = null;
  private coopJoinInput: EditBox | null = null;
  private coopCloseButton: Node | null = null;
  private coopCopyButton: Node | null = null;
  private coopStatusLabel: Label | null = null;
  private coopCodeLabel: Label | null = null;
  private coopState: CoopHudState = 'idle';
  private coopDetail = '';
  private coopCode = '';

  // ---- 设置：可改键位 ----
  private keybindPanel: Node | null = null;
  private keybindBackdrop: Graphics | null = null;
  private keybindHintLabel: Label | null = null;
  private readonly keybindButtons = new Map<GameAction, Node>();
  private keybindDragArea: Node | null = null;
  private keybindDragFrame: Graphics | null = null;
  private readonly keybindDragDots = new Map<TouchControlId, Node>();
  private keybindDragWidth = 320;
  private keybindDragHeight = 180;
  private pendingKeyAction: GameAction | null = null;
  private keybindOpen = false;
  private keyCaptureAttached = false;

  // ---- 设置：最近三次运行日志 ----
  private runlogPanel: Node | null = null;
  private runlogBackdrop: Graphics | null = null;
  private readonly runlogCards: Node[] = [];
  private runlogDetailLabel: Label | null = null;
  private runlogHintLabel: Label | null = null;
  private runlogEntries: RunLogEntry[] = [];
  private runlogNatives: (NativeRunLog | null)[] = [];
  private selectedRunLog = 0;
  private runlogOpen = false;

  // ---- 站内玩法（建筑内）：任务板 / 交易 / 设施 / 校准改装 ----
  private stationPanel: Node | null = null;
  private stationBackdrop: Graphics | null = null;
  private stationTabButtons = new Map<StationTab, Node>();
  private stationTitleLabel: Label | null = null;
  private stationBodyLabel: Label | null = null;
  /** 校准准度条：Graphics 进度条（替代 █/░ 字符，后者在真机渲染成斜纹方块）。 */
  private stationRefitBar: Graphics | null = null;
  private stationHintLabel: Label | null = null;
  private stationSlotButtons: Node[] = [];
  /** 渲染当前页签时重建：每个可见 slot 对应的点击动作与描边色。 */
  private stationSlots: { action: () => void; accent: Color }[] = [];
  private stationBackButton: Node | null = null;
  private stationTab: StationTab = 'contracts';
  private stationOpen = false;
  private stationSelected = 0;
  /** 校准小游戏：0~100 准度，连点/拖动累积，松手结算。 */
  private stationCalibration = 0;
  private stationNotice: { message: string } | null = null;

  // ---- 站内自由行走（3D 舱内探索）：稀疏提示层，不遮住 3D 场景 ----
  /** 行走提示层：顶部操作说明 + 近距"按开火交互"提示 + 四终端方位列表。 */
  private walkHintLayer: Node | null = null;
  private walkTitleLabel: Label | null = null;
  private walkPromptLabel: Label | null = null;
  private walkTerminalLabels: Label[] = [];
  private walkExitButton: Node | null = null;
  /** 3D 站内行走态：战斗读数收起，只留稀疏提示层与摇杆/开火键。 */
  private walkActive = false;

  constructor(
    scene: Node,
    touchEnabled: boolean,
    private readonly onApplyLoadout?: (loadout: CombatLoadout) => void,
    private readonly onSelectMission?: (preset: MissionPreset) => void,
    private readonly onRestart?: () => void,
    initialInputSettings?: InputSettings,
    private readonly onApplyInputSettings?: (settings: InputSettings) => void,
    private readonly onDeploy?: () => void,
    private readonly onEconomyChanged?: () => void,
    private readonly onUiFeedback?: () => void,
    private readonly onPauseToggle?: () => void,
    /** 末尾可选：返航主页 / 前哨服务 / 联机桥接，由外层接线；旧调用不传也兼容。 */
    private readonly actions?: NativeHudActions,
  ) {
    nativeTrace('hud: constructor');
    this.touchEnabled = touchEnabled;
    // 归一化一次：老存档没有键位/位置字段，展开后不能让它们停在 undefined。
    this.inputSettings = normalizeInputSettings({
      ...DEFAULT_INPUT_SETTINGS,
      ...initialInputSettings,
    });
    this.root.layer = Layers.Enum.UI_2D;
    this.root.setParent(scene);
    const transform = this.root.addComponent(UITransform);
    const size = view.getVisibleSize();
    transform.setContentSize(size.width, size.height);
    const cameraNode = new Node('NativeCombatHudCamera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.setParent(this.root);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    camera.visibility = Layers.Enum.UI_2D;
    camera.priority = 1 << 30;
    const canvas = this.root.addComponent(Canvas);
    canvas.cameraComponent = camera;
    canvas.alignCanvasWithScreen = true;
    canvas.renderMode = canvas.renderMode;
    // 每个面板独立创建：任一处异常只影响该面板，绝不能像 2026-11-04 那样
    // 因为一处笔误让构造函数中途抛错，导致后面所有界面没被创建、已创建的
    // 节点又停在原点叠成一团（表现为「界面被吞掉，只剩一个空框」）。
    const creators: readonly [string, () => void][] = [
      ['status', () => this.createStatus()],
      ['reticle', () => this.createReticle()],
      ['loadout', () => this.createLoadoutPanel()],
      ['home', () => this.createHomePanel()],
      ['outpost', () => this.createOutpostPanel()],
      ['defeat', () => this.createDefeatPanel()],
      ['pause', () => this.createPausePanel()],
      ['training', () => this.createTrainingPanel()],
      ['boot', () => this.createBootPanel()],
      ['keybind settings', () => this.createKeybindPanel()],
      ['run logs', () => this.createRunlogPanel()],
      ['station interior', () => this.createStationPanel()],
      ['station walk hint', () => this.createWalkHintLayer()],
      ['launcher key art', () => this.loadLauncherKeyArt()],
      ['return overlay', () => this.createReturnOverlay()],
    ];
    for (const [name, create] of creators) {
      try {
        nativeTrace(`hud:panel:${name}`);
        create();
      } catch (error: unknown) {
        console.error(`[SpaceFight HUD] ${name} panel init failed; other panels continue`, error);
      }
    }
    // 半初始化的覆盖层若残留 active=true 会直接盖住战场，统一收口。
    for (const panel of [
      this.homePanel, this.loadoutPanel, this.outpostPanel,
      this.defeatPanel, this.pausePanel, this.trainingPanel,
      this.keybindPanel, this.runlogPanel, this.stationPanel,
    ]) {
      if (panel) panel.active = false;
    }
    this.installKeyCaptureListener();
    // 启动阶段先把战斗控件全部收起：否则摇杆 / 技能钮会叠在初始化主页上，
    // 这些 Graphics 还会在尚未布局完成时进入首帧渲染。
    this.setCombatChromeVisible(false);
    nativeTrace('hud: constructor done');
  }

  resize(
    width: number,
    height: number,
    safeInsets: TouchSafeInsets,
    leftHanded = false,
    controlScale = 1,
  ): void {    // 视图尚未就绪时可能传入 0 / NaN；用默认设计尺寸兜底，避免生成零面积路径。
    this.width = Number.isFinite(width) && width > 0 ? width : 1280;
    this.height = Number.isFinite(height) && height > 0 ? height : 720;
    this.safeInsets = safeInsets;
    const sizeKey = `${this.width}x${this.height}`;
    if (this.lastTraceSize !== sizeKey) {
      this.lastTraceSize = sizeKey;
      nativeTrace(`hud: resize ${sizeKey}`);
    }
    this.leftHanded = leftHanded;
    this.controlScale = controlScale;
    // 用兜底后的尺寸：上层可能传入 0 / NaN（视图尚未就绪），零面积 UITransform
    // 会让下游 layout 生成零面积路径，原生 2D 绑定在三角化时越界。
    this.root.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.layoutStatus();
    this.layoutLoadoutPanel();
    this.layoutHomePanel();
    this.layoutOutpostPanel();
    this.layoutDefeatPanel();
    this.layoutPausePanel();
    this.layoutTrainingPanel();
    this.layoutBootPanel();
    this.layoutKeybindPanel();
    this.layoutRunlogPanel();
    this.layoutStationPanel();
    this.layoutWalkHintLayer();
    this.refreshGraphicsLayerBadge();
    if (!this.touchEnabled) return;
    if (this.actionVisuals.size === 0) this.createTouchControls();
    this.layoutTouchControls();
    this.setCombatChromeVisible(!this.startupVisible && !this.homeOpen && !this.outpostOpen && !this.loadoutOpen && !this.defeatOpen && !this.pauseOpen && !this.shouldShowTraining());
  }

  setStick(x: number, y: number, active: boolean): void {
    const movement = this.touchLayout().movement;
    const center = { x: movement.x, y: movement.y };
    const snapshot = touchStickFeedback(
      x - center.x,
      y - center.y,
      movement.radius,
      active,
      this.stickThreshold,
    );
    this.setStickFeedback(snapshot);
  }

  setStickFeedback(snapshot: TouchStickFeedbackSnapshot): void {
    if (!this.touchEnabled || !this.stickThumb) return;
    const movement = this.touchLayout().movement;
    const center = { x: movement.x, y: movement.y };
    this.stickThreshold = snapshot.threshold;
    this.drawStickDirection(snapshot);

    const target = this.canvasPosition(
      center.x + (snapshot.axis.x * movement.radius),
      center.y + (snapshot.axis.y * movement.radius),
      snapshot.active ? 3 : 2,
    );
    this.stickReturnTween?.stop();
    this.stickReturnTween = null;
    if (snapshot.active) {
      this.stickThumb.setPosition(target);
      this.stickThumb.setScale(new Vec3(0.96, 0.96, 1));
      return;
    }
    this.stickThumb.setScale(Vec3.ONE);
    this.stickReturnTween = tween(this.stickThumb)
      .to(0.1, { position: target })
      .start();
  }

  setAction(role: BrowserPointerRole, active: boolean): void {
    // 返航过场被 touchLayout 过滤掉的 role 即便有残留输入也不生效（bug 1 双保险；
    // 仅拦截按下，放行释放以免视觉卡在按下态）。
    if (this.returning && active
      && role !== 'pause' && role !== 'cameraToggle' && role !== 'returnRequested') return;
    const visual = this.actionVisuals.get(role);
    if (!visual) return;
    this.drawActionControl(visual.graphics, role, visual.radius, active);
    visual.node.setScale(active ? new Vec3(0.92, 0.92, 1) : Vec3.ONE);
  }

  touchLayout(): NativeTouchLayout {
    const all = touchActionLayout(
      this.width,
      this.height,
      this.leftHanded,
      this.safeInsets,
      this.controlScale,
    );
    // 可改键位：玩家在设置里拖动过的位置覆盖默认坐标。绘制与命中判定都走这里，
    // 所以「看得见的圈」和「点得到的区域」永远一致。
    const offsets = this.inputSettings.touchOffsets || {};
    const place = (control: ControlCircle): ControlCircle => {
      const custom = offsets[control.role as TouchControlId];
      if (!custom) return control;
      return {
        ...control,
        x: custom.x * this.width,
        y: custom.y * this.height,
      };
    };
    // 返航过场：命中判定只认暂停/视角/返航按钮。此前只把节点 active=false，
    // 但 CocosInputBridge 仍按 touchLayout().actions 判定，隐藏的开火/加速照样能点到。
    const actions = this.returning
      ? all.filter((control) => control.role === 'pause' || control.role === 'cameraToggle')
      : all;
    const result = actions.map(place);
    // 可返航/可停靠时补上返航进度圆（去重，避免重复 role）。
    if ((this.canReturn || this.canDock) && !result.some((control) => control.role === 'returnRequested')) {
      result.push(place(returnControlCircle(this.width, this.height, this.safeInsets, this.controlScale)));
    }
    return {
      actions: result,
      movement: place(movementControlCircle(
        this.width,
        this.height,
        this.leftHanded,
        this.safeInsets,
        this.controlScale,
      )),
    };
  }

  /** 只在首次同步写轨迹；原生崩溃不会经过 JS 异常钩子，靠这些阶段点缩小范围。 */
  private traceSyncStage(stage: string): void {
    if (this.syncTraceDone) return;
    nativeTrace(`hud:sync ${stage}`);
  }

  syncCombat(snapshot: CombatSnapshot): void {
    this.traceSyncStage('enter');
    this.latestSnapshot = snapshot;
    this.setTrainingOpen(this.shouldShowTraining());
    this.setPauseOpen(snapshot.paused && !this.homeOpen && !this.loadoutOpen && !this.outpostOpen && !this.defeatOpen);
    this.setDefeatOpen(snapshot.mission.status === 'failed');
    if (snapshot.mission.status === 'failed') {
      this.canReturn = false;
      this.canDock = false;
      return;
    }
    this.canReturn = snapshot.expedition.canReturn;
    this.canDock = snapshot.navigation.canDock;
    const returning = snapshot.expedition.phase === 'returning';
    if (returning !== this.returning) {
      this.returning = returning;
      this.refreshActionVisibility();
      if (this.stickThumb) this.stickThumb.active = this.combatChromeVisible && !returning;
      if (this.loadoutButton) this.loadoutButton.active = this.combatChromeVisible && !returning;
    }
    if (this.outpostStatusLabel) {
      this.outpostStatusLabel.string = this.text('outpost.status', {
        hull: Math.ceil(snapshot.player.health),
        shield: Math.ceil(snapshot.player.shield),
        energy: Math.ceil(snapshot.player.energy),
      });
    }
    if (this.outpostCargoLabel) {
      this.outpostCargoLabel.string = this.interiorOpen
        ? this.cargoManifestText(snapshot)
        : this.text('outpost.cargo', { value: snapshot.navigation.securedCargoValue });
    }
    // 前哨面板打开时用最新 snapshot 刷新真实三量与星港券（不写死 100/80/100）。
    if (this.outpostOpen) this.updateOutpostReadouts();
    if (this.touchEnabled) this.ensureReturnAction();
    if (!this.loadoutOpen) {
      this.pendingLoadout = resolveLoadout(snapshot.loadout);
      this.appliedLoadout = resolveLoadout(snapshot.loadout);
    }
    if (this.statusLabel) {
      this.statusLabel.string = [
        this.text('status.hull', { current: Math.ceil(snapshot.player.health), max: snapshot.player.maxHealth }),
        this.text('status.shield', { current: Math.ceil(snapshot.player.shield), max: snapshot.player.maxShield }),
        this.text('status.energy', { current: Math.ceil(snapshot.player.energy), max: snapshot.player.maxEnergy }),
      ].join('   ');
    }
    this.traceSyncStage('resource bars');
    this.drawResourceBar(this.hullStatusBar, snapshot.player.health, snapshot.player.maxHealth, HUD_GREEN, snapshot.player.health <= snapshot.player.maxHealth * 0.3);
    this.drawResourceBar(this.shieldStatusBar, snapshot.player.shield, snapshot.player.maxShield, HUD_CYAN);
    this.drawResourceBar(this.energyStatusBar, snapshot.player.energy, snapshot.player.maxEnergy, HUD_ACTIVE);
    this.updateAbilityReadout(snapshot);
    if (this.objectiveLabel) {
      if (this.tutorialHint) {
        // 教学关：目标读数行让位给当前待办步骤，不遮挡战场、不冻结输入。
        this.objectiveLabel.string = `${this.text('tutorial.step', {
          current: this.tutorialHint.current, total: this.tutorialHint.total,
        })}  ${this.text(this.tutorialHint.key)}`;
      } else {
        const paused = snapshot.paused ? `  |  ${this.text('objective.paused')}` : '';
        const phaseKey: CombatMessageKey = snapshot.expedition.phase === 'decision'
          ? 'expedition.decision'
          : snapshot.expedition.phase === 'deep-zone' ? 'expedition.deepZone'
            : snapshot.expedition.phase === 'returning' || snapshot.expedition.phase === 'complete'
              ? 'expedition.return' : 'expedition.primary';
        this.objectiveLabel.string = `${this.text(phaseKey)}  ${this.objectiveProgressText(snapshot)}${paused}`;
      }
    }
    if (this.sectorLabel) {
      // 航区与波次：让玩家始终知道自己在哪、打到第几波（此前完全未显示）
      // 决策阶段附带按键提示：波次改为玩家主动推进，不提示就没人知道要按什么。
      const advancing = snapshot.expedition.phase === 'decision';
      const waveText = this.text('objective.sectorWave', {
        sector: snapshot.mission.sectorName,
        wave: snapshot.mission.wave,
      });
      // 区域规则提示：告诉玩家这个扇区有什么特殊限制（峡谷会掉血 / 风暴缩短锁定 …）
      const regionText = this.regionText(snapshot);
      this.sectorLabel.string = advancing
        ? `${waveText}  |  ${this.text('objective.advanceHint')}`
        : waveText;
      if (regionText) {
        this.sectorLabel.string = `${this.sectorLabel.string}  |  ${regionText}`;
      }
      this.sectorLabel.color = advancing ? HUD_ACTIVE : HUD_CYAN;
    }
    if (this.cargoLabel) {
      this.cargoLabel.string = this.text('cargo.capacity', {
        used: snapshot.cargo.usedSlots,
        capacity: snapshot.cargo.capacity,
      });
      this.cargoLabel.color = snapshot.cargo.usedSlots > 0 ? HUD_ACTIVE : HUD_WHITE;
    }
    if (this.navigationLabel) {
      const returning = snapshot.expedition.phase === 'returning';
      if (returning) {
        const percent = Math.round(snapshot.expedition.returnProgress * 100);
        this.navigationLabel.string = this.text('navigation.returning', { percent });
        this.navigationLabel.color = HUD_ACTIVE;
      } else {
        this.navigationLabel.string = this.canDock
          ? this.text('navigation.dockReady')
          : this.text('navigation.outpostRange', { range: Math.round(snapshot.navigation.outpostRange) });
        this.navigationLabel.color = this.canDock ? HUD_ACTIVE : HUD_WHITE;
      }
    }
    if (this.debugTelemetryLabel) {
      const enemies = snapshot.enemies;
      const pp = snapshot.player.position;
      let nearest = Infinity;
      for (const e of enemies) {
        const dx = e.position.x - pp.x;
        const dy = e.position.y - pp.y;
        const dz = e.position.z - pp.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < nearest) nearest = d;
      }
      const nearestStr = enemies.length > 0 ? `${Math.round(nearest)}m` : '—';
      this.debugTelemetryLabel.string =
        `DBG ${BUILD_INFO.version} | 敌机:${enemies.length} 最近:${nearestStr} ` +
        `速度:${Math.round(snapshot.player.speedScale * 100)}% ` +
        `前哨:${Math.round(snapshot.navigation.outpostRange)}m ` +
        `dock:${snapshot.navigation.canDock ? 'Y' : 'N'} ret:${snapshot.expedition.canReturn ? 'Y' : 'N'}`;
    }
    if (this.targetLabel) {
      const target = snapshot.target?.locked ? snapshot.target : null;
      const health = target ? Math.max(0, target.health / target.maxHealth) : 0;
      const segments = target ? Math.max(0, Math.min(10, Math.ceil(health * 10))) : 0;
      this.targetLabel.string = target
        ? this.text('target.locked', {
          kind: this.text(`target.role.${target.role}` as CombatMessageKey),
          bar: `${'■'.repeat(segments)}${'□'.repeat(10 - segments)}`,
          current: Math.ceil(target.health),
          max: target.maxHealth,
          range: this.text('target.range', { range: Math.round(target.range) }),
        })
        : this.text('target.none');
      this.targetLabel.color = target ? HUD_ACTIVE : HUD_WHITE;
      this.traceSyncStage('target health');
      this.drawTargetHealth(target?.health || 0, target?.maxHealth || 1, Boolean(target));
      this.lastTargetId = target?.id || '';
      this.lastTargetHealth = target?.health ?? Number.POSITIVE_INFINITY;
    }
    for (const event of snapshot.combatEvents) {
      if (event.id <= this.lastCombatEventId) continue;
      this.lastCombatEventId = event.id;
      if (event.type === 'weapon-fired' && event.source === 'player') {
        this.shotFeedbackFrames = 7;
      } else if (event.type === 'hit' && event.source === 'player') {
        this.hitFeedbackFrames = event.lethal ? 30 : 18;
        this.hitFeedbackLethal = event.lethal === true;
        this.showCombatFeed(this.text('feedback.hit', { damage: Math.ceil(event.damage || 0) }), HUD_WHITE, 42);
      } else if (event.type === 'destroyed' && event.source === 'player') {
        this.hitFeedbackFrames = 24;
        this.hitFeedbackLethal = true;
        this.showCombatFeed(this.text('feedback.destroyed'), HUD_ACTIVE, 52);
      } else if (event.type === 'wave-start') {
        this.showCombatFeed(this.text('feedback.wave', {
          wave: event.wave || snapshot.mission.wave,
          threat: event.threatTier || snapshot.expedition.threat,
        }), HUD_CYAN, 90);
      } else if (event.type === 'shield-break') {
        this.showCombatFeed(this.text('feedback.shieldBreak'), HUD_RED, 54);
      } else if (event.type === 'rivalry-start') {
        this.showCombatFeed(this.text('feedback.rivalry'), HUD_ACTIVE, 90);
      } else if (event.type === 'rivalry-end') {
        this.showCombatFeed(this.text('feedback.rivalryEnd'), HUD_WHITE, 50);
      } else if (event.type === 'ion-storm') {
        this.showCombatFeed(this.text('feedback.ionStorm'), HUD_CYAN, 90);
      } else if (event.type === 'supply-drop') {
        this.showCombatFeed(this.text('feedback.supplyDrop'), HUD_ACTIVE, 90);
      } else if (event.type === 'weapons-swapped') {
        this.showCombatFeed(this.text('feedback.weaponSwap'), HUD_ACTIVE, 54);
      }
    }
    if (snapshot.player.pickupsCollected > this.lastPickupCount) {
      this.showCombatFeed(this.text('feedback.cargoRecovered'), HUD_ACTIVE, 60);
      this.hitFeedbackFrames = Math.max(this.hitFeedbackFrames, 10);
    }
    this.lastPickupCount = snapshot.player.pickupsCollected;
    const latestPlayerProjectile = [...snapshot.projectiles]
      .reverse()
      .find((projectile) => projectile.owner === 'player');
    if (latestPlayerProjectile && latestPlayerProjectile.id !== this.lastPlayerProjectileId) {
      this.lastPlayerProjectileId = latestPlayerProjectile.id;
      this.shotFeedbackFrames = 5;
    }
    this.traceSyncStage('reticle');
    this.drawReticle(
      this.shotFeedbackFrames > 0 ? HUD_ACTIVE : HUD_CYAN,
      this.shotFeedbackFrames > 0,
      snapshot.target?.locked === true,
    );
    this.traceSyncStage('hit marker');
    this.drawHitMarker(this.hitFeedbackFrames > 0, this.hitFeedbackLethal);
    this.traceSyncStage('return progress');
    this.drawReturnProgress(snapshot.expedition.returnProgress);
    this.traceSyncStage('return overlay');
    this.updateReturnOverlay(snapshot);
    this.updateComboReadout(snapshot.combo);
    this.updateUpgradeReadout(snapshot.upgrades);
    this.updateWeaponReadout(snapshot);
    this.shotFeedbackFrames = Math.max(0, this.shotFeedbackFrames - 1);
    this.hitFeedbackFrames = Math.max(0, this.hitFeedbackFrames - 1);
    this.combatFeedFrames = Math.max(0, this.combatFeedFrames - 1);
    if (this.combatFeedLabel) this.combatFeedLabel.node.active = this.combatFeedFrames > 0;
    this.traceSyncStage('done');
    this.syncTraceDone = true;
  }

  showBootState(message: string, progress?: number): void {
    if (this.bootStatusLabel) this.bootStatusLabel.string = message;
    // 外层传入真实加载进度时优先采用；未传才退回旧的中文关键字兜底（仅兼容旧调用）。
    const value = progress !== undefined ? progress : (message.includes('战机') ? 0.78 : 0.42);
    this.drawBootProgress(value);
    if (this.statusLabel) {
      this.statusLabel.string = this.text('status.system', { message });
      this.statusLabel.color = HUD_CYAN;
    }
    if (this.objectiveLabel) this.objectiveLabel.string = this.text('objective.flightSystem');
    if (this.targetLabel) this.targetLabel.string = this.text('target.initializing');
  }

  showBootError(message: string): void {
    if (this.bootStatusLabel) {
      this.bootStatusLabel.string = message;
      this.bootStatusLabel.color = HUD_ACTIVE;
    }
    this.drawBootProgress(0.18, HUD_ACTIVE);
    if (this.statusLabel) {
      this.statusLabel.string = this.text('status.startupError', { message });
      this.statusLabel.color = HUD_ACTIVE;
    }
    if (this.objectiveLabel) this.objectiveLabel.string = this.text('objective.loadFailed');
    if (this.targetLabel) this.targetLabel.string = this.text('target.restart');
  }

  public showPreflight(): void {
    // 启动流程收口：此后由各面板状态决定是否显示战斗控件（主页仍是隐藏）。
    this.startupVisible = false;
    nativeTrace('hud: showPreflight');
    this.preflight = true;
    if (this.bootPanel) this.bootPanel.active = false;
    // 0.13.30：HBP-AL00 的偶发 SIGSEGV 发生在主面板激活后的首个渲染帧，
    // 报告原先停在「combat presentation ready」完全没有后续轨迹。这里把打开前后拆开打点。
    nativeTrace('hud: showPreflight before setHomeOpen');
    this.setHomeOpen(true);
    nativeTrace('hud: showPreflight after setHomeOpen');
  }

  /** 由 CombatBootstrap 在结算后调用：把「本趟 +N 星港券」显示进前哨面板。 */
  public showTicketSettlement(amount: number): void {
    this.lastTicketGain = Math.max(0, Math.round(amount));
    this.updateOutpostReadouts();
  }

  /** 离港 / 重新出击时清空本趟收益，避免下一趟站内面板沿用上一趟的「+N」。 */
  public clearTicketSettlement(): void {
    this.lastTicketGain = 0;
    this.updateOutpostReadouts();
  }

  /** 舱内物资台账：按货舱五类分组统计，比单个「保全货值」更能看出这趟捡了什么。 */
  private cargoManifestText(snapshot: CombatSnapshot): string {
    const items = snapshot.cargo?.items ?? [];
    if (items.length === 0) return this.text('outpost.interiorEmpty');
    const categories: readonly (readonly [string, CombatMessageKey])[] = [
      ['equipment', 'cargo.category.equipment'],
      ['material', 'cargo.category.material'],
      ['currency', 'cargo.category.currency'],
      ['intel', 'cargo.category.intel'],
      ['cosmetic', 'cargo.category.cosmetic'],
    ];
    const parts: string[] = [];
    for (const [key, label] of categories) {
      const count = items.filter((item) => item.category === key).length;
      if (count > 0) parts.push(`${this.text(label)} ${count}`);
    }
    return parts.length > 0 ? parts.join('   ') : this.text('outpost.interiorEmpty');
  }

  private toggleInterior(): void {
    this.interiorOpen = !this.interiorOpen;
    this.setButtonText(
      this.outpostInteriorButton,
      this.text(this.interiorOpen ? 'outpost.interiorBack' : 'outpost.interior'),
    );
    if (this.outpostCargoLabel && this.latestSnapshot) {
      this.outpostCargoLabel.string = this.interiorOpen
        ? this.cargoManifestText(this.latestSnapshot)
        : this.text('outpost.cargo', {
          value: this.latestSnapshot.navigation.securedCargoValue,
        });
    }
  }

  /** 新手关四步引导：只改目标读数行，玩家仍可自由飞行与开火。 */
  public setTutorialStep(current: number, total: number, key: CombatMessageKey): void {
    this.tutorialHint = { current, total, key };
  }

  public clearTutorialStep(): void {
    this.tutorialHint = null;
  }

  public enterOutpost(): void {
    this.preflight = false;
    this.loadoutFromOutpost = false;
    this.interiorOpen = false;
    this.setButtonText(this.outpostInteriorButton, this.text('outpost.interior'));
    if (this.returnOverlay) this.returnOverlay.active = false;
    this.setLoadoutOpen(false);
    this.setHomeOpen(false);
    this.setOutpostOpen(true);
    this.inputReleaseVisuals();
  }

  isLoadoutOpen(): boolean {
    // ⚠️ 必须含 pauseOpen：否则打开暂停菜单时主循环不冻结仿真，
    // 敌机/陨石仍在后台推进并击中玩家 → 「进菜单回来掉血」的根因。
    // blocksFlightInput() 已含 pauseOpen（输入已屏蔽），此处补齐仿真冻结才一致。
    return this.loadoutOpen || this.homeOpen || this.outpostOpen || this.defeatOpen || this.pauseOpen;
  }

  /** 是否正在 3D 站内自由行走（Bootstrap 据此决定是否消费输入驱动化身）。 */
  isWalking(): boolean {
    return this.walkActive;
  }

  /** 站内面板是否打开（行走时靠近终端弹面板，期间冻结行走输入）。 */
  isStationOpen(): boolean {
    return this.stationOpen;
  }

  blocksFlightInput(): boolean {
    return this.loadoutOpen || this.homeOpen || this.outpostOpen || this.defeatOpen
      || this.pauseOpen || this.keybindOpen || this.runlogOpen || this.shouldShowTraining();
  }

  allowsPauseToggle(): boolean {
    return !this.loadoutOpen && !this.homeOpen && !this.outpostOpen && !this.defeatOpen
      && !this.keybindOpen && !this.runlogOpen;
  }

  destroy(): void {
    // 键位捕获是全局事件，销毁时必须注销，否则场景重载后会重复绑定。
    if (this.keyCaptureAttached) {
      cocosInput.off(Input.EventType.KEY_DOWN, this.onKeyCapture, this);
      this.keyCaptureAttached = false;
    }
    // 异步贴图回调可能晚于 destroy 返回：置标记并清空引用，避免写已销毁节点。
    this.destroyed = true;
    this.bootKeyArt = null;
    this.homeKeyArt = null;
    this.loadoutHangarArt = null;
    this.outpostKeyArt = null;
    this.outpostArtFrame = null;
    this.outpostInteriorFrame = null;
    this.combatZoneArtFrame = null;
    this.hangarArtFrame = null;
    this.marketArtFrame = null;
    this.actionVisuals.clear();
    this.root.destroy();
  }

  /** 外层回灌联机状态、detail 与邀请码/应答码；面板未打开时先缓存，打开即显示。 */
  public setCoopState(state: CoopHudState, detail?: string, code?: string): void {
    this.coopState = state;
    this.coopDetail = detail ?? '';
    this.coopCode = code ?? '';
    this.updateCoopLabels();
  }

  private createStatus(): void {
    this.statusLabel = this.createLabel('FlightStatus', 15, HUD_WHITE);
    this.statusLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    // 顶部信息区底板：必须在这三行文字**之前**创建 —— Cocos 按 sibling 顺序绘制，
    // 先创建的在下，底板才压得住文字（反过来会把文字盖掉）。
    this.objectivePlate = attachGraphics(this.createNode('ObjectivePlate'));
    this.objectiveLabel = this.createLabel('ObjectiveStatus', 17, HUD_CYAN);
    this.sectorLabel = this.createLabel('SectorStatus', 14, HUD_WHITE);
    this.sectorLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
    this.targetLabel = this.createLabel('TargetStatus', 14, HUD_ACTIVE);
    this.cargoLabel = this.createLabel('CargoStrip', 14, HUD_WHITE);
    this.cargoLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;
    this.hullStatusBar = attachGraphics(this.createNode('HullStatusBar'));
    this.shieldStatusBar = attachGraphics(this.createNode('ShieldStatusBar'));
    this.energyStatusBar = attachGraphics(this.createNode('EnergyStatusBar'));
    this.targetHealthBar = attachGraphics(this.createNode('TargetHealthBar'));
    this.hitMarker = attachGraphics(this.createNode('HitMarker'));
    this.combatFeedLabel = this.createLabel('CombatFeedLabel', 18, HUD_WHITE);
    this.navigationLabel = this.createLabel('OutpostNavigationLabel', 13, HUD_WHITE);
    this.comboLabel = this.createLabel('ComboCounter', 22, HUD_ACTIVE);
    this.comboLabel.node.active = false;
    this.upgradeLabel = this.createLabel('ActiveUpgrades', 14, new Color(255, 224, 140, 255));
    this.upgradeLabel.node.active = false;
    this.weaponLabel = this.createLabel('WeaponReadout', 14, HUD_WHITE);
    this.weaponLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.weaponLabel.node.active = true;
    this.abilityLabel = this.createLabel('AbilityReadout', 13, HUD_CYAN);
    this.abilityLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.abilityLabel.node.active = true;
    this.debugTelemetryLabel = this.createLabel('DebugTelemetry', 11, new Color(180, 255, 180, 255));
    this.debugTelemetryLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    // 调试遥测只供本地排查，正式包必须隐藏（此前直接泄漏在战斗 HUD 左上角）。
    this.debugTelemetryLabel.node.active = false;
    this.objectiveLabel.node.name = 'ExpeditionObjectiveStrip';
    this.layoutStatus();
  }

  private layoutStatus(): void {
    const usableWidth = Math.max(240, this.width - this.safeInsets.left - this.safeInsets.right);
    const statusWidth = Math.min(340, usableWidth - 24);
    const statusCenterX = this.leftHanded
      ? this.width - this.safeInsets.right - 12 - (statusWidth / 2)
      : this.safeInsets.left + 12 + (statusWidth / 2);
    this.statusLabel?.node.setPosition(this.canvasPosition(
      statusCenterX,
      this.safeInsets.top + 20,
    ));
    this.statusLabel?.getComponent(UITransform)?.setContentSize(
      statusWidth,
      32,
    );
    const statusBarX = this.leftHanded
      ? this.width - this.safeInsets.right - 12 - statusWidth
      : this.safeInsets.left + 12;
    // 三条资源条拉开到 12px 间距，避免首尾相接糊成一条双色格带。
    this.hullStatusBar?.node.setPosition(this.canvasPosition(statusBarX, this.safeInsets.top + 41, 2));
    this.shieldStatusBar?.node.setPosition(this.canvasPosition(statusBarX, this.safeInsets.top + 53, 2));
    this.energyStatusBar?.node.setPosition(this.canvasPosition(statusBarX, this.safeInsets.top + 65, 2));
    this.debugTelemetryLabel?.node.setPosition(this.canvasPosition(
      this.safeInsets.left + 12,
      this.safeInsets.top + 82,
    ));
    this.objectiveLabel?.node.setPosition(this.canvasPosition(
      this.width / 2,
      this.safeInsets.top + 44,
    ));
    this.objectiveLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(320, usableWidth * 0.48),
      30,
    );
    // 航区/波次：紧贴目标条下方居中，玩家一眼可见当前位置与进度
    this.sectorLabel?.node.setPosition(this.canvasPosition(
      this.width / 2,
      this.safeInsets.top + 72,
    ));
    this.sectorLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(320, usableWidth * 0.48),
      20,
    );
    // 目标锁定读数下移到航区行下方，避免「无目标」压在「当前区域…」上。
    this.targetLabel?.node.setPosition(this.canvasPosition(
      this.width / 2,
      this.safeInsets.top + 100,
    ));
    this.targetLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(360, usableWidth * 0.58),
      24,
    );
    // 目标血条紧贴在目标名下方，两者之间留出净空，不再与「当前区域…」那行挤在一起。
    this.targetHealthBar?.node.setPosition(this.canvasPosition(this.width / 2, this.safeInsets.top + 118, 2));
    // 顶部信息区统一底板：三行读数合成一块，而不是三串浮在星空上的散字。
    if (this.objectivePlate) {
      const plateWidth = Math.min(340, usableWidth * 0.5);
      this.objectivePlate.node.setPosition(this.canvasPosition(
        this.width / 2,
        this.safeInsets.top + 70,
        1,
      ));
      this.safeClear(this.objectivePlate);
      this.objectivePlate.fillColor = new Color(3, 11, 16, 150);
      this.safeRoundRect(
        this.objectivePlate,
        -(plateWidth / 2),
        -48,
        plateWidth,
        96,
        10,
      );
      this.safeFill(this.objectivePlate);
      this.objectivePlate.strokeColor = new Color(79, 214, 224, 70);
      this.objectivePlate.lineWidth = 1;
      this.safeRoundRect(
        this.objectivePlate,
        -(plateWidth / 2),
        -48,
        plateWidth,
        96,
        10,
      );
      this.safeStroke(this.objectivePlate);
    }
    this.hitMarker?.node.setPosition(this.canvasPosition(this.width / 2, this.height / 2, 4));
    this.combatFeedLabel?.node.setPosition(this.canvasPosition(this.width / 2, (this.height / 2) + 48, 5));
    this.combatFeedLabel?.getComponent(UITransform)?.setContentSize(Math.min(420, usableWidth - 32), 34);
    // 导航读数（前哨距离 / 可停靠提示）改挂左下信息列：
    // 底部中央是「停靠 / 返航」动作片的地盘，两者同位会整行叠字（真机截图实锤）。
    // 2026-11-19 修正：摇杆圆盘中心 y（距顶部）约 height-bottom-radius-edgeGap，半径 radius；
    // 原先距底 34/60/88 的三行读数正好压在圆盘/白色拇指上（真机截图：距离/火控/主副武器
    // 被拇指盖住）。统一上移到摇杆圆盘上沿之外，竖排三行，仍留在左下安全区。
    // touch 坐标 y 自顶部向下：圆盘上沿 = stick.y - stick.radius。
    const stick = this.touchLayout().movement;
    const stickUpperY = stick.y - stick.radius;
    const readoutX = this.leftHanded
      ? this.width - this.safeInsets.right - 12 - 140
      : this.safeInsets.left + 12 + 140;
    // 三行自上而下：前哨距离 / 副武器 / 技能；整组底边留在圆盘上沿之上 18px。
    const readoutTopY = Math.max(this.safeInsets.top + 150, stickUpperY - 70);
    this.navigationLabel?.node.setPosition(this.canvasPosition(readoutX, readoutTopY, 4));
    this.navigationLabel?.getComponent(UITransform)?.setContentSize(280, 24);
    if (this.navigationLabel) this.navigationLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.weaponLabel?.node.setPosition(this.canvasPosition(readoutX, readoutTopY + 26, 4));
    this.weaponLabel?.getComponent(UITransform)?.setContentSize(280, 28);
    if (this.weaponLabel) this.weaponLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.abilityLabel?.node.setPosition(this.canvasPosition(readoutX, readoutTopY + 52, 4));
    this.abilityLabel?.getComponent(UITransform)?.setContentSize(280, 24);
    if (this.abilityLabel) this.abilityLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.comboLabel?.node.setPosition(this.canvasPosition(this.width / 2, this.safeInsets.top + 144, 6));
    this.comboLabel?.getComponent(UITransform)?.setContentSize(Math.min(340, usableWidth - 40), 30);
    // 强化读数再往上挪一格，避开返航动作片的顶部。
    this.upgradeLabel?.node.setPosition(this.canvasPosition(this.width / 2, this.height - this.safeInsets.bottom - 124, 5));
    this.upgradeLabel?.getComponent(UITransform)?.setContentSize(Math.min(440, usableWidth - 32), 28);
    // 窄屏(<600)：货舱读数下移一行并缩宽、保持右对齐，避免 375 宽竖屏与 statusLabel 重叠。
    const narrow = usableWidth < 600;
    const cargoWidth = narrow ? Math.min(200, usableWidth - 24) : 236;
    this.cargoLabel?.node.setPosition(this.canvasPosition(
      this.width - this.safeInsets.right - (narrow ? 12 + (cargoWidth / 2) : 130),
      this.safeInsets.top + (narrow ? 52 : 20),
    ));
    this.cargoLabel?.getComponent(UITransform)?.setContentSize(cargoWidth, 30);
  }

  /**
   * 矢量绘制层降级提示。
   *
   * Label 是真机上唯一能稳定渲染的元素（此前按钮边框 / 摇杆 / 准星整片隐形，
   * 界面却毫无提示，只能靠猜）。拿不到白纹理帧时就在左上角挂一枚琥珀色徽标，
   * 下次截图一眼就能分清是「图形层坏了」还是「布局错了」。
   */
  private refreshGraphicsLayerBadge(): void {
    if (graphicsLayerReady()) {
      if (this.graphicsBadge) this.graphicsBadge.node.active = false;
      return;
    }
    if (!this.graphicsBadge) {
      this.graphicsBadge = this.createLabel('NativeGraphicsBadge', 13, HUD_ACTIVE);
      this.graphicsBadge.horizontalAlign = HorizontalTextAlignment.LEFT;
    }
    this.graphicsBadge.node.active = true;
    this.graphicsBadge.string = 'HUD 图形层降级：白纹理不可用';
    this.graphicsBadge.node.setPosition(this.canvasPosition(
      this.safeInsets.left + 12 + 110,
      this.safeInsets.top + 82,
      9,
    ));
    this.graphicsBadge.getComponent(UITransform)?.setContentSize(220, 20);
  }

  private createReticle(): void {    const node = this.createNode('AimReticle');
    this.reticleGraphics = attachGraphics(node);
    this.drawReticle(HUD_CYAN);
  }

  private drawReticle(accent: Color, recoil = false, locked = false): void {
    const graphics = this.reticleGraphics;
    if (!graphics) return;
    const recoilOffset = recoil ? 6 : 0;
    const inner = 10 + recoilOffset;
    const outer = 24 + recoilOffset;
    this.safeClear(graphics);
    graphics.strokeColor = accent;
    graphics.fillColor = accent;
    graphics.lineWidth = 2;
    this.safeCircle(graphics, 0, 0, inner);
    this.safeMoveTo(graphics, -outer, 0);
    this.safeLineTo(graphics, -inner, 0);
    this.safeMoveTo(graphics, inner, 0);
    this.safeLineTo(graphics, outer, 0);
    this.safeMoveTo(graphics, 0, -outer);
    this.safeLineTo(graphics, 0, -inner);
    this.safeMoveTo(graphics, 0, inner);
    this.safeLineTo(graphics, 0, outer);
    this.safeMoveTo(graphics, -38, -30);
    this.safeLineTo(graphics, -13, -9);
    this.safeMoveTo(graphics, 38, -30);
    this.safeLineTo(graphics, 13, -9);
    this.safeStroke(graphics);
    if (locked) {
      graphics.lineWidth = 1.5;
      this.safeMoveTo(graphics, -7, -18);
      this.safeLineTo(graphics, 0, -23);
      this.safeLineTo(graphics, 7, -18);
      this.safeMoveTo(graphics, -7, 18);
      this.safeLineTo(graphics, 0, 23);
      this.safeLineTo(graphics, 7, 18);
      this.safeStroke(graphics);
    }
    this.safeCircle(graphics, 0, 0, 2.5);
    this.safeFill(graphics);
  }

  /**
   * Cocos 3.8 原生 2D 绑定在零 / 负 / NaN 几何上会生成空或畸形路径，
   * 随后 fill() / stroke() 触发 std::out_of_range: vector 并直接 SIGABRT
   * （2026-11-10 实机「初始化主页叠摇杆 + 立刻闪退」复现）。
   * 统一把几何收敛到合法最小尺寸，保证每次 fill/stroke 前都有可三角化的路径。
   */
  /** 每个 Graphics 自上次 clear 以来是否累积了可绘制几何；空路径 fill/stroke 会让原生 2D 绑定越界。 */
  private graphicsPathSegments = new WeakMap<Graphics, number>();

  private markGraphicsPath(graphics: Graphics): void {
    this.graphicsPathSegments.set(graphics, (this.graphicsPathSegments.get(graphics) ?? 0) + 1);
  }

  private safeClear(graphics: Graphics): void {
    graphics.clear();
    this.graphicsPathSegments.set(graphics, 0);
  }

  private safeMoveTo(graphics: Graphics, x: number, y: number): void {
    graphics.moveTo(this.safeCoord(x), this.safeCoord(y));
  }

  private safeLineTo(graphics: Graphics, x: number, y: number): void {
    graphics.lineTo(this.safeCoord(x), this.safeCoord(y));
    this.markGraphicsPath(graphics);
  }

  private safeClose(graphics: Graphics): void {
    graphics.close();
    this.markGraphicsPath(graphics);
  }

  private safeFill(graphics: Graphics): void {
    // 0.13.16 这里默认按 1 放行，导致「从未提交任何几何」的 Graphics 也会执行
    // 空路径 fill()，原生端随即 vector::at 越界。默认改为 0：只有确实画过几何才提交。
    // 所有正常绘制块都会先经过 safeRect/Circle/LineTo 等 mark，视觉不受影响。
    if ((this.graphicsPathSegments.get(graphics) ?? 0) <= 0) return;
    graphics.fill();
  }

  private safeStroke(graphics: Graphics): void {
    if ((this.graphicsPathSegments.get(graphics) ?? 0) <= 0) return;
    graphics.stroke();
  }

  private safeCoord(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private safeLength(value: number): number {
    return Number.isFinite(value) ? Math.max(1, value) : 1;
  }

  private safeRect(graphics: Graphics, x: number, y: number, width: number, height: number): void {
    graphics.rect(this.safeCoord(x), this.safeCoord(y), this.safeLength(width), this.safeLength(height));
    this.markGraphicsPath(graphics);
  }

  private safeCircle(graphics: Graphics, x: number, y: number, radius: number): void {
    graphics.circle(this.safeCoord(x), this.safeCoord(y), this.safeLength(radius));
    this.markGraphicsPath(graphics);
  }

  private safeRoundRect(
    graphics: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const w = this.safeLength(width);
    const h = this.safeLength(height);
    graphics.roundRect(this.safeCoord(x), this.safeCoord(y), w, h,
      Math.min(this.safeLength(radius), w / 2, h / 2));
    this.markGraphicsPath(graphics);
  }

  private safeArc(
    graphics: Graphics,
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise: boolean,
  ): void {
    const start = Number.isFinite(startAngle) ? startAngle : 0;
    const end = Number.isFinite(endAngle) ? endAngle : start;
    const span = Math.abs(end - start);
    // 0.13.16 曾把零跨度抬成 0.01 弧度「保底」，结果原生端只细分出 0~1 个点，
    // 随后的 stroke() 在 polyline 生成器里 vector::at 越界并 SIGABRT（真机实测）。
    // 极小跨度直接不提交几何；原型层守卫还会再做一次同样的拦截。
    if (!Number.isFinite(span) || span < 0.12) return;
    graphics.arc(this.safeCoord(x), this.safeCoord(y), this.safeLength(radius), start, end, counterclockwise);
    this.markGraphicsPath(graphics);
  }

  private drawResourceBar(
    graphics: Graphics | null,
    value: number,
    maximum: number,
    accent: Color,
    critical = false,
  ): void {
    if (!graphics) return;
    const width = Math.min(278, Math.max(156, this.width * 0.2));
    const ratio = Math.max(0, Math.min(1, maximum > 0 ? value / maximum : 0));
    this.safeClear(graphics);
    // 战术分段条：平滑填充 + 等距刻度，与网页端 HUD 的分段状态条保持同一视觉语言。
    graphics.fillColor = new Color(3, 10, 14, 196);
    this.safeRect(graphics, 0, -4, width, 8);
    this.safeFill(graphics);
    graphics.fillColor = critical ? HUD_RED : accent;
    this.safeRect(graphics, 0, -4, width * ratio, 8);
    this.safeFill(graphics);
    graphics.fillColor = new Color(3, 10, 14, 235);
    const segments = 18;
    const step = width / segments;
    for (let index = 1; index < segments; index += 1) {
      this.safeRect(graphics, index * step - 1, -4, 2, 8);
    }
    this.safeFill(graphics);
    graphics.strokeColor = new Color(96, 160, 172, 120);
    graphics.lineWidth = 1;
    this.safeRect(graphics, 0, -5, width, 10);
    this.safeStroke(graphics);
  }

  private drawTargetHealth(value: number, maximum: number, visible: boolean): void {
    const graphics = this.targetHealthBar;
    if (!graphics) return;
    graphics.node.active = visible;
    this.safeClear(graphics);
    if (!visible) return;
    const width = Math.min(300, Math.max(180, this.width * 0.24));
    const ratio = Math.max(0, Math.min(1, maximum > 0 ? value / maximum : 0));
    graphics.fillColor = new Color(5, 12, 16, 210);
    this.safeRect(graphics, -width / 2, -3, width, 6);
    this.safeFill(graphics);
    graphics.fillColor = ratio < 0.25 ? HUD_RED : HUD_ACTIVE;
    this.safeRect(graphics, -width / 2, -3, width * ratio, 6);
    this.safeFill(graphics);
    graphics.strokeColor = new Color(226, 245, 255, 86);
    graphics.lineWidth = 1;
    this.safeRect(graphics, -width / 2, -4, width, 8);
    this.safeStroke(graphics);
  }

  private drawHitMarker(active: boolean, lethal = false): void {
    const graphics = this.hitMarker;
    if (!graphics) return;
    this.safeClear(graphics);
    if (!active) return;
    const inner = 9;
    const outer = 17;
    graphics.strokeColor = lethal ? HUD_ACTIVE : HUD_WHITE;
    graphics.lineWidth = lethal ? 3.5 : 2.5;
    for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      this.safeMoveTo(graphics, x * inner, y * inner);
      this.safeLineTo(graphics, x * outer, y * outer);
    }
    this.safeStroke(graphics);
    if (lethal) {
      this.safeCircle(graphics, 0, 0, 24);
      this.safeStroke(graphics);
    }
  }

  private showCombatFeed(message: string, color: Color, frames: number): void {
    if (!this.combatFeedLabel) return;
    this.combatFeedLabel.string = message;
    this.combatFeedLabel.color = color;
    this.combatFeedLabel.node.active = true;
    this.combatFeedFrames = Math.max(this.combatFeedFrames, frames);
    this.combatFeedLabel.node.setScale(1.12, 1.12, 1);
    tween(this.combatFeedLabel.node).to(0.1, { scale: new Vec3(1, 1, 1) }).start();
  }

  private createLoadoutPanel(): void {
    this.loadoutButton = this.createPanelButton('LoadoutOpen', this.text('loadout.open'), () => {
      this.preflight = false;
      this.setButtonText(this.applyLoadoutButton, this.text('loadout.apply'));
      this.setButtonText(this.closeLoadoutButton, this.text('loadout.back'));
      this.setLoadoutOpen(true);
    });
    this.loadoutPanel = this.createNode('NativeLoadoutPanel');
    this.loadoutHangarArt = this.createKeyArt('NativeLoadoutHangarArt', this.loadoutPanel);
    this.loadoutBackdrop = attachGraphics(this.createNode('NativeLoadoutShade', this.loadoutPanel));
    this.loadoutSlotRail = attachGraphics(this.createNode('NativeLoadoutSlotRail', this.loadoutPanel));
    this.loadoutSchematic = attachGraphics(this.createNode('NativeLoadoutShipSchematic', this.loadoutPanel));

    const title = this.createLabel('NativeLoadoutTitle', 24, HUD_WHITE, this.loadoutPanel);
    title.string = this.text('loadout.title');
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    title.getComponent(UITransform)?.setContentSize(600, 42);

    for (const slot of Object.keys(LOADOUT_OPTIONS) as NativeLoadoutSlot[]) {
      const button = this.createPanelButton(`Loadout.${slot}`, '', () => this.cycleLoadout(slot), this.loadoutPanel, 'slot');
      const label = button.getChildByName('Label')?.getComponent(Label);
      if (label) this.loadoutLabels.set(slot, label);
    }
    this.loadoutSummaryLabel = this.createLabel('NativeLoadoutSummary', 14, HUD_WHITE, this.loadoutPanel);
    this.loadoutSummaryLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.loadoutFeedbackLabel = this.createLabel('NativeLoadoutFeedback', 13, HUD_CYAN, this.loadoutPanel);
    this.loadoutFeedbackLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.loadoutDetailLabel = this.createLabel('NativeLoadoutDetail', 13, HUD_WHITE, this.loadoutPanel);
    this.loadoutDetailLabel.horizontalAlign = HorizontalTextAlignment.LEFT;

    this.applyLoadoutButton = this.createPanelButton('LoadoutApply', this.text('loadout.apply'), () => {
      this.commitLoadout(this.preflight);
    }, this.loadoutPanel, 'primary');
    this.closeLoadoutButton = this.createPanelButton('LoadoutClose', this.text('loadout.back'), () => {
      if (this.preflight) {
        this.pendingLoadout = resolveLoadout(this.appliedLoadout);
        this.commitLoadout(true);
        return;
      }
      if (this.loadoutFromOutpost) {
        this.pendingLoadout = resolveLoadout(this.appliedLoadout);
        this.loadoutFromOutpost = false;
        this.setLoadoutOpen(false);
        this.setOutpostOpen(true);
        return;
      }
      this.preflight = false;
      this.setLoadoutOpen(false);
    }, this.loadoutPanel);
    this.loadoutPanel.active = false;
    this.updateLoadoutLabels();
  }

  private createBootPanel(): void {
    this.bootPanel = this.createNode('NativeBootPanel');
    this.bootKeyArt = this.createKeyArt('NativeBootKeyArt', this.bootPanel);
    const shade = attachGraphics(this.createNode('NativeBootShade', this.bootPanel));
    shade.fillColor = new Color(1, 7, 10, 210);
    this.safeRect(shade, -640, -360, 1280, 720);
    this.safeFill(shade);

    const channel = this.createLabel('NativeBootChannel', 12, HUD_CYAN, this.bootPanel);
    channel.string = `ORBITAL FRONTIER  /  v${BUILD_INFO.version}  BUILD ${BUILD_INFO.build}`;
    channel.horizontalAlign = HorizontalTextAlignment.LEFT;
    const title = this.createLabel('NativeBootTitle', 42, HUD_WHITE, this.bootPanel);
    title.string = 'SPACEFIGHT';
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    const subtitle = this.createLabel('NativeBootSubtitle', 15, HUD_WHITE, this.bootPanel);
    subtitle.string = this.text('boot.subtitle');
    subtitle.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.bootStatusLabel = this.createLabel('NativeBootStatus', 12, HUD_WHITE, this.bootPanel);
    this.bootStatusLabel.string = this.text('boot.verifying');
    this.bootStatusLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.bootProgress = attachGraphics(this.createNode('NativeBootProgress', this.bootPanel));
    this.drawBootProgress(0.18);
  }

  private createDefeatPanel(): void {
    this.defeatPanel = this.createNode('NativeDefeatPanel');
    this.defeatBackdrop = attachGraphics(this.createNode('NativeDefeatShade', this.defeatPanel));
    const signal = this.createLabel('NativeDefeatSignal', 12, HUD_ACTIVE, this.defeatPanel);
    signal.string = this.text('defeat.signal');
    const title = this.createLabel('NativeDefeatTitle', 32, HUD_WHITE, this.defeatPanel);
    title.string = this.text('defeat.title');
    const detail = this.createLabel('NativeDefeatDetail', 14, HUD_WHITE, this.defeatPanel);
    detail.string = this.text('defeat.detail');
    const restart = this.createPanelButton('NativeDefeatRestart', this.text('defeat.restart'), () => {
      this.onRestart?.();
      this.setDefeatOpen(false);
    }, this.defeatPanel);
    const returnHome = this.createPanelButton('NativeDefeatReturn', this.text('defeat.return'), () => {
      this.onRestart?.();
      this.setDefeatOpen(false);
      // 显式回到「行动」视图，避免二次打开沿用旧 tab / 旧反馈文案。
      this.setHomeView('operations');
      this.setHomeOpen(true);
    }, this.defeatPanel);
    restart.setPosition(-102, -84, 3);
    returnHome.setPosition(102, -84, 3);
    this.resizePanelButton(restart, 190, 50, 14, HUD_ACTIVE);
    this.resizePanelButton(returnHome, 190, 50, 14);
    this.defeatPanel.active = false;
  }

  private createPausePanel(): void {
    this.pausePanel = this.createNode('NativePausePanel');
    this.pausePanel.addComponent(UIOpacity);
    this.pauseBackdrop = attachGraphics(this.createNode('NativePauseShade', this.pausePanel));
    const signal = this.createLabel('NativePauseSignal', 12, HUD_CYAN, this.pausePanel);
    signal.string = this.text('pause.signal');
    const title = this.createLabel('NativePauseTitle', 30, HUD_WHITE, this.pausePanel);
    title.string = this.text('pause.title');
    const detail = this.createLabel('NativePauseDetail', 13, HUD_WHITE, this.pausePanel);
    detail.string = this.text('pause.detail');
    this.createPanelButton('NativePauseResume', this.text('pause.resume'), () => this.onPauseToggle?.(), this.pausePanel, 'primary');
    this.createPanelButton('NativePauseOperations', this.text('pause.operations'), () => {
      this.onPauseToggle?.();
      this.setPauseOpen(false);
      this.setHomeView('hangar');
      this.setHomeOpen(true);
    }, this.pausePanel);
    // 明确的「返回基地」入口：暂停状态下也能干净地退出战斗、回到主菜单，
    // 避免此前只能从「作战(机库)」绕路、且战斗仍在后台推进的问题。
    this.createPanelButton('NativePauseHome', this.text('pause.home'), () => {
      // 先解除仿真暂停，再关面板开主页（与 NativePauseOperations 一致），否则战斗仍在后台冻结。
      this.onPauseToggle?.();
      this.setPauseOpen(false);
      this.setHomeView('operations');
      this.setHomeOpen(true);
    }, this.pausePanel);
    this.pausePanel.active = false;
  }

  // 首飞校准：新玩家第一次进战场时，用三步把「移动/瞄准/开火各自独立」讲清楚，
  // 避免因为误以为键位互相抢而一直玩不明白。没有这一步就只能靠试错。
  private createTrainingPanel(): void {
    this.trainingPanel = this.createNode('NativeTrainingPanel');
    this.trainingPanel.addComponent(UIOpacity);
    // 暗底必须挂独立子节点且先于文字创建：原生 Graphics 替身精灵走 node.addChild
    // 追加到末尾（=上层）。若直接 attach 到 panel，暗底精灵会排在 Label 之后把
    // "飞行校准/步骤/提示"整片盖住——这正是"校准的字没了"的根因。
    this.trainingBackdrop = attachGraphics(this.createNode('NativeTrainingShade', this.trainingPanel));
    this.trainingTitleLabel = this.createLabel('NativeTrainingTitle', 26, HUD_WHITE, this.trainingPanel);
    this.trainingStepLabel = this.createLabel('NativeTrainingStep', 12, HUD_CYAN, this.trainingPanel);
    this.trainingHintLabel = this.createLabel('NativeTrainingHint', 15, HUD_WHITE, this.trainingPanel);
    this.trainingNextButton = this.createPanelButton('NativeTrainingNext', '', () => this.advanceTraining(), this.trainingPanel, 'primary');
    this.trainingSkipButton = this.createPanelButton('NativeTrainingSkip', '', () => this.finishTraining(), this.trainingPanel);
    this.trainingPanel.active = false;
    this.refreshTrainingStep();
  }

  private static readonly TRAINING_STEPS: readonly CombatMessageKey[] = [
    'tutorial.move',
    'tutorial.aim',
    'tutorial.weapon',
  ];

  private refreshTrainingStep(): void {
    const total = NativeCombatHud.TRAINING_STEPS.length;
    if (this.trainingTitleLabel) this.trainingTitleLabel.string = this.text('tutorial.calibration');
    if (this.trainingStepLabel) {
      this.trainingStepLabel.string = this.text('tutorial.step', { current: this.trainingStep + 1, total });
    }
    if (this.trainingHintLabel) {
      this.trainingHintLabel.string = this.text(NativeCombatHud.TRAINING_STEPS[this.trainingStep] ?? 'tutorial.move');
    }
    const isLast = this.trainingStep >= total - 1;
    this.setButtonText(
      this.trainingNextButton,
      this.text(isLast ? 'tutorial.done' : 'tutorial.step', isLast ? {} : { current: this.trainingStep + 2, total }),
    );
    this.setButtonText(this.trainingSkipButton, this.text('tutorial.skip'));
  }

  private advanceTraining(): void {
    const total = NativeCombatHud.TRAINING_STEPS.length;
    if (this.trainingStep >= total - 1) {
      this.finishTraining();
      return;
    }
    this.trainingStep += 1;
    this.refreshTrainingStep();
  }

  private finishTraining(): void {
    this.trainingDone = true;
    this.setTrainingOpen(false);
  }

  private setTrainingOpen(open: boolean): void {
    if (!this.trainingPanel) return;
    // 状态守卫：syncCombat 每帧调用，状态未变时不再重置摇杆 / 全量重绘，
    // 否则回中 tween 每帧被 inputReleaseVisuals 打断，拇指永远回不了中（首次 open 仍会初始化）。
    if (this.trainingOpen === open && this.trainingPanel.active === open) return;
    this.trainingOpen = open;
    this.trainingPanel.active = open;
    if (open) {
      this.inputReleaseVisuals();
      this.refreshTrainingStep();
    }
  }

  /** 是否应当展示首飞校准：只在真正进入战斗、且本机尚未完成过时出现。 */
  private shouldShowTraining(): boolean {
    if (this.trainingDone || !this.touchEnabled) return false;
    if (this.homeOpen || this.loadoutOpen || this.outpostOpen || this.defeatOpen || this.pauseOpen) return false;
    const snapshot = this.latestSnapshot;
    if (!snapshot || snapshot.paused || snapshot.mission.status === 'failed') return false;
    return snapshot.mission.status === 'active';
  }

  /** 首飞校准是否正处于打开状态（供 CombatBootstrap 把玩家设为无敌，避免教学被打死）。 */
  public get isCalibrating(): boolean {
    return this.trainingOpen;
  }

  private layoutTrainingPanel(): void {
    const panel = this.trainingPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    // 框宽高由屏幕尺寸推导，窄屏不再溢出（旧版写死 540×264）。
    const frameW = Math.min(540, this.width - 32);
    const frameH = Math.min(300, this.height - 32);
    if (this.trainingBackdrop) {
      this.safeClear(this.trainingBackdrop);
      this.trainingBackdrop.fillColor = new Color(1, 6, 10, 168);
      this.safeRect(this.trainingBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.trainingBackdrop);
      this.trainingBackdrop.fillColor = new Color(3, 13, 20, 240);
      this.safeRect(this.trainingBackdrop, -frameW / 2, -frameH / 2, frameW, frameH);
      this.safeFill(this.trainingBackdrop);
      this.trainingBackdrop.strokeColor = HUD_CYAN;
      this.trainingBackdrop.lineWidth = 2;
      this.safeMoveTo(this.trainingBackdrop, -frameW / 2, frameH / 2);
      this.safeLineTo(this.trainingBackdrop, frameW / 2, frameH / 2);
      this.safeStroke(this.trainingBackdrop);
      this.drawPanelFrame(this.trainingBackdrop, -frameW / 2, -frameH / 2, frameW, frameH, HUD_CYAN);
    }
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(0, y, 3);
      node?.getComponent(UITransform)?.setContentSize(Math.min(500, frameW - 48), height);
    };
    place('NativeTrainingTitle', 76, 40);
    place('NativeTrainingStep', 40, 22);
    place('NativeTrainingHint', 0, 58);
    const buttonWidth = Math.min(220, (frameW - 64) / 2);
    const next = panel.getChildByName('NativeTrainingNext');
    const skip = panel.getChildByName('NativeTrainingSkip');
    next?.setPosition((buttonWidth / 2) + 6, -78, 3);
    skip?.setPosition(-(buttonWidth / 2) - 6, -78, 3);
    this.resizePanelButton(next, buttonWidth, 52, 14, HUD_ACTIVE);
    this.resizePanelButton(skip, buttonWidth, 52, 14);
  }

  private createHomePanel(): void {
    this.homePanel = this.createNode('NativeHomePanel');
    this.homePanel.addComponent(UIOpacity);
    this.homeKeyArt = this.createKeyArt('NativeHomeKeyArt', this.homePanel);
    this.homeBackdrop = attachGraphics(this.createNode('NativeHomeShade', this.homePanel));
    const eyebrow = this.createLabel('NativeHomeEyebrow', 13, HUD_CYAN, this.homePanel);
    eyebrow.string = 'SPACEFIGHT / OPERATIONS';
    eyebrow.horizontalAlign = HorizontalTextAlignment.LEFT;
    const title = this.createLabel('NativeHomeTitle', 34, HUD_WHITE, this.homePanel);
    title.string = this.text('home.title');
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    const subtitle = this.createLabel('NativeHomeSubtitle', 15, HUD_WHITE, this.homePanel);
    subtitle.string = this.text('home.subtitle');
    subtitle.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.homeProfileLabel = this.createLabel('NativeHomeProfile', 12, HUD_WHITE, this.homePanel);
    this.homeProfileLabel.string = this.text('home.profile');
    this.homeProfileLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;

    const navItems: readonly [NativeHomeView, string, CombatMessageKey][] = [
      ['operations', 'NativeHomeOperations', 'home.operations'],
      ['hangar', 'NativeHomeHangar', 'home.hangarNav'],
      ['cargo', 'NativeHomeCargo', 'home.cargo'],
      ['market', 'NativeHomeMarket', 'home.market'],
      ['settings', 'NativeHomeSettings', 'home.settings'],
      ['coop', 'NativeHomeCoop', 'home.coopNav'],
    ];
    for (const [viewId, nodeName, key] of navItems) {
      const button = this.createPanelButton(nodeName, this.text(key), () => this.setHomeView(viewId), this.homePanel, 'nav');
      this.homeNavButtons.set(viewId, button);
    }

    this.homeViewTitle = this.createLabel('NativeHomeViewTitle', 19, HUD_WHITE, this.homePanel);
    this.homeViewTitle.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.homeViewDetail = this.createLabel('NativeHomeViewDetail', 12, HUD_WHITE, this.homePanel);
    this.homeViewDetail.horizontalAlign = HorizontalTextAlignment.LEFT;

    const missions: readonly [MissionPreset, CombatMessageKey, CombatMessageKey][] = [
      ['tutorial', 'home.tutorial', 'home.tutorialDetail'],
      ['salvage', 'home.salvage', 'home.salvageDetail'],
      ['assault', 'home.assault', 'home.assaultDetail'],
      ['hunt', 'home.hunt', 'home.huntDetail'],
      // 2026-11-04：新增 3 种玩法循环完全不同的任务（此前只有 3 个，且都是「打够 N 个」）
      ['survive', 'home.survive', 'home.surviveDetail'],
      ['defense', 'home.defense', 'home.defenseDetail'],
      ['escort', 'home.escort', 'home.escortDetail'],
    ];
    for (const [preset, nameKey, detailKey] of missions) {
      const button = this.createPanelButton(
        `Mission.${preset}`,
        `${this.text(nameKey)}\n${this.text(detailKey)}`,
        () => this.selectMission(preset),
        this.homePanel,
        'slot',
      );
      this.missionButtons.set(preset, button);
    }
    this.homeMissionLabel = this.createLabel('NativeHomeMission', 14, HUD_CYAN, this.homePanel);
    this.homeMissionLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.homeControllerLabel = this.createLabel('NativeHomeController', 11, HUD_WHITE, this.homePanel);
    this.homeControllerLabel.string = this.text('home.controller');
    this.homeControllerLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;
    this.homeCargoLabel = this.createLabel('NativeHomeCargoManifest', 13, HUD_WHITE, this.homePanel);
    this.homeCargoLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    // 行动视图远征档案读数（累计结算 / 最近货物 / 星港券 / 任务 / 装配）。
    this.homeOpsLabel = this.createLabel('NativeHomeOpsReadout', 12, HUD_WHITE, this.homePanel);
    this.homeOpsLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.homeOpsLabel.verticalAlign = VerticalTextAlignment.TOP;
    // 联机 tab：4 个动作按钮 + 可选「复制邀请码」+ 状态/邀请码标签。
    // 房间号/呼号/扫码输入框由外层 web shell 的 DOM 负责，这里不引入 EditBox / 剪贴板 API。
    const coopBridge = (): CoopHudBridge | null => {
      const bridge = this.actions?.coop;
      return bridge && bridge.available !== false ? bridge : null;
    };
    this.coopHostButton = this.createPanelButton('NativeCoopHost', this.text('coop.host'), () => coopBridge()?.host(), this.homePanel);
    this.coopJoinButton = this.createPanelButton('NativeCoopJoin', this.text('coop.join'), () => {
      const code = this.coopJoinInput?.string?.trim().toUpperCase();
      coopBridge()?.join(code || undefined);
    }, this.homePanel);
    this.coopCloseButton = this.createPanelButton('NativeCoopClose', this.text('coop.close'), () => coopBridge()?.close(), this.homePanel);
    this.coopCopyButton = this.createPanelButton('NativeCoopCopy', this.text('coop.copyCode'), () => coopBridge()?.copyCode?.(), this.homePanel);
    this.coopJoinInput = this.createCoopJoinInput(this.homePanel);
    this.coopStatusLabel = this.createLabel('NativeCoopStatus', 13, HUD_CYAN, this.homePanel);
    this.coopStatusLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.coopStatusLabel.verticalAlign = VerticalTextAlignment.TOP;
    this.coopCodeLabel = this.createLabel('NativeCoopCode', 14, HUD_ACTIVE, this.homePanel);
    this.coopCodeLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.coopCodeLabel.verticalAlign = VerticalTextAlignment.TOP;
    for (const item of ['cargo-expansion', 'tractor-calibration', 'shield-expansion', 'frontier-livery'] as StoreItemId[]) {
      const button = this.createPanelButton(`NativeMarket.${item}`, '', () => this.purchaseStoreItem(item), this.homePanel, 'slot');
      this.marketButtons.set(item, button);
    }
    this.hangarButton = this.createPanelButton('NativeHomeOpenLoadout', this.text('home.hangar'), () => {
      this.setHomeOpen(false);
      this.preflight = true;
      this.setButtonText(this.applyLoadoutButton, this.text('loadout.applyEnter'));
      this.setButtonText(this.closeLoadoutButton, this.text('loadout.defaultEnter'));
      if (this.loadoutFeedbackLabel) {
        this.loadoutFeedbackLabel.string = this.text('loadout.confirmEnter');
        this.loadoutFeedbackLabel.color = HUD_CYAN;
      }
      this.setLoadoutOpen(true);
    }, this.homePanel, 'primary');
    this.deployButton = this.createPanelButton('NativeHomeDeploy', this.text('home.deploy'), () => {
      this.preflight = false;
      this.setHomeOpen(false);
      this.onDeploy?.();
    }, this.homePanel, 'primary');

    this.settingsButtons.push(
      this.createPanelButton('NativeSettingsSensitivity', '', () => this.cycleSensitivity(), this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsInvertY', '', () => {
        this.inputSettings.invertY = !this.inputSettings.invertY;
        this.commitInputSettings();
      }, this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsHanded', '', () => {
        this.inputSettings.leftHanded = !this.inputSettings.leftHanded;
        this.commitInputSettings();
      }, this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsControlScale', '', () => this.cycleControlScale(), this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsSfx', '', () => {
        toggleAudioSetting(AUDIO_SFX_KEY);
        this.updateSettingsLabels();
      }, this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsEngine', '', () => {
        toggleAudioSetting(AUDIO_ENGINE_KEY);
        this.updateSettingsLabels();
      }, this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsCheckUpdate', '', () => this.checkForUpdates(), this.homePanel, 'slot'),
      // 设置里的第 8 项：可重复进入的新手教学关（不写死「只弹一次」）。
      this.createPanelButton('NativeSettingsTutorial', '', () => {
        this.setHomeOpen(false);
        this.actions?.onStartTutorial?.();
        this.onDeploy?.();
      }, this.homePanel, 'primary'),
      // 第 9 / 10 项：可改键位、最近三次运行日志。入口留在设置里，
      // 详细内容走独立子面板，避免把十几个键位塞进主设置列表挤成一条线。
      this.createPanelButton('NativeSettingsKeybind', this.text('settings.keybind'),
        () => this.openSettingsDetail('keybind'), this.homePanel, 'slot'),
      this.createPanelButton('NativeSettingsRunlog', this.text('settings.runlog'),
        () => this.openSettingsDetail('runlog'), this.homePanel, 'slot'),
    );
    this.updateHomeSelection();
    this.setHomeView('operations');
    this.homePanel.active = false;
  }

  private createOutpostPanel(): void {
    this.outpostPanel = this.createNode('NativeOutpostPanel');
    this.outpostPanel.addComponent(UIOpacity);
    this.outpostKeyArt = this.createKeyArt('NativeOutpostKeyArt', this.outpostPanel);
    this.outpostBackdrop = attachGraphics(this.createNode('NativeOutpostShade', this.outpostPanel));
    const eyebrow = this.createLabel('NativeOutpostEyebrow', 12, HUD_CYAN, this.outpostPanel);
    eyebrow.string = 'DOCK 07 / SERVICE DECK';
    eyebrow.horizontalAlign = HorizontalTextAlignment.LEFT;
    const title = this.createLabel('NativeOutpostTitle', 32, HUD_WHITE, this.outpostPanel);
    title.string = this.text('outpost.title');
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    const detail = this.createLabel('NativeOutpostDetail', 14, HUD_WHITE, this.outpostPanel);
    detail.string = this.text('outpost.detail');
    detail.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.outpostStatusLabel = this.createLabel('NativeOutpostStatus', 14, HUD_WHITE, this.outpostPanel);
    this.outpostStatusLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.outpostCargoLabel = this.createLabel('NativeOutpostCargo', 13, HUD_ACTIVE, this.outpostPanel);
    this.outpostCargoLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    // 从战场带回的真实三量与星港券余额（由 syncCombat 缓存的 snapshot 渲染）。
    this.outpostVitalsLabel = this.createLabel('NativeOutpostVitals', 13, HUD_WHITE, this.outpostPanel);
    this.outpostVitalsLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.outpostTicketsLabel = this.createLabel('NativeOutpostTickets', 13, HUD_CYAN, this.outpostPanel);
    this.outpostTicketsLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.outpostLoadoutButton = this.createPanelButton(
      'NativeOutpostOpenLoadout',
      this.text('outpost.loadout'),
      () => {
        this.loadoutFromOutpost = true;
        this.setOutpostOpen(false);
        this.setButtonText(this.applyLoadoutButton, this.text('loadout.apply'));
        this.setButtonText(this.closeLoadoutButton, this.text('outpost.back'));
        this.setLoadoutOpen(true);
      },
      this.outpostPanel,
    );
    this.outpostUndockButton = this.createPanelButton(
      'NativeOutpostUndock',
      this.text('outpost.undock'),
      () => {
        this.setOutpostOpen(false);
        this.onDeploy?.();
      },
      this.outpostPanel,
      'primary',
    );
    // 前哨 4 项服务入口：文案走本地化，回调交给外层 actions（不臆造服务逻辑）。
    this.outpostRepairButton = this.createPanelButton('NativeOutpostRepair', this.text('outpost.repair'),
      () => this.actions?.onStationService?.('repair'), this.outpostPanel);
    this.outpostResupplyButton = this.createPanelButton('NativeOutpostResupply', this.text('outpost.resupply'),
      () => this.actions?.onStationService?.('resupply'), this.outpostPanel);
    this.outpostRefitButton = this.createPanelButton('NativeOutpostRefit', this.text('outpost.refit'),
      () => this.actions?.onStationService?.('refit'), this.outpostPanel);
    this.outpostHomeButton = this.createPanelButton('NativeOutpostHome', this.text('outpost.home'),
      () => this.actions?.onReturnHome?.(), this.outpostPanel);
    // 「站内玩法」：3D 舱内自由行走已接线时进入可操控的站内场景；否则回退到 2D 总台。
    this.outpostStationButton = this.createPanelButton('NativeOutpostStation',
      this.st('进入站内', 'Enter Station'), () => {
        if (this.actions?.onEnterWalk) this.actions.onEnterWalk();
        else this.showStation();
      }, this.outpostPanel, 'primary');
    // 「舱内物资」：不新建面板，切换货物读数行显示五类物资台账，避免挤压 2×2 服务网格。
    this.outpostInteriorButton = this.createPanelButton('NativeOutpostInterior', this.text('outpost.interior'),
      () => this.toggleInterior(), this.outpostPanel);
    this.outpostPanel.active = false;
  }

  /** 返航过场动画：返航阶段四周压暗 + 中央大号「返航中 xx%」。 */
  private createReturnOverlay(): void {
    this.returnOverlay = this.createNode('NativeReturnOverlay');
    this.returnOverlay.addComponent(UIOpacity);
    // 压暗层挂到 HUD 最底层：只压暗 3D 战场，不再把顶部状态/目标文字一起压暗。
    this.returnVeil = attachGraphics(this.createNode('NativeReturnVeil', this.root));
    this.returnVeil.node.setSiblingIndex(0);
    this.returnVeilInner = attachGraphics(this.createNode('NativeReturnVeilInner', this.root));
    this.returnVeilInner.node.setSiblingIndex(1);
    this.returnBanner = this.createLabel('NativeReturnBanner', 26, HUD_ACTIVE, this.returnOverlay);
    this.returnBanner.horizontalAlign = HorizontalTextAlignment.CENTER;
    this.returnOverlay.active = false;
    this.returnVeil.node.active = false;
    this.returnVeilInner.node.active = false;
  }

  private updateReturnOverlay(snapshot: CombatSnapshot): void {
    if (!this.returnOverlay || !this.returnBanner || !this.returnVeil) return;
    const returning = snapshot.expedition.phase === 'returning';
    // 打开任意面板时不再压暗：修复 setOutpostOpen 关遮罩、下一帧又被这里重开的冲突。
    const blocked = this.outpostOpen || this.homeOpen || this.loadoutOpen
      || this.pauseOpen || this.defeatOpen;
    const active = returning && !blocked;
    this.returnOverlay.active = active;
    this.returnVeil.node.active = active;
    if (this.returnVeilInner) this.returnVeilInner.node.active = active;
    if (!active) return;
    const progress = Math.max(0, Math.min(1, snapshot.expedition.returnProgress));
    const pct = Math.round(progress * 100);
    this.returnBanner.string = this.text('return.banner', { percent: pct });
    this.returnBanner.node.setPosition(this.canvasPosition(this.width / 2, this.height * 0.5, 6));
    // 两级压暗：外层整条带 + 靠屏幕外沿的半宽叠加，形成由外向内渐亮的羽化，
    // 不再是一刀切的硬边矩形；整体强度也比旧版轻，HUD 保持可读。
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const band = Math.min(this.width, this.height) * 0.12 * (0.45 + progress * 0.55);
    const alpha = Math.round(78 + 46 * progress);
    const veil = this.returnVeil;
    this.safeClear(veil);
    veil.fillColor = new Color(0, 8, 12, alpha);
    this.safeRect(veil, -halfW, -halfH, this.width, band);
    this.safeRect(veil, -halfW, halfH - band, this.width, band);
    this.safeRect(veil, -halfW, -halfH, band, this.height);
    this.safeRect(veil, halfW - band, -halfH, band, this.height);
    this.safeFill(veil);
    const inner = this.returnVeilInner;
    if (inner) {
      const ib = band * 0.5;
      this.safeClear(inner);
      inner.fillColor = new Color(0, 8, 12, alpha);
      this.safeRect(inner, -halfW, -halfH, this.width, ib);
      this.safeRect(inner, -halfW, halfH - ib, this.width, ib);
      this.safeRect(inner, -halfW, -halfH, ib, this.height);
      this.safeRect(inner, halfW - ib, -halfH, ib, this.height);
      this.safeFill(inner);
    }
  }

  private createKeyArt(name: string, parent: Node): Sprite {    const node = this.createNode(name, parent);
    node.addComponent(UIOpacity);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.color = new Color(210, 222, 226, 255);
    return sprite;
  }

  private loadLauncherKeyArt(): void {
    // 收敛为单一真源：此前三路 hangar 贴图都写 loadoutHangarArt，异步完成顺序不定 → 随机背景。
    // 现在装配台与主页机库视图统一由 orbital-hangar-loadout 一张图决定。
    this.loadKeyArtTexture('ui/launcher/spacefight-launcher-keyart', '[SpaceFight boot]', (frame) => {
      if (this.bootKeyArt?.node?.isValid) this.bootKeyArt.spriteFrame = frame;
    });
    this.loadKeyArtTexture('ui/station/orbital-outpost-exterior', '[SpaceFight outpost]', (frame) => {
      this.outpostArtFrame = frame;
      // 主页 fallback 仍用外景图；结算面板单独用下面的机库内景图。
      this.updateHomeKeyArt();
      // 内景图加载失败时的兜底：结算面板先用外景图顶上。
      if (this.outpostKeyArt?.node?.isValid && !this.outpostInteriorFrame) {
        this.outpostKeyArt.spriteFrame = frame;
      }
    });
    // 停靠结算面板用「站内机库内景」，让返航进站看到的是建筑内部而不是外景。
    this.loadKeyArtTexture('ui/hangar/spacefight-hangar-bay-v2', '[SpaceFight outpost interior]', (frame) => {
      this.outpostInteriorFrame = frame;
      if (this.outpostKeyArt?.node?.isValid) this.outpostKeyArt.spriteFrame = frame;
    });
    this.loadKeyArtTexture('ui/station/orbital-combat-zone-clean', '[SpaceFight operations]', (frame) => {
      this.combatZoneArtFrame = frame;
      this.updateHomeKeyArt();
    });
    this.loadKeyArtTexture('ui/station/orbital-hangar-loadout', '[SpaceFight hangar]', (frame) => {
      this.hangarArtFrame = frame;
      if (this.loadoutHangarArt?.node?.isValid) this.loadoutHangarArt.spriteFrame = frame;
      this.updateHomeKeyArt();
    });
    this.loadKeyArtTexture('ui/market/orbital-exchange', '[SpaceFight market]', (frame) => {
      this.marketArtFrame = frame;
      this.updateHomeKeyArt();
    });
  }

  private loadKeyArtTexture(path: string, channel: string, apply: (frame: SpriteFrame) => void): void {
    resources.load(`${path}/texture`, Texture2D, (error: Error | null, texture?: Texture2D) => {
      // destroy 之后回调才返回时直接丢弃，避免写已销毁节点。
      if (this.destroyed) return;
      if (error || !texture) {
        console.warn(`${channel} key art unavailable`, error);
        return;
      }
      const frame = new SpriteFrame();
      frame.texture = texture;
      apply(frame);
    });
  }

  private setHomeView(viewId: NativeHomeView): void {
    this.homeView = viewId;
    this.updateHomeKeyArt();
    if (this.homeViewTitle) {
      this.homeViewTitle.node.setScale(0.96, 0.96, 1);
      tween(this.homeViewTitle.node).to(0.16, { scale: new Vec3(1, 1, 1) }).start();
    }
    const operations = viewId === 'operations';
    const hangar = viewId === 'hangar';
    const cargo = viewId === 'cargo';
    const market = viewId === 'market';
    const settings = viewId === 'settings';
    for (const button of this.missionButtons.values()) button.active = operations;
    if (this.deployButton) this.deployButton.active = operations;
    if (this.homeMissionLabel) this.homeMissionLabel.node.active = operations;
    if (this.homeOpsLabel) this.homeOpsLabel.node.active = operations;
    if (this.hangarButton) this.hangarButton.active = hangar;
    if (this.homeCargoLabel) this.homeCargoLabel.node.active = cargo;
    for (const button of this.marketButtons.values()) button.active = market;
    for (const button of this.settingsButtons) button.active = settings;
    if (this.homeControllerLabel) this.homeControllerLabel.node.active = settings;
    // 按当前视图重刷标题/说明并复原说明色（清掉上次商城购买反馈）。
    this.refreshHomeViewText();
    this.refreshOperationsReadout();
    this.updateCoopControls();
    this.updateHomeCargo();
    this.updateSettingsLabels();
    this.updateMarketLabels();
    for (const [id, button] of this.homeNavButtons) {
      this.resizePanelButton(button, 70, 48, 11, id === viewId ? HUD_ACTIVE : HUD_CYAN);
    }
    this.layoutHomePanel();
  }

  private updateHomeKeyArt(): void {
    if (this.destroyed || !this.homeKeyArt?.node?.isValid) return;
    // 2026-11-17：orbital-outpost-exterior.png 是带烧录文案的宣发图（SPACEFIGHT/
    // 纯单机太空射击/玩法…）。它做主页背景时，半透明面板与详情面板会透出这些字，
    // 横屏下尤其明显。主页各视图一律改用无文字的 combatZoneArtFrame，彻底杜绝透字。
    const cleanFrame = this.combatZoneArtFrame || this.outpostArtFrame;
    const frame = this.homeView === 'operations'
      ? cleanFrame
      : this.homeView === 'hangar'
        ? this.hangarArtFrame || cleanFrame
        : this.homeView === 'market'
          ? this.marketArtFrame || cleanFrame
        : cleanFrame;
    if (frame && this.homeKeyArt.spriteFrame !== frame) {
      this.homeKeyArt.spriteFrame = frame;
      const opacity = this.homeKeyArt.node.getComponent(UIOpacity);
      if (opacity) {
        opacity.opacity = 150;
        tween(opacity).to(0.24, { opacity: 255 }).start();
      }
    }
  }

  private updateHomeCargo(): void {
    if (!this.homeCargoLabel) return;
    const cargo = this.latestSnapshot?.cargo;
    const items = cargo?.items || [];
    const capacity = cargo?.capacity || 8;
    const value = items.reduce((total, item) => total + Math.max(0, Number(item.value) || 0), 0);
    if (items.length === 0) {
      this.homeCargoLabel.string = `${this.text('cargo.capacity', { used: 0, capacity })}\n\n${this.text('home.cargoEmpty')}`;
    } else {
      // Group by category (frontier livery appearance first), then sort by rarity
      // so the manifest reads as a curated cargo ledger rather than a raw feed.
      const categoryOrder: readonly string[] = ['equipment', 'material', 'currency', 'intel', 'cosmetic'];
      const rarityOrder: Readonly<Record<string, number>> = { epic: 3, rare: 2, uncommon: 1, common: 0 };
      const groups = new Map<string, CargoItem[]>();
      for (const item of items) {
        if (!groups.has(item.category)) groups.set(item.category, []);
        groups.get(item.category)!.push(item);
      }
      const ledger: string[] = [];
      for (const category of categoryOrder) {
        const group = groups.get(category);
        if (!group || group.length === 0) continue;
        const sorted = [...group].sort(
          (a, b) => (rarityOrder[b.rarity] ?? 0) - (rarityOrder[a.rarity] ?? 0),
        );
        ledger.push(`-- ${this.text(`cargo.category.${category}` as CombatMessageKey)} --`);
        for (const item of sorted) {
          const guard = item.insured || item.equipped || item.key || item.keyItem || item.firstDiscovery
            ? ' · ' + this.text('cargo.insured')
            : ' · ' + this.text('cargo.risked');
          ledger.push(`• ${this.text(`cargo.rarity.${item.rarity}` as CombatMessageKey)} +${item.value || 0}${guard}`);
        }
      }
      const manifest = ledger.join('\n');
      this.homeCargoLabel.string = `${this.text('cargo.capacity', { used: cargo!.usedSlots, capacity })}\n${this.text('cargo.totalValue', { value })}\n\n${manifest}`;
    }
    const economy = loadEconomy();
    if (this.homeProfileLabel) {
      this.homeProfileLabel.string = this.text('home.wallet', { value: economy.starportTickets });
    }
  }

  private purchaseStoreItem(item: StoreItemId): void {
    const result = buyStoreItem(item);
    if (this.homeViewDetail) {
      this.homeViewDetail.string = result.ok ? this.text('market.purchased') : this.text('market.insufficient');
      this.homeViewDetail.color = result.ok ? HUD_GREEN : HUD_ACTIVE;
      this.homeViewDetail.node.setScale(0.96, 0.96, 1);
      tween(this.homeViewDetail.node).to(0.14, { scale: Vec3.ONE }).start();
    }
    if (result.ok) this.onEconomyChanged?.();
    this.updateHomeCargo();
    this.updateMarketLabels();
  }

  private updateMarketLabels(): void {
    const profile = loadEconomy();
    const definitions: Readonly<Record<StoreItemId, [CombatMessageKey, CombatMessageKey]>> = {
      'cargo-expansion': ['market.cargoExpansion', 'market.cargoExpansionDetail'],
      'tractor-calibration': ['market.tractor', 'market.tractorDetail'],
      'shield-expansion': ['market.shieldExpansion', 'market.shieldExpansionDetail'],
      'frontier-livery': ['market.livery', 'market.liveryDetail'],
    };
    for (const [item, button] of this.marketButtons) {
      const price = storePrice(item, profile);
      const [name, detail] = definitions[item];
      this.setButtonText(button, `${this.text(name)}\n${this.text(detail)}  ·  ${price < 0 ? this.text('market.owned') : this.text('market.price', { value: price })}`);
      this.resizePanelButton(button, 220, 66, 12, price < 0 ? HUD_GREEN : HUD_CYAN);
    }
  }

  private cycleSensitivity(): void {
    const values = [0.65, 1, 1.35, 1.75, 2.2];
    const current = values.findIndex((value) => Math.abs(value - this.inputSettings.sensitivity) < 0.05);
    this.inputSettings.sensitivity = values[(current + 1) % values.length];
    this.commitInputSettings();
  }

  private cycleControlScale(): void {
    const values = [0.85, 1, 1.15, 1.3];
    const current = values.findIndex((value) => Math.abs(value - this.inputSettings.controlScale) < 0.05);
    this.inputSettings.controlScale = values[(current + 1) % values.length];
    this.commitInputSettings();
  }

  private commitInputSettings(): void {
    this.leftHanded = this.inputSettings.leftHanded;
    this.controlScale = this.inputSettings.controlScale;
    this.onApplyInputSettings?.({ ...this.inputSettings });
    this.updateSettingsLabels();
    this.layoutTouchControls();
  }

  private checkForUpdates(): void {
    if (requestNativeUpdateCheck()) return;
    this.setButtonText(this.settingsButtons[6] || null, this.text('settings.updateUnavailable'));
  }

  private updateSettingsLabels(): void {
    const [sensitivity, invert, handed, scale, sfx, engine, update, tutorial] = this.settingsButtons;
    this.setButtonText(sensitivity || null, this.text('settings.sensitivity', { value: this.inputSettings.sensitivity.toFixed(2) }));
    this.setButtonText(invert || null, this.text('settings.invertY', { value: this.inputSettings.invertY ? this.text('settings.on') : this.text('settings.off') }));
    this.setButtonText(handed || null, this.text('settings.handed', { value: this.inputSettings.leftHanded ? this.text('settings.left') : this.text('settings.right') }));
    this.setButtonText(scale || null, this.text('settings.controlScale', { value: Math.round(this.inputSettings.controlScale * 100) }));
    this.setButtonText(sfx || null, this.text('settings.sfx', { value: audioSettingEnabled(AUDIO_SFX_KEY) ? this.text('settings.on') : this.text('settings.off') }));
    this.setButtonText(engine || null, this.text('settings.engine', { value: audioSettingEnabled(AUDIO_ENGINE_KEY) ? this.text('settings.on') : this.text('settings.off') }));
    this.setButtonText(update || null, this.text('settings.checkUpdate'));
    this.setButtonText(tutorial || null, this.text('home.tutorialStart'));
  }

  // ==================== 设置：可改键位 / 最近三次运行日志 ====================

  private installKeyCaptureListener(): void {
    if (this.keyCaptureAttached) return;
    try {
      cocosInput.on(Input.EventType.KEY_DOWN, this.onKeyCapture, this);
      this.keyCaptureAttached = true;
    } catch (error: unknown) {
      console.warn('[SpaceFight HUD] key capture unavailable', error);
    }
  }

  /** 只有「等待改键」时才消费键盘事件；home 打开时飞行输入本来就已被屏蔽。 */
  private readonly onKeyCapture = (event: EventKeyboard): void => {
    if (!this.pendingKeyAction) return;
    const code = cocosKeyCodeToDesktopCode(event.keyCode);
    if (code) this.applyKeyCapture(code);
  };

  private openSettingsDetail(kind: 'keybind' | 'runlog'): void {
    this.pendingKeyAction = null;
    if (kind === 'keybind') {
      this.updateKeybindLabels();
      this.refreshKeybindDragDots();
    } else {
      this.loadRunLogs();
    }
    this.activateOnly(kind);
    this.setCombatChromeVisible(false);
    if (kind === 'keybind') this.layoutKeybindPanel();
    else this.layoutRunlogPanel();
    const panel = kind === 'keybind' ? this.keybindPanel : this.runlogPanel;
    const opacity = panel?.getComponent(UIOpacity);
    if (opacity) {
      opacity.opacity = 0;
      tween(opacity).to(0.18, { opacity: 255 }).start();
    }
  }

  private closeSettingsDetail(): void {
    this.pendingKeyAction = null;
    this.updateKeybindLabels();
    this.activateOnly('home');
    this.setCombatChromeVisible(false);
    this.setHomeView('settings');
  }

  private createKeybindPanel(): void {
    const panel = this.createNode('NativeKeybindPanel');
    panel.addComponent(UIOpacity);
    this.keybindPanel = panel;
    this.keybindBackdrop = attachGraphics(this.createNode('NativeKeybindShade', panel));
    const eyebrow = this.createLabel('NativeKeybindEyebrow', 12, HUD_CYAN, panel);
    eyebrow.string = '设置 / 操控';
    eyebrow.horizontalAlign = HorizontalTextAlignment.LEFT;
    const title = this.createLabel('NativeKeybindTitle', 28, HUD_WHITE, panel);
    title.string = '自定义键位';
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.keybindHintLabel = this.createLabel('NativeKeybindHint', 12, HUD_WHITE, panel);
    this.keybindHintLabel.horizontalAlign = HorizontalTextAlignment.LEFT;

    for (const action of GAME_ACTIONS) {
      this.keybindButtons.set(action, this.createPanelButton(
        `Keybind.${action}`, '', () => this.beginKeyCapture(action), panel, 'slot',
      ));
    }

    this.keybindDragArea = this.createNode('NativeKeybindDragArea', panel);
    this.keybindDragFrame = attachGraphics(this.createNode('NativeKeybindDragFrame', this.keybindDragArea));
    const caption = this.createLabel('NativeKeybindDragCaption', 11, HUD_CYAN, panel);
    caption.string = '触屏按键位置 · 拖动圆点后松手保存';
    caption.horizontalAlign = HorizontalTextAlignment.LEFT;
    for (const id of TOUCH_DOT_IDS) this.createKeybindDragDot(id, this.keybindDragArea);

    this.createPanelButton('KeybindResetKeys', '恢复默认键位', () => this.resetKeybindings(), panel);
    this.createPanelButton('KeybindResetLayout', '重置按键位置', () => this.resetTouchLayout(), panel);
    this.createPanelButton('KeybindBack', '返回设置', () => this.closeSettingsDetail(), panel, 'primary');
    this.updateKeybindLabels();
    panel.active = false;
  }

  private createKeybindDragDot(id: TouchControlId, parent: Node): void {
    const node = this.createNode(`KeybindDot.${id}`, parent);
    node.getComponent(UITransform)?.setContentSize(30, 30);
    const graphics = attachGraphics(node);
    this.drawKeybindDot(graphics, false);
    const label = this.createLabel('Label', 9, HUD_WHITE, node);
    label.string = TOUCH_DOT_LABELS[id] || id;
    label.node.setPosition(0, -18, 0);
    label.getComponent(UITransform)?.setContentSize(60, 16);
    let dragging = false;
    const finish = (): void => {
      if (!dragging) return;
      dragging = false;
      this.drawKeybindDot(graphics, false);
      // 只在松手时提交：拖动过程中重建整个输入系统会把触点打断。
      this.commitInputSettings();
    };
    node.on(Node.EventType.TOUCH_START, () => {
      dragging = true;
      this.drawKeybindDot(graphics, true);
    });
    node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      if (!dragging) return;
      const area = this.keybindDragArea?.getComponent(UITransform);
      if (!area) return;
      const ui = event.getUILocation();
      const local = area.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
      // 布局坐标以左上角为原点、y 向下；UI 坐标以中心为原点、y 向上。
      const x = local.x / this.keybindDragWidth + 0.5;
      const y = 0.5 - local.y / this.keybindDragHeight;
      this.inputSettings.touchOffsets = setTouchControlPosition(
        this.inputSettings.touchOffsets, id, x, y,
      );
      this.refreshKeybindDragDots();
    });
    node.on(Node.EventType.TOUCH_END, finish);
    node.on(Node.EventType.TOUCH_CANCEL, finish);
    this.keybindDragDots.set(id, node);
  }

  private drawKeybindDot(graphics: Graphics, active: boolean): void {
    this.safeClear(graphics);
    const radius = active ? 12 : 10;
    graphics.fillColor = active ? new Color(240, 168, 60, 232) : new Color(9, 30, 40, 238);
    this.safeCircle(graphics, 0, 0, radius);
    this.safeFill(graphics);
    graphics.strokeColor = active ? HUD_ACTIVE : HUD_CYAN;
    graphics.lineWidth = 1.6;
    this.safeCircle(graphics, 0, 0, radius);
    this.safeStroke(graphics);
  }

  private drawKeybindDragFrame(): void {
    const graphics = this.keybindDragFrame;
    if (!graphics) return;
    const width = this.keybindDragWidth;
    const height = this.keybindDragHeight;
    this.safeClear(graphics);
    graphics.fillColor = new Color(3, 12, 17, 226);
    this.safeRoundRect(graphics, -width / 2, -height / 2, width, height, 8);
    this.safeFill(graphics);
    graphics.strokeColor = new Color(HUD_CYAN.r, HUD_CYAN.g, HUD_CYAN.b, 110);
    graphics.lineWidth = 1;
    for (let index = 1; index < 4; index += 1) {
      const x = -width / 2 + (width * index) / 4;
      this.safeMoveTo(graphics, x, -height / 2);
      this.safeLineTo(graphics, x, height / 2);
    }
    for (let index = 1; index < 3; index += 1) {
      const y = -height / 2 + (height * index) / 3;
      this.safeMoveTo(graphics, -width / 2, y);
      this.safeLineTo(graphics, width / 2, y);
    }
    this.safeStroke(graphics);
    graphics.strokeColor = new Color(HUD_CYAN.r, HUD_CYAN.g, HUD_CYAN.b, 190);
    graphics.lineWidth = 1.4;
    this.safeRoundRect(graphics, -width / 2, -height / 2, width, height, 8);
    this.safeStroke(graphics);
  }

  private currentTouchPosition(id: TouchControlId): { x: number; y: number } {
    const custom = this.inputSettings.touchOffsets?.[id];
    if (custom) return custom;
    const layout = touchActionLayout(
      this.width, this.height, this.leftHanded, this.safeInsets, this.controlScale,
    );
    const control = layout.find((item) => item.role === id);
    if (control) return { x: control.x / this.width, y: control.y / this.height };
    const stick = movementControlCircle(
      this.width, this.height, this.leftHanded, this.safeInsets, this.controlScale,
    );
    if (id === 'movement') return { x: stick.x / this.width, y: stick.y / this.height };
    return { x: 0.5, y: 0.5 };
  }

  private refreshKeybindDragDots(): void {
    for (const [id, node] of this.keybindDragDots) {
      const point = this.currentTouchPosition(id);
      node.setPosition(
        (point.x - 0.5) * this.keybindDragWidth,
        (0.5 - point.y) * this.keybindDragHeight,
        2,
      );
    }
  }

  private updateKeybindLabels(): void {
    for (const action of GAME_ACTIONS) {
      const waiting = this.pendingKeyAction === action;
      const name = GAME_ACTION_LABELS[action];
      const binding = displayBinding(this.inputSettings.keyBindings, action);
      this.setButtonText(this.keybindButtons.get(action) || null,
        waiting ? `${name}\n按下新键…` : `${name}   ${binding}`);
    }
    if (this.keybindHintLabel) {
      this.keybindHintLabel.string = this.pendingKeyAction
        ? '请按下要绑定的按键，按退出键取消'
        : '点击左侧条目后按新键即可改键位；右侧圆点可拖动，松手后自动保存';
    }
  }

  private beginKeyCapture(action: GameAction): void {
    this.pendingKeyAction = action;
    this.updateKeybindLabels();
  }

  private applyKeyCapture(code: string): void {
    const action = this.pendingKeyAction;
    if (!action) return;
    this.pendingKeyAction = null;
    // 退出键保留为「取消」，避免玩家把暂停键改掉后卡在等待状态。
    if (code !== 'Escape') {
      this.inputSettings.keyBindings = bindActionKey(this.inputSettings.keyBindings, action, code);
      this.updateKeybindLabels();
      // 提交会 detach/attach 全局键盘监听；放在同一个 KEY_DOWN 派发里做会和
      // Cocos 的事件分发撞车，延到微任务再重建输入系统。
      void Promise.resolve().then(() => {
        if (this.destroyed) return;
        this.commitInputSettings();
        this.updateKeybindLabels();
      });
      return;
    }
    this.updateKeybindLabels();
  }

  private resetKeybindings(): void {
    this.pendingKeyAction = null;
    this.inputSettings.keyBindings = resetKeyBindings();
    this.commitInputSettings();
    this.updateKeybindLabels();
  }

  private resetTouchLayout(): void {
    this.inputSettings.touchOffsets = {};
    this.commitInputSettings();
    this.refreshKeybindDragDots();
  }

  private createRunlogPanel(): void {
    const panel = this.createNode('NativeRunlogPanel');
    panel.addComponent(UIOpacity);
    this.runlogPanel = panel;
    this.runlogBackdrop = attachGraphics(this.createNode('NativeRunlogShade', panel));
    const eyebrow = this.createLabel('NativeRunlogEyebrow', 12, HUD_CYAN, panel);
    eyebrow.string = '设置 / 诊断';
    eyebrow.horizontalAlign = HorizontalTextAlignment.LEFT;
    const title = this.createLabel('NativeRunlogTitle', 28, HUD_WHITE, panel);
    title.string = '最近三次运行';
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.runlogHintLabel = this.createLabel('NativeRunlogHint', 12, HUD_WHITE, panel);
    this.runlogHintLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    for (let index = 0; index < RUN_LOG_LIMIT; index += 1) {
      const card = this.createPanelButton(
        `RunlogCard.${index}`, '', () => this.showRunlogDetail(index), panel, 'slot',
      );
      const label = card.getChildByName('Label')?.getComponent(Label);
      if (label) label.verticalAlign = VerticalTextAlignment.TOP;
      this.runlogCards.push(card);
    }
    this.runlogDetailLabel = this.createLabel('RunlogDetail', 12, HUD_WHITE, panel);
    this.runlogDetailLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.runlogDetailLabel.verticalAlign = VerticalTextAlignment.TOP;
    this.createPanelButton('RunlogCopy', '复制完整日志', () => this.copySelectedRunLog(), panel, 'primary');
    this.createPanelButton('RunlogRefresh', '重新读取', () => this.loadRunLogs(), panel);
    this.createPanelButton('RunlogBack', '返回设置', () => this.closeSettingsDetail(), panel);
    panel.active = false;
  }

  private runLogStorage(): RunLogStorage | null {
    try {
      const storage = sys.localStorage as unknown as RunLogStorage;
      return storage && typeof storage.getItem === 'function' ? storage : null;
    } catch {
      return null;
    }
  }

  private loadRunLogs(): void {
    const storage = this.runLogStorage();
    this.runlogEntries = storage ? readRunLogs(storage) : [];
    // 安卓 AppActivity 在下次启动才归档上一轮轨迹：native[0] 对应的是「上一次」，
    // 而 JS 第 0 条是「本次」。整体后移一位，卡片才不会把上次的崩溃挂到本次头上。
    const natives = nativeRunLogs();
    this.runlogNatives = [null, ...natives.slice(0, RUN_LOG_LIMIT - 1)];
    while (this.runlogNatives.length < RUN_LOG_LIMIT) this.runlogNatives.push(null);
    this.selectedRunLog = 0;
    this.showRunlogDetail(0);
    if (this.runlogHintLabel) {
      this.runlogHintLabel.string = natives.length > 0
        ? '已读取系统退出记录，异常退出会附带崩溃报告'
        : '本机运行记录；安卓端会同时显示系统退出原因';
    }
  }

  private nativeRunLogText(native: NativeRunLog): string {
    return [
      `系统记录 · ${native.time}`,
      `结论：${native.result || '无'}`,
      `退出原因：${native.reason || '无'}`,
      native.version ? `版本：${native.version}` : '',
      native.trace ? `\n---- 启动轨迹 ----\n${native.trace}` : '',
      native.crash ? `\n---- 崩溃报告 ----\n${native.crash}` : '',
    ].filter((line) => line !== '').join('\n');
  }

  private selectedRunLogText(): string {
    const entry = this.runlogEntries[this.selectedRunLog];
    const native = this.runlogNatives[this.selectedRunLog] || undefined;
    if (entry) return formatRunLog(entry, native);
    if (native) return this.nativeRunLogText(native);
    return '这一轮还没有运行记录。\n下次启动后会自动归档上一次运行。';
  }

  private updateRunlogCards(): void {
    for (let index = 0; index < RUN_LOG_LIMIT; index += 1) {
      const card = this.runlogCards[index];
      if (!card) continue;
      const entry = this.runlogEntries[index];
      const native = this.runlogNatives[index] || undefined;
      card.active = !!entry || !!native;
      const head = `第 ${index + 1} 次 · ${entry ? formatTimestamp(entry.startedAt) : native?.time || '暂无记录'}`;
      const body = entry ? runLogSummary(entry) : native?.result || '暂无记录';
      const reason = native?.reason ? `\n系统：${native.reason}` : '';
      this.setButtonText(card, `${head}\n${body}${reason}`);
      const size = card.getComponent(UITransform)?.contentSize;
      this.resizePanelButton(card, size?.width || 260, size?.height || 72, 11,
        index === this.selectedRunLog ? HUD_ACTIVE : HUD_CYAN);
    }
  }

  private showRunlogDetail(index: number): void {
    this.selectedRunLog = index;
    const full = this.selectedRunLogText();
    if (this.runlogDetailLabel) {
      this.runlogDetailLabel.string = full.length > 1800
        ? `${full.slice(0, 1800)}\n…（点「复制完整日志」可取回全文）`
        : full;
    }
    this.updateRunlogCards();
  }

  private copySelectedRunLog(): void {
    const copied = copyRunLogText(this.selectedRunLogText());
    if (this.runlogHintLabel) {
      this.runlogHintLabel.string = copied
        ? '已复制完整日志，可直接粘贴到反馈里'
        : '当前平台不支持自动复制，请截图保存下方内容';
    }
  }

  // ==================== 站内自由行走（3D 舱内探索）====================

  /** 创建稀疏行走提示层：不铺满屏，保留 3D 舱内可见。 */
  private createWalkHintLayer(): void {
    const layer = this.createNode('NativeWalkHintLayer');
    this.walkHintLayer = layer;
    layer.addComponent(UIOpacity);

    this.walkTitleLabel = this.createLabel('WalkTitle', 20, HUD_ACTIVE, layer);
    this.walkTitleLabel.string = this.st('站内 · 自由探索', 'STATION · FREE ROAM');
    this.walkTitleLabel.horizontalAlign = HorizontalTextAlignment.LEFT;

    const help = this.createLabel('WalkHelp', 12, HUD_CYAN, layer);
    help.string = this.st(
      '左摇杆飞行 · 加速冲刺 · 靠近发光终端按开火键交互 · 收集能量核心',
      'Left stick to fly · Boost to sprint · Fire near a glowing terminal · Collect energy cores',
    );
    help.horizontalAlign = HorizontalTextAlignment.LEFT;

    this.walkPromptLabel = this.createLabel('WalkPrompt', 17, HUD_WHITE, layer);
    this.walkPromptLabel.horizontalAlign = HorizontalTextAlignment.CENTER;

    const coreLabel = this.createLabel('WalkCoreCount', 14, HUD_GREEN, layer);
    coreLabel.name = 'WalkCoreCount';
    coreLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;

    // 四个终端 + 离港的方位列表（含距离），让玩家知道往哪飞。
    for (let i = 0; i < 5; i += 1) {
      const row = this.createLabel(`WalkTerminalRow${i}`, 12, HUD_CYAN, layer);
      row.horizontalAlign = HorizontalTextAlignment.LEFT;
      this.walkTerminalLabels.push(row);
    }

    this.walkExitButton = this.createPanelButton(
      'NativeWalkExit', this.st('离港 · 出击', 'UNDOCK · LAUNCH'),
      () => this.onDeploy?.(), layer, 'primary',
    );
    layer.active = false;
  }

  private layoutWalkHintLayer(): void {
    const layer = this.walkHintLayer;
    if (!layer) return;
    layer.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.width < 900 || this.height < 520;
    const pad = this.safeInsets.left + 20;
    const top = this.height / 2 - this.safeInsets.top - 18;
    const title = layer.getChildByName('WalkTitle');
    if (title) this.placeChild(layer, 'WalkTitle', -this.width / 2 + pad + 200, top - 12, 400, 26);
    const help = layer.getChildByName('WalkHelp');
    if (help) this.placeChild(layer, 'WalkHelp', -this.width / 2 + pad + 300, top - (compact ? 32 : 38), 600, 22);
    const core = layer.getChildByName('WalkCoreCount');
    if (core) this.placeChild(layer, 'WalkCoreCount', this.width / 2 - this.safeInsets.right - 150, top - 12, 280, 24);

    // 终端方位列表：左上角竖排，遮罩面板打开时整层会隐藏，不会串台。
    const listTop = top - (compact ? 58 : 70);
    this.walkTerminalLabels.forEach((label, index) => {
      label.node.setPosition(-this.width / 2 + pad + 132, listTop - index * 22, 4);
      label.node.getComponent(UITransform)?.setContentSize(250, 20);
    });

    if (this.walkPromptLabel) {
      this.walkPromptLabel.node.setPosition(0, -this.height / 2 + this.safeInsets.bottom + 108, 4);
      this.walkPromptLabel.node.getComponent(UITransform)?.setContentSize(this.width * 0.7, 30);
      this.walkPromptLabel.fontSize = compact ? 14 : 17;
    }
    if (this.walkExitButton) {
      this.walkExitButton.setPosition(this.width / 2 - this.safeInsets.right - 118, -this.height / 2 + this.safeInsets.bottom + 62, 4);
      this.resizePanelButton(this.walkExitButton, 210, 46, compact ? 11 : 13);
    }
  }

  /** 每帧由 Bootstrap 推送：更新近距交互提示 + 终端方位 + 核心计数。 */
  public syncWalkHint(state: {
    nearLabel: string;
    terminalRows: string[];
    coresText: string;
  } | null): void {
    if (!state) return;
    if (this.walkPromptLabel) {
      this.walkPromptLabel.string = state.nearLabel
        ? this.st(`按开火键 · ${state.nearLabel}`, `FIRE · ${state.nearLabel}`)
        : this.st('飞近发光终端即可交互', 'Fly close to a glowing terminal');
      this.walkPromptLabel.color = state.nearLabel ? HUD_ACTIVE : HUD_CYAN;
    }
    const core = this.walkHintLayer?.getChildByName('WalkCoreCount')?.getComponent(Label);
    if (core) core.string = state.coresText;
    this.walkTerminalLabels.forEach((label, i) => {
      label.string = state.terminalRows[i] || '';
    });
  }

  /** 进入/退出 3D 行走：行走时收起战斗 HUD 读数，只留稀疏提示层。 */
  public setWalkVisible(visible: boolean): void {
    if (visible) {
      // 从前哨结算面板进入：关掉它，露出 3D 站内场景。
      this.setOutpostOpen(false);
      this.setHomeOpen(false);
    }
    if (this.walkHintLayer) this.walkHintLayer.active = visible;
    this.walkActive = visible;
    // 行走时必须保留摇杆/开火键可交互：战斗控件整体点亮，
    // 但下面的读数/准星单独收起（walkActive 已并入 setCombatChromeVisible 判断）。
    if (visible) this.setCombatChromeVisible(true);
    // 行走时隐藏战斗读数与准星，避免叠在 3D 舱内画面上。
    for (const label of [this.statusLabel, this.objectiveLabel, this.sectorLabel, this.targetLabel,
      this.cargoLabel, this.combatFeedLabel, this.navigationLabel, this.weaponLabel,
      this.abilityLabel, this.comboLabel, this.upgradeLabel]) {
      if (label) label.node.active = !visible && this.combatChromeVisible;
    }
    if (this.reticleGraphics) this.reticleGraphics.node.active = !visible && this.combatChromeVisible;
  }

  /** Bootstrap 在玩家于终端按开火时调用：直接打开指定页签的 2D 面板。 */
  public openStationTab(tab: StationTab): void {
    if (this.walkHintLayer) this.walkHintLayer.active = false;
    this.stationTab = tab;
    this.stationNotice = null;
    this.stationSelected = 0;
    this.stationCalibration = 0;
    this.setStationOpen(true);
  }

  // ==================== 站内玩法（建筑内）：任务 / 交易 / 设施 / 校准改装 ====================

  /** 从进站面板打开站内玩法总台，默认落在任务板。 */
  private showStation(): void {
    this.stationTab = 'contracts';
    this.stationNotice = null;
    this.stationSelected = 0;
    this.stationCalibration = 0;
    this.setStationOpen(true);
  }

  private setStationOpen(open: boolean): void {
    if (open) this.activateOnly('station');
    this.stationOpen = open;
    if (this.stationPanel) {
      this.stationPanel.active = open;
      if (open) {
        const opacity = this.stationPanel.getComponent(UIOpacity);
        if (opacity) {
          opacity.opacity = 0;
          tween(opacity).to(0.18, { opacity: 255 }).start();
        }
        this.renderStation();
      }
    }
    this.setCombatChromeVisible(!open);
  }

  private switchStationTab(tab: StationTab): void {
    if (this.stationTab === tab) return;
    this.stationTab = tab;
    this.stationNotice = null;
    this.stationSelected = 0;
    this.stationCalibration = 0;
    this.renderStation();
  }

  /** 回写页签高亮 + 标题 + 重绘当前页签内容。所有数据都从外层注入的 bridge 读。 */
  private renderStation(): void {
    const bridge = this.actions?.station;
    // 2026-11-19：标题此前写死「站内设施」，切到任务板/校准改装仍显示旧标题（真机截图实锤）。
    // 标题跟随当前页签，四个页签各有自己的名称。
    if (this.stationTitleLabel) {
      const titles: Record<StationTab, [string, string]> = {
        contracts: ['任务板', 'Contracts'],
        trade: ['交易终端', 'Trade Terminal'],
        facilities: ['站内设施', 'Facilities'],
        refit: ['校准改装', 'Refit Bay'],
      };
      const pair = titles[this.stationTab];
      this.stationTitleLabel.string = this.st(pair[0], pair[1]);
    }
    for (const [tab, node] of this.stationTabButtons) {
      const size = node.getComponent(UITransform)?.contentSize;
      this.resizePanelButton(node, size?.width || 150, size?.height || 54, 13,
        tab === this.stationTab ? HUD_ACTIVE : HUD_CYAN);
    }
    if (!bridge) {
      if (this.stationHintLabel) this.stationHintLabel.string = this.st('站内系统尚未就绪', 'Station systems unavailable');
      for (const slot of this.stationSlotButtons) slot.active = false;
      return;
    }
    switch (this.stationTab) {
      case 'contracts': this.renderStationContracts(bridge); break;
      case 'trade': this.renderStationTrade(bridge); break;
      case 'facilities': this.renderStationFacilities(bridge); break;
      case 'refit': this.renderStationRefit(bridge); break;
    }
    if (this.stationNotice && this.stationHintLabel) this.stationHintLabel.string = this.stationNotice.message;
    // 页签切换会改变可见 slot 数量（如任务 3 个 → 交易 12 个），必须在渲染后重新定位，
    // 否则新显示的 slot 从未走过 layout，会全部叠在原点。
    this.layoutStationSlots();
  }

  /** 统一往 slot 里塞文字与动作；超出可见数量的隐藏。 */
  private fillStationSlot(index: number, label: string, action: () => void, accent: Color = HUD_CYAN): void {
    const node = this.stationSlotButtons[index];
    if (!node) return;
    node.active = true;
    this.setButtonText(node, label);
    this.stationSlots[index] = { action, accent };
    const size = node.getComponent(UITransform)?.contentSize;
    this.resizePanelButton(node, size?.width || 180, size?.height || 74, 11, accent);
  }

  private clearStationSlots(): void {
    this.stationSlots = [];
    for (const node of this.stationSlotButtons) node.active = false;
  }

  private stationFacilityTitle(id: FacilityId): string {
    if (id === 'repair-bay') return this.st('维修台', 'Repair Bay');
    if (id === 'reactor') return this.st('反应堆', 'Reactor Core');
    if (id === 'mess') return this.st('船员舱', 'Crew Mess');
    if (id === 'bridge') return this.st('舰桥', 'Bridge');
    return this.st('货运站', 'Shipment Bay');
  }

  private stationGoodTitle(id: TradeGoodId): string {
    const names: Record<TradeGoodId, [string, string]> = {
      ore: ['矿石', 'Ore'], alloy: ['合金', 'Alloy'], circuit: ['电路', 'Circuit'],
      medkit: ['医疗包', 'Medkit'], fuel: ['燃料', 'Fuel'], data: ['数据核', 'Data Core'],
    };
    const pair = names[id];
    return this.st(pair[0], pair[1]);
  }

  private stationContractTitle(def: ContractDef): string {
    if (def.kind === 'escort') return this.st('护航合约', 'Escort Contract');
    if (def.kind === 'purge') return this.st('清剿合约', 'Purge Contract');
    return this.st('运送合约', 'Delivery Contract');
  }

  // ---------- 任务板 ----------

  private renderStationContracts(bridge: StationHudBridge): void {
    this.clearStationSlots();
    const save = bridge.snapshot();
    const defs = bridge.contractDefs();
    if (this.stationHintLabel) {
      this.stationHintLabel.string = this.st(
        '接取合约，完成目标后回站领奖',
        'Accept before launch, progress on return, claim when ready',
      );
    }
    // 2026-11-19：任务板卡片下方此前大片空白，显得「站内玩法没内容」。
    // 用一行总览把合约状态与星港券余额摆出来，玩家一眼看得到进度。
    if (this.stationBodyLabel) {
      const active = save.contracts.filter((c) => c.status === 'active').length;
      const ready = save.contracts.filter((c) => c.status === 'ready').length;
      const done = save.contracts.filter((c) => c.status === 'claimed').length;
      this.stationBodyLabel.string = this.st(
        `已接取 ${active} · 待领取 ${ready} · 已完成 ${done} · 星港券 ${bridge.tickets()}`,
        `Active ${active} · Ready ${ready} · Done ${done} · Tickets ${bridge.tickets()}`,
      );
    }
    let index = 0;
    for (const def of defs) {
      const progress = save.contracts.find((c) => c.id === def.id);
      let statusZh = '可接取';
      let statusEn = 'Available';
      let accent = HUD_CYAN;
      if (progress) {
        if (progress.status === 'active') {
          statusZh = `进行中 ${progress.progress}/${def.goal}`;
          statusEn = `Active ${progress.progress}/${def.goal}`;
        } else if (progress.status === 'ready') {
          statusZh = `可领取 · +${def.reward} 券`;
          statusEn = `Claim +${def.reward}`;
          accent = HUD_ACTIVE;
        } else {
          statusZh = '已领取';
          statusEn = 'Claimed';
        }
      }
      const objective = def.kind === 'escort' ? this.st(`返航 ${def.goal} 次`, `Return ${def.goal} times`)
        : def.kind === 'purge' ? this.st(`击毁 ${def.goal} 架`, `Defeat ${def.goal} enemies`)
          : this.st(`回收 ${def.goal} 货值`, `Recover ${def.goal} cargo value`);
      const label = `${this.stationContractTitle(def)}\n${objective}\n${this.st(statusZh, statusEn)}`;
      const contractId = def.id;
      const canClaim = progress?.status === 'ready';
      const canAccept = !progress && !save.claimed.includes(def.id);
      this.fillStationSlot(index++, label, () => {
        if (canClaim) {
          const r = bridge.claimContract(contractId);
          this.stationToast(r.ok
            ? this.st(`领取成功 +${r.value ?? 0} 券`, `Claimed +${r.value ?? 0} tickets`)
            : this.st('领取失败', 'Claim failed'));
        } else if (canAccept) {
          bridge.acceptContract(contractId);
          this.stationToast(this.st('已接取，出航推进', 'Accepted — progress on return'));
        } else {
          this.stationToast(this.st('这张合约已在处理中', 'Contract already in progress'));
        }
        this.renderStation();
      }, accent);
    }
  }

  // ---------- 交易终端 ----------

  private renderStationTrade(bridge: StationHudBridge): void {
    this.clearStationSlots();
    const save = bridge.snapshot();
    const market = bridge.market();
    const goods = bridge.tradeGoods();
    if (this.stationHintLabel) {
      this.stationHintLabel.string = this.st(
        '买价高于卖价，每次返航行情刷新 · 现有星港券会随买卖增减',
        'Buy high / sell low spread · prices refresh each return · tickets update live',
      );
    }
    if (this.stationBodyLabel) {
      this.stationBodyLabel.string = this.st(`星港券余额 ${bridge.tickets()}`, `Tickets ${bridge.tickets()}`);
    }
    let index = 0;
    for (const good of goods) {
      const quote = market[good.id];
      const held = save.holdings[good.id] ?? 0;
      const goodId = good.id;
      this.fillStationSlot(index++, this.st(
        `${this.stationGoodTitle(good.id)} · 买入\n${quote.buy} 券 · 持有 ${held}`,
        `${this.stationGoodTitle(good.id)} · Buy\n${quote.buy} tickets · Own ${held}`,
      ),
        () => {
          const r = bridge.buy(goodId, 1);
          this.stationToast(r.ok
            ? this.st(`买入 ${this.stationGoodTitle(goodId)} −${r.value ?? 0}`, `Bought ${this.stationGoodTitle(goodId)} −${r.value ?? 0}`)
            : this.st('券不足', 'Not enough tickets'));
          this.renderStation();
        });
      this.fillStationSlot(index++, this.st(
        `${this.stationGoodTitle(good.id)} · 卖出\n+${quote.sell} 券`,
        `${this.stationGoodTitle(good.id)} · Sell\n+${quote.sell} tickets`,
      ),
        () => {
          const r = bridge.sell(goodId, 1);
          this.stationToast(r.ok
            ? this.st(`卖出 +${r.value ?? 0}`, `Sold +${r.value ?? 0}`)
            : this.st('没有可卖库存', 'No stock to sell'));
          this.renderStation();
        }, HUD_ACTIVE);
    }
  }

  // ---------- 设施互动 ----------

  private renderStationFacilities(bridge: StationHudBridge): void {
    this.clearStationSlots();
    if (this.stationHintLabel) {
      this.stationHintLabel.string = this.st(
        '走近站内设施互动，部分设施隔几趟返航才会再给一次补助',
        'Interact with station facilities; some pay out only every few returns',
      );
    }
    if (this.stationBodyLabel) this.stationBodyLabel.string = '';
    const facs = bridge.facilityDefs();
    facs.forEach((fac, index) => {
      const visited = bridge.snapshot().visited.includes(fac.id);
      const reward = fac.ticketReward > 0
        ? this.st(` · +${fac.ticketReward}券`, ` · +${fac.ticketReward}`)
        : '';
      const label = `${this.stationFacilityTitle(fac.id)}\n${visited ? this.st('再次访问', 'Revisit') : this.st('首次访问', 'First visit')}${reward}`;
      const facId = fac.id;
      this.fillStationSlot(index, label, () => {
        const r = bridge.interactFacility(facId);
        const v = r.value ?? 0;
        this.stationToast(v > 0
          ? this.st(`互动完成 +${v} 券`, `Interaction +${v} tickets`)
          : this.st('互动完成', 'Interaction complete'));
        this.renderStation();
      });
    });
  }

  // ---------- 校准改装小游戏 ----------

  private renderStationRefit(bridge: StationHudBridge): void {
    this.clearStationSlots();
    const save = bridge.snapshot();
    if (this.stationHintLabel) {
      this.stationHintLabel.string = this.st(
        '点充能累积准度，停在 40~100 区间再锁定；爆表要重来。锁定成功提升永久改装（花 60 券）',
        'Charge to build accuracy, lock between 40~100; overshoot resets. Success upgrades refit (60 tickets)',
      );
    }
    if (this.stationBodyLabel) {
      // 2026-11-19：原文案用 █/░ 拼进度条，真机上渲染成斜纹乱码方块。改为纯数值文字，
      // 进度条交给 stationRefitBar（Graphics）绘制；数值保留供玩家精确判断 40~100 目标区。
      this.stationBodyLabel.string = this.st(
        `准度 ${Math.round(this.stationCalibration)}%   最佳 ${save.refitBest}% · 已改装 ${save.refitCount} 次`,
        `Accuracy ${Math.round(this.stationCalibration)}%   Best ${save.refitBest}% · Refits ${save.refitCount}`,
      );
    }
    this.drawStationRefitBar();
    this.fillStationSlot(0, this.st('充能 +', 'Charge +'), () => {
      this.stationCalibration = Math.min(120, this.stationCalibration + (this.stationCalibration < 60 ? 20 : 5));
      this.renderStation();
    });
    this.fillStationSlot(1, this.st('锁定', 'Lock'), () => {
      const r = bridge.completeRefit(this.stationCalibration);
      if (r.ok) {
        const bonus = Math.floor((r.value ?? 0) / 5);
        this.stationToast(this.st(`校准成功，下次出击护盾上限 +${bonus}`, `Calibrated · +${bonus} shield capacity next sortie`));
      } else if (r.reason === 'calibration-failed') {
        this.stationToast(this.st('准度不足或爆表，重新充能', 'Out of range — charge again'));
      } else if (r.reason === 'no-improvement') {
        this.stationToast(this.st('未超过历史最佳，本次未扣券', 'Personal best unchanged · no charge'));
      } else {
        this.stationToast(this.st('星港券不足（需 60）', 'Not enough tickets (need 60)'));
      }
      this.stationCalibration = 0;
      this.renderStation();
    }, HUD_ACTIVE);
    this.fillStationSlot(2, this.st('重置', 'Reset'), () => {
      this.stationCalibration = 0;
      this.renderStation();
    });
  }

  /**
   * 校准准度图形进度条：0~120 的刻度，40~100 为有效锁定区（青色段），>100 爆表（红色）。
   * 用 Graphics 而非 █/░ 字符，真机字体不认这些块字符时会渲染成斜纹乱码（截图实锤）。
   * 节点尺寸/位置由 layoutStationSlots 在每次布局时写入；这里只按当前 contentSize 重画。
   */
  private drawStationRefitBar(): void {
    const graphics = this.stationRefitBar;
    if (!graphics) return;
    if (this.stationTab !== 'refit') {
      graphics.node.active = false;
      return;
    }
    graphics.node.active = true;
    this.safeClear(graphics);
    const size = graphics.node.getComponent(UITransform)?.contentSize;
    const width = Math.max(120, size?.width || 520);
    const height = Math.max(10, size?.height || 16);
    const left = -width / 2;
    const bottom = -height / 2;
    const value = Math.max(0, Math.min(120, this.stationCalibration));
    const ratio = value / 120;

    // 底槽
    graphics.fillColor = new Color(4, 12, 17, 235);
    this.safeRect(graphics, left, bottom, width, height);
    this.safeFill(graphics);

    // 有效锁定区 40~100（青色底纹），给玩家直观的目标区间
    const zoneStart = left + width * (40 / 120);
    const zoneWidth = width * (60 / 120);
    graphics.fillColor = new Color(40, 130, 140, 90);
    this.safeRect(graphics, zoneStart, bottom, zoneWidth, height);
    this.safeFill(graphics);

    // 当前准度填充：目标区内橙色、爆表红色
    if (ratio > 0) {
      graphics.fillColor = value > 100 ? HUD_RED : HUD_ACTIVE;
      this.safeRect(graphics, left, bottom, width * ratio, height);
      this.safeFill(graphics);
    }

    // 目标区两端刻度线 + 外框
    graphics.strokeColor = new Color(79, 214, 224, 200);
    graphics.lineWidth = 1.5;
    this.safeRect(graphics, left, bottom, width, height);
    this.safeStroke(graphics);
    graphics.strokeColor = HUD_WHITE;
    graphics.lineWidth = 2;
    this.safeMoveTo(graphics, zoneStart, bottom - 3);
    this.safeLineTo(graphics, zoneStart, bottom + height + 3);
    this.safeMoveTo(graphics, zoneStart + zoneWidth, bottom - 3);
    this.safeLineTo(graphics, zoneStart + zoneWidth, bottom + height + 3);
    this.safeStroke(graphics);
    // 当前值游标
    const cursorX = left + width * ratio;
    graphics.strokeColor = HUD_WHITE;
    graphics.lineWidth = 3;
    this.safeMoveTo(graphics, cursorX, bottom - 5);
    this.safeLineTo(graphics, cursorX, bottom + height + 5);
    this.safeStroke(graphics);
  }

  /** 页签内容区顶部的瞬时提示（复用 hint 行，2.4s 后还原当前页签说明）。 */
  private stationToast(message: string): void {
    if (!this.stationHintLabel) return;
    const notice = { message };
    this.stationNotice = notice;
    this.stationHintLabel.string = message;
    setTimeout(() => {
      if (this.stationNotice !== notice) return;
      this.stationNotice = null;
      if (this.stationOpen) this.renderStation();
    }, 2400);
  }

  /** slot 点击统一入口：由创建按钮时的闭包调用当前动作。 */
  private onStationSlot(index: number): void {
    this.stationSlots[index]?.action();
  }

  private createStationPanel(): void {
    const panel = this.createNode('NativeStationPanel');
    panel.addComponent(UIOpacity);
    this.stationPanel = panel;
    this.stationBackdrop = attachGraphics(this.createNode('NativeStationShade', panel));

    const eyebrow = this.createLabel('NativeStationEyebrow', 12, HUD_CYAN, panel);
    eyebrow.string = this.st('轨道前哨 · 站内', 'Orbital Outpost · Interior');
    eyebrow.horizontalAlign = HorizontalTextAlignment.LEFT;

    const title = this.createLabel('NativeStationTitle', 26, HUD_WHITE, panel);
    title.string = this.st('站内设施', 'Station Interior');
    title.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.stationTitleLabel = title;

    // 四个页签
    const tabs: readonly [StationTab, string, string][] = [
      ['contracts', '任务板', 'Contracts'],
      ['trade', '交易终端', 'Trade'],
      ['facilities', '站内设施', 'Facilities'],
      ['refit', '校准改装', 'Refit'],
    ];
    for (const [tab, zh, en] of tabs) {
      const btn = this.createPanelButton(
        `StationTab.${tab}`, this.st(zh, en), () => this.switchStationTab(tab), panel,
      );
      btn.getComponent(UITransform)?.setContentSize(150, 54);
      this.stationTabButtons.set(tab, btn);
    }

    this.stationHintLabel = this.createLabel('NativeStationHint', 12, HUD_WHITE, panel);
    this.stationHintLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.stationHintLabel.verticalAlign = VerticalTextAlignment.TOP;

    this.stationBodyLabel = this.createLabel('NativeStationBody', 15, HUD_CYAN, panel);
    this.stationBodyLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
    this.stationBodyLabel.verticalAlign = VerticalTextAlignment.CENTER;

    // 校准准度图形进度条（仅 refit 页签可见）
    this.stationRefitBar = attachGraphics(this.createNode('NativeStationRefitBar', panel));
    this.stationRefitBar.node.active = false;

    // 12 个通用 slot（交易页买/卖各 6），创建时绑定「当前动作表」的闭包。
    for (let index = 0; index < 12; index += 1) {
      const slotIndex = index;
      const slot = this.createPanelButton(
        `StationSlot.${index}`, '', () => this.onStationSlot(slotIndex), panel, 'slot',
      );
      slot.getComponent(UITransform)?.setContentSize(180, 74);
      this.stationSlotButtons.push(slot);
    }

    this.stationBackButton = this.createPanelButton(
      'StationBack', this.st('返回站内', 'Back to Station'), () => {
        this.setStationOpen(false);
        if (this.walkActive) {
          // 从 3D 行走里点进终端：关面板后回到舱内继续飞，而不是回 2D 结算面板。
          if (this.walkHintLayer) this.walkHintLayer.active = true;
          this.setCombatChromeVisible(true);
        } else {
          this.setOutpostOpen(true);
        }
      }, panel,
    );
    panel.active = false;
  }

  private layoutStationPanel(): void {
    const panel = this.stationPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.width < 900 || this.height < 520;
    const cardWidth = Math.max(300, Math.min(this.width - 36, 1040));
    const cardHeight = Math.max(300, Math.min(this.height - 28, 680));

    // 全屏不透光底，防止背后常驻文字层 / 3D 场景透出。
    if (this.stationBackdrop) {
      this.safeClear(this.stationBackdrop);
      this.stationBackdrop.fillColor = new Color(3, 10, 15, 255);
      this.safeRect(this.stationBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.stationBackdrop);
    }
    this.drawGlassPanel(this.stationBackdrop, cardWidth, cardHeight, HUD_CYAN, true);

    const top = cardHeight / 2;
    const bottom = -cardHeight / 2;
    const eyebrow = panel.getChildByName('NativeStationEyebrow');
    if (eyebrow) eyebrow.active = !compact;
    this.placeChild(panel, 'NativeStationEyebrow', 0, top - 24, cardWidth - 56, 18);
    this.placeChild(panel, 'NativeStationTitle', 0, top - (compact ? 22 : 54), cardWidth - 56, 34);

    const tabWidth = Math.min(180, (cardWidth - 64) / 4);
    const tabGap = 10;
    const tabTotal = tabWidth * 4 + tabGap * 3;
    const tabY = top - (compact ? 59 : 96);
    const tabs: readonly StationTab[] = ['contracts', 'trade', 'facilities', 'refit'];
    tabs.forEach((tab, index) => {
      const btn = this.stationTabButtons.get(tab);
      if (!btn) return;
      const x = -tabTotal / 2 + tabWidth / 2 + index * (tabWidth + tabGap);
      btn.setPosition(x, tabY, 4);
      this.resizePanelButton(btn, tabWidth, compact ? 34 : 44, compact ? 11 : 13,
        tab === this.stationTab ? HUD_ACTIVE : HUD_CYAN);
    });

    this.placeChild(panel, 'NativeStationHint', 0, top - (compact ? 94 : 139), cardWidth - 56, 28);

    this.layoutStationSlots();

    if (this.stationBackButton) {
      this.stationBackButton.setPosition(0, bottom + 26, 4);
      this.resizePanelButton(this.stationBackButton, Math.min(180, (cardWidth - 56) / 2), 40, 13);
    }
    // resize 后若面板正开着，重绘一次内容与 accent（renderStation 内部会再定位 slot）。
    const bridge = this.actions?.station;
    if (bridge && this.stationOpen) this.renderStation();
  }

  /** 只排布当前可见 slot 的网格位置/尺寸。页签切换改变可见数量后必须调用。 */
  private layoutStationSlots(): void {
    const compact = this.width < 900 || this.height < 520;
    const cardWidth = Math.max(300, Math.min(this.width - 36, 1040));
    const cardHeight = Math.max(300, Math.min(this.height - 28, 680));
    const top = cardHeight / 2;
    const bottom = -cardHeight / 2;
    const contentTop = top - (compact ? 113 : 160);
    const contentBottom = bottom + 53;
    const visibleCount = Math.max(1, this.stationSlots.length);
    const tradeLayout = this.stationTab === 'trade';
    const cols = tradeLayout ? (cardWidth >= 580 ? 6 : 4) : 3;
    const rows = Math.ceil(Math.min(visibleCount, 12) / cols);
    const refitLayout = this.stationTab === 'refit';
    const contractsLayout = this.stationTab === 'contracts';
    const bodyHeight = refitLayout ? 72 : tradeLayout ? 23 : contractsLayout ? 30 : 0;
    if (this.stationBodyLabel) {
      const node = this.stationBodyLabel.node;
      node.active = bodyHeight > 0;
      // refit：数值文字占 body 上半，图形进度条占下半
      node.setPosition(0, contentTop - (refitLayout ? 18 : bodyHeight / 2), 4);
      node.getComponent(UITransform)?.setContentSize(cardWidth - 56, refitLayout ? 32 : bodyHeight);
      this.stationBodyLabel.fontSize = compact ? 12 : 15;
      this.stationBodyLabel.lineHeight = compact ? 16 : 20;
    }
    if (this.stationRefitBar) {
      const bar = this.stationRefitBar;
      bar.node.active = refitLayout;
      if (refitLayout) {
        bar.node.setPosition(0, contentTop - 54, 4);
        bar.node.getComponent(UITransform)?.setContentSize(cardWidth - 100, 18);
        this.drawStationRefitBar();
      }
    }
    const gridTop = contentTop - bodyHeight;
    const slotGapX = 8;
    const slotGapY = 8;
    const slotW = (cardWidth - 56 - slotGapX * (cols - 1)) / cols;
    const slotH = Math.min(74, (gridTop - contentBottom - slotGapY * (rows - 1)) / rows);
    for (let index = 0; index < this.stationSlotButtons.length; index += 1) {
      const slot = this.stationSlotButtons[index];
      if (!slot.active) continue;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const rowWidth = slotW * cols + slotGapX * (cols - 1);
      const x = -rowWidth / 2 + slotW / 2 + col * (slotW + slotGapX);
      const y = gridTop - slotH / 2 - row * (slotH + slotGapY);
      slot.setPosition(x, y, 4);
      this.resizePanelButton(slot, slotW, slotH, compact ? 12 : 14,
        this.stationSlots[index]?.accent || HUD_CYAN);
    }
  }

  /** 深色玻璃底 + 细描边：新面板与既有的切角视觉语言一致，不用实心色块。 */
  private drawGlassPanel(
    graphics: Graphics | null,
    width: number,
    height: number,
    accent: Color,
    keepBase = false,
  ): void {
    if (!graphics) return;
    // keepBase=true 时保留调用方预先铺好的全屏不透光底（防透字）。
    if (!keepBase) this.safeClear(graphics);
    graphics.fillColor = new Color(5, 16, 22, 242);
    this.safeRoundRect(graphics, -width / 2, -height / 2, width, height, 14);
    this.safeFill(graphics);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, 170);
    graphics.lineWidth = 1.25;
    this.safeRoundRect(graphics, -width / 2, -height / 2, width, height, 14);
    this.safeStroke(graphics);
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 200);
    this.safeRect(graphics, -width / 2 + 20, height / 2 - 24, 46, 3);
    this.safeFill(graphics);
  }

  private placeChild(parent: Node, name: string, x: number, y: number, width: number, height: number): void {
    const node = parent.getChildByName(name);
    if (!node) return;
    node.setPosition(x, y, 4);
    node.getComponent(UITransform)?.setContentSize(width, height);
  }

  private layoutKeybindPanel(): void {
    const panel = this.keybindPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.width < 900 || this.height < 560;
    const cardWidth = Math.max(280, Math.min(this.width - 36, 980));
    const cardHeight = Math.max(280, Math.min(this.height - 32, 640));
    this.keybindDragWidth = Math.min(compact ? cardWidth - 48 : cardWidth * 0.44, 400);
    this.keybindDragHeight = this.keybindDragWidth * 0.56;
    // 2026-11-17：先铺一层全屏不透光暗底，盖住背后的 3D 场景与常驻文字层，
    // 否则卡片外透明区域会透出 FLIGHT CALIBRATION 等残留字样（横屏尤其明显）。
    if (this.keybindBackdrop) {
      this.safeClear(this.keybindBackdrop);
      this.keybindBackdrop.fillColor = new Color(3, 10, 15, 255);
      this.safeRect(this.keybindBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.keybindBackdrop);
    }
    this.drawGlassPanel(this.keybindBackdrop, cardWidth, cardHeight, HUD_CYAN, true);
    const left = -cardWidth / 2;
    const top = cardHeight / 2;
    const bottom = -cardHeight / 2;
    this.placeChild(panel, 'NativeKeybindEyebrow', left + 28, top - 26, cardWidth - 56, 18);
    this.placeChild(panel, 'NativeKeybindTitle', left + 28, top - 56, cardWidth - 56, 38);
    this.placeChild(panel, 'NativeKeybindHint', left + 28, top - 84, cardWidth - 56, 22);

    const footerY = bottom + 34;
    const footerWidth = Math.min(150, (cardWidth - 80) / 3);
    const resetKeys = panel.getChildByName('KeybindResetKeys');
    const resetLayout = panel.getChildByName('KeybindResetLayout');
    const back = panel.getChildByName('KeybindBack');
    resetKeys?.setPosition(-footerWidth - 10, footerY, 4);
    resetLayout?.setPosition(0, footerY, 4);
    back?.setPosition(footerWidth + 10, footerY, 4);
    for (const button of [resetKeys, resetLayout, back]) {
      if (button) this.resizePanelButton(button, footerWidth, 40, 11, HUD_CYAN);
    }

    const contentTop = top - 104;
    const contentBottom = bottom + 64;
    const contentHeight = Math.max(140, contentTop - contentBottom);
    let keysCenterX = 0;
    let keysCenterY = 0;
    let keysWidth = 0;
    let keysHeight = 0;
    let areaX = 0;
    let areaY = 0;
    if (compact) {
      keysWidth = cardWidth - 48;
      keysHeight = Math.max(120, contentHeight * 0.58);
      keysCenterX = 0;
      keysCenterY = contentTop - keysHeight / 2;
      areaX = 0;
      areaY = contentBottom + (contentHeight - keysHeight) / 2 + 6;
    } else {
      keysWidth = cardWidth * 0.5 - 40;
      keysHeight = contentHeight;
      keysCenterX = left + 24 + keysWidth / 2;
      keysCenterY = (contentTop + contentBottom) / 2;
      areaX = cardWidth * 0.24;
      areaY = (contentTop + contentBottom) / 2 - 10;
    }
    const gap = 6;
    const rows = Math.ceil(GAME_ACTIONS.length / 2);
    const buttonWidth = (keysWidth - gap) / 2;
    const buttonHeight = Math.max(28, Math.min(44, (keysHeight - ((rows - 1) * gap)) / rows));
    GAME_ACTIONS.forEach((action, index) => {
      const button = this.keybindButtons.get(action);
      if (!button) return;
      const row = Math.floor(index / 2);
      const column = index % 2;
      const x = keysCenterX + (column === 0 ? -1 : 1) * (buttonWidth + gap) / 2;
      const y = keysCenterY + keysHeight / 2 - buttonHeight / 2 - row * (buttonHeight + gap);
      button.setPosition(x, y, 4);
      this.resizePanelButton(button, buttonWidth, buttonHeight, compact ? 10 : 12,
        this.pendingKeyAction === action ? HUD_ACTIVE : HUD_CYAN);
    });
    const area = this.keybindDragArea;
    if (area) {
      area.setPosition(areaX, areaY, 4);
      area.getComponent(UITransform)?.setContentSize(this.keybindDragWidth, this.keybindDragHeight);
      this.drawKeybindDragFrame();
      this.refreshKeybindDragDots();
    }
    this.placeChild(panel, 'NativeKeybindDragCaption', areaX - this.keybindDragWidth / 2,
      areaY + this.keybindDragHeight / 2 + 16, this.keybindDragWidth, 18);
  }

  private layoutRunlogPanel(): void {
    const panel = this.runlogPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.width < 820 || this.height < 520;
    const cardWidth = Math.max(280, Math.min(this.width - 36, 960));
    const cardHeight = Math.max(280, Math.min(this.height - 32, 620));
    // 同键位面板：全屏不透光底，防止背后常驻文字层透出。
    if (this.runlogBackdrop) {
      this.safeClear(this.runlogBackdrop);
      this.runlogBackdrop.fillColor = new Color(3, 10, 15, 255);
      this.safeRect(this.runlogBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.runlogBackdrop);
    }
    this.drawGlassPanel(this.runlogBackdrop, cardWidth, cardHeight, HUD_CYAN, true);
    const left = -cardWidth / 2;
    const top = cardHeight / 2;
    const bottom = -cardHeight / 2;
    this.placeChild(panel, 'NativeRunlogEyebrow', left + 28, top - 26, cardWidth - 56, 18);
    this.placeChild(panel, 'NativeRunlogTitle', left + 28, top - 56, cardWidth - 56, 38);
    this.placeChild(panel, 'NativeRunlogHint', left + 28, top - 84, cardWidth - 56, 22);

    const contentTop = top - 104;
    const contentBottom = bottom + 64;
    const contentHeight = Math.max(140, contentTop - contentBottom);
    const listWidth = compact ? cardWidth - 48 : Math.min(320, cardWidth * 0.38);
    const detailWidth = compact ? cardWidth - 48 : cardWidth - listWidth - 80;
    const logCardHeight = Math.max(58, Math.min(86, (contentHeight - 20) / 3));
    this.runlogCards.forEach((card, index) => {
      const x = compact ? 0 : left + 28 + listWidth / 2;
      card.setPosition(x, contentTop - logCardHeight / 2 - index * (logCardHeight + 8), 4);
      this.resizePanelButton(card, listWidth, logCardHeight, compact ? 10 : 11,
        index === this.selectedRunLog ? HUD_ACTIVE : HUD_CYAN);
    });
    if (this.runlogDetailLabel) {
      const node = this.runlogDetailLabel.node;
      if (compact) {
        const available = Math.max(80, contentHeight - 3 * (logCardHeight + 8) - 12);
        node.setPosition(0, contentBottom + available / 2, 4);
        node.getComponent(UITransform)?.setContentSize(detailWidth, available);
        this.runlogDetailLabel.fontSize = 10;
        this.runlogDetailLabel.lineHeight = 14;
      } else {
        node.setPosition(left + 28 + listWidth + 24 + detailWidth / 2,
          (contentTop + contentBottom) / 2, 4);
        node.getComponent(UITransform)?.setContentSize(detailWidth, contentHeight);
        this.runlogDetailLabel.fontSize = 12;
        this.runlogDetailLabel.lineHeight = 17;
      }
    }

    const footerY = bottom + 34;
    const footerWidth = Math.min(150, (cardWidth - 80) / 3);
    const copy = panel.getChildByName('RunlogCopy');
    const refresh = panel.getChildByName('RunlogRefresh');
    const back = panel.getChildByName('RunlogBack');
    copy?.setPosition(-footerWidth - 10, footerY, 4);
    refresh?.setPosition(0, footerY, 4);
    back?.setPosition(footerWidth + 10, footerY, 4);
    for (const button of [copy, refresh, back]) {
      if (button) this.resizePanelButton(button, footerWidth, 40, 11, HUD_CYAN);
    }
  }

  private selectMission(preset: MissionPreset): void {
    this.missionPreset = preset;
    this.onSelectMission?.(preset);
    this.updateHomeSelection();
  }

  private updateHomeSelection(): void {
    const missionKey = `home.${this.missionPreset}` as CombatMessageKey;
    if (this.homeMissionLabel) {
      this.homeMissionLabel.string = this.text('home.selected', { mission: this.text(missionKey) });
    }
    for (const [preset, button] of this.missionButtons) {
      // ⚠️ 这里**不能**用固定尺寸 resizePanelButton：
      // 任务从 3 个增到 6 个后改成了两列网格，尺寸由 layoutHome 统一算；
      // 这里再写死 214×70 会把网格布局覆盖掉（按钮挤成一列）。
      // 做法：读出按钮当前尺寸，只重绘颜色。
      const transform = button.getComponent(UITransform);
      const width = transform?.contentSize.width ?? 214;
      const height = transform?.contentSize.height ?? 70;
      this.resizePanelButton(button, width, height, this.labelFontSizeFor(button), preset === this.missionPreset ? HUD_ACTIVE : HUD_CYAN);
    }
  }

  /** 读回按钮标签的当前字号（保持与布局阶段一致，避免选中时字号突变） */
  private labelFontSizeFor(node: Node): number {
    const label = node.getChildByName('Label')?.getComponent(Label);
    return label?.fontSize ?? 13;
  }

  private setHomeOpen(open: boolean): void {
    if (this.homeOpen === open && this.homePanel?.active === open) return;
    if (open) this.activateOnly('home');
    this.homeOpen = open;
    if (this.homePanel) {
      this.homePanel.active = open;
      if (open) {
        const opacity = this.homePanel.getComponent(UIOpacity);
        if (opacity) {
          opacity.opacity = 0;
          tween(opacity).to(0.18, { opacity: 255 }).start();
        }
        this.homePanel.setScale(0.985, 0.985, 1);
        tween(this.homePanel).to(0.2, { scale: new Vec3(1, 1, 1) }).start();
      }
    }
    this.setCombatChromeVisible(!open && !this.outpostOpen && !this.loadoutOpen && !this.defeatOpen && !this.pauseOpen);
    this.updateHomeSelection();
    if (open) {
      // 二次打开按当前 homeView 重刷数据：说明文案/颜色、货舱、商城、设置、行动档案、联机控件，
      // 避免沿用旧货舱清单与上次商城购买反馈的文案/颜色。
      this.refreshHomeViewText();
      this.updateHomeCargo();
      this.updateMarketLabels();
      this.updateSettingsLabels();
      this.refreshOperationsReadout();
      this.updateCoopControls();
    }
  }

  private setOutpostOpen(open: boolean): void {
    if (this.outpostOpen === open && this.outpostPanel?.active === open) return;
    if (open) {
      if (this.returnOverlay) this.returnOverlay.active = false;
      if (this.returnVeil) this.returnVeil.node.active = false;
      if (this.returnVeilInner) this.returnVeilInner.node.active = false;
    }
    if (open) this.activateOnly('outpost');
    // 打开前哨时用缓存 snapshot 刷新真实三量与星港券。
    if (open) this.updateOutpostReadouts();
    this.outpostOpen = open;
    if (this.outpostPanel) {
      this.outpostPanel.active = open;
      if (open) {
        const opacity = this.outpostPanel.getComponent(UIOpacity);
        if (opacity) {
          opacity.opacity = 0;
          tween(opacity).to(0.18, { opacity: 255 }).start();
        }
      }
    }
    this.setCombatChromeVisible(!open && !this.homeOpen && !this.loadoutOpen && !this.defeatOpen && !this.pauseOpen);
  }

  private activateOnly(active: NativeOverlay): void {
    const overlays: readonly [NativeOverlay, Node | null][] = [
      ['home', this.homePanel],
      ['loadout', this.loadoutPanel],
      ['outpost', this.outpostPanel],
      ['defeat', this.defeatPanel],
      ['pause', this.pausePanel],
      ['keybind', this.keybindPanel],
      ['runlog', this.runlogPanel],
      ['station', this.stationPanel],
    ];
    this.homeOpen = active === 'home';
    this.loadoutOpen = active === 'loadout';
    this.outpostOpen = active === 'outpost';
    this.defeatOpen = active === 'defeat';
    this.pauseOpen = active === 'pause';
    this.keybindOpen = active === 'keybind';
    this.runlogOpen = active === 'runlog';
    this.stationOpen = active === 'station';
    for (const [id, panel] of overlays) {
      if (panel) panel.active = id === active;
    }
    // 任一覆盖面板（home/loadout/outpost/defeat/pause）激活时，强制收起首飞校准面板，
    // 否则它曾停留在战斗态，会在菜单/装配台上叠加漂浮的步骤标签（状态机串台 + 双步骤重叠）。
    if (this.trainingPanel) this.trainingPanel.active = false;
    this.trainingOpen = false;
    if (this.bootPanel) this.bootPanel.active = false;
  }

  private setCombatChromeVisible(visible: boolean): void {
    // 2026-11-19 修正：此前每个调用点各自拼 `!homeOpen && !outpostOpen && ...`，
    // 新增的 station/keybind/runlog 三个面板漏进了这条判断——站内面板打开后，
    // 任一 resize() 或关面板收口都会用 `setCombatChromeVisible(true)` 把摇杆/开火/
    // 返航重新点亮，浮在站内面板上（真机截图实锤）。这里统一收口：任一覆盖面板
    // 打开就强制隐藏战斗控件，调用点再怎么拼都不会穿透。
    const anyOverlayOpen = this.homeOpen || this.outpostOpen || this.loadoutOpen
      || this.defeatOpen || this.pauseOpen || this.keybindOpen || this.runlogOpen
      || this.stationOpen || this.shouldShowTraining();
    this.combatChromeVisible = visible && !this.startupVisible && !anyOverlayOpen;
    // 打开面板时连击/强化/武器读数也必须一并收起，否则旧读数浮在面板上。
    // 3D 行走态同样收起读数，只留摇杆/开火键（下面 refreshActionVisibility 保留）。
    const showReadouts = visible && !this.walkActive;
    for (const label of [this.statusLabel, this.objectiveLabel, this.sectorLabel, this.targetLabel, this.cargoLabel, this.combatFeedLabel, this.navigationLabel, this.weaponLabel, this.abilityLabel, this.comboLabel, this.upgradeLabel]) {
      if (label) label.node.active = showReadouts;
    }
    if (this.reticleGraphics) this.reticleGraphics.node.active = showReadouts;
    if (this.objectivePlate) this.objectivePlate.node.active = showReadouts;
    for (const graphics of [this.hullStatusBar, this.shieldStatusBar, this.energyStatusBar, this.targetHealthBar, this.hitMarker]) {
      if (graphics) graphics.node.active = visible;
    }
    if (this.loadoutButton) this.loadoutButton.active = visible && !this.returning;
    if (this.stickThumb) this.stickThumb.active = visible && !this.returning;
    this.refreshActionVisibility();
    // 调试遥测任何情况下都不显示。
    if (this.debugTelemetryLabel) this.debugTelemetryLabel.node.active = false;
  }

  /** 返航中只保留暂停/视角/返航进度按钮，其余战斗输入全部收起。 */
  private refreshActionVisibility(): void {
    for (const [role, visual] of this.actionVisuals) {
      const allowed = !this.returning
        || role === 'pause' || role === 'cameraToggle' || role === 'returnRequested';
      const available = role !== 'returnRequested' || this.canReturn || this.canDock;
      visual.node.active = this.combatChromeVisible && allowed && available;
    }
  }

  private layoutHomePanel(): void {
    const panel = this.homePanel;
    if (!panel) return;
    // 0.13.30：主面板 backdrop 是崩溃前最后一段集中走 Sprite-shim 的绘制。
    // 首尾各打一条（仅首次），下次崩溃能判断是「进入绘制前」还是「绘制过程中」出事。
    // 置位放在 END，确保同一次首绘能打出 BEGIN + END 两条。
    if (!this.homeLayoutTraceDone) {
      nativeTrace('hud: home layout backdrop draw BEGIN');
    }
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.homeKeyArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.height < 470 || this.width < 900;
    const ultraCompact = this.height < 410 || this.width < 720;
    const navWidth = ultraCompact ? 58 : compact ? 66 : 82;
    const rightWidth = Math.min(
      ultraCompact ? 218 : compact ? 242 : 360,
      Math.max(196, this.width * (ultraCompact ? 0.31 : compact ? 0.29 : 0.27)),
    );
    const leftEdge = (-this.width / 2) + this.safeInsets.left;
    const rightEdge = (this.width / 2) - this.safeInsets.right;
    const topEdge = (this.height / 2) - this.safeInsets.top;
    const bottomEdge = (-this.height / 2) + this.safeInsets.bottom;
    const contentLeft = leftEdge + navWidth + (ultraCompact ? 10 : compact ? 14 : 22);
    const headerWidth = Math.max(180, rightEdge - rightWidth - contentLeft - 12);
    if (this.homeBackdrop) {
      this.safeClear(this.homeBackdrop);
      this.homeBackdrop.fillColor = new Color(2, 8, 12, 62);
      this.safeRect(this.homeBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.homeBackdrop);
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 238);
      this.safeRect(this.homeBackdrop, leftEdge, bottomEdge, navWidth, topEdge - bottomEdge);
      this.safeFill(this.homeBackdrop);
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 226);
      this.safeRect(this.homeBackdrop, rightEdge - rightWidth, bottomEdge, rightWidth, topEdge - bottomEdge);
      this.safeFill(this.homeBackdrop);
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 204);
      const headerHeight = ultraCompact ? 48 : compact ? 58 : 72;
      this.safeRect(this.homeBackdrop, leftEdge + navWidth, topEdge - headerHeight, rightEdge - leftEdge - navWidth - rightWidth, headerHeight);
      this.safeFill(this.homeBackdrop);
      this.homeBackdrop.strokeColor = new Color(255, 172, 47, 126);
      this.homeBackdrop.lineWidth = 2;
      this.safeMoveTo(this.homeBackdrop, rightEdge - rightWidth, bottomEdge + 18);
      this.safeLineTo(this.homeBackdrop, rightEdge - rightWidth, topEdge - 18);
      this.safeStroke(this.homeBackdrop);
      this.homeBackdrop.strokeColor = new Color(59, 211, 255, 72);
      this.homeBackdrop.lineWidth = 1;
      this.safeMoveTo(this.homeBackdrop, leftEdge + navWidth + 12, topEdge - headerHeight - 8);
      this.safeLineTo(this.homeBackdrop, rightEdge - rightWidth - 24, topEdge - headerHeight - 8);
      this.safeLineTo(this.homeBackdrop, rightEdge - rightWidth - 10, topEdge - headerHeight - 22);
      this.safeStroke(this.homeBackdrop);
      this.drawPanelFrame(this.homeBackdrop, leftEdge, bottomEdge, rightEdge - leftEdge, topEdge - bottomEdge, HUD_CYAN, 'standard', false);
    }
    const placeHeader = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(contentLeft + (headerWidth / 2), y, 3);
      node?.getComponent(UITransform)?.setContentSize(headerWidth, height);
    };
    placeHeader('NativeHomeEyebrow', topEdge - (ultraCompact ? 10 : compact ? 13 : 18), ultraCompact ? 16 : 20);
    placeHeader('NativeHomeTitle', topEdge - (ultraCompact ? 27 : compact ? 36 : 48), ultraCompact ? 22 : compact ? 30 : 40);
    placeHeader('NativeHomeSubtitle', topEdge - (ultraCompact ? 43 : compact ? 54 : 68), ultraCompact ? 16 : compact ? 20 : 26);
    this.homeProfileLabel?.node.setPosition(rightEdge - (rightWidth / 2), topEdge - (ultraCompact ? 17 : compact ? 22 : 28), 4);
    this.homeProfileLabel?.getComponent(UITransform)?.setContentSize(rightWidth - 24, 26);

    // 6 个 tab 后按可用高度自适应按钮高，避免窄屏竖排溢出左侧导航条。
    const navCount = this.homeNavButtons.size;
    const navGap = ultraCompact ? 4 : compact ? 6 : 9;
    const navStart = ultraCompact ? 65 : compact ? 88 : 112;
    const navAvailable = (topEdge - navStart) - bottomEdge - 8;
    const navHeight = Math.max(28, Math.min(ultraCompact ? 38 : compact ? 44 : 54,
      (navAvailable - (navCount - 1) * navGap) / navCount));
    Array.from(this.homeNavButtons.entries()).forEach(([viewId, button], index) => {
      button.setPosition(leftEdge + (navWidth / 2), topEdge - navStart - index * (navHeight + navGap), 4);
      this.resizePanelButton(button, navWidth - 8, navHeight, ultraCompact ? 9 : compact ? 10 : 12,
        viewId === this.homeView ? HUD_ACTIVE : HUD_CYAN);
    });

    const boardCenterX = rightEdge - (rightWidth / 2);
    this.homeViewTitle?.node.setPosition(boardCenterX, topEdge - (ultraCompact ? 48 : compact ? 72 : 92), 4);
    this.homeViewTitle?.getComponent(UITransform)?.setContentSize(rightWidth - 28, ultraCompact ? 22 : compact ? 28 : 34);
    this.homeViewDetail?.node.setPosition(boardCenterX, topEdge - (ultraCompact ? 69 : compact ? 100 : 128), 4);
    this.homeViewDetail?.getComponent(UITransform)?.setContentSize(rightWidth - 28, ultraCompact ? 20 : compact ? 28 : 42);
    const actionHeight = ultraCompact ? 36 : compact ? 42 : 52;
    const actionY = bottomEdge + (actionHeight / 2) + (ultraCompact ? 6 : 10);
    const missionTop = topEdge - (ultraCompact ? 83 : compact ? 124 : 176);
    const missionGap = ultraCompact ? 4 : compact ? 6 : 10;
    const missionBottom = actionY + (actionHeight / 2) + 6;
    // 任务从 3 个增加到 6 个后，竖排一列在手机上会挤到看不清字。
    // 改成两列网格（每行最多 2 个），行数按任务数动态算。
    const missionTotal = this.missionButtons.size;
    const missionColumns = missionTotal > 3 ? 2 : 1;
    const missionRows = Math.ceil(missionTotal / missionColumns);
    const missionColumnGap = 8;
    const missionRowGap = missionGap;
    const missionColumnWidth = (rightWidth - 24 - (missionColumnGap * (missionColumns - 1))) / missionColumns;
    const missionHeight = Math.max(
      32,
      Math.min(
        ultraCompact ? 44 : compact ? 52 : 70,
        (missionTop - missionBottom - (missionRowGap * (missionRows - 1))) / missionRows,
      ),
    );
    Array.from(this.missionButtons.entries()).forEach(([preset, button], index) => {
      const column = index % missionColumns;
      const row = Math.floor(index / missionColumns);
      const x = boardCenterX + (column - (missionColumns - 1) / 2) * (missionColumnWidth + missionColumnGap);
      button.setPosition(x, missionTop - (missionHeight / 2) - row * (missionHeight + missionRowGap), 4);
      this.resizePanelButton(button, missionColumnWidth, missionHeight, ultraCompact ? 9 : compact ? 10 : 13,
        preset === this.missionPreset ? HUD_ACTIVE : HUD_CYAN);
    });
    this.hangarButton?.setPosition(boardCenterX, actionY, 4);
    this.deployButton?.setPosition(boardCenterX, actionY, 4);
    this.resizePanelButton(this.hangarButton, rightWidth - 24, actionHeight, ultraCompact ? 10 : compact ? 11 : 14, HUD_ACTIVE);
    this.resizePanelButton(this.deployButton, rightWidth - 24, actionHeight, ultraCompact ? 11 : compact ? 12 : 15, HUD_ACTIVE);
    this.homeMissionLabel?.node.setPosition(contentLeft + Math.min(220, headerWidth / 2), bottomEdge + 24, 4);
    this.homeMissionLabel?.getComponent(UITransform)?.setContentSize(Math.min(430, headerWidth), 28);
    this.homeCargoLabel?.node.setPosition(boardCenterX, (missionTop + missionBottom) / 2, 4);
    this.homeCargoLabel?.getComponent(UITransform)?.setContentSize(rightWidth - 28, Math.max(96, missionTop - missionBottom));
    Array.from(this.marketButtons.values()).forEach((button, index) => {
      const height = Math.max(38, Math.min(ultraCompact ? 44 : compact ? 54 : 70, (missionTop - missionBottom - 16) / 3));
      button.setPosition(boardCenterX, missionTop - (height / 2) - index * (height + 8), 4);
      this.resizePanelButton(button, rightWidth - 28, height, ultraCompact ? 9 : compact ? 10 : 12);
    });
    // 设置项从 8 个增到 10 个：单列会把每行压到 30px 以下，改成两列网格。
    const settingsGap = ultraCompact ? 3 : compact ? 5 : 8;
    const settingsTop = topEdge - (ultraCompact ? 88 : compact ? 142 : 190);
    const available = settingsTop - missionBottom;
    const settingsRows = Math.ceil(this.settingsButtons.length / 2);
    const settingsHeight = Math.max(30, Math.min(ultraCompact ? 38 : compact ? 46 : 58,
      (available - ((settingsRows - 1) * settingsGap)) / settingsRows));
    const settingsWidth = (rightWidth - 28 - settingsGap) / 2;
    this.settingsButtons.forEach((button, index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const x = boardCenterX + (column === 0 ? -1 : 1) * (settingsWidth + settingsGap) / 2;
      button.setPosition(x, settingsTop - (settingsHeight / 2) - row * (settingsHeight + settingsGap), 4);
      this.resizePanelButton(button, settingsWidth, settingsHeight, ultraCompact ? 9 : compact ? 10 : 12);
    });
    this.homeControllerLabel?.node.setPosition(boardCenterX, bottomEdge + 24, 4);
    this.homeControllerLabel?.getComponent(UITransform)?.setContentSize(rightWidth - 24, 34);
    // 行动视图远征档案：放在左侧内容区中部（header 与底部 mission 标签之间）。
    const opsWidth = Math.min(430, Math.max(200, rightEdge - rightWidth - contentLeft - 24));
    this.homeOpsLabel?.node.setPosition(contentLeft + (opsWidth / 2), (topEdge + bottomEdge) / 2, 4);
    this.homeOpsLabel?.getComponent(UITransform)?.setContentSize(opsWidth, Math.max(120, (topEdge - bottomEdge) * 0.4));
    // 联机视图：5 个按钮单列 + 状态 / 邀请码标签，全部落在右侧 board 内。
    const coopWidth = rightWidth - 28;
    const coopActionHeight = Math.max(30, Math.min(ultraCompact ? 38 : compact ? 44 : 50,
      (missionTop - missionBottom - 110) / 5));
    const coopButtons = [this.coopHostButton, this.coopJoinButton, this.coopCloseButton, this.coopCopyButton];
    coopButtons.forEach((button, index) => {
      button?.setPosition(boardCenterX, missionTop - (coopActionHeight / 2) - index * (coopActionHeight + 6), 4);
      this.resizePanelButton(button, coopWidth, coopActionHeight, ultraCompact ? 9 : compact ? 10 : 12);
    });
    if (this.coopJoinInput) {
      this.coopJoinInput.node.setPosition(boardCenterX, missionBottom + 108, 4);
      this.coopJoinInput.node.getComponent(UITransform)?.setContentSize(coopWidth, 36);
      const background = graphicsOf(this.coopJoinInput.node);
      if (background) {
        this.safeClear(background);
        background.fillColor = HUD_DARK;
        this.safeRoundRect(background, -(coopWidth / 2), -18, coopWidth, 36, 6);
        this.safeFill(background);
        background.strokeColor = HUD_CYAN;
        background.lineWidth = 2;
        this.safeRoundRect(background, -(coopWidth / 2), -18, coopWidth, 36, 6);
        this.safeStroke(background);
      }
    }
    this.coopStatusLabel?.node.setPosition(boardCenterX, missionBottom + 60, 4);
    this.coopStatusLabel?.getComponent(UITransform)?.setContentSize(coopWidth, 44);
    this.coopCodeLabel?.node.setPosition(boardCenterX, missionBottom + 8, 4);
    this.coopCodeLabel?.getComponent(UITransform)?.setContentSize(coopWidth, 52);
    if (!this.homeLayoutTraceDone) {
      this.homeLayoutTraceDone = true;
      nativeTrace('hud: home layout backdrop draw END');
    }
  }

  private layoutOutpostPanel(): void {
    const panel = this.outpostPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.outpostKeyArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.height < 470 || this.width < 820;
    const ultraCompact = this.height < 400 || this.width < 680;
    const left = (-this.width / 2) + this.safeInsets.left;
    const right = (this.width / 2) - this.safeInsets.right;
    const top = (this.height / 2) - this.safeInsets.top;
    const bottom = (-this.height / 2) + this.safeInsets.bottom;
    const panelWidth = Math.min(ultraCompact ? 252 : compact ? 300 : 390, Math.max(230, this.width * 0.34));
    if (this.outpostBackdrop) {
      this.safeClear(this.outpostBackdrop);
      this.outpostBackdrop.fillColor = new Color(1, 7, 10, 54);
      this.safeRect(this.outpostBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.outpostBackdrop);
      // 面板底色必须完全不透明，否则底下宣传图的英文标语会透过标题。
      this.outpostBackdrop.fillColor = new Color(2, 10, 14, 255);
      this.safeRect(this.outpostBackdrop, right - panelWidth, bottom, panelWidth, top - bottom);
      this.safeFill(this.outpostBackdrop);
      this.outpostBackdrop.strokeColor = new Color(59, 211, 255, 116);
      this.outpostBackdrop.lineWidth = 2;
      this.safeMoveTo(this.outpostBackdrop, right - panelWidth, bottom + 18);
      this.safeLineTo(this.outpostBackdrop, right - panelWidth, top - 18);
      this.safeStroke(this.outpostBackdrop);
      this.outpostBackdrop.strokeColor = new Color(226, 245, 255, 58);
      this.outpostBackdrop.lineWidth = 1;
      for (let index = 0; index < 4; index += 1) {
        const y = top - (ultraCompact ? 105 : 154) - index * (ultraCompact ? 19 : 27);
        this.safeMoveTo(this.outpostBackdrop, right - panelWidth + 18, y);
        this.safeLineTo(this.outpostBackdrop, right - 18, y);
      }
      this.safeStroke(this.outpostBackdrop);
      this.outpostBackdrop.fillColor = new Color(59, 211, 255, 112);
      this.safeRect(this.outpostBackdrop, right - panelWidth + 18, top - (ultraCompact ? 112 : 161), 48, 3);
      this.safeFill(this.outpostBackdrop);
      this.drawPanelFrame(this.outpostBackdrop, right - panelWidth, bottom, panelWidth, top - bottom, HUD_CYAN, 'standard', false);
    }
    const centerX = right - panelWidth / 2;
    const contentWidth = panelWidth - (ultraCompact ? 22 : 34);
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(centerX, y, 4);
      node?.getComponent(UITransform)?.setContentSize(contentWidth, height);
      const label = node?.getComponent(Label);
      if (label) label.overflow = Label.Overflow.SHRINK;
    };
    place('NativeOutpostEyebrow', top - (ultraCompact ? 16 : 24), 20);
    place('NativeOutpostTitle', top - (compact ? 42 : 62), compact ? 30 : 44);
    place('NativeOutpostDetail', top - (compact ? 70 : 108), compact ? 26 : 40);
    const gap = compact ? 6 : 10;
    const actionHeight = Math.max(28, Math.min(compact ? 40 : 54, (top - bottom) * 0.11));
    const undockY = bottom + 8 + actionHeight / 2;
    const lowerY = undockY + actionHeight + gap;
    const servicesTop = lowerY + 2.5 * actionHeight + 2 * gap;
    const readoutTop = top - (compact ? 87 : 132);
    const readoutHeight = Math.max(1, (readoutTop - servicesTop - 8) / 4);
    ['NativeOutpostStatus', 'NativeOutpostCargo', 'NativeOutpostVitals', 'NativeOutpostTickets'].forEach((name, index) => {
      place(name, readoutTop - (index + 0.5) * readoutHeight, Math.min(readoutHeight, 34));
    });

    const serviceButtons = [this.outpostRepairButton, this.outpostResupplyButton, this.outpostRefitButton, this.outpostHomeButton];
    const serviceWidth = (contentWidth - 8) / 2;
    serviceButtons.forEach((button, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = centerX + (col === 0 ? -(serviceWidth / 2) - 4 : (serviceWidth / 2) + 4);
      const y = lowerY + (2 - row) * (actionHeight + gap);
      button?.setPosition(x, y, 4);
      this.resizePanelButton(button, serviceWidth, actionHeight, ultraCompact ? 10 : 12);
    });
    // 「舱内物资」「站内玩法」「进入装配台」三等分占同一行，离港按钮仍独占整行。
    const thirdWidth = (contentWidth - 12) / 3;
    const thirdStep = thirdWidth + 6;
    this.outpostInteriorButton?.setPosition(centerX - thirdStep, lowerY, 4);
    this.outpostStationButton?.setPosition(centerX, lowerY, 4);
    this.outpostLoadoutButton?.setPosition(centerX + thirdStep, lowerY, 4);
    this.resizePanelButton(this.outpostInteriorButton, thirdWidth, actionHeight, ultraCompact ? 9 : 11);
    this.resizePanelButton(this.outpostStationButton, thirdWidth, actionHeight, ultraCompact ? 9 : 12, HUD_ACTIVE);
    this.resizePanelButton(this.outpostLoadoutButton, thirdWidth, actionHeight, ultraCompact ? 9 : 11);
    this.outpostUndockButton?.setPosition(centerX, undockY, 4);
    this.resizePanelButton(this.outpostUndockButton, contentWidth, actionHeight, ultraCompact ? 12 : 15, HUD_ACTIVE);
  }

  private layoutBootPanel(): void {
    const panel = this.bootPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.bootKeyArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const shade = graphicsOf(panel.getChildByName('NativeBootShade'));
    if (shade) {
      this.safeClear(shade);
      shade.fillColor = new Color(1, 7, 10, 72);
      this.safeRect(shade, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(shade);
      shade.fillColor = new Color(1, 7, 10, 220);
      this.safeRect(shade, -this.width / 2, -this.height / 2, Math.min(620, this.width * 0.52), this.height);
      this.safeFill(shade);
    }
    const left = (-this.width / 2) + this.safeInsets.left + 34;
    const bottom = (-this.height / 2) + this.safeInsets.bottom + 32;
    const width = Math.min(520, this.width * 0.48);
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(left + (width / 2), y, 4);
      node?.getComponent(UITransform)?.setContentSize(width, height);
    };
    place('NativeBootChannel', bottom + 148, 22);
    place('NativeBootTitle', bottom + 108, 54);
    place('NativeBootSubtitle', bottom + 73, 28);
    place('NativeBootStatus', bottom + 31, 24);
    this.bootProgress?.node.setPosition(left, bottom + 10, 4);
  }

  private drawBootProgress(value: number, accent = HUD_CYAN): void {
    const graphics = this.bootProgress;
    if (!graphics) return;
    const width = Math.min(360, Math.max(220, this.width * 0.28));
    this.safeClear(graphics);
    graphics.fillColor = new Color(45, 70, 76, 220);
    this.safeRect(graphics, 0, -1, width, 2);
    this.safeFill(graphics);
    graphics.fillColor = accent;
    this.safeRect(graphics, 0, -2, width * Math.max(0, Math.min(1, value)), 4);
    this.safeFill(graphics);
  }

  private layoutDefeatPanel(): void {
    const panel = this.defeatPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    // 框宽高由屏幕尺寸推导，窄屏不再溢出（旧版写死 460×256）。
    const frameW = Math.min(540, this.width - 32);
    const frameH = Math.min(300, this.height - 32);
    if (this.defeatBackdrop) {
      this.safeClear(this.defeatBackdrop);
      this.defeatBackdrop.fillColor = new Color(2, 7, 10, 224);
      this.safeRect(this.defeatBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.defeatBackdrop);
      this.defeatBackdrop.strokeColor = new Color(217, 86, 66, 220);
      this.defeatBackdrop.lineWidth = 2;
      this.safeMoveTo(this.defeatBackdrop, -frameW / 2 + 10, frameH / 2 - 22);
      this.safeLineTo(this.defeatBackdrop, frameW / 2 - 10, frameH / 2 - 22);
      this.safeStroke(this.defeatBackdrop);
      this.drawPanelFrame(this.defeatBackdrop, -frameW / 2, -frameH / 2, frameW, frameH, HUD_RED, 'danger');
    }
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(0, y, 3);
      node?.getComponent(UITransform)?.setContentSize(Math.min(520, frameW - 48), height);
    };
    place('NativeDefeatSignal', 76, 22);
    place('NativeDefeatTitle', 32, 48);
    place('NativeDefeatDetail', -16, 30);
    const compact = this.width < 700;
    const buttonWidth = Math.min(190, (frameW - 42) / 2);
    const restart = panel.getChildByName('NativeDefeatRestart');
    const returnHome = panel.getChildByName('NativeDefeatReturn');
    // 按钮 y 随框高同步，始终留在框底之上。
    const buttonY = -(frameH / 2) + 44;
    restart?.setPosition(-(buttonWidth / 2) - 6, buttonY, 3);
    returnHome?.setPosition((buttonWidth / 2) + 6, buttonY, 3);
    this.resizePanelButton(restart, buttonWidth, compact ? 44 : 50, compact ? 12 : 14, HUD_ACTIVE);
    this.resizePanelButton(returnHome, buttonWidth, compact ? 44 : 50, compact ? 12 : 14);
  }

  private layoutPausePanel(): void {
    const panel = this.pausePanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    // 框宽高由屏幕尺寸推导，窄屏不再溢出（旧版写死 500×300）。
    const frameW = Math.min(540, this.width - 32);
    const frameH = Math.min(300, this.height - 32);
    if (this.pauseBackdrop) {
      this.safeClear(this.pauseBackdrop);
      this.pauseBackdrop.fillColor = new Color(1, 6, 10, 182);
      this.safeRect(this.pauseBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.pauseBackdrop);
      this.pauseBackdrop.fillColor = new Color(3, 13, 20, 242);
      this.safeRect(this.pauseBackdrop, -frameW / 2, -frameH / 2, frameW, frameH);
      this.safeFill(this.pauseBackdrop);
      this.pauseBackdrop.strokeColor = HUD_CYAN;
      this.pauseBackdrop.lineWidth = 2;
      this.safeMoveTo(this.pauseBackdrop, -frameW / 2, frameH / 2);
      this.safeLineTo(this.pauseBackdrop, frameW / 2, frameH / 2);
      this.safeStroke(this.pauseBackdrop);
      this.drawPanelFrame(this.pauseBackdrop, -frameW / 2, -frameH / 2, frameW, frameH, HUD_CYAN);
    }
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(0, y, 3);
      node?.getComponent(UITransform)?.setContentSize(Math.min(440, frameW - 48), height);
    };
    place('NativePauseSignal', 104, 24);
    place('NativePauseTitle', 62, 44);
    place('NativePauseDetail', 18, 34);
    const buttonWidth = Math.min(210, (frameW - 64) / 2);
    const resume = panel.getChildByName('NativePauseResume');
    const operations = panel.getChildByName('NativePauseOperations');
    const home = panel.getChildByName('NativePauseHome');
    // 「返回基地」按钮 y 按框高比例同步：留足底边距，不再越过框底（-150）。
    const homeY = -(frameH / 2) + 34;
    resume?.setPosition(-(buttonWidth / 2) - 6, homeY + 76, 3);
    operations?.setPosition((buttonWidth / 2) + 6, homeY + 76, 3);
    home?.setPosition(0, homeY, 3);
    this.resizePanelButton(resume, buttonWidth, 52, 14, HUD_ACTIVE);
    this.resizePanelButton(operations, buttonWidth, 52, 14);
    this.resizePanelButton(home, Math.min(440, frameW - 48), 52, 14);
  }

  private setDefeatOpen(open: boolean): void {
    if (this.defeatOpen === open) return;
    if (open) this.activateOnly('defeat');
    this.defeatOpen = open;
    if (this.defeatPanel) this.defeatPanel.active = open;
    if (open) {
      this.inputReleaseVisuals();
      this.setCombatChromeVisible(false);
      return;
    }
    this.setCombatChromeVisible(!this.homeOpen && !this.outpostOpen && !this.loadoutOpen && !this.defeatOpen);
  }

  private setPauseOpen(open: boolean): void {
    if (this.pauseOpen === open && this.pausePanel?.active === open) return;
    if (open) this.activateOnly('pause');
    this.pauseOpen = open;
    if (this.pausePanel) {
      this.pausePanel.active = open;
      if (open) {
        const opacity = this.pausePanel.getComponent(UIOpacity);
        if (opacity) {
          opacity.opacity = 0;
          tween(opacity).to(0.14, { opacity: 255 }).start();
        }
      }
    }
    this.setCombatChromeVisible(!open && !this.homeOpen && !this.outpostOpen && !this.loadoutOpen && !this.defeatOpen);
  }

  private inputReleaseVisuals(): void {
    this.setStickFeedback({ active: false, axis: { x: 0, y: 0 }, travel: 0, threshold: 'center', angle: 0, crossedThreshold: false });
    for (const [role] of this.actionVisuals) this.setAction(role, false);
  }

  private commitLoadout(enteringBattle: boolean): void {
    this.onApplyLoadout?.({ ...this.pendingLoadout });
    this.appliedLoadout = resolveLoadout(this.pendingLoadout);
    const feedback = `${this.text(enteringBattle ? 'loadout.entering' : 'loadout.committed')}  ·  ${this.loadoutName(this.pendingLoadout.weapon)} / ${this.loadoutName(this.pendingLoadout.device)}`;
    if (this.loadoutFeedbackLabel) this.loadoutFeedbackLabel.string = feedback;
    if (this.statusLabel) {
      this.statusLabel.string = this.text('status.loadout', { message: feedback });
      this.statusLabel.color = HUD_CYAN;
    }
    this.setButtonText(this.loadoutButton, this.text('loadout.applied'));
    this.preflight = false;
    this.setButtonText(this.applyLoadoutButton, this.text('loadout.apply'));
    this.setButtonText(this.closeLoadoutButton, this.text('loadout.back'));
    this.setLoadoutOpen(false);
    if (this.loadoutFromOutpost) {
      this.loadoutFromOutpost = false;
      this.setOutpostOpen(true);
      return;
    }
    if (enteringBattle) this.onDeploy?.();
  }

  private setLoadoutOpen(open: boolean): void {
    if (this.loadoutOpen === open && this.loadoutPanel?.active === open) return;
    if (open) this.activateOnly('loadout');
    this.loadoutOpen = open;
    if (this.loadoutPanel) this.loadoutPanel.active = open;
    this.setCombatChromeVisible(!open && !this.homeOpen && !this.outpostOpen && !this.defeatOpen && !this.pauseOpen);
    this.updateLoadoutLabels();
  }

  private cycleLoadout(slot: NativeLoadoutSlot): void {
    this.selectedLoadoutSlot = slot;
    const availableSkins = loadEconomy().ownedSkins;
    const options = slot === 'skin'
      ? LOADOUT_OPTIONS.skin.filter((skin) => availableSkins.includes(skin))
      : LOADOUT_OPTIONS[slot] as readonly string[];
    // 玩家可能一个涂装都没有；空数组取模会得 NaN，进而写入 undefined 装配项并弹错误反馈。
    if (options.length === 0) return;
    const current = String(this.pendingLoadout[slot]);
    const next = options[(options.indexOf(current) + 1) % options.length];
    this.pendingLoadout = resolveLoadout({ ...this.pendingLoadout, [slot]: next });
    if (this.loadoutFeedbackLabel) {
      this.loadoutFeedbackLabel.string = this.text('loadout.changed', {
        slot: this.text(LOADOUT_SLOT_KEYS[slot]),
        item: this.describeSlot(slot),
      });
      this.loadoutFeedbackLabel.color = HUD_ACTIVE;
    }
    this.setButtonText(this.loadoutButton, this.text('loadout.open'));
    this.updateLoadoutLabels();
    this.layoutLoadoutPanel();
  }

  private updateLoadoutLabels(): void {
    for (const [slot, label] of this.loadoutLabels) {
      label.string = `${this.text(LOADOUT_SLOT_KEYS[slot])}\n${this.describeSlot(slot)}`;
    }
    if (this.loadoutSummaryLabel) this.loadoutSummaryLabel.string = this.loadoutSummary();
    if (this.loadoutDetailLabel) {
      this.loadoutDetailLabel.string = `${this.text(LOADOUT_SLOT_KEYS[this.selectedLoadoutSlot])}\n${this.describeSlot(this.selectedLoadoutSlot)}`;
    }
  }

  private layoutLoadoutPanel(): void {
    const loadoutButtonWidth = 104;
    const loadoutButtonHeight = 42;
    this.loadoutButton?.setPosition(this.canvasPosition(
      this.safeInsets.left + 12 + (loadoutButtonWidth / 2),
      this.safeInsets.top + 112,
      3,
    ));
    this.resizePanelButton(this.loadoutButton, loadoutButtonWidth, loadoutButtonHeight, 14);
    this.loadoutPanel?.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.loadoutHangarArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    if (this.loadoutBackdrop) {
      this.safeClear(this.loadoutBackdrop);
      this.loadoutBackdrop.fillColor = new Color(3, 10, 14, 138);
      this.safeRect(this.loadoutBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.safeFill(this.loadoutBackdrop);
      this.drawPanelFrame(this.loadoutBackdrop, -this.width / 2 + 14, -this.height / 2 + 14, this.width - 28, this.height - 28, HUD_CYAN, 'standard', false);
    }
    const usableWidth = Math.max(1, this.width - this.safeInsets.left - this.safeInsets.right - 24);
    const usableHeight = Math.max(1, this.height - this.safeInsets.top - this.safeInsets.bottom - 16);
    const contentCenterX = (this.safeInsets.left - this.safeInsets.right) / 2;
    const compact = usableHeight < 430 || usableWidth < 900;
    const ultraCompact = usableHeight < 400;
    // 竖屏/窄屏（手机）下原本会被压成 3–4 列 70px 宽的扁卡片。
    // 改为：极窄(<560)用 2 列、较窄(<900)用 3 列、宽屏用 4 列，卡片明显加宽。
    const columns = usableWidth < 560 ? 2 : (compact && usableWidth < 900 ? 3 : 4);
    const rows = Math.ceil(this.loadoutLabels.size / columns);
    const gapX = compact ? 8 : 12;
    const gapY = ultraCompact ? 5 : compact ? 7 : 10;
    const gridAreaWidth = usableWidth * (columns === 4 ? 0.48 : 0.6);
    const buttonWidth = Math.min(214, (gridAreaWidth - ((columns - 1) * gapX)) / columns);
    const actionHeight = ultraCompact ? 38 : compact ? 44 : 52;
    const actionY = (-this.height / 2) + this.safeInsets.bottom + (actionHeight / 2) + 5;
    const actionTop = actionY + (actionHeight / 2);
    const feedbackHeight = ultraCompact ? 18 : compact ? 22 : 28;
    const summaryHeight = ultraCompact ? 32 : compact ? 38 : 48;
    const feedbackY = actionTop + 4 + (feedbackHeight / 2);
    const summaryY = feedbackY + (feedbackHeight / 2) + 3 + (summaryHeight / 2);
    const gridBottom = summaryY + (summaryHeight / 2) + (compact ? 5 : 8);
    const gridTop = (this.height / 2) - this.safeInsets.top - (ultraCompact ? 38 : compact ? 50 : 62);
    const availableGridHeight = Math.max(rows * (ultraCompact ? 36 : 44), gridTop - gridBottom);
    const buttonHeight = Math.max(ultraCompact ? 36 : 44, Math.min(72, (availableGridHeight - ((rows - 1) * gapY)) / rows));
    const gridWidth = (columns * buttonWidth) + ((columns - 1) * gapX);
    const gridCenterX = (-this.width / 2) + this.safeInsets.left + 12 + (gridAreaWidth / 2);
    const detailWidth = Math.max(170, usableWidth - gridAreaWidth - 28);
    const detailCenterX = (this.width / 2) - this.safeInsets.right - 12 - (detailWidth / 2);
    if (this.loadoutSlotRail) {
      this.safeClear(this.loadoutSlotRail);
      this.loadoutSlotRail.fillColor = new Color(3, 10, 14, 220);
      this.safeRect(this.loadoutSlotRail, (-this.width / 2) + this.safeInsets.left, -this.height / 2, gridAreaWidth + 24, this.height);
      this.safeFill(this.loadoutSlotRail);
      this.loadoutSlotRail.strokeColor = new Color(59, 211, 255, 86);
      this.safeMoveTo(this.loadoutSlotRail, (-this.width / 2) + this.safeInsets.left + gridAreaWidth + 24, -this.height / 2 + 18);
      this.safeLineTo(this.loadoutSlotRail, (-this.width / 2) + this.safeInsets.left + gridAreaWidth + 24, this.height / 2 - 18);
      this.safeStroke(this.loadoutSlotRail);
    }
    if (this.loadoutSchematic) {
      const g = this.loadoutSchematic;
      const schematicY = gridTop - (ultraCompact ? 92 : compact ? 126 : 166);
      const shipWidth = Math.min(detailWidth * 0.62, ultraCompact ? 112 : compact ? 150 : 210);
      const shipHeight = shipWidth * 0.34;
      this.safeClear(g);
      g.strokeColor = new Color(59, 211, 255, 148);
      g.lineWidth = 1.5;
      this.safeMoveTo(g, detailCenterX, schematicY + shipHeight / 2);
      this.safeLineTo(g, detailCenterX + shipWidth * 0.18, schematicY + shipHeight * 0.12);
      this.safeLineTo(g, detailCenterX + shipWidth / 2, schematicY - shipHeight * 0.22);
      this.safeLineTo(g, detailCenterX + shipWidth * 0.15, schematicY - shipHeight * 0.05);
      this.safeLineTo(g, detailCenterX, schematicY - shipHeight / 2);
      this.safeLineTo(g, detailCenterX - shipWidth * 0.15, schematicY - shipHeight * 0.05);
      this.safeLineTo(g, detailCenterX - shipWidth / 2, schematicY - shipHeight * 0.22);
      this.safeLineTo(g, detailCenterX - shipWidth * 0.18, schematicY + shipHeight * 0.12);
      this.safeClose(g);
      this.safeStroke(g);
      g.strokeColor = new Color(226, 245, 255, 58);
      this.safeCircle(g, detailCenterX, schematicY, Math.max(8, shipHeight * 0.22));
      this.safeMoveTo(g, detailCenterX - shipWidth * 0.62, schematicY);
      this.safeLineTo(g, detailCenterX - shipWidth * 0.34, schematicY);
      this.safeMoveTo(g, detailCenterX + shipWidth * 0.34, schematicY);
      this.safeLineTo(g, detailCenterX + shipWidth * 0.62, schematicY);
      this.safeStroke(g);
      for (let index = 0; index < 4; index += 1) {
        g.fillColor = index < 3 ? new Color(59, 211, 255, 126) : new Color(255, 172, 47, 182);
        this.safeRect(g, detailCenterX - shipWidth / 2 + index * (shipWidth / 4), schematicY - shipHeight * 0.78, shipWidth / 4 - 4, 3);
        this.safeFill(g);
      }
    }
    const title = this.loadoutPanel?.getChildByName('NativeLoadoutTitle');
    title?.setPosition(
      contentCenterX,
      (this.height / 2) - this.safeInsets.top - (ultraCompact ? 18 : compact ? 24 : 32),
      3,
    );
    title?.getComponent(UITransform)?.setContentSize(usableWidth, ultraCompact ? 26 : compact ? 32 : 42);
    const titleLabel = title?.getComponent(Label);
    if (titleLabel) {
      titleLabel.fontSize = ultraCompact ? 16 : compact ? 18 : 24;
      titleLabel.lineHeight = ultraCompact ? 19 : compact ? 22 : 28;
    }
    const slots = Object.keys(LOADOUT_OPTIONS) as NativeLoadoutSlot[];
    slots.forEach((slot, index) => {
      const label = this.loadoutLabels.get(slot);
      const button = label?.node.parent;
      if (!button) return;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = gridCenterX - (gridWidth / 2) + (buttonWidth / 2) + (column * (buttonWidth + gapX));
      const y = gridTop - (buttonHeight / 2) - (row * (buttonHeight + gapY));
      button.setPosition(x, y, 3);
      button.setScale(Vec3.ONE);
      this.resizePanelButton(
        button,
        buttonWidth,
        buttonHeight,
        ultraCompact ? 10 : compact ? 12 : 14,
        slot === this.selectedLoadoutSlot ? HUD_ACTIVE : HUD_CYAN,
      );
    });
    this.loadoutSummaryLabel?.node.setPosition(detailCenterX, summaryY + (ultraCompact ? 10 : compact ? 16 : 28), 3);
    this.loadoutSummaryLabel?.getComponent(UITransform)?.setContentSize(detailWidth - 12, ultraCompact ? 50 : compact ? 62 : 82);
    if (this.loadoutSummaryLabel) {
      this.loadoutSummaryLabel.fontSize = ultraCompact ? 9 : compact ? 11 : 14;
      this.loadoutSummaryLabel.lineHeight = ultraCompact ? 13 : compact ? 16 : 20;
    }
    this.loadoutDetailLabel?.node.setPosition(detailCenterX, gridTop - (ultraCompact ? 48 : compact ? 65 : 94), 3);
    this.loadoutDetailLabel?.getComponent(UITransform)?.setContentSize(detailWidth - 12, ultraCompact ? 64 : compact ? 86 : 126);
    this.loadoutFeedbackLabel?.node.setPosition(detailCenterX, feedbackY, 3);
    this.loadoutFeedbackLabel?.getComponent(UITransform)?.setContentSize(detailWidth - 12, feedbackHeight);
    // 窄屏下用暗底面板框把「选中详情 / 战力概要」两处浮动文字包起来，
    // 避免像脱离锚点的裸文字（截图里主炮详情飘在舰体上方）。
    if (compact || ultraCompact) {
      const pad = 10;
      const detailH = (ultraCompact ? 64 : 86) + pad * 2;
      const detailW = (detailWidth - 12) + pad * 2;
      const detailY = gridTop - (ultraCompact ? 48 : compact ? 65 : 94);
      const summaryH = (ultraCompact ? 50 : 62) + pad * 2;
      const summaryW = (detailWidth - 12) + pad * 2;
      const summaryBoxY = summaryY + (ultraCompact ? 10 : compact ? 16 : 28);
      if (this.loadoutSlotRail) {
        const g = this.loadoutSlotRail;
        g.fillColor = new Color(3, 12, 16, 232);
        this.safeRect(g, detailCenterX - detailW / 2, detailY - detailH / 2, detailW, detailH);
        this.safeRect(g, detailCenterX - summaryW / 2, summaryBoxY - summaryH / 2, summaryW, summaryH);
        this.safeFill(g);
        this.drawPanelFrame(g, detailCenterX - detailW / 2, detailY - detailH / 2, detailW, detailH, HUD_CYAN, 'standard', false);
        this.drawPanelFrame(g, detailCenterX - summaryW / 2, summaryBoxY - summaryH / 2, summaryW, summaryH, HUD_CYAN, 'standard', false);
      }
    }
    const actionWidth = Math.min(190, (detailWidth - 10) / 2);
    this.applyLoadoutButton?.setPosition(detailCenterX + (actionWidth / 2) + 5, actionY, 3);
    this.applyLoadoutButton?.setScale(Vec3.ONE);
    this.resizePanelButton(this.applyLoadoutButton, actionWidth, actionHeight, ultraCompact ? 11 : compact ? 13 : 15);
    const closeButton = this.closeLoadoutButton;
    closeButton?.setPosition(detailCenterX - (actionWidth / 2) - 5, actionY, 3);
    closeButton?.setScale(Vec3.ONE);
    this.resizePanelButton(closeButton, actionWidth, actionHeight, ultraCompact ? 11 : compact ? 13 : 15);
  }

  private loadoutMetrics(loadout: ResolvedCombatLoadout): LoadoutMetrics {
    const primary = PRIMARY_WEAPONS[loadout.weapon];
    const secondary = SECONDARY_WEAPONS[loadout.secondary];
    const core = FRAME_CORES[loadout.core];
    const engine = ENGINE_MODULES[loadout.engine];
    const shield = SHIELD_MODULES[loadout.shield];
    const utility = UTILITY_MODULES[loadout.utility];
    const boost = BOOST_MODULES[loadout.boost];
    const device = TACTICAL_DEVICES[loadout.device];
    const ship = resolvePlayerShip(loadout.ship);
    const damageMultiplier = (core.damageMultiplier || 1)
      * utility.damageMultiplier
      * (device.damageMultiplier || 1)
      * ship.damageMultiplier;
    return {
      primaryDamage: primary.damage * damageMultiplier,
      primaryRate: (1 / primary.cooldown) * ship.fireRateMultiplier,
      secondaryDamage: secondary.damage * damageMultiplier,
      health: Math.round(core.maxHealth * ship.healthMultiplier),
      shield: core.maxShield * shield.capacityMultiplier * ship.shieldMultiplier,
      speedMultiplier: core.speedMultiplier * engine.speedMultiplier * ship.speedMultiplier,
      energyMultiplier: (core.energyCapacityMultiplier || 1)
        * boost.energyCapacityMultiplier
        * ship.energyMultiplier,
      shieldRegen: shield.rechargePerSecond * (device.shieldRegenMultiplier || 1),
    };
  }

  private loadoutSummary(): string {
    const metrics = this.loadoutMetrics(this.pendingLoadout);
    const applied = this.loadoutMetrics(this.appliedLoadout);
    const delta = (value: number, baseline: number): string => {
      const change = value - baseline;
      if (Math.abs(change) < 0.01) return '';
      return change > 0 ? ` ▲${this.number(change)}` : ` ▼${this.number(Math.abs(change))}`;
    };
    return [
      this.text('summary.primary', {
        damage: this.text('metric.damage', { value: this.number(metrics.primaryDamage) }),
        rate: this.text('metric.shots', { value: metrics.primaryRate.toFixed(1) }),
        secondary: this.text('metric.damage', { value: this.number(metrics.secondaryDamage) }),
      }),
      this.text('summary.defense', {
        health: `${this.number(metrics.health)}${delta(metrics.health, applied.health)}`,
        shield: `${this.number(metrics.shield)}${delta(metrics.shield, applied.shield)}`,
        speed: metrics.speedMultiplier.toFixed(2),
        energy: metrics.energyMultiplier.toFixed(2),
        regen: this.number(metrics.shieldRegen),
      }),
    ].join('\n');
  }

  private describeSlot(slot: NativeLoadoutSlot): string {
    const id = String(this.pendingLoadout[slot]);
    const name = this.loadoutName(id);
    switch (slot) {
      case 'ship': {
        const ship = resolvePlayerShip(this.pendingLoadout.ship);
        return `${name} · ${ship.code}`;
      }
      case 'weapon': {
        const weapon = PRIMARY_WEAPONS[this.pendingLoadout.weapon];
        const behavior = PRIMARY_WEAPON_BEHAVIORS[this.pendingLoadout.weapon];
        const stats = `${this.text('metric.damage', { value: weapon.damage })} / ${this.text('metric.shots', { value: (1 / weapon.cooldown).toFixed(1) })}`;
        // 先讲打法再讲数值：玩家换枪时首先该看到「这把怎么打」。
        return `${name} · ${this.text(behavior.labelKey as CombatMessageKey)} · ${stats}`;
      }
      case 'secondary': {
        const weapon = SECONDARY_WEAPONS[this.pendingLoadout.secondary];
        const behavior = SECONDARY_WEAPON_BEHAVIORS[this.pendingLoadout.secondary];
        return `${name} · ${this.text(behavior.labelKey as CombatMessageKey)} · ${this.text('metric.damage', { value: weapon.damage })}`;
      }
      case 'device': {
        const device = TACTICAL_DEVICES[this.pendingLoadout.device];
        if (device.damageMultiplier) return `${name} · ${this.text('metric.damageBoost', { value: Math.round((device.damageMultiplier - 1) * 100) })}`;
        if (device.healthRegen) return `${name} · ${this.text('metric.repair', { value: device.healthRegen })}`;
        if (device.energyRechargeMultiplier) return `${name} · ${this.text('metric.charge', { value: Math.round((device.energyRechargeMultiplier - 1) * 100) })}`;
        if (device.pickupRadius) return `${name} · ${this.text('metric.range', { value: device.pickupRadius })}`;
        return `${name} · ${this.text('metric.shieldBoost', { value: Math.round(((device.shieldRegenMultiplier || 1) - 1) * 100) })}`;
      }
      case 'core': {
        const core = FRAME_CORES[this.pendingLoadout.core];
        return `${name} · ${this.text('metric.healthShield', { health: core.maxHealth, shield: core.maxShield })}`;
      }
      case 'engine': {
        const engine = ENGINE_MODULES[this.pendingLoadout.engine];
        return `${name} · ${this.text('metric.speed', { value: engine.speedMultiplier.toFixed(2) })}`;
      }
      case 'shield': {
        const shield = SHIELD_MODULES[this.pendingLoadout.shield];
        return `${name} · ${this.text('metric.capacity', { value: shield.capacityMultiplier.toFixed(2) })}`;
      }
      case 'utility': {
        const utility = UTILITY_MODULES[this.pendingLoadout.utility];
        if (utility.damageMultiplier > 1) return `${name} · ${this.text('metric.damageBoost', { value: Math.round((utility.damageMultiplier - 1) * 100) })}`;
        if (utility.pickupRadius > 0) return `${name} · ${this.text('metric.recovery', { value: utility.pickupRadius })}`;
        return `${name} · ${this.text('metric.repair', { value: utility.healthRegen })}`;
      }
      case 'boost': {
        const boost = BOOST_MODULES[this.pendingLoadout.boost];
        return `${name} · ${this.text('metric.thrust', { value: boost.boostMultiplier.toFixed(2) })}`;
      }
      default:
        return name;
    }
  }

  private number(value: number): string {
    return Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1);
  }

  private createPanelButton(
    name: string,
    text: string,
    action: () => void,
    parent = this.root,
    kind: PanelButtonKind = 'standard',
  ): Node {
    const node = this.createNode(name, parent);
    node.getComponent(UITransform)?.setContentSize(214, 82);
    const graphics = attachGraphics(node);
    this.buttonKinds.set(node, kind);
    this.drawPanelSurface(graphics, 214, 82, kind === 'primary' ? HUD_ACTIVE : HUD_CYAN, kind, false);
    const label = this.createLabel('Label', 14, HUD_WHITE, node);
    label.string = text;
    label.getComponent(UITransform)?.setContentSize(196, 66);
    if (kind === 'slot' || kind === 'nav') label.horizontalAlign = HorizontalTextAlignment.LEFT;
    const setPressed = (pressed: boolean): void => {
      const size = node.getComponent(UITransform)?.contentSize;
      this.drawPanelSurface(graphics, size?.width || 214, size?.height || 82, kind === 'primary' ? HUD_ACTIVE : HUD_CYAN, kind, pressed);
      node.setScale(pressed ? new Vec3(0.975, 0.975, 1) : Vec3.ONE);
    };
    // 同一次物理点击会先后派发 TOUCH_END 与 MOUSE_UP：用时间戳去重，
    // 否则一次点击执行两次 action（双倍购买 / 两次部署）。
    let lastActionAt = 0;
    const fireAction = (): void => {
      const now = Date.now();
      if (now - lastActionAt < 120) return;
      lastActionAt = now;
      setPressed(false);
      this.onUiFeedback?.();
      action();
    };
    node.on(Node.EventType.TOUCH_START, () => setPressed(true));
    node.on(Node.EventType.TOUCH_CANCEL, () => setPressed(false));
    node.on(Node.EventType.TOUCH_END, fireAction);
    node.on(Node.EventType.MOUSE_DOWN, () => setPressed(true));
    node.on(Node.EventType.MOUSE_LEAVE, () => setPressed(false));
    node.on(Node.EventType.MOUSE_UP, fireAction);
    return node;
  }

  private resizePanelButton(
    node: Node | null,
    width: number,
    height: number,
    fontSize: number,
    accent: Color = HUD_CYAN,
  ): void {
    if (!node) return;
    node.getComponent(UITransform)?.setContentSize(width, height);
    const graphics = graphicsOf(node);
    if (graphics) {
      this.drawPanelSurface(graphics, width, height, accent, this.buttonKinds.get(node) || 'standard', false);
    }
    const label = node.getChildByName('Label')?.getComponent(Label);
    if (!label) return;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    const kind = this.buttonKinds.get(node) || 'standard';
    // 2026-11-19：站内 slot 卡片原为 LEFT 对齐（真机截图文字全贴左上角、字号又小，很廉价）。
    // 改为水平+垂直居中，四周留内边距，多行信息（名称/状态/数值）整齐落在卡片中央。
    // nav（底部动作标签）仍保留 LEFT，避免破坏既有按键布局。
    label.horizontalAlign = kind === 'nav'
      ? HorizontalTextAlignment.LEFT
      : HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    // 2026-11-17：长文案（如 ESCORT · CLEAR AND PROTECT）在横屏窄卡片里会溢出到
    // 屏幕外被裁。SHRINK 让超长文字自动缩字号适配 contentSize，正常文字不受影响。
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = kind !== 'nav';
    const padX = kind === 'nav' ? 14 : 16;
    const padY = kind === 'nav' ? 8 : 12;
    label.getComponent(UITransform)?.setContentSize(width - padX * 2, height - padY * 2);
  }

  /**
   * 战术面板框架：在既有遮罩之上叠加切角内框、四角锁定角标与顶部刻度尺。
   * 纯装饰，不改变任何布局或命中区域；所有覆盖面板共用同一套视觉语言。
   */
  private drawPanelFrame(
    graphics: Graphics,
    left: number,
    bottom: number,
    width: number,
    height: number,
    accent: Color,
    variant: 'standard' | 'danger' = 'standard',
    showTicks = true,
  ): void {
    const right = left + width;
    const top = bottom + height;
    const frame = variant === 'danger' ? HUD_RED : accent;
    const guide = new Color(frame.r, frame.g, frame.b, 84);
    const strong = new Color(frame.r, frame.g, frame.b, 226);
    const bracket = Math.min(20, width * 0.08, height * 0.16);

    // 切角内框细线
    graphics.strokeColor = guide;
    graphics.lineWidth = 1;
    this.safeMoveTo(graphics, left + 12, bottom + 3);
    this.safeLineTo(graphics, right - 3, bottom + 3);
    this.safeLineTo(graphics, right - 3, top - 12);
    this.safeMoveTo(graphics, left + 3, bottom + 12);
    this.safeLineTo(graphics, left + 3, top - 3);
    this.safeLineTo(graphics, right - 12, top - 3);
    this.safeStroke(graphics);

    // 四角 L 形锁定角标
    graphics.strokeColor = strong;
    graphics.lineWidth = 2;
    this.safeMoveTo(graphics, left + bracket, top);
    this.safeLineTo(graphics, left, top);
    this.safeLineTo(graphics, left, top - bracket);
    this.safeMoveTo(graphics, right - bracket, top);
    this.safeLineTo(graphics, right, top);
    this.safeLineTo(graphics, right, top - bracket);
    this.safeMoveTo(graphics, left + bracket, bottom);
    this.safeLineTo(graphics, left, bottom);
    this.safeLineTo(graphics, left, bottom + bracket);
    this.safeMoveTo(graphics, right - bracket, bottom);
    this.safeLineTo(graphics, right, bottom);
    this.safeLineTo(graphics, right, bottom + bracket);
    this.safeStroke(graphics);

    // 顶部刻度尺：等距细刻度，每 4 格加长
    if (showTicks) {
      const ticks = Math.max(8, Math.min(24, Math.floor(width / 24)));
      const gap = (width - 40) / (ticks - 1);
      graphics.strokeColor = new Color(frame.r, frame.g, frame.b, 116);
      graphics.lineWidth = 1;
      for (let index = 0; index < ticks; index += 1) {
        const x = left + 20 + index * gap;
        this.safeMoveTo(graphics, x, top - 4);
        this.safeLineTo(graphics, x, top - (index % 4 === 0 ? 12 : 7));
      }
      this.safeStroke(graphics);
    }

    // 右上状态点 + 左下琥珀编号条
    graphics.fillColor = new Color(HUD_ACTIVE.r, HUD_ACTIVE.g, HUD_ACTIVE.b, 210);
    this.safeCircle(graphics, right - 16, top - 16, 2.5);
    this.safeFill(graphics);
    graphics.fillColor = new Color(HUD_ACTIVE.r, HUD_ACTIVE.g, HUD_ACTIVE.b, 176);
    this.safeRect(graphics, left + 12, bottom + 9, Math.max(20, width * 0.05), 3);
    this.safeFill(graphics);
  }

  private drawPanelSurface(
    graphics: Graphics,
    width: number,
    height: number,
    accent: Color,
    kind: PanelButtonKind,
    pressed: boolean,
  ): void {
    const cut = Math.min(kind === 'nav' ? 7 : 12, height * 0.22);
    const left = -width / 2;
    const right = width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    const primary = kind === 'primary';
    const danger = kind === 'danger';
    const line = danger ? HUD_RED : accent;
    this.safeClear(graphics);
    this.safeMoveTo(graphics, left + cut, bottom);
    this.safeLineTo(graphics, right, bottom);
    this.safeLineTo(graphics, right, top - cut);
    this.safeLineTo(graphics, right - cut, top);
    this.safeLineTo(graphics, left, top);
    this.safeLineTo(graphics, left, bottom + cut);
    this.safeClose(graphics);
    graphics.fillColor = primary
      ? new Color(line.r, line.g, line.b, pressed ? 214 : 174)
      : new Color(5, 16, 21, pressed ? 246 : kind === 'slot' ? 238 : 220);
    this.safeFill(graphics);
    graphics.strokeColor = new Color(line.r, line.g, line.b, pressed ? 255 : primary ? 226 : 174);
    graphics.lineWidth = primary ? 2 : 1.25;
    this.safeStroke(graphics);
    graphics.fillColor = new Color(line.r, line.g, line.b, pressed ? 255 : 196);
    this.safeRect(graphics, left + 4, bottom + 4, primary ? Math.max(20, width * 0.22) : 3, 3);
    this.safeFill(graphics);
    if (kind === 'slot') {
      graphics.strokeColor = new Color(226, 245, 255, 60);
      graphics.lineWidth = 1;
      this.safeMoveTo(graphics, left + 10, bottom + 9);
      this.safeLineTo(graphics, left + 10, top - 9);
      this.safeStroke(graphics);
      graphics.fillColor = new Color(line.r, line.g, line.b, 190);
      this.safeRect(graphics, left + 4, top - 12, 3, 8);
      this.safeFill(graphics);
    }

    // 战术按钮细节：切角内框、顶边等距刻度、右上状态点、主按钮斜纹
    const inset = 4;
    graphics.strokeColor = new Color(line.r, line.g, line.b, primary ? 72 : 44);
    graphics.lineWidth = 1;
    this.safeMoveTo(graphics, left + cut * 0.7 + inset, bottom + inset);
    this.safeLineTo(graphics, right - inset, bottom + inset);
    this.safeLineTo(graphics, right - inset, top - cut * 0.7 - inset);
    this.safeMoveTo(graphics, left + inset, bottom + cut * 0.7 + inset);
    this.safeLineTo(graphics, left + inset, top - inset);
    this.safeLineTo(graphics, right - cut * 0.7 - inset, top - inset);
    this.safeStroke(graphics);

    const ticks = Math.max(4, Math.min(9, Math.floor(width / 34)));
    graphics.strokeColor = new Color(line.r, line.g, line.b, primary ? 150 : 96);
    graphics.lineWidth = 1;
    for (let index = 0; index < ticks; index += 1) {
      const x = left + 12 + index * ((width - 24) / (ticks - 1));
      this.safeMoveTo(graphics, x, top - 3);
      this.safeLineTo(graphics, x, top - (index % 4 === 0 ? 8 : 5));
    }
    this.safeStroke(graphics);

    graphics.fillColor = new Color(line.r, line.g, line.b, pressed ? 255 : 190);
    this.safeCircle(graphics, right - 9, top - 9, 2);
    this.safeFill(graphics);

    if (primary) {
      graphics.strokeColor = new Color(28, 19, 6, 92);
      graphics.lineWidth = 1;
      for (let index = 0; index < 5; index += 1) {
        const x = right - 34 + index * 7;
        this.safeMoveTo(graphics, x, bottom + 6);
        this.safeLineTo(graphics, x + 8, top - 6);
      }
      this.safeStroke(graphics);
    }
  }

  private setButtonText(node: Node | null, text: string): void {
    const label = node?.getChildByName('Label')?.getComponent(Label);
    if (label) label.string = text;
  }

  private createTouchControls(): void {
    if (!this.touchEnabled) return;
    const layout = this.touchLayout();
    const stick = this.createNode('FixedMoveStick');
    const base = attachGraphics(stick);
    this.drawStickDeadzone(base, layout.movement.radius);
    this.actionVisuals.set('movement', { node: stick, graphics: base, glyph: null, radius: layout.movement.radius });

    const directionNode = this.createNode('FixedMoveStickDirection', stick);
    this.stickDirection = attachGraphics(directionNode);

    this.stickThumb = this.createNode('FixedMoveStickThumb');
    const thumb = attachGraphics(this.stickThumb);
    this.drawDisc(thumb, layout.movement.radius * 0.34, HUD_WHITE);

    const labels: Readonly<Record<string, CombatMessageKey>> = {
      primaryFire: 'touch.fire',
      secondaryFire: 'touch.alt',
      boost: 'touch.boost',
      cameraToggle: 'touch.view',
      pause: 'touch.pause',
      swapWeapons: 'touch.swap',
      deviceAbility: 'touch.ability',
      returnRequested: 'touch.return',
    };
    for (const control of layout.actions) {
      const node = this.createNode(this.actionNodeName(control.role));
      const graphics = attachGraphics(node);
      this.drawActionControl(graphics, control.role, control.radius, false);
      // 图标单独一层并偏上：下半区留给文字，避免图标与文字叠在一起看不清。
      const glyphNode = this.createNode(`${this.actionNodeName(control.role)}Glyph`, node);
      const glyph = attachGraphics(glyphNode);
      glyphNode.setPosition(0, control.radius * 0.3);
      this.drawActionGlyph(glyph, control.role, control.radius, false);
      const label = this.createLabel(`${this.actionNodeName(control.role)}Label`, 15, HUD_WHITE, node);
      label.string = this.text(labels[control.role]);
      label.getComponent(UITransform)?.setContentSize(control.radius * 2 - 6, 22);
      label.node.setPosition(0, -control.radius * 0.56);
      this.styleTouchActionLabel(label);
      this.actionVisuals.set(control.role, { node, graphics, glyph, radius: control.radius });
    }
  }

  /**
   * 触屏动作钮标签：放大字号（16）+ 深色描边，解决小圆钮内白字在复杂太空背景上
   * 对比度低、易被 OCR / 肉眼误读的问题（截图反馈"切换"被误读为"块换"即此因）。
   */
  private styleTouchActionLabel(label: Label): void {
    label.outlineColor = new Color(0, 0, 0, 230);
    label.outlineWidth = 3;
    label.enableOutline = true;
  }

  private ensureReturnAction(): void {
    let visual = this.actionVisuals.get('returnRequested');
    if (!visual) {
      const control = returnControlCircle(this.width, this.height, this.safeInsets, this.controlScale);
      const node = this.createNode('ReturnAction');
      const graphics = attachGraphics(node);
      this.drawActionControl(graphics, 'returnRequested', control.radius, false);
      const glyphNode = this.createNode('ReturnActionGlyph', node);
      const glyph = attachGraphics(glyphNode);
      glyphNode.setPosition(0, control.radius * 0.3);
      this.drawActionGlyph(glyph, 'returnRequested', control.radius, false);
      const label = this.createLabel('ReturnActionLabel', 15, HUD_WHITE, node);
      label.string = this.text(this.canDock ? 'touch.dock' : 'touch.return');
      label.getComponent(UITransform)?.setContentSize(control.radius * 2 - 6, 22);
      label.node.setPosition(0, -control.radius * 0.56);
      this.styleTouchActionLabel(label);
      visual = { node, graphics, glyph, radius: control.radius };
      this.actionVisuals.set('returnRequested', visual);
    }
    const available = this.canReturn || this.canDock;
    visual.node.active = this.combatChromeVisible && available;
    if (!available) return;
    const label = visual.node.getChildByName('ReturnActionLabel')?.getComponent(Label);
    if (label) label.string = this.text(this.canDock ? 'touch.dock' : 'touch.return');
    const control = returnControlCircle(this.width, this.height, this.safeInsets, this.controlScale);
    visual.radius = control.radius;
    visual.node.setPosition(this.canvasPosition(control.x, control.y, 1));
    this.drawActionControl(visual.graphics, 'returnRequested', visual.radius, false);
  }

  private drawReturnProgress(progress: number): void {
    const visual = this.actionVisuals.get('returnRequested');
    if (!visual || (!this.canReturn && !this.canDock)) return;
    this.drawActionControl(visual.graphics, 'returnRequested', visual.radius, progress > 0);
    // 极小/非法的进度会画出零跨度圆弧；直接省略进度环，按钮本身仍完整。
    if (!Number.isFinite(progress) || progress <= 0.02) return;
    visual.graphics.strokeColor = HUD_WHITE;
    visual.graphics.lineWidth = 4;
    this.safeArc(visual.graphics, 0, 0, visual.radius - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
    this.safeStroke(visual.graphics);
  }

  /** 顶部中央连击读数：连击数 + 当前得分倍率，按倍率档位变色 */
  private updateComboReadout(combo: CombatSnapshot['combo']): void {
    if (!this.comboLabel) return;
    if (combo && combo.count >= 2) {
      this.comboLabel.node.active = true;
      this.comboLabel.string = this.text('combo.readout', { count: combo.count, multiplier: combo.multiplier.toFixed(1) });
      this.comboLabel.color = combo.multiplier >= 2.6
        ? HUD_RED
        : combo.multiplier >= 1.5
          ? new Color(255, 224, 140, 255)
          : HUD_ACTIVE;
    } else {
      this.comboLabel.node.active = false;
    }
  }

  /** 底部中央局内强化条：显示当前生效的强化模块与剩余秒数 */
  private updateUpgradeReadout(upgrades: CombatSnapshot['upgrades']): void {
    if (!this.upgradeLabel) return;
    const active = (upgrades || []).filter((entry) => entry.remaining > 0);
    if (active.length) {
      this.upgradeLabel.node.active = true;
      this.upgradeLabel.string = active
        .map((entry) => `${entry.name} ${Math.ceil(entry.remaining)}s`)
        .join('    ');
    } else {
      this.upgradeLabel.node.active = false;
    }
  }

  /**
   * 战术设备主动技能读数：技能名 + 生效中 / 就绪 / 冷却 + 剩余秒数。
   * 与 Web 两端 `AbilityState` 同一套语义，原生端也能判断该什么时候按键。
   */
  private updateAbilityReadout(snapshot: CombatSnapshot): void {
    if (!this.abilityLabel) return;
    const ability = snapshot.deviceAbility;
    if (!ability) return;
    const name = this.text(ability.labelKey as CombatMessageKey);
    const phaseKey: CombatMessageKey = ability.active
      ? 'ability.active'
      : ability.ready ? 'ability.ready' : 'ability.cooldown';
    const seconds = ability.active ? ability.remaining : ability.cooldownRemaining;
    const phase = this.text(phaseKey);
    this.abilityLabel.string = seconds > 0.05
      ? `${name}  ${phase} ${seconds.toFixed(1)}s`
      : `${name}  ${phase}`;
    this.abilityLabel.color = ability.active
      ? HUD_ACTIVE
      : ability.ready ? HUD_GREEN : HUD_WHITE;
  }

  /**
   * 左下角武器读数：显示当前「主开火键 / 副开火键」各自打的是什么武器，
   * 并在战斗中一键互换后用 ⇄ 高亮提示。名字走本地化 item.* 键。
   */
  private updateWeaponReadout(snapshot: CombatSnapshot): void {
    if (!this.weaponLabel) return;
    const primaryId = snapshot.weaponsSwapped ? snapshot.loadout.secondary : snapshot.loadout.weapon;
    const secondaryId = snapshot.weaponsSwapped ? snapshot.loadout.weapon : snapshot.loadout.secondary;
    const primaryName = this.text(`item.${primaryId}` as CombatMessageKey);
    const secondaryName = this.text(`item.${secondaryId}` as CombatMessageKey);
    const signature = `${primaryId}|${secondaryId}|${snapshot.weaponsSwapped}`;
    if (signature === this.lastWeaponSignature) return;
    this.lastWeaponSignature = signature;
    this.weaponLabel.string = this.text(
      snapshot.weaponsSwapped ? 'weapon.readoutSwapped' : 'weapon.readout',
      { primary: primaryName, secondary: secondaryName },
    );
    this.weaponLabel.color = snapshot.weaponsSwapped ? HUD_ACTIVE : HUD_WHITE;
  }

  private layoutTouchControls(): void {
    const layout = this.touchLayout();
    const center = { x: layout.movement.x, y: layout.movement.y };
    const stick = this.actionVisuals.get('movement');
    if (stick) {
      stick.radius = layout.movement.radius;
      this.drawStickDeadzone(stick.graphics, stick.radius);
    }
    stick?.node.setPosition(this.canvasPosition(center.x, center.y, 1));
    this.stickThumb?.setPosition(this.canvasPosition(center.x, center.y, 2));
    const thumb = graphicsOf(this.stickThumb);
    if (thumb) this.drawDisc(thumb, layout.movement.radius * 0.34, HUD_WHITE);
    for (const control of layout.actions) {
      const visual = this.actionVisuals.get(control.role);
      if (!visual) continue;
      visual.radius = control.radius;
      this.drawActionControl(visual.graphics, control.role, visual.radius, false);
      if (visual.glyph) {
        this.drawActionGlyph(visual.glyph, control.role, visual.radius, false);
        visual.node.getChildByName(`${this.actionNodeName(control.role)}Glyph`)
          ?.setPosition(0, control.radius * 0.3);
      }
      visual.node.setPosition(this.canvasPosition(control.x, control.y, 1));
      const label = visual.node.getChildByName(`${this.actionNodeName(control.role)}Label`)?.getComponent(Label);
      label?.getComponent(UITransform)?.setContentSize(control.radius * 2 - 6, 22);
      label?.node.setPosition(0, -control.radius * 0.56);
    }
  }

  private createNode(name: string, parent = this.root): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.addComponent(UITransform);
    return node;
  }

  private createLabel(
    name: string,
    fontSize: number,
    color: Color,
    parent = this.root,
  ): Label {
    const node = this.createNode(name, parent);
    const label = node.addComponent(Label);
    // 默认置空，避免未赋值的 Label 节点渲染出 Cocos 默认的 "Label" 占位文字
    // （此前战斗/菜单里偶发漂浮的裸 "label" 即来源于此）。
    label.string = '';
    // 所有 HUD 文字统一加深色描边：太空背景亮度不可控（星云、橙色碎片、白色舰体都可能
    // 压在文字后面），单靠字色无法保证可读性。描边是不依赖背景亮度的兜底。
    label.outlineColor = new Color(2, 8, 12, 225);
    label.outlineWidth = 3;
    label.enableOutline = true;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    return label;
  }

  /**
   * 联机房间码输入框。Cocos 的 EditBox 必须持有 textLabel / placeholderLabel 子节点才会在
   * 原生端（Android / HarmonyOS）正常捕获并显示输入——裸 addComponent(EditBox) 等于没输入框，
   * 玩家点不开键盘、联机永远卡在输房间码这步。这里搭好层级 + Graphics 背景，背景尺寸在
   * layoutHomePanel 里按实际宽度补画。
   */
  private createCoopJoinInput(parent: Node): EditBox | null {
    const node = this.createNode('NativeCoopJoinInput', parent);
    // 🔴 关键时序：Cocos 的 EditBox 在 onEnable 时若 textLabel / placeholderLabel 还没挂好，
    // 会自建 TEXT_LABEL / PLACEHOLDER_LABEL 子节点并挂上默认 Label——而 Cocos Label 的默认
    // 文本就是小写 'label'（label.ts: `protected _string = 'label'`）。
    // 这会在主页上留下一个永远漂浮的裸 "label"。先把节点置 inactive，等两个 Label 挂好
    // 再激活，引擎就不会自建孤儿节点。
    node.active = false;
    attachGraphics(node); // 背景在 layout 阶段按 coopWidth 绘制
    const textLabel = this.createLabel('TextLabel', 16, HUD_WHITE, node);
    const placeholderLabel = this.createLabel('PlaceholderLabel', 16, new Color(150, 150, 150, 255), node);
    const editBox = node.addComponent(EditBox);
    editBox.textLabel = textLabel;
    editBox.placeholderLabel = placeholderLabel;
    editBox.placeholder = this.text('coop.placeholder');
    editBox.maxLength = 8;
    editBox.fontSize = 16;
    // 防御性清理：万一某些引擎版本仍然自建了同名节点（行为差异），一并移除，
    // 免得再冒出漂浮的裸 "label"。
    for (const orphan of ['TEXT_LABEL', 'PLACEHOLDER_LABEL']) {
      const stray = node.getChildByName(orphan);
      if (stray) stray.destroy();
    }
    node.active = true;
    return editBox;
  }

  /** 摇杆拇指：亮盘 + 暗描边，任何背景下都能看清手指落在哪。 */
  private drawDisc(graphics: Graphics, radius: number, accent: Color): void {
    this.safeClear(graphics);
    graphics.fillColor = new Color(226, 245, 255, 235);
    this.safeCircle(graphics, 0, 0, radius);
    this.safeFill(graphics);
    graphics.strokeColor = new Color(4, 18, 26, 225);
    graphics.lineWidth = 2;
    this.safeCircle(graphics, 0, 0, radius - 1);
    this.safeStroke(graphics);
    graphics.strokeColor = accent;
    graphics.lineWidth = 1;
    this.safeCircle(graphics, 0, 0, Math.max(1, radius - 5));
    this.safeStroke(graphics);
  }

  /**
   * 动作控件底板：圆角方框战术片（暗底 + 亮边 + 按下内环）。
   *
   * 形状语言与主页 / 面板统一（都是圆角矩形），只有摇杆保持圆形（语义要求）。
   * 底板 + 亮边是玩家判断「这里能点」的唯一依据——此前真机整片不可见，
   * 结果就是「没有边框、不知道按哪」。圆角方框还比实心圆省一半以上精灵
   * （实心圆要走上百条扫描线，真机上既拖帧又容易糊成一片）。
   */
  private drawActionControl(
    graphics: Graphics,
    role: BrowserPointerRole,
    radius: number,
    active: boolean,
  ): void {
    const primary = role === 'primaryFire';
    // 低饱和描边色：青/橙只做点缀，绝不铺满按钮。深色玻璃底 + 细边 + 顶部高光，
    // 替换此前 active/primary 整块填橙青的大色块（真机截图"蓝色底突兀/低级"的根因）。
    const accent = primary ? new Color(232, 174, 85, 220) : new Color(95, 200, 208, 205);
    const half = radius;
    const corner = Math.min(radius * 0.32, 16);
    this.safeClear(graphics);
    // 玻璃底：primary 略带暖调，其余深墨绿半透明，透出太空背景。
    graphics.fillColor = primary
      ? new Color(28, 20, 12, 198)
      : new Color(7, 22, 29, 198);
    this.safeRoundRect(graphics, -half, -half, half * 2, half * 2, corner);
    this.safeFill(graphics);
    // 细描边：1.5px，pressed/primary 稍微加粗，但仍只是线，不是色块。
    graphics.strokeColor = accent;
    graphics.lineWidth = primary ? 2.2 : 1.5;
    this.safeRoundRect(graphics, -half + 1.5, -half + 1.5, (half - 1.5) * 2, (half - 1.5) * 2, corner);
    this.safeStroke(graphics);
    // 顶部一道高光：模拟玻璃反光，拉开层次、去"低级"平涂感。
    graphics.strokeColor = new Color(226, 245, 255, 52);
    graphics.lineWidth = 1;
    const glossY = -half + corner * 0.7;
    this.safeMoveTo(graphics, -half + corner + 2, glossY);
    this.safeLineTo(graphics, half - corner - 2, glossY);
    this.safeStroke(graphics);
    if (active) {
      // 按下只加一圈内亮边，不再整块变色。
      graphics.strokeColor = new Color(255, 240, 200, 220);
      graphics.lineWidth = 2;
      this.safeRoundRect(graphics, -half + 6, -half + 6, (half - 6) * 2, (half - 6) * 2, Math.max(2, corner - 4));
      this.safeStroke(graphics);
    }
  }

  /**
   * 动作控件图标：画在独立子节点上（偏上），下半区留给文字，避免图标与文字叠字。
   */
  private drawActionGlyph(
    graphics: Graphics,
    role: BrowserPointerRole,
    radius: number,
    active: boolean,
  ): void {
    const primary = role === 'primaryFire';
    const boost = role === 'boost';
    const accent = active || primary ? HUD_ACTIVE : HUD_CYAN;
    const r = radius * 0.6;
    this.safeClear(graphics);
    graphics.strokeColor = accent;
    graphics.fillColor = accent;
    graphics.lineWidth = 2;
    if (primary) {
      graphics.strokeColor = new Color(255, 224, 170, active ? 255 : 170);
      graphics.lineWidth = 1.5;
      this.safeCircle(graphics, 0, 0, r * 0.92);
      this.safeStroke(graphics);
      const arm = r * 0.42;
      this.safeMoveTo(graphics, -arm, 0);
      this.safeLineTo(graphics, arm, 0);
      this.safeMoveTo(graphics, 0, -arm);
      this.safeLineTo(graphics, 0, arm);
      this.safeStroke(graphics);
    } else if (boost) {
      graphics.lineWidth = 3;
      this.safeArc(graphics, 0, 0, r * 1.15, -2.7, -0.45, false);
      this.safeStroke(graphics);
      this.safeMoveTo(graphics, -r * 0.3, -r * 0.36);
      this.safeLineTo(graphics, r * 0.33, 0);
      this.safeLineTo(graphics, -r * 0.3, r * 0.36);
      this.safeStroke(graphics);
    } else if (role === 'secondaryFire') {
      this.safeMoveTo(graphics, -r * 0.42, -r * 0.28);
      this.safeLineTo(graphics, r * 0.36, 0);
      this.safeLineTo(graphics, -r * 0.42, r * 0.28);
      this.safeClose(graphics);
      this.safeStroke(graphics);
    } else if (role === 'cameraToggle') {
      this.safeRect(graphics, -r * 0.38, -r * 0.24, r * 0.76, r * 0.48);
      this.safeStroke(graphics);
      this.safeCircle(graphics, 0, 0, r * 0.16);
      this.safeStroke(graphics);
    } else if (role === 'pause') {
      graphics.fillColor = accent;
      this.safeRect(graphics, -r * 0.24, -r * 0.38, r * 0.16, r * 0.76);
      this.safeRect(graphics, r * 0.08, -r * 0.38, r * 0.16, r * 0.76);
      this.safeFill(graphics);
    } else if (role === 'returnRequested') {
      this.safeArc(graphics, 0, 0, r * 0.5, -0.7, Math.PI * 1.6, false);
      this.safeStroke(graphics);
      this.safeMoveTo(graphics, -r * 0.48, r * 0.1);
      this.safeLineTo(graphics, -r * 0.58, r * 0.46);
      this.safeLineTo(graphics, -r * 0.18, r * 0.36);
      this.safeStroke(graphics);
    } else if (role === 'swapWeapons') {
      this.safeMoveTo(graphics, -r * 0.4, -r * 0.06);
      this.safeLineTo(graphics, r * 0.4, -r * 0.06);
      this.safeMoveTo(graphics, r * 0.4, -r * 0.06);
      this.safeLineTo(graphics, r * 0.12, -r * 0.38);
      this.safeMoveTo(graphics, r * 0.4, -r * 0.06);
      this.safeLineTo(graphics, r * 0.12, r * 0.26);
      this.safeStroke(graphics);
      this.safeMoveTo(graphics, -r * 0.4, r * 0.06);
      this.safeLineTo(graphics, r * 0.4, r * 0.06);
      this.safeMoveTo(graphics, -r * 0.4, r * 0.06);
      this.safeLineTo(graphics, -r * 0.12, r * 0.38);
      this.safeMoveTo(graphics, -r * 0.4, r * 0.06);
      this.safeLineTo(graphics, -r * 0.12, -r * 0.26);
      this.safeStroke(graphics);
    } else if (role === 'deviceAbility') {
      graphics.strokeColor = HUD_ACTIVE;
      graphics.lineWidth = 2;
      const edge = r * 0.6;
      this.safeMoveTo(graphics, 0, -edge);
      this.safeLineTo(graphics, edge, 0);
      this.safeLineTo(graphics, 0, edge);
      this.safeLineTo(graphics, -edge, 0);
      this.safeClose(graphics);
      this.safeStroke(graphics);
      this.safeCircle(graphics, 0, 0, r * 0.16);
      this.safeStroke(graphics);
    } else {
      const tick = r * 0.28;
      this.safeMoveTo(graphics, -tick, 0);
      this.safeLineTo(graphics, tick, 0);
      this.safeStroke(graphics);
    }
  }

  /**
   * 摇杆底座：暗底盘 + 亮外环 + 内死区细环 + 四向刻度。
   *
   * 只保留这四件套，删掉原先那圈四段弧线——真机截图里它和满屏杂物混在一起，
   * 玩家反而看不出摇杆在哪、当前推向哪。
   */
  private drawStickDeadzone(graphics: Graphics, radius: number): void {
    this.safeClear(graphics);
    // 底盘：半透明深色，让摇杆区域在任何太空背景上都能被一眼认出
    graphics.fillColor = new Color(4, 18, 26, 150);
    this.safeCircle(graphics, 0, 0, radius);
    this.safeFill(graphics);
    // 外环：摇杆的主视觉锚点
    graphics.strokeColor = new Color(120, 214, 224, 235);
    graphics.lineWidth = 2;
    this.safeCircle(graphics, 0, 0, radius - 1);
    this.safeStroke(graphics);
    // 内死区细环
    graphics.strokeColor = new Color(226, 245, 255, 92);
    graphics.lineWidth = 1;
    this.safeCircle(graphics, 0, 0, Math.max(4, radius * 0.3));
    this.safeStroke(graphics);
    // 四向刻度：提示推杆方向
    graphics.strokeColor = new Color(59, 211, 255, 175);
    graphics.lineWidth = 2;
    const tickStart = radius * 0.8;
    const tickEnd = radius * 0.96;
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      this.safeMoveTo(graphics, Math.cos(angle) * tickStart, Math.sin(angle) * tickStart);
      this.safeLineTo(graphics, Math.cos(angle) * tickEnd, Math.sin(angle) * tickEnd);
    }
    this.safeStroke(graphics);
  }

  private drawStickDirection(snapshot: TouchStickFeedbackSnapshot): void {
    const graphics = this.stickDirection;
    if (!graphics) return;
    this.safeClear(graphics);
    if (!snapshot.active || snapshot.threshold === 'center') return;
    const radius = this.touchLayout().movement.radius;
    graphics.strokeColor = new Color(123, 211, 188, 205);
    graphics.lineWidth = snapshot.threshold === 'full' ? 3 : 2;
    this.safeArc(graphics, 0, 0, radius * 0.74, snapshot.angle - 0.34, snapshot.angle + 0.34, false);
    this.safeStroke(graphics);
  }

  private canvasPosition(x: number, y: number, z = 0): Vec3 {
    return new Vec3(x - (this.width / 2), (this.height / 2) - y, z);
  }

  /** 按当前 homeView 重刷标题/说明文案并复原说明色（清掉上次商城购买反馈）。 */
  private refreshHomeViewText(): void {
    const titleKeys: Record<NativeHomeView, CombatMessageKey> = {
      operations: 'home.operationsTitle', hangar: 'home.hangarTitle', cargo: 'home.cargoTitle',
      market: 'home.marketTitle', settings: 'home.settingsTitle', coop: 'home.coopTitle',
    };
    const detailKeys: Record<NativeHomeView, CombatMessageKey> = {
      operations: 'home.operationsDetail', hangar: 'home.hangarDetail', cargo: 'home.cargoDetail',
      market: 'home.marketDetail', settings: 'home.settingsDetail', coop: 'home.coopDetail',
    };
    if (this.homeViewTitle) this.homeViewTitle.string = this.text(titleKeys[this.homeView]);
    if (this.homeViewDetail) {
      this.homeViewDetail.string = this.text(detailKeys[this.homeView]);
      this.homeViewDetail.color = HUD_WHITE;
    }
  }

  /** 行动视图：从缓存 snapshot + loadEconomy 组合真实数据，缺字段用已有字段兜底，不编造。 */
  private refreshOperationsReadout(): void {
    if (!this.homeOpsLabel) return;
    const economy = loadEconomy();
    const snapshot = this.latestSnapshot;
    // 累计结算次数：结算凭证（每次远征结算写一条）数量。
    const settlements = economy.receipts.length;
    // 最近带回货物：优先本局保全结算值，否则用缓存货舱清单价值组合。
    const cargoItems = snapshot?.cargo.items || [];
    const cargoValue = snapshot?.navigation.securedCargoValue
      || cargoItems.reduce((total, item) => total + Math.max(0, Number(item.value) || 0), 0);
    const mission = this.text(`home.${this.missionPreset}` as CombatMessageKey);
    const loadout = snapshot?.loadout || this.pendingLoadout;
    this.homeOpsLabel.string = [
      this.text('home.opsExpeditions', { count: settlements }),
      this.text('home.opsLastHaul', { value: cargoValue }),
      this.text('home.opsTickets', { value: economy.starportTickets }),
      this.text('home.opsMission', { mission }),
      this.text('home.opsLoadout', {
        ship: this.loadoutName(String(loadout.ship)),
        weapon: this.loadoutName(String(loadout.weapon)),
      }),
    ].join('\n');
  }

  /** 前哨面板：用 syncCombat 缓存的最后一个 snapshot 渲染真实三量 + 星港券，不写死数值。 */
  private updateOutpostReadouts(): void {
    const player = this.latestSnapshot?.player;
    if (this.outpostVitalsLabel) {
      this.outpostVitalsLabel.string = this.text('outpost.vitals', {
        hull: Math.ceil(player?.health ?? 0),
        hullMax: Math.ceil(player?.maxHealth ?? 0),
        shield: Math.ceil(player?.shield ?? 0),
        shieldMax: Math.ceil(player?.maxShield ?? 0),
        energy: Math.ceil(player?.energy ?? 0),
        energyMax: Math.ceil(player?.maxEnergy ?? 0),
      });
    }
    if (this.outpostTicketsLabel) {
      const balance = loadEconomy().starportTickets;
      this.outpostTicketsLabel.string = this.lastTicketGain > 0
        ? this.text('outpost.ticketsGain', { value: balance, gain: this.lastTicketGain })
        : this.text('outpost.tickets', { value: balance });
    }
  }

  /** 联机控件：native(available===false) 或未接线时禁用 4 个按钮，不假装能连。 */
  private updateCoopControls(): void {
    const coop = this.actions?.coop;
    const unavailable = !coop || coop.available === false;
    const viewVisible = this.homeView === 'coop';
    const enabled = viewVisible && !unavailable;
    for (const button of [this.coopHostButton, this.coopJoinButton, this.coopCloseButton]) {
      if (button) button.active = enabled;
    }
    if (this.coopCopyButton) {
      this.coopCopyButton.active = enabled && typeof coop?.copyCode === 'function';
    }
    if (this.coopStatusLabel) this.coopStatusLabel.node.active = viewVisible;
    if (this.coopCodeLabel) this.coopCodeLabel.node.active = viewVisible;
    // 🔴 房间码输入框此前从未被隐藏，导致「输入房间码」在行动视图里永久常驻、
    // 还压在任务列表上（yy 截图里的常驻杂物之一）。
    if (this.coopJoinInput) this.coopJoinInput.node.active = viewVisible;
    this.updateCoopLabels();
  }

  /** 状态文案 + detail + 可复制的 code 文本；code 折行截断，避免溢出屏幕。 */
  private updateCoopLabels(): void {
    const coop = this.actions?.coop;
    const unavailable = !coop || coop.available === false;
    if (this.coopStatusLabel) {
      if (unavailable) {
        this.coopStatusLabel.string = this.text('coop.unavailable');
        this.coopStatusLabel.color = HUD_ACTIVE;
      } else {
        const lines = [this.text(`coop.state.${this.coopState}` as CombatMessageKey)];
        if (this.coopDetail) lines.push(this.coopDetail);
        this.coopStatusLabel.string = lines.join('\n');
        this.coopStatusLabel.color = this.coopState === 'error' ? HUD_RED : HUD_CYAN;
      }
    }
    if (this.coopCodeLabel) {
      this.coopCodeLabel.string = this.coopCode
        ? `${this.text('coop.codeTitle')}\n${this.wrapCoopCode(this.coopCode)}`
        : this.text('coop.codeTitle');
    }
  }

  /** 长邀请码/应答码按固定列宽折行并限制行数（Label 分行截断，别溢出屏幕）。 */
  private wrapCoopCode(code: string): string {
    const columns = 16;
    const maxLines = 6;
    const lines: string[] = [];
    for (let index = 0; index < code.length; index += columns) {
      lines.push(code.slice(index, index + columns));
    }
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, columns - 1)}…`;
    }
    return lines.join('\n');
  }

  private text(key: CombatMessageKey, params: Readonly<Record<string, string | number>> = {}): string {
    return combatText(this.locale, key, params);
  }

  /** 站内玩法新文案：中文语种用中文，其余用英文，避免改动 8 语言映射的类型系统。 */
  private st(zh: string, en: string): string {
    return this.locale === 'zh-CN' || this.locale === 'zh-TW' ? zh : en;
  }

  /**
   * 按目标类型渲染进度。
   *
   * 此前无论什么任务都显示 `击杀数/需求数`，四种目标类型引入后
   * 「存活」与「采集」显示击杀进度是错的 —— 玩家会以为自己没推进。
   * 每种目标给不同的「已完成/总量」表达，并附一句目标提示。
   */
  private objectiveProgressText(snapshot: CombatSnapshot): string {
    const mission = snapshot.mission;
    const target = Math.max(1, Math.round(mission.progressTarget));
    switch (mission.objectiveType) {
      case 'survive': {
        // 存活用倒计时，最能传达「还差多久」
        const remaining = Math.ceil(mission.surviveRemaining);
        return `${this.text('objective.survive')}  ${this.text('objective.progressTime', { value: remaining })}`;
      }
      case 'collect':
        return `${this.text('objective.collect')}  ${mission.progress}/${target}  ·  ${this.text('objective.eliminate')} ${snapshot.enemies.length}`;
      case 'hunt':
        return `${this.text('objective.hunt')}  ${mission.progress}/${target}  ${this.text('objective.huntHint')}`;
      case 'defense':
        // 守点：进度 = 守住的秒数，核心被靠近就会掉
        return `${this.text('objective.defense')}  ${Math.round(mission.progress)}/${target}  ${this.text('objective.defenseHint')}`;
      case 'escort':
        return `${this.text('objective.escort')} ${Math.round(mission.progress)}% · ${this.text('objective.escortHp', { value: Math.round(mission.escortHealth) })}`;
      case 'eliminate':
      default:
        return `${this.text('objective.eliminate')}  ${mission.progress}/${target}`;
    }
  }

  /**
   * 区域规则提示：把「当前扇区有什么特殊规则」告诉玩家。
   *
   * 之前扇区只是名字，规则是隐藏的；现在规则真的会掉血/改锁定，
   * 玩家必须看得见才知道为什么要贴着航道中心飞。
   */
  private regionText(snapshot: CombatSnapshot): string {
    const region = snapshot.mission.region;
    if (!region || region.id === 'open') return '';
    const briefKey: CombatMessageKey = region.id === 'canyon' ? 'region.canyonBrief'
      : region.id === 'storm' ? 'region.stormBrief'
        : region.id === 'debris' ? 'region.debrisBrief'
          : 'region.openBrief';
    const nameKey: CombatMessageKey = region.id === 'canyon' ? 'region.canyon'
      : region.id === 'storm' ? 'region.storm'
        : region.id === 'debris' ? 'region.debris'
          : 'region.open';
    return this.text('region.hint', {
      name: this.text(nameKey),
      brief: this.text(briefKey),
    });
  }

  private loadoutName(id: string): string {
    const key = LOADOUT_NAME_KEYS[id];
    return key ? this.text(key) : id;
  }

  private actionNodeName(role: BrowserPointerRole): string {
    const names: Readonly<Record<string, string>> = {
      primaryFire: 'PrimaryFire',
      secondaryFire: 'SecondaryFire',
      boost: 'Boost',
      cameraToggle: 'CameraToggle',
      pause: 'Pause',
      returnRequested: 'ReturnAction',
      swapWeapons: 'WeaponSwap',
      deviceAbility: 'DeviceAbility',
    };
    return names[role] || 'TouchAction';
  }
}
