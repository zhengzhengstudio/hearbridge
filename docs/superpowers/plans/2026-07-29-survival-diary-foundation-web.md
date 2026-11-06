# Survival Diary Shared Foundation and Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze v2 cross-platform contracts and turn the Web build into a playable open-ended survival game with A/B guidance, real placement, diary, weather, day/night, biomes, correct zoom, and production atlases.

**Architecture:** `SurvivalDiaryShared` is the canonical data/schema/fixture package. The Web client remains Canvas/WebGL, but game rules are pure modules with deterministic tests; DOM code only binds input, HUD, diary, persistence, and rendering.

**Tech Stack:** JavaScript CommonJS/browser modules, JSON Schema 2020-12, Canvas 2D/WebGL, IndexedDB/localStorage migration, Node.js built-in test runner.

## Global Constraints

- Save schema ID becomes `https://zhengzhengstudio.cn/schemas/survival-diary/save-v2.json`.
- `playMode` is `"guided"` or `"free"` and defaults to `"guided"`.
- Weather kinds are `clear`, `cloudy`, `fog`, `rain`, `storm`, `snow`, and `blizzard`.
- World objects, actors, shadows, and collisions use one camera transform.
- Task labels use screen-space layout and do not change world scale.
- No ending, day limit, or finite map-boundary field is allowed.
- Final world/item assets are PNG/WebP, not SVG or emoji.

---

### Task 1: Freeze Save v2, Protocol v2, and Golden Fixtures

**Files:**
- Modify: `apps/SurvivalDiaryShared/schemas/save.schema.json`
- Modify: `apps/SurvivalDiaryShared/schemas/protocol.schema.json`
- Create: `apps/SurvivalDiaryShared/content/weather.json`
- Modify: `apps/SurvivalDiaryShared/content/biomes.json`
- Modify: `apps/SurvivalDiaryShared/src/reference-simulation.js`
- Create: `apps/SurvivalDiaryShared/src/migrate-save.js`
- Create: `apps/SurvivalDiaryShared/fixtures/world-v2-seed-20260729.json`
- Create: `scripts/generate_survival_diary_fixture.mjs`
- Create: `tests/survival_diary_contracts_v2.test.js`

**Interfaces:**
- Produces: `createWorld(seed, { playMode })`, `stepWorld(state, command)`, `migrateSaveV2(raw)`, and `digestWorld(world)`.
- `stepWorld` accepts `discover_region`, `advance_time`, `set_play_mode`, `gather`, `craft`, `place`, `repair`, `dismantle`, and `write_diary`.

- [ ] **Step 1: Write failing v2 contract tests**

```js
test('new and migrated saves default to guided without losing progress', () => {
  const fresh = createWorld('guided-first', {});
  const migrated = migrateSaveV2({ inventory: { fiber: 7 }, player: { x: 9, y: 4 } });
  assert.equal(fresh.playMode, 'guided');
  assert.equal(migrated.playMode, 'guided');
  assert.deepEqual(migrated.inventory, { fiber: 7 });
  assert.deepEqual(migrated.player, { x: 9, y: 4 });
});

test('weather and biomes are deterministic and non-terminal', () => {
  const a = commands.reduce(stepWorld, createWorld('weather-seed', {}));
  const b = commands.reduce(stepWorld, createWorld('weather-seed', {}));
  assert.equal(digestWorld(a), digestWorld(b));
  assert.equal('ending' in a, false);
  assert.equal('mapBoundary' in a, false);
});
```

- [ ] **Step 2: Run the tests and verify the v1 implementation fails**

Run:

```bash
node --test tests/survival_diary_contracts_v2.test.js
```

Expected: FAIL because schema version 2, `playMode`, weather, and v2 commands do not exist.

- [ ] **Step 3: Implement the v2 root state**

```js
function createWorld(seed, options = {}) {
  return {
    schemaVersion: 2,
    productVersion: '0.3.0',
    build: 3,
    seed,
    playMode: options.playMode === 'free' ? 'free' : 'guided',
    day: 1,
    time: 360,
    weather: { kind: 'clear', intensity: 0, wetness: 0, wind: 0.15 },
    regions: {},
    entities: {},
    players: {},
    journals: {},
    milestones: {},
  };
}
```

