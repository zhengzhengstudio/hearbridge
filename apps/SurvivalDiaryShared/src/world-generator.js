const biomes = require('../content/biomes.json');
const resourceCatalog = require('../content/resources.json');
const { hashUnit, stableDigest } = require('./hash.js');
const { ensureStarterReachability } = require('./starter-reachability.js');

const CHUNK_SIZE = 16;
const SAMPLE_WIDTH = CHUNK_SIZE + 1;
const resourcesById = new Map(resourceCatalog.map(resource => [resource.id, resource]));
const biomesById = new Map(biomes.map(biome => [biome.id, biome]));

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function latticeNoise(seed, x, y, channel) {
  const minX = Math.floor(x);
  const minY = Math.floor(y);
  const offsetX = fade(x - minX);
  const offsetY = fade(y - minY);
  const north = lerp(
    hashUnit(seed, minX, minY, channel),
    hashUnit(seed, minX + 1, minY, channel),
    offsetX,
  );
  const south = lerp(
    hashUnit(seed, minX, minY + 1, channel),
    hashUnit(seed, minX + 1, minY + 1, channel),
    offsetX,
  );
  return lerp(north, south, offsetY);
}

function octaveNoise(seed, worldX, worldY, channel, scale, octaves = 4) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += latticeNoise(
      seed,
      (worldX / scale) * frequency,
      (worldY / scale) * frequency,
      `${channel}:${octave}`,
    ) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / weight;
}

function biomeFor({ height, moisture, temperature }) {
  if (height < 0.3) return 'lagoon';
  if (height > 0.76) return 'basalt-ridge';
  if (temperature < 0.34 && moisture > 0.48) return 'cloud-forest';
  if (moisture > 0.68) return 'mangrove';
  if (moisture < 0.3 && temperature > 0.58) return 'dry-savanna';
  if (height > 0.62 && moisture < 0.52) return 'limestone-upland';
  return 'palm-grove';
}

