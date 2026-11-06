const weatherKinds = require('../content/weather.json');
const itemCatalog = require('../content/items.json');
const buildings = require('../content/buildings.json');
const recipes = require('../content/recipes.json');
const resourceCatalog = require('../content/resources.json');
const { hashUnit } = require('./hash.js');

const REAL_MILLISECONDS_PER_GAME_DAY = 1_800_000;
const GAME_MINUTES_PER_DAY = 1_440;
const GAME_MINUTES_PER_REAL_MILLISECOND = (
  GAME_MINUTES_PER_DAY / REAL_MILLISECONDS_PER_GAME_DAY
);
const WEATHER_BUCKET_MINUTES = 120;
const HEALTH_BLOCKERS = new Map([
  ['bleeding', 'untreated-bleeding'],
  ['infected', 'untreated-infection'],
  ['dehydrated', 'dehydration'],
  ['starving', 'starvation'],
  ['cold', 'hypothermia'],
  ['overheated', 'hyperthermia'],
]);
const ACTIVITY_STAMINA_PER_MINUTE = {
  idle: 0.14,
  walking: -0.08,
  mining: -0.18,
  running: -0.28,
  swimming: -0.38,
  sleeping: 0.36,
  'sleep-until-morning': 0.36,
};
const buildingByItemId = new Map(buildings.map(building => [building.itemId, building]));
const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
const resourceById = new Map(resourceCatalog.map(resource => [resource.id, resource]));
const itemById = new Map(itemCatalog.map(item => [item.id, item]));
const toolCapabilities = {
  'stone-axe': { tags: ['axe'], tier: 1 },
  'stone-machete': { tags: ['machete', 'axe'], tier: 1 },
  'stone-pickaxe': { tags: ['pickaxe'], tier: 1 },
  'copper-pickaxe': { tags: ['pickaxe'], tier: 2 },
  'iron-pickaxe': { tags: ['pickaxe'], tier: 3 },
  machete: { tags: ['machete', 'axe'], tier: 2 },
  shovel: { tags: ['shovel'], tier: 2 },
  'fishing-rod': { tags: ['fishing'], tier: 1 },
  waterskin: { tags: ['container'], tier: 1 },
};
const bedQualityByItemId = {
  'straw-mat': 0.25,
  hammock: 0.45,
  'simple-bed': 0.65,
  'camp-bed': 0.82,
  'wooden-bed': 0.95,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function dayPhase(minute) {
  const normalized = ((minute % GAME_MINUTES_PER_DAY) + GAME_MINUTES_PER_DAY) % GAME_MINUTES_PER_DAY;
  if (normalized >= 300 && normalized < 390) return 'dawn';
  if (normalized >= 390 && normalized < 1260) return 'day';
  if (normalized >= 1260 && normalized < 1350) return 'dusk';
  return 'night';
}

function weatherForV3(seed, day, time, climate = {}) {
  const temperature = clamp(Number(climate.temperature ?? 0.55), 0, 1);
  const moisture = clamp(Number(climate.moisture ?? 0.5), 0, 1);
  const height = clamp(Number(climate.height ?? 0.5), 0, 1);
  const bucket = Math.floor(time / WEATHER_BUCKET_MINUTES);
  const eligible = weatherKinds.filter(kind => (
    temperature >= kind.minTemperature && temperature <= kind.maxTemperature
  ));
  const candidates = eligible.length > 0
    ? eligible
    : weatherKinds.filter(kind => kind.id === 'clear');
  const selected = candidates[
    Math.floor(hashUnit(seed, day, bucket, height, moisture, temperature, 'weather') * candidates.length)
      % candidates.length
  ];
  const intensity = round(hashUnit(seed, day, bucket, height, moisture, temperature, 'intensity'));
  return {
    kind: selected.id,
    intensity,
    wetness: round(clamp(selected.wetness * intensity, 0, 1)),
    wind: round(clamp(selected.wind * (0.5 + intensity / 2), 0, 1)),
  };
}

function createSaveV3(seed) {
  if (typeof seed !== 'string' || seed.length === 0) throw new TypeError('seed must be a non-empty string');
  return {
    schemaVersion: 3,
    productVersion: '0.4.0',
    build: 4,
    seed,
    playMode: 'guided',
    onboarding: { enabled: true, version: 1 },
    day: 1,
    time: 390,
    elapsedGameMinutes: 0,
    phase: 'day',
    weather: { kind: 'clear', intensity: 0, wetness: 0, wind: 0.15 },
    vitals: {
      health: 100,
      stamina: 100,
      hunger: 100,
      hydration: 100,
      bodyTemperature: 37,
      carriedMass: 0,
      effects: [],
    },
    discoveredChunks: {},
    resourceNodes: {},
    inventory: {},
    entities: {},
    players: {},
    journals: {},
    milestones: {},
    trackedRecipe: null,
    sleepState: { players: {} },
    lastModifiers: [],
  };
}

function failure(state, error, details = {}) {
  return { ok: false, error, details, state };
}

function success(state, details = {}) {
  return { ok: true, error: null, details, state };
}

function localPlayer(state, playerId = 'local') {
  return state.players?.[playerId] || {
    id: playerId,
    inventory: {},
    position: { x: 0, y: 0 },
  };
}

function distance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}

