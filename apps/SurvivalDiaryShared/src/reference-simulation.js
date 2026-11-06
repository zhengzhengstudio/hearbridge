const crypto = require('node:crypto');
const biomes = require('../content/biomes.json');

function hashNumber(...parts) {
  const digest = crypto.createHash('sha256').update(parts.join(':')).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function createRegion(seed, coordinates) {
  if (!Number.isInteger(coordinates?.x) || !Number.isInteger(coordinates?.y)) {
    throw new TypeError('region coordinates must be integers');
  }
  const { x, y } = coordinates;
  const elevation = round(hashNumber(seed, x, y, 'elevation'));
  const moisture = round(hashNumber(seed, x, y, 'moisture'));
  const biome = biomes[Math.floor(hashNumber(seed, x, y, 'biome') * biomes.length) % biomes.length];
  const resources = biome.resources.filter((itemId, index) => (
    hashNumber(seed, x, y, itemId) > 0.32 || index === 0
  ));

  return {
    id: `${x},${y}`,
    x,
    y,
    biomeId: biome.id,
    elevation,
    moisture,
    resources,
  };
}

function createWorld(seed) {
  if (typeof seed !== 'string' || seed.length === 0) throw new TypeError('seed must be a non-empty string');
  return {
    schemaVersion: 1,
    seed,
    day: 1,
    time: 360,
    regions: {},
    players: {},
    milestones: {},
  };
}

function stepWorld(state, command) {
  if (!state || state.schemaVersion !== 1) throw new TypeError('unsupported world schema');
  const next = structuredClone(state);

  switch (command?.type) {
    case 'discover_region': {
      const region = createRegion(next.seed, command.coordinates);
      next.regions[region.id] = region;
      return next;
    }
    case 'advance_time': {
      if (!Number.isInteger(command.minutes) || command.minutes <= 0) {
        throw new TypeError('minutes must be a positive integer');
      }
      const elapsed = next.time + command.minutes;
      next.day += Math.floor(elapsed / 1440);
      next.time = elapsed % 1440;
      return next;
    }
    default:
      throw new Error(`unsupported command: ${command?.type || 'missing'}`);
  }
}

module.exports = { createRegion, createWorld, stepWorld };
