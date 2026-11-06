'use strict';

const PLOT_SLOTS = 9;
const WATER_CAPACITY = 12;
const MINUTES_PER_WATER = 60;
const CROPS = Object.freeze({
  'taro-seed': { cropId: 'taro', durationMinutes: 720, produce: 2, seeds: 1 },
  'millet-seed': { cropId: 'millet', durationMinutes: 960, produce: 3, seeds: 1 },
  'grain-seed': { cropId: 'millet', durationMinutes: 960, produce: 3, seeds: 1 },
  'herb-seed': { cropId: 'herb', durationMinutes: 480, produce: 2, seeds: 1 },
});

function createPlot(id) {
  return { id, state: 'prepared', water: 0, waterCapacity: WATER_CAPACITY, slots: Array(PLOT_SLOTS).fill(null) };
}

function failure(state, error) { return { ok: false, state, error }; }
function prior(state, commandId) {
  if (!commandId || typeof commandId !== 'string') return failure(state, 'command-id-required');
  if (state?.processedWorldCommands?.[commandId]) return { ok: true, state, replayed: true };
  return null;
}
function clone(state) {
  return {
    ...state,
    inventory: { ...(state.inventory || {}) },
    plots: Object.fromEntries(Object.entries(state.plots || {}).map(([id, plot]) => [id, {
      ...createPlot(id), ...plot, slots: [...(plot.slots || [])].concat(Array(PLOT_SLOTS).fill(null)).slice(0, PLOT_SLOTS).map(slot => slot ? { ...slot } : null),
    }])),
    processedWorldCommands: { ...(state.processedWorldCommands || {}) },
  };
}
function finish(state, commandId, details = {}) {
  state.processedWorldCommands[commandId] = true;
  return { ok: true, state, replayed: false, ...details };
}
function consume(inventory, itemId, amount) {
  if (Number(inventory[itemId] || 0) < amount) return false;
  inventory[itemId] -= amount;
  if (inventory[itemId] <= 0) delete inventory[itemId];
  return true;
}
function stageFor(progress, duration) {
  if (progress >= duration) return 'ripe';
  if (progress >= duration * .65) return 'growing';
  if (progress >= duration * .25) return 'sprout';
  return 'seeded';
}

function plantCrop(state, plotId, slotIndex, seedId, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const definition = CROPS[seedId];
  if (!definition) return failure(state, 'seed-unsupported');
  const plot = state?.plots?.[plotId];
  if (!plot) return failure(state, 'plot-not-found');
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= PLOT_SLOTS) return failure(state, 'slot-invalid');
  if (plot.slots?.[slotIndex]) return failure(state, 'slot-occupied');
  const next = clone(state);
  if (!consume(next.inventory, seedId, 1)) return failure(state, 'seed-missing');
  next.plots[plotId].slots[slotIndex] = { seedId, cropId: definition.cropId, durationMinutes: definition.durationMinutes, progressMinutes: 0, stage: 'seeded' };
  next.plots[plotId].state = next.plots[plotId].water > 0 ? 'watered' : 'planted';
  return finish(next, commandId, { slotIndex });
}

function waterPlot(state, plotId, amount, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const plot = state?.plots?.[plotId];
  if (!plot) return failure(state, 'plot-not-found');
  if (!plot.slots?.some(slot => slot && slot.stage !== 'ripe')) return failure(state, 'plot-empty');
  const units = Math.max(1, Math.min(WATER_CAPACITY, Math.floor(Number(amount) || WATER_CAPACITY)));
  const next = clone(state);
  const waterItemId = Number(next.inventory['fresh-water'] || 0) > 0 ? 'fresh-water' : 'water';
  if (!consume(next.inventory, waterItemId, 1)) return failure(state, 'water-missing');
  next.plots[plotId].water = Math.min(next.plots[plotId].waterCapacity || WATER_CAPACITY, Number(next.plots[plotId].water || 0) + units);
  next.plots[plotId].state = 'watered';
  return finish(next, commandId, { water: next.plots[plotId].water });
}

function advanceCrops(state, elapsedMinutes) {
  const next = clone(state);
  const elapsed = Math.max(0, Number(elapsedMinutes) || 0);
  for (const plot of Object.values(next.plots || {})) {
    const active = plot.slots.filter(slot => slot && slot.stage !== 'ripe');
    if (plot.water <= 0 || elapsed <= 0) continue;
    const wateredMinutes = Math.min(elapsed, plot.water * MINUTES_PER_WATER);
    for (const slot of active) {
      slot.progressMinutes = Math.min(slot.durationMinutes, Number(slot.progressMinutes || 0) + wateredMinutes);
      slot.stage = stageFor(slot.progressMinutes, slot.durationMinutes);
    }
    plot.water = Math.max(0, Number(plot.water || 0) - wateredMinutes / MINUTES_PER_WATER);
    plot.state = plot.slots.some(slot => slot?.stage === 'ripe') ? 'ripe' : plot.slots.some(Boolean) ? (plot.water > 0 ? 'watered' : 'dry') : (plot.water > 0 ? 'watered' : 'prepared');
  }
  return next;
}

function harvestCrop(state, plotId, slotIndex, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const slot = state?.plots?.[plotId]?.slots?.[slotIndex];
  if (!slot) return failure(state, 'crop-not-found');
  if (slot.stage !== 'ripe') return failure(state, 'crop-not-ripe');
  const definition = CROPS[slot.seedId];
  const next = clone(state);
  next.inventory[slot.cropId] = Number(next.inventory[slot.cropId] || 0) + (definition?.produce || 1);
  next.inventory[slot.seedId] = Number(next.inventory[slot.seedId] || 0) + (definition?.seeds || 1);
  next.plots[plotId].slots[slotIndex] = null;
  next.plots[plotId].state = next.plots[plotId].slots.some(Boolean) ? (next.plots[plotId].water > 0 ? 'watered' : 'dry') : 'prepared';
  return finish(next, commandId, { produce: { itemId: slot.cropId, amount: definition?.produce || 1 } });
}

module.exports = { CROPS, MINUTES_PER_WATER, PLOT_SLOTS, WATER_CAPACITY, createPlot, plantCrop, waterPlot, advanceCrops, harvestCrop };
