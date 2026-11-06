# Survival Diary Gameplay and Web Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one polished, playable Web vertical slice backed by shared survival rules: explore, target, harvest, pick up, craft, place, use, save, reload, and continue.

**Architecture:** Keep content and deterministic rules in `apps/SurvivalDiaryShared`; add a single action/event facade that Web calls instead of mutating inventory directly. Rebuild the Web presentation as world renderer + normalized input + restrained HUD + full-screen game pages, with quality profiles affecting rendering only.

**Tech Stack:** CommonJS Node.js rules and fixtures, browser JavaScript, HTML/CSS, Canvas/DOM world renderer, Node test runner.

## Global Constraints

- Main camera is a smooth zoomable 2.5D oblique view over a continuous island.
- The game has no fixed ending.
- Rendering profiles are `auto`, `performance`, `balanced`, and `quality`; profiles never remove gameplay content.
- Web and download center call the low-spec entry “兼容模式”.
- Existing saves must migrate or fall back to the previous valid save; they must never silently start over.
- Every website change in this plan updates `website/api/data/changelogs.json`.
- Every completed visual stage produces a real runtime screenshot under `docs/survival-diary/screenshots/` and records it in `docs/survival-diary/IMPLEMENTATION_LOG.md`.

---

### Task 1: Shared Action and Event Facade

**Files:**
- Create: `apps/SurvivalDiaryShared/src/game-actions.js`
- Modify: `apps/SurvivalDiaryShared/src/survival-simulation.js`
- Test: `tests/survival_diary_game_actions.test.js`

**Interfaces:**
- Consumes: existing `harvest`, `craft`, `placeBuilding`, `advanceSimulation` exports.
- Produces: `resolveContextAction(state, request)` and `performGameAction(state, action)`, returning `{ ok, state, error, details, events }`.

- [ ] **Step 1: Write failing action-chain tests**

```js
const { resolveContextAction, performGameAction } = require('../apps/SurvivalDiaryShared/src/game-actions');
test('nearby reeds resolve to gather and emit hit/drop/pickup events', () => {
  const resolved = resolveContextAction(fixture, { playerId: 'local', targetId: 'reeds@1,1', equippedItemId: 'machete' });
  assert.equal(resolved.kind, 'harvest');
  const result = performGameAction(fixture, { ...resolved, elapsedMs: 750 });
  assert.deepEqual(result.events.map(event => event.type), ['action-started', 'resource-hit', 'world-drop-created']);
});
```

- [ ] **Step 2: Verify the tests fail because the facade is absent**

Run: `node --test tests/survival_diary_game_actions.test.js`  
Expected: FAIL with module-not-found or missing export.

- [ ] **Step 3: Implement the normalized action result**

```js
function result(base, events = []) {
  return { ...base, events };
}
function performGameAction(state, action) {
  if (action.kind === 'harvest') return harvestAction(state, action);
  if (action.kind === 'pickup') return pickupAction(state, action);
  if (action.kind === 'consume') return consumeAction(state, action);
  if (action.kind === 'use-building') return useBuildingAction(state, action);
  return result({ ok: false, state, error: 'unsupported-action', details: {} });
}
```

- [ ] **Step 4: Make harvest create a world drop before pickup**

```js
next.worldDrops[dropId] = { id: dropId, itemId: node.itemId, amount: 1, position: node.position };
return result(success(next, { nodeId, dropId }), [
  { type: 'action-started', action: 'harvest', targetId: nodeId },
  { type: 'resource-hit', targetId: nodeId },
  { type: 'world-drop-created', dropId },
]);
```

- [ ] **Step 5: Run shared gameplay tests**

