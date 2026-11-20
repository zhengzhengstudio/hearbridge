import {
  Color,
  Material,
  MeshRenderer,
  Node,
  Prefab,
  primitives,
  resources,
  SphereCollider,
  instantiate,
  utils,
  Vec3,
} from 'cc';
import { PRIMARY_OUTPOST_POSITION } from '../core/CombatSimulation';
import { STATION_WALK_TERMINALS } from '../core/StationWalkSystem';
import {
  createWorldStreamProfile,
  type WorldStreamProfile,
} from './WorldStreamProfile';

export const CHUNK_SIZE = 80;
export const RECYCLE_RADIUS = 2;

const APPROACH_COVER_LAYOUT = Object.freeze([
  [-11, -2.4, 16, -18, 1.0],
  [10, -2.1, 12, 24, 0.92],
  [-17, 1.8, 3, 72, 1.08],
  [16, 2.4, -2, -68, 1.0],
  [-9, -0.8, -12, 12, 0.86],
  [8, 0.6, -16, -14, 0.94],
  [-22, 4.2, -10, 42, 1.16],
  [23, -3.5, -12, -36, 1.12],
] as const);

export const DESKTOP_WORLD_PROFILE: WorldStreamProfile = createWorldStreamProfile({
  activeWorldChunks: 25,
  decorationBudget: 225,
  shadows: true,
});

export const TOUCH_WORLD_PROFILE: WorldStreamProfile = createWorldStreamProfile({
  activeWorldChunks: 9,
  decorationBudget: 45,
  shadows: false,
});

interface WorldChunk {
  readonly root: Node;
  readonly station: Node;
  readonly facility: Node;
  readonly debris: Node;
  gridX: number;
  gridZ: number;
}

function chunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function hashCoordinate(x: number, z: number, salt: number): number {
  let value = Math.imul(x + 91, 73856093)
    ^ Math.imul(z - 47, 19349663)
    ^ Math.imul(salt + 17, 83492791);
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177);
  return (value >>> 0) / 0xffffffff;
}

function createMaterial(color: Color, _metallic: number, _roughness: number): Material {
  const material = new Material();
  material.initialize({ effectName: 'builtin-unlit' });
  material.setProperty('mainColor', color);
  return material;
}

