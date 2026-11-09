import {
  assetManager,
  CapsuleCollider,
  Color,
  EAxisDirection,
  instantiate,
  Material,
  MeshRenderer,
  Node,
  Prefab,
  primitives,
  Quat,
  resources,
  RigidBody,
  Sprite,
  SpriteFrame,
  sys,
  Texture2D,
  utils,
  Vec3,
} from 'cc';
import {
  PRIMARY_MUZZLE_LOCAL_POSITION,
  SECONDARY_MUZZLE_LOCAL_POSITION,
  computeMuzzlePosition,
  computeShipPresentationAttitude,
} from '../core/AimConvergence';
import type { CombatSnapshot } from '../core/CombatSimulation';
import type { PlayerShipId } from '../core/ShipCatalog';
import { selectAssetBundles } from '../performance/AssetBundlePolicy';
import type { GraphicsTier } from '../performance/GraphicsProfile';

export type ShipKind = 'interceptor' | 'scout' | 'fighter' | 'bomber' | 'gunship' | 'boss';

interface ModelNormalization {
  readonly lowPath: string;
  readonly highPath: string;
  readonly scale: number;
  readonly orientationX: number;
  readonly orientationY: number;
  readonly colliderRadius: number;
  readonly colliderHeight: number;
}

interface RuntimeAssetBundle {
  load(
    path: string,
    assetType: typeof Prefab,
    callback: (loadError: Error | null, prefab: Prefab) => void,
  ): void;
}

export interface MuzzleTransform {
  readonly worldPosition: Vec3;
  readonly worldRotation: Quat;
}

export const PLAYER_MODEL_PATH = 'models/ships/interceptor';
export const LOW_PLAYER_MODEL_PATH = 'models-low/ships/interceptor';
export const INITIAL_SHIP_KINDS: readonly ShipKind[] = ['interceptor'];
export const MODEL_LOAD_TIMEOUT_MS = 8000;
export const MODEL_LOAD_ATTEMPTS = 2;
/** 引擎尾焰辉光贴图（程序化径向渐变，真 alpha），挂在每艘飞船尾部。 */
export const ENGINE_GLOW_TEXTURE = 'textures/engine-glow/texture';
const PLAYER_VISUAL_BOOT_BUDGET_MS = 1200;
/** 未显式指定 graphics profile 时的敌机渲染上限。 */
const DEFAULT_MAX_VISIBLE_ENEMIES = 24;
/** 机体视觉偏小：只对玩家视觉额外放大；碰撞体半径仍按原值，见 replaceVisual 注释。 */
const COMBAT_VISUAL_SCALE = 1.45;

/** loadModel 结果带画质标记：高模失败回落低模时 quality='low'，不得写进高模缓存。 */
interface LoadedModel {
  readonly prefab: Prefab;
  readonly quality: 'high' | 'low';
}

/** Player hull paint tints, keyed by the loadout skin id. */
export const SKIN_TINTS: Readonly<Record<string, Color>> = {
  // 缺省涂装接近白色：乘色叠加时不会把 GLB 贴图压成灰。
  graphite: new Color(230, 236, 245, 255),
  rescue: new Color(226, 100, 72, 255),
  void: new Color(72, 48, 96, 255),
  hazard: new Color(216, 164, 40, 255),
  azure: new Color(52, 128, 208, 255),
  desert: new Color(196, 148, 88, 255),
};

/**
 * 敌方机体统一暖橙乘色：玩家舰是银白/冷青蓝，敌方偏暖，敌我一眼可分。
 * 用接近白色的暖色做乘色叠加，不会把 GLB 彩色贴图压暗成灰。
 */
const ENEMY_HULL_TINT = new Color(255, 208, 182, 255);
/** 程序化兜底机体颜色：玩家冷蓝青、敌方暖橙红。 */
const FALLBACK_PLAYER_COLOR = new Color(42, 148, 178, 255);
const FALLBACK_ENEMY_COLOR = new Color(226, 92, 52, 255);

/**
 * 战斗侧的敌方 kind → 视觉机型映射。
 * 此前 suppressor / elite / support 三种都不在 MODEL_NORMALIZATION 里，
 * 被 asShipKind 一律回退成 scout —— 结果换了名字但外形完全相同，
 * 敌方阵容读起来像只有一种船。这里显式分流到不同机型。
 */
const ENEMY_KIND_MODEL: Readonly<Record<string, ShipKind>> = {
  suppressor: 'gunship',
  elite: 'fighter',
  support: 'bomber',
};

