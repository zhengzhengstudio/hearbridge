# Survival Diary Wildlife and Ground Ecology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent twelve-species island ecosystem and five-layer ground presentation to every Survival Diary client, then build, sign, publish, and expose the updated packages in the website download center.

**Architecture:** Shared JSON content and deterministic JavaScript reference rules define species, habitats, populations, actions, traces, and save migration. Web, Android, Apple, and HarmonyOS implement platform-native renderers over the same IDs and event contracts; offline clients simulate locally, while online results are validated by the existing server protocol. Ground decoration is seed-derived and not persisted, while gameplay-bearing animals, nests, traps, domestication, populations, and traces are persisted.

**Tech Stack:** Vanilla JavaScript/Canvas and Node test runner; Kotlin/Android Canvas/Compose/JUnit; Swift/SpriteKit/SwiftUI/XCTest; ArkTS/ArkUI; JSON Schema; existing Python/Node asset pipelines; existing Android, Apple, and HarmonyOS signing toolchains.

## Global Constraints

- Preserve offline-complete play for Web local mode, Android, Apple, and HarmonyOS Offline.
- Use exactly these first species IDs: `seabird`, `land-crab`, `reef-fish`, `island-lizard`, `sea-turtle`, `wild-rabbit`, `wild-boar`, `mangrove-snake`, `fruit-bat`, `mountain-goat`, `waterfowl`, `reef-shark`.
- Most animals flee; `wild-boar`, `mangrove-snake`, `mountain-goat`, and `reef-shark` retaliate only after proximity, nest/young protection, surprise, or player aggression triggers.
- Hunting, traps, fishing, taming, and breeding are supported; only `wild-rabbit`, `mountain-goat`, and selected birds are tameable in this release.
- Do not use SVG line art or one shared texture for all species or states.
- Low-performance modes may reduce decoration, trace distance, animation frequency, shadows, and reflections, but must not remove species, resources, drops, tasks, collision, or save rules.
- Old saves must migrate without deleting inventory, buildings, journals, resources, discovered chunks, weather, or player position.
- Website changes must update `website/api/data/changelogs.json` and the public changelog mirror.
- Every implementation round records real runtime screenshots and evidence in `docs/survival-diary/IMPLEMENTATION_LOG.md`.
- Do not bump release versions or publish packages until Tasks 1–13 and their verification commands pass.

---

## File Structure

### Shared content and rules

- Create `apps/SurvivalDiaryShared/content/animals.json`: canonical species definitions and presentation keys.
- Create `apps/SurvivalDiaryShared/content/habitats.json`: biome, time, weather, water-depth, and carrying-capacity rules.
- Create `apps/SurvivalDiaryShared/schemas/animals.schema.json`: strict content validation.
- Create `apps/SurvivalDiaryShared/src/wildlife-simulation.js`: deterministic spawning, state stepping, actions, populations, and domain events.
- Create `apps/SurvivalDiaryShared/src/ground-detail.js`: deterministic five-layer ground detail generation.
- Modify `apps/SurvivalDiaryShared/src/migrate-save.js`: migrate wildlife save fields without resetting worlds.
- Modify `apps/SurvivalDiaryShared/assets/asset-manifest.json`: register animal and ground raster assets.

### Web

- Create `website/survival-diary.zhengzhengstudio.cn/js/wildlife.js`: browser adapter around shared wildlife semantics.
- Create `website/survival-diary.zhengzhengstudio.cn/js/ground-detail.js`: browser-safe detail generator.
- Modify `website/survival-diary.zhengzhengstudio.cn/js/world.js`: wildlife state, traces, sorting, walkability, and action routing.
- Modify `website/survival-diary.zhengzhengstudio.cn/js/game.js`: animation, target selection, hunting/taming/trap actions, and Canvas layers.
- Modify `website/survival-diary.zhengzhengstudio.cn/index.html`: load new modules without adding permanent HUD buttons.
- Modify `website/survival-diary.zhengzhengstudio.cn/sw.js`: cache-version and production assets.

### Android

- Create `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/WildlifeEngine.kt`: domain model and deterministic state transitions.
- Create `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/GroundDetailRenderer.kt`: five-layer detail renderer with quality budgets.
- Create `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/WildlifeRenderer.kt`: depth-sorted animal animation and traces.
- Modify `GameSave.kt`, `SaveRepository.kt`, `SurvivalDiaryApp.kt`, `NativeGameView.kt`, `RasterAtlas.kt`, and `GameHud.kt` for persistence, actions, assets, rendering, and contextual labels.

### Apple

- Create `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/Wildlife.swift`.
- Create `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/WildlifeLayer.swift`.
- Create `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/GroundDetailLayer.swift`.
- Modify `GameSave.swift`, `IslandScene.swift`, and `GameStore.swift`.

### HarmonyOS and server

- Create matching `Wildlife.ets` modules in both HarmonyOS editions.
- Modify both `Index.ets` pages to render and interact through ArkUI Canvas/native state.
- Create `website/survival-diary.zhengzhengstudio.cn/server/wildlife-authority.js` and extend `protocol-v2.js` and `world-store.js` for idempotent online result validation.

### Assets, tests, docs, and release

- Create PNG sprite/state folders under `website/survival-diary.zhengzhengstudio.cn/assets/game/animal/animal-<id>/`.
- Create PNG ground detail folders under `website/survival-diary.zhengzhengstudio.cn/assets/game/ground-detail/<biome>/`.
- Add focused Node, Kotlin, Swift, ArkTS, server, asset, publish, and release tests.
- Update process documentation, changelogs, manifest, client downloads, signed artifacts, and checksums only after full verification.

---

### Task 1: Canonical animal and habitat content

**Files:**
- Create: `apps/SurvivalDiaryShared/content/animals.json`
- Create: `apps/SurvivalDiaryShared/content/habitats.json`
- Create: `apps/SurvivalDiaryShared/schemas/animals.schema.json`
- Modify: `apps/SurvivalDiaryShared/schemas/content.schema.json`
- Test: `tests/survival_diary_wildlife_content.test.js`

**Interfaces:**
- Produces: `AnimalDefinition`, `HabitatDefinition`, and the twelve stable species IDs consumed by every later task.
- `AnimalDefinition` fields: `id`, `name`, `category`, `maxHealth`, `moveSpeed`, `fleeSpeed`, `awarenessRadius`, `retaliationTriggers`, `activityWindows`, `tameable`, `drops`, `presentationKey`.
- `HabitatDefinition` fields: `animalId`, `biomes`, `minWaterDepth`, `maxWaterDepth`, `weatherWeights`, `baseCapacity`, `foodTags`, `waterRequired`.