export class WorldStreamer {
  private readonly activeChunks = new Map<string, WorldChunk>();
  private readonly chunkPool: WorldChunk[] = [];
  private readonly stationMaterial = createMaterial(new Color(76, 101, 120, 255), 0.82, 0.3);
  private readonly stationGlowMaterial = createMaterial(new Color(45, 188, 208, 255), 0.35, 0.22);
  private readonly stationDarkMaterial = createMaterial(new Color(24, 34, 42, 255), 0.9, 0.24);
  private readonly stationBeaconMaterial = createMaterial(new Color(245, 153, 48, 255), 0.18, 0.2);
  private readonly stationInteriorMaterial = createMaterial(new Color(132, 148, 154, 255), 0.62, 0.48);
  private readonly stationGlassMaterial = createMaterial(new Color(38, 116, 140, 255), 0.4, 0.18);
  // 站内细节化分层：暗色甲板 / 中灰结构板 / 亮金属骨架 / 灯带 / 屏幕 / 暖色警示。
  // 用 builtin-unlit 固定色，真机不依赖光照，不会出现「一块黑一块白」的跳色。
  private readonly stationDeckMaterial = createMaterial(new Color(24, 37, 45, 255), 0.5, 0.7);
  private readonly stationPanelMaterial = createMaterial(new Color(52, 70, 80, 255), 0.6, 0.55);
  private readonly stationTrimMaterial = createMaterial(new Color(104, 130, 140, 255), 0.7, 0.35);
  private readonly stationLightMaterial = createMaterial(new Color(126, 232, 242, 255), 0.2, 0.2);
  private readonly stationScreenMaterial = createMaterial(new Color(38, 158, 182, 255), 0.3, 0.25);
  private readonly stationWarmMaterial = createMaterial(new Color(240, 168, 60, 255), 0.25, 0.3);
  private readonly stationWindowMaterial = createMaterial(new Color(7, 20, 32, 255), 0.1, 0.9);
  // 2026-11-19：原本残骸混用亮灰蓝 stationMaterial + 灰褐 debrisMaterial，
  // 真机像一堆斑驳白灰方块（用户称「斑点」）。统一成暗冷灰岩石色，只留一个
  // 略亮的变体做层次，不再出现跳脱的亮蓝白块。
  private readonly debrisMaterial = createMaterial(new Color(42, 48, 54, 255), 0.05, 0.95);
  private readonly debrisAccentMaterial = createMaterial(new Color(58, 66, 72, 255), 0.05, 0.92);
  private readonly stationRingMesh = utils.createMesh(primitives.torus(5.8, 0.48, {
    radialSegments: 16,
    tubularSegments: 32,
  }));
  private readonly stationCoreMesh = utils.createMesh(primitives.cylinder(1.4, 2.1, 6, {
    radialSegments: 16,
  }));
  private readonly stationHubMesh = utils.createMesh(primitives.cylinder(2.5, 2.5, 1.3, {
    radialSegments: 16,
  }));
  private readonly stationArmMesh = utils.createMesh(primitives.box({
    width: 7.2,
    height: 0.52,
    length: 0.9,
  }));
  private readonly stationDockMesh = utils.createMesh(primitives.box({
    width: 2.8,
    height: 1.8,
    length: 2.2,
  }));
  private readonly stationPanelMesh = utils.createMesh(primitives.box({
    width: 3.6,
    height: 0.12,
    length: 1.35,
  }));
  private readonly stationBeaconMesh = utils.createMesh(primitives.sphere(0.18, {
    segments: 8,
  }));
  private readonly armorShellMesh = utils.createMesh(primitives.box({
    width: 5.2,
    height: 3.2,
    length: 6.8,
  }));
  private readonly hangarFrameMesh = utils.createMesh(primitives.box({
    width: 0.5,
    height: 4.8,
    length: 0.7,
  }));
  private readonly hangarDeckMesh = utils.createMesh(primitives.box({
    width: 7.2,
    height: 0.32,
    length: 10.5,
  }));
  private readonly corridorWallMesh = utils.createMesh(primitives.box({
    width: 0.28,
    height: 3.4,
    length: 7.8,
  }));
  private readonly bulkheadMesh = utils.createMesh(primitives.box({
    width: 2.1,
    height: 3.1,
    length: 0.32,
  }));
  private readonly interiorCoverMesh = utils.createMesh(primitives.box({
    width: 1.25,
    height: 1.05,
    length: 1.4,
  }));
  private readonly commandDeckMesh = utils.createMesh(primitives.box({
    width: 4.8,
    height: 1.2,
    length: 2.4,
  }));
  private readonly stationAntennaMesh = utils.createMesh(primitives.cylinder(0.1, 0.16, 2.6, {
    radialSegments: 8,
  }));
  private readonly facilityBlockMesh = utils.createMesh(primitives.box({
    width: 3.8,
    height: 1.3,
    length: 5.6,
  }));
  private readonly facilityBeamMesh = utils.createMesh(primitives.box({
    width: 0.42,
    height: 0.42,
    length: 7.5,
  }));
  private readonly approachWallMesh = utils.createMesh(primitives.box({
    width: 5.4,
    height: 1.35,
    length: 0.9,
  }));
  private readonly approachCargoMesh = utils.createMesh(primitives.box({
    width: 2.1,
    height: 1.9,
    length: 2.8,
  }));
  private readonly approachPylonMesh = utils.createMesh(primitives.cylinder(0.65, 0.9, 3.8, {
    radialSegments: 8,
  }));
  private readonly jumpGateMesh = utils.createMesh(primitives.torus(4.2, 0.34, {
    radialSegments: 12,
    tubularSegments: 24,
  }));
  private readonly asteroidMesh = utils.createMesh(primitives.sphere(1, {
    segments: 8,
  }));
  // 站内 DetailKit：全部复用网格，只在节点层摆位置/缩放，避免每块墙板生成独立 mesh。
  private readonly deckTileMesh = utils.createMesh(primitives.box({ width: 1.02, height: 0.08, length: 1.1 }));
  private readonly deckStripMesh = utils.createMesh(primitives.box({ width: 0.12, height: 0.05, length: 1.02 }));
  private readonly wallPanelMesh = utils.createMesh(primitives.box({ width: 0.14, height: 1.24, length: 1.28 }));
  private readonly wallRibMesh = utils.createMesh(primitives.box({ width: 0.3, height: 3.6, length: 0.22 }));
  private readonly windowMesh = utils.createMesh(primitives.box({ width: 0.1, height: 0.92, length: 1.5 }));
  private readonly pipeMesh = utils.createMesh(primitives.cylinder(0.07, 0.07, 6.6, { radialSegments: 8 }));
  private readonly ceilingPanelMesh = utils.createMesh(primitives.box({ width: 1.32, height: 0.1, length: 1.16 }));
  private readonly ceilingBeamMesh = utils.createMesh(primitives.box({ width: 6.6, height: 0.2, length: 0.28 }));
  private readonly consoleMesh = utils.createMesh(primitives.box({ width: 1.08, height: 0.92, length: 0.58 }));
  private readonly consoleScreenMesh = utils.createMesh(primitives.box({ width: 0.88, height: 0.46, length: 0.08 }));
  private readonly holoMesh = utils.createMesh(primitives.cylinder(0.22, 0.36, 0.82, { radialSegments: 12 }));
  private readonly crateMesh = utils.createMesh(primitives.box({ width: 0.62, height: 0.5, length: 0.62 }));
  private readonly railMesh = utils.createMesh(primitives.box({ width: 0.08, height: 0.08, length: 2.8 }));
  private readonly deckRingMesh = utils.createMesh(primitives.torus(0.62, 0.045, {
    radialSegments: 8,
    tubularSegments: 20,
  }));
  private readonly stationStarMesh = utils.createMesh(primitives.sphere(0.045, { segments: 6 }));

  public constructor(
    private readonly parent: Node,
    private readonly profile: WorldStreamProfile = DESKTOP_WORLD_PROFILE,
  ) {
    for (let index = 0; index < this.profile.activeWorldChunks; index += 1) {
      this.chunkPool.push(this.createChunk(index));
    }
    this.loadDetailedOutpost(this.profile.detailedOutpost ? 'models' : 'models-low');
  }

  private stationAnimationTime = 0;
  private detailedOutpost: Prefab | null = null;
  private disposed = false;
  /** 主前哨是否处于舱内行走态：为 true 时 GLB 外壳保持隐藏，不被异步加载/回收重新点亮。 */
  private interiorMode = false;

  public primaryInterior(): Node | null {
    return this.activeChunks.get(chunkKey(0, 0))?.station.getChildByName('StationInterior') ?? null;
  }

  /**
   * 切换主前哨的「舱内视角」：点亮细节内景并隐藏 GLB 外壳。
   * GLB 外壳的背面会包住整个舱室，玩家走进去时看到的是它的纯色内壁（真机截图实锤），
   * 必须在行走态关掉；离港后恢复外观。只作用主前哨，不碰远景站，零额外开销。
   */
  public setInteriorMode(active: boolean): void {
    this.interiorMode = active;
    const chunk = this.activeChunks.get(chunkKey(0, 0));
    if (!chunk) return;
    const station = chunk.station;
    const detail = station.getChildByName('StationInterior')?.getChildByName('InteriorDetail');
    if (detail) detail.active = true;
    const shell = station.getChildByName('DetailedOutpostGLB');
    if (shell) shell.active = !active;
  }

