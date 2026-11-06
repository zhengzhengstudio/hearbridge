const animalCatalog = require('../content/animals.json');
const habitatCatalog = require('../content/habitats.json');
const { hashUnit } = require('./hash.js');

const CHUNK_SIZE = 16;
const SAMPLE_WIDTH = CHUNK_SIZE + 1;
const MAX_ACTIVE_MINUTES = 360;
const MAX_REMOTE_MINUTES = 10_080;
const POPULATION_INTERVAL_MINUTES = 360;
const REVEAL_RADIUS = 10;
const RETALIATION_WARNING_MINUTES = 3;

const animalsById = new Map(animalCatalog.map(animal => [animal.id, animal]));
const habitatsByAnimalId = new Map(
  habitatCatalog.map(habitat => [habitat.animalId, habitat]),
);
const MAX_AWARENESS_RADIUS = Math.max(...animalCatalog.map(animal => animal.awarenessRadius));

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

function distance(a, b) {
  return Math.hypot(
    Number(a?.x || 0) - Number(b?.x || 0),
    Number(a?.y || 0) - Number(b?.y || 0),
  );
}

function populationKey(regionId, animalId) {
  return `${regionId}:${animalId}`;
}

function bucketKey(position) {
  return `${Math.floor(Number(position?.x || 0) / CHUNK_SIZE)},${Math.floor(Number(position?.y || 0) / CHUNK_SIZE)}`;
}

function normalizedRegions(regions) {
  const values = Array.isArray(regions) ? regions : Object.values(regions || {});
  return values
    .filter(region => region && typeof region.id === 'string')
    .sort((left, right) => left.id.localeCompare(right.id));
}

function waterDepth(height) {
  return height < 0.3 ? round4((0.3 - height) / 0.3) : 0;
}

function candidatesFor(region, habitat, playerPosition) {
  const candidates = [];
  const chunkX = Number(region.coordinate?.x);
  const chunkY = Number(region.coordinate?.y);
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) return candidates;
  if (!Array.isArray(region.height) || !Array.isArray(region.biome)) return candidates;

  for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const cellIndex = localY * CHUNK_SIZE + localX;
      if (region.blocked?.[cellIndex] === true) continue;
      if (region.reachable?.[cellIndex] === false) continue;
      const sampleIndex = localY * SAMPLE_WIDTH + localX;
      const height = Number(region.height[sampleIndex]);
      const biome = region.biome[sampleIndex];
      if (!Number.isFinite(height) || !habitat.biomes.includes(biome)) continue;
      const depth = waterDepth(height);
      if (depth < habitat.minWaterDepth || depth > habitat.maxWaterDepth) continue;
      const position = {
        x: chunkX * CHUNK_SIZE + localX + 0.5,
        y: chunkY * CHUNK_SIZE + localY + 0.5,
      };
      if (distance(position, playerPosition) < REVEAL_RADIUS) continue;
      candidates.push({ cellIndex, position });
    }
  }
  return candidates;
}

function emptyState(seed, existing) {
  const state = existing ? structuredClone(existing) : {};
  state.seed = seed;
  state.elapsedMinutes = Number.isFinite(state.elapsedMinutes) ? state.elapsedMinutes : 0;
  state.animals = state.animals || {};
  state.populations = state.populations || {};
  state.spatialBuckets = state.spatialBuckets || {};
  state.processedActions = state.processedActions || {};
  state.emittedEventIds = state.emittedEventIds || {};
  state.clues = state.clues || {};
  return state;
}

