'use strict';

const BOAT_MIN_DEPTH = .45;
const BOAT_MAX_DEPTH = 4;
const LAND_MAX_DEPTH = .35;
const MIN_BRIDGE_SPAN = 2;
const MAX_BRIDGE_SPAN = 7;
const ADJACENT = Object.freeze([1, 2].flatMap(distance => [
  { x: -distance, y: 0 }, { x: distance, y: 0 }, { x: 0, y: -distance }, { x: 0, y: distance },
]));

function failed(state, error) { return { ok: false, state, error }; }

function replay(state, commandId) {
  return commandId && state?.processedWorldCommands?.[commandId]
    ? { ok: true, state, replayed: true }
    : null;
}

function validateCommand(state, commandId) {
  if (!commandId || typeof commandId !== 'string') return failed(state, 'command-id-required');
  return replay(state, commandId);
}

function entityIndex(state, id, type) {
  return (state?.entities || []).findIndex(entity => entity.id === id && (!type || entity.type === type));
}

function terrainAt(state, point) {
  const tile = state?.terrainAt?.(point.x, point.y) || point.terrain || {};
  const waterDepth = Number(tile.waterDepth ?? point.waterDepth ?? 0);
  return { ...tile, waterDepth, walkable: tile.walkable !== false && waterDepth <= LAND_MAX_DEPTH };
}

function cloneForCommand(state) {
  return {
    ...state,
    player: state.player ? { ...state.player } : {},
    entities: (state.entities || []).map(entity => ({
      ...entity,
      transport: entity.transport ? { ...entity.transport } : entity.transport,
      spanCells: entity.spanCells?.map(cell => ({ ...cell })),
    })),
    inventory: { ...(state.inventory || {}) },
    processedWorldCommands: { ...(state.processedWorldCommands || {}) },
  };
}

function finish(next, commandId, details = {}) {
  next.processedWorldCommands[commandId] = true;
  return { ok: true, state: next, replayed: false, ...details };
}

function distance(left, right) {
  return Math.hypot(Number(left?.x || 0) - Number(right?.x || 0), Number(left?.y || 0) - Number(right?.y || 0));
}

function boardBoat(state, boatId, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  const index = entityIndex(state, boatId, 'rowboat');
  if (index < 0) return failed(state, 'boat-not-found');
  const boat = state.entities[index];
  if (!state.player || state.player.mode === 'aboard') return failed(state, 'already-aboard');
  if (distance(state.player, boat) > Number(state.transportInteractionRange || 1.5)) return failed(state, 'boat-out-of-range');
  const depth = terrainAt(state, boat).waterDepth;
  if (depth < BOAT_MIN_DEPTH || depth > BOAT_MAX_DEPTH) return failed(state, 'boat-water-depth');

  const next = cloneForCommand(state);
  next.player = { ...next.player, x: boat.x, y: boat.y, mode: 'aboard', vehicleId: boat.id };
  next.entities[index] = { ...next.entities[index], state: 'aboard', occupantId: next.player.id || 'player' };
  return finish(next, commandId, { boat: next.entities[index] });
}

function leaveBoat(state, boatId, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  const index = entityIndex(state, boatId, 'rowboat');
  if (index < 0) return failed(state, 'boat-not-found');
  if (state.player?.mode !== 'aboard' || state.player.vehicleId !== boatId) return failed(state, 'not-aboard');
  const boat = state.entities[index];
  const bank = ADJACENT
    .map(offset => ({ x: Number(boat.x) + offset.x, y: Number(boat.y) + offset.y }))
    .find(point => {
      const tile = terrainAt(state, point);
      return tile.walkable && tile.waterDepth <= LAND_MAX_DEPTH;
    });
  if (!bank) return failed(state, 'no-adjacent-bank');

  const next = cloneForCommand(state);
  next.player = { ...next.player, x: bank.x, y: bank.y, mode: 'walking' };
  delete next.player.vehicleId;
  next.entities[index] = { ...next.entities[index], state: 'empty' };
  delete next.entities[index].occupantId;
  return finish(next, commandId, { boat: next.entities[index], landing: bank });
}

function isCardinalStep(left, right) {
  return Math.abs(Number(left.x) - Number(right.x)) + Math.abs(Number(left.y) - Number(right.y)) === 1;
}

function straightCardinalCells(cells) {
  if (!Array.isArray(cells) || cells.length < 2) return false;
  const horizontal = cells.every(cell => Number(cell.y) === Number(cells[0].y));
  const vertical = cells.every(cell => Number(cell.x) === Number(cells[0].x));
  return (horizontal || vertical) && cells.slice(1).every((cell, index) => isCardinalStep(cells[index], cell));
}

function consume(next, itemId) {
  if (Number(next.inventory[itemId] || 0) < 1) return false;
  next.inventory[itemId] -= 1;
  return true;
}

