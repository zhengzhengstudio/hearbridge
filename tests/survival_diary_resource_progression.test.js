const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/SurvivalDiaryShared/content', name), 'utf8'));

test('early water and latex resources do not create an impossible progression loop', () => {
  const resources = read('resources.json');
  const biomes = read('biomes.json');
  const freshWater = resources.find(resource => resource.id === 'fresh-water-spring');
  const spawned = new Set(biomes.flatMap(biome => biome.spawnTable.map(rule => rule.resourceId)));
  const palm = biomes.find(biome => biome.id === 'palm-grove');

  assert.deepEqual(freshWater.toolTags, [], 'first water cannot require a waterskin made from later latex');
  assert.ok(spawned.has('latex-tree'), 'latex-tree must be present in at least one biome spawn table');
  assert.ok(palm.spawnTable.some(rule => rule.resourceId === 'fresh-water-spring'), 'the starting land biome needs a reachable water source');
});

test('every recipe is reachable from starter gathering without circular tool or station requirements', () => {
  const resources = read('resources.json');
  const recipes = read('recipes.json');
  const available = new Set(['branch', 'stone', 'palm-fiber']);
  const stations = new Set(['hand']);
  const tools = new Set();
  const toolForItem = new Map([
    ['stone-axe', 'axe'], ['stone-pickaxe', 'pickaxe'], ['copper-pickaxe', 'pickaxe'],
    ['iron-pickaxe', 'pickaxe'], ['stone-machete', 'machete'], ['machete', 'machete'], ['shovel', 'shovel'], ['fishing-rod', 'fishing'],
  ]);

  for (let pass = 0; pass < 50; pass += 1) {
    const before = `${available.size}:${stations.size}:${tools.size}`;
    for (const resource of resources) {
      if (!resource.toolTags.length || resource.toolTags.some(tag => tools.has(tag))) available.add(resource.itemId);
    }
    for (const recipe of recipes) {
      if (!stations.has(recipe.station) || !Object.keys(recipe.ingredients).every(id => available.has(id))) continue;
      available.add(recipe.output.itemId);
      if (toolForItem.has(recipe.output.itemId)) tools.add(toolForItem.get(recipe.output.itemId));
      if (['workbench', 'furnace', 'cooking-pot', 'drying-shed', 'medicine-table'].includes(recipe.output.itemId)) stations.add(recipe.output.itemId);
    }
    if (`${available.size}:${stations.size}:${tools.size}` === before) break;
  }

  assert.deepEqual(recipes.filter(recipe => !available.has(recipe.output.itemId)).map(recipe => recipe.id), []);
});

test('the early stone machete is reachable by hand while bronze remains the durable upgrade', () => {
  const recipes = read('recipes.json');
  const early = recipes.find(recipe => recipe.id === 'craft-stone-machete');
  const bronze = recipes.find(recipe => recipe.id === 'craft-machete');
  assert.equal(early.station, 'hand');
  assert.deepEqual(early.ingredients, { stone: 2, branch: 1, rope: 1 });
  assert.equal(early.output.itemId, 'stone-machete');
  assert.equal(bronze.output.itemId, 'machete');
});

test('rope is hand-crafted from renewable palm fibre without requiring a later machete', () => {
  const rope = read('recipes.json').find(recipe => recipe.id === 'craft-rope');
  assert.deepEqual(rope.ingredients, { 'palm-fiber': 4 });
  assert.equal(rope.station, 'hand');
});
