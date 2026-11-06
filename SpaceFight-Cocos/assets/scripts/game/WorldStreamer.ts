import {
  builtinResMgr,
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
  const parent = builtinResMgr.get<Material>('missing-material');
  if (!parent) throw new Error('Cocos precompiled unlit material is unavailable');
  const material = new Material();
  material.copy(parent);
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
  private readonly debrisMaterial = createMaterial(new Color(78, 72, 67, 255), 0.12, 0.92);
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

  public constructor(
    private readonly parent: Node,
    private readonly profile: WorldStreamProfile = DESKTOP_WORLD_PROFILE,
  ) {
    for (let index = 0; index < this.profile.activeWorldChunks; index += 1) {
      this.chunkPool.push(this.createChunk(index));
    }
    if (this.profile.detailedOutpost) this.loadDetailedOutpost();
  }

  private stationAnimationTime = 0;
  private detailedOutpost: Prefab | null = null;

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

  private loadDetailedOutpost(): void {
    resources.load('models/stations/outpost/outpost', Prefab, (error: Error | null, prefab: Prefab) => {
      if (error || !prefab) {
        console.warn('[SpaceFight world] detailed outpost unavailable; keeping modular fallback', error);
        return;
      }
      this.detailedOutpost = prefab;
      const chunks = [...this.chunkPool, ...this.activeChunks.values()];
      for (const chunk of chunks) this.installDetailedOutpost(chunk.station);
    });
  }

  private installDetailedOutpost(station: Node): void {
    if (!this.detailedOutpost || station.getChildByName('DetailedOutpostGLB')) return;
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
        child.active = false;
      }
    }
    const visual = instantiate(this.detailedOutpost);
    visual.name = 'DetailedOutpostGLB';
    visual.setParent(station);
    visual.setScale(1, 1, 1);
  }

  public recycleChunk(chunk: WorldChunk, gridX: number, gridZ: number): void {
    chunk.gridX = gridX;
    chunk.gridZ = gridZ;
    const isSpawnChunk = gridX === 0 && gridZ === 0;
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
        asteroid.setScale(scale, scale * 0.7, scale * 1.15);
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
      renderer.mesh = coverKind === 0
        ? this.approachWallMesh
        : coverKind === 1 ? this.approachCargoMesh
          : coverKind === 2 ? this.approachPylonMesh : this.asteroidMesh;
      renderer.setMaterial(
        coverKind === 0 || coverKind === 2 ? this.stationDarkMaterial
          : coverKind === 1 ? this.stationMaterial : this.debrisMaterial,
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
}
