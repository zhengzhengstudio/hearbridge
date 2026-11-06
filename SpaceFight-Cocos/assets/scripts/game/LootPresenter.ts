import { builtinResMgr, Color, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import type { CombatSnapshot } from '../core/CombatSimulation';

function material(color: Color): Material | null {
  const parent = builtinResMgr.get<Material>('missing-material');
  if (!parent) return null;
  const result = new Material();
  result.copy(parent);
  result.setProperty('mainColor', color);
  return result;
}

export class LootPresenter {
  private readonly nodes = new Map<string, Node>();
  private readonly crateMesh = utils.createMesh(primitives.box({ width: 1.1, height: 0.72, length: 0.88 }));
  private readonly bandMesh = utils.createMesh(primitives.box({ width: 1.18, height: 0.12, length: 0.96 }));
  private readonly crateMaterial = material(new Color(72, 88, 94, 255));
  private readonly glowMaterial = material(new Color(255, 166, 44, 255));
  private elapsed = 0;

  constructor(private readonly parent: Node) {}

  sync(snapshot: CombatSnapshot, deltaTime: number): void {
    this.elapsed += Math.min(0.05, Math.max(0, deltaTime));
    const active = new Set<string>();
    for (const pickup of snapshot.pickups) {
      active.add(pickup.id);
      let node = this.nodes.get(pickup.id);
      if (!node) {
        node = this.create(pickup.id, pickup.kind === 'loot');
        this.nodes.set(pickup.id, node);
      }
      node.active = true;
      node.setPosition(pickup.position.x, pickup.position.y + Math.sin(this.elapsed * 2.4 + pickup.id.length) * 0.28, pickup.position.z);
      node.setRotationFromEuler(0, (this.elapsed * 42 + pickup.id.length * 19) % 360, 0);
      const distance = Vec3.distance(node.worldPosition, new Vec3(
        snapshot.player.position.x,
        snapshot.player.position.y,
        snapshot.player.position.z,
      ));
      const scale = distance > 45 ? 1.8 : distance > 20 ? 1.35 : 1;
      node.setScale(scale, scale, scale);
    }
    for (const [id, node] of this.nodes) {
      if (!active.has(id)) node.active = false;
    }
  }

  recycleAll(): void {
    for (const node of this.nodes.values()) node.active = false;
  }

  private create(id: string, cargo: boolean): Node {
    const root = new Node(`Pickup.${id}`);
    root.setParent(this.parent);
    const body = root.addComponent(MeshRenderer);
    body.mesh = this.crateMesh;
    if (this.crateMaterial) body.material = this.crateMaterial;
    const band = new Node('RecoveryBeacon');
    band.setParent(root);
    const renderer = band.addComponent(MeshRenderer);
    renderer.mesh = this.bandMesh;
    if (this.glowMaterial) renderer.material = this.glowMaterial;
    band.setPosition(0, cargo ? 0.42 : 0, 0);
    if (!cargo) root.setScale(0.72, 0.72, 0.72);
    return root;
  }
}