  public update(playerPosition: Readonly<Vec3>, deltaTime = 0): void {
    this.stationAnimationTime += Math.min(Math.max(deltaTime, 0), 0.05);
    const centerX = Math.floor(playerPosition.x / CHUNK_SIZE);
    const centerZ = Math.floor(playerPosition.z / CHUNK_SIZE);
    const desired = new Map<string, readonly [number, number]>();
    for (let offsetZ = -this.profile.recycleRadius; offsetZ <= this.profile.recycleRadius; offsetZ += 1) {
      for (let offsetX = -this.profile.recycleRadius; offsetX <= this.profile.recycleRadius; offsetX += 1) {
        const gridX = centerX + offsetX;
        const gridZ = centerZ + offsetZ;
        desired.set(chunkKey(gridX, gridZ), [gridX, gridZ]);
      }
    }

    for (const [key, chunk] of this.activeChunks) {
      if (!desired.has(key)) {
        this.activeChunks.delete(key);
        chunk.root.active = false;
        this.chunkPool.push(chunk);
      }
    }

    for (const [key, [gridX, gridZ]] of desired) {
      if (this.activeChunks.has(key)) {
        continue;
      }
      const chunk = this.chunkPool.pop();
      if (!chunk) {
        throw new Error('World chunk pool was exhausted');
      }
      this.recycleChunk(chunk, gridX, gridZ);
      this.activeChunks.set(key, chunk);
    }
    this.animateStations();
  }

  private loadDetailedOutpost(modelRoot: 'models' | 'models-low'): void {
    resources.load(`${modelRoot}/stations/outpost/outpost`, Prefab, (error: Error | null, prefab: Prefab) => {
      if (this.disposed) return;
      if (error || !prefab) {
        if (modelRoot === 'models') {
          this.loadDetailedOutpost('models-low');
          return;
        }
        console.warn('[SpaceFight world] detailed outpost unavailable; keeping modular fallback', error);
        return;
      }
      this.detailedOutpost = prefab;
      const approach = this.activeChunks.get(chunkKey(0, 0));
      if (approach) this.updateOutpostExterior(approach.station, true);
    });
  }

  private updateOutpostExterior(station: Node, isApproach: boolean): void {
    if (!this.detailedOutpost) return;
    let visual = station.getChildByName('DetailedOutpostGLB');
    if (!visual && isApproach) {
      visual = instantiate(this.detailedOutpost);
      visual.name = 'DetailedOutpostGLB';
      visual.setParent(station);
    }
    if (!visual) return;
    // 舱内行走态下外壳必须保持隐藏（它的背面会包住舱室成为纯色挡墙）。
    visual.active = isApproach && !this.interiorMode;
    const fallbackExterior = new Set([
      'StationRing.UpperAssembly',
      'StationRing.LowerAssembly',
      'StationCore',
      'StationHub.Upper',
      'StationHub.Lower',
      'StationAntenna',
      'StationArmorShell',
      'CommandDeck',
    ]);
    for (const child of station.children) {
      if (fallbackExterior.has(child.name) || child.name.startsWith('DockingArm.')) {
        child.active = !isApproach;
      }
    }
  }

