import {
  Color,
  Material,
  MeshRenderer,
  Node,
  NodePool,
  primitives,
  SphereLight,
  tween,
  utils,
  Vec3,
} from 'cc';
import * as cc from 'cc';
import type { CombatEvent, CombatSnapshot } from '../core/CombatSimulation';

/** Cocos 3.8 的 Tween 类：经命名空间取用，兼容未列出该导出的精简 cc 声明。 */
const Tween: { stopAllByTarget(target?: object): void } | undefined = (cc as any).Tween;

interface FeedbackVisual {
  readonly node: Node;
  readonly core: MeshRenderer;
  readonly ring: MeshRenderer;
  readonly light: SphereLight | null;
  /** acquire 代号：旧 tween 回调带旧代号，回收时据此判失效。 */
  readonly generation: number;
}

function unlitMaterial(color: Color): Material {
  const material = new Material();
  material.initialize({ effectName: 'builtin-unlit' });
  material.setProperty('mainColor', color);
  return material;
}

export class CombatFeedbackPresenter {
  private readonly pool = new NodePool('CombatFeedbackPool');
  private readonly active = new Set<Node>();
  private readonly impactMaterial = unlitMaterial(new Color(226, 248, 255, 255));
  private readonly killMaterial = unlitMaterial(new Color(255, 159, 48, 255));
  private readonly shieldMaterial = unlitMaterial(new Color(56, 210, 255, 255));
  private readonly coreMesh = utils.createMesh(primitives.sphere(0.28, { segments: 12 }));
  private readonly ringMesh = utils.createMesh(primitives.torus(0.72, 0.055, {
    radialSegments: 12,
    tubularSegments: 8,
  }));
  private lastEventId = 0;
  private lastTick = 0;
  /** 每次 acquire 递增代号，节点 -> 当前代号：让复用前的旧回调失效。 */
  private feedbackGeneration = 0;
  private readonly feedbackTokens = new Map<Node, number>();

  public constructor(
    private readonly parent: Node,
    poolSize = 18,
    private readonly lights = true,
  ) {
    for (let index = 0; index < poolSize; index += 1) {
      this.pool.put(this.createVisual().node);
    }
  }

  public sync(snapshot: CombatSnapshot): void {
    if (snapshot.tick < this.lastTick) this.lastEventId = 0;
    this.lastTick = snapshot.tick;
    for (const event of snapshot.combatEvents) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      if (event.type === 'hit' || event.type === 'destroyed' || event.type === 'shield-break' || event.type === 'weapon-fired') {
        this.present(event);
      }
    }
  }

  public recycleAll(): void {
    for (const node of [...this.active]) this.recycle(node);
  }

  private present(event: CombatEvent): void {
    const visual = this.acquire();
    const destroyed = event.type === 'destroyed';
    const shield = event.type === 'shield-break';
    const muzzle = event.type === 'weapon-fired';
    const playerImpact = event.source === 'player';
    const material = destroyed ? this.killMaterial : shield ? this.shieldMaterial : playerImpact && !muzzle ? this.killMaterial : this.impactMaterial;
    const ringMaterial = playerImpact && !muzzle ? this.impactMaterial : material;
    const color = destroyed
      ? new Color(255, 139, 40, 255)
      : shield ? new Color(44, 208, 255, 255) : playerImpact && !muzzle ? new Color(255, 106, 40, 255) : new Color(220, 247, 255, 255);
    visual.core.setMaterial(material, 0);
    visual.ring.setMaterial(ringMaterial, 0);
    if (visual.light) visual.light.color = color;
    if (visual.light) {
      visual.light.luminance = destroyed ? 4200 : muzzle ? 3600 : playerImpact ? 2900 : 1300;
      visual.light.range = destroyed ? 18 : muzzle ? 7 : playerImpact ? 11 : 7;
    }
    visual.node.setWorldPosition(new Vec3(event.position.x, event.position.y, event.position.z));
    const initialScale = destroyed ? 0.5 : muzzle ? 0.16 : 0.24;
    visual.node.setScale(initialScale, initialScale, initialScale);

    const peak = destroyed ? 4.8 : shield ? 2.4 : muzzle ? 1.25 : playerImpact ? 2.05 : 1.25;
    const duration = destroyed ? 0.34 : muzzle ? 0.055 : playerImpact ? 0.2 : 0.14;
    tween(visual.node)
      .to(duration, { scale: new Vec3(peak, peak, peak) })
      .to(destroyed ? 0.22 : 0.1, { scale: new Vec3(0.01, 0.01, 0.01) })
      .call(() => this.recycle(visual.node, visual.generation))
      .start();
    if (visual.light) tween(visual.light).to(duration + 0.12, { luminance: 0 }).start();
  }

  private acquire(): FeedbackVisual {
    const node = this.pool.get() || this.createVisual().node;
    node.setParent(this.parent);
    node.active = true;
    this.active.add(node);
    const core = node.getChildByName('ImpactCore')?.getComponent(MeshRenderer);
    const ring = node.getChildByName('ImpactRing')?.getComponent(MeshRenderer);
    const light = node.getComponent(SphereLight);
    if (!core || !ring || (this.lights && !light)) throw new Error('Combat feedback visual is incomplete');
    // 每次 acquire 递增代号，旧 tween 的 .call() 因代号不匹配而失效。
    const generation = ++this.feedbackGeneration;
    this.feedbackTokens.set(node, generation);
    return { node, core, ring, light, generation };
  }

  private recycle(node: Node, generation?: number): void {
    if (!this.active.has(node)) return;
    // 旧回调（代号已过期）不得提前回收重新取出的新特效。
    if (generation !== undefined && this.feedbackTokens.get(node) !== generation) return;
    this.active.delete(node);
    // 先停掉节点与 light 上仍在跑的 tween 再入池，避免旧 .call() 二次回收。
    if (Tween) Tween.stopAllByTarget(node);
    const light = node.getComponent(SphereLight);
    if (Tween && light) Tween.stopAllByTarget(light);
    node.active = false;
    this.pool.put(node);
  }

  private createVisual(): FeedbackVisual {
    const node = new Node('CombatFeedback.Pooled');
    const coreNode = new Node('ImpactCore');
    coreNode.setParent(node);
    const core = coreNode.addComponent(MeshRenderer);
    core.mesh = this.coreMesh;
    core.setMaterial(this.impactMaterial, 0);

    const ringNode = new Node('ImpactRing');
    ringNode.setParent(node);
    ringNode.setRotationFromEuler(90, 0, 0);
    const ring = ringNode.addComponent(MeshRenderer);
    ring.mesh = this.ringMesh;
    ring.setMaterial(this.impactMaterial, 0);

    const light = this.lights ? node.addComponent(SphereLight) : null;
    if (light) {
      light.color = new Color(226, 248, 255, 255);
      light.range = 8;
      light.size = 0.4;
      light.luminance = 0;
    }
    node.active = false;
    // 池化初始节点未 acquire：代号 0，acquire 时会重新分配。
    return { node, core, ring, light, generation: 0 };
  }
}
