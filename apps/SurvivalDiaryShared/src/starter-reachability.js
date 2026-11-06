const resourceCatalog = require('../content/resources.json');
const { hashUnit } = require('./hash.js');

const resourcesById = new Map(resourceCatalog.map(resource => [resource.id, resource]));
const MATERIAL_SPECS = Object.freeze([
  Object.freeze({ itemId: 'stone', resourceId: 'loose-stones', required: 8 }),
  Object.freeze({ itemId: 'branch', resourceId: 'fallen-branches', required: 3 }),
  Object.freeze({ itemId: 'palm-fiber', resourceId: 'palm-fiber-clump', required: 24 }),
  Object.freeze({ itemId: 'fresh-water', resourceId: 'fresh-water-spring', required: 3 }),
  Object.freeze({ itemId: 'driftwood', resourceId: 'driftwood-pile', required: 5 }),
  Object.freeze({ itemId: 'leaf', resourceId: 'broadleaf-bush', required: 15 }),
  Object.freeze({ itemId: 'softwood-log', resourceId: 'softwood-tree', required: 10 }),
  Object.freeze({ itemId: 'coconut', resourceId: 'coconut-palm', required: 2 }),
]);
const MAX_PATH_LENGTH = 26;
const MINIMUM_SPACING = 1.35;

function openingRawMaterialBudget() {
  return Object.fromEntries(MATERIAL_SPECS.map(spec => [spec.itemId, spec.required]));
}

function sampleWidth(chunk) {
  const width = Math.sqrt(chunk.height.length);
  if (!Number.isInteger(width) || width < 3) throw new TypeError('chunk terrain grid must be square');
  return width;
}

function terrainAt(chunk, x, y) {
  const width = sampleWidth(chunk);
  const localX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const localY = Math.max(0, Math.min(width - 1, Math.round(y)));
  const index = localY * width + localX;
  return {
    height: Number(chunk.height[index] || 0),
    biome: chunk.biome[index],
  };
}

function isWalkable(chunk, x, y) {
  const terrain = terrainAt(chunk, x, y);
  return terrain.height >= 0.3 && terrain.biome !== 'lagoon';
}

function key(x, y) {
  return `${x},${y}`;
}

function nearestLandSpawn(chunk) {
  const width = sampleWidth(chunk);
  const center = (width - 1) / 2;
  const candidates = [];
  for (let y = 1; y < width - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!isWalkable(chunk, x, y)) continue;
      candidates.push({ x, y, distance: Math.hypot(x - center, y - center) });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x);
  const selected = candidates[0];
  if (!selected) throw new RangeError('origin chunk contains no walkable starter land');
  return { x: selected.x, y: selected.y };
}

function reachableCells(chunk, spawn) {
  const width = sampleWidth(chunk);
  const queue = [{ x: Math.round(spawn.x), y: Math.round(spawn.y), pathLength: 0 }];
  const result = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = key(current.x, current.y);
    if (result.has(currentKey) || current.pathLength > MAX_PATH_LENGTH) continue;
    if (current.x < 1 || current.y < 1 || current.x >= width - 1 || current.y >= width - 1) continue;
    if (!isWalkable(chunk, current.x, current.y)) continue;
    result.set(currentKey, current.pathLength);
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      queue.push({ x: current.x + offsetX, y: current.y + offsetY, pathLength: current.pathLength + 1 });
    }
  }
  return result;
}

function nodePathLength(node, reachable) {
  return reachable.get(key(Math.round(node.position.x), Math.round(node.position.y)));
}

function canUseDuringOpening(node) {
  const tags = resourcesById.get(node.resourceId)?.toolTags || [];
  return tags.length === 0 || tags.every(tag => tag === 'axe');
}

function auditStarterChunk(chunk) {
  const spawn = chunk.starterSpawn || nearestLandSpawn(chunk);
  const reachable = reachableCells(chunk, spawn);
  const budget = openingRawMaterialBudget();
  const available = Object.fromEntries(Object.keys(budget).map(itemId => [itemId, 0]));
  const nodes = [];
  for (const node of chunk.resources || []) {
    if (!Object.hasOwn(budget, node.itemId) || !canUseDuringOpening(node)) continue;
    const pathLength = nodePathLength(node, reachable);
    if (pathLength === undefined) continue;
    available[node.itemId] += Math.max(0, Number(node.remaining || 0));
    nodes.push({
      id: node.id,
      itemId: node.itemId,
      walkable: isWalkable(chunk, node.position.x, node.position.y),
      pathLength,
    });
  }
  const missing = Object.entries(budget)
    .filter(([itemId, amount]) => available[itemId] < amount)
    .map(([itemId]) => itemId);
  return {
    spawn: { ...spawn, walkable: isWalkable(chunk, spawn.x, spawn.y) },
    required: budget,
    available,
    missing,
    nodes,
  };
}

function farEnough(position, nodes) {
  return nodes.every(node => Math.hypot(
    position.x - node.position.x,
    position.y - node.position.y,
  ) >= MINIMUM_SPACING);
}

function placementCandidates(seed, chunk, spawn, reachable, itemId) {
  return [...reachable.entries()]
    .map(([cell, pathLength]) => {
      const [x, y] = cell.split(',').map(Number);
      return {
        x,
        y,
        pathLength,
        order: hashUnit(seed, itemId, x, y, 'starter-placement'),
        spawnDistance: Math.hypot(x - spawn.x, y - spawn.y),
      };
    })
    .filter(candidate => candidate.spawnDistance >= 2 && candidate.pathLength <= MAX_PATH_LENGTH)
    .sort((left, right) => left.order - right.order || left.pathLength - right.pathLength);
}

function ensureStarterReachability({ seed, chunk }) {
  if (typeof seed !== 'string' || seed.length === 0) throw new TypeError('seed must be a non-empty string');
  const next = structuredClone(chunk);
  const spawn = nearestLandSpawn(next);
  const reachable = reachableCells(next, spawn);
  next.starterSpawn = spawn;
  const budget = openingRawMaterialBudget();
  const initialAudit = auditStarterChunk(next);

  for (const spec of MATERIAL_SPECS) {
    let deficit = Math.max(0, budget[spec.itemId] - initialAudit.available[spec.itemId]);
    if (deficit === 0) continue;
    const definition = resourcesById.get(spec.resourceId);
    if (!definition) throw new RangeError(`missing starter resource definition: ${spec.resourceId}`);
    const candidates = placementCandidates(seed, next, spawn, reachable, spec.itemId);
    let sequence = 0;
    while (deficit > 0) {
      const candidate = candidates.find(item => farEnough(item, next.resources));
      if (!candidate) throw new RangeError(`not enough spaced starter positions for ${spec.itemId}`);
      const remaining = Math.min(definition.yield.max, deficit);
      const position = { x: candidate.x, y: candidate.y };
      next.resources.push({
        id: `${spec.resourceId}@starter-${sequence}-${candidate.x},${candidate.y}`,
        resourceId: spec.resourceId,
        itemId: spec.itemId,
        position,
        state: 'full',
        remaining,
        maxRemaining: remaining,
        recoveryMinutes: definition.recoveryMinutes,
        starter: true,
      });
      candidates.splice(candidates.indexOf(candidate), 1);
      deficit -= remaining;
      sequence += 1;
    }
  }
  next.starterAudit = auditStarterChunk(next);
  return next;
}

module.exports = {
  auditStarterChunk,
  ensureStarterReachability,
  openingRawMaterialBudget,
};