function createWildlifeState({
  seed,
  regions,
  discoveredChunks,
  existing,
  playerPosition = { x: 0, y: 0 },
} = {}) {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new TypeError('seed must be a non-empty string');
  }
  const state = emptyState(seed, existing);
  const discovered = discoveredChunks || {};

  for (const region of normalizedRegions(regions)) {
    if (!Object.hasOwn(discovered, region.id)) continue;
    for (const definition of [...animalCatalog].sort((a, b) => a.id.localeCompare(b.id))) {
      const habitat = habitatsByAnimalId.get(definition.id);
      if (!habitat) continue;
      const key = populationKey(region.id, definition.id);
      if (state.populations[key]) continue;
      const candidates = candidatesFor(region, habitat, playerPosition)
        .map(candidate => ({
          ...candidate,
          order: hashUnit(seed, region.id, definition.id, candidate.cellIndex, 'wildlife-spawn'),
        }))
        .sort((left, right) => left.order - right.order || left.cellIndex - right.cellIndex);
      const targetAdults = Math.min(
        candidates.length,
        1 + Math.floor(hashUnit(seed, region.id, definition.id, 'population') * Math.min(3, habitat.baseCapacity)),
      );
      state.populations[key] = {
        adults: targetAdults,
        young: 0,
        capacity: habitat.baseCapacity,
        huntingPressure: 0,
        lastUpdatedMinute: state.elapsedMinutes,
      };
      for (const candidate of candidates.slice(0, targetAdults)) {
        const id = `${region.id}:${definition.id}:${candidate.cellIndex}`;
        if (state.animals[id]) continue;
        state.animals[id] = {
          id,
          speciesId: definition.id,
          regionId: region.id,
          position: candidate.position,
          health: definition.maxHealth,
          state: 'foraging',
        };
        const spatialKey = bucketKey(candidate.position);
        state.spatialBuckets[spatialKey] = state.spatialBuckets[spatialKey] || [];
        state.spatialBuckets[spatialKey].push(id);
      }
    }
  }

  state.animals = Object.fromEntries(Object.entries(state.animals).sort(([a], [b]) => a.localeCompare(b)));
  state.populations = Object.fromEntries(Object.entries(state.populations).sort(([a], [b]) => a.localeCompare(b)));
  state.spatialBuckets = Object.fromEntries(
    Object.entries(state.spatialBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => [key, [...new Set(ids)].sort()]),
  );
  return state;
}

function failure(state, error, details = {}) {
  return { ok: false, state, events: [], error, details };
}

function eventId(type, animalId, token) {
  return `${type}|${animalId}|${token}`;
}

function emitEvent(state, events, type, animal, token, details = {}) {
  const id = eventId(type, animal.id, token);
  if (state.emittedEventIds[id]) return;
  state.emittedEventIds[id] = true;
  events.push({ id, type, animalId: animal.id, speciesId: animal.speciesId, ...details });
}

function leaveClue(state, animal, type = 'track') {
  state.clues = state.clues || {};
  const token = `${animal.id}:${type}:${Math.floor(Number(state.elapsedMinutes || 0) * 10)}`;
  state.clues[token] = {
    id: token,
    type,
    animalId: animal.id,
    speciesId: animal.speciesId,
    position: structuredClone(animal.position),
    freshness: 1,
    createdAtMinute: Number(state.elapsedMinutes || 0),
  };
}

function ageClues(state, elapsedMinutes) {
  state.clues = Object.fromEntries(Object.entries(state.clues || {}).flatMap(([id, clue]) => {
    const freshness = round4(Math.max(0, Number(clue.freshness || 0) - elapsedMinutes / 180));
    return freshness > 0 ? [[id, { ...clue, freshness }]] : [];
  }));
}

// ===== 移动（确定性，各端一致）=====
// 位置单位 = tile（1 tile = 48 世界单位）。动物在自己的 16×16 区块内活动，
// 方向由 (seed, animalId, 分钟桶) 哈希决定，因此所有平台推进同样的分钟会走到同一位置。
const MOVE_STEP_TILES = 0.2;
const MOVE_INTENT_MINUTES = 2;
const MOVE_TURN_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4];

function chunkOf(position) {
  return {
    x: Math.floor(Number(position?.x || 0) / CHUNK_SIZE),
    y: Math.floor(Number(position?.y || 0) / CHUNK_SIZE),
  };
}

