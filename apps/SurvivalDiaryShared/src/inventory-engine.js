const items = require('../content/items.json');

const itemById = new Map(items.map((item) => [item.id, item]));
const EQUIPMENT_CAPACITY = Object.freeze({ 'small-backpack': 10, 'frame-backpack': 22 });

function inventoryCapacity(equipment = []) {
  if (!Array.isArray(equipment)) throw new TypeError('equipment must be an array');
  return 18 + [...new Set(equipment)].reduce((total, itemId) => total + (EQUIPMENT_CAPACITY[itemId] || 0), 0);
}

function splitStack(slots, slotId, quantity) {
  if (!Array.isArray(slots)) throw new TypeError('slots must be an array');
  if (!Number.isInteger(quantity) || quantity < 1) throw new TypeError('quantity must be positive');
  const next = structuredClone(slots);
  const index = next.findIndex((slot) => slot.id === slotId);
  if (index < 0 || next[index].quantity <= quantity) throw new RangeError('stack cannot be split');
  next[index].quantity -= quantity;
  next.splice(index + 1, 0, { id: `${slotId}-split-${quantity}`, itemId: next[index].itemId, quantity });
  return next;
}

function nextStackId(slots, itemId) {
  let index = 1;
  const ids = new Set(slots.map((slot) => slot.id));
  while (ids.has(`${itemId}-stack-${index}`)) index += 1;
  return `${itemId}-stack-${index}`;
}

function mergeStack(slots, incoming, capacity) {
  if (!Array.isArray(slots) || !incoming?.itemId || !Number.isInteger(incoming.quantity) || incoming.quantity < 0) throw new TypeError('valid stack is required');
  if (!Number.isInteger(capacity) || capacity < 0) throw new TypeError('capacity must be non-negative');
  const next = structuredClone(slots);
  const stackLimit = itemById.get(incoming.itemId)?.stackLimit || 1;
  let remainder = incoming.quantity;
  for (const slot of next) {
    if (slot.itemId !== incoming.itemId || slot.quantity >= stackLimit || remainder === 0) continue;
    const moved = Math.min(stackLimit - slot.quantity, remainder);
    slot.quantity += moved;
    remainder -= moved;
  }
  while (remainder > 0 && next.length < capacity) {
    const moved = Math.min(stackLimit, remainder);
    next.push({ id: nextStackId(next, incoming.itemId), itemId: incoming.itemId, quantity: moved });
    remainder -= moved;
  }
  Object.defineProperty(next, 'remainder', { value: remainder, enumerable: false });
  return next;
}

module.exports = { inventoryCapacity, mergeStack, splitStack };
