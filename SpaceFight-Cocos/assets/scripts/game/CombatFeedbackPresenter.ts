import {
  builtinResMgr,
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
import type { CombatEvent, CombatSnapshot } from '../core/CombatSimulation';

interface FeedbackVisual {
  readonly node: Node;
  readonly core: MeshRenderer;
  readonly ring: MeshRenderer;
  readonly light: SphereLight | null;
}

function unlitMaterial(color: Color): Material {
  const parent = builtinResMgr.get<Material>('missing-material');
  if (!parent) throw new Error('Cocos precompiled unlit material is unavailable');
  const material = new Material();
  material.copy(parent);
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
      .call(() => this.recycle(visual.node))
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
    return { node, core, ring, light };
  }

  private recycle(node: Node): void {
    if (!this.active.delete(node)) return;
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
    return { node, core, ring, light };
  }
}