function intentAngle(state, animal, attempt) {
  const bucket = Math.floor(Number(state.elapsedMinutes || 0) / MOVE_INTENT_MINUTES);
  return hashUnit(state.seed, animal.id, 'move-intent', bucket, attempt) * Math.PI * 2;
}

function depthAllowed(habitat, height) {
  const depth = waterDepth(height);
  return depth >= habitat.minWaterDepth && depth <= habitat.maxWaterDepth;
}

// 地形查询由各端注入（tile 空间）。没有注入时不做水深限制，保证降级可运行。
function canStand(habitat, x, y, context) {
  const heightAt = context?.terrainHeightAt;
  if (typeof heightAt !== 'function') return true;
  const height = Number(heightAt(x, y));
  if (!Number.isFinite(height)) return true;
  return depthAllowed(habitat, height);
}

function reindexAnimal(state, animal, previousKey) {
  const nextKey = bucketKey(animal.position);
  if (previousKey === nextKey) return;
  if (state.spatialBuckets[previousKey]) {
    state.spatialBuckets[previousKey] = state.spatialBuckets[previousKey].filter(id => id !== animal.id);
    if (!state.spatialBuckets[previousKey].length) delete state.spatialBuckets[previousKey];
  }
  state.spatialBuckets[nextKey] = state.spatialBuckets[nextKey] || [];
  if (!state.spatialBuckets[nextKey].includes(animal.id)) state.spatialBuckets[nextKey].push(animal.id);
}

// 让一只动物按状态推进位置：觅食/休息时游走，逃跑时更快，警戒/反击时朝玩家逼近。
function moveAnimal(animal, state, context, definition, habitat, minutes) {
  if (!definition || !habitat || minutes <= 0) return;
  const playerPosition = context.player?.position || { x: 0, y: 0 };
  const stationary = ['resting', 'seek-shelter', 'tame'];
  const charging = ['threaten', 'retaliate'];
  const speed = animal.state === 'flee'
    ? Number(definition.fleeSpeed || 0)
    : Number(definition.moveSpeed || 0);
  if (!speed) return;

  let baseAngle;
  if (charging.includes(animal.state)) {
    // 反击型：朝玩家逼近，速度减半
    const dx = playerPosition.x - animal.position.x;
    const dy = playerPosition.y - animal.position.y;
    const length = Math.hypot(dx, dy);
    baseAngle = length > 0.001 ? Math.atan2(dy, dx) : 0;
  } else if (stationary.includes(animal.state)) {
    return;
  } else {
    baseAngle = intentAngle(state, animal, 0);
  }
  const effectiveSpeed = charging.includes(animal.state) ? speed * 0.5 : speed;
  const total = effectiveSpeed * minutes;
  const steps = Math.max(1, Math.round(total / MOVE_STEP_TILES));
  const step = total / steps;
  const chunk = chunkOf(animal.position);
  const minX = chunk.x * CHUNK_SIZE + 0.05;
  const maxX = chunk.x * CHUNK_SIZE + CHUNK_SIZE - 0.05;
  const minY = chunk.y * CHUNK_SIZE + 0.05;
  const maxY = chunk.y * CHUNK_SIZE + CHUNK_SIZE - 0.05;

  let x = animal.position.x;
  let y = animal.position.y;
  for (let index = 0; index < steps; index += 1) {
    let moved = false;
    for (const turn of MOVE_TURN_ANGLES) {
      const angle = baseAngle + turn;
      const nx = Math.min(maxX, Math.max(minX, x + Math.cos(angle) * step));
      const ny = Math.min(maxY, Math.max(minY, y + Math.sin(angle) * step));
      if (nx === x && ny === y) continue;
      if (!canStand(habitat, nx, ny, context)) continue;
      x = nx;
      y = ny;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  if (x === animal.position.x && y === animal.position.y) return;
  const previousKey = bucketKey(animal.position);
  animal.position = { x: round4(x), y: round4(y) };
  animal.moveIntent = round4(baseAngle);
  reindexAnimal(state, animal, previousKey);
}

function activeAnimals(state, playerPosition, activeRadius) {
  const minX = Math.floor((playerPosition.x - activeRadius) / CHUNK_SIZE);
  const maxX = Math.floor((playerPosition.x + activeRadius) / CHUNK_SIZE);
  const minY = Math.floor((playerPosition.y - activeRadius) / CHUNK_SIZE);
  const maxY = Math.floor((playerPosition.y + activeRadius) / CHUNK_SIZE);
  const ids = new Set();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (const id of state.spatialBuckets?.[`${x},${y}`] || []) ids.add(id);
    }
  }
  return [...ids]
    .sort()
    .map(id => state.animals[id])
    .filter(animal => animal && distance(animal.position, playerPosition) <= activeRadius);
}

