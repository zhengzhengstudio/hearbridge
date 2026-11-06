const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MODEL_ROOTS = [
  path.join(ROOT, 'SpaceFight-Cocos', 'assets', 'resources', 'models-low', 'ships'),
  path.join(ROOT, 'SpaceFight-Cocos', 'assets', 'spacefight-high', 'models', 'ships'),
];
const SHIPS = ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss'];
const REQUIRED_SOCKETS = [
  'socket_weapon_primary_l',
  'socket_weapon_primary_r',
  'socket_weapon_secondary_l',
  'socket_weapon_secondary_r',
  'socket_missile_l',
  'socket_missile_r',
  'socket_engine_l',
  'socket_engine_r',
  'socket_camera_cockpit',
  'socket_camera_chase',
];

function readGlbJson(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.readUInt32LE(0), 0x46546c67, `${file} is not GLB`);
  assert.equal(data.readUInt32LE(12 + 4), 0x4e4f534a, `${file} has no JSON chunk`);
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

test('every ship GLB exposes the standard SpaceFight equipment rig', () => {
  for (const root of MODEL_ROOTS) {
    for (const ship of SHIPS) {
      const file = path.join(root, `${ship}.glb`);
      const gltf = readGlbJson(file);
      const names = new Set((gltf.nodes || []).map(node => node.name));
      for (const socket of REQUIRED_SOCKETS) {
        assert.ok(names.has(socket), `${path.relative(ROOT, file)} is missing ${socket}`);
      }
      assert.equal(gltf.asset?.extras?.spacefightRigVersion, 1);
    }
  }
});

test('ship presentation binds projectile origins to model-authored sockets', () => {
  const source = fs.readFileSync(path.join(
    ROOT,
    'SpaceFight-Cocos',
    'assets',
    'scripts',
    'game',
    'ShipPresenter.ts',
  ), 'utf8');
  assert.match(source, /socket_weapon_primary_l/);
  assert.match(source, /socket_weapon_primary_r/);
  assert.match(source, /findDescendant/);
});