export const MODEL_NORMALIZATION: Readonly<Record<ShipKind, ModelNormalization>> = {
  interceptor: {
    lowPath: LOW_PLAYER_MODEL_PATH,
    highPath: PLAYER_MODEL_PATH,
    scale: 3.23,
    orientationX: 0,
    orientationY: 90,
    colliderRadius: 0.72,
    colliderHeight: 3.2,
  },
  scout: {
    lowPath: 'models-low/ships/scout',
    highPath: 'models/ships/scout',
    scale: 2.35,
    orientationX: -90,
    orientationY: 0,
    colliderRadius: 0.7,
    colliderHeight: 2.8,
  },
  fighter: {
    lowPath: 'models-low/ships/fighter',
    highPath: 'models/ships/fighter',
    scale: 3.30,
    orientationX: 0,
    orientationY: -90,
    colliderRadius: 0.78,
    colliderHeight: 3.5,
  },
  /**
   * 后三艘为 Hunyuan3D 重做件：源模型是「竖着的平板」（长轴 +Y、厚度 -Z），
   * 必须先绕 X 转 -90 度放平，机头才会落到 -Z；旧的 0.32~0.72 缩放是给
   * 包围盒 10~20 单位的旧基础体用的，新模型包围盒约 1 单位，故统一改到 4~6。
   * 若实机发现机头反向，把对应 orientationY 从 0 改成 180 即可，不要改 X。
   */
  bomber: {
    lowPath: 'models-low/ships/bomber',
    highPath: 'models/ships/bomber',
    scale: 4.2,
    orientationX: -90,
    orientationY: 0,
    colliderRadius: 0.9,
    colliderHeight: 4.1,
  },
  gunship: {
    lowPath: 'models-low/ships/gunship',
    highPath: 'models/ships/gunship',
    scale: 4.8,
    orientationX: -90,
    orientationY: 0,
    colliderRadius: 1.05,
    colliderHeight: 4.8,
  },
  boss: {
    lowPath: 'models-low/ships/boss',
    highPath: 'models/ships/boss',
    scale: 5.6,
    orientationX: -90,
    orientationY: 0,
    colliderRadius: 1.5,
    colliderHeight: 6.2,
  },
};

function asShipKind(kind: string): ShipKind {
  if (Object.prototype.hasOwnProperty.call(MODEL_NORMALIZATION, kind)) {
    return kind as ShipKind;
  }
  return ENEMY_KIND_MODEL[kind] ?? 'scout';
}

let highBundleLoad: Promise<RuntimeAssetBundle> | null = null;

function loadHighBundle(): Promise<RuntimeAssetBundle> {
  if (highBundleLoad) return highBundleLoad;
  highBundleLoad = new Promise((resolve, reject) => {
    assetManager.loadBundle('spacefight-high', (
      loadError: Error | null,
      bundle: RuntimeAssetBundle,
    ) => {
      if (loadError || !bundle) {
        highBundleLoad = null;
        reject(new Error('Optional high-quality ship bundle could not be loaded'));
        return;
      }
      resolve(bundle);
    });
  });
  return highBundleLoad;
}

function loadPrefab(bundle: RuntimeAssetBundle, path: string): Promise<Prefab> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Required ship model timed out: ${path}`));
    }, MODEL_LOAD_TIMEOUT_MS);
    bundle.load(path, Prefab, (loadError: Error | null, prefab: Prefab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (loadError || !prefab) {
        reject(new Error(`Required ship model could not be loaded: ${path}`));
        return;
      }
      resolve(prefab);
    });
  });
}

async function retryModelLoad<T>(load: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MODEL_LOAD_ATTEMPTS; attempt += 1) {
    try {
      return await load();
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Required ship model load failed');
}

function candidatePaths(path: string, highQuality: boolean): readonly string[] {
  const candidates: string[] = [path];
  // Some asset trees mirror the ship kind as a nested folder (e.g. ships/scout/scout).
  const separator = path.lastIndexOf('/');
  const directory = separator >= 0 ? path.slice(0, separator) : '';
  const basename = separator >= 0 ? path.slice(separator + 1) : path;
  if (directory && directory !== basename) candidates.push(`${path}/${basename}`);
  // Highest-end bundles occasionally suffix higher-poly variants (e.g. scout 3).
  // 旧写法用 bundle 名做条件判断，但传入路径从不带 bundle 名，条件恒真 →
  // 低画质也白跑一次必然失败的请求。改为按画质档显式传入。
  if (highQuality) candidates.push(`${path} 3`);
  return candidates;
}

/** 敌机到玩家的平方距离，用于渲染预算的远近排序（免开方）。 */
function enemyDistanceSq(
  enemy: { position: { x: number; y: number; z: number } },
  player: { x: number; y: number; z: number },
): number {
  const dx = enemy.position.x - player.x;
  const dy = enemy.position.y - player.y;
  const dz = enemy.position.z - player.z;
  return dx * dx + dy * dy + dz * dz;
}

async function loadModel(graphicsTier: GraphicsTier, model: ModelNormalization): Promise<LoadedModel> {
  const highQuality = selectAssetBundles(graphicsTier).includes('spacefight-high');
  const paths = highQuality
    ? candidatePaths(model.highPath, true)
    : candidatePaths(model.lowPath, false);
  const bundle = highQuality ? await loadHighBundle() : resources;
  let lastError: unknown;
  for (const path of paths) {
    try {
      const prefab = await loadPrefab(bundle, path);
      return { prefab, quality: highQuality ? 'high' : 'low' };
    } catch (error) {
      lastError = error;
    }
  }
  // Final fallback: if high quality was requested, retry once against the low bundle.
  if (highQuality) {
    // 高模加载失败会静默退回低模（普通建模）——用户能看到「真实建模卡退成普通建模」却不知道原因。
    // 这里必须把原因打出来，方便真机排查是「包缺失 / 内存不足 / prefab 损坏」。
    console.warn(`[SpaceFight] high-quality ship model failed, falling back to LOW model: ${model.highPath}`, lastError);
    try {
      // 回退结果必须标记 quality='low'：低模只写 prefabs，绝不写 highPrefabs。
      return { prefab: await loadPrefab(resources, model.lowPath), quality: 'low' };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Ship model could not be loaded: ${model.highPath}`);
}