- [ ] **Step 1: Write the failing content test**

```js
test('wildlife catalog has twelve valid species with non-hostile defaults', () => {
  const animals = read('animals.json');
  const ids = animals.map(animal => animal.id);
  assert.deepEqual(ids, [
    'seabird', 'land-crab', 'reef-fish', 'island-lizard', 'sea-turtle', 'wild-rabbit',
    'wild-boar', 'mangrove-snake', 'fruit-bat', 'mountain-goat', 'waterfowl', 'reef-shark',
  ]);
  assert.equal(animals.filter(animal => animal.retaliationTriggers.length > 0).length, 4);
  assert.deepEqual(animals.filter(animal => animal.tameable).map(animal => animal.id).sort(),
    ['mountain-goat', 'seabird', 'wild-rabbit']);
  for (const animal of animals) {
    assert.ok(animal.maxHealth > 0);
    assert.ok(animal.moveSpeed > 0);
    assert.ok(animal.presentationKey.startsWith('animal.'));
  }
});
```

- [ ] **Step 2: Run the test and confirm the missing catalog failure**

Run: `node --test tests/survival_diary_wildlife_content.test.js`

Expected: FAIL with `ENOENT ... animals.json`.

- [ ] **Step 3: Add strict content and schema definitions**

Use JSON objects matching this concrete first entry and repeat the same complete shape for all twelve species:

```json
{
  "id": "seabird",
  "name": "海鸟",
  "category": "bird",
  "maxHealth": 18,
  "moveSpeed": 1.6,
  "fleeSpeed": 3.4,
  "awarenessRadius": 7,
  "retaliationTriggers": [],
  "activityWindows": ["dawn", "day", "dusk"],
  "tameable": true,
  "drops": { "feather": [1, 3], "egg": [0, 1] },
  "presentationKey": "animal.seabird"
}
```

Schema requirements: `additionalProperties: false`; all numeric fields non-negative; `retaliationTriggers` enum values limited to `proximity`, `surprise`, `nest`, `young`, `attacked`; habitat biome IDs must match `biomes.json`.

- [ ] **Step 4: Validate content and run progression tests**

Run: `node --test tests/survival_diary_wildlife_content.test.js tests/survival_diary_resource_progression.test.js`

Expected: all tests PASS and no unreachable drop-processing recipe IDs.

- [ ] **Step 5: Commit the canonical catalog**

```bash
git add apps/SurvivalDiaryShared/content/animals.json apps/SurvivalDiaryShared/content/habitats.json apps/SurvivalDiaryShared/schemas tests/survival_diary_wildlife_content.test.js
git commit -m "feat(survival-diary): define island wildlife catalog"
```

### Task 2: Deterministic wildlife simulation and population pressure

**Files:**
- Create: `apps/SurvivalDiaryShared/src/wildlife-simulation.js`
- Test: `tests/survival_diary_wildlife_simulation.test.js`

**Interfaces:**
- Consumes: canonical animal and habitat arrays from Task 1.
- Produces:
  - `createWildlifeState({ seed, regions, discoveredChunks, existing }): WildlifeState`
  - `stepWildlife(state, context, elapsedMinutes): WildlifeStepResult`
  - `applyWildlifeAction(state, action, context): WildlifeActionResult`
  - `populationKey(regionId, animalId): string`
- `WildlifeActionResult` is `{ ok, state, events, error, details }`; event IDs are deterministic and unique.

- [ ] **Step 1: Write failing deterministic, retaliation, and population tests**

```js
test('same seed and regions produce identical wildlife outside the player reveal radius', () => {
  const input = { seed: 'eco-1', regions: regions(), discoveredChunks: { '0,0': {} } };
  assert.deepEqual(createWildlifeState(input), createWildlifeState(input));
  assert.ok(Object.values(createWildlifeState(input).animals).every(a => distance(a.position, player) >= 10));
});

test('boar warns before retaliation while rabbits flee', () => {
  const boar = fixtureAnimal('wild-boar', { state: 'foraging' });
  const rabbit = fixtureAnimal('wild-rabbit', { state: 'foraging' });
  assert.equal(stepWildlife(fixture(boar), nearPlayer, 0.1).state.animals[boar.id].state, 'threaten');
  assert.equal(stepWildlife(fixture(rabbit), nearPlayer, 0.1).state.animals[rabbit.id].state, 'flee');
});

test('hunting pressure reduces carrying recovery instead of instant respawn', () => {
  const killed = applyWildlifeAction(populationFixture(), { type: 'damage', animalId: 'boar-1', amount: 999 }, context);
  const advanced = stepWildlife(killed.state, context, 1440);
  assert.equal(advanced.state.populations['0,0:wild-boar'].adults, 0);
  assert.ok(advanced.state.populations['0,0:wild-boar'].huntingPressure > 0);
});
```

- [ ] **Step 2: Run and verify missing module failure**

Run: `node --test tests/survival_diary_wildlife_simulation.test.js`

Expected: FAIL with `Cannot find module wildlife-simulation.js`.

- [ ] **Step 3: Implement deterministic state and bounded stepping**

```js
function stepWildlife(state, context, elapsedMinutes) {
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return failure(state, 'invalid-elapsed');
  const minutes = Math.min(elapsedMinutes, 360);
  const next = structuredClone(state);
  const events = [];
  for (const animal of activeAnimals(next, context.player.position, context.activeRadius)) {
    transitionAnimal(animal, next, context, minutes, events);
  }
  updateRemotePopulations(next, context, Math.min(elapsedMinutes, 10_080), events);
  return { ok: true, state: next, events, error: null, details: { simulatedMinutes: minutes } };
}
```

The active-radius loop must use a spatial bucket map, not scan every world animal. Remote populations update at most once per six game hours. Spawn candidates must reject buildings, invalid water depth, unreachable terrain, and positions within ten world units of the player.

- [ ] **Step 4: Run simulation tests and the shared survival suite**

Run: `node --test tests/survival_diary_wildlife_simulation.test.js tests/survival_diary_simulation_v3.test.js tests/survival_diary_resource_progression.test.js`

Expected: PASS with deterministic JSON on two repeated runs.

- [ ] **Step 5: Commit the wildlife engine**

```bash
git add apps/SurvivalDiaryShared/src/wildlife-simulation.js tests/survival_diary_wildlife_simulation.test.js
git commit -m "feat(survival-diary): add deterministic wildlife simulation"
```