function transitionAnimal(animal, state, context, events, endMinute) {
  const definition = animalsById.get(animal.speciesId);
  if (!definition) return;
  const playerPosition = context.player?.position || { x: 0, y: 0 };
  const lineOfSight = context.lineOfSight !== false;
  const phase = context.phase;
  const weatherKind = context.weather?.kind;
  const habitat = habitatsByAnimalId.get(animal.speciesId);

  if (['threaten', 'retaliate'].includes(animal.state) && !lineOfSight) {
    animal.state = 'search';
    animal.searchUntilMinute = round4(endMinute + 3);
    delete animal.threatenUntilMinute;
    leaveClue(state, animal);
    return;
  }
  if (animal.state === 'search') {
    if (lineOfSight && distance(animal.position, playerPosition) <= definition.awarenessRadius) {
      const afraid = !definition.retaliationTriggers.includes('proximity');
      animal.state = afraid ? 'flee' : 'threaten';
      if (afraid) {
        emitEvent(state, events, 'wildlife-flee', animal, round4(state.elapsedMinutes), {
          reason: 'spotted',
        });
      }
      return;
    }
    if (endMinute >= Number(animal.searchUntilMinute || 0)) {
      animal.state = 'foraging';
      delete animal.searchUntilMinute;
    }
    return;
  }
  // 威吓中的动物：玩家走远就放弃，转入搜索
  if (animal.state === 'threaten' && distance(animal.position, playerPosition) > definition.awarenessRadius) {
    animal.state = 'search';
    animal.searchUntilMinute = round4(endMinute + 3);
    delete animal.threatenUntilMinute;
    leaveClue(state, animal);
    return;
  }
  if (!['threaten', 'retaliate', 'flee', 'tame'].includes(animal.state)) {
    if (phase && !definition.activityWindows.includes(phase)) {
      animal.state = 'resting';
      return;
    }
    if (weatherKind && Number(habitat?.weatherWeights?.[weatherKind] ?? 0.5) <= 0.2) {
      animal.state = 'seek-shelter';
      return;
    }
    if (animal.state === 'resting' || animal.state === 'seek-shelter') animal.state = 'foraging';
  }
  if (distance(animal.position, playerPosition) > definition.awarenessRadius) return;
  if (!lineOfSight) return;

  if (!definition.retaliationTriggers.includes('proximity')) {
    if (animal.state !== 'flee') {
      emitEvent(state, events, 'wildlife-flee', animal, round4(state.elapsedMinutes), {
        reason: 'proximity',
      });
    }
    animal.state = 'flee';
    return;
  }
  if (animal.state !== 'threaten' && animal.state !== 'retaliate') {
    animal.state = 'threaten';
    animal.threatenUntilMinute = round4(state.elapsedMinutes + RETALIATION_WARNING_MINUTES);
    emitEvent(state, events, 'wildlife-warning', animal, round4(state.elapsedMinutes));
    // 威吓到此为止：下一拍才可能反击。
    // 否则同一次推进里「威吓→反击」连着发生，玩家根本看不到预警就被撞。
    return;
  }
  if (animal.state === 'threaten' && !Number.isFinite(animal.threatenUntilMinute)) {
    animal.threatenUntilMinute = round4(state.elapsedMinutes + RETALIATION_WARNING_MINUTES);
  }
  if (animal.state === 'threaten' && endMinute >= animal.threatenUntilMinute) {
    animal.state = 'retaliate';
    emitEvent(
      state,
      events,
      'wildlife-retaliation',
      animal,
      animal.threatenUntilMinute,
    );
    delete animal.threatenUntilMinute;
    return;
  }
}