  public recycleChunk(chunk: WorldChunk, gridX: number, gridZ: number): void {
    chunk.gridX = gridX;
    chunk.gridZ = gridZ;
    const isSpawnChunk = gridX === 0 && gridZ === 0;
    this.updateOutpostExterior(chunk.station, isSpawnChunk);
    const stationChunk = isSpawnChunk || Math.abs(gridX * 17 + gridZ * 31) % 11 === 0;
    const facilityIndex = Math.abs(gridX * 13 + gridZ * 23) % 11;
    const facilityChunk = !stationChunk && facilityIndex < 6;
    chunk.root.name = stationChunk
      ? isSpawnChunk ? 'OutpostApproach' : `StationChunk[${gridX},${gridZ}]`
      : facilityChunk ? `FacilityChunk[${gridX},${gridZ}]` : `DebrisChunk[${gridX},${gridZ}]`;
    chunk.station.active = stationChunk;
    chunk.facility.active = facilityChunk;
    // The approach lane keeps lightweight asteroid cover even when the outpost occupies the chunk.
    chunk.debris.active = isSpawnChunk || (!stationChunk && !facilityChunk);
    chunk.facility.children.forEach((child: Node, index: number) => {
      child.active = facilityChunk && index === facilityIndex;
    });
    const stationScale = isSpawnChunk
      ? 1.42
      : 0.88 + hashCoordinate(gridX, gridZ, 8) * 0.34;
    chunk.station.setScale(stationScale, stationScale, stationScale);
    // 只有主前哨点亮细节内景：玩家真正走进去的是这一座，远处的站仍保持低开销。
    const interiorDetail = chunk.station.getChildByName('StationInterior')?.getChildByName('InteriorDetail');
    if (interiorDetail) interiorDetail.active = isSpawnChunk;

    const driftX = (hashCoordinate(gridX, gridZ, 1) - 0.5) * CHUNK_SIZE * 0.42;
    const driftY = (hashCoordinate(gridX, gridZ, 2) - 0.5) * 18;
    const driftZ = (hashCoordinate(gridX, gridZ, 3) - 0.5) * CHUNK_SIZE * 0.42;
    const chunkPosition = isSpawnChunk ? new Vec3(
      PRIMARY_OUTPOST_POSITION.x,
      PRIMARY_OUTPOST_POSITION.y,
      PRIMARY_OUTPOST_POSITION.z,
    ) : new Vec3(
      gridX * CHUNK_SIZE + driftX,
      driftY,
      gridZ * CHUNK_SIZE + driftZ,
    );
    chunk.root.setPosition(chunkPosition);
    if (isSpawnChunk) {
      chunk.root.setRotationFromEuler(9, -24, 6);
    } else {
      chunk.root.setRotationFromEuler(
        hashCoordinate(gridX, gridZ, 4) * 35,
        hashCoordinate(gridX, gridZ, 5) * 360,
        hashCoordinate(gridX, gridZ, 6) * 25,
      );
    }

    for (let index = 0; index < chunk.debris.children.length; index += 1) {
      const asteroid = chunk.debris.children[index];
      if (isSpawnChunk && index < APPROACH_COVER_LAYOUT.length) {
        const [x, y, z, yaw, scale] = APPROACH_COVER_LAYOUT[index];
        asteroid.name = `ApproachCover.${index + 1}`;
        asteroid.setPosition(x, y, z);
        asteroid.setRotationFromEuler(0, yaw, index % 3 === 0 ? 6 : 0);
        asteroid.setScale(scale, scale, scale);
      } else {
        asteroid.name = `Debris.${index}`;
        asteroid.setPosition(
          (hashCoordinate(gridX, gridZ, index * 4 + 10) - 0.5) * CHUNK_SIZE * 0.74,
          (hashCoordinate(gridX, gridZ, index * 4 + 11) - 0.5) * 22,
          (hashCoordinate(gridX, gridZ, index * 4 + 12) - 0.5) * CHUNK_SIZE * 0.74,
        );
        asteroid.setRotationFromEuler(
          hashCoordinate(gridX, gridZ, index * 4 + 14) * 180,
          hashCoordinate(gridX, gridZ, index * 4 + 15) * 360,
          hashCoordinate(gridX, gridZ, index * 4 + 16) * 180,
        );
        const scale = 0.6 + hashCoordinate(gridX, gridZ, index * 4 + 13) * 2.8;
        // 三轴不等比例 + 各自随机偏斜，避免所有碎石变成同款正方块堆在星空里。
        asteroid.setScale(
          scale * (0.7 + hashCoordinate(gridX, gridZ, index * 7 + 20) * 0.7),
          scale * 0.55,
          scale * (0.8 + hashCoordinate(gridX, gridZ, index * 7 + 21) * 0.6),
        );
      }
    }
    chunk.root.active = true;
  }

  private createChunk(index: number): WorldChunk {
    const root = new Node(`DebrisChunk.Pooled.${index}`);
    root.setParent(this.parent);

    const station = new Node('StationChunk');
    station.setParent(root);
    const upperRing = new Node('StationRing.UpperAssembly');
    upperRing.setParent(station);
    const upperRingMesh = this.addStationPart(upperRing, 'StationRing.Upper', this.stationRingMesh, this.stationMaterial);
    upperRingMesh.setPosition(0, 2.5, 0);
    const lowerRing = new Node('StationRing.LowerAssembly');
    lowerRing.setParent(station);
    lowerRing.setRotationFromEuler(68, 0, 0);
    const lowerRingMesh = this.addStationPart(lowerRing, 'StationRing.Lower', this.stationRingMesh, this.stationGlowMaterial);
    lowerRingMesh.setPosition(0, -2.4, 0);

    this.addStationPart(station, 'StationCore', this.stationCoreMesh, this.stationMaterial);
    const upperHub = this.addStationPart(station, 'StationHub.Upper', this.stationHubMesh, this.stationDarkMaterial);
    upperHub.setPosition(0, 2.4, 0);
    const lowerHub = this.addStationPart(station, 'StationHub.Lower', this.stationHubMesh, this.stationDarkMaterial);
    lowerHub.setPosition(0, -2.4, 0);
    const antenna = this.addStationPart(station, 'StationAntenna', this.stationAntennaMesh, this.stationGlowMaterial);
    antenna.setPosition(0, 4.25, 0);

    for (let armIndex = 0; armIndex < 4; armIndex += 1) {
      const angle = armIndex * 90;
      const arm = new Node(`DockingArm.${armIndex + 1}`);
      arm.setParent(station);
      arm.setRotationFromEuler(0, angle, 0);
      const beam = this.addStationPart(arm, 'Truss', this.stationArmMesh, this.stationDarkMaterial);
      beam.setPosition(5.8, 0, 0);
      const dock = this.addStationPart(arm, 'Dock', this.stationDockMesh, this.stationMaterial);
      dock.setPosition(10.4, 0, 0);
      const panel = this.addStationPart(arm, 'Radiator', this.stationPanelMesh, this.stationGlowMaterial);
      panel.setPosition(7.2, armIndex % 2 === 0 ? 1.05 : -1.05, 0);
      const beacon = this.addStationPart(arm, 'Beacon', this.stationBeaconMesh, this.stationBeaconMaterial);
      beacon.setPosition(11.9, 0.9, 0);
      beacon.setScale(1.15, 1.15, 1.15);
    }
    this.createStationArchitecture(station);
    const stationCollider = station.addComponent(SphereCollider);
    stationCollider.radius = 5.4;

    const debris = new Node('DebrisChunk');
    debris.setParent(root);
    const debrisCount = this.profile.debrisPerChunk[index];
    for (let debrisIndex = 0; debrisIndex < debrisCount; debrisIndex += 1) {
      const asteroid = new Node(`Debris.${debrisIndex}`);
      asteroid.setParent(debris);
      const renderer = asteroid.addComponent(MeshRenderer);
      const coverKind = debrisIndex % 5;
      // 2/5 比例的近场掩体保留 box/柱体（有碰撞价值），但材质一律用暗岩石色；
      // 其余 3/5 用不规则球体当远景碎石，减少「整齐方块斑点」的观感。
      renderer.mesh = coverKind === 0
        ? this.approachWallMesh
        : coverKind === 1 ? this.approachCargoMesh
          : coverKind === 2 ? this.approachPylonMesh : this.asteroidMesh;
      renderer.setMaterial(
        coverKind === 1 ? this.debrisAccentMaterial : this.debrisMaterial,
        0,
      );
      if (this.profile.debrisColliders
          && debrisIndex < this.profile.debrisCollidersPerChunk[index]) {
        const collider = asteroid.addComponent(SphereCollider);
        collider.radius = coverKind < 3 ? 1.2 : 0.82;
      }
    }

    const facility = this.createFacilitySet(root);

    root.active = false;
    return { root, station, facility, debris, gridX: 0, gridZ: 0 };
  }

