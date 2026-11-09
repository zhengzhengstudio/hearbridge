import { builtinResMgr, Color, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import type { CombatSnapshot } from '../core/CombatSimulation';

type PickupView = CombatSnapshot['pickups'][number];

/**
 * 拾取物的视觉契约：`CombatSnapshot.pickups` 早就带了 category / rarity，
 * 但旧版渲染只按 `kind === 'loot'` 分成两种箱子，玩家在战场上完全看不出
 * 「这箱是装备还是通货、是普通还是史诗」，也就没法做「先捡哪个」的决策。
 *
 * 现在两条视觉通道各管一件事：
 * - 类别 → 形状 + 主体色（与 ImageGen 生成的 6 个道具图标同源）
 * - 稀有度 → 光环颜色 + 层数 + 体积（远远就能看出高价值货）
 */
const CATEGORY_COLORS: Readonly<Record<string, Color>> = {
  material: new Color(168, 182, 196, 255),   // 银灰合金废料
  equipment: new Color(240, 138, 82, 255),   // 橙红维修箱
  currency: new Color(72, 200, 238, 255),    // 青蓝能量核心
  intel: new Color(156, 138, 236, 255),      // 紫蓝数据晶体
  cosmetic: new Color(238, 196, 92, 255),    // 金色密封货箱
  shield: new Color(120, 190, 245, 255),     // 淡蓝护盾发生器
  upgrade: new Color(96, 214, 170, 255),     // 青绿局内强化模块
  energy: new Color(72, 200, 238, 255),
  repair: new Color(240, 138, 82, 255),
  scrap: new Color(168, 182, 196, 255),
  data: new Color(156, 138, 236, 255),
  loot: new Color(238, 196, 92, 255),
};

const RARITY_COLORS: Readonly<Record<string, Color>> = {
  common: new Color(176, 190, 202, 255),
  uncommon: new Color(86, 216, 172, 255),
  rare: new Color(96, 172, 255, 255),
  epic: new Color(255, 190, 84, 255),
};

interface HullShape {
  readonly sphere: boolean;
  readonly scale: readonly [number, number, number];
}

/** 只用 box / sphere 两种引擎基础体，靠非均匀缩放拉出五类不同轮廓。 */
const CATEGORY_SHAPES: Readonly<Record<string, HullShape>> = {
  material: { sphere: false, scale: [1.0, 0.72, 0.9] },
  equipment: { sphere: false, scale: [1.28, 0.42, 0.78] },
  currency: { sphere: true, scale: [0.58, 0.9, 0.58] },
  intel: { sphere: true, scale: [0.74, 1.08, 0.74] },
  cosmetic: { sphere: true, scale: [0.7, 0.7, 0.7] },
  shield: { sphere: true, scale: [0.72, 0.72, 0.72] },
  upgrade: { sphere: true, scale: [0.6, 0.6, 0.6] },
  energy: { sphere: true, scale: [0.58, 0.9, 0.58] },
  repair: { sphere: false, scale: [1.28, 0.42, 0.78] },
  scrap: { sphere: false, scale: [1.0, 0.72, 0.9] },
  data: { sphere: true, scale: [0.74, 1.08, 0.74] },
  loot: { sphere: true, scale: [0.7, 0.7, 0.7] },
};

const DEFAULT_SHAPE: HullShape = { sphere: false, scale: [1.0, 0.72, 0.9] };
const DEFAULT_COLOR = CATEGORY_COLORS.material;

export class LootPresenter {
  private readonly nodes = new Map<string, Node>();
  private readonly boxMesh = utils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
  private readonly sphereMesh = utils.createMesh(primitives.sphere(0.5, { segments: 12 }));
  private readonly bandMesh = utils.createMesh(primitives.box({ width: 1.18, height: 0.12, length: 0.96 }));
  private readonly materialCache = new Map<string, Material>();
  private elapsed = 0;

  constructor(private readonly parent: Node) {}

  sync(snapshot: CombatSnapshot, deltaTime: number): void {
    this.elapsed += Math.min(0.05, Math.max(0, deltaTime));
    const active = new Set<string>();
    for (const pickup of snapshot.pickups) {
      active.add(pickup.id);
      let node = this.nodes.get(pickup.id);
      if (!node) {
        node = this.create(pickup);
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
      // 远处放大以保持可读：稀有度倍率放在子节点 hull 上，不被这里覆盖。
      const scale = distance > 45 ? 1.8 : distance > 20 ? 1.35 : 1;
      node.setScale(scale, scale, scale);
    }
    // 消失的 pickup 彻底销毁并从 Map 删除，避免长时间游玩节点/Map 无限增长。
    for (const [id, node] of [...this.nodes]) {
      if (!active.has(id)) {
        node.destroy();
        this.nodes.delete(id);
      }
    }
  }

  recycleAll(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
  }

  private create(pickup: PickupView): Node {
    const root = new Node(`Pickup.${pickup.id}`);
    root.setParent(this.parent);

    // 敌人掉落带 category/rarity；任务预设的补给箱只有 kind，按语义映射到同一套配色。
    const visualKey = pickup.category || pickup.kind || 'material';
    const shape = CATEGORY_SHAPES[visualKey] || DEFAULT_SHAPE;
    const bodyColor = CATEGORY_COLORS[visualKey]
      || (pickup.kind === 'upgrade' ? CATEGORY_COLORS.upgrade : DEFAULT_COLOR);
    const rarity = pickup.rarity || 'common';
    const ringColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
    const rarityScale = rarity === 'epic' ? 1.22 : rarity === 'rare' ? 1.1 : 1;

    const hull = new Node('Hull');
    hull.setParent(root);
    const renderer = hull.addComponent(MeshRenderer);
    renderer.mesh = shape.sphere ? this.sphereMesh : this.boxMesh;
    const bodyMaterial = this.material(bodyColor);
    if (bodyMaterial) renderer.setMaterial(bodyMaterial, 0);
    hull.setScale(
      shape.scale[0] * rarityScale,
      shape.scale[1] * rarityScale,
      shape.scale[2] * rarityScale,
    );

    // 稀有度光环：普通 1 道灰白，稀有/史诗 2 道且颜色更亮，远处就能分辨价值。
    const ringMaterial = this.material(ringColor);
    const layers = rarity === 'rare' || rarity === 'epic' ? 2 : 1;
    for (let index = 0; index < layers; index += 1) {
      const ring = new Node(`RarityRing.${index}`);
      ring.setParent(root);
      const ringRenderer = ring.addComponent(MeshRenderer);
      ringRenderer.mesh = this.bandMesh;
      if (ringMaterial) ringRenderer.setMaterial(ringMaterial, 0);
      ring.setPosition(0, index === 0 ? 0.62 : -0.62, 0);
      ring.setScale(rarityScale, 1, rarityScale);
    }
    return root;
  }

  private material(color: Color): Material | null {
    const key = `${color.r},${color.g},${color.b}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const parent = builtinResMgr.get<Material>('missing-material');
    if (!parent) return null;
    const result = new Material();
    result.copy(parent);
    result.setProperty('mainColor', color);
    this.materialCache.set(key, result);
    return result;
  }
}