function removeInventoryEntry(inventory, itemId, amount) {
  inventory[itemId] = (inventory[itemId] || 0) - amount;
  if (inventory[itemId] <= 0) delete inventory[itemId];
}

function harvest(state, nodeId, toolItemId, elapsedMs, playerId = 'local') {
  if (!state || state.schemaVersion !== 3) return failure(state, 'invalid-save');
  const node = state.resourceNodes?.[nodeId];
  if (!node) return failure(state, 'resource-not-found');
  if (
    node.permission === 'denied'
    || (node.permission === 'owner' && node.ownerId && node.ownerId !== playerId)
  ) return failure(state, 'permission-denied');
  if (node.state === 'depleted' || node.remaining <= 0) return failure(state, 'resource-depleted');
  const definition = resourceById.get(node.resourceId);
  if (!definition) return failure(state, 'resource-definition-missing');
  const tool = toolCapabilities[toolItemId] || { tags: [], tier: 0 };
  const requiredTags = definition.toolTags || [];
  if (requiredTags.length > 0 && !requiredTags.some(tag => tool.tags.includes(tag))) {
    return failure(state, 'wrong-tool', { requiredTags });
  }
  if (tool.tier < definition.hardness) {
    return failure(state, 'tool-tier-too-low', { requiredTier: definition.hardness, actualTier: tool.tier });
  }
  const player = localPlayer(state, playerId);
  if (distance(player.position, node.position) > 2.5) return failure(state, 'out-of-range');
  if (requiredTags.length > 0 && (state.inventory[toolItemId] || 0) < 1) {
    return failure(state, 'tool-not-owned');
  }
  const staminaCost = Math.max(2, definition.hardness * 2 + 1);
  if (state.vitals.stamina < staminaCost) return failure(state, 'insufficient-stamina');
  const requiredMs = 250 + definition.hardness * 250;
  if (!Number.isFinite(elapsedMs) || elapsedMs < requiredMs) {
    return failure(state, 'action-incomplete', { requiredMs });
  }

  const next = structuredClone(state);
  const nextNode = next.resourceNodes[nodeId];
  nextNode.remaining -= 1;
  nextNode.state = nextNode.remaining > 0 ? 'hit' : 'depleted';
  if (nextNode.state === 'depleted' && nextNode.recoveryMinutes > 0) {
    nextNode.recoversAtGameMinute = round(next.elapsedGameMinutes + nextNode.recoveryMinutes);
  }
  next.inventory[node.itemId] = (next.inventory[node.itemId] || 0) + 1;
  next.vitals.stamina = clamp(next.vitals.stamina - staminaCost);
  next.lastModifiers = [
    { code: `harvest:${node.resourceId}`, value: 1 },
    { code: 'activity:harvest-stamina', value: -staminaCost },
  ];
  return success(next, { nodeId, itemId: node.itemId, amount: 1 });
}

