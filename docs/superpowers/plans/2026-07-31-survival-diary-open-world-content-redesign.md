# Survival Diary Open World and Content Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty, repetitive Survival Diary clients with one deterministic open-world survival game shared by Web, Android, iOS, macOS, HarmonyOS online, and HarmonyOS offline.

**Architecture:** `apps/SurvivalDiaryShared` is the source of truth for content, schemas, deterministic fixtures, and the JavaScript reference simulation. Each native client implements the same typed interfaces and proves parity against the fixtures; public multiplayer state is server-authoritative. Rendering and input stay platform-native, while release metadata is generated once and mirrored to every download-center source.

**Tech Stack:** JavaScript/Node test runner, HTML Canvas/WebGL, Kotlin/Compose/Android Canvas, SwiftUI/SpriteKit/Swift Package Manager, ArkTS/ArkUI Canvas/Hvigor, Node HTTP/WebSocket service, JSON Schema.

## Global Constraints

- Work in `codex/survival-diary-native`; preserve the existing uncommitted 0.3.1 Android rendering fix before starting new work.
- No WebView, WKWebView, ArkWeb, SVG world props, emoji world props, or line-art placeholders in a formal package.
- The first formal content catalog contains at least 72 usable items and 60 valid recipes.
- One full day lasts 30 real minutes: 18 minutes daylight, 6 minutes combined dawn/dusk, and 6 minutes night.
- Gameplay camera shows at most 2–3 active regions; wider discovered information belongs in the map screen.
- Status values are persistent and live; health starts at 100 and no formal HUD value may be a fixed zero placeholder.
- Public-island night skip requires every online non-spectator player to occupy a bed for a five-second countdown.
- HarmonyOS online and offline keep the existing old icon artwork; only deterministic market-size exports are allowed.
- Formal artifacts go to `website/api/apps`; manifest, client downloads, public mirrors, and changelogs update atomically.
- Any non-sensitive `website` product change updates `website/api/data/changelogs.json` and its public mirror.
- Image generation starts only after the content and action manifests pass validation.

---

## File Structure

### Shared source of truth

- `apps/SurvivalDiaryShared/content/items.json`: at least 72 items with mass, stack, category, image key, and use.
- `apps/SurvivalDiaryShared/content/recipes.json`: at least 60 recipes with station, duration, inputs, and outputs.
- `apps/SurvivalDiaryShared/content/resources.json`: harvest nodes, required tools, hardness, yield, and recovery.
- `apps/SurvivalDiaryShared/content/buildings.json`: placeable facilities, collision, durability, interaction, and asset states.
- `apps/SurvivalDiaryShared/content/status-effects.json`: status thresholds, causes, modifiers, and remedies.
- `apps/SurvivalDiaryShared/content/biomes.json`: biome climate and spawn tables.
- `apps/SurvivalDiaryShared/schemas/content.schema.json`: validates all content documents.
- `apps/SurvivalDiaryShared/schemas/save.schema.json`: schema v3 save format.
- `apps/SurvivalDiaryShared/src/hash.js`: cross-platform stable hashing primitives.
- `apps/SurvivalDiaryShared/src/world-generator.js`: deterministic chunks, terrain fields, and resource nodes.
- `apps/SurvivalDiaryShared/src/survival-simulation.js`: clock, actions, weather, status, recovery, crafting, and sleep.
- `apps/SurvivalDiaryShared/src/save-migration.js`: schema v2 to v3 migration.
- `apps/SurvivalDiaryShared/fixtures/open-world-v3.json`: golden cross-platform vectors.

### Web and server

- `website/survival-diary.zhengzhengstudio.cn/js/world.js`: streamed chunk cache and fog of war.
- `website/survival-diary.zhengzhengstudio.cn/js/game.js`: frame clock, player actions, and renderer coordination.
- `website/survival-diary.zhengzhengstudio.cn/js/environment.js`: continuous daylight and weather visuals.
- `website/survival-diary.zhengzhengstudio.cn/js/game-ui.js`: game HUD, contextual action, inventory, map, and chat shell.
- `website/survival-diary.zhengzhengstudio.cn/js/map-screen.js`: discovered-only world map.
- `website/survival-diary.zhengzhengstudio.cn/server/chat-store.js`: channel history and moderation state.
- `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`: authoritative public island state.
- `website/survival-diary.zhengzhengstudio.cn/server/protocol-v3.js`: chat, action, sleep, and chunk messages.

### Native clients

- `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/`: Kotlin v3 world, content, survival, and save migration.
- `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/`: chunk renderer, entity renderer, fog, light, weather, and input.
- `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/`: native game HUD, inventory, crafting, map, diary, and chat.
- `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/`: Swift v3 rules and persistence.
- `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/`: SpriteKit world and camera.
- `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/`: iOS/macOS adaptive game UI.
- `apps/SurvivalDiary-HarmonyOS-Shared/ets/`: ArkTS v3 domain, Canvas, and HUD shared by both editions.
- `apps/SurvivalDiary-HarmonyOS-Online/`: chat, friends, public islands, and tap invites.
- `apps/SurvivalDiary-HarmonyOS-Offline/`: the same local game without network capabilities.

