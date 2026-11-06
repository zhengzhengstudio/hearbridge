const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const modelRoots = [
  path.join(projectRoot, 'assets', 'resources', 'models-low', 'ships'),
  path.join(projectRoot, 'assets', 'spacefight-high', 'models', 'ships'),
];

const ships = {
  interceptor: { scale: 0.5, width: 0.68, length: 2.25, rear: 1.55, height: 0.45 },
  scout: { scale: 0.42, width: 0.62, length: 1.95, rear: 1.35, height: 0.38 },
  fighter: { scale: 0.35, width: 0.78, length: 2.35, rear: 1.7, height: 0.48 },
  bomber: { scale: 0.45, width: 0.96, length: 2.85, rear: 2.05, height: 0.58 },
  gunship: { scale: 0.32, width: 1.12, length: 3.25, rear: 2.35, height: 0.68 },
  boss: { scale: 0.72, width: 1.56, length: 4.15, rear: 3.0, height: 0.9 },
};

const SOCKET_PREFIX = 'socket_';

function modelTranslation(rootPosition, scale) {
  // ShipPresenter rotates imported models 180 degrees around Y.
  return [-rootPosition[0] / scale, rootPosition[1] / scale, -rootPosition[2] / scale];
}

function socketLayout(ship) {
  const { width, length, rear, height } = ship;
  return {
    socket_weapon_primary_l: [-width, -height * 0.12, -length],
    socket_weapon_primary_r: [width, -height * 0.12, -length],
    socket_weapon_secondary_l: [-width * 1.35, -height * 0.35, -length * 0.58],
    socket_weapon_secondary_r: [width * 1.35, -height * 0.35, -length * 0.58],
    socket_missile_l: [-width * 1.55, -height * 0.55, -length * 0.12],
    socket_missile_r: [width * 1.55, -height * 0.55, -length * 0.12],
    socket_engine_l: [-width * 0.82, 0, rear],
    socket_engine_r: [width * 0.82, 0, rear],
    socket_camera_cockpit: [0, height, -length * 0.34],
    socket_camera_chase: [0, height * 2.4, rear * 3.0],
  };
}

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
    throw new Error(`Unsupported GLB: ${file}`);
  }
  const chunks = [];
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    chunks.push({ type, data: data.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  const jsonChunk = chunks.find(chunk => chunk.type === 0x4e4f534a);
  if (!jsonChunk) throw new Error(`GLB JSON chunk missing: ${file}`);
  return { json: JSON.parse(jsonChunk.data.toString('utf8').trim()), chunks };
}

function encodeGlb(json, chunks) {
  const rawJson = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20);
  rawJson.copy(paddedJson);
  const outputChunks = [
    { type: 0x4e4f534a, data: paddedJson },
    ...chunks.filter(chunk => chunk.type !== 0x4e4f534a),
  ];
  const totalLength = 12 + outputChunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  let offset = 12;
  for (const chunk of outputChunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return output;
}

function rigModel(file, ship) {
  const { json, chunks } = readGlb(file);
  json.nodes = json.nodes || [];
  const oldSocketIndexes = new Set();
  json.nodes.forEach((node, index) => {
    if (node.name?.startsWith(SOCKET_PREFIX)) oldSocketIndexes.add(index);
  });
  if (oldSocketIndexes.size) {
    if (oldSocketIndexes.size === Object.keys(socketLayout(ship)).length
        && json.asset?.extras?.spacefightRigVersion === 1) {
      return false;
    }
    throw new Error(`Refusing to rewrite a partially rigged model: ${file}`);
  }
  const scene = json.scenes?.[json.scene || 0];
  const modelRootIndex = scene?.nodes?.[0];
  const modelRoot = json.nodes[modelRootIndex];
  if (!modelRoot) throw new Error(`Model scene root missing: ${file}`);
  modelRoot.children = modelRoot.children || [];
  for (const [name, rootPosition] of Object.entries(socketLayout(ship))) {
    const index = json.nodes.length;
    json.nodes.push({
      name,
      translation: modelTranslation(rootPosition, ship.scale),
      extras: { spacefightSocket: name.slice(SOCKET_PREFIX.length) },
    });
    modelRoot.children.push(index);
  }
  json.asset.extras = {
    ...(json.asset.extras || {}),
    spacefightRigVersion: 1,
  };
  fs.writeFileSync(file, encodeGlb(json, chunks));
  return true;
}

for (const [name, ship] of Object.entries(ships)) {
  for (const root of modelRoots) {
    const file = path.join(root, `${name}.glb`);
    const changed = rigModel(file, ship);
    process.stdout.write(`${changed ? 'Rigged' : 'Verified'} ${path.relative(projectRoot, file)}\n`);
  }
}
