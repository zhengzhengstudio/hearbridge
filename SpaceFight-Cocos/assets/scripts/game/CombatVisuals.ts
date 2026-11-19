import {
  Color,
  Material,
  MeshRenderer,
  Node,
  NodePool,
  primitives,
  Quat,
  resources,
  Texture2D,
  tween,
  utils,
  Vec3,
} from 'cc';
import * as cc from 'cc';
import type { CombatEvent, CombatSnapshot } from '../core/CombatSimulation';

/** Cocos 3.8 的 Tween 类：经命名空间取用，兼容未列出该导出的精简 cc 声明。 */
const Tween: { stopAllByTarget(target?: object): void } | undefined = (cc as any).Tween;

/**
 * 战斗视觉层（2026-10-23 新增）。
 *
 * 之前战斗里**一张贴图都没有**：
 *   - 背景是相机清屏纯色 + 线性雾（skybox 关着）→ 飞出去就是一片死黑
 *   - 爆炸是「球 + 环」的纯几何体，没有火球、没有碎片
 *   - 开火没有炮口火光
 *   - 命中只有一个白球
 *
 * 这一层补上四样：星空背景 / 火球爆炸（含碎片）/ 炮口火光 / 命中火花。
 * 贴图由 tools/generate-combat-textures.py 程序化生成，不依赖外部素材。
 */
interface Billboard {
  readonly node: Node;
  readonly material: Material;
  readonly color: Color;
  /** acquire 代号：旧 tween 回调带旧代号，回收时据此判失效。 */
  readonly generation: number;
}

interface Debris {
  readonly node: Node;
  readonly velocity: Vec3;
  readonly spin: Vec3;
  life: number;
  readonly maxLife: number;
}

const STARFIELD_TEXTURE = 'textures/starfield/texture';
const EXPLOSION_TEXTURE = 'textures/explosion/texture';
const MUZZLE_TEXTURE = 'textures/muzzle-flash/texture';
const SPARK_TEXTURE = 'textures/spark/texture';

function unlitMaterial(color: Color): Material {
  const material = new Material();
  material.initialize({ effectName: 'builtin-unlit' });
  material.setProperty('mainColor', color);
  return material;
}

export class CombatVisuals {
  private readonly billboardPool = new NodePool('CombatBillboardPool');
  private readonly activeBillboards = new Set<Node>();
  private readonly debris: Debris[] = [];
  private readonly debrisRotation = new Quat();
  private readonly debrisMaterial = unlitMaterial(new Color(255, 168, 72, 255));
  private readonly debrisMesh = utils.createMesh(primitives.box(0.22));
  private readonly billboardMesh = utils.createMesh(primitives.quad());
  private readonly billboardSurfaces = new Map<Node, { material: Material; color: Color }>();
  private explosionFrame: Texture2D | null = null;
  private muzzleFrame: Texture2D | null = null;
  private sparkFrame: Texture2D | null = null;
  private starfield: Node | null = null;
  private skyMaterial: Material | null = null;
  private disposed = false;
  private lastEventId = 0;
  private lastTick = 0;
  private cameraNode: Node | null = null;
  /** 每次 acquire 递增代号，节点 -> 当前代号：让复用前的旧回调失效。 */
  private billboardGeneration = 0;
  private readonly billboardTokens = new Map<Node, number>();

  public constructor(private readonly parent: Node, private readonly debrisLimit = 24) {}

  /** 异步载入贴图；缺失时静默降级，绝不阻塞战斗 */
  public loadTextures(): void {
    this.loadFrame(EXPLOSION_TEXTURE, (frame) => { this.explosionFrame = frame; });
    this.loadFrame(MUZZLE_TEXTURE, (frame) => { this.muzzleFrame = frame; });
    this.loadFrame(SPARK_TEXTURE, (frame) => { this.sparkFrame = frame; });
  }

  /**
   * 星空背景：一张公告板贴在相机前方。
   * 不用天球是因为要翻转面 / 换材质 / 处理远裁剪面；
   * 公告板只要 1 个绘制调用，且天然跟随相机（看起来就是无限远的星空）。
   */
  public attachStarfield(camera: Node): void {
    this.cameraNode = camera;
    this.loadFrame(STARFIELD_TEXTURE, (frame) => {
      if (this.starfield) return;
      const node = new Node('Starfield');
      node.setParent(camera);
      node.layer = camera.layer;
      node.setPosition(0, 0, -900);
      node.setScale(3600, 2025, 1);
      this.skyMaterial = this.texturedMaterial(frame, false);
      this.skyMaterial.setProperty('mainColor', new Color(164, 176, 192, 255));
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = this.billboardMesh;
      renderer.setMaterial(this.skyMaterial, 0);
      this.starfield = node;
    });
  }