### Assets and release

- `apps/SurvivalDiaryShared/assets/asset-manifest.json`: one required asset key per formal item/action/state.
- `website/survival-diary.zhengzhengstudio.cn/assets/game/`: approved world and UI atlases.
- `scripts/validate_survival_diary_assets.mjs`: rejects missing or placeholder assets.
- `scripts/generate_survival_diary_fixture.mjs`: writes the v3 golden fixture.
- `scripts/build_survival_diary_release.sh`: builds, signs, validates, and stages formal artifacts.
- `scripts/generate_survival_diary_release_metadata.mjs`: generates all manifests and download entries.

---

### Task 1: Preserve the 0.3.1 Baseline and Reconcile Native Sources

**Files:**
- Modify: `apps/SurvivalDiary-Android/`
- Create: `apps/SurvivalDiary-Apple/` from the verified native branch content
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/`
- Test: `tests/survival_diary_native_clients.test.js`

**Interfaces:**
- Consumes: current 0.3.1 Android source and existing native Apple/Harmony commits.
- Produces: one branch containing every native source tree and a green baseline test suite.

- [ ] **Step 1: Write the native-source baseline test**

```js
test('every formal client is native and present', () => {
  for (const dir of [
    'apps/SurvivalDiary-Android',
    'apps/SurvivalDiary-Apple',
    'apps/SurvivalDiary-HarmonyOS-Online',
    'apps/SurvivalDiary-HarmonyOS-Offline',
  ]) assert.ok(fs.existsSync(dir), dir);
  const source = readTrees(formalClientDirs);
  assert.doesNotMatch(source, /WebView|WKWebView|ArkWeb|android\.webkit|import WebKit/);
});
```

- [ ] **Step 2: Run the baseline test and record the missing trees**

Run: `node --test tests/survival_diary_native_clients.test.js`

Expected: FAIL on the branch where Apple or Harmony source is absent.

- [ ] **Step 3: Reconcile verified sources without overwriting the Android 0.3.1 fix**

Bring the already-reviewed Apple and Harmony native trees from commits `8d7302a` and `74d4d7c` into the implementation branch. Keep the current Android `TerrainLayout`, `PlayerMotion`, formal signing configuration, and 0.3.1 metadata. Resolve only Survival Diary paths.

- [ ] **Step 4: Run the complete baseline**

Run:

```bash
node --test tests/survival_diary_*.test.js
cd apps/SurvivalDiary-Android && ./gradlew testWebsiteDebugUnitTest
cd ../SurvivalDiary-Apple && swift test
```

Expected: all pre-v3 tests pass; unavailable Harmony tooling is reported as a skipped build, not as a successful signed package.

- [ ] **Step 5: Commit the reconciled baseline**

```bash
git add apps/SurvivalDiary-* tests/survival_diary_native_clients.test.js
git commit -m "chore: reconcile Survival Diary native baseline"
```

### Task 2: Build the Validated Content Catalog

**Files:**
- Modify: `apps/SurvivalDiaryShared/content/items.json`
- Modify: `apps/SurvivalDiaryShared/content/recipes.json`
- Create: `apps/SurvivalDiaryShared/content/resources.json`
- Create: `apps/SurvivalDiaryShared/content/buildings.json`
- Create: `apps/SurvivalDiaryShared/content/status-effects.json`
- Create: `apps/SurvivalDiaryShared/schemas/content.schema.json`
- Create: `tests/survival_diary_content_v3.test.js`

**Interfaces:**
- Produces: `ContentCatalog` keyed by stable kebab-case IDs.
- Item shape: `{id,name,category,stackLimit,mass,imageKey,use}`.
- Recipe shape: `{id,station,durationSeconds,ingredients,output,discoverBy}`.
- Resource shape: `{id,itemId,hardness,toolTags,yield,recoveryMinutes,states}`.

- [ ] **Step 1: Write failing catalog tests**

```js
assert.ok(items.length >= 72);
assert.ok(recipes.length >= 60);
for (const item of items) {
  assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(item.mass >= 0);
  assert.ok(item.imageKey);
}
for (const recipe of recipes) {
  assert.ok(itemsById.has(recipe.output.itemId));
  for (const id of Object.keys(recipe.ingredients)) assert.ok(itemsById.has(id));
}
```

- [ ] **Step 2: Run the tests to prove the current 9-item/3-recipe catalog fails**

Run: `node --test tests/survival_diary_content_v3.test.js`

Expected: FAIL with item and recipe count assertions.

- [ ] **Step 3: Add the formal item set**

The catalog must include these stable IDs, plus any additional supporting items needed to reach the validated recipe chains:

```text
driftwood branch softwood-log hardwood-log bamboo palm-fiber vine resin latex clay sand shell
coral-fragment leaf dry-grass charcoal stone flint coal copper-ore tin-ore iron-ore salt sulfur quartz
coconut berry mushroom herb seaweed reef-fish crab clam fresh-water boiled-water grilled-fish crab-meal
fruit-bowl dried-fish salted-fish bandage antiseptic fever-tonic stone-axe stone-pickaxe copper-pickaxe
iron-pickaxe machete hammer shovel fishing-rod torch waterskin small-backpack frame-backpack raincoat
warm-coat splint repair-kit campfire straw-mat hammock simple-bed camp-bed wooden-bed shelter workbench
furnace storage-crate rain-collector fish-rack garden-plot palisade dock rope-bridge lantern-post
cooking-pot drying-shed medicine-table
```

Every non-raw item must be consumed by an interaction or produced by at least one recipe. Every formal building must reference a building definition and all of its asset states.

- [ ] **Step 4: Add at least 60 concrete recipes**

Recipe groups must cover:

```text
10 hand recipes, 12 workbench recipes, 8 furnace recipes, 8 cooking recipes,
6 drying/preservation recipes, 6 medicine recipes, 5 bed/shelter recipes,
and 5 infrastructure recipes
```

The group counts total 60. Ingredients use only catalog IDs; station IDs are `hand`, `workbench`, `furnace`, `cooking-pot`, `drying-shed`, or `medicine-table`.

- [ ] **Step 5: Implement schema validation and run tests**

Run: `node --test tests/survival_diary_content_v3.test.js tests/survival_diary_contracts.test.js`

Expected: PASS with at least 72 items, 60 recipes, no dangling references, and no duplicate IDs.

- [ ] **Step 6: Commit the catalog**

```bash
git add apps/SurvivalDiaryShared/content apps/SurvivalDiaryShared/schemas/content.schema.json tests/survival_diary_content_v3.test.js
git commit -m "feat: add Survival Diary open-world content catalog"
```

### Task 3: Implement Deterministic Chunks, Terrain, Resources, and Fog

**Files:**
- Create: `apps/SurvivalDiaryShared/src/hash.js`
- Create: `apps/SurvivalDiaryShared/src/world-generator.js`
- Modify: `apps/SurvivalDiaryShared/content/biomes.json`
- Create: `scripts/generate_survival_diary_fixture.mjs`
- Create: `apps/SurvivalDiaryShared/fixtures/open-world-v3.json`
- Create: `tests/survival_diary_world_v3.test.js`

**Interfaces:**
- `generateChunk(seed: string, chunkX: number, chunkY: number): WorldChunk`
- `sampleTerrain(seed: string, worldX: number, worldY: number): TerrainSample`
- `visibleChunks(bounds: Bounds, margin: number): ChunkCoordinate[]`
- `discover(save: SaveV3, chunk: ChunkCoordinate): SaveV3`

```ts
interface WorldChunk {
  id: string;
  coordinate: { x: number; y: number };
  height: number[];
  moisture: number[];
  temperature: number[];
  biome: string[];
  resources: ResourceNode[];
  landmarks: Landmark[];
}
```

- [ ] **Step 1: Write failing continuity and determinism tests**

```js
const a = generateChunk('island-7', 4, -2);
assert.deepEqual(a, generateChunk('island-7', 4, -2));
assert.deepEqual(a.edges.east, generateChunk('island-7', 5, -2).edges.west);
assert.notDeepEqual(chunkSignature(a), chunkSignature(generateChunk('island-7', 7, -2)));
assert.equal(unknownMapCell(save, 99, 99).visibility, 'hidden');
```

- [ ] **Step 2: Run the test and verify the repeated-atlas implementation fails**

Run: `node --test tests/survival_diary_world_v3.test.js`

Expected: FAIL because `generateChunk` and fog state do not exist.

- [ ] **Step 3: Implement coordinate-stable noise and chunk generation**

Derive every field from `(seed, absoluteSampleX, absoluteSampleY, channel)` so adjacent chunks share border samples. Place resources from biome spawn tables and stable per-cell hashes; never select one whole terrain bitmap as a chunk.

- [ ] **Step 4: Generate golden fixtures**

The fixture contains chunk signatures for `(0,0)`, `(1,0)`, `(-3,7)`, edge continuity, 20 resource nodes, and discovered-map output for seed `open-world-20260731`.

Run: `node scripts/generate_survival_diary_fixture.mjs --write`

- [ ] **Step 5: Run world tests**

Run: `node --test tests/survival_diary_world_v3.test.js`

Expected: PASS for determinism, edge continuity, non-repetition, biome transitions, and fog.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiaryShared scripts/generate_survival_diary_fixture.mjs tests/survival_diary_world_v3.test.js
git commit -m "feat: generate deterministic Survival Diary chunks"
```