function placeBridge(state, span, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  const cells = span?.cells;
  if (!straightCardinalCells(cells)) return failed(state, 'bridge-not-straight');
  const interior = cells.slice(1, -1);
  if (interior.length < MIN_BRIDGE_SPAN || interior.length > MAX_BRIDGE_SPAN) return failed(state, 'bridge-span-length');
  const banks = [cells[0], cells[cells.length - 1]].map(point => terrainAt(state, point));
  if (banks.some(tile => !tile.walkable || tile.waterDepth > LAND_MAX_DEPTH)) return failed(state, 'bridge-bank-required');
  if (interior.some(point => {
    const tile = terrainAt(state, point);
    return tile.walkable && tile.waterDepth <= LAND_MAX_DEPTH;
  })) return failed(state, 'bridge-gap-required');
  if ((state.entities || []).some(entity => entity.type === 'rope-bridge'
    && entity.spanCells?.some(existing => cells.some(cell => cell.x === existing.x && cell.y === existing.y)))) {
    return failed(state, 'bridge-overlap');
  }

  const next = cloneForCommand(state);
  if (!consume(next, 'rope-bridge')) return failed(state, 'bridge-item-required');
  const start = cells[0]; const end = cells[cells.length - 1];
  const bridge = {
    id: `bridge:${commandId}`,
    type: 'rope-bridge',
    x: (Number(start.x) + Number(end.x)) / 2,
    y: (Number(start.y) + Number(end.y)) / 2,
    rotation: Number(start.y) === Number(end.y) ? 90 : 0,
    state: 'working',
    spanCells: cells.map(cell => ({ x: Number(cell.x), y: Number(cell.y) })),
    spanLength: interior.length,
  };
  next.entities.push(bridge);
  return finish(next, commandId, { bridge });
}

function placeRail(state, point, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return failed(state, 'rail-point-required');
  const cell = { x: Math.round(point.x), y: Math.round(point.y) };
  if (cell.x !== point.x || cell.y !== point.y) return failed(state, 'rail-grid-required');
  const rails = (state.entities || []).filter(entity => entity.type === 'rail-segment');
  if (rails.some(rail => rail.x === cell.x && rail.y === cell.y)) return failed(state, 'rail-overlap');
  if (rails.length && !rails.some(rail => isCardinalStep(rail, cell))) return failed(state, 'rail-not-cardinal');
  const tile = terrainAt(state, cell);
  if (!tile.walkable || tile.waterDepth > LAND_MAX_DEPTH) return failed(state, 'rail-terrain');

  const next = cloneForCommand(state);
  if (!consume(next, 'rail-segment')) return failed(state, 'rail-item-required');
  const rail = { id: `rail:${commandId}`, type: 'rail-segment', x: cell.x, y: cell.y, state: 'working' };
  next.entities.push(rail);
  return finish(next, commandId, { rail });
}

function moveMinecart(state, route, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  const cells = route?.cells;
  if (!Array.isArray(cells) || cells.length < 2) return failed(state, 'rail-route-required');
  if (!cells.slice(1).every((cell, index) => isCardinalStep(cells[index], cell))) return failed(state, 'rail-route-disconnected');
  const cartId = route.minecartId || state.activeMinecartId;
  const index = entityIndex(state, cartId, 'minecart');
  if (index < 0) return failed(state, 'minecart-not-found');
  const cart = state.entities[index];
  if (cart.x !== cells[0].x || cart.y !== cells[0].y) return failed(state, 'minecart-route-start');
  const railKeys = new Set((state.entities || []).filter(entity => entity.type === 'rail-segment').map(rail => `${rail.x},${rail.y}`));
  if (cells.some(cell => !railKeys.has(`${cell.x},${cell.y}`))) return failed(state, 'rail-route-missing');

  const next = cloneForCommand(state);
  const destination = cells[cells.length - 1];
  next.entities[index] = {
    ...next.entities[index],
    x: destination.x,
    y: destination.y,
    state: 'working',
    transport: { route: cells.map(cell => ({ x: cell.x, y: cell.y })), progress: 1 },
  };
  return finish(next, commandId, { minecart: next.entities[index] });
}

function rideMinecart(state, route, commandId) {
  const prior = validateCommand(state, commandId);
  if (prior) return prior;
  const cells = route?.cells;
  const cartId = route?.minecartId || state.activeMinecartId;
  const index = entityIndex(state, cartId, 'minecart');
  if (index < 0) return failed(state, 'minecart-not-found');
  const cart = state.entities[index];
  if (!state.player || distance(state.player, cart) > Number(state.transportInteractionRange || 1.5)) return failed(state, 'minecart-out-of-range');
  if (!Array.isArray(cells) || cells.length < 2) return failed(state, 'rail-route-required');
  if (!cells.slice(1).every((cell, cellIndex) => isCardinalStep(cells[cellIndex], cell))) return failed(state, 'rail-route-disconnected');
  if (cart.x !== cells[0].x || cart.y !== cells[0].y) return failed(state, 'minecart-route-start');
  const railKeys = new Set((state.entities || []).filter(entity => entity.type === 'rail-segment').map(rail => `${rail.x},${rail.y}`));
  if (cells.some(cell => !railKeys.has(`${cell.x},${cell.y}`))) return failed(state, 'rail-route-missing');
  const next = cloneForCommand(state);
  const destination = cells[cells.length - 1];
  next.entities[index] = { ...next.entities[index], ...destination, state: 'working', occupantId: next.player.id || 'player', transport: { route: cells.map(cell => ({ ...cell })), progress: 1 } };
  next.player = { ...next.player, ...destination, mode: 'walking' };
  delete next.entities[index].occupantId;
  return finish(next, commandId, { minecart: next.entities[index], passenger: next.player });
}

module.exports = {
  BOAT_MIN_DEPTH,
  BOAT_MAX_DEPTH,
  LAND_MAX_DEPTH,
  boardBoat,
  leaveBoat,
  placeBridge,
  placeRail,
  moveMinecart,
  rideMinecart,
};
