const { stableDigest } = require('./hash.js');

function invalidPayload() {
  throw new TypeError('json-compatible-payload-required');
}

function cloneJsonPayload(value, ancestors = new Set()) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidPayload();
    return value;
  }
  if (typeof value !== 'object') invalidPayload();
  if (ancestors.has(value)) invalidPayload();

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) invalidPayload();
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index)) invalidPayload();
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable) invalidPayload();
        return cloneJsonPayload(value[index], ancestors);
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidPayload();
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) invalidPayload();
    return Object.fromEntries(keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) invalidPayload();
      return [key, cloneJsonPayload(value[key], ancestors)];
    }));
  } finally {
    ancestors.delete(value);
  }
}

function createWildlifeEvent(type, subjectId, gameMinute, payload) {
  if (typeof type !== 'string' || type.length === 0) {
    throw new TypeError('event-type-required');
  }
  if (typeof subjectId !== 'string' || subjectId.length === 0) {
    throw new TypeError('subject-id-required');
  }
  if (!Number.isFinite(gameMinute)) {
    throw new TypeError('finite-game-minute-required');
  }
  const eventPayload = cloneJsonPayload(payload);
  const id = stableDigest({
    type,
    subjectId,
    gameMinute,
    payload: eventPayload,
  });
  return {
    id,
    type,
    subjectId,
    gameMinute,
    payload: eventPayload,
  };
}

module.exports = { createWildlifeEvent };