### Task 4: Implement the 30-Minute Clock, Weather, Status, and Recovery

**Files:**
- Create: `apps/SurvivalDiaryShared/src/survival-simulation.js`
- Modify: `apps/SurvivalDiaryShared/schemas/save.schema.json`
- Create: `tests/survival_diary_status_v3.test.js`
- Create: `tests/survival_diary_environment_v3.test.js`

**Interfaces:**
- `advance(state: SaveV3, elapsedMs: number, context: ActivityContext): SaveV3`
- `applyAction(state: SaveV3, action: SurvivalAction): SaveV3`
- `recoveryReasons(state: SaveV3, environment: Environment): RecoveryReason[]`
- `dayPhase(minute: number): "dawn"|"day"|"dusk"|"night"`

```ts
interface Vitals {
  health: number; stamina: number; hunger: number; hydration: number;
  bodyTemperature: number; carriedMass: number;
  effects: StatusEffectInstance[];
}
```

- [ ] **Step 1: Write failing clock and vitals tests**

```js
const start = createSaveV3('clock');
assert.equal(start.vitals.health, 100);
assert.ok(start.vitals.stamina > 0);
assert.equal(advance(start, 30 * 60 * 1000, idle).day, start.day + 1);
assert.ok(advance(start, 10_000, mining).vitals.stamina < start.vitals.stamina);
assert.ok(recoveryReasons(bleeding, dryBed).some(x => x.code === 'untreated-bleeding'));
```

