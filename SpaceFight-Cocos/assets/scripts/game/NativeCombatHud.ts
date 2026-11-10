import {
  Camera,
  Canvas,
  Color,
  EditBox,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
  resources,
  Sprite,
  SpriteFrame,
  Texture2D,
  UIOpacity,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  tween,
  view,
} from 'cc';
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
import { AUDIO_ENGINE_KEY, AUDIO_SFX_KEY, audioSettingEnabled, toggleAudioSetting } from './GameAudio';
import {
  movementControlCircle,
  returnControlCircle,
  touchActionLayout,
  type BrowserPointerRole,
  type TouchSafeInsets,
} from '../input/BrowserInputBridge';
import type { NativeInputFeedback, NativeTouchLayout } from '../input/CocosInputBridge';
import type { InputSettings } from '../input/InputSettings';
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
export interface NativeHudActions {
  onReturnHome?: () => void;
  onStationService?: (service: StationServiceId) => void;
  /** 设置里的「开始新手教学」：由 CombatBootstrap 切到 tutorial 预设并重置战局。 */
  onStartTutorial?: () => void;
  coop?: CoopHudBridge;
}

type NativeHomeView = 'operations' | 'hangar' | 'cargo' | 'market' | 'settings' | 'coop';
type NativeOverlay = 'home' | 'loadout' | 'outpost' | 'defeat' | 'pause';
type PanelButtonKind = 'standard' | 'primary' | 'nav' | 'slot' | 'danger';