### Task 3: Wildlife save migration, traces, and event contracts

**Files:**
- Modify: `apps/SurvivalDiaryShared/src/migrate-save.js`
- Create: `apps/SurvivalDiaryShared/src/wildlife-events.js`
- Test: `tests/survival_diary_wildlife_save.test.js`

**Interfaces:**
- Consumes: `WildlifeState` and events from Task 2.
- Produces:
  - `migrateWildlifeSave(save): SaveV4`
  - `createWildlifeEvent(type, subjectId, gameMinute, payload): WildlifeEvent`
  - persisted fields `animals`, `populations`, `nests`, `traps`, `domestication`, `wildlifeTraces`, `processedEventIds`.

- [ ] **Step 1: Write failing migration and idempotency tests**

```js
test('v3 worlds gain wildlife fields without losing existing progress', () => {
  const original = createSaveV3('old');
  original.inventory = { stone: 4 };
  original.entities = { camp: { id: 'camp', type: 'shelter' } };
  const migrated = migrateWildlifeSave(original);
  assert.deepEqual(migrated.inventory, original.inventory);
  assert.deepEqual(migrated.entities, original.entities);
  assert.deepEqual(migrated.animals, {});
  assert.deepEqual(migrated.populations, {});
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrateWildlifeSave(migrated), migrated);
});

test('event ids prevent duplicate drops after retry', () => {
  const event = createWildlifeEvent('animal-killed', 'boar-1', 720, { actorId: 'local' });
  assert.equal(event.id, createWildlifeEvent('animal-killed', 'boar-1', 720, { actorId: 'local' }).id);
});
```

- [ ] **Step 2: Run and verify schema/id failures**

Run: `node --test tests/survival_diary_wildlife_save.test.js`

Expected: FAIL because `migrateWildlifeSave` and `createWildlifeEvent` do not exist.

- [ ] **Step 3: Implement additive migration and stable event hashing**

```js
function migrateWildlifeSave(save) {
  const source = clone(save || {});
  return {
    ...source,
    schemaVersion: 4,
    animals: source.animals || {},
    populations: source.populations || {},
    nests: source.nests || {},
    traps: source.traps || {},
    domestication: source.domestication || {},
    wildlifeTraces: source.wildlifeTraces || {},
    processedEventIds: Array.isArray(source.processedEventIds) ? [...new Set(source.processedEventIds)] : [],
  };
}
```

Use the existing stable hash helper to derive event IDs from `type`, `subjectId`, `gameMinute`, and canonical payload ordering.

- [ ] **Step 4: Run migration, journal, and reconnect tests**

Run: `node --test tests/survival_diary_wildlife_save.test.js tests/survival_diary_gameplay.test.js website/survival-diary.zhengzhengstudio.cn/server/test/reconnect.test.js`

Expected: all PASS.

- [ ] **Step 5: Commit save/event contracts**

```bash
git add apps/SurvivalDiaryShared/src/migrate-save.js apps/SurvivalDiaryShared/src/wildlife-events.js tests/survival_diary_wildlife_save.test.js
git commit -m "feat(survival-diary): persist wildlife and traces"
```

### Task 4: Production raster assets for animals and ground details

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/game/animal/animal-<id>/{idle,walk,flee,alert,hit,down}.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/game/ground-detail/<biome>/{grass,leaf,stone,puddle,track}.png`
- Modify: `apps/SurvivalDiaryShared/assets/asset-manifest.json`
- Modify: `scripts/validate_survival_diary_assets.mjs`
- Test: `tests/survival_diary_wildlife_assets.test.js`

**Interfaces:**
- Consumes: `presentationKey` from Task 1.
- Produces: transparent PNG sprite sheets with a consistent ground anchor and biome-specific raster decals.
- Animal sheet contract: eight directions × four frames for locomotion states; source frame dimensions recorded in the manifest; `groundAnchor` in normalized coordinates.

- [ ] **Step 1: Write the failing asset completeness test**

```js
test('every animal has distinct raster states and a ground anchor', async () => {
  const idleHashes = [];
  for (const animal of animals) {
    const entry = manifest.assets[`animal.${animal.id}`];
    assert.ok(entry);
    for (const state of ['idle', 'walk', 'flee', 'alert', 'hit', 'down']) {
      assert.match(entry.states[state].path, /\.png$/);
      assert.ok((await png(entry.states[state].path)).width >= 256);
    }
    assert.ok(entry.groundAnchor.x >= 0 && entry.groundAnchor.x <= 1);
    assert.ok(entry.groundAnchor.y >= 0.65 && entry.groundAnchor.y <= 1);
    idleHashes.push(entry.states.idle.sha256);
  }
  assert.equal(new Set(idleHashes).size, animals.length);
});
```

- [ ] **Step 2: Run and verify missing-asset failure**

Run: `node --test tests/survival_diary_wildlife_assets.test.js`

Expected: FAIL on the first missing `animal.seabird` manifest entry.

- [ ] **Step 3: Generate and process original raster art**

Use the image generation workflow for original painted-island sprites, one species family at a time. Process source sheets with `scripts/process_survival_diary_sprite_sheet.py`; preserve alpha, remove magenta edge pixels, and export PNG only. Do not derive eleven species by recoloring one source.

Required visual constraints in every generation prompt:

```text
Original realistic hand-painted 2.5D island-survival game sprite sheet, transparent background,
consistent three-quarter overhead camera, grounded contact shadow separated from body, natural proportions,
eight directions, four locomotion frames, readable at 48–96 screen pixels, no UI, no text, no SVG/vector line art.
```

- [ ] **Step 4: Register hashes, dimensions, anchors, and performance tiers**

Add manifest state objects containing `path`, `width`, `height`, `sha256`, `groundAnchor`, and `qualityTiers`. Extend the validator to reject missing alpha, identical hashes across species, invalid dimensions, and magenta edge pixels.

- [ ] **Step 5: Run asset validation**

Run: `node scripts/validate_survival_diary_assets.mjs && node --test tests/survival_diary_wildlife_assets.test.js tests/survival_diary_web.test.js`

Expected: PASS; no SVG files found beneath either new asset root.

- [ ] **Step 6: Commit production assets separately**

```bash
git add website/survival-diary.zhengzhengstudio.cn/assets/game/animal website/survival-diary.zhengzhengstudio.cn/assets/game/ground-detail apps/SurvivalDiaryShared/assets/asset-manifest.json scripts/validate_survival_diary_assets.mjs tests/survival_diary_wildlife_assets.test.js
git commit -m "feat(survival-diary): add wildlife and ground raster art"
```

### Task 5: Web wildlife rendering and world integration

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/wildlife.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Test: `tests/survival_diary_web_wildlife.test.js`

**Interfaces:**
- Consumes: `WildlifeState`, `stepWildlife`, assets, and events from Tasks 1–4.
- Produces:
  - `SurvivalWildlife.createAdapter(content, options)`
  - `World.wildlifeForRender(state, bounds, quality)`
  - scene queue entries `{ kind: 'animal'|'trace', groundY, value }`.

- [ ] **Step 1: Write failing render-queue and behavior tests**

```js
test('animals join the same ground-sorted queue as resources buildings and player', () => {
  const state = world.createWorldView('animals');
  state.animals = { rabbit: animal('wild-rabbit', 120, 140) };
  const queue = world.sceneObjectsForRender(state, fullBounds);
  assert.deepEqual(queue.map(item => item.kind).filter(k => k === 'animal'), ['animal']);
  assert.ok(queue.every((item, index) => index === 0 || queue[index - 1].groundY <= item.groundY));
});