  private createFacilitySet(parent: Node): Node {
    const facility = new Node('FacilitySet');
    facility.setParent(parent);

    const cargo = new Node('CargoDepot');
    cargo.setParent(facility);
    for (let index = -1; index <= 1; index += 1) {
      const module = this.addStationPart(cargo, `CargoModule.${index + 2}`, this.facilityBlockMesh,
        index === 0 ? this.stationMaterial : this.stationDarkMaterial);
      module.setPosition(index * 4.3, 0, 0);
    }
    const cargoBeacon = this.addStationPart(cargo, 'CargoBeacon', this.stationBeaconMesh, this.stationBeaconMaterial);
    cargoBeacon.setPosition(0, 1.4, -2.4);

    const gate = new Node('JumpGate');
    gate.setParent(facility);
    this.addStationPart(gate, 'JumpGate.Ring', this.jumpGateMesh, this.stationGlowMaterial);
    const gateSpine = this.addStationPart(gate, 'JumpGate.Spine', this.facilityBeamMesh, this.stationDarkMaterial);
    gateSpine.setRotationFromEuler(0, 90, 0);

    const relay = new Node('RelayBeacon');
    relay.setParent(facility);
    const relayMast = this.addStationPart(relay, 'RelayBeacon.Mast', this.stationAntennaMesh, this.stationMaterial);
    relayMast.setScale(2.2, 2.2, 2.2);
    const relayLight = this.addStationPart(relay, 'RelayBeacon.Light', this.stationBeaconMesh, this.stationBeaconMaterial);
    relayLight.setPosition(0, 3.25, 0);
    relayLight.setScale(2, 2, 2);

    const derelict = new Node('DerelictHull');
    derelict.setParent(facility);
    const derelictCore = this.addStationPart(derelict, 'DerelictHull.Core', this.facilityBlockMesh, this.debrisMaterial);
    derelictCore.setRotationFromEuler(14, -18, 22);
    for (const side of [-1, 1]) {
      const beam = this.addStationPart(derelict, `DerelictHull.Beam.${side < 0 ? 'L' : 'R'}`,
        this.facilityBeamMesh, this.stationDarkMaterial);
      beam.setPosition(side * 2.5, 0.3, 0.4);
      beam.setRotationFromEuler(side * 8, side * 34, 74);
    }

    const refinery = new Node('RefineryArray');
    refinery.setParent(facility);
    for (const side of [-1, 1]) {
      const tank = this.addStationPart(
        refinery,
        `RefineryTank.${side < 0 ? 'L' : 'R'}`,
        this.stationCoreMesh,
        this.stationInteriorMaterial,
      );
      tank.setPosition(side * 3.2, 0, 0);
      tank.setScale(0.72, 0.72, 0.72);
      const pipe = this.addStationPart(
        refinery,
        `RefineryPipe.${side < 0 ? 'L' : 'R'}`,
        this.facilityBeamMesh,
        this.stationDarkMaterial,
      );
      pipe.setPosition(side * 1.7, 1.2, 0);
      pipe.setRotationFromEuler(0, 90, 0);
    }

    const defense = new Node('DefensePlatform');
    defense.setParent(facility);
    const defenseDeck = this.addStationPart(
      defense,
      'DefensePlatform.Deck',
      this.stationDockMesh,
      this.stationMaterial,
    );
    defenseDeck.setScale(2.1, 0.62, 2.1);
    for (const side of [-1, 1]) {
      const turret = this.addStationPart(
        defense,
        `DefenseTurret.${side < 0 ? 'L' : 'R'}`,
        this.stationAntennaMesh,
        this.stationDarkMaterial,
      );
      turret.setPosition(side * 2.5, 1.65, 0);
      turret.setRotationFromEuler(90, 0, 0);
      turret.setScale(1.35, 1.35, 1.35);
    }
    return facility;
  }

