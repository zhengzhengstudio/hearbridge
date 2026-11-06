const { inventoryCapacity, mergeStack } = require('./inventory-engine.js');

const FLOATING_ITEMS = new Set(['driftwood', 'branch', 'bamboo', 'leaf', 'dry-grass', 'coconut', 'rowboat']);
const PERISHABLE_ITEMS = new Set(['berry', 'mushroom', 'herb', 'reef-fish', 'crab', 'clam', 'grilled-fish', 'crab-meal', 'fruit-bowl', 'mushroom-stew', 'clam-broth']);

function failed(state, error) { return { ok: false, state, error }; }
function hasCommand(state, commandId) { return (state.appliedCommands || []).includes(commandId); }

function dropStack(state, command) {
  if (!command?.commandId) return failed(state, 'command-id-required');
  const entityId = `drop:${command.commandId}`;
  if (hasCommand(state, command.commandId)) return { ok: true, state, droppedEntity: state.droppedEntities?.[entityId], replayed: true };
  if (!Number.isInteger(command.quantity) || command.quantity < 1) return failed(state, 'invalid-quantity');
  if (!Number.isFinite(command.point?.x) || !Number.isFinite(command.point?.y)) return failed(state, 'invalid-point');
  const slot = (state.inventorySlots || []).find((entry) => entry.id === command.slotId);
  if (!slot || slot.quantity < command.quantity) return failed(state, 'insufficient-stack');

  const next = structuredClone(state);
  const nextSlot = next.inventorySlots.find((entry) => entry.id === command.slotId);
  nextSlot.quantity -= command.quantity;
  if (nextSlot.quantity === 0) next.inventorySlots = next.inventorySlots.filter((entry) => entry.id !== command.slotId);
  const droppedEntity = {
    id: entityId, type: 'dropped-stack', itemId: slot.itemId, quantity: command.quantity,
    point: { x: command.point.x, y: command.point.y }, terrain: command.terrain || 'land',
    waterBehavior: FLOATING_ITEMS.has(slot.itemId) ? 'float' : 'sink',
    decayAtGameMinute: PERISHABLE_ITEMS.has(slot.itemId) ? Number(state.elapsedGameMinutes || 0) + 1440 : null,
    createdDay: Number(state.day || 1),
  };
  next.droppedEntities ||= {};
  next.droppedEntities[entityId] = droppedEntity;
  next.appliedCommands = [...(next.appliedCommands || []), command.commandId];
  return { ok: true, state: next, droppedEntity, replayed: false };
}

function pickupStack(state, command) {
  if (!command?.commandId) return failed(state, 'command-id-required');
  if (hasCommand(state, command.commandId)) return { ok: true, state, remainder: state.droppedEntities?.[command.entityId] || null, replayed: true };
  const entity = state.droppedEntities?.[command.entityId];
  if (!entity) return failed(state, 'drop-not-found');
  if (!Number.isInteger(command.quantity) || command.quantity < 1) return failed(state, 'invalid-quantity');
  const requested = Math.min(command.quantity, entity.quantity);
  const merged = mergeStack(state.inventorySlots || [], { itemId: entity.itemId, quantity: requested }, inventoryCapacity(state.equipment || []));
  const moved = requested - merged.remainder;
  if (moved <= 0) return failed(state, 'inventory-full');

  const next = structuredClone(state);
  next.inventorySlots = merged;
  const remaining = entity.quantity - moved;
  if (remaining > 0) next.droppedEntities[command.entityId].quantity = remaining;
  else delete next.droppedEntities[command.entityId];
  next.appliedCommands = [...(next.appliedCommands || []), command.commandId];
  return { ok: true, state: next, remainder: remaining > 0 ? next.droppedEntities[command.entityId] : null, replayed: false };
}

module.exports = { dropStack, pickupStack };