export class ShipPresenter {
  private readonly enemyNodes = new Map<string, Node>();
  private readonly pendingEnemies = new Map<string, Promise<void>>();
  private readonly visibleEnemyIds = new Set<string>();
  // 诊断用：记录「在可见集合内却迟迟没建成节点」的敌机连续帧数，超过阈值记一次告警，
  // 用于真机排查「敌机不显」（静默模型加载失败等）。
  private readonly missingEnemyStreak = new Map<string, number>();
  private readonly missingEnemyWarned = new Set<string>();
  private readonly prefabs = new Map<ShipKind, Prefab>();
  private readonly prefabLoads = new Map<ShipKind, Promise<LoadedModel>>();
  private readonly highPrefabs = new Map<ShipKind, Prefab>();
  private readonly highPrefabLoads = new Map<ShipKind, Promise<LoadedModel>>();
  private readonly shipKinds = new Map<Node, ShipKind>();
  private readonly shipVisuals = new Map<Node, Node>();
  private playerNode: Node | null = null;
  private playerVisual: Node | null = null;
  /** fallback 机体只尝试补建一次，避免原生端创建失败时每帧重复尝试刷警告。 */
  private fallbackVisualAttempted = false;
  /** 当前玩家机型；由装配台的 ship 槽位驱动，缺省仍是基线截击机。 */
  private playerShipKind: ShipKind = 'interceptor';
  private primaryMuzzle: Node | null = null;
  private secondaryMuzzle: Node | null = null;

  /**
   * 模型自带的枪口挂点（从 GLB 的 socket_* 节点读出）。
   *
   * 此前枪口是**硬编码**的固定局部坐标（PRIMARY_MUZZLE_LOCAL_POSITION），
   * 跟模型完全脱钩：换一艘外形不同的船，子弹仍然从老位置射出，
   * 会出现「子弹从机翼后面冒出来 / 从机身中间射出」。
   * 现在优先用模型作者提供的 socket_weapon_primary_l / _r，
   * 读不到才回退到硬编码位置（低模旧船没有 socket 时）。
   */
  private readonly modelMuzzleSockets = new Map<Node, { primary: Vec3 | null; secondary: Vec3 | null }>();

  private highQualityEnabled = false;
  /** 当前玩家涂装：replaceVisual 换模后据此重放（applyPlayerSkin 启动只调一次）。 */
  private currentSkin: string | undefined;
  /** 玩家视觉加载请求序号：只接受最新机型请求，丢弃过期结果。 */
  private playerVisualRequestSeq = 0;
  /** sync 复用缓冲：敌机速度方向 / 基准前向 / 朝向四元数，避免每帧分配。 */
  private readonly enemyVelocity = new Vec3();
  private readonly enemyForward = new Vec3(0, 0, -1);
  private readonly enemyRotation = new Quat();

  /** 引擎尾焰辉光节点：root -> 尾部 Sprite（每艘飞船一份，常驻）。 */
  private readonly shipGlows = new Map<Node, Node>();
  private engineGlowFrame: SpriteFrame | null = null;
  private cameraNode: Node | null = null;

  public constructor(
    private readonly parent: Node,
    /** 同时渲染的敌机上限，来自 graphics profile；超出的按距离淘汰。 */
    private readonly maxVisibleEnemies: number = DEFAULT_MAX_VISIBLE_ENEMIES,
  ) {}

  public initialize(): Node {
    this.playerNode = this.createShipShell('PlayerShip', this.playerShipKind, true);
    // Avoid procedural mesh allocation before the first native frame. Some
    // Android GPU drivers can abort during that early allocation.
    if (!sys.isNative) this.createFallbackVisual(this.playerNode);
    this.primaryMuzzle = this.createMuzzle(
      'Muzzle.Primary',
      new Vec3(
        PRIMARY_MUZZLE_LOCAL_POSITION.x,
        PRIMARY_MUZZLE_LOCAL_POSITION.y,
        PRIMARY_MUZZLE_LOCAL_POSITION.z,
      ),
    );
    this.secondaryMuzzle = this.createMuzzle(
      'Muzzle.Secondary',
      new Vec3(
        SECONDARY_MUZZLE_LOCAL_POSITION.x,
        SECONDARY_MUZZLE_LOCAL_POSITION.y,
        SECONDARY_MUZZLE_LOCAL_POSITION.z,
      ),
    );
    this.loadEngineGlow();
    return this.playerNode;
  }

  /** 提供相机节点，使尾焰公告板每帧朝向相机（否则永远正面拍扁)。 */
  public setCamera(node: Node): void {
    this.cameraNode = node;
  }

  /**
   * 切换玩家机型。装配台提交后调用；机型名与 GLB 目录同名，
   * 因此无需额外的映射表。旧存档没有 ship 字段时会回退到 interceptor。
   */
  public setPlayerShipKind(kind: PlayerShipId): void {
    if (!Object.prototype.hasOwnProperty.call(MODEL_NORMALIZATION, kind)) return;
    if (this.playerShipKind === kind) return;
    this.playerShipKind = kind;
    if (this.playerNode?.isValid) {
      this.shipKinds.set(this.playerNode, kind);
      void this.loadPlayerVisual().catch(() => undefined);
    }
  }

  public async loadPlayerVisual(): Promise<void> {
    const seq = ++this.playerVisualRequestSeq;
    const requestedHighQuality = this.highQualityEnabled;
    const kind = this.playerShipKind;
    const loaded = await retryModelLoad(() => (
      requestedHighQuality
        ? this.ensureHighPrefab(kind)
        : this.ensurePrefab(kind)
    ));
    // 连续换机型时丢弃过期结果：序号非最新 / 机型已变 / 画质档升为高都不再覆盖。
    if (seq !== this.playerVisualRequestSeq) return;
    if (kind !== this.playerShipKind) return;
    if (!this.playerNode?.isValid || (this.highQualityEnabled && !requestedHighQuality)) return;
    this.replaceVisual(this.playerNode, kind, loaded.prefab);
  }