function biomeBlendFor(sample) {
  const { height, moisture, temperature } = sample;
  const scores = {
    lagoon: (0.36 - height) * 7 + moisture * 0.4,
    'palm-grove': 0.35 - Math.abs(height - 0.5) * 1.2 - Math.abs(moisture - 0.5) * 0.7,
    'basalt-ridge': (height - 0.67) * 7 - moisture * 0.25,
    mangrove: (moisture - 0.58) * 5 - Math.abs(height - 0.42) * 1.2,
    'cloud-forest': (0.42 - temperature) * 3.8 + (moisture - 0.48) * 2.7,
    'dry-savanna': (0.4 - moisture) * 4 + (temperature - 0.52) * 2.2,
    'limestone-upland': (height - 0.56) * 3.5 + (0.56 - moisture) * 1.8,
  };
  scores[biomeFor(sample)] += 0.42;
  const ranked = Object.entries(scores)
    .map(([biome, score]) => ({ biome, strength: Math.exp(score * 1.15) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  const total = ranked.reduce((sum, entry) => sum + entry.strength, 0);
  const blend = ranked.map(entry => ({
    biome: entry.biome,
    weight: round(entry.strength / total),
  }));
  const preceding = blend.slice(0, -1).reduce((sum, entry) => sum + entry.weight, 0);
  blend.at(-1).weight = round(1 - preceding);
  return blend;
}

function sampleTerrain(seed, worldX, worldY) {
  if (typeof seed !== 'string' || seed.length === 0) throw new TypeError('seed must be a non-empty string');
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) throw new TypeError('world coordinates must be finite');

  const broadHeight = octaveNoise(seed, worldX, worldY, 'height-broad', 84, 4);
  const detailHeight = octaveNoise(seed, worldX, worldY, 'height-detail', 23, 3);
  const moisture = clamp01(
    octaveNoise(seed, worldX, worldY, 'moisture', 68, 4)
      + (octaveNoise(seed, worldX, worldY, 'moisture-detail', 17, 2) - 0.5) * 0.22,
  );
  const latitude = Math.sin(worldY / 57) * 0.13;
  const temperature = clamp01(
    octaveNoise(seed, worldX, worldY, 'temperature', 96, 4)
      - broadHeight * 0.18
      + 0.1
      + latitude,
  );
  const naturalHeight = clamp01(broadHeight * 0.78 + detailHeight * 0.22);
  const starterInfluence = clamp01(1 - Math.hypot(worldX - 8, worldY - 8) / 12);
  const height = Math.max(naturalHeight, 0.29 + starterInfluence * 0.28);
  const sample = {
    height: round(height),
    moisture: round(moisture),
    temperature: round(temperature),
  };
  sample.biome = biomeFor(sample);
  sample.blend = biomeBlendFor(sample);
  return sample;
}

function terrainTile(seed, worldX, worldY) {
  const sample = sampleTerrain(seed, worldX, worldY);
  // The starter boat is four tiles wide. Keep a horizontal, navigable inlet
  // beneath it instead of the old one-tile vertical puddle that trapped it.
  // Taper the lower shore so the inlet reads as a natural cove rather than a
  // rectangular swimming pool while preserving the boat's full footprint.
  const starterCove = worldY === 3
    ? worldX >= 2 && worldX <= 5
    : worldY === 4 && worldX >= 3 && worldX <= 4;
  const coveInfluence = clamp01(1 - Math.hypot(worldX - 3.5, worldY - 3.5) / 3.2);
  if (coveInfluence > 0) {
    const lagoonWeight = starterCove ? 0.3 : round(coveInfluence * 0.14);
    const shoreBlend = (sample.blend || [{ biome: sample.biome, weight: 1 }])
      .filter(entry => entry.biome !== 'lagoon')
      .map(entry => ({ ...entry, weight: round(entry.weight * (1 - lagoonWeight)) }));
    const shoreTotal = shoreBlend.reduce((sum, entry) => sum + entry.weight, 0);
    if (shoreBlend.length && shoreTotal > 0) {
      shoreBlend[shoreBlend.length - 1].weight = round(1 - lagoonWeight
        - shoreBlend.slice(0, -1).reduce((sum, entry) => sum + entry.weight, 0));
      sample.blend = [{ biome: 'lagoon', weight: lagoonWeight }, ...shoreBlend];
    }
  }
  const waterDepth = starterCove ? 0.65 : sample.biome === 'lagoon'
    ? round(clamp01((0.36 - sample.height) / 0.12))
    : 0;
  const slopeX = sampleTerrain(seed, worldX + 0.5, worldY).height
    - sampleTerrain(seed, worldX - 0.5, worldY).height;
  const slopeY = sampleTerrain(seed, worldX, worldY + 0.5).height
    - sampleTerrain(seed, worldX, worldY - 0.5).height;
  return {
    ...sample,
    biome: starterCove ? 'lagoon' : sample.biome,
    waterDepth,
    walkable: !starterCove && waterDepth <= 0.2 && sample.biome !== 'lagoon',
    slope: round(Math.hypot(slopeX, slopeY)),
    bridge: false,
  };
}

function resourceNodesFor(seed, chunkX, chunkY) {
  const nodes = [];
  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  for (let localY = 0; localY < CHUNK_SIZE; localY += 2) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 2) {
      const worldX = originX + localX + 1;
      const worldY = originY + localY + 1;
      const terrain = sampleTerrain(seed, worldX, worldY);
      const biome = biomesById.get(terrain.biome);
      const table = biome?.spawnTable || [];
      for (const spawn of table) {
        if (hashUnit(seed, worldX, worldY, spawn.resourceId, 'spawn') >= spawn.chance) continue;
        const definition = resourcesById.get(spawn.resourceId);
        if (!definition) continue;
        const range = definition.yield.max - definition.yield.min + 1;
        const remaining = definition.yield.min + Math.floor(
          hashUnit(seed, worldX, worldY, spawn.resourceId, 'yield') * range,
        );
        nodes.push({
          id: `${spawn.resourceId}@${worldX},${worldY}`,
          resourceId: spawn.resourceId,
          itemId: definition.itemId,
          position: {
            x: round(worldX + hashUnit(seed, worldX, worldY, spawn.resourceId, 'offset-x') * 0.8 - 0.4),
            y: round(worldY + hashUnit(seed, worldX, worldY, spawn.resourceId, 'offset-y') * 0.8 - 0.4),
          },
          state: 'full',
          remaining,
          recoveryMinutes: definition.recoveryMinutes,
        });
        break;
      }
    }
  }
  return nodes;
}