Run: `node --test tests/survival_diary_game_actions.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_resource_progression.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit the action facade**

```bash
git add apps/SurvivalDiaryShared/src/game-actions.js apps/SurvivalDiaryShared/src/survival-simulation.js tests/survival_diary_game_actions.test.js
git commit -m "feat(survival-diary): add world action event pipeline"
```

### Task 2: Discovery, Recipe, Task, and Building Semantics

**Files:**
- Modify: `apps/SurvivalDiaryShared/content/items.json`
- Modify: `apps/SurvivalDiaryShared/content/recipes.json`
- Modify: `apps/SurvivalDiaryShared/content/buildings.json`
- Modify: `apps/SurvivalDiaryShared/content/milestones.json`
- Modify: `apps/SurvivalDiaryShared/schemas/save.schema.json`
- Modify: `apps/SurvivalDiaryShared/src/game-actions.js`
- Test: `tests/survival_diary_resource_progression.test.js`
- Test: `tests/survival_diary_gameplay.test.js`

**Interfaces:**
- Consumes: `performGameAction` events from Task 1.
- Produces: `discoveries`, `unlockedRecipeIds`, `worldDrops`, `containers`, and event-driven milestone progress in save schema version 4.

- [ ] **Step 1: Add failing progression cases**

```js
test('rope stays hidden until fiber is discovered', () => {
  assert.equal(visibleRecipes(createSaveV4()).includes('rope'), false);
  const next = applyEvent(createSaveV4(), { type: 'item-discovered', itemId: 'palm-fiber' });
  assert.equal(visibleRecipes(next).includes('rope'), true);
});
test('fresh-water milestone completes from discovery or drinking event', () => {
  assert.equal(applyEvent(save, { type: 'water-source-discovered', sourceId: 'spring@2,2' }).milestones['find-water'].complete, true);
});
```

- [ ] **Step 2: Verify hidden recipes and water milestone tests fail**

Run: `node --test tests/survival_diary_resource_progression.test.js`  
Expected: FAIL because discovery-driven visibility is missing.

- [ ] **Step 3: Extend save schema and migration**

```js
save.discoveries = save.discoveries || { items: {}, biomes: {}, landmarks: {} };
save.unlockedRecipeIds = save.unlockedRecipeIds || ['stone-axe'];
save.worldDrops = save.worldDrops || {};
save.containers = save.containers || {};
save.schemaVersion = 4;
```

- [ ] **Step 4: Define distinct tools and usable buildings**

```json
{
  "id": "storage-crate",
  "interaction": { "kind": "container", "capacity": 24 },
  "requiresFoundation": false
}
```

Ensure axe, pickaxe, shovel, knife/machete, bed, shelter, campfire, water collector, workbench and storage crate each have separate interaction tags and recipe requirements.

- [ ] **Step 5: Drive milestones only from action events**

```js
const milestoneEventMap = {
  'find-water': new Set(['water-source-discovered', 'fresh-water-collected', 'fresh-water-consumed']),
  'craft-rope': new Set(['item-crafted:rope']),
  'place-bed': new Set(['building-placed:wooden-bed', 'building-placed:simple-bed']),
};
```

- [ ] **Step 6: Run content, migration, and gameplay suites**

Run: `node --test tests/survival_diary_contracts.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_resource_progression.test.js tests/survival_diary_world_v3.test.js`  
Expected: PASS with schema version 4 fixtures.

- [ ] **Step 7: Commit progression semantics**

```bash
git add apps/SurvivalDiaryShared tests/survival_diary_resource_progression.test.js tests/survival_diary_gameplay.test.js
git commit -m "feat(survival-diary): make discovery drive progression"
```

### Task 3: Continuous World and Context Targeting

**Files:**
- Modify: `apps/SurvivalDiaryShared/src/world-generator.js`
- Modify: `apps/SurvivalDiaryShared/content/biomes.json`
- Modify: `apps/SurvivalDiaryShared/content/resources.json`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Test: `tests/survival_diary_world_v3.test.js`
- Test: `tests/survival_diary_web.test.js`

**Interfaces:**
- Consumes: schema v4 resource nodes.
- Produces: `terrainAt(x, y)`, `isWalkable(x, y)`, `visibleEntities(viewport)`, and `nearestActionTarget(player, pointer, radius)`.

- [ ] **Step 1: Add failing terrain continuity and shoreline tests**

```js
test('adjacent chunks share every edge sample', () => assert.deepEqual(left.edges.east, right.edges.west));
test('lagoon water rejects walking while wet sand remains walkable', () => {
  assert.equal(isWalkable({ biome: 'lagoon', height: 0.18 }), false);
  assert.equal(isWalkable({ biome: 'palm-grove', height: 0.31 }), true);
});
```

- [ ] **Step 2: Run world tests and record the failing cases**

Run: `node --test tests/survival_diary_world_v3.test.js tests/survival_diary_web.test.js`  
Expected: FAIL on the new walkability/target contract.

- [ ] **Step 3: Implement terrain and target helpers**

```js
function nearestActionTarget(player, pointer, radius = 2.5) {
  return visibleEntities(cameraViewport())
    .filter(entity => distance(entity.position, player.position) <= radius)
    .sort((a, b) => targetScore(a, pointer) - targetScore(b, pointer))[0] || null;
}
```

- [ ] **Step 4: Render one depth-sorted queue**

```js
const queue = [...terrainDetails, ...resources, ...buildings, ...drops, player]
  .filter(entity => intersectsViewport(entity.bounds, viewport))
  .sort((a, b) => (a.footY - b.footY) || (a.layer - b.layer));
