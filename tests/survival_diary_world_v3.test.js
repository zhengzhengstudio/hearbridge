const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'apps/SurvivalDiaryShared/fixtures/open-world-v3.json');
const {
  CHUNK_SIZE,
  discover,
  generateChunk,
  sampleTerrain,
  unknownMapCell,
  visibleChunks,
  worldSignature,
} = require('../apps/SurvivalDiaryShared/src/world-generator.js');
const survival = require('../apps/SurvivalDiaryShared/src/survival-simulation.js');

test('shared simulation gates passive health and stamina recovery behind food and water thresholds', () => {
  const fed = survival.createSaveV3('shared-recovery');
  fed.vitals = { ...fed.vitals, health: 60, stamina: 35, hunger: 86, hydration: 78 };
  const recovered = survival.advance(fed, 75_000, { activity: 'idle', environment: { safe: true, ambientTemperature: .55 } });
  const hungry = structuredClone(fed);
  hungry.vitals.hunger = 79;
  const blocked = survival.advance(hungry, 75_000, { activity: 'idle', environment: { safe: true, ambientTemperature: .55 } });

  assert.ok(recovered.vitals.health > fed.vitals.health);
  assert.equal(blocked.vitals.health, hungry.vitals.health);
  assert.ok(recovered.vitals.stamina > blocked.vitals.stamina);
  assert.ok(blocked.recoveryBlockers.some(reason => reason.code === 'needs-food'));
});

test('chunks are deterministic, non-repeating, and continuous at every shared edge', () => {
  const chunk = generateChunk('island-7', 4, -2);
  const east = generateChunk('island-7', 5, -2);
  const south = generateChunk('island-7', 4, -1);

  assert.deepEqual(chunk, generateChunk('island-7', 4, -2));
  assert.notEqual(worldSignature(chunk), worldSignature(generateChunk('island-7', 7, -2)));
  assert.deepEqual(chunk.edges.east, east.edges.west);
  assert.deepEqual(chunk.edges.south, south.edges.north);
  assert.equal(chunk.height.length, (CHUNK_SIZE + 1) ** 2);
  assert.equal(chunk.biome.length, (CHUNK_SIZE + 1) ** 2);
});

test('terrain samples transition between real biomes and do not select a repeated atlas tile', () => {
  const samples = [];
  for (let y = -96; y <= 96; y += 8) {
    for (let x = -96; x <= 96; x += 8) samples.push(sampleTerrain('biome-range', x, y));
  }
  const biomes = new Set(samples.map(sample => sample.biome));
  const heights = new Set(samples.map(sample => sample.height));

  assert.ok(biomes.size >= 5, `expected at least five biomes, got ${[...biomes].join(', ')}`);
  assert.ok(heights.size > 100, 'terrain height field repeats too often');
  assert.ok(samples.every(sample => sample.height >= 0 && sample.height <= 1));
  assert.ok(samples.every(sample => sample.moisture >= 0 && sample.moisture <= 1));
  assert.ok(samples.every(sample => sample.temperature >= 0 && sample.temperature <= 1));
});

test('terrain transitions expose three continuous splat weights instead of hard bitmap swaps', () => {
  const samples = Array.from({ length: 81 }, (_, index) => (
    sampleTerrain('smooth-transition', index - 40, 17)
  ));
  for (const sample of samples) {
    assert.equal(sample.blend.length, 3);
    assert.ok(Math.abs(sample.blend.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 0.0002);
    assert.equal(new Set(sample.blend.map(entry => entry.biome)).size, 3);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = new Map(samples[index - 1].blend.map(entry => [entry.biome, entry.weight]));
    const current = new Map(samples[index].blend.map(entry => [entry.biome, entry.weight]));
    const biomes = new Set([...previous.keys(), ...current.keys()]);
    const totalVariation = [...biomes].reduce((sum, biome) => (
      sum + Math.abs((previous.get(biome) || 0) - (current.get(biome) || 0))
    ), 0) / 2;
    assert.ok(totalVariation < 0.3, `terrain blend jumped by ${totalVariation} at ${index}`);
  }
});

test('resource nodes have stable world positions, harvest states, and catalog ids', () => {
  const resourceIds = new Set(
    JSON.parse(fs.readFileSync(path.join(root, 'apps/SurvivalDiaryShared/content/resources.json')))
      .map(resource => resource.id),
  );
  const chunks = [
    generateChunk('resource-field', 0, 0),
    generateChunk('resource-field', 1, 0),
    generateChunk('resource-field', -3, 7),
  ];
  const nodes = chunks.flatMap(chunk => chunk.resources);

  assert.ok(nodes.length >= 20, `expected at least 20 nodes, got ${nodes.length}`);
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  assert.ok(nodes.every(node => resourceIds.has(node.resourceId)));
  assert.ok(nodes.every(node => node.state === 'full' && node.remaining >= 1));
  assert.deepEqual(chunks, [
    generateChunk('resource-field', 0, 0),
    generateChunk('resource-field', 1, 0),
    generateChunk('resource-field', -3, 7),
  ]);
});

test('camera bounds select only nearby chunks and fog hides undiscovered map cells', () => {
  assert.deepEqual(
    visibleChunks({ minX: 0, minY: 0, maxX: 31, maxY: 31 }, 0),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  );

  const save = { schemaVersion: 3, discoveredChunks: {} };
  assert.equal(unknownMapCell(save, 99, 99).visibility, 'hidden');
  const discovered = discover(save, { x: 2, y: -3 });
  assert.equal(unknownMapCell(discovered, 2, -3).visibility, 'discovered');
  assert.equal(unknownMapCell(save, 2, -3).visibility, 'hidden', 'discover must be immutable');
});

test('the checked-in golden fixture matches independently regenerated chunks and fog', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath));
  const signatures = Object.fromEntries(
    fixture.coordinates.map(({ x, y }) => {
      const chunk = generateChunk(fixture.seed, x, y);
      return [`${x},${y}`, worldSignature(chunk)];
    }),
  );

  assert.deepEqual(signatures, fixture.signatures);
  assert.deepEqual(
    generateChunk(fixture.seed, 0, 0).edges.east,
    generateChunk(fixture.seed, 1, 0).edges.west,
  );
  assert.deepEqual(fixture.discoveredMap, discover(
    { schemaVersion: 3, discoveredChunks: {} },
    { x: 0, y: 0 },
  ).discoveredChunks);
  assert.equal(fixture.resourceNodes.length, 20);
});
