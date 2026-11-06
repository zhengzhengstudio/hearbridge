function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function trackRecipe(save, recipeId, quantity = 1) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) throw new TypeError('save object is required');
  if (typeof recipeId !== 'string' || recipeId.length === 0) throw new TypeError('recipeId is required');
  if (!Number.isInteger(quantity) || quantity < 1) throw new TypeError('quantity must be positive');
  return {
    ...clone(save),
    trackedRecipe: { recipeId, quantity, version: 1 },
  };
}

function clearTrackedRecipe(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) throw new TypeError('save object is required');
  return { ...clone(save), trackedRecipe: null };
}

function normalizeGoal(goal) {
  if (!goal || !['recipe', 'building'].includes(goal.kind)) throw new TypeError('goal kind is required');
  if (typeof goal.targetId !== 'string' || goal.targetId.length === 0) throw new TypeError('goal targetId is required');
  return {
    id: goal.id || `${goal.kind}:${goal.targetId}`,
    kind: goal.kind,
    targetId: goal.targetId,
    pinnedAt: Number.isFinite(goal.pinnedAt) ? goal.pinnedAt : Date.now(),
  };
}

function toggleTrackedGoal(source, requested, max = 3) {
  const goals = Array.isArray(source) ? source.map(normalizeGoal) : [];
  const goal = normalizeGoal(requested);
  if (goals.some(item => item.id === goal.id)) {
    return { ok: true, goals: goals.filter(item => item.id !== goal.id) };
  }
  if (goals.length >= max) return { ok: false, goals, reason: 'tracking-full' };
  return { ok: true, goals: [...goals, goal] };
}

function reorderTrackedGoals(source, orderedIds) {
  const goals = Array.isArray(source) ? source.map(normalizeGoal) : [];
  if (!Array.isArray(orderedIds) || orderedIds.length !== goals.length) throw new TypeError('all tracked goal ids are required');
  const byId = new Map(goals.map(goal => [goal.id, goal]));
  const ordered = orderedIds.map(id => byId.get(id));
  if (ordered.some(goal => !goal) || new Set(orderedIds).size !== goals.length) throw new TypeError('tracked goal ids must be unique');
  return ordered;
}

function recipeIdForGoal(goal, recipes) {
  if (goal.kind === 'recipe') return goal.targetId;
  return recipes.find(recipe => recipe.output?.itemId === goal.targetId)?.id || '';
}

function biomeHintForItem(itemId, catalogs) {
  const resourceIds = new Set((catalogs.resources || []).filter(resource => resource.itemId === itemId).map(resource => resource.id));
  return (catalogs.biomes || []).find(biome => (
    (biome.spawnTable || []).some(rule => resourceIds.has(rule.resourceId))
  ))?.name || '继续探索';
}

function summarizeTrackedGoals(source, inventory, catalogs) {
  const goals = Array.isArray(source) ? source.slice(0, 3).map(normalizeGoal) : [];
  const recipes = Array.isArray(catalogs?.recipes) ? catalogs.recipes : [];
  return goals.map(goal => {
    const recipeId = recipeIdForGoal(goal, recipes);
    const plan = resolveRecipePlan({
      trackedRecipe: { recipeId, quantity: 1, version: 1 },
      inventory: cleanCounts(inventory),
    }, catalogs);
    const step = plan.steps[0];
    let next = { kind: 'complete', itemId: '', required: 0, available: 0 };
    if (plan.blockedReason) next = { kind: 'blocked', itemId: '', required: 0, available: 0, reason: plan.blockedReason };
    else if (step?.kind === 'gather') next = { ...step, biomeHint: biomeHintForItem(step.itemId, catalogs) };
    else if (step) next = clone(step);
    return { ...goal, recipeId, progress: clone(plan.progress), next };
  });
}

function cleanCounts(source) {
  return Object.fromEntries(Object.entries(source || {}).filter(([, count]) => Number.isFinite(count) && count > 0));
}

function hasStation(save, stationId) {
  if (stationId === 'hand') return true;
  if ((save?.nearbyStations || []).includes(stationId)) return true;
  const entities = Array.isArray(save?.entities) ? save.entities : Object.values(save?.entities || {});
  return entities.some(entity => entity?.type === stationId);
}

