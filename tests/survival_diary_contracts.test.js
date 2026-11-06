const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digestWorld(world) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(world)))
    .digest('hex');
}

const sharedRoot = 'apps/SurvivalDiaryShared';
const simulationPath = path.join(root, sharedRoot, 'src/reference-simulation.js');

test('shared JSON contracts use schema version 2 and describe required messages', () => {
  const saveSchema = readJson(`${sharedRoot}/schemas/save.schema.json`);
  const protocolSchema = readJson(`${sharedRoot}/schemas/protocol.schema.json`);

  assert.equal(saveSchema.$id, 'https://zhengzhengstudio.cn/schemas/survival-diary/save-v2.json');
  assert.ok(saveSchema.required.includes('schemaVersion'));
  assert.deepEqual(saveSchema.properties.schemaVersion, { const: 2 });

  const messageTypes = protocolSchema.oneOf.map(message => {
    const definitionName = message.$ref.split('/').at(-1);
    const definition = protocolSchema.$defs[definitionName];
    return definition.properties?.type?.const || definition.allOf?.[1]?.properties?.type?.const;
  });
  assert.deepEqual(messageTypes, [
    'join',
    'resume',
    'command',
    'chat',
    'snapshot',
    'ack',
    'world_update',
    'chat_history',
    'friend_request',
    'tap_token_create',
    'tap_token_redeem',
    'diary_request',
    'error',
  ]);
});

test('content references are valid and every milestone is non-terminal', () => {
  const items = readJson(`${sharedRoot}/content/items.json`);
  const recipes = readJson(`${sharedRoot}/content/recipes.json`);
  const biomes = readJson(`${sharedRoot}/content/biomes.json`);
  const milestones = readJson(`${sharedRoot}/content/milestones.json`);
  const itemIds = new Set(items.map(item => item.id));

  assert.ok(items.length >= 6);
  assert.ok(recipes.length >= 3);
  assert.ok(biomes.length >= 3);
  assert.ok(milestones.length >= 4);
  assert.ok(biomes.every(item => item.terrainModel === 'continuous-low-poly'));
  assert.ok(milestones.every(item => item.terminal !== true));

  for (const recipe of recipes) {
    for (const itemId of Object.keys(recipe.ingredients)) assert.ok(itemIds.has(itemId));
    assert.ok(itemIds.has(recipe.output.itemId));
  }
});

test('same seed and commands produce the same region digest', () => {
  const { createWorld, stepWorld } = require(simulationPath);
  const fixture = readJson(`${sharedRoot}/fixtures/world-seed-20260726.json`);
  const a = fixture.commands.reduce(stepWorld, createWorld(fixture.seed));
  const b = fixture.commands.reduce(stepWorld, createWorld(fixture.seed));

  assert.equal(digestWorld(a), digestWorld(b));
  assert.equal(digestWorld(a), fixture.expectedDigest);
});

test('world expands indefinitely without blocks, endings, or a day limit', () => {
  const { createWorld, stepWorld } = require(simulationPath);
  const initial = createWorld('endless-island');
  let world = initial;

  for (let index = 0; index < 64; index += 1) {
    world = stepWorld(world, {
      type: 'discover_region',
      coordinates: { x: index * 17 - 300, y: 300 - index * 29 },
    });
  }
  world = stepWorld(world, { type: 'advance_time', minutes: 525_600 });

  assert.equal(Object.keys(world.regions).length, 64);
  assert.equal('ending' in world, false);
  assert.equal('dayLimit' in world, false);
  assert.ok(world.day > initial.day);
});

test('simulation rejects direct inventory and milestone mutation', () => {
  const { createWorld, stepWorld } = require(simulationPath);
  const world = createWorld('authority-check');

  assert.throws(
    () => stepWorld(world, { type: 'set_inventory', itemId: 'wood', amount: 999 }),
    /unsupported command/i,
  );
  assert.throws(
    () => stepWorld(world, { type: 'set_milestone', milestoneId: 'radio-signal' }),
    /unsupported command/i,
  );
});
