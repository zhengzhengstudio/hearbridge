const onboardingCatalog = require('../content/onboarding.json');

const STEP_IDS = Object.freeze(onboardingCatalog.steps.map(step => step.id));
const FIRST_TOOL_IDS = Object.freeze(['stone-machete', 'stone-axe', 'stone-pickaxe', 'stone-knife']);
const STARTER_REQUIREMENTS = Object.freeze({ branch: 1, stone: 2, 'palm-fiber': 4 });

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function entitiesOf(save) {
  if (Array.isArray(save?.entities)) return save.entities;
  return Object.values(save?.entities || {});
}

function milestoneDone(save, id) {
  const value = save?.milestones?.[id];
  return value === true || value?.completed === true;
}

function hasModifier(save, prefix) {
  return (save?.lastModifiers || []).some(modifier => String(modifier?.code || '').startsWith(prefix));
}

function hasFact(save, predicate) {
  return (save?.journalEntries || []).some(entry => (entry?.facts || []).some(predicate));
}

function acquired(save, itemId, amount = 1) {
  const factCount = (save?.journalEntries || []).flatMap(entry => entry?.facts || [])
    .filter(fact => ['gathered', 'crafted', 'fished'].includes(fact?.type) && fact?.subject === itemId)
    .reduce((sum, fact) => sum + Math.max(1, Number(fact?.count) || 1), 0);
  return Number(save?.inventory?.[itemId] || 0) >= amount
    || milestoneDone(save, `collected:${itemId}`)
    || milestoneDone(save, `consumed:${itemId}`)
    || milestoneDone(save, `crafted:${itemId}`)
    || factCount >= amount;
}

function completionMap(save) {
  const inventory = save?.inventory || {};
  const entities = entitiesOf(save);
  return {
    wake_and_observe: milestoneDone(save, 'wake_and_observe') || milestoneDone(save, 'tutorial:moved'),
    meet_atuo: milestoneDone(save, 'meet_atuo') || milestoneDone(save, 'talked:castaway-builder')
      || hasFact(save, fact => fact?.type === 'talked' && ['castaway-builder', '阿拓'].includes(fact?.subject)),
    gather_starter_supplies: Object.entries(STARTER_REQUIREMENTS)
      .every(([itemId, amount]) => acquired(save, itemId, amount))
      || FIRST_TOOL_IDS.some(itemId => acquired(save, itemId))
      || milestoneDone(save, 'gather_starter_supplies'),
    craft_first_tool: FIRST_TOOL_IDS.some(itemId => acquired(save, itemId))
      || milestoneDone(save, 'craft_first_tool'),
    secure_water_and_food: (acquired(save, 'fresh-water') || acquired(save, 'coconut-water')
      || acquired(save, 'boiled-water') || hasModifier(save, 'drink:'))
      && (['coconut', 'berry', 'taro', 'millet'].some(itemId => acquired(save, itemId)) || hasModifier(save, 'food:')),
    harvest_first_fiber: acquired(save, 'palm-fiber', 5) || milestoneDone(save, 'harvest_first_fiber'),
    eat_and_recover: hasModifier(save, 'food:')
      || milestoneDone(save, 'consumed:any')
      || hasFact(save, fact => ['ate', 'food'].includes(fact?.type) || (fact?.type === 'used' && ['coconut', 'berry', 'taro', 'millet'].includes(fact?.subject)))
      || milestoneDone(save, 'eat_and_recover'),
    light_first_fire: entities.some(entity => entity?.type === 'campfire' && entity?.lit === true)
      || milestoneDone(save, 'light_first_fire'),
    place_first_shelter: entities.some(entity => ['shelter', 'straw-mat', 'hammock', 'simple-bed', 'camp-bed', 'wooden-bed'].includes(entity?.type))
      || milestoneDone(save, 'place_first_shelter'),
    rest_first_night: milestoneDone(save, 'slept:any')
      || hasModifier(save, 'activity:sleeping')
      || hasFact(save, fact => fact?.type === 'slept-until-dawn')
      || milestoneDone(save, 'rest_first_night'),
    discover_morning_signal: milestoneDone(save, 'discover_morning_signal')
      || milestoneDone(save, 'opening_complete')
      || hasFact(save, fact => ['discovered-smoke', 'followed-old-road'].includes(fact?.type)),
  };
}

function onboardingEnabled(save) {
  if (save?.onboarding?.enabled === false) return false;
  return save?.playMode !== 'free';
}

function deriveOnboardingProgress(save) {
  const completion = completionMap(save);
  const completedStepIds = STEP_IDS.filter(id => completion[id] === true);
  const currentStepId = STEP_IDS.find(id => completion[id] !== true) || null;
  return Object.freeze({
    completedStepIds: Object.freeze(completedStepIds),
    currentStepId,
    completed: currentStepId === null,
  });
}

function createOnboardingState(save) {
  const progress = deriveOnboardingProgress(save);
  return Object.freeze({
    enabled: onboardingEnabled(save),
    version: onboardingCatalog.version,
    completedStepIds: progress.completedStepIds,
    currentStepId: progress.currentStepId,
    completed: progress.completed,
  });
}

function nextOnboardingCue(save) {
  const state = createOnboardingState(save);
  if (!state.enabled) return null;
  if (state.completed) {
    return Object.freeze({
      ...clone(onboardingCatalog.completion),
      completion: true,
      blocking: false,
      presentation: 'world-guided',
    });
  }
  const step = onboardingCatalog.steps.find(candidate => candidate.id === state.currentStepId);
  return Object.freeze({
    ...clone(step),
    completion: false,
    blocking: false,
    presentation: 'world-guided',
  });
}

function setOnboardingEnabled(save, enabled) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) throw new TypeError('save object is required');
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  return {
    ...clone(save),
    onboarding: { enabled, version: 2 },
  };
}

module.exports = {
  STEP_IDS,
  createOnboardingState,
  deriveOnboardingProgress,
  nextOnboardingCue,
  setOnboardingEnabled,
};