function resolveRecipePlan(save, catalogs) {
  const tracked = save?.trackedRecipe;
  if (!tracked) return {
    recipeId: '', quantity: 0, steps: [], blockedReason: 'not-tracking', progress: { completed: 0, required: 0 },
  };
  const recipes = Array.isArray(catalogs?.recipes) ? catalogs.recipes : [];
  const resources = Array.isArray(catalogs?.resources) ? catalogs.resources : [];
  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const recipeByOutput = new Map();
  for (const recipe of recipes) {
    if (!recipeByOutput.has(recipe.output?.itemId)) recipeByOutput.set(recipe.output.itemId, recipe);
  }
  const resourceItems = new Set(resources.map(resource => resource.itemId));
  const rootRecipe = recipeById.get(tracked.recipeId);
  if (!rootRecipe) return {
    recipeId: tracked.recipeId,
    quantity: tracked.quantity,
    steps: [],
    blockedReason: 'recipe-not-found',
    progress: { completed: 0, required: 0 },
  };

  const inventory = { ...(save.inventory || {}) };
  const steps = [];
  const progress = { completed: 0, required: 0 };
  let blockedReason = '';

  function requireItem(itemId, amount, path) {
    if (blockedReason) return;
    progress.required += amount;
    const available = Math.min(amount, Math.max(0, Number(inventory[itemId] || 0)));
    inventory[itemId] = Math.max(0, Number(inventory[itemId] || 0) - available);
    progress.completed += available;
    const missing = amount - available;
    if (missing === 0) return;

    const recipe = recipeByOutput.get(itemId);
    if (!recipe) {
      if (!resourceItems.has(itemId)) {
        blockedReason = 'item-source-unknown';
        return;
      }
      steps.push({ kind: 'gather', itemId, required: missing, available });
      return;
    }
    if (path.has(itemId)) {
      blockedReason = 'recipe-cycle';
      return;
    }
    const nextPath = new Set(path);
    nextPath.add(itemId);
    const outputAmount = Math.max(1, Number(recipe.output?.amount || 1));
    const batches = Math.ceil(missing / outputAmount);
    for (const [ingredientId, ingredientAmount] of Object.entries(recipe.ingredients || {})) {
      requireItem(ingredientId, Number(ingredientAmount) * batches, nextPath);
    }
    if (blockedReason) return;
    if (!hasStation(save, recipe.station)) {
      steps.push({ kind: 'station', itemId, stationId: recipe.station, required: 1, available: 0 });
    }
    steps.push({
      kind: 'craft',
      itemId,
      recipeId: recipe.id,
      required: missing,
      available,
      batches,
    });
  }

  const rootPath = new Set([rootRecipe.output.itemId]);
  for (const [ingredientId, ingredientAmount] of Object.entries(rootRecipe.ingredients || {})) {
    requireItem(ingredientId, Number(ingredientAmount) * tracked.quantity, rootPath);
  }
  if (!blockedReason) {
    if (!hasStation(save, rootRecipe.station)) {
      steps.push({
        kind: 'station',
        itemId: rootRecipe.output.itemId,
        stationId: rootRecipe.station,
        required: 1,
        available: 0,
      });
    }
    steps.push({
      kind: 'craft',
      itemId: rootRecipe.output.itemId,
      recipeId: rootRecipe.id,
      required: tracked.quantity * Math.max(1, Number(rootRecipe.output?.amount || 1)),
      available: 0,
      batches: tracked.quantity,
    });
  }

  return {
    recipeId: tracked.recipeId,
    quantity: tracked.quantity,
    steps,
    blockedReason,
    progress,
  };
}

function playerPosition(save) {
  return save?.players?.local?.position || save?.player?.position || save?.player || { x: 0, y: 0 };
}

function nextTrackedAction(save, world, catalogs) {
  const plan = resolveRecipePlan(save, catalogs);
  if (plan.blockedReason) return { kind: 'blocked', itemId: '', amount: 0, reason: plan.blockedReason };
  const step = plan.steps[0];
  if (!step) return { kind: 'complete', itemId: '', amount: 0, reason: '' };
  if (step.kind === 'station') {
    return { kind: 'station', itemId: step.itemId, amount: 1, stationId: step.stationId, reason: 'station-required' };
  }
  if (step.kind === 'craft') {
    return { kind: 'craft', itemId: step.itemId, amount: step.required, recipeId: step.recipeId, reason: '' };
  }

  const origin = playerPosition(save);
  const candidates = Object.values(world?.resourceNodes || {})
    .filter(node => (
      node?.itemId === step.itemId
      && node.reachable !== false
      && node.state !== 'depleted'
      && Number(node.remaining || 0) > 0
    ))
    .sort((left, right) => (
      Math.hypot(left.position.x - origin.x, left.position.y - origin.y)
      - Math.hypot(right.position.x - origin.x, right.position.y - origin.y)
    ));
  const node = candidates[0];
  if (!node) {
    return { kind: 'blocked', itemId: step.itemId, amount: step.required, reason: 'resource-not-discovered' };
  }
  return {
    kind: 'gather',
    itemId: step.itemId,
    amount: step.required,
    nodeId: node.id,
    position: clone(node.position),
    reason: '',
  };
}

module.exports = {
  clearTrackedRecipe,
  nextTrackedAction,
  reorderTrackedGoals,
  resolveRecipePlan,
  summarizeTrackedGoals,
  toggleTrackedGoal,
  trackRecipe,
};