function craft(state, recipeId, count = 1) {
  if (!state || state.schemaVersion !== 3) return failure(state, 'invalid-save');
  if (!Number.isInteger(count) || count < 1) return failure(state, 'invalid-count');
  const recipe = recipeById.get(recipeId);
  if (!recipe) return failure(state, 'recipe-not-found');
  const player = localPlayer(state);
  const hasNearbyStation = (state.nearbyStations || []).includes(recipe.station)
    || Object.values(state.entities || {}).some(entity => (
      entity.type === recipe.station && distance(player.position, entity.coordinates) <= 3
    ));
  if (recipe.station !== 'hand' && !hasNearbyStation) {
    return failure(state, 'station-required', { station: recipe.station });
  }
  const missing = {};
  for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
    const required = amount * count;
    const available = state.inventory[itemId] || 0;
    if (available < required) missing[itemId] = required - available;
  }
  if (Object.keys(missing).length > 0) return failure(state, 'missing-ingredients', { missing });
  const staminaCost = Math.max(1, Math.ceil(recipe.durationSeconds * count / 20));
  if (state.vitals.stamina < staminaCost) return failure(state, 'insufficient-stamina');

  const next = structuredClone(state);
  for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
    removeInventoryEntry(next.inventory, itemId, amount * count);
  }
  next.inventory[recipe.output.itemId] = (
    (next.inventory[recipe.output.itemId] || 0) + recipe.output.amount * count
  );
  next.vitals.stamina = clamp(next.vitals.stamina - staminaCost);
  next.lastModifiers = [{ code: `craft:${recipe.id}`, value: count }];
  return success(next, {
    recipeId,
    itemId: recipe.output.itemId,
    amount: recipe.output.amount * count,
    durationSeconds: recipe.durationSeconds * count,
  });
}

function footprintFor(building, rotation) {
  const quarterTurns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  const swap = quarterTurns % 2 === 1;
  return {
    width: swap ? building.collision.height : building.collision.width,
    height: swap ? building.collision.width : building.collision.height,
  };
}

function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

