const { createSaveV3, dayPhase } = require('./survival-simulation.js');
const { migrateModularWorldSave } = require('./save-schema.js');

function migrateSave(input, targetSchemaVersion = 3) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('save object is required');
  }
  if (targetSchemaVersion === 5 && input.schemaVersion >= 3 && input.schemaVersion <= 5) {
    const next = structuredClone(input);
    next.schemaVersion = 5;
    next.inventorySlots ||= Object.entries(next.inventory || {}).flatMap(([itemId, quantity], itemIndex) => {
      const slots = [];
      let remaining = Math.max(0, Number(quantity) || 0);
      let stack = 1;
      while (remaining > 0) {
        const moved = Math.min(remaining, 50);
        slots.push({ id: `${itemId}-migrated-${itemIndex + 1}-${stack}`, itemId, quantity: moved });
        remaining -= moved;
        stack += 1;
      }
      return slots;
    });
    next.equipment ||= [];
    next.droppedEntities ||= {};
    next.appliedCommands ||= [];
    return migrateModularWorldSave(next);
  }
  if (input.schemaVersion === 3) {
    return { ...structuredClone(input), trackedRecipe: input.trackedRecipe || null };
  }
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    throw new TypeError(`unsupported save schema: ${input.schemaVersion}`);
  }
  if (typeof input.seed !== 'string' || input.seed.length === 0) {
    throw new TypeError('legacy save seed is required');
  }

  const next = createSaveV3(input.seed);
  next.playMode = input.playMode === 'free' ? 'free' : 'guided';
  next.day = Number.isInteger(input.day) && input.day > 0 ? input.day : 1;
  next.time = Number.isFinite(input.time) ? Math.max(0, Math.min(1439, input.time)) : 390;
  next.phase = dayPhase(next.time);
  next.weather = input.weather ? structuredClone(input.weather) : next.weather;
  next.inventory = structuredClone(input.inventory || {});
  next.entities = structuredClone(input.entities || {});
  next.players = structuredClone(input.players || {});
  next.journals = structuredClone(input.journals || {});
  if (typeof input.journal === 'string' && !next.journals.legacy) {
    next.journals.legacy = { text: input.journal };
  }
  next.milestones = structuredClone(input.milestones || {});
  next.trackedRecipe = null;
  next.discoveredChunks = {};
  for (const region of Object.values(input.regions || {})) {
    if (!Number.isInteger(region?.x) || !Number.isInteger(region?.y)) continue;
    next.discoveredChunks[`${region.x},${region.y}`] = {
      x: region.x,
      y: region.y,
      visibility: 'discovered',
    };
  }
  next.migrationBackup = JSON.stringify(input);
  return targetSchemaVersion === 5 ? migrateSave(next, 5) : next;
}

module.exports = { migrateSave };