- [ ] **Step 4: Add deterministic weather/biome transitions and v1 migration**

`migrateSaveV2` must deep-clone input, preserve inventory, coordinates, entities, and journal text, then add only missing v2 fields. Weather selection must hash `seed`, `day`, `time bucket`, elevation, moisture, and temperature.

- [ ] **Step 5: Generate and lock the golden fixture**

Run:

```bash
node scripts/generate_survival_diary_fixture.mjs
node --test tests/survival_diary_contracts_v2.test.js
```

Expected: fixture digest is stable across two runs and every test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiaryShared tests/survival_diary_contracts_v2.test.js scripts/generate_survival_diary_fixture.mjs
git commit -m "feat: define Survival Diary v2 contracts"
```

### Task 2: Implement A/B Guidance and Persistence

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/play-mode.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/save-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Create: `tests/survival_diary_play_mode.test.js`

**Interfaces:**
- Produces: `createGuideState(save)`, `nextGuideCue(state, event)`, `setPlayMode(save, mode)`.
- Consumes: v2 `playMode`, `milestones`, `entities`, and `discoveries`.

- [ ] **Step 1: Write failing mode tests**

```js
test('A and B share the same world object graph', () => {
  const save = migrateSaveV2({ entities: [{ id: 'fire-1', type: 'campfire' }] });
  const free = setPlayMode(save, 'free');
  assert.equal(free.playMode, 'free');
  assert.deepEqual(free.entities, save.entities);
  assert.equal(nextGuideCue(createGuideState(free), { type: 'tick' }), null);
});
```

- [ ] **Step 2: Verify failure**

Run `node --test tests/survival_diary_play_mode.test.js`.

Expected: FAIL because `play-mode.js` is missing.

- [ ] **Step 3: Implement immutable mode switching and continuous cues**

```js
const GUIDE_STEPS = [
  'observe_shore', 'find_water', 'find_food', 'craft_stone_axe',
  'place_campfire', 'place_shelter', 'place_workbench', 'discover_inland',
];

function setPlayMode(save, mode) {
  if (!['guided', 'free'].includes(mode)) throw new TypeError('invalid play mode');
  return { ...structuredClone(save), playMode: mode };
}
```

Guide progress is derived from facts and entities; it must never remove recipes, block movement, or overwrite the active save.

- [ ] **Step 4: Bind the pause-menu switch and first-run copy**

Use “引导模式 A” and “自由模式 B”; show “切换不会重置世界或日记”. The first login/local install path calls `setPlayMode(save, 'guided')` only when no saved preference exists.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/survival_diary_play_mode.test.js tests/survival_diary_web.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add website/survival-diary.zhengzhengstudio.cn tests/survival_diary_play_mode.test.js
git commit -m "feat: add shared A and B play modes"
```

### Task 3: Add Day/Night, Weather, Terrain Effects, and Survival Rules

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/environment.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Create: `tests/survival_diary_environment.test.js`

**Interfaces:**
- Produces: `environmentAt(world, position)`, `advanceEnvironment(world, minutes)`, and `applyExposure(player, environment, minutes)`.

- [ ] **Step 1: Write failing environment tests**

```js
test('rain fills collectors, wets players, and extinguishes exposed fire', () => {
  const result = advanceEnvironment(rainingWorld, 10);
  assert.ok(result.entities.collector.water > rainingWorld.entities.collector.water);
  assert.ok(result.players.p1.wetness > 0);
  assert.equal(result.entities.openFire.lit, false);
  assert.equal(result.entities.roofedFire.lit, true);
});

test('snow only appears in cold eligible terrain', () => {
  assert.notEqual(environmentAt(tropicalWorld, beach).weather.kind, 'snow');
  assert.ok(['snow', 'blizzard'].includes(environmentAt(coldWorld, summit).weather.kind));
});
```

- [ ] **Step 2: Verify failure**

Run `node --test tests/survival_diary_environment.test.js`.

- [ ] **Step 3: Implement pure environment rules**