  /**
   * 玩家模型始终加载不出时（设备侧 GLB 解析失败 / 超时 / 被 iCloud 驱逐后回读失败等），
   * 补一个低模 fallback 机体，使 isPlayerVisualReady() 能变 true，避免战斗被永久冻结。
   * 必须在首帧之后调用：原生端首帧前建运行时网格会让部分 Android GPU 驱动崩溃，
   * 因此调用方只在宽限期到期（早已过首帧）时才用它兜底。
   */
  public ensureFallbackVisual(): void {
    if (this.playerVisual?.isValid) return;
    if (this.fallbackVisualAttempted) return;
    if (!this.playerNode?.isValid) return;
    this.fallbackVisualAttempted = true;
    // 原生端运行时网格可能建不出来：再兜一层，确保兜底路径不向外抛错、不阻塞战斗。
    try {
      this.createFallbackVisual(this.playerNode);
    } catch (error: unknown) {
      console.warn('[SpaceFight ships] fallback hull path failed', error);
    }
  }

  /**
   * 确保玩家战机已挂上可见模型。返回当前视觉模式，
   * 'model' 表示挂载了 GLB 模型，'fallback' 表示模型不可用时保留 shell。
   */
  public async ensurePlayerVisual(): Promise<'model' | 'fallback'> {
    if (!this.playerNode?.isValid) {
      throw new Error('Player shell is unavailable');
    }
    const visualLoad = this.loadPlayerVisual();
    const bootBudget = new Promise<'fallback'>((resolve) => {
      setTimeout(() => resolve('fallback'), PLAYER_VISUAL_BOOT_BUDGET_MS);
    });
    try {
      const result = await Promise.race([
        visualLoad.then((): 'model' | 'fallback' => (
          this.playerVisual?.isValid ? 'model' : 'fallback'
        )),
        bootBudget,
      ]);
      if (result === 'fallback') {
        console.warn('[SpaceFight ships] player model is still loading; starting combat with fallback hull');
      }
      return result;
    } catch (error: unknown) {
      console.warn('[SpaceFight ships] player model unavailable; retaining fallback hull', error);
      return 'fallback';
    }
  }

  public async loadInitialEnemyVisuals(snapshot: CombatSnapshot): Promise<void> {
    await Promise.all(snapshot.enemies.map((enemy) => retryModelLoad(() => (
      this.requestEnemyVisual(enemy.id, asShipKind(enemy.kind), enemy.position)
    ))));
    if (!this.isCombatVisualReady(snapshot, false)) {
      throw new Error('Required initial enemy visuals are unavailable');
    }
  }

  public isCombatVisualReady(snapshot: CombatSnapshot, requirePlayer = true): boolean {
    if (requirePlayer && !this.playerVisual?.isValid) return false;
    return snapshot.enemies.every((enemy) => this.enemyNodes.get(enemy.id)?.isValid === true);
  }

  public sync(snapshot: CombatSnapshot): void {
    if (!this.playerNode) {
      return;
    }

    const player = snapshot.player;
    this.playerNode.setPosition(player.position.x, player.position.y, player.position.z);
    const attitude = computeShipPresentationAttitude(player);
    this.playerNode.setRotationFromEuler(
      attitude.pitch * 180 / Math.PI,
      -attitude.yaw * 180 / Math.PI,
      0,
    );
    this.playerVisual?.setRotationFromEuler(
      0,
      MODEL_NORMALIZATION[this.playerShipKind].orientationY,
      attitude.roll * 180 / Math.PI,
    );
    this.syncMuzzle(
      this.primaryMuzzle,
      player,
      attitude,
      PRIMARY_MUZZLE_LOCAL_POSITION,
      snapshot.aimPoint,
      'primary',
    );
    this.syncMuzzle(
      this.secondaryMuzzle,
      player,
      attitude,
      SECONDARY_MUZZLE_LOCAL_POSITION,
      snapshot.aimPoint,
      'secondary',
    );

    // 超出渲染预算的敌机优先被裁掉：按与玩家的距离从近到远保留，
    // 这样低配机在密集波次下也不会因为节点过多而掉帧。
    const enemies = snapshot.enemies;
    const budget = Math.max(1, this.maxVisibleEnemies);
    let renderable = enemies;
    if (enemies.length > budget) {
      const playerPosition = snapshot.player.position;
      renderable = [...enemies]
        .sort((a, b) => enemyDistanceSq(a, playerPosition) - enemyDistanceSq(b, playerPosition))
        .slice(0, budget);
    }

    this.visibleEnemyIds.clear();
    for (const enemy of renderable) {
      this.visibleEnemyIds.add(enemy.id);
      const enemyNode = this.enemyNodes.get(enemy.id);
      if (enemyNode) {
        enemyNode.setPosition(enemy.position.x, enemy.position.y, enemy.position.z);
        // 用速度方向设置敌机朝向，避免侧飞/倒飞；速度近零时不改朝向（保持上一帧）。
        this.enemyVelocity.set(enemy.velocity.x, enemy.velocity.y, enemy.velocity.z);
        if (this.enemyVelocity.lengthSqr() > 0.0001) {
          this.enemyVelocity.normalize();
          Quat.rotationTo(this.enemyRotation, this.enemyForward, this.enemyVelocity);
          enemyNode.setRotation(this.enemyRotation);
        }
      } else {
        void this.requestEnemyVisual(
          enemy.id,
          asShipKind(enemy.kind),
          enemy.position,
        ).catch((error: unknown) => {
          console.error(`SpaceFight enemy spawn failed: ${enemy.id} (${enemy.kind})`, error);
        });
      }
    }

    for (const [enemyId, enemyNode] of this.enemyNodes) {
      if (!this.visibleEnemyIds.has(enemyId)) {
        enemyNode.destroy();
        this.enemyNodes.delete(enemyId);
        this.shipKinds.delete(enemyNode);
        this.shipVisuals.delete(enemyNode);
        this.shipGlows.delete(enemyNode);
        // 无限波次下这些 Map 会一直留住已销毁节点/失效 id，
        // 长时间作战后表现为常驻内存增长与诊断状态残留。
        this.modelMuzzleSockets.delete(enemyNode);
        this.pendingEnemies.delete(enemyId);
        this.missingEnemyStreak.delete(enemyId);
        this.missingEnemyWarned.delete(enemyId);
      }
    }

    // 诊断：renderable 敌机既无有效节点也无在途模型请求、连续 ≥90 帧（约 1.5s）仍未渲染，
    // 即判为「静默加载失败」——这正是「敌机不显」的真机根因候选，记一次告警便于排查。
    for (const enemy of renderable) {
      const hasNode = this.enemyNodes.get(enemy.id)?.isValid === true;
      const hasPending = this.pendingEnemies.has(enemy.id);
      if (hasNode || hasPending) {
        this.missingEnemyStreak.delete(enemy.id);
        this.missingEnemyWarned.delete(enemy.id);
        continue;
      }
      const streak = (this.missingEnemyStreak.get(enemy.id) ?? 0) + 1;
      this.missingEnemyStreak.set(enemy.id, streak);
      if (streak >= 90 && !this.missingEnemyWarned.has(enemy.id)) {
        this.missingEnemyWarned.add(enemy.id);
        console.warn(
          `SpaceFight enemy "${enemy.id}" (${enemy.kind}) not rendered after ${streak} frames ` +
          `and no pending model request — possible silent prefab load failure.`,
        );
      }
    }

    this.faceEngineGlows();
  }