  public sync(snapshot: CombatSnapshot, deltaTime: number): void {
    if (snapshot.tick < this.lastTick) this.lastEventId = 0;
    this.lastTick = snapshot.tick;
    for (const event of snapshot.combatEvents) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      this.present(event);
    }
    this.updateDebris(deltaTime);
    this.faceCamera();
  }

  public recycleAll(): void {
    for (const node of Array.from(this.activeBillboards)) this.recycleBillboard(node);
    for (const piece of this.debris) piece.node.destroy();
    this.debris.length = 0;
  }

  public dispose(): void {
    this.disposed = true;
    this.recycleAll();
    this.billboardPool.clear();
    if (this.starfield) {
      this.starfield.active = false;
      this.starfield.destroy();
    }
    for (const surface of this.billboardSurfaces.values()) surface.material.destroy();
    this.billboardSurfaces.clear();
    this.skyMaterial?.destroy();
    this.billboardMesh.destroy();
    this.debrisMaterial.destroy();
    this.debrisMesh.destroy();
  }

  private present(event: CombatEvent): void {
    if (event.type === 'destroyed') {
      this.spawnExplosion(event);
      return;
    }
    if (event.type === 'weapon-fired') {
      this.spawnMuzzleFlash(event);
      return;
    }
    if (event.type === 'hit' || event.type === 'shield-break') {
      this.spawnSpark(event);
    }
  }

  // ---- 火球 + 碎片 ----
  private spawnExplosion(event: CombatEvent): void {
    if (this.explosionFrame) {
      const billboard = this.acquireBillboard(this.explosionFrame);
      billboard.node.setWorldPosition(new Vec3(event.position.x, event.position.y, event.position.z));
      billboard.node.setScale(1.4, 1.4, 1);
      tween(billboard.node)
        .to(0.12, { scale: new Vec3(6.2, 6.2, 1) })
        .to(0.32, { scale: new Vec3(9, 9, 1) })
        .call(() => this.recycleBillboard(billboard.node, billboard.generation))
        .start();
      this.fade(billboard, 0.32, 0.12);
    }
    this.spawnDebris(event.position, 8);
  }

  private spawnDebris(position: { x: number; y: number; z: number }, count: number): void {
    const available = Math.min(count, this.debrisLimit - this.debris.length);
    for (let index = 0; index < available; index += 1) {
      const node = new Node('CombatDebris');
      node.setParent(this.parent);
      node.setWorldPosition(new Vec3(position.x, position.y, position.z));
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = this.debrisMesh;
      renderer.setMaterial(this.debrisMaterial, 0);
      node.setScale(0.9, 0.9, 0.9);
      const angle = (index / Math.max(1, count)) * Math.PI * 2 + index * 0.41;
      const speed = 5.5 + (index % 4) * 2.6;
      const life = 0.5 + (index % 3) * 0.12;
      this.debris.push({
        node,
        velocity: new Vec3(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed * 0.65 + 1.6,
          ((index % 3) - 1) * 2.4,
        ),
        spin: new Vec3(index * 0.9, index * 1.3, index * 0.7),
        life,
        maxLife: life,
      });
    }
  }

  private updateDebris(deltaTime: number): void {
    for (let index = this.debris.length - 1; index >= 0; index -= 1) {
      const piece = this.debris[index];
      piece.life -= deltaTime;
      if (piece.life <= 0) {
        piece.node.destroy();
        this.debris.splice(index, 1);
        continue;
      }
      const position = piece.node.worldPosition;
      piece.node.setWorldPosition(new Vec3(
        position.x + piece.velocity.x * deltaTime,
        position.y + piece.velocity.y * deltaTime,
        position.z + piece.velocity.z * deltaTime,
      ));
      piece.node.rotate(Quat.fromEuler(this.debrisRotation,
        piece.spin.x * deltaTime, piece.spin.y * deltaTime, piece.spin.z * deltaTime));
      const scale = Math.max(0.01, piece.life / piece.maxLife);
      piece.node.setScale(scale, scale, scale);
    }
  }

  // ---- 炮口火光 ----
  private spawnMuzzleFlash(event: CombatEvent): void {
    if (!this.muzzleFrame) return;
    const billboard = this.acquireBillboard(this.muzzleFrame);
    billboard.node.setWorldPosition(new Vec3(event.position.x, event.position.y, event.position.z));
    billboard.node.setScale(0.55, 0.55, 1);
    tween(billboard.node)
      .to(0.09, { scale: new Vec3(2.1, 2.1, 1) })
      .call(() => this.recycleBillboard(billboard.node, billboard.generation))
      .start();
    this.fade(billboard, 0.09);
  }

  // ---- 命中火花 ----
  private spawnSpark(event: CombatEvent): void {
    if (!this.sparkFrame) return;
    const billboard = this.acquireBillboard(this.sparkFrame);
    billboard.node.setWorldPosition(new Vec3(event.position.x, event.position.y, event.position.z));
    const shield = event.type === 'shield-break';
    const duration = shield ? 0.28 : 0.16;
    const scale = shield ? 4.5 : 2.6;
    billboard.node.setScale(0.6, 0.6, 1);
    billboard.color.set(shield ? 112 : 255, shield ? 221 : 212, shield ? 255 : 166, 255);
    billboard.material.setProperty('mainColor', billboard.color);
    tween(billboard.node)
      .to(duration, { scale: new Vec3(scale, scale, 1) })
      .call(() => this.recycleBillboard(billboard.node, billboard.generation))
      .start();
    this.fade(billboard, duration);
  }

  /** 公告板始终朝向相机 */
  private faceCamera(): void {
    const camera = this.cameraNode;
    if (!camera) return;
    const rotation = camera.worldRotation;
    for (const node of this.activeBillboards) {
      node.setWorldRotation(rotation);
    }
  }

  private acquireBillboard(frame: Texture2D): Billboard {
    const node = this.billboardPool.get() || new Node('CombatVisuals.Billboard');
    node.setParent(this.parent);
    let surface = this.billboardSurfaces.get(node);
    if (!surface) {
      surface = { material: this.texturedMaterial(frame, true), color: new Color(255, 255, 255, 255) };
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = this.billboardMesh;
      renderer.setMaterial(surface.material, 0);
      this.billboardSurfaces.set(node, surface);
    }
    surface.color.set(255, 255, 255, 255);
    surface.material.setProperty('mainTexture', frame);
    surface.material.setProperty('mainColor', surface.color);
    if (this.cameraNode) node.setWorldRotation(this.cameraNode.worldRotation);
    node.active = true;
    this.activeBillboards.add(node);
    // 每次 acquire 递增代号，旧 tween 的 .call() 因代号不匹配而失效。
    const generation = ++this.billboardGeneration;
    this.billboardTokens.set(node, generation);
    return { node, ...surface, generation };
  }

  private recycleBillboard(node: Node, generation?: number): void {
    if (!this.activeBillboards.has(node)) return;
    // 旧回调（代号已过期）不得提前回收重新取出的新特效。
    if (generation !== undefined && this.billboardTokens.get(node) !== generation) return;
    this.activeBillboards.delete(node);
    this.billboardTokens.delete(node);
    // 先停掉节点 / sprite 上仍在跑的 tween 再入池，避免旧 .call() 二次回收。
    if (Tween) Tween.stopAllByTarget(node);
    const surface = this.billboardSurfaces.get(node);
    if (Tween && surface) Tween.stopAllByTarget(surface.color);
    node.active = false;
    this.billboardPool.put(node);
  }

  private texturedMaterial(texture: Texture2D, transparent: boolean): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', technique: transparent ? 1 : 0, defines: { USE_TEXTURE: true } });
    material.setProperty('mainTexture', texture);
    return material;
  }

  private fade(billboard: Billboard, duration: number, delay = 0): void {
    tween(billboard.color).delay(delay).to(duration, { a: 0 }, {
      onUpdate: () => billboard.material.setProperty('mainColor', billboard.color),
    }).start();
  }

  private loadFrame(path: string, apply: (frame: Texture2D) => void): void {
    resources.load(path, Texture2D, (error: Error | null, texture?: Texture2D) => {
      if (this.disposed || error || !texture) return;
      apply(texture);
    });
  }
}
