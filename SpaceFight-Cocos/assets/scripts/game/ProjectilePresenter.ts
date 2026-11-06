import {
  builtinResMgr,
  Color,
  CurveRange,
  GradientRange,
  Line,
  Material,
  MeshRenderer,
  Node,
  NodePool,
  primitives,
  RigidBody,
  SphereCollider,
  utils,
  Vec3,
} from 'cc';
import type { CombatSnapshot } from '../core/CombatSimulation';

interface ProjectileVisual {
  readonly node: Node;
  readonly trail: Line | null;
}

export interface ProjectilePresenterOptions {
  readonly poolSize: number;
  readonly trails: boolean;
  readonly physics: boolean;
}

const TRAIL_LENGTH = 2.8;

/**
 * 每种武器的弹体配色（2026-10-23 新增）。
 *
 * 之前所有玩家子弹只有两种颜色：脉冲炮=青、导弹=橙，
 * 散射/磁轨/等离子/离子/聚焦束/旋转机炮全是同一种青 —— 打起来毫无区分度，
 * 「我现在打出去的是什么」完全看不出来。
 * 这里按武器给独立配色，敌弹保持红色（一眼分敌我）。
 */
const WEAPON_COLORS: Record<string, Color> = {
  pulse: new Color(96, 236, 255, 255),
  scatter: new Color(255, 178, 66, 255),
  missile: new Color(255, 124, 62, 255),
  rail: new Color(206, 238, 255, 255),
  plasma: new Color(86, 255, 208, 255),
  ion: new Color(192, 146, 255, 255),
  beam: new Color(255, 250, 222, 255),
  rotary: new Color(255, 224, 96, 255),
  torpedo: new Color(255, 142, 72, 255),
  flak: new Color(146, 255, 136, 255),
  swarm: new Color(255, 126, 220, 255),
  mine: new Color(255, 112, 72, 255),
  rocket: new Color(255, 92, 70, 255),
};

/** 重型武器的弹体更大，小口径保持小巧 */
const WEAPON_SCALES: Record<string, number> = {
  pulse: 0.85,
  rotary: 0.8,
  scatter: 0.95,
  ion: 0.95,
  plasma: 1.15,
  missile: 1.1,
  torpedo: 1.25,
  rail: 0.7,
  beam: 0.62,
  flak: 1.05,
  swarm: 1.0,
  mine: 1.2,
  rocket: 0.95,
};

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

function unlitMaterial(color: Color): Material {
  const parent = builtinResMgr.get<Material>('missing-material');
  if (!parent) throw new Error('Cocos precompiled unlit material is unavailable');
  const material = new Material();
  material.copy(parent);
  material.setProperty('mainColor', color);
  return material;
}

export class ProjectilePresenter {
  private readonly pool = new NodePool('ProjectilePool');
  private readonly activeProjectiles = new Map<string, ProjectileVisual>();
  private readonly projectileMesh = utils.createMesh(primitives.sphere(0.12, {
    segments: 10,
  }));
  private readonly pulseMaterial = unlitMaterial(new Color(64, 225, 255, 255));
  private readonly missileMaterial = unlitMaterial(new Color(255, 138, 62, 255));
  private readonly enemyMaterial = unlitMaterial(new Color(255, 61, 48, 255));
  /** 每种武器一份材质（按需创建并缓存） */
  private readonly weaponMaterials = new Map<string, Material>();

  public constructor(
    private readonly parent: Node,
    private readonly options: ProjectilePresenterOptions = {
      poolSize: 48,
      trails: true,
      physics: true,
    },
  ) {
    for (let index = 0; index < options.poolSize; index += 1) {
      this.pool.put(this.createProjectileNode());
    }
  }

  public sync(snapshot: CombatSnapshot): void {
    const visibleIds = new Set(snapshot.projectiles.map((projectile) => projectile.id));
    for (const [projectileId] of this.activeProjectiles) {
      if (!visibleIds.has(projectileId)) {
        this.recycle(projectileId);
      }
    }

    for (const projectile of snapshot.projectiles) {
      let visual = this.activeProjectiles.get(projectile.id);
      if (!visual) {
        visual = this.acquire(projectile.id, projectile.weapon, projectile.owner);
      }

      const position = new Vec3(
        projectile.position.x,
        projectile.position.y,
        projectile.position.z,
      );
      visual.node.setWorldPosition(position);
      if (visual.trail) this.updateTrail(visual.trail, position, projectile.velocity);
    }
  }