  /** 让所有尾焰公告板朝向相机，否则它们会永远以正面拍扁、毫无体积感。 */
  private faceEngineGlows(): void {
    const camera = this.cameraNode;
    if (!camera) return;
    const rotation = camera.worldRotation;
    for (const glow of this.shipGlows.values()) {
      if (glow.isValid) glow.setWorldRotation(rotation);
    }
  }

  public get player(): Node {
    if (!this.playerNode) {
      throw new Error('Required player model has not finished loading');
    }
    return this.playerNode;
  }

  /**
   * 玩家机体是否已挂上可见视觉。
   *
   * `initialize()` 只建 shell，GLB 模型是异步加载的；模型没到位前
   * `update()` 必须只做 sync 而不能推进战斗，否则会出现"开局瞬间被击落"。
   */
  public isPlayerVisualReady(): boolean {
    return this.playerVisual?.isValid === true;
  }

  /**
   * 驾驶舱视角下摄像机的世界坐标。
   *
   * 挂在玩家节点下，因此直接用世界坐标即可跟随姿态；
   * `initialize()` 还没跑完时退回原点，避免调用方拿到 null。
   */
  public get cockpitWorldPosition(): Vec3 {
    const worldPosition = new Vec3();
    if (!this.playerNode?.isValid) {
      return worldPosition;
    }
    this.playerNode.getWorldPosition(worldPosition);
    return worldPosition;
  }

  /** 驾驶舱视角下隐藏玩家机体，避免相机进入模型内部穿模。 */
  public setCockpitMode(active: boolean): void {
    const visual = this.playerVisual;
    if (visual?.isValid) visual.active = !active;
  }

  public get primaryMuzzleTransform(): MuzzleTransform {
    return this.readMuzzle(this.primaryMuzzle, 'primary');
  }

  public get secondaryMuzzleTransform(): MuzzleTransform {
    return this.readMuzzle(this.secondaryMuzzle, 'secondary');
  }

  public async enableHighQuality(graphicsTier: GraphicsTier): Promise<void> {
    if (!selectAssetBundles(graphicsTier).includes('spacefight-high')) return;
    const kinds = [...new Set(this.shipKinds.values())].filter(
      (kind): kind is ShipKind => Boolean(MODEL_NORMALIZATION[kind]),
    );
    const loaded = await Promise.all(kinds.map(async (kind) => {
      const model = await this.ensureHighPrefab(kind);
      return [kind, model] as const;
    }));
    // 任一机型高模不可用（回退成低模）：复位 flag 并保留现状，绝不把全场换成低模。
    if (loaded.some(([, model]) => model.quality !== 'high')) {
      this.highQualityEnabled = false;
      this.highPrefabs.clear();
      return;
    }
    // 全部 high prefab 就绪后才翻转 flag，避免窗口期内 createShipNode 读到空缓存。
    this.highQualityEnabled = true;
    const byKind = new Map<ShipKind, Prefab>(
      loaded.map(([kind, model]): [ShipKind, Prefab] => [kind, model.prefab]),
    );
    for (const [root, kind] of this.shipKinds) {
      const prefab = byKind.get(kind);
      if (root.isValid && prefab) this.replaceVisual(root, kind, prefab);
    }
  }

  /**
   * 降画质档时复位高画质状态：清空高模缓存、把已挂高模的机体换回低模，
   * 恢复低模渲染预算。供 CombatBootstrap.applyGraphicsTier 调用。
   */
  public disableHighQuality(): void {
    this.highQualityEnabled = false;
    this.highPrefabs.clear();
    this.highPrefabLoads.clear();
    for (const [root, kind] of this.shipKinds) {
      const low = this.prefabs.get(kind);
      if (root.isValid && low) this.replaceVisual(root, kind, low);
    }
  }

