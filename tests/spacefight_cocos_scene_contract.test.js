'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const assetsRoot = path.join(projectRoot, 'assets');
const gameRoot = path.join(assetsRoot, 'scripts', 'game');
const scenePath = path.join(assetsRoot, 'scenes', 'Combat.scene');
const sourceModelRoot = path.join(
  repositoryRoot,
  'website',
  'spacefight.zhengzhengstudio.cn',
  'assets',
  'models',
);
const importedModelRoot = path.join(assetsRoot, 'spacefight-high', 'models', 'ships');
const modelNames = [
  'interceptor',
  'scout',
  'fighter',
  'bomber',
  'gunship',
  'boss',
];
const gameScripts = [
  'CombatBootstrap.ts',
  'ShipPresenter.ts',
  'ProjectilePresenter.ts',
  'WorldStreamer.ts',
];

function readText(filePath) {
  assert.equal(existsSync(filePath), true, `Missing ${path.relative(repositoryRoot, filePath)}`);
  return readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let compressed = hex.slice(0, 5);
  for (let offset = 5; offset < hex.length; offset += 3) {
    const value = Number.parseInt(hex.slice(offset, offset + 3), 16);
    compressed += alphabet[value >> 6];
    compressed += alphabet[value & 63];
  }
  return compressed;
}

test('Combat.scene is a valid serialized scene wired to CombatBootstrap', () => {
  const serialized = readJson(scenePath);
  assert.equal(Array.isArray(serialized), true);
  assert.equal(serialized[0].__type__, 'cc.SceneAsset');
  assert.equal(serialized[1].__type__, 'cc.Scene');

  const nodes = serialized.filter((entry) => entry.__type__ === 'cc.Node');
  const bootstrapNode = nodes.find((entry) => entry._name === 'CombatBootstrap');
  const cameraNode = nodes.find((entry) => entry._name === 'CombatCamera');
  const keyLightNode = nodes.find((entry) => entry._name === 'KeyLight');
  assert.ok(bootstrapNode, 'Scene must contain the runtime bootstrap node');
  assert.ok(cameraNode, 'Scene must serialize a real perspective camera');
  assert.ok(keyLightNode, 'Scene must serialize a directional key light');

  const scriptMeta = readJson(path.join(gameRoot, 'CombatBootstrap.ts.meta'));
  const bootstrapComponentType = compressUuid(scriptMeta.uuid);
  const bootstrapComponent = serialized.find(
    (entry) => entry.__type__ === bootstrapComponentType,
  );
  assert.ok(bootstrapComponent, 'Scene must attach the imported CombatBootstrap component');
  assert.equal(bootstrapComponent.node.__id__, serialized.indexOf(bootstrapNode));

  const camera = serialized.find((entry) => entry.__type__ === 'cc.Camera');
  const light = serialized.find((entry) => entry.__type__ === 'cc.DirectionalLight');
  const globals = serialized.find((entry) => entry.__type__ === 'cc.SceneGlobals');
  const shadows = serialized.find((entry) => entry.__type__ === 'cc.ShadowsInfo');
  assert.equal(camera._projection, 1);
  assert.ok(camera._far >= 2000, 'Camera must see recyclable distant chunks');
  assert.ok(light._illuminance > 0);
  assert.ok(globals);
  assert.equal(shadows._enabled, false, 'Cold start must not allocate shadow maps before scripts run');
  assert.ok(shadows._size.x <= 1024);
  const bootstrapSource = readFileSync(path.join(gameRoot, 'CombatBootstrap.ts'), 'utf8');
  assert.match(bootstrapSource, /const shadowsEnabled = !sys\.isBrowser && this\.graphicsProfile\.shadows/);
  assert.match(bootstrapSource, /this\.keyLight\.shadowEnabled = shadowsEnabled/);
});

