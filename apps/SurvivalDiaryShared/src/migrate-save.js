const { createRegion, createWorld } = require('./reference-simulation.js');

function migrateSaveV2(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('save must be an object');
  const migrated = structuredClone(raw);
  const defaults = createWorld(typeof migrated.seed === 'string' && migrated.seed.length > 0 ? migrated.seed : 'migrated-save');

  if (migrated.journals === undefined && typeof migrated.journal === 'string') {
    migrated.journals = { legacy: { text: migrated.journal } };
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (migrated[key] === undefined) migrated[key] = value;
  }
  if (migrated.regions && typeof migrated.regions === 'object' && !Array.isArray(migrated.regions)) {
    for (const region of Object.values(migrated.regions)) {
      if (region && region.temperature === undefined && Number.isInteger(region.x) && Number.isInteger(region.y)) {
        region.temperature = createRegion(migrated.seed, region).temperature;
      }
    }
  }
  migrated.schemaVersion = 2;
  return migrated;
}

function migrateWildlifeSave(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) {
    throw new TypeError('save-object-required');
  }
  if (typeof save.schemaVersion === 'number' && save.schemaVersion > 4) {
    throw new TypeError('future-version');
  }
  if (save.schemaVersion !== 3 && save.schemaVersion !== 4) {
    throw new TypeError('unsupported-version');
  }
  const source = structuredClone(save);
  return {
    ...source,
    schemaVersion: 4,
    animals: source.animals || {},
    populations: source.populations || {},
    nests: source.nests || {},
    traps: source.traps || {},
    domestication: source.domestication || {},
    wildlifeTraces: source.wildlifeTraces || {},
    processedEventIds: Array.isArray(source.processedEventIds)
      ? [...new Set(source.processedEventIds)]
      : [],
  };
}

module.exports = { migrateSaveV2, migrateWildlifeSave };