- [ ] **Step 2: Run tests and verify fixed-zero state fails**

Run: `node --test tests/survival_diary_status_v3.test.js tests/survival_diary_environment_v3.test.js`

Expected: FAIL because v3 vitals and a real-time clock do not exist.

- [ ] **Step 3: Implement exact time scaling**

Map 1,800,000 real milliseconds to 1,440 game minutes. Define phases as dawn `300..<390`, day `390..<1260`, dusk `1260..<1350`, and night otherwise. Sleep advances to minute 390 of the next applicable day.

- [ ] **Step 4: Implement state relationships**

Mining, running, swimming, temperature, wetness, salt intake, carried mass, shelter, fire, food, water, bandage, medicine, and bed quality update vitals through named modifiers. Health regeneration is zero while bleeding, infected, dehydrated, starving, hypothermic, hyperthermic, or unsafe; recovery reasons are stable codes displayed by every UI.

- [ ] **Step 5: Run status and environment tests**

Run: `node --test tests/survival_diary_status_v3.test.js tests/survival_diary_environment_v3.test.js`

Expected: PASS with changing non-zero vitals, 30-minute days, continuous phases, and conditional health recovery.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiaryShared/src/survival-simulation.js apps/SurvivalDiaryShared/schemas/save.schema.json tests/survival_diary_*_v3.test.js
git commit -m "feat: add live Survival Diary environment and vitals"
```

### Task 5: Implement Harvesting, Crafting, Placement, Beds, and Save Migration

**Files:**
- Modify: `apps/SurvivalDiaryShared/src/survival-simulation.js`
- Create: `apps/SurvivalDiaryShared/src/save-migration.js`
- Modify: `apps/SurvivalDiaryShared/schemas/save.schema.json`
- Create: `tests/survival_diary_actions_v3.test.js`
- Create: `tests/survival_diary_save_v3.test.js`

**Interfaces:**
- `harvest(state, nodeId, toolItemId, elapsedMs): ActionResult`
- `craft(state, recipeId, count): ActionResult`
- `place(state, itemId, transform): ActionResult`
- `beginSleep(state, playerId, bedId): ActionResult`
- `migrateSave(input: unknown): SaveV3`

- [ ] **Step 1: Write failing action and migration tests**

```js
assert.equal(harvest(save, ironNode.id, 'stone-pickaxe', 1000).error, 'tool-tier-too-low');
assert.equal(craft(saveWithInputs, 'craft-stone-axe', 1).state.inventory['stone-axe'], 1);
assert.equal(place(saveWithBed, 'straw-mat', transform).state.entities[bedId].type, 'straw-mat');
assert.deepEqual(migrateSave(v2Save).journals, v2Save.journals);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/survival_diary_actions_v3.test.js tests/survival_diary_save_v3.test.js`

Expected: FAIL on missing v3 action functions.

- [ ] **Step 3: Implement transactional actions**

Validate distance, permission, tool tag/tier, stamina, inventory, collision, slope, water depth, and station before cloning and committing state. Failed actions return `{ok:false,error,details,state:originalState}` and never consume items.

- [ ] **Step 4: Implement v2-to-v3 migration**

Back up the original JSON, preserve seed, inventory, entities, journals, play mode, day, and time, then add v3 chunk changes, discovered chunks, vitals, effects, mass, and sleep state with safe defaults.

- [ ] **Step 5: Run tests**

Run: `node --test tests/survival_diary_actions_v3.test.js tests/survival_diary_save_v3.test.js`

Expected: PASS for tool restrictions, atomic crafting, real placement, beds, and lossless migration.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiaryShared tests/survival_diary_actions_v3.test.js tests/survival_diary_save_v3.test.js
git commit -m "feat: add Survival Diary actions and v3 saves"
```