  private createShipNode(
    name: string,
    kind: ShipKind,
    isPlayer: boolean,
    resolvedPrefab?: Prefab | null,
  ): Node {
    // 高画质 flag 翻转前 highPrefabs 可能尚未填好：缺失时回退到 prefabs 低模。
    const prefab = resolvedPrefab !== undefined
      ? resolvedPrefab
      : (this.highQualityEnabled
        ? (this.highPrefabs.get(kind) ?? this.prefabs.get(kind))
        : this.prefabs.get(kind));

    const root = this.createShipShell(name, kind, isPlayer);
    // 模型缺失绝不能让机体「静默消失」：挂一个程序化低模轮廓继续渲染。
    // 此前这里直接 throw，敌机 prefab 一失败就整艘不存在 —— 正是「敌方战舰不可见」的根因。
    if (prefab) {
      const visual = this.replaceVisual(root, kind, prefab);
      if (isPlayer) this.playerVisual = visual;
    } else {
      this.createFallbackVisual(root, isPlayer);
    }

    return root;
  }

  private createShipShell(name: string, kind: ShipKind, isPlayer: boolean): Node {
    const normalization = MODEL_NORMALIZATION[kind];
    const root = new Node(name);
    root.setParent(this.parent);
    this.shipKinds.set(root, kind);

    const collider = root.addComponent(CapsuleCollider);
    collider.direction = EAxisDirection.Z_AXIS;
    collider.radius = normalization.colliderRadius;
    collider.cylinderHeight = normalization.colliderHeight;
    collider.isTrigger = !isPlayer;

    const body = root.addComponent(RigidBody);
    body.type = RigidBody.Type.KINEMATIC;
    body.useGravity = false;
    body.allowSleep = false;

    this.createEngineGlow(root, normalization, isPlayer);
    return root;
  }

  /**
   * 尾部引擎辉光：挂在 root 下的常驻 Sprite 公告板。
   * 机头朝局部 -Z（见 AimConvergence 的 PRIMARY_MUZZLE_LOCAL_POSITION），
   * 因此尾部在局部 +Z；辉光自然落在机身后方，与推进方向一致。
   * 贴图缺失时静默降级（不创建节点），绝不阻塞战斗。
   */
  private createEngineGlow(root: Node, normalization: ModelNormalization, isPlayer: boolean): void {
    const glow = new Node(`${root.name}.EngineGlow`);
    glow.setParent(root);
    // 落在机身后端略偏后，避免与前向几何体重叠。
    glow.setPosition(0, -0.02, normalization.colliderHeight * 0.55);
    const diameter = normalization.colliderRadius * 2.4;
    glow.setScale(diameter, diameter, 1);
    const sprite = glow.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.width = 128;
    sprite.height = 128;
    // 玩家冷蓝青、敌方暖橙红；贴图是白心径向渐变，乘色即上色。
    sprite.color = isPlayer ? new Color(120, 200, 255, 255) : new Color(255, 140, 60, 255);
    if (this.engineGlowFrame) sprite.spriteFrame = this.engineGlowFrame;
    this.shipGlows.set(root, glow);
  }

  private loadEngineGlow(): void {
    if (this.engineGlowFrame) return;
    resources.load(ENGINE_GLOW_TEXTURE, Texture2D, (error: Error | null, texture?: Texture2D) => {
      if (error || !texture) {
        // 缺失则降级：保留无辉光的飞船，不抛错、不阻塞。
        return;
      }
      const frame = new SpriteFrame();
      frame.texture = texture;
      this.engineGlowFrame = frame;
      // 给所有已创建的辉光节点补上贴图（含玩家与先到的敌机）。
      for (const glow of this.shipGlows.values()) {
        const sprite = glow.getComponent(Sprite);
        if (sprite) sprite.spriteFrame = frame;
      }
    });
  }