function landmarksFor(seed, chunkX, chunkY) {
  const landmarks = [];
  const chance = hashUnit(seed, chunkX, chunkY, 'landmark');
  if (chance > 0.82) {
    const kinds = ['fresh-water-fall', 'tidal-ruin', 'lookout-rock', 'giant-banyan'];
    const kind = kinds[Math.floor(hashUnit(seed, chunkX, chunkY, 'landmark-kind') * kinds.length)];
    landmarks.push({
      id: `${kind}@${chunkX},${chunkY}`,
      kind,
      position: {
        x: round(chunkX * CHUNK_SIZE + 3 + hashUnit(seed, chunkX, chunkY, 'landmark-x') * 10),
        y: round(chunkY * CHUNK_SIZE + 3 + hashUnit(seed, chunkX, chunkY, 'landmark-y') * 10),
      },
    });
  }
  return landmarks;
}

function edgeSample(height, moisture, temperature, biome, biomeBlend, index) {
  return [height[index], moisture[index], temperature[index], biome[index], biomeBlend[index]];
}

function generateChunk(seed, chunkX, chunkY) {
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    throw new TypeError('chunk coordinates must be integers');
  }
  const height = [];
  const moisture = [];
  const temperature = [];
  const biome = [];
  const biomeBlend = [];
  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  for (let localY = 0; localY <= CHUNK_SIZE; localY += 1) {
    for (let localX = 0; localX <= CHUNK_SIZE; localX += 1) {
      const sample = sampleTerrain(seed, originX + localX, originY + localY);
      height.push(sample.height);
      moisture.push(sample.moisture);
      temperature.push(sample.temperature);
      biome.push(sample.biome);
      biomeBlend.push(sample.blend);
    }
  }

  const north = [];
  const east = [];
  const south = [];
  const west = [];
  for (let index = 0; index <= CHUNK_SIZE; index += 1) {
    north.push(edgeSample(height, moisture, temperature, biome, biomeBlend, index));
    south.push(edgeSample(
      height,
      moisture,
      temperature,
      biome,
      biomeBlend,
      CHUNK_SIZE * SAMPLE_WIDTH + index,
    ));
    west.push(edgeSample(height, moisture, temperature, biome, biomeBlend, index * SAMPLE_WIDTH));
    east.push(edgeSample(
      height,
      moisture,
      temperature,
      biome,
      biomeBlend,
      index * SAMPLE_WIDTH + CHUNK_SIZE,
    ));
  }

  const chunk = {
    id: `${chunkX},${chunkY}`,
    coordinate: { x: chunkX, y: chunkY },
    height,
    moisture,
    temperature,
    biome,
    biomeBlend,
    resources: resourceNodesFor(seed, chunkX, chunkY),
    landmarks: landmarksFor(seed, chunkX, chunkY),
    edges: { north, east, south, west },
  };
  return chunkX === 0 && chunkY === 0
    ? ensureStarterReachability({ seed, chunk })
    : chunk;
}

function visibleChunks(bounds, margin = 0) {
  if (!bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, margin].every(Number.isFinite)) {
    throw new TypeError('bounds and margin must be finite');
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY || margin < 0) {
    throw new RangeError('invalid bounds or margin');
  }
  const minChunkX = Math.floor((bounds.minX - margin) / CHUNK_SIZE);
  const maxChunkX = Math.floor((bounds.maxX + margin) / CHUNK_SIZE);
  const minChunkY = Math.floor((bounds.minY - margin) / CHUNK_SIZE);
  const maxChunkY = Math.floor((bounds.maxY + margin) / CHUNK_SIZE);
  const chunks = [];
  for (let y = minChunkY; y <= maxChunkY; y += 1) {
    for (let x = minChunkX; x <= maxChunkX; x += 1) chunks.push({ x, y });
  }
  return chunks;
}

function discover(save, chunk) {
  if (!save || save.schemaVersion !== 3) throw new TypeError('discover requires save schema v3');
  if (!Number.isInteger(chunk?.x) || !Number.isInteger(chunk?.y)) {
    throw new TypeError('chunk coordinates must be integers');
  }
  const next = structuredClone(save);
  next.discoveredChunks = {
    ...(next.discoveredChunks || {}),
    [`${chunk.x},${chunk.y}`]: { x: chunk.x, y: chunk.y, visibility: 'discovered' },
  };
  return next;
}

function unknownMapCell(save, chunkX, chunkY) {
  const cell = save?.discoveredChunks?.[`${chunkX},${chunkY}`];
  return cell ? structuredClone(cell) : { x: chunkX, y: chunkY, visibility: 'hidden' };
}

function worldSignature(chunk) {
  return stableDigest(chunk);
}

module.exports = {
  CHUNK_SIZE,
  discover,
  generateChunk,
  sampleTerrain,
  terrainTile,
  unknownMapCell,
  visibleChunks,
  worldSignature,
};
