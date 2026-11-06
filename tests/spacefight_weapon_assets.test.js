const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const cocos = path.join(root, 'SpaceFight-Cocos');
const weaponIds = ['pulse', 'scatter', 'missile', 'rail', 'plasma'];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function read(relativePath) {
  return fs.readFileSync(path.join(cocos, relativePath), 'utf8');
}

function readStaged(relativePath) {
  return childProcess.execFileSync('git', ['show', ':' + relativePath], {
    cwd: root,
    encoding: 'utf8',
  });
}

function withStagedTree(callback) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-weapon-assets-'));
  try {
    childProcess.execFileSync('git', ['checkout-index', '--all', '--prefix=' + temporaryRoot + path.sep], {
      cwd: root,
      stdio: 'pipe',
    });
    callback(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function inspectRgbaPng(relativePath) {
  const data = fs.readFileSync(path.join(cocos, relativePath));
  assert.deepEqual(data.subarray(0, 8), pngSignature, relativePath + ' is not a PNG');

  let offset = 8;
  let width;
  let height;
  let colorType;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, relativePath + ' must use 8-bit channels');
      colorType = chunk[9];
      assert.equal(chunk[10], 0, relativePath + ' must use standard PNG compression');
      assert.equal(chunk[11], 0, relativePath + ' must not use PNG filters');
      assert.equal(chunk[12], 0, relativePath + ' must not be interlaced');
    } else if (type === 'IDAT') {
      idat.push(chunk);
    }
    offset += length + 12;
    if (type === 'IEND') break;
  }

  assert.equal(colorType, 6, relativePath + ' must be RGBA so it has real alpha');
  const bytesPerRow = width * 4;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(bytesPerRow);
  let source = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++];
    const row = Buffer.alloc(bytesPerRow);
    for (let x = 0; x < bytesPerRow; x += 1) {
      const value = inflated[source++];
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 255;
      else if (filter === 2) row[x] = (value + above) & 255;
      else if (filter === 3) row[x] = (value + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        row[x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 255;
      } else {
        assert.fail(relativePath + ' uses unsupported PNG filter ' + filter);
      }
    }
    row.copy(rgba, y * bytesPerRow);
    previous = row;
  }

  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3];
  let opaquePixels = 0;
  for (let pixel = 3; pixel < rgba.length; pixel += 4) {
    if (rgba[pixel] > 0) opaquePixels += 1;
  }
  return {
    bytes: data.length,
    width,
    height,
    opaqueCoverage: opaquePixels / (width * height),
    corners: [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)],
  };
}

function objectBlock(source, id) {
  const match = source.match(new RegExp('\\b' + id + ':\\s*\\{([\\s\\S]*?)\\n\\s*\\},'));
  assert.ok(match, 'WeaponVisualCatalog must define ' + id);
  return match[1];
}