  public recycleAll(): void {
    for (const projectileId of [...this.activeProjectiles.keys()]) {
      this.recycle(projectileId);
    }
  }

  private acquire(
    projectileId: string,
    weapon: string,
    owner: 'player' | 'enemy',
  ): ProjectileVisual {
    const node = this.pool.get() || this.createProjectileNode();
    node.name = `Projectile.${projectileId}`;
    node.setParent(this.parent);
    node.active = true;

    const renderer = node.getComponent(MeshRenderer);
    const material = owner === 'enemy'
      ? this.enemyMaterial
      : this.weaponMaterial(weapon);
    if (renderer) {
      renderer.setMaterial(material, 0);
    }
    // 弹体大小按武器区分：磁轨/聚焦束是细长弹，重型鱼雷是大块
    const scale = owner === 'enemy' ? 1 : (WEAPON_SCALES[weapon] || 1);
    node.setScale(scale, scale, scale);
    const trailNode = node.getChildByName('ProjectileTrail');
    const trail = trailNode?.getComponent(Line);
    if (this.options.trails && !trail) {
      throw new Error('ProjectileTrail line component is required');
    }
    if (trail) {
      trail.lineMaterial = material;
      const tint = owner === 'enemy'
        ? new Color(255, 72, 52, 235)
        : this.weaponTint(weapon);
      trail.color = constantColor(tint);
    }
    const visual = { node, trail };
    this.activeProjectiles.set(projectileId, visual);
    return visual;
  }

  private recycle(projectileId: string): void {
    const visual = this.activeProjectiles.get(projectileId);
    if (!visual) {
      return;
    }
    this.activeProjectiles.delete(projectileId);
    visual.node.active = false;
    this.pool.put(visual.node);
  }

  /** 按武器取弹体材质（按需创建并缓存，避免每发子弹新建材质） */
  private weaponMaterial(weapon: string): Material {
    const existing = this.weaponMaterials.get(weapon);
    if (existing) return existing;
    const color = WEAPON_COLORS[weapon] || new Color(64, 225, 255, 255);
    const material = unlitMaterial(color);
    this.weaponMaterials.set(weapon, material);
    return material;
  }

  /** 拖尾颜色：取武器主色但压暗一点，避免拖尾比弹体还刺眼 */
  private weaponTint(weapon: string): Color {
    const color = WEAPON_COLORS[weapon] || new Color(67, 218, 255, 255);
    return new Color(
      Math.round(color.r * 0.82),
      Math.round(color.g * 0.82),
      Math.round(color.b * 0.82),
      235,
    );
  }

  private createProjectileNode(): Node {
    const node = new Node('Projectile.Pooled');
    node.setScale(1, 1, 1);

    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.projectileMesh;
    renderer.setMaterial(this.pulseMaterial, 0);

    if (this.options.physics) {
      const collider = node.addComponent(SphereCollider);
      collider.radius = 0.14;
      collider.isTrigger = true;
      const body = node.addComponent(RigidBody);
      body.type = RigidBody.Type.KINEMATIC;
      body.useGravity = false;
    }

    if (this.options.trails) {
      const trailNode = new Node('ProjectileTrail');
      trailNode.setParent(node);
      const trail = trailNode.addComponent(Line);
      trail.worldSpace = true;
      trail.width = constantCurve(0.055);
      trail.color = constantColor(new Color(67, 218, 255, 210));
      trail.lineMaterial = this.pulseMaterial;
    }
    node.active = false;
    return node;
  }

  private updateTrail(
    trail: Line,
    position: Vec3,
    velocity: { x: number; y: number; z: number },
  ): void {
    const direction = new Vec3(velocity.x, velocity.y, velocity.z);
    if (direction.lengthSqr() < 0.0001) {
      direction.set(0, 0, -1);
    } else {
      direction.normalize();
    }
    const trailEnd = new Vec3();
    Vec3.scaleAndAdd(trailEnd, position, direction, -TRAIL_LENGTH);
    trail.positions = [position.clone(), trailEnd];
  }
}