```js
function applyExposure(player, env, minutes) {
  const wetness = clamp(player.wetness + env.rainRate * minutes - env.shelterDrying * minutes, 0, 100);
  const temperature = clamp(player.temperature + env.heatDelta * minutes - wetness * 0.002 * minutes, 30, 42);
  return { ...player, wetness, temperature };
}
```

Implement fog visibility, wind, river/sea risk, snow movement cost, roof protection, fire fuel, and lightning protection as deterministic state transitions.

- [ ] **Step 4: Integrate environment rendering inputs**

`game.js` receives `skyColor`, `ambientLight`, `shadowVector`, `precipitation`, `fogDistance`, `surfaceWetness`, and `snowDepth` from `environmentAt`; it does not choose weather independently.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/survival_diary_environment.test.js tests/survival_diary_gameplay.test.js
git add website/survival-diary.zhengzhengstudio.cn/js tests/survival_diary_environment.test.js
git commit -m "feat: add dynamic island environment"
```

### Task 4: Correct Camera Scaling, Rotation, LOD, and Seamless Regions

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Create: `tests/survival_diary_camera.test.js`

**Interfaces:**
- Produces: `worldToScreen(point, camera)`, `screenToWorld(point, camera)`, `cameraMatrix(camera)`, `lodForZoom(zoom)`.

- [ ] **Step 1: Write failing transform tests**

```js
test('actors and buildings use the same reversible transform', () => {
  for (const point of [{ x: 0, y: 0 }, { x: 813, y: -421 }]) {
    const screen = worldToScreen(point, { x: 90, y: 20, zoom: 0.35, rotation: 90 });
    assert.deepEqual(roundPoint(screenToWorld(screen, camera)), point);
  }
});

test('quest labels stay legible without changing actor world scale', () => {
  assert.equal(lodForZoom(0.35).actorScale, 0.35);
  assert.equal(lodForZoom(0.35).questPresentation, 'screen-marker');
});
```

- [ ] **Step 2: Verify failure**

Run `node --test tests/survival_diary_camera.test.js`.

- [ ] **Step 3: Replace clamped actor sizing with one camera matrix**

Remove patterns equivalent to `Math.max(72, ...)`. Apply the same matrix to terrain, actors, entities, shadows, hit tests, and placement previews. Support 0°, 90°, 180°, and 270° rotations.

- [ ] **Step 4: Add region streaming and LOD**

Generate/load regions intersecting the expanded camera viewport. Keep modified regions in save storage; unload only render resources. LOD may reduce animation frames and vegetation density, but cannot remove interactive markers.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/survival_diary_camera.test.js tests/survival_diary_web.test.js
git add website/survival-diary.zhengzhengstudio.cn tests/survival_diary_camera.test.js
git commit -m "fix: unify Survival Diary camera transforms"
```

### Task 5: Complete Craft, Placement, Diary, and Open-Ended Loop

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/content.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/crafting.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/placement.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/journal.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `tests/survival_diary_gameplay.test.js`

**Interfaces:**
- Produces: atomic `craft`, `place`, `repair`, `upgrade`, `move`, and `dismantle` results with `{ ok, state, event, error }`.

- [ ] **Step 1: Add failing transaction tests**

```js
test('failed placement does not consume materials or create an entity', () => {
  const result = placement.place(state, invalidPreview);
  assert.equal(result.ok, false);
  assert.deepEqual(result.state.inventory, state.inventory);
  assert.deepEqual(result.state.entities, state.entities);
});

test('free mode can continue after every milestone', () => {
  const finished = completeAllMilestones(createWorld('open', { playMode: 'free' }));
  assert.equal('ending' in finished, false);
  assert.ok(stepWorld(finished, { type: 'discover_region', coordinates: { x: 999, y: -999 } }));
});
```

- [ ] **Step 2: Verify failure, implement transactions, and preserve factual diary entries**

All mutation functions deep-clone, validate, and commit inventory/entity changes together. Diary facts describe actual events and never invent feelings.

- [ ] **Step 3: Add build preview and entity interactions**