test('weapon visuals provide an exact one-to-one asset mapping for every primary weapon', () => {
  const catalogPath = 'assets/scripts/ui/WeaponVisualCatalog.ts';
  assert.ok(fs.existsSync(path.join(cocos, catalogPath)), 'WeaponVisualCatalog.ts must be added');
  const catalog = read(catalogPath);
  assert.match(catalog, /import type \{ PrimaryWeaponId \} from ['"]\.\.\/core\/WeaponCatalog['"]/);
  assert.match(catalog, /satisfies Record<PrimaryWeaponId, WeaponVisualDefinition>/);

  for (const id of weaponIds) {
    const block = objectBlock(catalog, id);
    assert.match(block, new RegExp('lowResourcePath:\\s*[\'"]ui/weapons/' + id + '[\'"]'));
    assert.match(block, new RegExp('highResourcePath:\\s*[\'"]ui/weapons/' + id + '[\'"]'));
    assert.match(block, /accent:/);
    assert.match(block, /projectileVisualFamily:/);
  }
  assert.equal((catalog.match(/^\s{2}(?:pulse|scatter|missile|rail|plasma):\s*\{/gm) || []).length, weaponIds.length);
});

test('weapon icon variants are transparent PNGs with useful coverage and materially smaller low resources', () => {
  for (const id of weaponIds) {
    const low = inspectRgbaPng('assets/resources/ui/weapons/' + id + '.png');
    const high = inspectRgbaPng('assets/spacefight-high/ui/weapons/' + id + '.png');
    assert.ok(low.width <= 512 && low.height <= 512, id + ' low asset exceeds the 512px budget');
    assert.ok(high.width > low.width && high.height > low.height, id + ' high asset must exceed low dimensions');
    assert.deepEqual(low.corners, [0, 0, 0, 0], id + ' low asset corners must be transparent');
    assert.deepEqual(high.corners, [0, 0, 0, 0], id + ' high asset corners must be transparent');
    assert.ok(low.opaqueCoverage > 0.01 && low.opaqueCoverage < 0.9, id + ' low asset needs a nontrivial transparent subject');
    assert.ok(high.opaqueCoverage > 0.01 && high.opaqueCoverage < 0.9, id + ' high asset needs a nontrivial transparent subject');
    assert.ok(low.bytes * 1.35 < high.bytes, id + ' low asset must be materially smaller than high');
  }
});

test('weapon manifests mirror the catalog paths and document image generation provenance', () => {
  const catalog = read('assets/scripts/ui/WeaponVisualCatalog.ts');
  for (const [variant, manifestPath] of [
    ['low', 'assets/resources/ui/weapons/manifest.json'],
    ['high', 'assets/spacefight-high/ui/weapons/manifest.json'],
  ]) {
    const manifest = JSON.parse(read(manifestPath));
    assert.equal(manifest.variant, variant);
    assert.equal(manifest.generatedWith, 'built-in image generation');
    assert.deepEqual(manifest.assets.map((asset) => asset.id), weaponIds);
    for (const asset of manifest.assets) {
      assert.equal(asset.resourcePath, 'ui/weapons/' + asset.id);
      assert.equal(asset.file, asset.id + '.png');
      assert.equal(typeof asset.prompt, 'string');
      assert.ok(asset.prompt.length >= 16, asset.id + ' needs a concise generation prompt');
      assert.equal(typeof asset.use, 'string');
      assert.ok(asset.use.length >= 8, asset.id + ' needs a concise use description');
      const block = objectBlock(catalog, asset.id);
      assert.match(block, new RegExp(variant + 'ResourcePath:\\s*[\'"]' + asset.resourcePath + '[\'"]'));
    }
  }
});

test('the exact staged SpaceFight tree compiles with TypeScript 4.9.5', () => {
  withStagedTree((stagedRoot) => {
    const version = childProcess.execFileSync(
      'npx',
      ['--yes', '--package', 'typescript@4.9.5', 'tsc', '--version'],
      { cwd: stagedRoot, encoding: 'utf8' },
    ).trim();
    assert.equal(version, 'Version 4.9.5');
    childProcess.execFileSync(
      'npx',
      [
        '--yes',
        '--package',
        'typescript@4.9.5',
        'tsc',
        '--project',
        path.join(stagedRoot, 'SpaceFight-Cocos/tsconfig.json'),
        '--noEmit',
      ],
      { cwd: stagedRoot, encoding: 'utf8', stdio: 'pipe' },
    );
  });
});

test('every weapon asset has Creator 3.8.8 import metadata in the staged tree', () => {
  const directories = [
    'SpaceFight-Cocos/assets/scripts/ui.meta',
    'SpaceFight-Cocos/assets/resources/ui.meta',
    'SpaceFight-Cocos/assets/resources/ui/weapons.meta',
    'SpaceFight-Cocos/assets/spacefight-high.meta',
    'SpaceFight-Cocos/assets/spacefight-high/ui.meta',
    'SpaceFight-Cocos/assets/spacefight-high/ui/weapons.meta',
  ];
  for (const relativePath of directories) {
    const metadata = JSON.parse(readStaged(relativePath));
    assert.equal(metadata.importer, 'directory', relativePath + ' must use the directory importer');
    assert.equal(metadata.imported, true, relativePath + ' must be imported');
    assert.match(metadata.uuid, /^[0-9a-f-]{36}$/, relativePath + ' needs a stable UUID');
  }

  const scriptMetadata = JSON.parse(
    readStaged('SpaceFight-Cocos/assets/scripts/ui/WeaponVisualCatalog.ts.meta'),
  );
  assert.equal(scriptMetadata.importer, 'typescript');
  assert.equal(scriptMetadata.imported, true);

  for (const relativePath of [
    'SpaceFight-Cocos/assets/resources/ui/weapons/manifest.json.meta',
    'SpaceFight-Cocos/assets/spacefight-high/ui/weapons/manifest.json.meta',
  ]) {
    const metadata = JSON.parse(readStaged(relativePath));
    assert.equal(metadata.importer, 'json', relativePath + ' must use the JSON importer');
    assert.equal(metadata.imported, true, relativePath + ' must be imported');
  }

  for (const variant of ['resources', 'spacefight-high']) {
    for (const id of weaponIds) {
      const relativePath =
        'SpaceFight-Cocos/assets/' + variant + '/ui/weapons/' + id + '.png.meta';
      const metadata = JSON.parse(readStaged(relativePath));
      assert.equal(metadata.importer, 'image', relativePath + ' must use the image importer');
      assert.equal(metadata.imported, true, relativePath + ' must be imported');
      assert.equal(metadata.userData.type, 'sprite-frame');
      assert.equal(metadata.userData.hasAlpha, true);
      assert.equal(metadata.userData.fixAlphaTransparencyArtifacts, true);

      const subassets = Object.values(metadata.subMetas);
      const texture = subassets.find((entry) => entry.importer === 'texture');
      const spriteFrame = subassets.find((entry) => entry.importer === 'sprite-frame');
      assert.ok(texture, relativePath + ' needs a Texture2D subasset');
      assert.ok(spriteFrame, relativePath + ' needs a SpriteFrame subasset');
      assert.match(texture.uuid, new RegExp('^' + metadata.uuid + '@'));
      assert.match(spriteFrame.uuid, new RegExp('^' + metadata.uuid + '@'));
      assert.equal(spriteFrame.userData.packable, true);
    }
  }
});
