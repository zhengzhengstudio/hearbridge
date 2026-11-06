const { canTraverse } = require('./navigation.js');

function rotatedFootprint(blueprint, rotation) {
  const source = blueprint?.footprint || blueprint?.collision || {};
  const turns = ((Math.round(Number(rotation || 0) / 90) % 4) + 4) % 4;
  return turns % 2 === 0
    ? { width: Number(source.width || 1), height: Number(source.height || 1) }
    : { width: Number(source.height || 1), height: Number(source.width || 1) };
}

function rectangle(source, fallbackFootprint) {
  const position = source.position || source.coordinates || source;
  const footprint = source.footprint
    || (source.collision && typeof source.collision === 'object' ? source.collision : null)
    || fallbackFootprint
    || source;
  const width = Number(footprint.width || 0);
  const height = Number(footprint.height || 0);
  return {
    minX: Number(position.x) - width / 2,
    maxX: Number(position.x) + width / 2,
    minY: Number(position.y) - height / 2,
    maxY: Number(position.y) + height / 2,
  };
}

function intersects(left, right) {
  return left.minX < right.maxX && left.maxX > right.minX
    && left.minY < right.maxY && left.maxY > right.minY;
}

function samplePoints(pose, footprint) {
  const halfWidth = footprint.width / 2;
  const halfHeight = footprint.height / 2;
  return [
    { x: pose.x, y: pose.y },
    { x: pose.x - halfWidth, y: pose.y - halfHeight },
    { x: pose.x + halfWidth, y: pose.y - halfHeight },
    { x: pose.x - halfWidth, y: pose.y + halfHeight },
    { x: pose.x + halfWidth, y: pose.y + halfHeight },
  ];
}

function validatePlacement(world, blueprint, pose) {
  if (!world || !blueprint || !Number.isFinite(pose?.x) || !Number.isFinite(pose?.y)) {
    return { ok: false, blockers: [{ code: 'invalid-placement' }] };
  }
  const footprint = rotatedFootprint(blueprint, pose.rotation);
  const candidate = rectangle(pose, footprint);
  const blockers = [];
  const bounds = world.bounds;
  if (bounds && (
    candidate.minX < bounds.minX || candidate.maxX > bounds.maxX
    || candidate.minY < bounds.minY || candidate.maxY > bounds.maxY
  )) blockers.push({ code: 'outside-world' });

  const maxSlope = Number(blueprint.maxSlope ?? 0.35);
  const maxWaterDepth = Number(blueprint.maxWaterDepth ?? 0.2);
  const tiles = samplePoints(pose, footprint)
    .map(point => world.terrainAt?.(point.x, point.y) || { walkable: true, waterDepth: 0, slope: 0 });
  if (tiles.some(tile => Number(tile.slope || 0) > maxSlope)) blockers.push({ code: 'slope-too-steep' });
  if (tiles.some(tile => Number(tile.waterDepth || 0) > maxWaterDepth && tile.bridge !== true)) {
    blockers.push({ code: 'water-too-deep' });
  }
  if (tiles.some(tile => tile.blocked === true || (tile.walkable === false && !canTraverse(tile, { mode: 'walking' })))) {
    blockers.push({ code: 'terrain-blocked' });
  }

  for (const entity of world.obstacles || world.entities || []) {
    if (entity.collision !== false && intersects(candidate, rectangle(entity))) {
      blockers.push({ code: 'entity-collision', entityId: entity.id });
    }
    for (const entrance of entity.entrances || []) {
      if (intersects(candidate, rectangle(entrance))) {
        blockers.push({ code: 'entrance-clearance', entityId: entity.id });
      }
    }
  }
  for (const area of world.protectedAreas || []) {
    if (intersects(candidate, rectangle(area))) blockers.push({ code: 'protected-area', areaId: area.id });
  }
  return { ok: blockers.length === 0, blockers };
}

module.exports = { rotatedFootprint, validatePlacement };
