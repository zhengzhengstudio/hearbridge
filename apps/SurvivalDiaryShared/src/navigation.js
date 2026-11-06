const DEFAULT_RADIUS = 0.35;
const MAX_STEP = 0.2;

function normalizedMode(actorMode) {
  return typeof actorMode === 'string' ? actorMode : actorMode?.mode || 'walking';
}

function canTraverse(tile, actorMode = { mode: 'walking' }) {
  if (!tile || tile.blocked === true) return false;
  const mode = normalizedMode(actorMode);
  const waterDepth = Math.max(0, Number(tile.waterDepth || 0));
  if (tile.bridge === true) return mode !== 'aboard' || waterDepth > 0;
  if (tile.walkable === false && waterDepth <= 0.2) return false;
  if (mode === 'aboard') return waterDepth >= 0.45 && waterDepth <= 4;
  if (mode === 'swimming') return waterDepth > 0.2;
  return waterDepth <= Number(actorMode?.maxWadingDepth ?? 0.35);
}

function boxFor(entity) {
  const footprint = entity.footprint
    || (entity.collision && typeof entity.collision === 'object' ? entity.collision : entity);
  const position = entity.position || entity.coordinates || entity;
  const width = Number(footprint.width || 0);
  const height = Number(footprint.height || 0);
  return {
    minX: Number(position.x) - width / 2,
    maxX: Number(position.x) + width / 2,
    minY: Number(position.y) - height / 2,
    maxY: Number(position.y) + height / 2,
  };
}

function circleTouchesBox(position, radius, box) {
  const closestX = Math.max(box.minX, Math.min(position.x, box.maxX));
  const closestY = Math.max(box.minY, Math.min(position.y, box.maxY));
  const dx = position.x - closestX;
  const dy = position.y - closestY;
  return dx * dx + dy * dy < radius * radius - 1e-9;
}

function inBounds(world, position, radius) {
  const bounds = world?.bounds;
  return !bounds || (
    position.x - radius >= bounds.minX
    && position.x + radius <= bounds.maxX
    && position.y - radius >= bounds.minY
    && position.y + radius <= bounds.maxY
  );
}

function terrainSamples(world, position, radius) {
  const points = [
    position,
    { x: position.x - radius, y: position.y },
    { x: position.x + radius, y: position.y },
    { x: position.x, y: position.y - radius },
    { x: position.x, y: position.y + radius },
  ];
  return points.map(point => world.terrainAt?.(point.x, point.y) || { walkable: true, waterDepth: 0 });
}

function contactsAt(world, position, actor) {
  const radius = Math.max(0.05, Number(actor.radius || DEFAULT_RADIUS));
  const contacts = [];
  if (!inBounds(world, position, radius)) contacts.push({ id: 'world-bounds', kind: 'bounds' });
  if (terrainSamples(world, position, radius).some(tile => !canTraverse(tile, actor))) {
    contacts.push({ id: 'terrain', kind: 'terrain' });
  }
  for (const obstacle of world?.obstacles || []) {
    if (obstacle.collision === false) continue;
    if (circleTouchesBox(position, radius, boxFor(obstacle))) {
      contacts.push({ id: obstacle.id || 'obstacle', kind: 'entity' });
    }
  }
  return contacts;
}

function moveActor(world, actor, delta) {
  if (!world || !actor?.position || !Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) {
    throw new TypeError('moveActor requires a world, actor position, and finite delta');
  }
  const position = { x: Number(actor.position.x), y: Number(actor.position.y) };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / MAX_STEP));
  const step = { x: delta.x / steps, y: delta.y / steps };
  const contacts = new Map();

  for (let index = 0; index < steps; index += 1) {
    for (const axis of ['x', 'y']) {
      if (step[axis] === 0) continue;
      const candidate = { ...position, [axis]: position[axis] + step[axis] };
      const blockedBy = contactsAt(world, candidate, actor);
      if (blockedBy.length === 0) position[axis] = candidate[axis];
      else for (const contact of blockedBy) contacts.set(`${contact.kind}:${contact.id}`, contact);
    }
  }
  return { position, contacts: [...contacts.values()] };
}

function findLegalSpawn(world, preferred, actor = {}) {
  if (!Number.isFinite(preferred?.x) || !Number.isFinite(preferred?.y)) {
    throw new TypeError('preferred spawn must be finite');
  }
  const candidateActor = { radius: actor.radius || DEFAULT_RADIUS, mode: actor.mode || 'walking' };
  const step = Math.max(0.5, candidateActor.radius * 2);
  const limit = Number.isFinite(actor.searchRadius) ? actor.searchRadius : 32;
  const candidates = [{ x: preferred.x, y: preferred.y, distance: 0 }];
  for (let radius = step; radius <= limit; radius += step) {
    const segments = Math.max(8, Math.ceil((Math.PI * 2 * radius) / step));
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      candidates.push({
        x: preferred.x + Math.cos(angle) * radius,
        y: preferred.y + Math.sin(angle) * radius,
        distance: radius,
      });
    }
  }
  for (const candidate of candidates) {
    if (contactsAt(world, candidate, candidateActor).length === 0) {
      return { x: Math.round(candidate.x * 1000) / 1000, y: Math.round(candidate.y * 1000) / 1000 };
    }
  }
  throw new RangeError('no legal spawn found within search radius');
}

function depthKey(entity) {
  const layer = Number(entity?.heightLayer || 0);
  const footY = Number(entity?.footY ?? entity?.position?.y ?? entity?.coordinates?.y ?? 0);
  // 2.5D occlusion is decided by where an object touches the ground.  A
  // presentation layer may break ties at the same foot position, but must not
  // force actors to remain in front of a building when they walk behind it.
  return footY * 1_000 + layer;
}

module.exports = {
  canTraverse,
  contactsAt,
  depthKey,
  findLegalSpawn,
  moveActor,
};
