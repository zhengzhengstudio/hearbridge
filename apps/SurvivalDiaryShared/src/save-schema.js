const MODULAR_WORLD_SCHEMA_VERSION = 5;
const STABLE_PRODUCT_VERSION = '0.5.0';
const MAP_FIELDS = Object.freeze([
  'groundItems',
  'plots',
  'machines',
  'rails',
  'boats',
  'villagers',
  'processedWorldCommands',
]);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function assertSave(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('save object is required');
  }
}

function withModularWorldDefaults(input) {
  assertSave(input);
  const next = clone(input);
  for (const field of MAP_FIELDS) {
    if (!next[field] || typeof next[field] !== 'object' || Array.isArray(next[field])) next[field] = {};
  }
  return next;
}

function migrateModularWorldSave(input) {
  const next = withModularWorldDefaults(input);
  next.schemaVersion = MODULAR_WORLD_SCHEMA_VERSION;
  next.productVersion = STABLE_PRODUCT_VERSION;
  return next;
}

module.exports = Object.freeze({
  MAP_FIELDS,
  MODULAR_WORLD_SCHEMA_VERSION,
  STABLE_PRODUCT_VERSION,
  migrateModularWorldSave,
  withModularWorldDefaults,
});
