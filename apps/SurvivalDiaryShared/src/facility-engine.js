const facilities = require('../content/facilities.json');
const recipes = require('../content/recipes.json');

const FACILITY_BY_ID = new Map(facilities.map(definition => [definition.id, definition]));
const RECIPE_BY_ID = new Map(recipes.map(recipe => [recipe.id, recipe]));

function cleanInventory(source) {
  const result = {};
  for (const [itemId, count] of Object.entries(source || {})) {
    if (Number.isFinite(count) && count > 0) result[itemId] = Math.floor(count);
  }
  return result;
}

function createFacilityState(entity) {
  const definition = FACILITY_BY_ID.get(entity.type);
  if (!definition) throw new TypeError(`unknown facility type: ${entity.type}`);
  return {
    id: entity.id,
    type: entity.type,
    position: structuredClone(entity.position || entity.coordinates || { x: 0, y: 0 }),
    durability: Number.isFinite(entity.durability) ? entity.durability : 100,
    maxDurability: Number.isFinite(entity.maxDurability) ? entity.maxDurability : 100,
    interactionRange: definition.interactionRange,
    slots: Object.fromEntries(Object.keys(definition.slots).map(slot => [slot, {}])),
    queue: null,
  };
}

function failure(state, reason) {
  return { ok: false, state, reason };
}

function distance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function definitionFor(facility) {
  return FACILITY_BY_ID.get(facility.type);
}

function slotHasRoom(facility, slotName, itemId) {
  const slot = facility.slots[slotName];
  const capacity = definitionFor(facility)?.slots?.[slotName] || 0;
  return Boolean(slot) && (Object.hasOwn(slot, itemId) || Object.keys(slot).length < capacity);
}

function addTo(container, itemId, amount) {
  const next = cleanInventory(container);
  const count = (next[itemId] || 0) + amount;
  if (count > 0) next[itemId] = count;
  else delete next[itemId];
  return next;
}

function transfer(state, facility, command) {
  const definition = definitionFor(facility);
  const slotName = command.slot;
  const slot = facility.slots[slotName];
  const amount = Math.floor(command.amount || 0);
  if (!slot || !definition?.slots?.[slotName]) return failure(state, 'invalid-slot');
  if (!command.itemId || amount <= 0) return failure(state, 'invalid-amount');

  if (command.direction === 'deposit') {
    if (slotName === 'output') return failure(state, 'invalid-slot');
    const available = state.inventory?.[command.itemId] || 0;
    if (available <= 0) return failure(state, 'item-missing');
    if (!slotHasRoom(facility, slotName, command.itemId)) {
      return failure(state, slotName === 'storage' ? 'storage-full' : `${slotName}-full`);
    }
    const moved = Math.min(amount, available);
    state.inventory = addTo(state.inventory, command.itemId, -moved);
    facility.slots[slotName] = addTo(slot, command.itemId, moved);
    return { ok: true, state, moved };
  }

  if (command.direction === 'withdraw') {
    const available = slot[command.itemId] || 0;
    if (available <= 0) return failure(state, 'item-missing');
    const moved = Math.min(amount, available);
    facility.slots[slotName] = addTo(slot, command.itemId, -moved);
    state.inventory = addTo(state.inventory, command.itemId, moved);
    return { ok: true, state, moved };
  }
  return failure(state, 'invalid-direction');
}

function startProcess(state, facility, command) {
  if (facility.queue) return failure(state, 'facility-busy');
  const recipe = RECIPE_BY_ID.get(command.recipeId);
  if (!recipe || recipe.station !== facility.type) return failure(state, 'recipe-unavailable');
  const input = facility.slots.input || {};
  for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
    if ((input[itemId] || 0) < amount) return failure(state, 'input-missing');
  }
  const fuel = facility.slots.fuel || {};
  if (recipe.fuel && (fuel[recipe.fuel.itemId] || 0) < recipe.fuel.amount) return failure(state, 'fuel-missing');

  for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
    facility.slots.input = addTo(facility.slots.input, itemId, -amount);
  }
  if (recipe.fuel) facility.slots.fuel = addTo(facility.slots.fuel, recipe.fuel.itemId, -recipe.fuel.amount);
  facility.queue = {
    recipeId: recipe.id,
    remainingMinutes: recipe.durationSeconds / 60,
    pauseReason: null,
  };
  return { ok: true, state };
}

function sleepEffects(context) {
  const vitals = context.vitals || {};
  const nourished = (vitals.hunger || 0) >= 65 && (vitals.hydration || 0) >= 65;
  return {
    staminaDelta: Math.max(0, 100 - (vitals.stamina || 0)),
    healthDelta: nourished ? Math.min(18, Math.max(0, 100 - (vitals.health || 0))) : 0,
  };
}

function slotsContainItems(facility) {
  return Object.values(facility.slots || {}).some(slot => Object.keys(cleanInventory(slot)).length > 0);
}

function executeFacilityCommand(source, command, context = {}) {
  const state = structuredClone(source);
  const facility = state.facilities?.[command.facilityId];
  if (!facility) return failure(state, 'facility-missing');
  const definition = definitionFor(facility);
  if (!definition) return failure(state, 'facility-unsupported');
  if (distance(context.playerPosition, facility.position) > definition.interactionRange) return failure(state, 'too-far');

  if (command.type === 'transfer') return transfer(state, facility, command);
  if (command.type === 'start') return startProcess(state, facility, command);
  if (command.type === 'sleep') {
    if (!definition.capabilities.includes('sleep')) return failure(state, 'unsupported-action');
    return { ok: true, state, effects: sleepEffects(context) };
  }
  if (command.type === 'shelter') {
    if (!definition.capabilities.includes('shelter')) return failure(state, 'unsupported-action');
    return { ok: true, state, effects: { sheltered: true, wetnessDelta: -18, temperatureDelta: 1.5 } };
  }
  if (command.type === 'repair') {
    if (!definition.capabilities.includes('repair')) return failure(state, 'unsupported-action');
    facility.durability = Math.min(facility.maxDurability, facility.durability + Math.max(0, command.amount || 0));
    return { ok: true, state };
  }
  if (command.type === 'dismantle') {
    if (slotsContainItems(facility) || facility.queue) return failure(state, 'facility-not-empty');
    delete state.facilities[facility.id];
    state.inventory = addTo(state.inventory, facility.type, 1);
    return { ok: true, state };
  }
  return failure(state, 'unsupported-action');
}

function advanceFacilities(source, elapsedMinutes) {
  const state = structuredClone(source);
  const elapsed = Math.max(0, Number(elapsedMinutes) || 0);
  for (const facility of Object.values(state.facilities || {})) {
    if (!facility.queue) continue;
    const recipe = RECIPE_BY_ID.get(facility.queue.recipeId);
    if (!recipe) {
      facility.queue.pauseReason = 'recipe-unavailable';
      continue;
    }
    facility.queue.remainingMinutes = Math.max(0, facility.queue.remainingMinutes - elapsed);
    if (facility.queue.remainingMinutes > 0) {
      facility.queue.pauseReason = null;
      continue;
    }
    if (!slotHasRoom(facility, 'output', recipe.output.itemId)) {
      facility.queue.pauseReason = 'output-full';
      continue;
    }
    facility.slots.output = addTo(facility.slots.output, recipe.output.itemId, recipe.output.amount);
    facility.queue = null;
  }
  return state;
}

module.exports = {
  advanceFacilities,
  createFacilityState,
  executeFacilityCommand,
};