interface ActionVisual {
  node: Node;
  graphics: Graphics;
  radius: number;
}

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
    this.touchEnabled = touchEnabled;
    this.inputSettings = { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1, ...initialInputSettings };
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
      ['launcher key art', () => this.loadLauncherKeyArt()],
      ['return overlay', () => this.createReturnOverlay()],
    ];
    for (const [name, create] of creators) {
      try {
        create();
      } catch (error: unknown) {
        console.error(`[SpaceFight HUD] ${name} panel init failed; other panels continue`, error);
      }
    }
    // 半初始化的覆盖层若残留 active=true 会直接盖住战场，统一收口。
    for (const panel of [
      this.homePanel, this.loadoutPanel, this.outpostPanel,
      this.defeatPanel, this.pausePanel, this.trainingPanel,
    ]) {
      if (panel) panel.active = false;
    }
    // 启动阶段先把战斗控件全部收起：否则摇杆 / 技能钮会叠在初始化主页上，
    // 这些 Graphics 还会在尚未布局完成时进入首帧渲染。
    this.setCombatChromeVisible(false);
  }

  resize(
    width: number,
    height: number,
    safeInsets: TouchSafeInsets,
    leftHanded = false,
    controlScale = 1,
  ): void {
    // 视图尚未就绪时可能传入 0 / NaN；用默认设计尺寸兜底，避免生成零面积路径。
    this.width = Number.isFinite(width) && width > 0 ? width : 1280;
    this.height = Number.isFinite(height) && height > 0 ? height : 720;
    this.safeInsets = safeInsets;
    this.leftHanded = leftHanded;
    this.controlScale = controlScale;
    this.root.getComponent(UITransform)?.setContentSize(width, height);
    this.layoutStatus();
    this.layoutLoadoutPanel();
    this.layoutHomePanel();
    this.layoutOutpostPanel();
    this.layoutDefeatPanel();
    this.layoutPausePanel();
    this.layoutTrainingPanel();
    this.layoutBootPanel();
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
    // 返航过场：命中判定只认暂停/视角/返航按钮。此前只把节点 active=false，
    // 但 CocosInputBridge 仍按 touchLayout().actions 判定，隐藏的开火/加速照样能点到。
    const actions = this.returning
      ? all.filter((control) => control.role === 'pause' || control.role === 'cameraToggle')
      : all;
    const result = [...actions];
    // 可返航/可停靠时补上返航进度圆（去重，避免重复 role）。
    if ((this.canReturn || this.canDock) && !result.some((control) => control.role === 'returnRequested')) {
      result.push(returnControlCircle(this.width, this.height, this.safeInsets, this.controlScale));
    }
    return {
      actions: result,
      movement: movementControlCircle(
        this.width,
        this.height,
        this.leftHanded,
        this.safeInsets,
        this.controlScale,
      ),
    };
  }

  syncCombat(snapshot: CombatSnapshot): void {
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
    this.drawReticle(
      this.shotFeedbackFrames > 0 ? HUD_ACTIVE : HUD_CYAN,
      this.shotFeedbackFrames > 0,
      snapshot.target?.locked === true,
    );
    this.drawHitMarker(this.hitFeedbackFrames > 0, this.hitFeedbackLethal);
    this.drawReturnProgress(snapshot.expedition.returnProgress);
    this.updateReturnOverlay(snapshot);
    this.updateComboReadout(snapshot.combo);
    this.updateUpgradeReadout(snapshot.upgrades);
    this.updateWeaponReadout(snapshot);
    this.shotFeedbackFrames = Math.max(0, this.shotFeedbackFrames - 1);
    this.hitFeedbackFrames = Math.max(0, this.hitFeedbackFrames - 1);
    this.combatFeedFrames = Math.max(0, this.combatFeedFrames - 1);
    if (this.combatFeedLabel) this.combatFeedLabel.node.active = this.combatFeedFrames > 0;
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
    this.preflight = true;
    if (this.bootPanel) this.bootPanel.active = false;
    this.setHomeOpen(true);
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

  blocksFlightInput(): boolean {
    return this.loadoutOpen || this.homeOpen || this.outpostOpen || this.defeatOpen
      || this.pauseOpen || this.shouldShowTraining();
  }

  allowsPauseToggle(): boolean {
    return !this.loadoutOpen && !this.homeOpen && !this.outpostOpen && !this.defeatOpen;
  }

  destroy(): void {
    // 异步贴图回调可能晚于 destroy 返回：置标记并清空引用，避免写已销毁节点。
    this.destroyed = true;
    this.bootKeyArt = null;
    this.homeKeyArt = null;
    this.loadoutHangarArt = null;
    this.outpostKeyArt = null;
    this.outpostArtFrame = null;
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
    this.objectiveLabel = this.createLabel('ObjectiveStatus', 17, HUD_CYAN);
    this.sectorLabel = this.createLabel('SectorStatus', 14, HUD_WHITE);
    this.sectorLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
    this.targetLabel = this.createLabel('TargetStatus', 14, HUD_ACTIVE);
    this.cargoLabel = this.createLabel('CargoStrip', 14, HUD_WHITE);
    this.cargoLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;
    this.hullStatusBar = this.createNode('HullStatusBar').addComponent(Graphics);
    this.shieldStatusBar = this.createNode('ShieldStatusBar').addComponent(Graphics);
    this.energyStatusBar = this.createNode('EnergyStatusBar').addComponent(Graphics);
    this.targetHealthBar = this.createNode('TargetHealthBar').addComponent(Graphics);
    this.hitMarker = this.createNode('HitMarker').addComponent(Graphics);
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
      this.safeInsets.top + 48,
    ));
    this.objectiveLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(320, usableWidth * 0.48),
      34,
    );
    // 航区/波次：紧贴目标条下方居中，玩家一眼可见当前位置与进度
    this.sectorLabel?.node.setPosition(this.canvasPosition(
      this.width / 2,
      this.safeInsets.top + 70,
    ));
    this.sectorLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(320, usableWidth * 0.48),
      22,
    );
    // 目标锁定读数下移到航区行下方，避免「无目标」压在「当前区域…」上。
    this.targetLabel?.node.setPosition(this.canvasPosition(
      this.width / 2,
      this.safeInsets.top + 100,
    ));
    this.targetLabel?.getComponent(UITransform)?.setContentSize(
      Math.min(360, usableWidth * 0.58),
      28,
    );
    this.targetHealthBar?.node.setPosition(this.canvasPosition(this.width / 2, this.safeInsets.top + 120, 2));
    this.hitMarker?.node.setPosition(this.canvasPosition(this.width / 2, this.height / 2, 4));
    this.combatFeedLabel?.node.setPosition(this.canvasPosition(this.width / 2, (this.height / 2) + 48, 5));
    this.combatFeedLabel?.getComponent(UITransform)?.setContentSize(Math.min(420, usableWidth - 32), 34);
    this.navigationLabel?.node.setPosition(this.canvasPosition(this.width / 2, this.height - this.safeInsets.bottom - 76, 4));
    this.comboLabel?.node.setPosition(this.canvasPosition(this.width / 2, this.safeInsets.top + 144, 6));
    this.comboLabel?.getComponent(UITransform)?.setContentSize(Math.min(340, usableWidth - 40), 30);
    this.upgradeLabel?.node.setPosition(this.canvasPosition(this.width / 2, this.height - this.safeInsets.bottom - 108, 5));
    this.upgradeLabel?.getComponent(UITransform)?.setContentSize(Math.min(440, usableWidth - 32), 28);
    this.navigationLabel?.getComponent(UITransform)?.setContentSize(Math.min(360, usableWidth - 40), 28);
    // 窄屏(<600)：货舱读数下移一行并缩宽、保持右对齐，避免 375 宽竖屏与 statusLabel 重叠。
    const narrow = usableWidth < 600;
    const cargoWidth = narrow ? Math.min(200, usableWidth - 24) : 236;
    this.cargoLabel?.node.setPosition(this.canvasPosition(
      this.width - this.safeInsets.right - (narrow ? 12 + (cargoWidth / 2) : 130),
      this.safeInsets.top + (narrow ? 52 : 20),
    ));
    this.cargoLabel?.getComponent(UITransform)?.setContentSize(cargoWidth, 30);
    // weaponLabel 是 LEFT 对齐：中心需右移半个宽度(140)，否则左半截落在屏外。
    this.weaponLabel?.node.setPosition(this.canvasPosition(
      this.leftHanded ? this.width - this.safeInsets.right - 140 : this.safeInsets.left + 12 + 140,
      this.height - this.safeInsets.bottom - 34,
    ));
    this.weaponLabel?.getComponent(UITransform)?.setContentSize(280, 28);
    this.abilityLabel?.node.setPosition(this.canvasPosition(
      this.leftHanded ? this.width - this.safeInsets.right - 140 : this.safeInsets.left + 12 + 140,
      this.height - this.safeInsets.bottom - 60,
    ));
    this.abilityLabel?.getComponent(UITransform)?.setContentSize(280, 24);
  }

  private createReticle(): void {
    const node = this.createNode('AimReticle');
    this.reticleGraphics = node.addComponent(Graphics);
    this.drawReticle(HUD_CYAN);
  }

  private drawReticle(accent: Color, recoil = false, locked = false): void {
    const graphics = this.reticleGraphics;
    if (!graphics) return;
    const recoilOffset = recoil ? 6 : 0;
    const inner = 10 + recoilOffset;
    const outer = 24 + recoilOffset;
    graphics.clear();
    graphics.strokeColor = accent;
    graphics.fillColor = accent;
    graphics.lineWidth = 2;
    this.safeCircle(graphics, 0, 0, inner);
    graphics.moveTo(-outer, 0);
    graphics.lineTo(-inner, 0);
    graphics.moveTo(inner, 0);
    graphics.lineTo(outer, 0);
    graphics.moveTo(0, -outer);
    graphics.lineTo(0, -inner);
    graphics.moveTo(0, inner);
    graphics.lineTo(0, outer);
    graphics.moveTo(-38, -30);
    graphics.lineTo(-13, -9);
    graphics.moveTo(38, -30);
    graphics.lineTo(13, -9);
    graphics.stroke();
    if (locked) {
      graphics.lineWidth = 1.5;
      graphics.moveTo(-7, -18);
      graphics.lineTo(0, -23);
      graphics.lineTo(7, -18);
      graphics.moveTo(-7, 18);
      graphics.lineTo(0, 23);
      graphics.lineTo(7, 18);
      graphics.stroke();
    }
    this.safeCircle(graphics, 0, 0, 2.5);
    graphics.fill();
  }

  /**
   * Cocos 3.8 原生 2D 绑定在零 / 负 / NaN 几何上会生成空或畸形路径，
   * 随后 fill() / stroke() 触发 std::out_of_range: vector 并直接 SIGABRT
   * （2026-11-10 实机「初始化主页叠摇杆 + 立刻闪退」复现）。
   * 统一把几何收敛到合法最小尺寸，保证每次 fill/stroke 前都有可三角化的路径。
   */
  private safeCoord(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private safeLength(value: number): number {
    return Number.isFinite(value) ? Math.max(1, value) : 1;
  }

  private safeRect(graphics: Graphics, x: number, y: number, width: number, height: number): void {
    graphics.rect(this.safeCoord(x), this.safeCoord(y), this.safeLength(width), this.safeLength(height));
  }

  private safeCircle(graphics: Graphics, x: number, y: number, radius: number): void {
    graphics.circle(this.safeCoord(x), this.safeCoord(y), this.safeLength(radius));
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
    let end = Number.isFinite(endAngle) ? endAngle : start + 0.01;
    if (Math.abs(end - start) < 0.01) end = start + 0.01;
    graphics.arc(this.safeCoord(x), this.safeCoord(y), this.safeLength(radius), start, end, counterclockwise);
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
    graphics.clear();
    // 战术分段条：平滑填充 + 等距刻度，与网页端 HUD 的分段状态条保持同一视觉语言。
    graphics.fillColor = new Color(3, 10, 14, 196);
    this.safeRect(graphics, 0, -4, width, 8);
    graphics.fill();
    graphics.fillColor = critical ? HUD_RED : accent;
    this.safeRect(graphics, 0, -4, width * ratio, 8);
    graphics.fill();
    graphics.fillColor = new Color(3, 10, 14, 235);
    const segments = 18;
    const step = width / segments;
    for (let index = 1; index < segments; index += 1) {
      this.safeRect(graphics, index * step - 1, -4, 2, 8);
    }
    graphics.fill();
    graphics.strokeColor = new Color(96, 160, 172, 120);
    graphics.lineWidth = 1;
    this.safeRect(graphics, 0, -5, width, 10);
    graphics.stroke();
  }

  private drawTargetHealth(value: number, maximum: number, visible: boolean): void {
    const graphics = this.targetHealthBar;
    if (!graphics) return;
    graphics.node.active = visible;
    graphics.clear();
    if (!visible) return;
    const width = Math.min(300, Math.max(180, this.width * 0.24));
    const ratio = Math.max(0, Math.min(1, maximum > 0 ? value / maximum : 0));
    graphics.fillColor = new Color(5, 12, 16, 210);
    this.safeRect(graphics, -width / 2, -3, width, 6);
    graphics.fill();
    graphics.fillColor = ratio < 0.25 ? HUD_RED : HUD_ACTIVE;
    this.safeRect(graphics, -width / 2, -3, width * ratio, 6);
    graphics.fill();
    graphics.strokeColor = new Color(226, 245, 255, 86);
    graphics.lineWidth = 1;
    this.safeRect(graphics, -width / 2, -4, width, 8);
    graphics.stroke();
  }

  private drawHitMarker(active: boolean, lethal = false): void {
    const graphics = this.hitMarker;
    if (!graphics) return;
    graphics.clear();
    if (!active) return;
    const inner = 9;
    const outer = 17;
    graphics.strokeColor = lethal ? HUD_ACTIVE : HUD_WHITE;
    graphics.lineWidth = lethal ? 3.5 : 2.5;
    for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      graphics.moveTo(x * inner, y * inner);
      graphics.lineTo(x * outer, y * outer);
    }
    graphics.stroke();
    if (lethal) {
      this.safeCircle(graphics, 0, 0, 24);
      graphics.stroke();
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
    this.loadoutBackdrop = this.createNode('NativeLoadoutShade', this.loadoutPanel).addComponent(Graphics);
    this.loadoutSlotRail = this.createNode('NativeLoadoutSlotRail', this.loadoutPanel).addComponent(Graphics);
    this.loadoutSchematic = this.createNode('NativeLoadoutShipSchematic', this.loadoutPanel).addComponent(Graphics);

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
    const shade = this.createNode('NativeBootShade', this.bootPanel).addComponent(Graphics);
    shade.fillColor = new Color(1, 7, 10, 210);
    this.safeRect(shade, -640, -360, 1280, 720);
    shade.fill();

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
    this.bootProgress = this.createNode('NativeBootProgress', this.bootPanel).addComponent(Graphics);
    this.drawBootProgress(0.18);
  }

  private createDefeatPanel(): void {
    this.defeatPanel = this.createNode('NativeDefeatPanel');
    this.defeatBackdrop = this.defeatPanel.addComponent(Graphics);
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
    this.pauseBackdrop = this.pausePanel.addComponent(Graphics);
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
    this.trainingBackdrop = this.trainingPanel.addComponent(Graphics);
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

  private layoutTrainingPanel(): void {
    const panel = this.trainingPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    // 框宽高由屏幕尺寸推导，窄屏不再溢出（旧版写死 540×264）。
    const frameW = Math.min(540, this.width - 32);
    const frameH = Math.min(300, this.height - 32);
    if (this.trainingBackdrop) {
      this.trainingBackdrop.clear();
      this.trainingBackdrop.fillColor = new Color(1, 6, 10, 168);
      this.safeRect(this.trainingBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.trainingBackdrop.fill();
      this.trainingBackdrop.fillColor = new Color(3, 13, 20, 240);
      this.safeRect(this.trainingBackdrop, -frameW / 2, -frameH / 2, frameW, frameH);
      this.trainingBackdrop.fill();
      this.trainingBackdrop.strokeColor = HUD_CYAN;
      this.trainingBackdrop.lineWidth = 2;
      this.trainingBackdrop.moveTo(-frameW / 2, frameH / 2);
      this.trainingBackdrop.lineTo(frameW / 2, frameH / 2);
      this.trainingBackdrop.stroke();
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
    this.homeBackdrop = this.createNode('NativeHomeShade', this.homePanel).addComponent(Graphics);
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
    );
    this.updateHomeSelection();
    this.setHomeView('operations');
    this.homePanel.active = false;
  }

  private createOutpostPanel(): void {
    this.outpostPanel = this.createNode('NativeOutpostPanel');
    this.outpostPanel.addComponent(UIOpacity);
    this.outpostKeyArt = this.createKeyArt('NativeOutpostKeyArt', this.outpostPanel);
    this.outpostBackdrop = this.createNode('NativeOutpostShade', this.outpostPanel).addComponent(Graphics);
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
    this.returnVeil = this.createNode('NativeReturnVeil', this.root).addComponent(Graphics);
    this.returnVeil.node.setSiblingIndex(0);
    this.returnVeilInner = this.createNode('NativeReturnVeilInner', this.root).addComponent(Graphics);
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
    veil.clear();
    veil.fillColor = new Color(0, 8, 12, alpha);
    this.safeRect(veil, -halfW, -halfH, this.width, band);
    this.safeRect(veil, -halfW, halfH - band, this.width, band);
    this.safeRect(veil, -halfW, -halfH, band, this.height);
    this.safeRect(veil, halfW - band, -halfH, band, this.height);
    veil.fill();
    const inner = this.returnVeilInner;
    if (inner) {
      const ib = band * 0.5;
      inner.clear();
      inner.fillColor = new Color(0, 8, 12, alpha);
      this.safeRect(inner, -halfW, -halfH, this.width, ib);
      this.safeRect(inner, -halfW, halfH - ib, this.width, ib);
      this.safeRect(inner, -halfW, -halfH, ib, this.height);
      this.safeRect(inner, halfW - ib, -halfH, ib, this.height);
      inner.fill();
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
      if (this.outpostKeyArt?.node?.isValid) this.outpostKeyArt.spriteFrame = frame;
      this.updateHomeKeyArt();
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
    const frame = this.homeView === 'operations'
      ? this.combatZoneArtFrame || this.outpostArtFrame
      : this.homeView === 'hangar'
        ? this.hangarArtFrame || this.outpostArtFrame
        : this.homeView === 'market'
          ? this.marketArtFrame || this.outpostArtFrame
        : this.outpostArtFrame;
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
    ];
    this.homeOpen = active === 'home';
    this.loadoutOpen = active === 'loadout';
    this.outpostOpen = active === 'outpost';
    this.defeatOpen = active === 'defeat';
    this.pauseOpen = active === 'pause';
    for (const [id, panel] of overlays) {
      if (panel) panel.active = id === active;
    }
    if (this.bootPanel) this.bootPanel.active = false;
  }

  private setCombatChromeVisible(visible: boolean): void {
    // 启动阶段无条件收起，任何调用点都不能把摇杆 / 技能钮提前点亮。
    this.combatChromeVisible = visible && !this.startupVisible;
    // 打开面板时连击/强化/武器读数也必须一并收起，否则旧读数浮在面板上。
    for (const label of [this.statusLabel, this.objectiveLabel, this.sectorLabel, this.targetLabel, this.cargoLabel, this.combatFeedLabel, this.navigationLabel, this.weaponLabel, this.abilityLabel, this.comboLabel, this.upgradeLabel]) {
      if (label) label.node.active = visible;
    }
    if (this.reticleGraphics) this.reticleGraphics.node.active = visible;
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
      visual.node.active = this.combatChromeVisible && allowed;
    }
  }

  private layoutHomePanel(): void {
    const panel = this.homePanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.homeKeyArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const compact = this.height < 470 || this.width < 900;
    const ultraCompact = this.height < 410 || this.width < 720;
    const navWidth = ultraCompact ? 48 : compact ? 56 : 78;
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
      this.homeBackdrop.clear();
      this.homeBackdrop.fillColor = new Color(2, 8, 12, 62);
      this.safeRect(this.homeBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.homeBackdrop.fill();
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 238);
      this.safeRect(this.homeBackdrop, leftEdge, bottomEdge, navWidth, topEdge - bottomEdge);
      this.homeBackdrop.fill();
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 226);
      this.safeRect(this.homeBackdrop, rightEdge - rightWidth, bottomEdge, rightWidth, topEdge - bottomEdge);
      this.homeBackdrop.fill();
      this.homeBackdrop.fillColor = new Color(3, 10, 14, 204);
      const headerHeight = ultraCompact ? 48 : compact ? 58 : 72;
      this.safeRect(this.homeBackdrop, leftEdge + navWidth, topEdge - headerHeight, rightEdge - leftEdge - navWidth - rightWidth, headerHeight);
      this.homeBackdrop.fill();
      this.homeBackdrop.strokeColor = new Color(255, 172, 47, 126);
      this.homeBackdrop.lineWidth = 2;
      this.homeBackdrop.moveTo(rightEdge - rightWidth, bottomEdge + 18);
      this.homeBackdrop.lineTo(rightEdge - rightWidth, topEdge - 18);
      this.homeBackdrop.stroke();
      this.homeBackdrop.strokeColor = new Color(59, 211, 255, 72);
      this.homeBackdrop.lineWidth = 1;
      this.homeBackdrop.moveTo(leftEdge + navWidth + 12, topEdge - headerHeight - 8);
      this.homeBackdrop.lineTo(rightEdge - rightWidth - 24, topEdge - headerHeight - 8);
      this.homeBackdrop.lineTo(rightEdge - rightWidth - 10, topEdge - headerHeight - 22);
      this.homeBackdrop.stroke();
      const telemetryY = bottomEdge + (ultraCompact ? 42 : 58);
      this.homeBackdrop.fillColor = new Color(2, 11, 15, 214);
      this.safeRect(this.homeBackdrop, leftEdge + navWidth + 14, telemetryY - 18, Math.min(360, headerWidth), 36);
      this.homeBackdrop.fill();
      for (let index = 0; index < 4; index += 1) {
        this.homeBackdrop.fillColor = index === 3 ? new Color(255, 172, 47, 172) : new Color(59, 211, 255, 112);
        this.safeRect(this.homeBackdrop, leftEdge + navWidth + 26 + index * 34, telemetryY - 3, 22, 3);
        this.homeBackdrop.fill();
      }
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
    [...this.homeNavButtons.values()].forEach((button, index) => {
      button.setPosition(leftEdge + (navWidth / 2), topEdge - navStart - index * (navHeight + navGap), 4);
      this.resizePanelButton(button, navWidth - 8, navHeight, ultraCompact ? 9 : compact ? 10 : 12,
        [...this.homeNavButtons.keys()][index] === this.homeView ? HUD_ACTIVE : HUD_CYAN);
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
    [...this.missionButtons.values()].forEach((button, index) => {
      const column = index % missionColumns;
      const row = Math.floor(index / missionColumns);
      const x = missionColumns === 1
        ? boardCenterX
        : rightEdge - (missionColumnWidth / 2) - column * (missionColumnWidth + missionColumnGap);
      button.setPosition(x, missionTop - (missionHeight / 2) - row * (missionHeight + missionRowGap), 4);
      this.resizePanelButton(button, missionColumnWidth, missionHeight, ultraCompact ? 9 : compact ? 10 : 13,
        [...this.missionButtons.keys()][index] === this.missionPreset ? HUD_ACTIVE : HUD_CYAN);
    });
    this.hangarButton?.setPosition(boardCenterX, actionY, 4);
    this.deployButton?.setPosition(boardCenterX, actionY, 4);
    this.resizePanelButton(this.hangarButton, rightWidth - 24, actionHeight, ultraCompact ? 10 : compact ? 11 : 14, HUD_ACTIVE);
    this.resizePanelButton(this.deployButton, rightWidth - 24, actionHeight, ultraCompact ? 11 : compact ? 12 : 15, HUD_ACTIVE);
    this.homeMissionLabel?.node.setPosition(contentLeft + Math.min(220, headerWidth / 2), bottomEdge + 24, 4);
    this.homeMissionLabel?.getComponent(UITransform)?.setContentSize(Math.min(430, headerWidth), 28);
    this.homeCargoLabel?.node.setPosition(boardCenterX, (missionTop + missionBottom) / 2, 4);
    this.homeCargoLabel?.getComponent(UITransform)?.setContentSize(rightWidth - 28, Math.max(96, missionTop - missionBottom));
    [...this.marketButtons.values()].forEach((button, index) => {
      const height = Math.max(38, Math.min(ultraCompact ? 44 : compact ? 54 : 70, (missionTop - missionBottom - 16) / 3));
      button.setPosition(boardCenterX, missionTop - (height / 2) - index * (height + 8), 4);
      this.resizePanelButton(button, rightWidth - 28, height, ultraCompact ? 9 : compact ? 10 : 12);
    });
    this.settingsButtons.forEach((button, index) => {
      const gap = ultraCompact ? 3 : compact ? 5 : 8;
      const settingsTop = topEdge - (ultraCompact ? 88 : compact ? 142 : 190);
      const available = settingsTop - missionBottom;
      const buttonHeight = Math.max(31, Math.min(ultraCompact ? 36 : compact ? 42 : 52,
        (available - ((this.settingsButtons.length - 1) * gap)) / this.settingsButtons.length));
      button.setPosition(boardCenterX, settingsTop - (buttonHeight / 2) - index * (buttonHeight + gap), 4);
      this.resizePanelButton(button, rightWidth - 28, buttonHeight, ultraCompact ? 9 : compact ? 10 : 12);
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
      const background = this.coopJoinInput.node.getComponent(Graphics);
      if (background) {
        background.clear();
        background.fillColor = HUD_DARK;
        this.safeRoundRect(background, -(coopWidth / 2), -18, coopWidth, 36, 6);
        background.fill();
        background.strokeColor = HUD_CYAN;
        background.lineWidth = 2;
        this.safeRoundRect(background, -(coopWidth / 2), -18, coopWidth, 36, 6);
        background.stroke();
      }
    }
    this.coopStatusLabel?.node.setPosition(boardCenterX, missionBottom + 60, 4);
    this.coopStatusLabel?.getComponent(UITransform)?.setContentSize(coopWidth, 44);
    this.coopCodeLabel?.node.setPosition(boardCenterX, missionBottom + 8, 4);
    this.coopCodeLabel?.getComponent(UITransform)?.setContentSize(coopWidth, 52);
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
      this.outpostBackdrop.clear();
      this.outpostBackdrop.fillColor = new Color(1, 7, 10, 54);
      this.safeRect(this.outpostBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.outpostBackdrop.fill();
      // 面板底色必须完全不透明，否则底下宣传图的英文标语会透过标题。
      this.outpostBackdrop.fillColor = new Color(2, 10, 14, 255);
      this.safeRect(this.outpostBackdrop, right - panelWidth, bottom, panelWidth, top - bottom);
      this.outpostBackdrop.fill();
      this.outpostBackdrop.strokeColor = new Color(59, 211, 255, 116);
      this.outpostBackdrop.lineWidth = 2;
      this.outpostBackdrop.moveTo(right - panelWidth, bottom + 18);
      this.outpostBackdrop.lineTo(right - panelWidth, top - 18);
      this.outpostBackdrop.stroke();
      this.outpostBackdrop.strokeColor = new Color(226, 245, 255, 58);
      this.outpostBackdrop.lineWidth = 1;
      for (let index = 0; index < 4; index += 1) {
        const y = top - (ultraCompact ? 105 : 154) - index * (ultraCompact ? 19 : 27);
        this.outpostBackdrop.moveTo(right - panelWidth + 18, y);
        this.outpostBackdrop.lineTo(right - 18, y);
      }
      this.outpostBackdrop.stroke();
      this.outpostBackdrop.fillColor = new Color(59, 211, 255, 112);
      this.safeRect(this.outpostBackdrop, right - panelWidth + 18, top - (ultraCompact ? 112 : 161), 48, 3);
      this.outpostBackdrop.fill();
      this.drawPanelFrame(this.outpostBackdrop, right - panelWidth, bottom, panelWidth, top - bottom, HUD_CYAN, 'standard', false);
    }
    const centerX = right - panelWidth / 2;
    const contentWidth = panelWidth - (ultraCompact ? 22 : 34);
    const place = (name: string, y: number, height: number): void => {
      const node = panel.getChildByName(name);
      node?.setPosition(centerX, y, 4);
      node?.getComponent(UITransform)?.setContentSize(contentWidth, height);
    };
    place('NativeOutpostEyebrow', top - (ultraCompact ? 16 : 24), 20);
    place('NativeOutpostTitle', top - (ultraCompact ? 42 : 62), ultraCompact ? 30 : 44);
    place('NativeOutpostDetail', top - (ultraCompact ? 73 : 108), ultraCompact ? 34 : 48);
    // 结算区自上而下排布：状态 → 货物明细 → 底部按钮。
    // 旧版把货物标签放在 bottom+124，正好被「进入装配台」按钮上沿压掉半行字，
    // 且状态与按钮之间留下一大片空白，这里一并收拢。
    place('NativeOutpostStatus', top - (ultraCompact ? 126 : 184), ultraCompact ? 30 : 34);
    const cargoY = top - (ultraCompact ? 160 : 236);
    place('NativeOutpostCargo', cargoY, ultraCompact ? 26 : 34);
    // 真实三量与星港券读数：紧跟货物结算行下方。
    place('NativeOutpostVitals', cargoY - (ultraCompact ? 30 : 44), ultraCompact ? 26 : 30);
    place('NativeOutpostTickets', cargoY - (ultraCompact ? 56 : 78), ultraCompact ? 24 : 28);
    const gap = ultraCompact ? 6 : 10;
    const actionHeight = ultraCompact ? 40 : compact ? 46 : 54;
    // 4 项服务按钮排成 2×2 网格，落在读数与底部离港按钮之间。
    const serviceButtons = [this.outpostRepairButton, this.outpostResupplyButton, this.outpostRefitButton, this.outpostHomeButton];
    const serviceWidth = (contentWidth - 8) / 2;
    const serviceHeight = Math.max(34, Math.min(actionHeight, (top - bottom) * 0.085));
    const serviceRowStep = serviceHeight + gap;
    const serviceCenterY = bottom + actionHeight * 2.5 + gap * 2 + 20;
    serviceButtons.forEach((button, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = centerX + (col === 0 ? -(serviceWidth / 2) - 4 : (serviceWidth / 2) + 4);
      const y = serviceCenterY + (row === 0 ? serviceRowStep / 2 : -serviceRowStep / 2);
      button?.setPosition(x, y, 4);
      this.resizePanelButton(button, serviceWidth, serviceHeight, ultraCompact ? 10 : 12);
    });
    // 「舱内物资」与「进入装配台」并排占同一行，离港按钮仍独占整行。
    const lowerY = bottom + actionHeight * 1.5 + gap + 10;
    const halfWidth = (contentWidth - 8) / 2;
    this.outpostInteriorButton?.setPosition(centerX - halfWidth / 2 - 4, lowerY, 4);
    this.outpostLoadoutButton?.setPosition(centerX + halfWidth / 2 + 4, lowerY, 4);
    this.resizePanelButton(this.outpostInteriorButton, halfWidth, actionHeight, ultraCompact ? 10 : 13);
    this.resizePanelButton(this.outpostLoadoutButton, halfWidth, actionHeight, ultraCompact ? 11 : 14);
    this.outpostUndockButton?.setPosition(centerX, bottom + actionHeight / 2 + 8, 4);
    this.resizePanelButton(this.outpostUndockButton, contentWidth, actionHeight, ultraCompact ? 12 : 15, HUD_ACTIVE);
  }

  private layoutBootPanel(): void {
    const panel = this.bootPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    this.bootKeyArt?.node.getComponent(UITransform)?.setContentSize(this.width, this.height);
    const shade = panel.getChildByName('NativeBootShade')?.getComponent(Graphics);
    if (shade) {
      shade.clear();
      shade.fillColor = new Color(1, 7, 10, 72);
      this.safeRect(shade, -this.width / 2, -this.height / 2, this.width, this.height);
      shade.fill();
      shade.fillColor = new Color(1, 7, 10, 220);
      this.safeRect(shade, -this.width / 2, -this.height / 2, Math.min(620, this.width * 0.52), this.height);
      shade.fill();
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
    graphics.clear();
    graphics.fillColor = new Color(45, 70, 76, 220);
    this.safeRect(graphics, 0, -1, width, 2);
    graphics.fill();
    graphics.fillColor = accent;
    this.safeRect(graphics, 0, -2, width * Math.max(0, Math.min(1, value)), 4);
    graphics.fill();
  }

  private layoutDefeatPanel(): void {
    const panel = this.defeatPanel;
    if (!panel) return;
    panel.getComponent(UITransform)?.setContentSize(this.width, this.height);
    // 框宽高由屏幕尺寸推导，窄屏不再溢出（旧版写死 460×256）。
    const frameW = Math.min(540, this.width - 32);
    const frameH = Math.min(300, this.height - 32);
    if (this.defeatBackdrop) {
      this.defeatBackdrop.clear();
      this.defeatBackdrop.fillColor = new Color(2, 7, 10, 224);
      this.safeRect(this.defeatBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.defeatBackdrop.fill();
      this.defeatBackdrop.strokeColor = new Color(217, 86, 66, 220);
      this.defeatBackdrop.lineWidth = 2;
      this.defeatBackdrop.moveTo(-frameW / 2 + 10, frameH / 2 - 22);
      this.defeatBackdrop.lineTo(frameW / 2 - 10, frameH / 2 - 22);
      this.defeatBackdrop.stroke();
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
      this.pauseBackdrop.clear();
      this.pauseBackdrop.fillColor = new Color(1, 6, 10, 182);
      this.safeRect(this.pauseBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.pauseBackdrop.fill();
      this.pauseBackdrop.fillColor = new Color(3, 13, 20, 242);
      this.safeRect(this.pauseBackdrop, -frameW / 2, -frameH / 2, frameW, frameH);
      this.pauseBackdrop.fill();
      this.pauseBackdrop.strokeColor = HUD_CYAN;
      this.pauseBackdrop.lineWidth = 2;
      this.pauseBackdrop.moveTo(-frameW / 2, frameH / 2);
      this.pauseBackdrop.lineTo(frameW / 2, frameH / 2);
      this.pauseBackdrop.stroke();
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
      this.loadoutBackdrop.clear();
      this.loadoutBackdrop.fillColor = new Color(3, 10, 14, 138);
      this.safeRect(this.loadoutBackdrop, -this.width / 2, -this.height / 2, this.width, this.height);
      this.loadoutBackdrop.fill();
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
      this.loadoutSlotRail.clear();
      this.loadoutSlotRail.fillColor = new Color(3, 10, 14, 220);
      this.safeRect(this.loadoutSlotRail, (-this.width / 2) + this.safeInsets.left, -this.height / 2, gridAreaWidth + 24, this.height);
      this.loadoutSlotRail.fill();
      this.loadoutSlotRail.strokeColor = new Color(59, 211, 255, 86);
      this.loadoutSlotRail.moveTo((-this.width / 2) + this.safeInsets.left + gridAreaWidth + 24, -this.height / 2 + 18);
      this.loadoutSlotRail.lineTo((-this.width / 2) + this.safeInsets.left + gridAreaWidth + 24, this.height / 2 - 18);
      this.loadoutSlotRail.stroke();
    }
    if (this.loadoutSchematic) {
      const g = this.loadoutSchematic;
      const schematicY = gridTop - (ultraCompact ? 92 : compact ? 126 : 166);
      const shipWidth = Math.min(detailWidth * 0.62, ultraCompact ? 112 : compact ? 150 : 210);
      const shipHeight = shipWidth * 0.34;
      g.clear();
      g.strokeColor = new Color(59, 211, 255, 148);
      g.lineWidth = 1.5;
      g.moveTo(detailCenterX, schematicY + shipHeight / 2);
      g.lineTo(detailCenterX + shipWidth * 0.18, schematicY + shipHeight * 0.12);
      g.lineTo(detailCenterX + shipWidth / 2, schematicY - shipHeight * 0.22);
      g.lineTo(detailCenterX + shipWidth * 0.15, schematicY - shipHeight * 0.05);
      g.lineTo(detailCenterX, schematicY - shipHeight / 2);
      g.lineTo(detailCenterX - shipWidth * 0.15, schematicY - shipHeight * 0.05);
      g.lineTo(detailCenterX - shipWidth / 2, schematicY - shipHeight * 0.22);
      g.lineTo(detailCenterX - shipWidth * 0.18, schematicY + shipHeight * 0.12);
      g.close();
      g.stroke();
      g.strokeColor = new Color(226, 245, 255, 58);
      this.safeCircle(g, detailCenterX, schematicY, Math.max(8, shipHeight * 0.22));
      g.moveTo(detailCenterX - shipWidth * 0.62, schematicY);
      g.lineTo(detailCenterX - shipWidth * 0.34, schematicY);
      g.moveTo(detailCenterX + shipWidth * 0.34, schematicY);
      g.lineTo(detailCenterX + shipWidth * 0.62, schematicY);
      g.stroke();
      for (let index = 0; index < 4; index += 1) {
        g.fillColor = index < 3 ? new Color(59, 211, 255, 126) : new Color(255, 172, 47, 182);
        this.safeRect(g, detailCenterX - shipWidth / 2 + index * (shipWidth / 4), schematicY - shipHeight * 0.78, shipWidth / 4 - 4, 3);
        g.fill();
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
      this.loadoutSummaryLabel.lineHeight = ultraCompact ? 11 : compact ? 14 : 18;
    }
    this.loadoutDetailLabel?.node.setPosition(detailCenterX, gridTop - (ultraCompact ? 48 : compact ? 65 : 94), 3);
    this.loadoutDetailLabel?.getComponent(UITransform)?.setContentSize(detailWidth - 12, ultraCompact ? 64 : compact ? 86 : 126);
    this.loadoutFeedbackLabel?.node.setPosition(detailCenterX, feedbackY, 3);
    this.loadoutFeedbackLabel?.getComponent(UITransform)?.setContentSize(detailWidth - 12, feedbackHeight);
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
    const graphics = node.addComponent(Graphics);
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
    const graphics = node.getComponent(Graphics);
    if (graphics) {
      this.drawPanelSurface(graphics, width, height, accent, this.buttonKinds.get(node) || 'standard', false);
    }
    const label = node.getChildByName('Label')?.getComponent(Label);
    if (!label) return;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 3;
    const kind = this.buttonKinds.get(node) || 'standard';
    label.horizontalAlign = kind === 'slot' || kind === 'nav'
      ? HorizontalTextAlignment.LEFT
      : HorizontalTextAlignment.CENTER;
    label.getComponent(UITransform)?.setContentSize(width - (kind === 'nav' ? 14 : 20), height - 8);
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
    graphics.moveTo(left + 12, bottom + 3);
    graphics.lineTo(right - 3, bottom + 3);
    graphics.lineTo(right - 3, top - 12);
    graphics.moveTo(left + 3, bottom + 12);
    graphics.lineTo(left + 3, top - 3);
    graphics.lineTo(right - 12, top - 3);
    graphics.stroke();

    // 四角 L 形锁定角标
    graphics.strokeColor = strong;
    graphics.lineWidth = 2;
    graphics.moveTo(left + bracket, top);
    graphics.lineTo(left, top);
    graphics.lineTo(left, top - bracket);
    graphics.moveTo(right - bracket, top);
    graphics.lineTo(right, top);
    graphics.lineTo(right, top - bracket);
    graphics.moveTo(left + bracket, bottom);
    graphics.lineTo(left, bottom);
    graphics.lineTo(left, bottom + bracket);
    graphics.moveTo(right - bracket, bottom);
    graphics.lineTo(right, bottom);
    graphics.lineTo(right, bottom + bracket);
    graphics.stroke();

    // 顶部刻度尺：等距细刻度，每 4 格加长
    if (showTicks) {
      const ticks = Math.max(8, Math.min(24, Math.floor(width / 24)));
      const gap = (width - 40) / (ticks - 1);
      graphics.strokeColor = new Color(frame.r, frame.g, frame.b, 116);
      graphics.lineWidth = 1;
      for (let index = 0; index < ticks; index += 1) {
        const x = left + 20 + index * gap;
        graphics.moveTo(x, top - 4);
        graphics.lineTo(x, top - (index % 4 === 0 ? 12 : 7));
      }
      graphics.stroke();
    }

    // 右上状态点 + 左下琥珀编号条
    graphics.fillColor = new Color(HUD_ACTIVE.r, HUD_ACTIVE.g, HUD_ACTIVE.b, 210);
    this.safeCircle(graphics, right - 16, top - 16, 2.5);
    graphics.fill();
    graphics.fillColor = new Color(HUD_ACTIVE.r, HUD_ACTIVE.g, HUD_ACTIVE.b, 176);
    this.safeRect(graphics, left + 12, bottom + 9, Math.max(20, width * 0.05), 3);
    graphics.fill();
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
    graphics.clear();
    graphics.moveTo(left + cut, bottom);
    graphics.lineTo(right, bottom);
    graphics.lineTo(right, top - cut);
    graphics.lineTo(right - cut, top);
    graphics.lineTo(left, top);
    graphics.lineTo(left, bottom + cut);
    graphics.close();
    graphics.fillColor = primary
      ? new Color(line.r, line.g, line.b, pressed ? 214 : 174)
      : new Color(5, 16, 21, pressed ? 246 : kind === 'slot' ? 238 : 220);
    graphics.fill();
    graphics.strokeColor = new Color(line.r, line.g, line.b, pressed ? 255 : primary ? 226 : 174);
    graphics.lineWidth = primary ? 2 : 1.25;
    graphics.stroke();
    graphics.fillColor = new Color(line.r, line.g, line.b, pressed ? 255 : 196);
    this.safeRect(graphics, left + 4, bottom + 4, primary ? Math.max(20, width * 0.22) : 3, 3);
    graphics.fill();
    if (kind === 'slot') {
      graphics.strokeColor = new Color(226, 245, 255, 60);
      graphics.lineWidth = 1;
      graphics.moveTo(left + 10, bottom + 9);
      graphics.lineTo(left + 10, top - 9);
      graphics.stroke();
      graphics.fillColor = new Color(line.r, line.g, line.b, 190);
      this.safeRect(graphics, left + 4, top - 12, 3, 8);
      graphics.fill();
    }

    // 战术按钮细节：切角内框、顶边等距刻度、右上状态点、主按钮斜纹
    const inset = 4;
    graphics.strokeColor = new Color(line.r, line.g, line.b, primary ? 72 : 44);
    graphics.lineWidth = 1;
    graphics.moveTo(left + cut * 0.7 + inset, bottom + inset);
    graphics.lineTo(right - inset, bottom + inset);
    graphics.lineTo(right - inset, top - cut * 0.7 - inset);
    graphics.moveTo(left + inset, bottom + cut * 0.7 + inset);
    graphics.lineTo(left + inset, top - inset);
    graphics.lineTo(right - cut * 0.7 - inset, top - inset);
    graphics.stroke();

    const ticks = Math.max(4, Math.min(9, Math.floor(width / 34)));
    graphics.strokeColor = new Color(line.r, line.g, line.b, primary ? 150 : 96);
    graphics.lineWidth = 1;
    for (let index = 0; index < ticks; index += 1) {
      const x = left + 12 + index * ((width - 24) / (ticks - 1));
      graphics.moveTo(x, top - 3);
      graphics.lineTo(x, top - (index % 4 === 0 ? 8 : 5));
    }
    graphics.stroke();

    graphics.fillColor = new Color(line.r, line.g, line.b, pressed ? 255 : 190);
    this.safeCircle(graphics, right - 9, top - 9, 2);
    graphics.fill();

    if (primary) {
      graphics.strokeColor = new Color(28, 19, 6, 92);
      graphics.lineWidth = 1;
      for (let index = 0; index < 5; index += 1) {
        const x = right - 34 + index * 7;
        graphics.moveTo(x, bottom + 6);
        graphics.lineTo(x + 8, top - 6);
      }
      graphics.stroke();
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
    const base = stick.addComponent(Graphics);
    this.drawStickDeadzone(base, layout.movement.radius);
    this.actionVisuals.set('movement', { node: stick, graphics: base, radius: layout.movement.radius });

    const directionNode = this.createNode('FixedMoveStickDirection', stick);
    this.stickDirection = directionNode.addComponent(Graphics);

    this.stickThumb = this.createNode('FixedMoveStickThumb');
    const thumb = this.stickThumb.addComponent(Graphics);
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
      const graphics = node.addComponent(Graphics);
      this.drawActionControl(graphics, control.role, control.radius, false);
      const label = this.createLabel(`${this.actionNodeName(control.role)}Label`, 16, HUD_WHITE, node);
      label.string = this.text(labels[control.role]);
      label.getComponent(UITransform)?.setContentSize(control.radius * 2, 32);
      this.styleTouchActionLabel(label);
      this.actionVisuals.set(control.role, { node, graphics, radius: control.radius });
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
      const graphics = node.addComponent(Graphics);
      const label = this.createLabel('ReturnActionLabel', 16, HUD_WHITE, node);
      label.string = this.text(this.canDock ? 'touch.dock' : 'touch.return');
      label.getComponent(UITransform)?.setContentSize(control.radius * 2, 32);
      this.styleTouchActionLabel(label);
      visual = { node, graphics, radius: control.radius };
      this.actionVisuals.set('returnRequested', visual);
    }
    const available = this.canReturn || this.canDock;
    visual.node.active = available;
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
    if (progress <= 0) return;
    visual.graphics.strokeColor = HUD_WHITE;
    visual.graphics.lineWidth = 4;
    this.safeArc(visual.graphics, 0, 0, visual.radius - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
    visual.graphics.stroke();
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
    const thumb = this.stickThumb?.getComponent(Graphics);
    if (thumb) this.drawDisc(thumb, layout.movement.radius * 0.34, HUD_WHITE);
    for (const control of layout.actions) {
      const visual = this.actionVisuals.get(control.role);
      if (!visual) continue;
      visual.radius = control.radius;
      this.drawActionControl(visual.graphics, control.role, visual.radius, false);
      visual.node.setPosition(this.canvasPosition(control.x, control.y, 1));
      const label = visual.node.getChildByName(`${this.actionNodeName(control.role)}Label`)?.getComponent(Label);
      label?.getComponent(UITransform)?.setContentSize(control.radius * 2, 28);
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
    node.addComponent(Graphics); // 背景在 layout 阶段按 coopWidth 绘制
    const textLabel = this.createLabel('TextLabel', 16, HUD_WHITE, node);
    const placeholderLabel = this.createLabel('PlaceholderLabel', 16, new Color(150, 150, 150, 255), node);
    const editBox = node.addComponent(EditBox);
    editBox.textLabel = textLabel;
    editBox.placeholderLabel = placeholderLabel;
    editBox.placeholder = this.text('coop.placeholder');
    editBox.maxLength = 8;
    editBox.fontSize = 16;
    return editBox;
  }

  private drawDisc(graphics: Graphics, radius: number, accent: Color): void {
    graphics.clear();
    graphics.fillColor = HUD_DARK;
    this.safeCircle(graphics, 0, 0, radius);
    graphics.fill();
    graphics.strokeColor = accent;
    graphics.lineWidth = 2;
    this.safeCircle(graphics, 0, 0, radius - 2);
    graphics.stroke();
  }

  private drawActionControl(
    graphics: Graphics,
    role: BrowserPointerRole,
    radius: number,
    active: boolean,
  ): void {
    const primary = role === 'primaryFire';
    const boost = role === 'boost';
    const accent = active || primary ? HUD_ACTIVE : HUD_CYAN;
    graphics.clear();
    graphics.fillColor = active
      ? new Color(accent.r, accent.g, accent.b, 92)
      : new Color(3, 13, 20, primary ? 112 : 76);
    this.safeCircle(graphics, 0, 0, radius);
    graphics.fill();
    graphics.strokeColor = accent;
    graphics.lineWidth = primary ? 2.5 : 1.5;
    this.safeCircle(graphics, 0, 0, radius - 2);
    graphics.stroke();
    if (primary) {
      graphics.strokeColor = new Color(255, 224, 170, active ? 255 : 150);
      graphics.lineWidth = 1;
      this.safeCircle(graphics, 0, 0, radius * 0.68);
      graphics.stroke();
      const arm = radius * 0.3;
      graphics.moveTo(-arm, 0);
      graphics.lineTo(arm, 0);
      graphics.moveTo(0, -arm);
      graphics.lineTo(0, arm);
      graphics.stroke();
    } else if (boost) {
      graphics.lineWidth = 3;
      this.safeArc(graphics, 0, 0, radius - 6, -2.7, -0.45, false);
      graphics.stroke();
      graphics.moveTo(-radius * 0.2, -radius * 0.24);
      graphics.lineTo(radius * 0.22, 0);
      graphics.lineTo(-radius * 0.2, radius * 0.24);
      graphics.stroke();
    } else if (role === 'secondaryFire') {
      graphics.moveTo(-radius * 0.28, -radius * 0.18);
      graphics.lineTo(radius * 0.24, 0);
      graphics.lineTo(-radius * 0.28, radius * 0.18);
      graphics.close();
      graphics.stroke();
    } else if (role === 'cameraToggle') {
      this.safeRect(graphics, -radius * 0.25, -radius * 0.16, radius * 0.5, radius * 0.32);
      graphics.stroke();
      this.safeCircle(graphics, 0, 0, radius * 0.1);
      graphics.stroke();
    } else if (role === 'pause') {
      this.safeRect(graphics, -radius * 0.16, -radius * 0.25, radius * 0.1, radius * 0.5);
      this.safeRect(graphics, radius * 0.06, -radius * 0.25, radius * 0.1, radius * 0.5);
      graphics.fill();
    } else if (role === 'returnRequested') {
      this.safeArc(graphics, 0, 0, radius * 0.3, -0.7, Math.PI * 1.6, false);
      graphics.stroke();
      graphics.moveTo(-radius * 0.32, radius * 0.06);
      graphics.lineTo(-radius * 0.38, radius * 0.3);
      graphics.lineTo(-radius * 0.12, radius * 0.24);
      graphics.stroke();
    } else if (role === 'swapWeapons') {
      // 上下双箭头，示意"主副武器互换"
      graphics.moveTo(-radius * 0.26, -radius * 0.04);
      graphics.lineTo(radius * 0.26, -radius * 0.04);
      graphics.moveTo(radius * 0.26, -radius * 0.04);
      graphics.lineTo(radius * 0.08, -radius * 0.26);
      graphics.moveTo(radius * 0.26, -radius * 0.04);
      graphics.lineTo(radius * 0.08, radius * 0.18);
      graphics.stroke();
      graphics.moveTo(-radius * 0.26, radius * 0.04);
      graphics.lineTo(radius * 0.26, radius * 0.04);
      graphics.moveTo(-radius * 0.26, radius * 0.04);
      graphics.lineTo(-radius * 0.08, radius * 0.26);
      graphics.moveTo(-radius * 0.26, radius * 0.04);
      graphics.lineTo(-radius * 0.08, -radius * 0.18);
      graphics.stroke();
    } else if (role === 'deviceAbility') {
      // 战术设备技能：菱形核心 + 四向刻线，与主炮圆形 / 武器互换箭头明显区分。
      graphics.strokeColor = HUD_ACTIVE;
      graphics.lineWidth = 2;
      const edge = radius * 0.42;
      graphics.moveTo(0, -edge);
      graphics.lineTo(edge, 0);
      graphics.lineTo(0, edge);
      graphics.lineTo(-edge, 0);
      graphics.close();
      graphics.stroke();
      this.safeCircle(graphics, 0, 0, radius * 0.12);
      graphics.stroke();
      graphics.moveTo(0, -radius * 0.72);
      graphics.lineTo(0, -radius * 0.56);
      graphics.moveTo(radius * 0.72, 0);
      graphics.lineTo(radius * 0.56, 0);
      graphics.moveTo(0, radius * 0.72);
      graphics.lineTo(0, radius * 0.56);
      graphics.moveTo(-radius * 0.72, 0);
      graphics.lineTo(-radius * 0.56, 0);
      graphics.stroke();
    } else {
      const tick = radius * 0.18;
      graphics.moveTo(-tick, 0);
      graphics.lineTo(tick, 0);
      graphics.stroke();
    }
  }

  private drawStickDeadzone(graphics: Graphics, radius: number): void {
    graphics.clear();
    graphics.fillColor = new Color(3, 13, 20, 88);
    this.safeCircle(graphics, 0, 0, radius);
    graphics.fill();
    graphics.strokeColor = new Color(150, 193, 188, 150);
    graphics.lineWidth = 1;
    this.safeCircle(graphics, 0, 0, radius - 1);
    graphics.stroke();
    graphics.strokeColor = new Color(226, 245, 255, 74);
    this.safeCircle(graphics, 0, 0, Math.max(2, radius * 0.04));
    graphics.stroke();
    graphics.strokeColor = new Color(59, 211, 255, 92);
    graphics.lineWidth = 2;
    this.safeArc(graphics, 0, 0, radius * 0.68, 0.16, 1.38, false);
    this.safeArc(graphics, 0, 0, radius * 0.68, 1.76, 2.98, false);
    this.safeArc(graphics, 0, 0, radius * 0.68, 3.30, 4.52, false);
    this.safeArc(graphics, 0, 0, radius * 0.68, 4.90, 6.12, false);
    graphics.stroke();
    const tickStart = radius * 0.83;
    const tickEnd = radius * 0.94;
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      graphics.moveTo(Math.cos(angle) * tickStart, Math.sin(angle) * tickStart);
      graphics.lineTo(Math.cos(angle) * tickEnd, Math.sin(angle) * tickEnd);
    }
    graphics.stroke();
  }

  private drawStickDirection(snapshot: TouchStickFeedbackSnapshot): void {
    const graphics = this.stickDirection;
    if (!graphics) return;
    graphics.clear();
    if (!snapshot.active || snapshot.threshold === 'center') return;
    const radius = this.touchLayout().movement.radius;
    graphics.strokeColor = new Color(123, 211, 188, 205);
    graphics.lineWidth = snapshot.threshold === 'full' ? 3 : 2;
    this.safeArc(graphics, 0, 0, radius * 0.74, snapshot.angle - 0.34, snapshot.angle + 0.34, false);
    graphics.stroke();
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
        return `${this.text('objective.collect')}  ${mission.progress}/${target}  ${this.text('objective.collectHint')}`;
      case 'hunt':
        return `${this.text('objective.hunt')}  ${mission.progress}/${target}  ${this.text('objective.huntHint')}`;
      case 'defense':
        // 守点：进度 = 守住的秒数，核心被靠近就会掉
        return `${this.text('objective.defense')}  ${Math.round(mission.progress)}/${target}  ${this.text('objective.defenseHint')}`;
      case 'escort':
        // 护送：进度 = 运输船完好度
        return `${this.text('objective.escort')}  ${this.text('objective.escortHp', { value: Math.round(mission.progress) })}  ${this.text('objective.escortHint', { value: Math.round(mission.progress) })}`;
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