test('missing animal texture disables harmful interaction but keeps a visible silhouette', () => {
  const presentation = wildlife.presentationFor(animal('mangrove-snake'), new Map());
  assert.equal(presentation.fallback, 'species-silhouette');
  assert.equal(presentation.canDamagePlayer, false);
});
```

- [ ] **Step 2: Run and verify missing adapter failure**

Run: `node --test tests/survival_diary_web_wildlife.test.js`

Expected: FAIL because `js/wildlife.js` does not exist.

- [ ] **Step 3: Add browser adapter and scene objects**

```js
function wildlifeForRender(state, bounds, quality = 'balanced') {
  const max = quality === 'smooth' ? 18 : quality === 'detailed' ? 48 : 30;
  return Object.values(state.animals || {})
    .filter(animal => inBounds(animal.position, bounds) && animal.active !== false)
    .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))
    .slice(0, max)
    .map(animal => ({ kind: 'animal', groundY: animal.position.y, value: animal }));
}
```

Load the shared modules before `game.js`, add animals and traces to `sceneObjectsForRender`, and render sprites using the manifest ground anchor. Do not add a permanent “animals” HUD button.

- [ ] **Step 4: Add fixed-step animation and save scheduling**

Use a 10 Hz wildlife simulation accumulator independent from visual frame rate. Save only when gameplay-bearing wildlife state changes or the existing periodic save fires; do not save each animation frame.

- [ ] **Step 5: Run Web wildlife and existing world tests**

Run: `node --test tests/survival_diary_web_wildlife.test.js tests/survival_diary_web.test.js tests/survival_diary_world_v3.test.js`

Expected: PASS; old movement, water collision, depth sorting, and mobile HUD contracts remain green.

- [ ] **Step 6: Commit Web wildlife integration**

```bash
git add website/survival-diary.zhengzhengstudio.cn/js/wildlife.js website/survival-diary.zhengzhengstudio.cn/js/world.js website/survival-diary.zhengzhengstudio.cn/js/game.js website/survival-diary.zhengzhengstudio.cn/index.html tests/survival_diary_web_wildlife.test.js
git commit -m "feat(survival-diary): render living wildlife on web"
```

### Task 6: Web hunting, traps, taming, and breeding

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/wildlife.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/content.js`
- Modify: `apps/SurvivalDiaryShared/content/items.json`
- Modify: `apps/SurvivalDiaryShared/content/recipes.json`
- Test: `tests/survival_diary_wildlife_actions.test.js`

**Interfaces:**
- Consumes: `applyWildlifeAction` from Task 2 and the existing hotbar/tool durability system.
- Produces contextual actions `observe`, `track`, `attack`, `process`, `feed`, `lead`, `set-trap`, `collect-trap`; events feed journal and guide systems.

- [ ] **Step 1: Write failing action-chain tests**

```js
test('hunting requires range and consumes weapon durability before producing a carcass', () => {
  const tooFar = act(base, { type: 'attack', animalId: 'boar-1', toolId: 'stone-spear' }, farContext);
  assert.equal(tooFar.error, 'out-of-range');
  const hit = act(base, { type: 'attack', animalId: 'boar-1', toolId: 'stone-spear' }, nearContext);
  assert.ok(hit.state.toolDurability['stone-spear'] < base.toolDurability['stone-spear']);
  assert.equal(hit.events[0].type, 'animal-injured');
});

test('goat taming requires repeated safe feeding and valid enclosure', () => {
  let state = goatFixture();
  for (let day = 1; day <= 4; day += 1) state = feed(state, day).state;
  assert.equal(state.domestication['goat-1'].trust, 80);
  assert.equal(leadIntoInvalidPen(state).error, 'invalid-enclosure');
  assert.equal(leadIntoValidPen(state).events.at(-1).type, 'animal-tamed');
});
```

- [ ] **Step 2: Run and confirm missing action failures**

Run: `node --test tests/survival_diary_wildlife_actions.test.js`

Expected: FAIL with unsupported `attack` and `feed` actions.

- [ ] **Step 3: Add concrete items and recipes**

Add `stone-spear`, `small-game-trap`, `animal-feed`, `feed-trough`, `nest-box`, `raw-meat`, `hide`, `bone`, `feather`, `egg`, `goat-milk`, and `wool`. Every recipe must use reachable existing ingredients and a valid station. Extend the progression test’s tool/station graph.

- [ ] **Step 4: Route nearest-animal context actions through existing primary action**

The right-side primary action label becomes target-specific (`观察海鸟`, `追踪野兔`, `抵挡野猪`, `投喂山羊`, `处理猎物`). Keep inventory, crafting, map, diary, and chat entry count unchanged.

- [ ] **Step 5: Run action, durability, journal, and guide tests**

Run: `node --test tests/survival_diary_wildlife_actions.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_play_mode.test.js tests/survival_diary_resource_progression.test.js`

Expected: PASS with no direct click-to-meat path.

- [ ] **Step 6: Commit Web gameplay loop**

```bash
git add apps/SurvivalDiaryShared/content/items.json apps/SurvivalDiaryShared/content/recipes.json website/survival-diary.zhengzhengstudio.cn/js/content.js website/survival-diary.zhengzhengstudio.cn/js/wildlife.js website/survival-diary.zhengzhengstudio.cn/js/game.js tests/survival_diary_wildlife_actions.test.js tests/survival_diary_resource_progression.test.js
git commit -m "feat(survival-diary): add hunting and animal husbandry"
```