### Task 6: Lock and Validate Complete Raster Assets

**Files:**
- Create: `apps/SurvivalDiaryShared/assets/asset-manifest.json`
- Create: `scripts/validate_survival_diary_assets.mjs`
- Create: `tests/survival_diary_assets_v3.test.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/game/`
- Modify: native platform resource catalogs

**Interfaces:**
- `asset-manifest.json` maps every `imageKey` to icon, world, held, action, damaged, depleted, wet, and snow variants when applicable.
- Validator output: `{valid:boolean, missing:string[], placeholders:string[], invalidDimensions:string[]}`.

- [ ] **Step 1: Write the failing asset contract**

```js
for (const item of formalItems) assert.ok(manifest[item.imageKey], item.id);
for (const building of buildings) {
  for (const state of ['icon','world','working','damaged']) assert.ok(manifest[building.imageKey][state]);
}
assert.doesNotMatch(formalAssetSource, /\.svg|emoji|placeholder|wireframe/i);
```

- [ ] **Step 2: Run the contract**

Run: `node --test tests/survival_diary_assets_v3.test.js`

Expected: FAIL with missing image keys. Do not generate images before this exact manifest is locked.

- [ ] **Step 3: Generate and curate raster masters**

Use the built-in image generation workflow one asset family at a time after the manifest is green structurally: resources/minerals, tools/held actions, food/medicine, buildings/beds, status/environment. Save approved masters in the workspace, remove backgrounds, inspect alpha edges, then export deterministic platform atlases.

- [ ] **Step 4: Preserve the Harmony old icon**

Copy the existing verified Harmony icon bytes into every required online/offline icon size. The validator records its SHA-256 and fails if a later export changes the artwork.

- [ ] **Step 5: Run visual asset validation**

Run: `node scripts/validate_survival_diary_assets.mjs && node --test tests/survival_diary_assets_v3.test.js`

Expected: PASS with no missing, vector, emoji, line-art, or placeholder formal assets.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiaryShared/assets website/survival-diary.zhengzhengstudio.cn/assets/game apps/SurvivalDiary-* scripts/validate_survival_diary_assets.mjs tests/survival_diary_assets_v3.test.js
git commit -m "feat: add complete Survival Diary raster assets"
```

### Task 7: Upgrade the Authoritative Server, Chat, Permissions, and Group Sleep

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/protocol-v3.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/chat-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/chat-v3.test.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/group-sleep-v3.test.js`

**Interfaces:**
- Channels: `nearby`, `island`, `party`, `direct`.
- `postMessage(actor, channel, payload): ChatMessage`
- `requestSleep(worldId, playerId, bedId): SleepSnapshot`
- `commitWorldAction(actor, eventId, action): WorldEvent`

- [ ] **Step 1: Write failing chat and group-sleep tests**

```js
assert.equal(postMessage(visitor, 'island', text).channel, 'island');
assert.throws(() => postMessage(blocked, 'direct', text), /blocked/);
assert.equal(requestSleep(world, 'p1', 'bed-1').ready, false);
assert.equal(requestSleep(world, 'p2', 'bed-2').countdownSeconds, 5);
```

- [ ] **Step 2: Run tests**

Run: `cd website/survival-diary.zhengzhengstudio.cn/server && node --test test/chat-v3.test.js test/group-sleep-v3.test.js`

Expected: FAIL because protocol v3 chat and sleep are absent.

- [ ] **Step 3: Implement server-authoritative actions and moderation**

Validate event IDs, actor permissions, island membership, inventory versions, resource versions, muted/blocked relationships, and channel scope. Store bounded recent history per channel; direct messages never enter public diary facts.

- [ ] **Step 4: Implement group sleep**

Count connected, non-spectator players present when the countdown begins. Cancel on wake; ignore disconnects and later joins. At completion, advance the public world to minute 390 and apply bed recovery to sleepers.

- [ ] **Step 5: Run the complete server suite**

Run: `cd website/survival-diary.zhengzhengstudio.cn/server && node --test`

Expected: PASS for old authentication/friend tests and new chat/sleep behavior.

- [ ] **Step 6: Commit**

```bash
git add website/survival-diary.zhengzhengstudio.cn/server
git commit -m "feat: add Survival Diary public chat and group sleep"
```

### Task 8: Rebuild the Web World and Game UI

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/environment.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/game-ui.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/map-screen.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Create: `tests/survival_diary_web_v3.test.js`

**Interfaces:**
- Web imports shared content and fixture-compatible world rules.
- `GameUI.render(GameViewState)` shows live vitals, eight slots, contextual action, map, inventory, crafting, diary, and online chat.

- [ ] **Step 1: Write failing Web contracts**

```js
assert.match(html, /data-ui="vitals"/);
assert.match(html, /data-ui="hotbar"/);
assert.match(html, /data-ui="context-action"/);
assert.match(html, /data-ui="map-screen"/);
assert.doesNotMatch(html + css, /Material|marketing-card|placeholder/);
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/survival_diary_web_v3.test.js`

