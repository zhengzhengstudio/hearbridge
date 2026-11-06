'use strict';

const ITEMS = Object.freeze(Object.fromEntries(require('../content/items.json').map(item => [item.id, item])));
const TICK_MINUTES = 10;
const HAUL_MASS_LIMIT = 4;
const REPAIR_PER_TICK = 20;
const ORDER_TYPES = Object.freeze(['haul', 'build', 'repair']);

function failure(state, error) { return { ok: false, state, error }; }
function prior(state, commandId) {
  if (!commandId || typeof commandId !== 'string') return failure(state, 'command-id-required');
  if (state?.processedWorldCommands?.[commandId]) return { ok: true, state, replayed: true };
  return null;
}
function clone(state) { return structuredClone(state || {}); }
function finish(state, commandId, details = {}) {
  state.processedWorldCommands = { ...(state.processedWorldCommands || {}), [commandId]: true };
  return { ok: true, state, replayed: false, ...details };
}
function containerItems(container) { return container?.items || container || {}; }
function entityFor(state, id) { return Array.isArray(state?.entities) ? state.entities.find(entity => entity.id === id) : state?.entities?.[id]; }

function recruitVillager(state, villagerId, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const villager = state?.villagers?.[villagerId];
  if (!villager) return failure(state, 'villager-not-found');
  if (villager.state === 'joined') return failure(state, 'already-joined');
  const camp = state?.camp || {};
  if (Number(camp.beds || 0) - Number(camp.occupiedBeds || 0) < 1) return failure(state, 'bed-required');
  if (Number(camp.storage?.foodPoints || 0) < 10) return failure(state, 'food-required');
  if (Number(camp.storage?.waterPoints || 0) < 10) return failure(state, 'water-required');
  const next = clone(state);
  next.villagers[villagerId].state = 'joined';
  next.villagers[villagerId].order = null;
  next.villagers[villagerId].tickRemainder = Number(next.villagers[villagerId].tickRemainder || 0);
  next.camp.occupiedBeds = Number(next.camp.occupiedBeds || 0) + 1;
  next.camp.storage.foodPoints -= 10;
  next.camp.storage.waterPoints -= 10;
  return finish(next, commandId, { villagerId });
}

function validateOrder(state, order) {
  if (!order || !ORDER_TYPES.includes(order.type)) return 'order-invalid';
  if (order.type === 'haul') {
    if (!state?.containers?.[order.sourceId] || !state?.containers?.[order.destinationId]) return 'container-not-found';
    if (!order.itemId) return 'item-required';
  }
  if (order.type === 'build' && !state?.projects?.[order.projectId]) return 'project-not-found';
  if (order.type === 'repair' && !entityFor(state, order.entityId)) return 'entity-not-found';
  return null;
}

function assignOrder(state, villagerId, order, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const villager = state?.villagers?.[villagerId];
  if (!villager) return failure(state, 'villager-not-found');
  if (villager.state !== 'joined') return failure(state, 'villager-not-joined');
  const error = validateOrder(state, order); if (error) return failure(state, error);
  const next = clone(state);
  next.villagers[villagerId].order = { ...order, status: 'assigned', materialConsumed: false };
  return finish(next, commandId, { villagerId, order: next.villagers[villagerId].order });
}

function workHaul(state, villager) {
  const order = villager.order;
  const source = state.containers?.[order.sourceId];
  const destination = state.containers?.[order.destinationId];
  if (!source || !destination) { order.status = 'blocked'; order.reason = 'container-not-found'; return; }
  const sourceItems = containerItems(source);
  const destinationItems = containerItems(destination);
  const mass = Math.max(.01, Number(ITEMS[order.itemId]?.mass || 1));
  const amount = Math.min(4, Number(sourceItems[order.itemId] || 0), Math.floor(HAUL_MASS_LIMIT / mass));
  if (amount <= 0) { order.status = 'blocked'; order.reason = 'item-missing'; return; }
  sourceItems[order.itemId] -= amount;
  destinationItems[order.itemId] = Number(destinationItems[order.itemId] || 0) + amount;
  order.status = 'complete'; order.moved = amount;
}

function workBuild(state, villager) {
  const order = villager.order;
  const project = state.projects?.[order.projectId];
  if (!project) { order.status = 'blocked'; order.reason = 'project-not-found'; return; }
  if (!order.materialConsumed) {
    if (!Object.values(project.reservedMaterials || {}).some(Number)) { order.status = 'blocked'; order.reason = 'materials-not-reserved'; return; }
    project.reservedMaterials = {};
    order.materialConsumed = true;
  }
  project.progressTicks = Number(project.progressTicks || 0) + 1;
  if (project.progressTicks >= Math.max(1, Number(project.requiredTicks || 1))) {
    project.status = 'complete'; order.status = 'complete';
    const entity = project.entityId ? entityFor(state, project.entityId) : null;
    if (entity) entity.state = { ...(entity.state || {}), constructionStatus: 'complete' };
  } else order.status = 'working';
}

function workRepair(state, villager) {
  const order = villager.order;
  const entity = entityFor(state, order.entityId);
  if (!entity) { order.status = 'blocked'; order.reason = 'entity-not-found'; return; }
  const maximum = Math.max(1, Number(entity.maxDurability || 100));
  entity.durability = Math.min(maximum, Number(entity.durability || 0) + REPAIR_PER_TICK);
  order.status = entity.durability >= maximum ? 'complete' : 'working';
}

function advanceVillagers(state, elapsedMinutes) {
  const next = clone(state);
  const elapsed = Math.max(0, Number(elapsedMinutes) || 0);
  for (const villager of Object.values(next.villagers || {}).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (villager.state !== 'joined') continue;
    const total = Number(villager.tickRemainder || 0) + elapsed;
    const ticks = Math.floor(total / TICK_MINUTES);
    villager.tickRemainder = total % TICK_MINUTES;
    for (let tick = 0; tick < ticks && villager.order && !['complete', 'blocked'].includes(villager.order.status); tick += 1) {
      if (villager.order.type === 'haul') workHaul(next, villager);
      else if (villager.order.type === 'build') workBuild(next, villager);
      else if (villager.order.type === 'repair') workRepair(next, villager);
    }
  }
  return next;
}

module.exports = { TICK_MINUTES, HAUL_MASS_LIMIT, REPAIR_PER_TICK, ORDER_TYPES, recruitVillager, assignOrder, advanceVillagers };