```

- [ ] **Step 5: Run world and browser contract tests**

Run: `node --test tests/survival_diary_world_v3.test.js tests/survival_diary_web.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit continuous-world targeting**

```bash
git add apps/SurvivalDiaryShared/src/world-generator.js apps/SurvivalDiaryShared/content website/survival-diary.zhengzhengstudio.cn/js/world.js tests/survival_diary_world_v3.test.js tests/survival_diary_web.test.js
git commit -m "feat(survival-diary): unify terrain and context targeting"
```

### Task 4: Web Input and Camera Runtime

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/input.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Test: `tests/survival_diary_web.test.js`

**Interfaces:**
- Consumes: `nearestActionTarget`, camera bounds, and normalized action facade.
- Produces: `InputController` events `move`, `camera-pan`, `camera-zoom`, `primary-action`, `secondary-action`, `hotbar-select`.

- [ ] **Step 1: Add failing desktop/touch input contracts**

```js
assert.match(inputSource, /pointercancel/);
assert.match(inputSource, /visibilitychange/);
assert.match(inputSource, /gestureState\.pointers\.size === 2/);
assert.match(inputSource, /camera-pan/);
```

- [ ] **Step 2: Verify the input module test fails**

Run: `node --test tests/survival_diary_web.test.js`  
Expected: FAIL because `js/input.js` is not loaded.

- [ ] **Step 3: Implement normalized input dispatch**

```js
dispatch({ type: 'move', vector: keyboardVector() });
dispatch({ type: 'camera-pan', dx, dy });
dispatch({ type: 'camera-zoom', scale: pinchDistance / pinchStartDistance });
```

- [ ] **Step 4: Clear held input on every lifecycle exit**

```js
['blur', 'pagehide'].forEach(type => window.addEventListener(type, resetInput));
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
```

- [ ] **Step 5: Run Web input tests**

Run: `node --test tests/survival_diary_web.test.js`  
Expected: PASS for keyboard, pointer cancel, pinch, pan, and focus loss.

- [ ] **Step 6: Commit the input runtime**

```bash
git add website/survival-diary.zhengzhengstudio.cn/js/input.js website/survival-diary.zhengzhengstudio.cn/js/game.js website/survival-diary.zhengzhengstudio.cn/index.html tests/survival_diary_web.test.js
git commit -m "feat(survival-diary): add responsive game input runtime"
```

### Task 5: Restrained HUD and Full Game Pages

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/crafting.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/journal.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/placement.js`
- Test: `tests/survival_diary_web.test.js`
- Test: `tests/survival_diary_play_mode.test.js`

**Interfaces:**
- Consumes: normalized actions and save v4.
- Produces: one-target prompt, four-vital cluster, folded minimap, five/six-slot hotbar, context button, inventory/crafting/map/journal/storage/settings pages.

- [ ] **Step 1: Add failing HUD density and page contracts**

```js
assert.equal((html.match(/data-context-action/g) || []).length, 1);
assert.match(html, /data-game-page="inventory"/);
assert.match(html, /data-game-page="storage"/);
assert.doesNotMatch(html, /nearby-resource-list/);
```

- [ ] **Step 2: Verify old dashboard markup fails the contracts**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_play_mode.test.js`  
Expected: FAIL on dense toolbar/nearby list assertions.

- [ ] **Step 3: Replace the HUD shell**

```html
<aside class="survival-vitals" data-vitals></aside>
<button class="folded-map" data-open-page="map" aria-label="打开地图"></button>
<nav class="quick-belt" data-hotbar></nav>
<button class="context-action" data-context-action disabled>无可用目标</button>
```

- [ ] **Step 4: Make pages mutually exclusive and world-aware**