Expected: FAIL on missing game UI and map screen.

- [ ] **Step 3: Replace repeated atlas terrain with chunk layers**

Render terrain mesh, vegetation, geology, resource nodes, entities, fog, weather, and light separately. Stream only the camera margin and unload distant visual nodes while retaining save deltas.

- [ ] **Step 4: Add live clock and adaptive game HUD**

Feed frame elapsed time to the simulation. Keep vitals visible and changing; show exact recovery blocker text on selection. Use joystick/context action on touch, pointer/keyboard on desktop, and an eight-slot hotbar on all layouts.

- [ ] **Step 5: Add discovered-only map and online chat**

The map can zoom wider than gameplay but reads only discovered chunks. Chat is collapsed on phones and a retractable side panel on desktop; location cards create temporary markers.

- [ ] **Step 6: Run Web and server tests**

Run: `node --test tests/survival_diary_web*.test.js && cd website/survival-diary.zhengzhengstudio.cn/server && node --test`

Expected: PASS.

- [ ] **Step 7: Update changelog and commit**

Add a dated, user-facing v3 Web entry to private and public changelog sources.

```bash
git add website/survival-diary.zhengzhengstudio.cn website/api/data/changelogs.json website/zhengzhengstudio.cn/api/changelogs.json tests/survival_diary_web_v3.test.js
git commit -m "feat: rebuild Survival Diary Web gameplay"
```

### Task 9: Rebuild the Android Native Client

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/WorldGenerator.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/SurvivalSimulation.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/ContentCatalog.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/NativeGameView.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/ChunkRenderer.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/LightWeatherRenderer.kt`
- Replace: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/InventoryScreen.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/CraftingScreen.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/MapScreen.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/ChatPanel.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/OpenWorldParityTest.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/StatusClockTest.kt`

**Interfaces:**
- Kotlin functions and data classes mirror Task 3–5 signatures and fixture JSON.
- `NativeGameView` receives immutable `GameViewState`; it does not invent inventory or time.

- [ ] **Step 1: Write failing Kotlin parity and clock tests**

```kotlin
assertEquals(fixture.chunkDigest, WorldGenerator.generate(seed, 0, 0).stableDigest())
assertEquals(2, SurvivalSimulation.advance(save, 1_800_000, Activity.Idle).day)
assertTrue(mining.vitals.stamina < save.vitals.stamina)
```

- [ ] **Step 2: Run tests**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testWebsiteDebugUnitTest`

Expected: FAIL on missing v3 Kotlin types.

- [ ] **Step 3: Implement Kotlin v3 parity and migration**

Load validated JSON content from generated raw resources. Implement fixture-compatible hash, chunks, actions, vitals, clock, save migration, and recovery reasons.

- [ ] **Step 4: Replace the renderer and HUD**

Remove full-atlas tile drawing. Render generated terrain/resource/entity layers, discovered fog, continuous light, weather, formal sprites, and bed states. Replace fixed gather/campfire buttons with live vitals, hotbar, contextual action, inventory, crafting, map, diary, and collapsible chat.

- [ ] **Step 5: Run Android tests and debug build**

Run:

```bash
cd apps/SurvivalDiary-Android
./gradlew testWebsiteDebugUnitTest assembleWebsiteDebug
```

Expected: PASS; the APK contains no WebView and no formal placeholder assets.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiary-Android
git commit -m "feat: rebuild Survival Diary Android gameplay"
```

### Task 10: Rebuild iOS and macOS Native Clients

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/WorldGenerator.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/SurvivalSimulation.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/ContentCatalog.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/GameSave.swift`
- Replace: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/IslandScene.swift`
- Replace: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameHUD.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/InventoryView.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/MapView.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/ChatView.swift`
- Test: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryCoreTests/OpenWorldV3Tests.swift`

**Interfaces:**
- Swift core decodes the same content and golden fixture.
- SpriteKit scene receives `GameViewState` from `GameStore`; iOS/macOS UI never mutates the world directly.

- [ ] **Step 1: Write failing Swift parity tests**

```swift
XCTAssertEqual(WorldGenerator.chunk(seed: seed, x: 0, y: 0).digest, fixture.chunkDigest)
XCTAssertEqual(SurvivalSimulation.advance(save, milliseconds: 1_800_000, activity: .idle).day, 2)
```

- [ ] **Step 2: Run tests**

Run: `cd apps/SurvivalDiary-Apple && swift test`

Expected: FAIL on missing v3 Swift core.

- [ ] **Step 3: Implement Swift parity and SpriteKit world**

Implement deterministic chunks, streamed nodes, fog, light/weather shaders or overlays, formal resource sprites, live actions, and v2 migration.

- [ ] **Step 4: Implement adaptive iOS/macOS game UI**