  private createFallbackVisual(
    root: Node,
    isPlayer = true,
    kind: ShipKind = this.playerShipKind,
  ): void {
    try {
      const visual = new Node(`${root.name}.FallbackHull`);
      visual.setParent(root);
      const normalization = MODEL_NORMALIZATION[kind];
      const color = isPlayer ? FALLBACK_PLAYER_COLOR : FALLBACK_ENEMY_COLOR;
      const material = new Material();
      material.initialize({ effectName: 'builtin-standard' });
      material.setProperty('mainColor', color);

      const length = normalization.colliderHeight;
      const width = normalization.colliderRadius * 1.8;
      // 机身 + 两侧后掠翼：远处也能读出「这是一艘舰」而不是方块。
      // 机头朝局部 -Z（与 GLB 约定一致），尾焰挂点仍在 +Z。
      const parts: ReadonlyArray<{
        name: string;
        size: readonly [number, number, number];
        pos: readonly [number, number, number];
      }> = [
        { name: 'Hull', size: [width * 0.34, width * 0.20, length], pos: [0, 0, 0] },
        { name: 'WingL', size: [width * 0.90, width * 0.08, length * 0.42], pos: [-width * 0.55, 0, length * 0.16] },
        { name: 'WingR', size: [width * 0.90, width * 0.08, length * 0.42], pos: [width * 0.55, 0, length * 0.16] },
      ];
      for (const part of parts) {
        const partNode = new Node(`${root.name}.${part.name}`);
        partNode.setParent(visual);
        partNode.setPosition(part.pos[0], part.pos[1], part.pos[2]);
        const renderer = partNode.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.box({
          width: part.size[0],
          height: part.size[1],
          length: part.size[2],
        }));
        renderer.setMaterial(material, 0);
      }
      this.shipVisuals.set(root, visual);
      if (root === this.playerNode) this.playerVisual = visual;
    } catch (error: unknown) {
      // Some native renderers cannot create runtime meshes before the first frame.
      console.warn('[SpaceFight ships] fallback hull unavailable; continuing without visual', error);
      if (root === this.playerNode) this.playerVisual = null;
    }
  }

  private ensurePrefab(kind: ShipKind): Promise<LoadedModel> {
    if (this.highQualityEnabled) return this.ensureHighPrefab(kind);
    const cached = this.prefabs.get(kind);
    if (cached) {
      const result: LoadedModel = { prefab: cached, quality: 'low' };
      return Promise.resolve(result);
    }
    const pending = this.prefabLoads.get(kind);
    if (pending) return pending;
    const request = loadModel('low', MODEL_NORMALIZATION[kind]).then(
      (result) => {
        this.prefabs.set(kind, result.prefab);
        this.prefabLoads.delete(kind);
        return result;
      },
      (error: unknown) => {
        this.prefabLoads.delete(kind);
        throw error;
      },
    );
    this.prefabLoads.set(kind, request);
    return request;
  }

  private ensureHighPrefab(kind: ShipKind): Promise<LoadedModel> {
    const model = MODEL_NORMALIZATION[kind];
    if (!model) return Promise.reject(new Error(`Unknown ship model kind: ${String(kind)}`));
    const cached = this.highPrefabs.get(kind);
    if (cached) {
      const result: LoadedModel = { prefab: cached, quality: 'high' };
      return Promise.resolve(result);
    }
    const pending = this.highPrefabLoads.get(kind);
    if (pending) return pending;
    const request = loadModel('high', model).then(
      (result) => {
        // 高模失败回落的低模只写 prefabs，不写 highPrefabs，并复位高画质 flag。
        if (result.quality === 'high') {
          this.highPrefabs.set(kind, result.prefab);
        } else {
          this.prefabs.set(kind, result.prefab);
          this.highQualityEnabled = false;
          this.highPrefabs.clear();
        }
        this.highPrefabLoads.delete(kind);
        return result;
      },
      (error: unknown) => {
        this.highPrefabLoads.delete(kind);
        throw error;
      },
    );
    this.highPrefabLoads.set(kind, request);
    return request;
  }

  /**
   * 递归查找模型节点树里的指定名字节点（GLB 导入后的 socket 节点）。
   */
  private findDescendant(root: Node | null, name: string): Node | null {
    if (!root || !root.isValid) return null;
    if (root.name === name) return root;
    for (const child of root.children) {
      const found = this.findDescendant(child, name);
      if (found) return found;
    }
    return null;
  }

  /**
   * 从模型里读出主/副武器挂点。
   *
   * 主炮取左右两个 socket 的中点，副炮复用同一组（模型只提供武器挂点，
   * 副武器挂在同一片翼面是合理的近似）。读不到返回 null → 回退硬编码枪口。
   */
  private readModelMuzzleSockets(visual: Node): { primary: Vec3 | null; secondary: Vec3 | null } {
    const left = this.findDescendant(visual, 'socket_weapon_primary_l');
    const right = this.findDescendant(visual, 'socket_weapon_primary_r');
    if (!left && !right) return { primary: null, secondary: null };
    const positions = [left, right]
      .filter((node): node is Node => Boolean(node))
      .map((node) => node.position.clone());
    if (!positions.length) return { primary: null, secondary: null };
    const average = positions.reduce((sum, value) => sum.add(value), new Vec3());
    average.multiplyScalar(1 / positions.length);
    // 枪口略微前推，避免子弹从机体内冒出
    const forward = average.z > 0 ? average.z + 0.2 : average.z - 0.2;
    return {
      primary: new Vec3(average.x, average.y, forward),
      secondary: average.clone(),
    };
  }

  private replaceVisual(root: Node, kind: ShipKind, prefab: Prefab): Node {
    const previous = this.shipVisuals.get(root);
    previous?.destroy();
    const normalization = MODEL_NORMALIZATION[kind];
    const visual = instantiate(prefab);
    visual.name = `${root.name}.Model`;
    visual.setParent(root);
    // 机体偏小：仅对玩家视觉额外放大。碰撞体半径仍用 colliderRadius 原值（物理不变）；
    // 尾焰 glow 尺寸基于 colliderRadius 属于独立视觉表现，也不随此系数缩放。
    const visualScale = root === this.playerNode
      ? normalization.scale * COMBAT_VISUAL_SCALE
      : normalization.scale;
    visual.setScale(visualScale, visualScale, visualScale);
    const modelRotation = new Quat();
    Quat.fromEuler(modelRotation, normalization.orientationX, normalization.orientationY, 0);
    visual.setRotation(modelRotation);
    this.shipVisuals.set(root, visual);
    if (root === this.playerNode) this.playerVisual = visual;
    // 敌方机体统一暖橙乘色：银白/暗色 GLB 也能一眼和玩家冷色舰队分开。
    // 只对非玩家节点生效，玩家的皮肤仍由 replayPlayerSkin() 独占。
    if (root !== this.playerNode) this.applyTint(visual, ENEMY_HULL_TINT);
    // 从模型节点树里读出作者提供的枪口挂点（socket_weapon_primary_l / _r 等）。
    // 没有 socket 的旧低模会返回 null，syncMuzzle 随后回退到硬编码枪口位置。
    this.modelMuzzleSockets.set(root, this.readModelMuzzleSockets(visual));
    // 换模后统一重放涂装：applyPlayerSkin 只在启动调一次，覆盖 playerNode 与其它 root 路径。
    this.replayPlayerSkin();
    return visual;
  }

  /**
   * 玩家涂装：在原 PBR 材质实例上以 mainColor 乘色叠加，保留 albedo/normal/metallic 贴图。
   * 不再用 unlit 材质整体替换（旧写法丢贴图、把机体压成纯灰，且只作用于第 0 个 submesh）。
   */
  public applyPlayerSkin(skin?: string): void {
    this.currentSkin = skin;
    this.replayPlayerSkin();
  }

  /** 重放涂装：遍历所有已挂载视觉（含 playerNode 与其它 root），只对玩家节点上色。 */
  private replayPlayerSkin(): void {
    if (this.currentSkin === undefined) return;
    const tint = SKIN_TINTS[this.currentSkin] ?? SKIN_TINTS.graphite;
    for (const [root, visual] of this.shipVisuals) {
      if (root !== this.playerNode || !visual.isValid) continue;
      this.applyTint(visual, tint);
    }
  }

  private applyTint(visual: Node, tint: Color): void {
    for (const renderer of visual.getComponentsInChildren(MeshRenderer)) {
      // 逐 submesh 取原材质实例：保留贴图，仅改乘色；没有 mainColor 的材质跳过，不替换。
      const materials = renderer.sharedMaterials;
      for (let index = 0; index < materials.length; index += 1) {
        const instance = renderer.getMaterialInstance(index);
        if (!instance || instance.getProperty('mainColor') == null) continue;
        instance.setProperty('mainColor', tint);
      }
    }
  }

  private createMuzzle(name: string, position: Vec3): Node {
    const muzzle = new Node(name);
    muzzle.setParent(this.player);
    muzzle.setPosition(position);
    return muzzle;
  }

  private readMuzzle(muzzle: Node | null, label: string): MuzzleTransform {
    if (!muzzle) {
      throw new Error(`Required ${label} model muzzle is unavailable`);
    }
    return {
      worldPosition: muzzle.worldPosition.clone(),
      worldRotation: muzzle.worldRotation.clone(),
    };
  }

  private syncMuzzle(
    muzzle: Node | null,
    player: CombatSnapshot['player'],
    hull: { readonly yaw: number; readonly pitch: number },
    localPosition: typeof PRIMARY_MUZZLE_LOCAL_POSITION,
    convergencePoint: CombatSnapshot['aimPoint'],
    socketSlot?: 'primary' | 'secondary',
  ): void {
    if (!muzzle) return;
    // 优先用模型自带的枪口挂点；没有 socket 的旧模型回退到硬编码位置。
    const sockets = this.playerNode ? this.modelMuzzleSockets.get(this.playerNode) : undefined;
    const socketPosition = socketSlot === 'secondary' ? sockets?.secondary : sockets?.primary;
    const effectivePosition = socketPosition ?? localPosition;
    const position = computeMuzzlePosition(player.position, hull, effectivePosition);
    muzzle.setWorldPosition(new Vec3(position.x, position.y, position.z));
    muzzle.lookAt(new Vec3(
      convergencePoint.x,
      convergencePoint.y,
      convergencePoint.z,
    ));
  }

  private requestEnemyVisual(
    enemyId: string,
    kind: ShipKind,
    position: { x: number; y: number; z: number },
  ): Promise<void> {
    if (this.enemyNodes.get(enemyId)?.isValid) return Promise.resolve();
    const pending = this.pendingEnemies.get(enemyId);
    if (pending) return pending;
    const request = this.spawnEnemy(enemyId, kind, position).finally(() => {
      if (this.pendingEnemies.get(enemyId) === request) {
        this.pendingEnemies.delete(enemyId);
      }
    });
    this.pendingEnemies.set(enemyId, request);
    return request;
  }

  private async spawnEnemy(
    enemyId: string,
    kind: ShipKind,
    position: { x: number; y: number; z: number },
  ): Promise<void> {
    // 宽松守卫：首帧 sync 之前 visibleEnemyIds 为空（初始预加载阶段），此时应允许
    // 创建全部敌机节点做预取；首帧 sync 之后集合已按渲染预算（maxVisibleEnemies）填充，
    // 才据此裁掉超出的敌机。原先「集合为空也直接 return」会让 loadInitialEnemyVisuals
    // 形同虚设，敌机节点全靠首帧 sync 补建——一旦首帧被拖慢/打断即永久不显。
    if (this.visibleEnemyIds.size > 0 && !this.visibleEnemyIds.has(enemyId)) return;
    // 模型加载失败不再等于「敌机不存在」：拿不到 prefab 时仍创建节点，
    // 由 createShipNode 挂上程序化低模轮廓，保证战斗里敌方始终可见、可打、可被瞄准。
    let prefab: Prefab | null = null;
    try {
      prefab = (await this.ensurePrefab(kind)).prefab;
    } catch (error: unknown) {
      console.warn(
        `[SpaceFight ships] model "${kind}" unavailable for ${enemyId}; rendering fallback hull`,
        error,
      );
    }
    if (this.visibleEnemyIds.size > 0 && !this.visibleEnemyIds.has(enemyId)) return;
    if (this.enemyNodes.get(enemyId)?.isValid) return;
    const enemyNode = this.createShipNode(`Enemy.${enemyId}`, kind, false, prefab);
    enemyNode.setPosition(position.x, position.y, position.z);
    this.enemyNodes.set(enemyId, enemyNode);
  }
}