Preview exposes `{ valid, reason, transform, snapTarget }`; confirmation consumes materials once. Storage, fire, collector, workbench, fish rack, garden, wall, and shelter retain individual persistent state.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/survival_diary_gameplay.test.js tests/survival_diary_contracts_v2.test.js
git add website/survival-diary.zhengzhengstudio.cn/js tests/survival_diary_gameplay.test.js
git commit -m "feat: complete open survival loop"
```

### Task 6: Replace Placeholder Art and Finish Responsive HUD

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/tools-v3.webp`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/terrain-v3.webp`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/actors-v3.webp`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/weather-v3.webp`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/buildings-v3.webp`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/atlas/atlas-v3.json`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Create: `tests/survival_diary_visual_contract.test.js`

**Interfaces:**
- `atlas-v3.json` maps each sprite ID to `{ atlas, x, y, width, height, pivotX, pivotY, directions, states }`.

- [ ] **Step 1: Write failing visual asset tests**

```js
test('world inventory uses raster atlas entries instead of svg or emoji', () => {
  const atlas = readJson('assets/art/atlas/atlas-v3.json');
  for (const id of requiredToolAndWorldIds) assert.ok(atlas[id]);
  assert.doesNotMatch(read('js/game.js'), /\\.svg|[🪓🔥🏠🌴]/u);
});
```

- [ ] **Step 2: Generate the five atlas masters**

Use the image-generation skill with this exact direction: “cohesive premium 2.5D island survival game atlas, upper-left warm key light, transparent isolated objects, grounded soft shadows, hand-painted material detail, no text, no icons from existing games, four camera directions, dry/wet/snow/damaged variants where applicable.”

- [ ] **Step 3: Slice and validate deterministic atlas metadata**

Create `scripts/build_survival_diary_atlas.mjs` to crop named cells, convert to WebP, reject opaque borders and magenta key pixels, and emit `atlas-v3.json`.

- [ ] **Step 4: Implement adaptive HUD and diary pages**

At 390×844, use safe areas, 44-point controls, left movement, right actions, bottom quickbar, and a full-screen diary. At desktop widths, use keyboard shortcuts and side panels. Keep A/B switch in the pause menu.

- [ ] **Step 5: Run visual contracts and browser acceptance**

```bash
node --test tests/survival_diary_visual_contract.test.js tests/survival_diary_web.test.js
```

Expected: no final SVG/emoji world assets, all atlas entries exist, and mobile layout contracts pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_survival_diary_atlas.mjs website/survival-diary.zhengzhengstudio.cn tests/survival_diary_visual_contract.test.js
git commit -m "feat: add production Survival Diary art and HUD"
```

### Task 7: Web Save Upgrade and End-to-End Acceptance

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/save-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/sw.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/manifest.webmanifest`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/update-push.js`
- Create: `tests/survival_diary_web_acceptance.test.js`

**Interfaces:**
- Produces: `loadSlot(slot)`, `saveSlotAtomic(slot, save)`, `backupLegacySave(raw)`, and `activateBuild(build)`.

- [ ] **Step 1: Write failing migration and cache tests**

Verify v1 backup, v2 atomic save, build-3 cache namespace, current-day flush before activation, and recovery from an interrupted write.

- [ ] **Step 2: Implement two-phase save and service-worker activation**

Write `slot.pending`, validate it, promote to `slot.current`, then keep `slot.previous`. Service Worker sends `UPDATE_READY`; the UI flushes save and replies `ACTIVATE_BUILD`.

- [ ] **Step 3: Register Web Push update notifications**

`update-push.js` registers the service-worker push subscription only after the player opts in, sends it to `POST /push/subscriptions`, and handles `{ type: "release", version: "0.3.0", build: 3 }` by re-reading the signed manifest before showing the update action. Push payload URLs are never trusted directly.

- [ ] **Step 4: Run the complete Web suite**

```bash
node --test tests/survival_diary_contracts_v2.test.js tests/survival_diary_play_mode.test.js tests/survival_diary_environment.test.js tests/survival_diary_camera.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_visual_contract.test.js tests/survival_diary_web_acceptance.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/survival-diary.zhengzhengstudio.cn tests/survival_diary_web_acceptance.test.js
git commit -m "feat: finish Survival Diary Web v0.3"
```