### Task 7: Five-layer Web ground rendering

**Files:**
- Create: `apps/SurvivalDiaryShared/src/ground-detail.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/ground-detail.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Test: `tests/survival_diary_ground_detail.test.js`

**Interfaces:**
- Produces `groundDetailsForChunk(seed, chunkX, chunkY, biomeId, quality): GroundDetailPlan`.
- `GroundDetailPlan` contains `transitions`, `decorations`, and `traceCapacity`; decoration records are `{ id, kind, x, y, rotation, scale, opacity }`.

- [ ] **Step 1: Write failing determinism, density, and readability tests**

```js
test('ground detail is deterministic and quality only changes decoration cost', () => {
  const smooth = groundDetailsForChunk('g', 0, 0, 'mangrove', 'smooth');
  const detailed = groundDetailsForChunk('g', 0, 0, 'mangrove', 'detailed');
  assert.deepEqual(smooth.transitions, detailed.transitions);
  assert.ok(smooth.decorations.length <= detailed.decorations.length * 0.4);
  assert.deepEqual(groundDetailsForChunk('g', 0, 0, 'mangrove', 'smooth'), smooth);
});

test('decorations never claim interactive resource ids', () => {
  const plan = groundDetailsForChunk('g', 2, -1, 'palm-grove', 'balanced');
  assert.ok(plan.decorations.every(item => !item.interactive && !item.itemId));
});
```

- [ ] **Step 2: Run and verify missing generator failure**

Run: `node --test tests/survival_diary_ground_detail.test.js`

Expected: FAIL with missing `ground-detail.js`.

- [ ] **Step 3: Implement seeded transition and decoration plans**

```js
const QUALITY_DENSITY = { smooth: 0.35, balanced: 0.72, detailed: 1 };
function groundDetailsForChunk(seed, chunkX, chunkY, biomeId, quality = 'balanced') {
  const density = QUALITY_DENSITY[quality] || QUALITY_DENSITY.balanced;
  return {
    transitions: transitionPlan(seed, chunkX, chunkY, biomeId),
    decorations: decorationCandidates(seed, chunkX, chunkY, biomeId)
      .filter(entry => entry.rank <= density),
    traceCapacity: quality === 'smooth' ? 24 : quality === 'detailed' ? 96 : 56,
  };
}
```

Web render order: ocean/base atlas → biome transitions → micro-decoration beneath actors → gameplay traces → common depth queue → weather/atmosphere → HUD. Cache per chunk and quality; invalidate only on quality or biome-state change.

- [ ] **Step 4: Add trace fading and tree-canopy proximity fade**

Trace opacity is derived from game-minute age and weather wash rate. Canopy fade applies only within player proximity and uses `globalAlpha`; it must not change collision or saved entity state.

- [ ] **Step 5: Run ground, visual contract, and mobile tests**

Run: `node --test tests/survival_diary_ground_detail.test.js tests/survival_diary_web.test.js tests/survival_diary_world_v3.test.js`

Expected: PASS; no square seam, duplicate-interactive, or mobile HUD regression assertions.

- [ ] **Step 6: Commit Web ground layers**

```bash
git add apps/SurvivalDiaryShared/src/ground-detail.js website/survival-diary.zhengzhengstudio.cn/js/ground-detail.js website/survival-diary.zhengzhengstudio.cn/js/game.js website/survival-diary.zhengzhengstudio.cn/js/world.js tests/survival_diary_ground_detail.test.js
git commit -m "feat(survival-diary): layer natural ground detail"
```

### Task 8: Android wildlife domain and persistence

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/WildlifeEngine.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/WildlifeEngineTest.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/SaveLifecycleTest.kt`

**Interfaces:**
- Kotlin mirrors Task 2 IDs and fields exactly.
- Produces `WildlifeEngine.create(save: GameSave): WildlifeState`, `step(state, context, elapsedMinutes)`, and `act(state, action, context)`.

- [ ] **Step 1: Write failing Kotlin parity tests**

```kotlin
@Test fun `rabbit flees and boar threatens under identical proximity`() {
    val rabbit = fixture("wild-rabbit")
    val boar = fixture("wild-boar")
    assertEquals(AnimalBehavior.FLEE, WildlifeEngine.step(rabbit, nearContext, .1).animals.getValue("a").behavior)
    assertEquals(AnimalBehavior.THREATEN, WildlifeEngine.step(boar, nearContext, .1).animals.getValue("a").behavior)
}

@Test fun `wildlife fields survive atomic save round trip`() {
    val original = fixtureSaveWithAnimals()
    repository.save("wildlife", original)
    assertEquals(original.wildlife, repository.load("wildlife")?.wildlife)
}
```

- [ ] **Step 2: Run and verify unresolved types**

Run from `apps/SurvivalDiary-Android` with Android Studio JBR and SDK: `./gradlew testPlayDebugUnitTest --tests '*WildlifeEngineTest' --tests '*SaveLifecycleTest'`

Expected: Kotlin compile FAIL for missing wildlife types.

- [ ] **Step 3: Add focused Kotlin data classes and engine**

```kotlin
data class WildlifeState(
    val animals: Map<String, AnimalState> = emptyMap(),
    val populations: Map<String, PopulationState> = emptyMap(),
    val nests: Map<String, NestState> = emptyMap(),
    val traps: Map<String, TrapState> = emptyMap(),
    val domestication: Map<String, DomesticationState> = emptyMap(),
    val traces: Map<String, WildlifeTrace> = emptyMap(),
    val processedEventIds: Set<String> = emptySet(),
)
```

Keep `WildlifeEngine.kt` free of Android framework imports so unit tests remain fast. Decode missing wildlife JSON as `WildlifeState()` and encode every gameplay-bearing field.

- [ ] **Step 4: Run Kotlin and fixture parity tests**

Run: `./gradlew testPlayDebugUnitTest --tests '*WildlifeEngineTest' --tests '*SaveLifecycleTest' --tests '*FixtureParityTest'`

Expected: PASS; legacy save fixtures remain readable.

- [ ] **Step 5: Commit Android wildlife domain**

```bash
git add apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/WildlifeEngine.kt apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt apps/SurvivalDiary-Android/app/src/test
git commit -m "feat(survival-diary): persist Android wildlife"
```