function updateRemotePopulations(state) {
  const now = state.elapsedMinutes;
  for (const key of Object.keys(state.populations).sort()) {
    const population = state.populations[key];
    let lastUpdated = Number(population.lastUpdatedMinute || 0);
    let recoveryMinutes = Number(population.recoveryMinutes || 0);
    while (now - lastUpdated >= POPULATION_INTERVAL_MINUTES) {
      const pressure = Math.max(0, Number(population.huntingPressure || 0));
      const effectiveCapacity = Math.max(
        0,
        Math.floor(Number(population.capacity || 0) / (1 + pressure)),
      );
      recoveryMinutes += POPULATION_INTERVAL_MINUTES;
      if (recoveryMinutes >= 1440) {
        if (population.adults > 0 && population.adults < effectiveCapacity) {
          population.adults = Math.min(
            effectiveCapacity,
            population.adults + Math.max(1, Math.floor(population.adults * 0.25)),
          );
        }
        recoveryMinutes -= 1440;
      }
      population.huntingPressure = round4(Math.max(
        0,
        pressure - POPULATION_INTERVAL_MINUTES / 14_400,
      ));
      lastUpdated += POPULATION_INTERVAL_MINUTES;
    }
    population.recoveryMinutes = recoveryMinutes;
    population.lastUpdatedMinute = lastUpdated;
  }
}

function stepWildlife(state, context = {}, elapsedMinutes) {
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) {
    return failure(state, 'invalid-elapsed');
  }
  const simulatedMinutes = Math.min(elapsedMinutes, MAX_ACTIVE_MINUTES);
  const remoteMinutes = Math.min(elapsedMinutes, MAX_REMOTE_MINUTES);
  const next = structuredClone(state);
  next.emittedEventIds = next.emittedEventIds || {};
  next.elapsedMinutes = Number(next.elapsedMinutes || 0);
  const events = [];
  if (elapsedMinutes === 0) {
    return {
      ok: true,
      state: next,
      events,
      error: null,
      details: { simulatedMinutes, visitedAnimals: 0 },
    };
  }
  next.clues = next.clues || {};
  const playerPosition = context.player?.position || { x: 0, y: 0 };
  const requestedRadius = Number.isFinite(context.activeRadius) && context.activeRadius >= 0
    ? context.activeRadius
    : 32;
  const activeRadius = Math.max(requestedRadius, MAX_AWARENESS_RADIUS);
  const active = activeAnimals(next, playerPosition, activeRadius);
  const activeEndMinute = round4(next.elapsedMinutes + simulatedMinutes);
  ageClues(next, simulatedMinutes);
  for (const animal of active) {
    transitionAnimal(animal, next, context, events, activeEndMinute);
  }
  // 全部动物都推进位置（远处动物只做低频位置统计，不做完整行为切换）。
  // 少了这一步，远处动物会永远停在出生点，等于把动物做成「固定位置的资源节点」。
  for (const animal of Object.values(next.animals)) {
    const definition = animalsById.get(animal.speciesId);
    const habitat = habitatsByAnimalId.get(animal.speciesId);
    moveAnimal(animal, next, context, definition, habitat, simulatedMinutes);
  }
  next.elapsedMinutes = round4(next.elapsedMinutes + remoteMinutes);
  updateRemotePopulations(next);
  return {
    ok: true,
    state: next,
    events,
    error: null,
    details: { simulatedMinutes, visitedAnimals: active.length },
  };
}

function actionToken(state, action) {
  if (typeof action.id === 'string' && action.id.length > 0) return action.id;
  return `${action.type}:${action.animalId}:${action.amount}:${round4(Number(state.elapsedMinutes || 0))}`;
}