test('approved GLB ships are copied byte-for-byte with Cocos metadata', () => {
  for (const name of modelNames) {
    const sourcePath = path.join(sourceModelRoot, `${name}.glb`);
    const importedPath = path.join(importedModelRoot, `${name}.glb`);
    const source = readFileSync(sourcePath);
    const imported = readFileSync(importedPath);
    assert.deepEqual(imported, source, `${name}.glb must be the approved source asset`);
    assert.equal(imported.subarray(0, 4).toString('ascii'), 'glTF');
    const modelMeta = readJson(`${importedPath}.meta`);
    assert.equal(modelMeta.importer, 'gltf');
    assert.equal(
      Object.values(modelMeta.subMetas).some((subMeta) => subMeta.importer === 'gltf-scene'),
      true,
      `${name}.glb must expose an imported prefab scene`,
    );
  }

  const taskAssets = [scenePath, ...gameScripts.map((name) => path.join(gameRoot, name))];
  for (const assetPath of taskAssets) {
    assert.equal(existsSync(`${assetPath}.meta`), true, `${assetPath}.meta is required`);
  }
});

test('ship presenter prefers imported models, exposes true muzzles, and keeps an emergency visible fallback', () => {
  const source = readText(path.join(gameRoot, 'ShipPresenter.ts'));
  assert.match(
    source,
    /PLAYER_MODEL_PATH\s*=\s*['"]models\/ships\/interceptor\/interceptor['"]/,
  );
  assert.match(source, /bundle\.load/);
  assert.match(source, /loadPrefab\(resources, model\.lowPath\)/);
  assert.match(source, /Prefab/);
  assert.match(source, /MODEL_NORMALIZATION/);
  assert.match(source, /Unknown ship model kind/);
  assert.match(source, /orientationY:\s*180/);
  assert.match(source, /throw new Error\([^)]*model/i);
  assert.match(source, /installFallbackVisual/);
  assert.match(source, /primitives\.box/);

  assert.match(source, /Muzzle\.Primary/);
  assert.match(source, /Muzzle\.Secondary/);
  assert.match(source, /worldPosition/);
  assert.match(source, /worldRotation/);
  assert.match(source, /CapsuleCollider/);
  assert.match(source, /RigidBody/);
});

test('projectiles use pooling, colliders, visible trails, and explicit recycling', () => {
  const source = readText(path.join(gameRoot, 'ProjectilePresenter.ts'));
  assert.match(source, /NodePool/);
  assert.match(source, /SphereCollider/);
  assert.match(source, /RigidBody/);
  assert.match(source, /Line/);
  assert.match(source, /ProjectileTrail/);
  assert.match(source, /activeProjectiles/);
  assert.match(source, /recycle/);
  assert.match(source, /snapshot\.projectiles/);
});

test('combat bootstrap builds lighting, particles, and damage feedback around snapshots', () => {
  const source = readText(path.join(gameRoot, 'CombatBootstrap.ts'));
  assert.match(source, /CombatSimulation/);
  assert.match(source, /ShipPresenter/);
  assert.match(source, /ProjectilePresenter/);
  assert.match(source, /WorldStreamer/);
  assert.match(source, /ParticleSystem/);
  assert.match(source, /SpeedParticles/);
  assert.match(source, /DamageFeedback/);
  assert.match(source, /DirectionalLight/);
  assert.match(source, /SphereLight/);
  assert.match(source, /shadow/i);
  assert.match(source, /simulation\.step/);
});

test('world streamer recycles station and debris chunks without an arena boundary', () => {
  const source = readText(path.join(gameRoot, 'WorldStreamer.ts'));
  assert.match(source, /CHUNK_SIZE/);
  assert.match(source, /RECYCLE_RADIUS/);
  assert.match(source, /StationChunk/);
  assert.match(source, /DebrisChunk/);
  assert.match(source, /recycleChunk/);
  assert.match(source, /playerPosition/);
  assert.doesNotMatch(source, /Arena(Boundary|Wall)|BoundaryWall|worldBoundary/);
});

test('runtime renderers copy Cocos precompiled materials instead of compiling raw effects', () => {
  const world = readText(path.join(gameRoot, 'WorldStreamer.ts'));
  const projectiles = readText(path.join(gameRoot, 'ProjectilePresenter.ts'));

  for (const source of [world, projectiles]) {
    assert.match(source, /builtinResMgr\.get<Material>\('missing-material'\)/);
    assert.match(source, /new Material\(\)/);
    assert.match(source, /material\.copy\(parent\)/);
    assert.doesNotMatch(source, /MaterialInstance/);
    assert.doesNotMatch(source, /effectName:\s*'builtin-(?:standard|unlit)'/);
  }
});

test('Task 3 gameplay compiles with exact TypeScript 4.9.5 syntax compatibility', (context) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'spacefight-cocos-scene-ts-'));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const ccTypesPath = path.join(temporaryRoot, 'cc.d.ts');
  writeFileSync(ccTypesPath, `
declare module 'cc' {
  export const _decorator: any;
  export const assetManager: any;
  export const builtinResMgr: { get<T>(name: string): T | null };
  export const director: any;
  export const game: any;
  export const geometry: any;
  export const input: any;
  export const Input: any;
  export const math: any;
  export const PhysicsSystem: any;
  export const primitives: any;
  export const resources: any;
  export const sys: any;
  export const tween: any;
  export const utils: any;
  export const view: any;
  export type Asset = any;
  export type Camera = any;
  export type Canvas = any;
  export type CapsuleCollider = any;
  export type Collider = any;
  export type Color = any;
  export type Component = any;
  export type CurveRange = any;
  export type DirectionalLight = any;
  export type GradientRange = any;
  export type Graphics = any;
  export type Label = any;
  export type Line = any;
  export type Material = any;
  export type MeshRenderer = any;
  export type Node = any;
  export type NodePool = any;
  export type ParticleSystem = any;
  export type Prefab = any;
  export type Quat = any;
  export type RigidBody = any;
  export type SphereCollider = any;
  export type SphereLight = any;
  export type Sprite = any;
  export type SpriteFrame = any;
  export type Texture2D = any;
  export type UIOpacity = any;
  export type Vec3 = any;
  export const Asset: any;
  export const Camera: any;
  export const Canvas: any;
  export const CapsuleCollider: any;
  export const Color: any;
  export const Component: any;
  export const CurveRange: any;
  export const DirectionalLight: any;
  export const EAxisDirection: any;
  export const GradientRange: any;
  export const Graphics: any;
  export const HorizontalTextAlignment: any;
  export const instantiate: any;
  export const KeyCode: any;
  export const Label: any;
  export const Layers: any;
  export const Line: any;
  export const Material: any;
  export const MaterialInstance: any;
  export const MeshRenderer: any;
  export const Node: any;
  export const NodePool: any;
  export const ParticleSystem: any;
  export const Prefab: any;
  export const Quat: any;
  export const RigidBody: any;
  export const SphereCollider: any;
  export const SphereLight: any;
  export const Sprite: any;
  export const SpriteFrame: any;
  export const Texture2D: any;
  export const UIOpacity: any;
  export const UITransform: any;
  export const Vec2: any;
  export const Vec3: any;
  export const VerticalTextAlignment: any;
  export type EventKeyboard = any;
  export const EventKeyboard: any;
  export type EventMouse = any;
  export const EventMouse: any;
  export type EventTouch = any;
  export const EventTouch: any;
  export type EventGamepad = any;
}
  `);

  const sourceFiles = [
    ccTypesPath,
    ...[
      'FlightCommand.ts',
      'FlightTuning.ts',
      'WeaponCatalog.ts',
      'CombatSimulation.ts',
    ].map((name) => path.join(assetsRoot, 'scripts', 'core', name)),
    ...gameScripts.map((name) => path.join(gameRoot, name)),
  ];
  const compile = spawnSync('npx', [
    '--yes',
    '--package',
    'typescript@4.9.5',
    'tsc',
    '--noEmit',
    '--target',
    'ES2020',
    '--module',
    'ESNext',
    '--moduleResolution',
    'node',
    '--strict',
    '--skipLibCheck',
    '--experimentalDecorators',
    ...sourceFiles,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);
});