### Task 9: Android native animals, actions, and five-layer ground

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/WildlifeRenderer.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/GroundDetailRenderer.kt`
- Modify: `NativeGameView.kt`, `RasterAtlas.kt`, `SurvivalDiaryApp.kt`, `GameHud.kt`, `InventoryScreen.kt`
- Test: `WildlifePresentationTest.kt`, `tests/survival_diary_android_native.test.js`

**Interfaces:**
- Consumes Task 8 `WildlifeState` and Task 4 asset manifest.
- `WildlifeRenderer.draw(canvas, animals, traces, camera, quality, gameMinute)` returns no state; interaction uses `nearestAnimal(player, maxDistance)`.
- `GroundDetailRenderer.drawBelowActors(...)` and `drawGameplayTraces(...)` are separate to preserve depth order.

- [ ] **Step 1: Write failing presentation and hit-target tests**

```kotlin
@Test fun `animal render metrics preserve size hierarchy and ground anchors`() {
    assertTrue(WildlifeMetrics.size("wild-boar") > WildlifeMetrics.size("land-crab"))
    assertTrue(WildlifeMetrics.size("mountain-goat") > WildlifeMetrics.size("wild-rabbit"))
    assertTrue(WildlifeMetrics.anchor("mangrove-snake").y >= .65f)
}

@Test fun `nearest target ignores animals behind water or outside interaction range`() {
    assertEquals("rabbit-1", WildlifeTargeting.nearestAnimal(player, fixtures, 3.2, walkability)?.id)
}
```

- [ ] **Step 2: Run and verify missing renderer/metrics failures**

Run: `./gradlew testPlayDebugUnitTest --tests '*WildlifePresentationTest'`

Expected: Kotlin compile FAIL for missing `WildlifeMetrics` and `WildlifeTargeting`.

- [ ] **Step 3: Implement draw layers and 10 Hz domain stepping**

Modify `NativeGameView.drawScene` to build one `groundY` queue containing resources, wildlife, buildings, player, and gameplay traces. Draw base terrain and micro-decoration before the queue. Billboard animal sprites remain upright under the final 2.5D camera implementation.

- [ ] **Step 4: Connect contextual actions and tool durability**

`GameViewModel.useSelected()` prioritizes a selected/nearest animal only when it is closer than the nearest resource/building. Action labels are concrete. Attack calls `ToolDurabilityEngine.use`; carcass processing checks inventory capacity; feeding consumes one valid feed item; traps are placeable entities with persisted state.

- [ ] **Step 5: Add quality budgets and run Android regression**

Run: `./gradlew testPlayDebugUnitTest` and `node --test tests/survival_diary_android_native.test.js`

Expected: all Android unit tests and native contracts PASS; smooth quality caps active animal animations and decoration count without removing state.

- [ ] **Step 6: Commit Android native ecology**

```bash
git add apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary apps/SurvivalDiary-Android/app/src/test tests/survival_diary_android_native.test.js
git commit -m "feat(survival-diary): add Android native island ecology"
```

### Task 10: Apple shared wildlife and SpriteKit ground layers

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/Wildlife.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/WildlifeLayer.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/GroundDetailLayer.swift`
- Modify: `GameSave.swift`, `IslandScene.swift`, `GameStore.swift`, `Package.swift`
- Test: `SurvivalDiaryCoreTests/WildlifeTests.swift`, `SurvivalDiaryGameTests/WildlifePresentationTests.swift`

**Interfaces:**
- Swift `WildlifeState`, `AnimalState`, `PopulationState`, and `WildlifeEvent` use the canonical JSON keys.
- `WildlifeSimulation.step(state:context:elapsedMinutes:)` mirrors Task 2 fixture output.
- `WildlifeLayer.apply(snapshot:gameMinute:)` performs SpriteKit interpolation only.

- [ ] **Step 1: Write failing Swift fixture and presentation tests**

```swift
func testRabbitFleesWhileBoarThreatens() throws {
    XCTAssertEqual(try WildlifeSimulation.step(state: rabbitFixture, context: near, elapsedMinutes: 0.1).animals["a"]?.behavior, .flee)
    XCTAssertEqual(try WildlifeSimulation.step(state: boarFixture, context: near, elapsedMinutes: 0.1).animals["a"]?.behavior, .threaten)
}

func testWildlifeNodesAreSortedByGroundAnchor() {
    let fixture = wildlifeFixture(
        rabbitGroundY: 120,
        boarGroundY: 260
    )
    layer.apply(snapshot: fixture, gameMinute: 720)
    XCTAssertLessThan(layer.node("rabbit")!.zPosition, layer.node("boar")!.zPosition)
}
```

- [ ] **Step 2: Run and verify missing module/type failures**

Run from `apps/SurvivalDiary-Apple`: `swift test`

Expected: compile FAIL for missing `WildlifeSimulation` and `WildlifeLayer`.

- [ ] **Step 3: Implement Codable state, deterministic fixtures, and SpriteKit layers**

Keep presentation interpolation in `WildlifeLayer` and all canonical state transitions in `SurvivalDiaryCore`; do not add a second gameplay state machine in SpriteKit. Ground details use deterministic child nodes grouped by chunk and quality, not one node per world decoration across the entire map.

- [ ] **Step 4: Connect scene actions, save migration, and background persistence**

Route SpriteKit target selection into existing SwiftUI HUD callbacks. Persist wildlife before backgrounding and load old saves with empty wildlife fields followed by discovered-region population initialization.

- [ ] **Step 5: Run full Apple tests**

Run: `swift test`

Expected: all core, game, UI, save, camera, and wildlife tests PASS.

- [ ] **Step 6: Commit Apple ecology**

```bash
git add apps/SurvivalDiary-Apple
git commit -m "feat(survival-diary): add Apple native island ecology"
```