function applyWildlifeAction(state, action = {}, context = {}) {
  if (!['damage', 'feed'].includes(action.type)) return failure(state, 'unsupported-action');
  if (action.type === 'feed') {
    const animal = state.animals?.[action.animalId];
    if (!animal) return failure(state, 'animal-not-found');
    const definition = animalsById.get(animal.speciesId);
    const habitat = habitatsByAnimalId.get(animal.speciesId);
    if (!definition?.tameable || !habitat?.foodTags?.includes(action.itemId)) return failure(state, 'invalid-feed');
    if (context.safeCamp !== true) return failure(state, 'unsafe-camp');
    const token = actionToken(state, action);
    if (state.processedActions?.[token]) {
      return { ok: true, state, events: [], error: null, details: { duplicate: true } };
    }
    const next = structuredClone(state);
    next.processedActions = next.processedActions || {};
    next.emittedEventIds = next.emittedEventIds || {};
    next.processedActions[token] = true;
    const nextAnimal = next.animals[action.animalId];
    nextAnimal.tamingProgress = Math.min(3, Number(nextAnimal.tamingProgress || 0) + 1);
    const events = [];
    if (nextAnimal.tamingProgress >= 3) {
      nextAnimal.tamedBy = context.player?.id || 'local';
      nextAnimal.state = 'tame';
      emitEvent(next, events, 'wildlife-tamed', nextAnimal, token, { playerId: nextAnimal.tamedBy });
    }
    return { ok: true, state: next, events, error: null, details: { tamingProgress: nextAnimal.tamingProgress } };
  }
  if (!Number.isFinite(action.amount) || action.amount <= 0) {
    return failure(state, 'invalid-damage');
  }
  const token = actionToken(state, action);
  if (state.processedActions?.[token]) {
    return { ok: true, state, events: [], error: null, details: { duplicate: true } };
  }
  const animal = state.animals?.[action.animalId];
  if (!animal) return failure(state, 'animal-not-found');

  const next = structuredClone(state);
  next.processedActions = next.processedActions || {};
  next.emittedEventIds = next.emittedEventIds || {};
  next.processedActions[token] = true;
  const nextAnimal = next.animals[action.animalId];
  nextAnimal.health = round4(Math.max(0, nextAnimal.health - action.amount));
  const events = [];
  if (nextAnimal.health > 0) {
    const retaliates = animalsById.get(nextAnimal.speciesId)?.retaliationTriggers.includes('attacked');
    if (retaliates) {
      nextAnimal.state = 'threaten';
    } else {
      if (nextAnimal.state !== 'flee') {
        emitEvent(next, events, 'wildlife-flee', nextAnimal, token, { reason: 'attacked' });
      }
      nextAnimal.state = 'flee';
    }
    emitEvent(next, events, 'wildlife-hurt', nextAnimal, token, {
      health: nextAnimal.health,
    });
    return {
      ok: true,
      state: next,
      events,
      error: null,
      details: { animalId: nextAnimal.id, lethal: false },
    };
  }

  const spatialKey = bucketKey(nextAnimal.position);
  if (next.spatialBuckets[spatialKey]) {
    next.spatialBuckets[spatialKey] = next.spatialBuckets[spatialKey]
      .filter(id => id !== nextAnimal.id);
  }
  const key = populationKey(nextAnimal.regionId, nextAnimal.speciesId);
  const population = next.populations[key];
  if (population) {
    population.adults = Math.max(0, Number(population.adults || 0) - 1);
    population.huntingPressure = round4(Number(population.huntingPressure || 0) + 1);
  }
  emitEvent(next, events, 'wildlife-killed', nextAnimal, token, {
    playerId: context.player?.id || null,
  });
  delete next.animals[nextAnimal.id];
  return {
    ok: true,
    state: next,
    events,
    error: null,
    details: { animalId: nextAnimal.id, lethal: true },
  };
}

module.exports = {
  applyWildlifeAction,
  createWildlifeState,
  populationKey,
  stepWildlife,
};