function place(state, itemId, transform) {
  if (!state || state.schemaVersion !== 3) return failure(state, 'invalid-save');
  const building = buildingByItemId.get(itemId);
  if (!building) return failure(state, 'not-placeable');
  if ((state.inventory[itemId] || 0) < 1) return failure(state, 'missing-item');
  if (!Number.isInteger(transform?.x) || !Number.isInteger(transform?.y)) {
    return failure(state, 'invalid-position');
  }
  const rotation = ((Math.round(Number(transform.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  const slope = Number(transform.slope || 0);
  const waterDepth = Number(transform.waterDepth || 0);
  if (!Number.isFinite(slope) || slope > 0.35) return failure(state, 'slope-too-steep');
  if (!Number.isFinite(waterDepth) || (waterDepth > 0.2 && !['dock', 'rope-bridge'].includes(itemId))) {
    return failure(state, 'water-too-deep');
  }
  const footprint = footprintFor(building, rotation);
  const candidate = { x: transform.x, y: transform.y, ...footprint };
  for (const entity of Object.values(state.entities || {})) {
    const entityBuilding = buildingByItemId.get(entity.type);
    if (!entityBuilding) continue;
    const entityFootprint = entity.footprint || footprintFor(entityBuilding, entity.rotation || 0);
    const existing = {
      x: entity.coordinates.x,
      y: entity.coordinates.y,
      width: entityFootprint.width,
      height: entityFootprint.height,
    };
    if (overlaps(candidate, existing)) return failure(state, 'collision', { entityId: entity.id });
  }

  const next = structuredClone(state);
  const ordinal = Object.keys(next.entities).length + 1;
  const entityId = `${itemId}@${transform.x},${transform.y}#${ordinal}`;
  removeInventoryEntry(next.inventory, itemId, 1);
  next.entities[entityId] = {
    id: entityId,
    type: itemId,
    coordinates: { x: transform.x, y: transform.y },
    rotation,
    footprint,
    durability: building.maxDurability,
    maxDurability: building.maxDurability,
    interaction: building.interaction,
    permission: transform.permission || 'owner',
    state: 'working',
  };
  next.lastModifiers = [{ code: `place:${itemId}`, value: 1 }];
  return success(next, { entityId });
}

function beginSleep(state, playerId, bedId) {
  if (!state || state.schemaVersion !== 3) return failure(state, 'invalid-save');
  const player = state.players?.[playerId];
  if (!player) return failure(state, 'player-not-found');
  const bed = state.entities?.[bedId];
  const bedQuality = bedQualityByItemId[bed?.type];
  if (!bed || bedQuality == null) return failure(state, 'bed-not-found');
  if (bed.permission === 'denied') return failure(state, 'permission-denied');
  if (distance(player.position, bed.coordinates) > 3) return failure(state, 'out-of-range');
  const next = structuredClone(state);
  next.sleepState = next.sleepState || { players: {} };
  next.sleepState.players[playerId] = {
    bedId,
    bedQuality,
    startedAtDay: next.day,
    startedAtMinute: next.time,
  };
  next.lastModifiers = [{ code: `sleep:${bed.type}`, value: bedQuality }];
  return success(next, { bedId, bedQuality });
}

function normalizedEnvironment(context, state) {
  const environment = context?.environment || {};
  const climate = environment.climate || {
    height: 0.5,
    moisture: 0.5,
    temperature: Number(environment.ambientTemperature ?? 0.55),
  };
  const weather = weatherForV3(state.seed, state.day, state.time, climate);
  return {
    ambientTemperature: clamp(Number(environment.ambientTemperature ?? climate.temperature ?? 0.55), 0, 1),
    wetness: clamp(Number(environment.wetness ?? weather.wetness), 0, 1),
    sheltered: environment.sheltered === true,
    nearFire: environment.nearFire === true,
    bedQuality: clamp(Number(environment.bedQuality ?? 0), 0, 1),
    safe: environment.safe !== false,
    climate,
    weather,
  };
}

function effectMap(effects) {
  return new Map((effects || []).map(effect => [effect.id, { ...effect }]));
}

function setEffect(effects, id, stacks, source) {
  if (stacks <= 0) {
    effects.delete(id);
    return;
  }
  effects.set(id, { id, stacks: Math.max(1, Math.round(stacks)), ...(source ? { source } : {}) });
}

function updateDerivedEffects(vitals, environment) {
  const effects = effectMap(vitals.effects);
  const effectiveWetness = environment.sheltered ? environment.wetness * 0.2 : environment.wetness;
  setEffect(effects, 'wet', effectiveWetness >= 0.35 ? Math.ceil(effectiveWetness * 4) : 0, 'weather');
  setEffect(effects, 'cold', vitals.bodyTemperature < 35 ? Math.ceil(35 - vitals.bodyTemperature) : 0, 'temperature');
  setEffect(effects, 'overheated', vitals.bodyTemperature > 39 ? Math.ceil(vitals.bodyTemperature - 39) : 0, 'temperature');
  setEffect(effects, 'dehydrated', vitals.hydration <= 10 ? 1 : 0, 'hydration');
  setEffect(effects, 'starving', vitals.hunger <= 10 ? 1 : 0, 'hunger');
  setEffect(effects, 'overloaded', vitals.carriedMass > 30 ? Math.ceil((vitals.carriedMass - 30) / 10) : 0, 'mass');
  if (environment.sheltered) setEffect(effects, 'sheltered', 1, 'environment');
  else effects.delete('sheltered');
  if (environment.nearFire) setEffect(effects, 'warm', 1, 'fire');
  else effects.delete('warm');
  vitals.effects = [...effects.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function recoveryReasons(state, environment = {}) {
  const reasons = [];
  const effectIds = new Set(state?.vitals?.effects?.map(effect => effect.id) || []);
  for (const [effectId, code] of HEALTH_BLOCKERS) {
    if (effectIds.has(effectId)) reasons.push({ code, effectId });
  }
  if ((state?.vitals?.hydration ?? 100) <= 10 && !effectIds.has('dehydrated')) {
    reasons.push({ code: 'dehydration', effectId: 'dehydrated' });
  }
  if ((state?.vitals?.hunger ?? 100) <= 10 && !effectIds.has('starving')) {
    reasons.push({ code: 'starvation', effectId: 'starving' });
  }
  if ((state?.vitals?.bodyTemperature ?? 37) < 35 && !effectIds.has('cold')) {
    reasons.push({ code: 'hypothermia', effectId: 'cold' });
  }
  if ((state?.vitals?.bodyTemperature ?? 37) > 39 && !effectIds.has('overheated')) {
    reasons.push({ code: 'hyperthermia', effectId: 'overheated' });
  }
  if (environment.safe === false) reasons.push({ code: 'unsafe-location' });
  if ((state?.vitals?.hunger ?? 100) < 80) reasons.push({ code: 'needs-food' });
  if ((state?.vitals?.hydration ?? 100) < 70) reasons.push({ code: 'needs-water' });
  return reasons;
}

function simulateMinutes(state, gameMinutes, context) {
  const next = structuredClone(state);
  const activity = ACTIVITY_STAMINA_PER_MINUTE[context?.activity]
    ?? ACTIVITY_STAMINA_PER_MINUTE.idle;
  const environment = normalizedEnvironment(context, next);
  const modifiers = [
    { code: `activity:${context?.activity || 'idle'}`, value: round(activity * gameMinutes) },
  ];
  const overload = Math.max(0, next.vitals.carriedMass - 30);
  const overloadCost = overload * 0.006 * gameMinutes;
  if (overloadCost > 0) modifiers.push({ code: 'load:overburdened', value: round(-overloadCost) });

  next.vitals.hunger = clamp(next.vitals.hunger - 0.006 * gameMinutes);
  next.vitals.hydration = clamp(next.vitals.hydration - (
    0.009 + (context?.activity === 'running' ? 0.006 : 0) + (context?.activity === 'swimming' ? 0.003 : 0)
  ) * gameMinutes);
  const nutritionFactor = next.vitals.hunger >= 80 && next.vitals.hydration >= 70
    ? 1.6
    : next.vitals.hunger >= 45 && next.vitals.hydration >= 45
      ? 1
      : next.vitals.hunger > 10 && next.vitals.hydration > 10 ? .35 : 0;
  const staminaDelta = activity > 0 ? activity * nutritionFactor * gameMinutes : activity * gameMinutes;
  next.vitals.stamina = clamp(next.vitals.stamina + staminaDelta - overloadCost);
  modifiers[0] = { code: `activity:${context?.activity || 'idle'}`, value: round(staminaDelta) };

  const effectiveWetness = environment.sheltered ? environment.wetness * 0.2 : environment.wetness;
  let targetTemperature = 34 + environment.ambientTemperature * 5.5 - effectiveWetness * 2.2;
  if (environment.nearFire) targetTemperature += 1.8;
  targetTemperature = clamp(targetTemperature, 31, 41);
  const temperatureDelta = (targetTemperature - next.vitals.bodyTemperature) * Math.min(1, gameMinutes * 0.006);
  next.vitals.bodyTemperature = round(clamp(next.vitals.bodyTemperature + temperatureDelta, 30, 42));
  if (effectiveWetness > 0.05) modifiers.push({ code: 'exposure:wet', value: round(-effectiveWetness) });
  if (environment.sheltered) modifiers.push({ code: 'environment:sheltered', value: 1 });
  if (environment.nearFire) modifiers.push({ code: 'environment:fire-warmth', value: 1 });

  updateDerivedEffects(next.vitals, environment);
  const harmful = new Set(next.vitals.effects.map(effect => effect.id));
  let damagePerMinute = 0;
  if (harmful.has('bleeding')) damagePerMinute += 0.04;
  if (harmful.has('infected')) damagePerMinute += 0.015;
  if (harmful.has('dehydrated')) damagePerMinute += 0.05;
  if (harmful.has('starving')) damagePerMinute += 0.035;
  if (harmful.has('cold')) damagePerMinute += 0.025;
  if (harmful.has('overheated')) damagePerMinute += 0.025;
  if (damagePerMinute > 0) {
    const damage = damagePerMinute * gameMinutes;
    next.vitals.health = clamp(next.vitals.health - damage);
    modifiers.push({ code: 'health:condition-damage', value: round(-damage) });
  } else {
    const blockers = recoveryReasons(next, environment);
    const canRecover = blockers.length === 0 && ['idle', 'sleeping', 'sleep-until-morning'].includes(context?.activity || 'idle');
    if (canRecover) {
      const baseRate = .02;
      const bedBonus = ['sleeping', 'sleep-until-morning'].includes(context?.activity) ? environment.bedQuality * .03 : 0;
      const recovery = (baseRate + bedBonus) * gameMinutes;
      next.vitals.health = clamp(next.vitals.health + recovery);
      modifiers.push({ code: bedBonus > 0 ? 'recovery:bed' : 'recovery:nutrition', value: round(recovery) });
    }
  }

  next.recoveryBlockers = recoveryReasons(next, environment);

  const totalMinutes = next.time + gameMinutes;
  next.day += Math.floor(totalMinutes / GAME_MINUTES_PER_DAY);
  next.time = round(totalMinutes % GAME_MINUTES_PER_DAY);
  next.elapsedGameMinutes = round((next.elapsedGameMinutes || 0) + gameMinutes);
  next.phase = dayPhase(next.time);
  next.weather = weatherForV3(next.seed, next.day, next.time, environment.climate);
  next.lastModifiers = modifiers;
  return next;
}

function advance(state, elapsedMs, context = {}) {
  if (!state || state.schemaVersion !== 3) throw new TypeError('advance requires save schema v3');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError('elapsedMs must be non-negative');
  if (context.activity === 'sleep-until-morning') {
    const targetDay = state.time < 390 ? state.day : state.day + 1;
    const minutes = (targetDay - state.day) * GAME_MINUTES_PER_DAY + 390 - state.time;
    return simulateMinutes(state, minutes, context);
  }
  return simulateMinutes(state, elapsedMs * GAME_MINUTES_PER_REAL_MILLISECOND, context);
}

function applyAction(state, action) {
  if (!state || state.schemaVersion !== 3) throw new TypeError('action requires save schema v3');
  const next = structuredClone(state);
  switch (action?.type) {
    case 'consume-food':
      next.vitals.hunger = clamp(next.vitals.hunger + Number(action.nutrition || 0));
      next.vitals.hydration = clamp(
        next.vitals.hydration + Number(action.hydration || 0) - Number(action.salt || 0) * 0.2,
      );
      next.lastModifiers = [
        { code: `food:${action.itemId || 'unknown'}`, value: Number(action.nutrition || 0) },
        { code: 'food:salt-thirst', value: round(-Number(action.salt || 0) * 0.2) },
      ];
      break;
    case 'drink':
      next.vitals.hydration = clamp(next.vitals.hydration + Number(action.hydration || 0));
      next.lastModifiers = [{ code: `drink:${action.itemId || 'unknown'}`, value: Number(action.hydration || 0) }];
      break;
    case 'use-bandage':
      next.vitals.effects = next.vitals.effects.filter(effect => effect.id !== 'bleeding');
      next.lastModifiers = [{ code: `treatment:${action.itemId || 'bandage'}`, value: 1 }];
      break;
    case 'use-medicine':
      next.vitals.effects = next.vitals.effects.filter(effect => effect.id !== 'infected');
      next.lastModifiers = [{ code: `medicine:${action.itemId || 'medicine'}`, value: 1 }];
      break;
    case 'set-carried-mass':
      if (!Number.isFinite(action.mass) || action.mass < 0) throw new TypeError('mass must be non-negative');
      next.vitals.carriedMass = round(action.mass);
      next.lastModifiers = [{ code: 'load:carried-mass', value: round(action.mass) }];
      break;
    default:
      throw new TypeError(`unsupported survival action: ${action?.type || 'missing'}`);
  }
  return next;
}

function consumeItem(state, itemId) {
  if (!state || typeof state !== 'object') throw new TypeError('state must be an object');
  const item = itemById.get(itemId);
  const effect = item?.survivalEffect;
  if (!effect) return { ok: false, state, feedback: [], animationId: null, error: 'item-not-consumable' };
  if ((state.inventory?.[itemId] || 0) < 1) return { ok: false, state, feedback: [], animationId: null, error: 'item-not-owned' };

  const next = structuredClone(state);
  next.inventory ||= {};
  removeInventoryEntry(next.inventory, itemId, 1);
  const feedback = [];
  for (const stat of ['health', 'stamina', 'hunger', 'thirst']) {
    const before = Number(next[stat] ?? 0);
    const after = round(clamp(before + Number(effect[stat] || 0)));
    next[stat] = after;
    if (after !== before) feedback.push({ stat, delta: round(after - before), value: after });
  }
  return { ok: true, state: next, feedback, animationId: effect.animationId, error: null };
}

function advanceSurvival(state, elapsedSeconds, activity = 'idle', environment = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('state must be an object');
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new TypeError('elapsedSeconds must be non-negative');
  const gameMinutes = elapsedSeconds * GAME_MINUTES_PER_DAY / (REAL_MILLISECONDS_PER_GAME_DAY / 1000);
  const next = structuredClone(state);
  const hunger = Number(next.hunger ?? 100);
  const thirst = Number(next.thirst ?? 100);
  const canHeal = hunger > 65 && thirst > 65 && !next.bleeding && next.temperatureBand === 'safe';
  const canRecoverStamina = hunger > 30 && thirst > 30 && !next.overloaded;
  const recoveryActivities = new Set(['idle', 'rest', 'sleeping', 'sleep-until-morning']);
  const staminaRates = { idle: 0.12, rest: 0.18, sleeping: 0.3, 'sleep-until-morning': 0.3, walking: -0.08, mining: -0.18, running: -0.28, swimming: -0.38 };
  const staminaRate = staminaRates[activity] ?? 0;

  if (canHeal && recoveryActivities.has(activity)) next.health = round(clamp(Number(next.health ?? 0) + 0.02 * gameMinutes));
  if (staminaRate > 0) {
    if (canRecoverStamina) next.stamina = round(clamp(Number(next.stamina ?? 0) + staminaRate * gameMinutes));
  } else if (staminaRate < 0) {
    next.stamina = round(clamp(Number(next.stamina ?? 0) + staminaRate * gameMinutes));
  }
  next.hunger = round(clamp(hunger - 0.006 * gameMinutes));
  next.thirst = round(clamp(thirst - 0.009 * gameMinutes));

  const totalMinutes = Number(next.time ?? 0) + gameMinutes;
  next.day = Number(next.day ?? 1) + Math.floor(totalMinutes / GAME_MINUTES_PER_DAY);
  next.time = round(totalMinutes % GAME_MINUTES_PER_DAY);
  next.elapsedGameMinutes = round(Number(next.elapsedGameMinutes ?? 0) + gameMinutes);
  next.phase = dayPhase(next.time);
  next.weather = weatherForV3(next.seed || 'survival', next.day, next.time, environment.climate || {});
  return next;
}

module.exports = {
  GAME_MINUTES_PER_DAY,
  REAL_MILLISECONDS_PER_GAME_DAY,
  advance,
  advanceSurvival,
  applyAction,
  createSaveV3,
  dayPhase,
  beginSleep,
  craft,
  consumeItem,
  harvest,
  place,
  recoveryReasons,
  weatherForV3,
};