### Task 11: HarmonyOS Offline and Online wildlife clients

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/shared/domain/Wildlife.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/shared/domain/Wildlife.ets`
- Modify both: `entry/src/main/ets/pages/Index.ets`
- Test both: `entry/src/test/Wildlife.test.ets`
- Modify: `tests/survival_diary_harmony_native.test.js`

**Interfaces:**
- `Wildlife.create(seed, regions)`, `Wildlife.step(state, context, minutes)`, and `Wildlife.act(state, action, context)` use canonical IDs.
- Offline performs complete local decisions; Online submits canonical actions and reconciles authority events.

- [ ] **Step 1: Write identical failing ArkTS fixture tests in both projects**

```ts
it('uses canonical flee and threaten behavior', 0, () => {
  expect(Wildlife.step(rabbitFixture(), nearContext(), 0.1).animals['a'].behavior).assertEqual('flee')
  expect(Wildlife.step(boarFixture(), nearContext(), 0.1).animals['a'].behavior).assertEqual('threaten')
})
```

- [ ] **Step 2: Run project tests and verify missing Wildlife module**

Run:

```bash
cd apps/SurvivalDiary-HarmonyOS-Offline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon
cd ../SurvivalDiary-HarmonyOS-Online && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon
```

Expected: compile FAIL on the missing import.

- [ ] **Step 3: Implement offline-complete deterministic rules and Canvas rendering**

Use ArkTS-compatible classes and records; avoid dynamic property access that breaks AOT compilation. Render only visible animals and nearby micro-decoration. HarmonyOS Offline must not add `INTERNET` permission.

- [ ] **Step 4: Add online prediction/reconciliation hooks without WebView**

Online client submits `{ eventId, type, animalId, actorId, gameMinute, payload }`; local movement interpolation continues while awaiting a result. Rejected damage/drop events remove predicted items and restore the authoritative animal state.

- [ ] **Step 5: Run ArkTS and native contract suites**

Run both Hvigor test suites and `node --test tests/survival_diary_harmony_native.test.js`.

Expected: PASS; Offline has no network permission; both editions remain native ArkUI.

- [ ] **Step 6: Commit HarmonyOS clients**

```bash
git add apps/SurvivalDiary-HarmonyOS-Offline apps/SurvivalDiary-HarmonyOS-Online tests/survival_diary_harmony_native.test.js
git commit -m "feat(survival-diary): add HarmonyOS island ecology"
```

### Task 12: Online wildlife authority and idempotent results

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/wildlife-authority.js`
- Modify: `server/protocol-v2.js`, `server/world-store.js`, `server/server.js`
- Test: `server/test/wildlife-authority.test.js`, `server/test/protocol-v2.test.js`, `server/test/reconnect.test.js`

**Interfaces:**
- Produces `validateWildlifeCommand(world, command, actor): AuthorityResult`.
- Accepted command result: `{ ok: true, world, event }`; rejected: `{ ok: false, error, authoritativeAnimal, eventId }`.

- [ ] **Step 1: Write failing idempotency and permission tests**

```js
test('replayed kill command returns the first result without duplicate drops', () => {
  const first = authority.apply(world, killCommand, actor);
  const replay = authority.apply(first.world, killCommand, actor);
  assert.deepEqual(replay.event, first.event);
  assert.equal(replay.world.inventory[actor.id].hide, first.world.inventory[actor.id].hide);
});

test('private-island guests cannot hunt owner wildlife without permission', () => {
  assert.equal(authority.apply(privateWorld, attackCommand, guest).error, 'permission-denied');
});
```

- [ ] **Step 2: Run and verify missing authority failure**

Run: `npm test -- --test-name-pattern=wildlife` from the server directory.

Expected: FAIL because `wildlife-authority.js` is missing.

- [ ] **Step 3: Validate distance, tool ownership, durability, animal state, ACL, and event ID**

Never trust client-provided drops, remaining health, or tame progress. Resolve those from server world state and shared definitions. Store processed IDs in a bounded per-world LRU persisted by `world-store.js`.

- [ ] **Step 4: Run authority, reconnect, ACL, and cloud-save tests**

Run: `npm test`

Expected: all server tests PASS with no duplicate drops after replay or reconnect.

- [ ] **Step 5: Commit server authority**

```bash
git add website/survival-diary.zhengzhengstudio.cn/server
git commit -m "feat(survival-diary): validate online wildlife actions"
```

### Task 13: Performance budgets and cross-platform fixture parity

**Files:**
- Create: `apps/SurvivalDiaryShared/fixtures/wildlife-v1-seed-20260803.json`
- Create: `tests/survival_diary_wildlife_performance.test.js`
- Modify platform fixture tests for Android, Apple, and HarmonyOS.

**Interfaces:**
- Canonical fixture contains initial state, ten step/action commands, expected events, and final stable state.
- Performance contract: only nearby animals receive full-frequency steps; smooth/balanced/detailed decoration densities are `0.35/0.72/1.0`.

- [ ] **Step 1: Write a failing parity test that runs the shared fixture**

```js
test('reference wildlife fixture is deterministic and bounded', () => {
  const first = runFixture(fixture);
  const second = runFixture(fixture);
  assert.deepEqual(first, second);
  assert.ok(first.metrics.maxActiveAnimals <= 30);
  assert.ok(first.metrics.remotePopulationUpdates <= 4);
});
```

- [ ] **Step 2: Run all fixture suites and record mismatches**

Run Node fixture tests, Android `FixtureParityTest`, Apple `swift test --filter Wildlife`, and both Harmony fixture tests.

Expected: platform fixtures initially FAIL where their serialized output differs from the reference.

- [ ] **Step 3: Align rounding, ordering, time windows, and event IDs**

Use four decimal places for deterministic floating values; sort maps by stable ID before serialization; normalize game minutes to `[0, 1440)`; do not weaken assertions to accept multiple outputs.

- [ ] **Step 4: Run all parity and performance tests again**

Expected: all clients produce the exact fixture events and final state; performance budgets remain under caps.

- [ ] **Step 5: Commit parity fixture and budgets**

```bash
git add apps/SurvivalDiaryShared/fixtures tests/survival_diary_wildlife_performance.test.js apps/SurvivalDiary-Android/app/src/test apps/SurvivalDiary-Apple/Tests apps/SurvivalDiary-HarmonyOS-Offline/entry/src/test apps/SurvivalDiary-HarmonyOS-Online/entry/src/test
git commit -m "test(survival-diary): lock wildlife parity and budgets"
```

### Task 14: Runtime visual QA, screenshots, and changelogs