iOS uses safe-area joystick/context action and collapsible panels. macOS uses keyboard/mouse, resizable windows, expanded inventory/map/chat, and the same game-state interfaces.

- [ ] **Step 5: Run tests and unsigned development builds**

Run:

```bash
cd apps/SurvivalDiary-Apple
swift test
./scripts/build_ios.sh
./scripts/build_macos.sh
```

Expected: tests pass; scripts clearly report whether signing identities are available and never label unsigned output formal.

- [ ] **Step 6: Commit**

```bash
git add apps/SurvivalDiary-Apple
git commit -m "feat: rebuild Survival Diary Apple gameplay"
```

### Task 11: Rebuild HarmonyOS Online and Offline Clients

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/domain/WorldGenerator.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/domain/SurvivalSimulation.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Shared/ets/model/GameSave.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/game/ChunkRenderer.ets`
- Replace: `apps/SurvivalDiary-HarmonyOS-Shared/ets/game/GameCanvas.ets`
- Replace: `apps/SurvivalDiary-HarmonyOS-Shared/ets/ui/GameHud.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/ui/InventoryPanel.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/ui/MapPanel.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/ui/ChatPanel.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/TapFriendService.ets`
- Test: online/offline `entry/src/test/OpenWorldV3.test.ets`

**Interfaces:**
- Shared ArkTS matches the v3 fixture.
- Online edition exposes `NetworkCapabilities = {chat:true,friends:true,tap:true}`.
- Offline edition exposes `NetworkCapabilities = {chat:false,friends:false,tap:false}` and declares no network permission.

- [ ] **Step 1: Write failing parity and capability tests**

```ts
expect(WorldGenerator.chunk(seed, 0, 0).digest).assertEqual(fixture.chunkDigest);
expect(OfflineCapabilities.chat).assertFalse();
expect(OnlineCapabilities.tap).assertTrue();
```

- [ ] **Step 2: Run the available Harmony and Node contract tests**

Run: `node --test tests/survival_diary_harmony_*.test.js`

Expected: FAIL on v3 parity and new UI contracts.

- [ ] **Step 3: Implement and sync ArkTS shared core**

Use `scripts/sync_survival_diary_harmony_shared.mjs` to copy reviewed shared ArkTS files into both edition projects. Render generated chunks and formal raster states; do not use `world_atlas.png` as repeating terrain.

- [ ] **Step 4: Implement online-only chat, permissions, and tap cards**

Tap sends one-use friend or eligible island invitation data, then creates a visible chat card after recipient confirmation. Offline source and permissions must contain none of these symbols.

- [ ] **Step 5: Preserve and validate the old icon**

Keep the old icon image bytes in AppScope and entry resources for both editions; export required sizes without redesign.

- [ ] **Step 6: Run tests and builds**

Run:

```bash
node --test tests/survival_diary_harmony_*.test.js
cd apps/SurvivalDiary-HarmonyOS-Online && hvigorw test && hvigorw assembleHap --mode module -p product=default
cd ../SurvivalDiary-HarmonyOS-Offline && hvigorw test && hvigorw assembleHap --mode module -p product=default
```

Expected: tests pass; missing SDK or signing material is reported honestly.

- [ ] **Step 7: Commit**

```bash
git add apps/SurvivalDiary-HarmonyOS-* scripts/sync_survival_diary_harmony_shared.mjs tests/survival_diary_harmony_*.test.js
git commit -m "feat: rebuild Survival Diary Harmony gameplay"
```

### Task 12: Cross-Platform Parity, Performance, and Long-Session Validation

**Files:**
- Create: `tests/survival_diary_open_world_parity.test.js`
- Create: `tests/survival_diary_long_session.test.js`
- Modify: platform parity tests

**Interfaces:**
- Every platform exports fixture digests for chunks, actions, vitals, sleep, and save migration.

- [ ] **Step 1: Add failing cross-platform digest assertions**

```js
assert.deepEqual(androidDigests, referenceDigests);
assert.deepEqual(swiftDigests, referenceDigests);
assert.deepEqual(arkDigests, referenceDigests);
```

- [ ] **Step 2: Run parity tests**

Run: `node --test tests/survival_diary_open_world_parity.test.js`

Expected: FAIL until each client exports matching v3 digests.

- [ ] **Step 3: Add the 10,000-chunk/24-hour simulation test**

The test walks a deterministic route, streams chunks with a bounded visual cache, advances one game month, harvests/crafts/places repeatedly, reconnects public actions, and asserts stable memory-state counts, no duplicate event IDs, and deterministic final digest.

- [ ] **Step 4: Run all automated suites**

Run:

```bash
node --test tests/survival_diary_*.test.js
cd apps/SurvivalDiary-Android && ./gradlew testWebsiteDebugUnitTest
cd ../SurvivalDiary-Apple && swift test
cd ../../website/survival-diary.zhengzhengstudio.cn/server && node --test
```

Expected: zero failures; platform builds unavailable on the machine remain explicit skips outside formal-release status.

- [ ] **Step 5: Commit**

```bash
git add tests apps/SurvivalDiary-* website/survival-diary.zhengzhengstudio.cn
git commit -m "test: verify Survival Diary open-world parity"
```

### Task 13: Formal Versioning, Signed Packages, Download Center, and Changelogs

**Files:**
- Modify: `release/survival-diary/<new-version>/release.json`
- Modify: `scripts/build_survival_diary_release.sh`
- Modify: `scripts/generate_survival_diary_release_metadata.mjs`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: public mirrors
- Modify: private/public changelogs
- Test: `tests/survival_diary_publish_contract.test.js`

**Interfaces:**
- One release descriptor generates every manifest/download entry.
- An artifact is downloadable only after size, SHA-256, package identity, and formal signature verification.

- [ ] **Step 1: Write the next-release publishing test before choosing the final version**

The descriptor is the only mutable version source. The test reads it dynamically and requires each published platform/build record, artifact, hash, description, and changelog entry to match.

```js
assert.equal(download.version, release.version);
assert.equal(download.build, release.build);
assert.equal(sha256(file), download.sha256);
assert.ok(changelogs.some(entry => entry.id === release.changelogId));
```

- [ ] **Step 2: Run the publishing test**

Run: `node --test tests/survival_diary_publish_contract.test.js`

Expected: FAIL until new artifacts and metadata exist.

- [ ] **Step 3: Build and verify formal artifacts**

Build Android with the existing continuous release certificate. Build iOS through an allowed App Store/TestFlight workflow, macOS with Developer ID and notarization, and Harmony APP/HAP with the provided publishing profile. If a credential is absent, mark that platform unavailable rather than signed.

- [ ] **Step 4: Generate metadata and changelogs**

Run:

```bash
node scripts/generate_survival_diary_release_metadata.mjs --write
node scripts/reconcile_survival_diary_history.mjs --write
node --test tests/survival_diary_publish_contract.test.js
```

Expected: PASS with private/public manifests, client downloads, and changelogs synchronized.

- [ ] **Step 5: Upload, restart, and verify from the public Internet**

Verify health, `/api/downloads`, each versioned artifact, latest alias, full-file SHA-256, package identity, signature, and upgrade from the previous signed build before claiming release.

- [ ] **Step 6: Commit**

```bash
git add release/survival-diary scripts website/api website/zhengzhengstudio.cn/api tests/survival_diary_publish_contract.test.js
git commit -m "release: publish Survival Diary open-world update"
```

### Task 14: Harmony Store Materials and Official Filing Guide

**Files:**
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/store-assets/listing.zh-CN.md`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/store-assets/shot-list.md`
- Create: `docs/survival-diary-filing-guide-zh-CN.md`
- Test: `tests/survival_diary_store_assets.test.js`

**Interfaces:**
- Store copy may describe only features present in the signed offline package.
- Filing guide cites current primary government/platform sources and separates ICP, App filing, store review, and game approval.

- [ ] **Step 1: Write store-evidence tests**

```js
assert.match(listing, /程序化|采集|建造|日记/);
assert.doesNotMatch(offlineListing, /好友|聊天|碰一碰|公共岛/);
assert.equal(oldHarmonyIconSha256, expectedOldHarmonyIconSha256);
```

- [ ] **Step 2: Capture real-device evidence**

Capture real running screenshots for day/night, weather, mining, crafting, bed use, map, building, and diary. Keep AI concept imagery separate and never label it as a real-device photo.

- [ ] **Step 3: Research current filing requirements from primary sources**

Browse the Ministry of Industry and Information Technology, National Press and Publication Administration, Apple, Android channel, and Huawei developer documentation current on the delivery date. Record direct links and the exact applicability conditions for this product.

- [ ] **Step 4: Write the Chinese filing checklist**

The guide must provide separate decision paths for website ICP filing, App filing, store submissions, online service operation, and whether game approval applies. It must identify the documents the user supplies, the platform/operator steps, expected review sequence, and items that require a qualified legal or publishing professional.

- [ ] **Step 5: Run store tests and commit**

Run: `node --test tests/survival_diary_store_assets.test.js`

```bash
git add apps/SurvivalDiary-HarmonyOS-Offline/store-assets docs/survival-diary-filing-guide-zh-CN.md tests/survival_diary_store_assets.test.js
git commit -m "docs: prepare Survival Diary store and filing materials"
```

---

## Final Verification Gate

Do not claim completion until fresh evidence proves all applicable items:

```bash
node --test tests/survival_diary_*.test.js
cd apps/SurvivalDiary-Android && ./gradlew testWebsiteDebugUnitTest
cd ../SurvivalDiary-Apple && swift test
cd ../../website/survival-diary.zhengzhengstudio.cn/server && node --test
```

Then verify each formal artifact from its public URL, compare full SHA-256, inspect package ID/version/build/signing identity, install or open through the platform-supported flow, and confirm the download center and changelog display the same release descriptor.