```js
function openGamePage(name, payload = null) {
  document.documentElement.dataset.gamePage = name;
  gamePageController.render(name, payload);
  inputController.setGameplayEnabled(false);
}
```

- [ ] **Step 5: Keep placement camera and player controls active**

```js
placement.start(itemId, { allowPlayerMove: true, allowCameraPan: true, allowCameraZoom: true });
```

- [ ] **Step 6: Run Web gameplay/UI suites**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_play_mode.test.js tests/survival_diary_gameplay.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit the game UI shell**

```bash
git add website/survival-diary.zhengzhengstudio.cn tests/survival_diary_web.test.js tests/survival_diary_play_mode.test.js
git commit -m "feat(survival-diary): replace dashboard with game HUD"
```

### Task 6: Save Continuity, Quality Profiles, and Web Compatibility Entry

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/quality.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/save-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Modify: `website/survival-diary.zhengzhengstudio.cn/sw.js`
- Modify: `website/api/data/changelogs.json`
- Test: `tests/survival_diary_web.test.js`
- Test: `tests/survival_diary_gameplay.test.js`

**Interfaces:**
- Produces: `QualityController` with `getProfile()`, `setProfile(profile)`, `sampleFrame(durationMs)`; URL `?mode=compatibility` maps to `performance` without changing save content.

- [ ] **Step 1: Add failing persistence and quality tests**

```js
assert.equal(resolveProfile('?mode=compatibility'), 'performance');
assert.deepEqual(recoverSave({ current: corrupt, previous: valid }), valid);
assert.equal(restartRequiresConfirmation, true);
```

- [ ] **Step 2: Verify new quality contract fails**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_gameplay.test.js`  
Expected: FAIL because quality module and compatibility mapping are absent.

- [ ] **Step 3: Implement rendering-only profiles**

```js
const profiles = {
  performance: { shadows: false, particles: 0.35, vegetationMotion: 0.25, renderScale: 0.75 },
  balanced: { shadows: true, particles: 0.7, vegetationMotion: 0.65, renderScale: 1 },
  quality: { shadows: true, particles: 1, vegetationMotion: 1, renderScale: 1.25 },
};
```

- [ ] **Step 4: Add compatibility entry and two-step restart**

```html
<a class="compatibility-entry" href="./?mode=compatibility">兼容模式<span>适合旧手机、集显电脑和低内存设备</span></a>
```

- [ ] **Step 5: Bump service-worker cache and append changelog entry**

The changelog entry must describe the new world-first HUD, context actions, save recovery, and compatibility mode; it must not claim native packages are already updated.

- [ ] **Step 6: Run Web and changelog tests**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_release.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit Web persistence and compatibility**

```bash
git add website/survival-diary.zhengzhengstudio.cn website/api/data/changelogs.json tests
git commit -m "feat(survival-diary): add save-safe compatibility mode"
```

### Task 7: Web Runtime Verification and Process Evidence

**Files:**
- Create: `docs/survival-diary/screenshots/2026-08-03-web-real-game-desktop.png`
- Create: `docs/survival-diary/screenshots/2026-08-03-web-real-game-mobile.png`
- Modify: `docs/survival-diary/IMPLEMENTATION_LOG.md`

**Interfaces:**
- Consumes: completed Web vertical slice.
- Produces: actual runtime evidence at desktop and 390×844 mobile viewport.

- [ ] **Step 1: Run the complete shared/Web suite**

Run: `node --test tests/survival_diary_contracts.test.js tests/survival_diary_game_actions.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_play_mode.test.js tests/survival_diary_resource_progression.test.js tests/survival_diary_web.test.js tests/survival_diary_world_v3.test.js`  
Expected: PASS.

- [ ] **Step 2: Capture desktop runtime evidence**

Open the local Web build, continue an existing save, walk to reeds, harvest, pick up the drop, open the backpack, close it, enter placement mode, pan the camera, and capture the resulting gameplay frame.

- [ ] **Step 3: Capture mobile runtime evidence**

At 390×844, verify safe-area spacing, joystick movement, world drag, pinch zoom, context action and five-slot belt; capture the active gather prompt and non-zero vitals.

- [ ] **Step 4: Record exact changes, tests, limitations, and screenshot links**

Append one dated section to `IMPLEMENTATION_LOG.md`; label concept images as concepts and these two files as real runtime screenshots.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/survival-diary
git commit -m "docs(survival-diary): record playable web redesign"
```

