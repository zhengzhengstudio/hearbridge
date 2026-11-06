'use strict';

const RECIPES = Object.freeze({
  'generate-power': { machineType: 'steam-engine', durationMinutes: 60, fuel: { coal: 1 }, powerOutput: 360 },
  'crush-copper': { machineType: 'ore-crusher', durationMinutes: 60, input: { 'copper-ore': 2 }, power: 120, output: { 'copper-concentrate': 1 } },
});

function createMachine(id, type) { return { id, type, status: 'idle', recipeId: null, remainingMinutes: 0, input: {}, fuel: {}, output: {} }; }
function failure(state, error) { return { ok: false, state, error }; }
function prior(state, commandId) {
  if (!commandId || typeof commandId !== 'string') return failure(state, 'command-id-required');
  if (state?.processedWorldCommands?.[commandId]) return { ok: true, state, replayed: true };
  return null;
}
function clone(state) {
  return { ...state, inventory: { ...(state.inventory || {}) }, machines: Object.fromEntries(Object.entries(state.machines || {}).map(([id, machine]) => [id, { ...machine, input: { ...(machine.input || {}) }, fuel: { ...(machine.fuel || {}) }, output: { ...(machine.output || {}) } }])), processedWorldCommands: { ...(state.processedWorldCommands || {}) } };
}
function consume(container, items) {
  for (const [id, count] of Object.entries(items || {})) if (Number(container[id] || 0) < count) return false;
  for (const [id, count] of Object.entries(items || {})) container[id] -= count;
  return true;
}
function finish(state, commandId, details = {}) { state.processedWorldCommands[commandId] = true; return { ok: true, state, replayed: false, ...details }; }

function startMachine(state, machineId, recipeId, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const machine = state?.machines?.[machineId];
  const recipe = RECIPES[recipeId];
  if (!machine) return failure(state, 'machine-not-found');
  if (!recipe || recipe.machineType !== machine.type) return failure(state, 'recipe-unavailable');
  if (machine.status !== 'idle' || Object.values(machine.output || {}).some(Number)) return failure(state, 'machine-busy');
  const next = clone(state);
  if (!consume(next.inventory, recipe.fuel)) return failure(state, 'fuel-missing');
  if (!consume(next.inventory, recipe.input)) return failure(state, 'input-missing');
  if (Number(next.power || 0) < Number(recipe.power || 0)) return failure(state, 'power-missing');
  next.power = Number(next.power || 0) - Number(recipe.power || 0);
  Object.assign(next.machines[machineId], { status: 'working', recipeId, remainingMinutes: recipe.durationMinutes, input: { ...(recipe.input || {}) }, fuel: { ...(recipe.fuel || {}) } });
  return finish(next, commandId);
}

function advanceMachines(state, elapsedMinutes) {
  const next = clone(state);
  const elapsed = Math.max(0, Number(elapsedMinutes) || 0);
  for (const machine of Object.values(next.machines || {})) {
    if (machine.status !== 'working') continue;
    const recipe = RECIPES[machine.recipeId];
    if (!recipe) { machine.status = 'damaged'; continue; }
    const advanced = Math.min(Number(machine.remainingMinutes || 0), elapsed);
    machine.remainingMinutes = Math.max(0, Number(machine.remainingMinutes || 0) - advanced);
    if (recipe.powerOutput) next.power = Number(next.power || 0) + advanced * recipe.powerOutput / recipe.durationMinutes;
    if (machine.remainingMinutes > 0) continue;
    machine.output = { ...machine.output };
    for (const [id, count] of Object.entries(recipe.output || {})) machine.output[id] = Number(machine.output[id] || 0) + count;
    machine.status = Object.keys(machine.output).length ? 'ready' : 'idle';
    if (machine.status === 'idle') { machine.input = {}; machine.fuel = {}; }
    machine.recipeId = null;
  }
  return next;
}

function claimMachine(state, machineId, commandId) {
  const replay = prior(state, commandId); if (replay) return replay;
  const machine = state?.machines?.[machineId];
  if (!machine) return failure(state, 'machine-not-found');
  if (!Object.values(machine.output || {}).some(Number)) return failure(state, 'output-empty');
  const next = clone(state);
  for (const [id, count] of Object.entries(next.machines[machineId].output)) next.inventory[id] = Number(next.inventory[id] || 0) + count;
  next.machines[machineId].output = {};
  next.machines[machineId].input = {};
  next.machines[machineId].fuel = {};
  next.machines[machineId].status = 'idle';
  return finish(next, commandId);
}

module.exports = { RECIPES, createMachine, startMachine, advanceMachines, claimMachine };