  private createStationArchitecture(station: Node): void {
    const shell = new Node('StationArmorShell');
    shell.setParent(station);
    for (const side of [-1, 1]) {
      const armor = this.addStationPart(
        shell,
        `StationArmorShell.${side < 0 ? 'Port' : 'Starboard'}`,
        this.armorShellMesh,
        side < 0 ? this.stationMaterial : this.stationDarkMaterial,
      );
      armor.setPosition(side * 4.35, 0, 0.2);
      armor.setRotationFromEuler(0, side * 9, side * 3);
    }

    const commandDeck = this.addStationPart(
      station,
      'CommandDeck',
      this.commandDeckMesh,
      this.stationGlassMaterial,
    );
    commandDeck.setPosition(0, 3.65, 1.5);

    const hangar = new Node('HangarMouth');
    hangar.setParent(station);
    hangar.setPosition(0, -0.25, 7.2);
    for (const side of [-1, 1]) {
      const frame = this.addStationPart(
        hangar,
        `HangarMouth.Frame.${side < 0 ? 'L' : 'R'}`,
        this.hangarFrameMesh,
        this.stationMaterial,
      );
      frame.setPosition(side * 3.55, 0, 0);
      const guidance = this.addStationPart(
        hangar,
        `HangarGuidance.${side < 0 ? 'L' : 'R'}`,
        this.stationBeaconMesh,
        this.stationBeaconMaterial,
      );
      guidance.setPosition(side * 3.15, -1.75, 0.4);
      guidance.setScale(1.4, 1.4, 1.4);
    }
    const header = this.addStationPart(hangar, 'HangarMouth.Header', this.stationArmMesh, this.stationDarkMaterial);
    header.setPosition(0, 2.15, 0);
    const threshold = this.addStationPart(hangar, 'HangarMouth.Threshold', this.stationArmMesh, this.stationInteriorMaterial);
    threshold.setPosition(0, -2.15, 0);

    const interior = new Node('StationInterior');
    interior.setParent(station);
    const deck = this.addStationPart(interior, 'InteriorDeck', this.hangarDeckMesh, this.stationInteriorMaterial);
    deck.setPosition(0, -2.25, 2.3);
    const ceiling = this.addStationPart(interior, 'InteriorCeiling', this.hangarDeckMesh, this.stationDarkMaterial);
    ceiling.setPosition(0, 2.25, 2.3);
    const corridor = new Node('InteriorCorridor');
    corridor.setParent(interior);
    corridor.setPosition(0, 0, 1.6);
    for (const side of [-1, 1]) {
      const wall = this.addStationPart(
        corridor,
        `InteriorCorridor.Wall.${side < 0 ? 'L' : 'R'}`,
        this.corridorWallMesh,
        this.stationDarkMaterial,
      );
      wall.setPosition(side * 3.45, 0, 0);
    }
    for (const side of [-1, 1]) {
      const door = this.addStationPart(
        corridor,
        `InteriorBulkheadDoor.${side < 0 ? 'L' : 'R'}`,
        this.bulkheadMesh,
        this.stationMaterial,
      );
      door.setPosition(side * 1.12, 0, -3.85);
    }
    for (const [index, x, z] of [[0, -2.2, 1.9], [1, 2.15, 0.2], [2, -1.8, -1.3]] as const) {
      const cover = this.addStationPart(
        corridor,
        `InteriorCover.${index + 1}`,
        this.interiorCoverMesh,
        index === 1 ? this.stationMaterial : this.stationDarkMaterial,
      );
      cover.setPosition(x, -1.55, z);
      cover.setRotationFromEuler(0, index * 17, 0);
    }
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const guide = this.addStationPart(
          corridor,
          `InteriorGuidance.${side < 0 ? 'L' : 'R'}.${index + 1}`,
          this.stationBeaconMesh,
          this.stationGlowMaterial,
        );
        guide.setPosition(side * 2.75, -2.02, 3.2 - index * 2.1);
        guide.setScale(0.72, 0.72, 0.72);
      }
    }
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const rib = this.addStationPart(
          corridor,
          `InteriorWallRib.${side < 0 ? 'L' : 'R'}.${index + 1}`,
          this.hangarFrameMesh,
          this.stationMaterial,
        );
        rib.setPosition(side * 3.18, 0, 3.25 - index * 2.2);
        rib.setScale(0.72, 0.72, 0.72);
      }
    }
    for (let index = 0; index < 3; index += 1) {
      const rail = this.addStationPart(
        corridor,
        `InteriorCeilingRail.${index + 1}`,
        this.stationArmMesh,
        this.stationDarkMaterial,
      );
      rail.setPosition(0, 1.92, 2.5 - index * 2.8);
      rail.setScale(0.72, 0.32, 0.42);
    }
    const serviceKiosk = this.addStationPart(
      corridor,
      'InteriorServiceKiosk',
      this.stationDockMesh,
      this.stationMaterial,
    );
    serviceKiosk.setPosition(2.55, -1.15, 2.25);
    serviceKiosk.setScale(0.52, 0.72, 0.46);
    const kioskScreen = this.addStationPart(
      serviceKiosk,
      'InteriorServiceKiosk.Screen',
      this.stationPanelMesh,
      this.stationGlowMaterial,
    );
    kioskScreen.setPosition(0, 0.48, -1.1);
    kioskScreen.setScale(0.52, 0.52, 0.52);
    const workbench = this.addStationPart(
      corridor,
      'InteriorWorkbench',
      this.stationDockMesh,
      this.stationInteriorMaterial,
    );
    workbench.setPosition(-2.48, -1.42, 1.05);
    workbench.setScale(0.68, 0.34, 0.5);
    for (let index = 0; index < 3; index += 1) {
      const cargoRack = this.addStationPart(
        corridor,
        `InteriorCargoRack.${index + 1}`,
        this.interiorCoverMesh,
        index === 1 ? this.stationMaterial : this.stationDarkMaterial,
      );
      cargoRack.setPosition(-2.7, -1.25 + index * 0.72, -2.15);
      cargoRack.setScale(0.82, 0.48, 0.58);
    }
    for (const side of [-1, 1]) {
      const landingMark = this.addStationPart(
        interior,
        `InteriorLandingMark.${side < 0 ? 'L' : 'R'}`,
        this.stationPanelMesh,
        this.stationGlowMaterial,
      );
      landingMark.setPosition(side * 1.75, -2.06, 3.4);
      landingMark.setScale(0.72, 0.45, 1.4);
    }
    // 细节化内景只在主前哨（chunk 0,0）点亮；其余站的同一份节点保持 inactive，
    // 既有完整建模可复用，又不会让 25 个远景物块同时多出上百个渲染体。
    this.createStationInteriorDetail(interior);
  }

  /**
   * 站内细节化建模：甲板砖 / 墙板 / 舷窗 / 灯带 / 管线 / 终端台 / 机务 / 机库门。
   * 坐标与 StationWalkSystem 的 (x,z) 完全一致，父节点是 StationInterior 本体（不含 corridor 偏移）。
   */
  private createStationInteriorDetail(interior: Node): void {
    const detail = new Node('InteriorDetail');
    detail.setParent(interior);
    detail.active = false;
    const part = (
      name: string,
      mesh: MeshRenderer['mesh'],
      material: Material,
      x: number, y: number, z: number,
      rotation: readonly [number, number, number] | null = null,
      scale: readonly [number, number, number] | null = null,
    ): Node => {
      const node = this.addStationPart(detail, name, mesh, material);
      node.setPosition(x, y, z);
      if (rotation) node.setRotationFromEuler(rotation[0], rotation[1], rotation[2]);
      if (scale) node.setScale(scale[0], scale[1], scale[2]);
      return node;
    };

    // 甲板：深浅交错的功能分区砖 + 两条贯穿走廊的引导灯带。
    for (let ix = 0; ix < 6; ix += 1) {
      for (let iz = 0; iz < 7; iz += 1) {
        const x = -2.75 + ix * 1.1;
        const z = -3.2 + iz * 1.2;
        part(
          `DeckTile.${ix}.${iz}`,
          this.deckTileMesh,
          (ix + iz) % 3 === 0 ? this.stationPanelMaterial : this.stationDeckMaterial,
          x, -2.03, z,
        );
      }
    }
    for (const side of [-1, 1]) {
      for (let index = 0; index < 7; index += 1) {
        part(
          `DeckGuide.${side < 0 ? 'L' : 'R'}.${index + 1}`,
          this.deckStripMesh,
          this.stationLightMaterial,
          side * 1.1, -1.94, -3.0 + index * 1.15,
        );
      }
    }
    part('DeckEmblem', this.deckRingMesh, this.stationScreenMaterial, 0, -1.9, 0.35, null, [1.6, 1.6, 1.6]);

    // 侧壁：分块装甲板 + 竖向骨架 + 舷窗（深色玻璃 + 星点）+ 连续管线。
    for (const side of [-1, 1]) {
      const label = side < 0 ? 'Port' : 'Starboard';
      for (let index = 0; index < 6; index += 1) {
        const z = -3.2 + index * 1.36;
        part(
          `InteriorWallPanel.${label}.${index + 1}`,
          this.wallPanelMesh,
          index % 2 === 0 ? this.stationPanelMaterial : this.stationTrimMaterial,
          side * 3.4, -0.35, z,
        );
      }
      for (let index = 0; index < 5; index += 1) {
        part(
          `InteriorWallRib.${label}.${index + 1}`,
          this.wallRibMesh,
          this.stationTrimMaterial,
          side * 3.22, 0, -2.9 + index * 1.55,
        );
      }
      for (const index of [1, 4]) {
        const z = -3.2 + index * 1.36;
        part(
          `InteriorWindow.${label}.${index}`,
          this.windowMesh,
          this.stationWindowMaterial,
          side * 3.3, 0.45, z,
        );
        for (let star = 0; star < 4; star += 1) {
          part(
            `WindowStar.${label}.${index}.${star}`,
            this.stationStarMesh,
            this.stationLightMaterial,
            side * 3.22, 0.2 + star * 0.18, z - 0.42 + star * 0.27,
          );
        }
      }
      part(
        `InteriorConduit.${label}`,
        this.pipeMesh,
        this.stationTrimMaterial,
        side * 3.05, 1.42, 0.2,
        [90, 0, 0],
      );
      part(
        `InteriorRail.${label}`,
        this.railMesh,
        this.stationWarmMaterial,
        side * 2.95, -1.15, 0.35,
      );
      for (let index = 0; index < 3; index += 1) {
        part(
          `CargoCrate.${label}.${index + 1}`,
          this.crateMesh,
          index === 1 ? this.stationPanelMaterial : this.stationTrimMaterial,
          side * 2.75, -1.68 + index * 0.03, -2.45 + index * 1.3,
          null,
          [1 - index * 0.12, 0.9 + index * 0.12, 1],
        );
      }
    }

    // 顶部：灯板 + 横梁 + 走线，给舱室一个明确的「天花板」，挡住外部方块穿帮。
    for (let index = 0; index < 6; index += 1) {
      const z = -2.9 + index * 1.25;
      for (const x of [-2.15, -0.72, 0.72, 2.15]) {
        part(
          `CeilingPanel.${x}.${index}`,
          this.ceilingPanelMesh,
          Math.abs(x) < 1 ? this.stationLightMaterial : this.stationDeckMaterial,
          x, 2.08, z,
        );
      }
      if (index % 2 === 0) {
        part(`CeilingBeam.${index}`, this.ceilingBeamMesh, this.stationTrimMaterial, 0, 1.96, z);
      }
    }

    // 五个交互点的实体化模型：终端台底座 / 倾斜屏幕 / 悬浮光柱 / 地面光圈。
    for (const terminal of STATION_WALK_TERMINALS) {
      if (terminal.id === 'undock') continue;
      const accent = terminal.id === 'mechanic' ? this.stationWarmMaterial : this.stationScreenMaterial;
      part(`TerminalBase.${terminal.id}`, this.consoleMesh, this.stationTrimMaterial,
        terminal.x, -1.48, terminal.z);
      part(`TerminalScreen.${terminal.id}`, this.consoleScreenMesh, accent,
        terminal.x, -0.92, terminal.z - 0.28, [-18, 0, 0]);
      part(`TerminalHolo.${terminal.id}`, this.holoMesh, accent,
        terminal.x, -0.38, terminal.z, null, [0.8, 1, 0.8]);
      part(`TerminalRing.${terminal.id}`, this.deckRingMesh, this.stationLightMaterial,
        terminal.x, -1.9, terminal.z, null, [1.05, 1.05, 1.05]);
    }

    // 机务 R-7： torso + 头 + 面罩，和纯光柱终端一眼区分。
    part('MechanicR7.Torso', this.consoleMesh, this.stationWarmMaterial, 0, -1.15, -1.1, null, [0.65, 1.25, 0.55]);
    part('MechanicR7.Head', this.stationStarMesh, this.stationTrimMaterial, 0, -0.35, -1.1, null, [6, 6, 6]);
    part('MechanicR7.Visor', this.consoleScreenMesh, this.stationDeckMaterial, 0, -0.33, -0.83, null, [0.55, 0.35, 1]);

    // 机库出口：双立柱 + 顶梁 + 警示灯，玩家一眼知道「这里能离港」。
    part('HangarGate.Left', this.wallRibMesh, this.stationTrimMaterial, -2.55, -0.1, 3.95, null, [1.1, 1, 1.1]);
    part('HangarGate.Right', this.wallRibMesh, this.stationTrimMaterial, 2.55, -0.1, 3.95, null, [1.1, 1, 1.1]);
    part('HangarGate.Header', this.ceilingBeamMesh, this.stationPanelMaterial, 0, 1.7, 3.95, null, [1.05, 1.4, 1.2]);
    part('HangarGate.Glow', this.deckRingMesh, this.stationWarmMaterial, 0, -1.88, 3.55, null, [2.4, 2.4, 2.4]);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        part(
          `HangarWarning.${side < 0 ? 'L' : 'R'}.${index + 1}`,
          this.deckStripMesh,
          this.stationWarmMaterial,
          side * (1.4 + index * 0.35), -1.9, 3.3,
        );
      }
    }
  }

  private animateStations(): void {
    const upperRotation = this.stationAnimationTime * 7.5;
    const lowerRotation = -this.stationAnimationTime * 5.2;
    const beaconScale = 0.82 + ((Math.sin(this.stationAnimationTime * 4.8) + 1) * 0.22);
    for (const chunk of this.activeChunks.values()) {
      if (chunk.station.active) {
        chunk.station.getChildByName('StationRing.UpperAssembly')
          ?.setRotationFromEuler(0, upperRotation, 0);
        chunk.station.getChildByName('StationRing.LowerAssembly')
          ?.setRotationFromEuler(68, lowerRotation, 0);
        for (const arm of chunk.station.children.filter((child: Node) => child.name.startsWith('DockingArm.'))) {
          arm.getChildByName('Beacon')?.setScale(beaconScale, beaconScale, beaconScale);
        }
      }
      if (chunk.facility.active) {
        chunk.facility.getChildByName('JumpGate')
          ?.getChildByName('JumpGate.Ring')?.setRotationFromEuler(0, upperRotation * 1.8, 0);
        chunk.facility.getChildByName('RelayBeacon')
          ?.getChildByName('RelayBeacon.Light')?.setScale(beaconScale * 1.8, beaconScale * 1.8, beaconScale * 1.8);
        chunk.facility.getChildByName('DerelictHull')
          ?.setRotationFromEuler(12, lowerRotation * 0.35, 18);
      }
    }
  }

  private addStationPart(
    parent: Node,
    name: string,
    mesh: MeshRenderer['mesh'],
    material: Material,
  ): Node {
    const part = new Node(name);
    part.setParent(parent);
    const renderer = part.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setMaterial(material, 0);
    return part;
  }

  /**
   * 切换画质档 / 销毁时显式释放自建的 7 份材质与 22 个运行时网格
   * （Cocos 3.8 的 Asset.destroy），避免这些 GPU 资源在场景切换后常驻。
   */
  public dispose(): void {
    this.disposed = true;
    const materials: Material[] = [
      this.stationMaterial,
      this.stationGlowMaterial,
      this.stationDarkMaterial,
      this.stationBeaconMaterial,
      this.stationInteriorMaterial,
      this.stationGlassMaterial,
      this.stationDeckMaterial,
      this.stationPanelMaterial,
      this.stationTrimMaterial,
      this.stationLightMaterial,
      this.stationScreenMaterial,
      this.stationWarmMaterial,
      this.stationWindowMaterial,
      this.debrisMaterial,
    ];
    const meshes = [
      this.stationRingMesh,
      this.stationCoreMesh,
      this.stationHubMesh,
      this.stationArmMesh,
      this.stationDockMesh,
      this.stationPanelMesh,
      this.stationBeaconMesh,
      this.armorShellMesh,
      this.hangarFrameMesh,
      this.hangarDeckMesh,
      this.corridorWallMesh,
      this.bulkheadMesh,
      this.interiorCoverMesh,
      this.commandDeckMesh,
      this.stationAntennaMesh,
      this.facilityBlockMesh,
      this.facilityBeamMesh,
      this.approachWallMesh,
      this.approachCargoMesh,
      this.approachPylonMesh,
      this.jumpGateMesh,
      this.asteroidMesh,
      this.deckTileMesh,
      this.deckStripMesh,
      this.wallPanelMesh,
      this.wallRibMesh,
      this.windowMesh,
      this.pipeMesh,
      this.ceilingPanelMesh,
      this.ceilingBeamMesh,
      this.consoleMesh,
      this.consoleScreenMesh,
      this.holoMesh,
      this.crateMesh,
      this.railMesh,
      this.deckRingMesh,
      this.stationStarMesh,
    ];
    for (const material of materials) material.destroy();
    for (const mesh of meshes) mesh.destroy();
    this.activeChunks.clear();
    this.chunkPool.length = 0;
  }
}