**Files:**
- Modify: `docs/survival-diary/IMPLEMENTATION_LOG.md`
- Create screenshots beneath: `docs/survival-diary/screenshots/`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/changelogs.json`
- Test: relevant browser, Android, Apple, and HarmonyOS runtime surfaces.

**Interfaces:**
- Produces real runtime evidence for Web desktop, Web 390×844, Android phone/tablet, Apple, HarmonyOS Offline, and HarmonyOS Online.

- [ ] **Step 1: Start each real runtime and capture baseline errors before screenshots**

Web must use a clean query/build marker and a fresh page reload. Check console errors before capture. Android/Apple/Harmony screenshots must come from simulator, preview, or built runtime, not concept art.

- [ ] **Step 2: Exercise visible scenarios**

Capture at least: rabbit flee, boar warning, goat feeding in a valid pen, mangrove tracks after rain, detailed ground at desktop, smooth quality at 390×844, and one save/reload showing the same animals/population.

- [ ] **Step 3: Record exact screenshots and limitations**

Append date, feedback, root cause, files, tests, build state, screenshot links, and any incomplete platform behavior to `IMPLEMENTATION_LOG.md`. Do not label conceptual imagery as runtime evidence.

- [ ] **Step 4: Add changelog entries and validate JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('website/api/data/changelogs.json')); JSON.parse(require('fs').readFileSync('website/zhengzhengstudio.cn/api/changelogs.json'))"
```

Expected: exit 0.

- [ ] **Step 5: Commit QA evidence**

```bash
git add docs/survival-diary website/api/data/changelogs.json website/zhengzhengstudio.cn/api/changelogs.json
git commit -m "docs(survival-diary): record wildlife runtime QA"
```

### Task 15: Version, signed builds, package publication, and download center

**Files:**
- Modify: `apps/SurvivalDiary-Android/app/build.gradle.kts`
- Modify: `apps/SurvivalDiary-Apple/Support/iOS-Info.plist`, `apps/SurvivalDiary-Apple/Support/macOS-Info.plist`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/Simulation.swift`
- Modify: `apps/SurvivalDiary-Apple/scripts/build_ios.sh`, `apps/SurvivalDiary-Apple/scripts/build_macos.sh`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/AppScope/app.json5`, `apps/SurvivalDiary-HarmonyOS-Online/AppScope/app.json5`
- Modify: `scripts/build_survival_diary_release.sh`, `apps/SurvivalDiary-HarmonyOS-Offline/build-release.sh`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/build-release.sh`, mirroring the verified Offline pipeline with the Online bundle/profile contract.
- Create: `release/survival-diary/<version>/release.json`
- Create signed artifacts under: `website/api/apps/`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`.
- Modify: `website/api/data/changelogs.json` and public mirror with final package evidence.
- Test: `tests/survival_diary_publish_contract.test.js`, `tests/survival_diary_release_v3.test.js`.

**Interfaces:**
- Consumes all verified clients and assets.
- Produces version/build-gated update metadata, signed APK/IPA-or-archive/macOS/HAP/APP artifacts as supported by available certificates, SHA-256 hashes, package sizes, descriptions, and client download entries.

- [ ] **Step 1: Run the release preflight before changing versions**

Run all focused Node suites, Android unit tests, Apple tests, both Harmony tests, server tests, asset validation, and runtime smoke checks. Record exact passing counts in the implementation log.

Expected: zero failures. If any platform cannot build because a signing profile or certificate is absent, stop publication for that artifact and report the exact missing external requirement; do not publish a debug or unsigned file as formal.

- [ ] **Step 2: Choose one semver and monotonically increasing build per platform**

Run `node scripts/generate_survival_diary_release_metadata.mjs --propose`, record its proposed patch version/builds, then apply the same semantic version to the Android, Apple, HarmonyOS, build-script, manifest, and client-download files listed above. HarmonyOS keeps its repository convention of a larger monotonically increasing numeric `versionCode`. The manifest comparison must consider both semantic version and numeric build. Do not write the proposed values before the preflight passes.

- [ ] **Step 3: Build and verify formal signatures**

Android: run `scripts/build_survival_diary_release.sh`, then verify the published APK again with the newest Android SDK `apksigner verify --verbose --print-certs`. Build the Play variant only if its store signing configuration is present; otherwise keep that channel unavailable.  
Apple: run `apps/SurvivalDiary-Apple/scripts/build_ios.sh --signed` and `apps/SurvivalDiary-Apple/scripts/build_macos.sh --signed`; verify bundle ID, version, build, entitlements, hardened runtime, and non-debug status with `codesign`. Publish iOS/macOS only when the required profile/identity and, for macOS, notarization credentials are present.  
HarmonyOS: run `apps/SurvivalDiary-HarmonyOS-Offline/build-release.sh` and `apps/SurvivalDiary-HarmonyOS-Online/build-release.sh`; both produce HAP and APP Pack where their matching Release Profile permits. Verify signature metadata with DevEco's `hap-sign-tool.jar verify-app`, verify the signed Profile bundle name, and confirm Offline has no `ohos.permission.INTERNET` declaration.

- [ ] **Step 4: Copy only verified artifacts to `website/api/apps`**

Use explicit final filenames containing product, platform, version, and build. Compute SHA-256 and size from the copied file. Preserve prior released artifacts.

- [ ] **Step 5: Update manifest and client downloads atomically**

Each entry must include platform/channel, version, build, URL, file name, byte size, SHA-256, package ID, minimum OS, concise Chinese description, update notes, and publication timestamp. Confirm the download center reads the updated client-downloads source rather than only `manifest.json`.

- [ ] **Step 6: Run release and live download-center tests**

Run:

```bash
node --test tests/survival_diary_publish_contract.test.js tests/survival_diary_release_v3.test.js
node scripts/generate_survival_diary_release_metadata.mjs --verify
```

Then open the local/hosted download center, verify the updated introduction and every visible download link, and issue a HEAD/GET check for each artifact.

- [ ] **Step 7: Commit release metadata and verified packages**

```bash
git add release/survival-diary website/api/apps website/api/data/changelogs.json website/zhengzhengstudio.cn/api/changelogs.json
git commit -m "release(survival-diary): publish wildlife ecology update"
```

---

## Final Verification Checklist

- [ ] All twelve species appear only in valid habitats and time windows.
- [ ] Flee/retaliate rules, hunting, traps, fishing, taming, breeding, population pressure, and offline caps pass deterministic tests.
- [ ] Web, Android, Apple, HarmonyOS Offline, and HarmonyOS Online consume the same IDs and fixture events.
- [ ] Ground base, transitions, micro-decoration, traces, and entity depth are visually distinct without hiding interactive resources.
- [ ] Low-performance mode reduces cost only, not gameplay.
- [ ] Old saves migrate and reload with no loss of prior world progress.
- [ ] Online replay/reconnect cannot duplicate drops, tame progress, or births.
- [ ] Actual runtime screenshots exist for required desktop/mobile/native scenarios.
- [ ] Changelog JSON is updated and valid.
- [ ] Every published package is formally signed, checksum-verified, present in `website/api/apps`, represented in both manifest and client downloads, and downloadable from the visible download center.
