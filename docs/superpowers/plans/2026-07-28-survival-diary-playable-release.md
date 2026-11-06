# Survival Diary Playable Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Survival Diary prototype into a persistent open-ended gather/craft/place/journal game and publish Android v0.2.0 build 2 with a dedicated production signing key and a verified download-center entry.

**Architecture:** Keep the existing vanilla Canvas application and split deterministic game rules into CommonJS/browser-compatible modules loaded before `world.js` and `game.js`. World mutations pass through pure inventory, crafting, placement, and journal functions; `game.js` owns DOM wiring and persistence. Android remains the existing product flavor with bundled offline web assets, but gains product-specific icons, secure release signing, and verified update metadata.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Canvas 2D, Node.js built-in test runner, Android Gradle Plugin, Java WebView shell, Android `apksigner`, macOS Keychain, built-in image generation plus deterministic PNG post-processing.

## Global Constraints

- Product name is `生存日记`; Android package is `cn.zhengzhengstudio.survivaldiary`.
- Release version is `0.2.0`, Android `versionCode`/build is `2`.
- The game has no fixed ending, final mission, or world-day limit.
- First release content is exactly twelve resource/item types, twelve recipes, and eight placeable entity types.
- Placeables use detailed 2.5D textures with one consistent upper-left light direction, transparent edges, grounding shadows, and recognizable 48px silhouettes.
- Mobile acceptance viewport is 390×844 CSS pixels; all essential touch targets are at least 44×44 CSS pixels.
- Existing saves migrate by adding fields only; migration must not alter coordinates, remove inventory, or overwrite journal text.
- Android signing uses a dedicated PKCS#12 RSA-3072 key valid for 10,000 days under `/Users/ljg/Desktop/开发者/TRAE/Android证书`.
- Keystore passwords must live in macOS Keychain and must not appear in Git, source files, build logs, or chat.
- Both `website/api/apps/client-downloads.json` and `website/zhengzhengstudio.cn/api/apps/client-downloads.json` must contain the same Survival Diary release object.
- Website changes update `website/api/data/changelogs.json` and its public mirror.
- A release is not listed as available until both versioned and latest APK uploads pass size, SHA-256, and signing-certificate verification.
- Do not mark iOS, macOS, HarmonyOS online, or HarmonyOS offline packages as delivered in this release.

---

## File Map

- Create `website/survival-diary.zhengzhengstudio.cn/js/content.js`: canonical items, recipes, and placeable definitions.
- Create `website/survival-diary.zhengzhengstudio.cn/js/crafting.js`: pure recipe validation and atomic inventory mutation.
- Create `website/survival-diary.zhengzhengstudio.cn/js/placement.js`: placement preview, collision, rotation, confirm, use, and dismantle rules.
- Create `website/survival-diary.zhengzhengstudio.cn/js/journal.js`: fact-event aggregation, entry editing, history, and discovery records.
- Modify `website/survival-diary.zhengzhengstudio.cn/js/world.js`: integrate content, entities, game clock, vitals, and rendering state.
- Modify `website/survival-diary.zhengzhengstudio.cn/js/game.js`: DOM controllers, persistence migration, crafting/journal/placement workflows.
- Modify `website/survival-diary.zhengzhengstudio.cn/index.html`: script order and semantic panels for crafting, building, and journal.
- Modify `website/survival-diary.zhengzhengstudio.cn/styles.css`: responsive HUD, paper journal, build preview, feedback states.
- Create `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/*.png`: eight transparent detailed 2.5D world sprites.
- Create `website/survival-diary.zhengzhengstudio.cn/assets/art/app-icon-master-v1.png`: icon master shared by web and Android.
- Modify `website/survival-diary.zhengzhengstudio.cn/manifest.webmanifest` and `sw.js`: icon declarations and cache version/assets.
- Modify `apps/LifeDiary-Android/app/build.gradle`: v0.2.0/build 2 and secure release signing configuration.
- Create `apps/LifeDiary-Android/app/src/survivalDiary/res/mipmap-*/ic_launcher.png`: product-specific launcher icons.
- Create `apps/LifeDiary-Android/app/src/survivalDiary/res/mipmap-anydpi-v26/ic_launcher.xml`: adaptive icon.
- Modify `apps/LifeDiary-Android/app/src/main/AndroidManifest.xml`: use flavor launcher resource and retain update permissions.
- Create `scripts/build_survival_diary_release.sh`: keychain-backed build, verification, hashes, and publication copy.
- Modify `.gitignore`: exclude signing key and any local signing metadata while allowing `Android证书/README.md`.
- Create `Android证书/README.md`: non-secret fingerprint, validity, backup, and upgrade-continuity instructions.
- Create `tests/survival_diary_gameplay.test.js`: pure gameplay rule coverage.
- Modify `tests/survival_diary_web.test.js`: DOM, visual assets, cache, and responsive contracts.
- Modify `tests/survival_diary_android.test.js`: production signing configuration, icon, version, and package contracts.
- Create `tests/survival_diary_release.test.js`: dual-manifest and package-integrity contracts.
- Modify both app manifests, both client-download manifests, `website/api/data/changelogs.json`, and the public changelog mirror.

---

### Task 1: Canonical Content and Crafting Rules

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/content.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/crafting.js`
- Create: `tests/survival_diary_gameplay.test.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`

**Interfaces:**
- Produces: `SurvivalContent.ITEMS`, `SurvivalContent.RECIPES`, `SurvivalContent.PLACEABLES`, and `SurvivalCrafting.craft(inventory, recipeId, context)`.
- `craft` returns `{ ok: boolean, inventory: Record<string, number>, crafted?: { id: string, count: number }, missing?: Array<{ id: string, count: number }>, reason?: string }` and never mutates its input.

- [ ] **Step 1: Write the failing content and crafting tests**

```js
const content = require('../website/survival-diary.zhengzhengstudio.cn/js/content.js');
const crafting = require('../website/survival-diary.zhengzhengstudio.cn/js/crafting.js');

test('release content has twelve connected items, twelve recipes and eight placeables', () => {
  assert.equal(Object.keys(content.ITEMS).length, 12);
  assert.equal(Object.keys(content.RECIPES).length, 12);
  assert.equal(Object.keys(content.PLACEABLES).length, 8);
  for (const recipe of Object.values(content.RECIPES)) {
    for (const id of Object.keys(recipe.input)) assert.ok(content.ITEMS[id]);
    assert.ok(content.ITEMS[recipe.output.id] || content.PLACEABLES[recipe.output.id]);
  }
});

test('crafting is atomic and reports exact missing material counts', () => {
  const poor = { driftwood: 1, fiber: 0 };
  const failed = crafting.craft(poor, 'rope', { station: 'hand' });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.inventory, poor);
  assert.deepEqual(failed.missing, [{ id: 'fiber', count: 3 }]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/survival_diary_gameplay.test.js`  
Expected: FAIL because `content.js` and `crafting.js` do not exist.

- [ ] **Step 3: Implement the canonical data and pure crafting API**

Use the UMD pattern already supported by Node tests and browsers:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SurvivalContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ITEMS = Object.freeze({
    driftwood: { name: '漂流木', stack: 40 }, branch: { name: '树枝', stack: 50 },
    fiber: { name: '纤维', stack: 50 }, vine: { name: '藤蔓', stack: 40 },
    stone: { name: '石块', stack: 40 }, leaf: { name: '叶片', stack: 50 },
    shell: { name: '贝壳', stack: 30 }, water: { name: '淡水', stack: 10 },
    rawFish: { name: '生鱼', stack: 10 }, cookedFish: { name: '烤鱼', stack: 10 },
    rope: { name: '绳索', stack: 20 }, stoneAxe: { name: '石斧', stack: 1 }
  });
  const PLACEABLES = Object.freeze({
    campfire: { name: '篝火', width: 72, height: 52, durability: 120 },
    shelter: { name: '简易庇护所', width: 150, height: 112, durability: 260 },
    storageCrate: { name: '储物箱', width: 78, height: 60, durability: 180 },
    rainCollector: { name: '集水器', width: 96, height: 74, durability: 150 },
    workbench: { name: '工作台', width: 118, height: 72, durability: 220 },
    fishRack: { name: '晒鱼架', width: 110, height: 66, durability: 140 },
    palisade: { name: '围墙', width: 132, height: 44, durability: 300 },
    gardenPlot: { name: '种植地', width: 126, height: 92, durability: 160 }
  });
  const RECIPES = Object.freeze({
    rope: { input: { fiber: 3 }, output: { id: 'rope', count: 1 }, station: 'hand' },
    stoneAxe: { input: { branch: 2, stone: 2, rope: 1 }, output: { id: 'stoneAxe', count: 1 }, station: 'hand' },
    collectWater: { input: { leaf: 2, shell: 1 }, output: { id: 'water', count: 1 }, station: 'hand' },
    cookedFish: { input: { rawFish: 1, branch: 1 }, output: { id: 'cookedFish', count: 1 }, station: 'campfire' },
    campfire: { input: { stone: 4, branch: 4 }, output: { id: 'campfire', count: 1 }, station: 'hand' },
    shelter: { input: { driftwood: 6, leaf: 8, rope: 2 }, output: { id: 'shelter', count: 1 }, station: 'hand' },
    storageCrate: { input: { driftwood: 5, rope: 1 }, output: { id: 'storageCrate', count: 1 }, station: 'hand' },
    rainCollector: { input: { leaf: 6, vine: 4, shell: 2 }, output: { id: 'rainCollector', count: 1 }, station: 'hand' },
    workbench: { input: { driftwood: 8, stone: 4, rope: 2 }, output: { id: 'workbench', count: 1 }, station: 'hand' },
    fishRack: { input: { branch: 6, rope: 2 }, output: { id: 'fishRack', count: 1 }, station: 'hand' },
    palisade: { input: { driftwood: 4, vine: 2 }, output: { id: 'palisade', count: 1 }, station: 'hand' },
    gardenPlot: { input: { driftwood: 4, leaf: 4, water: 1 }, output: { id: 'gardenPlot', count: 1 }, station: 'hand' }
  });
  return Object.freeze({ ITEMS, RECIPES, PLACEABLES });
});
```

`craft()` must clone inventory, validate station and inputs, subtract every input only after validation succeeds, then add the output.

- [ ] **Step 4: Load modules before the world and game scripts**

```html
<script src="js/content.js"></script>
<script src="js/crafting.js"></script>
<script src="js/placement.js"></script>
<script src="js/journal.js"></script>
<script src="js/world.js"></script>
<script src="js/game.js"></script>
```

Add `placement.js` and `journal.js` only after their files exist in Tasks 2 and 3; until then, load the two files created in this task immediately before `world.js`.

- [ ] **Step 5: Run the test and commit**

Run: `node --test tests/survival_diary_gameplay.test.js`  
Expected: PASS for content counts, referential integrity, successful crafting, station checks, and atomic failures.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/js/content.js survival-diary.zhengzhengstudio.cn/js/crafting.js survival-diary.zhengzhengstudio.cn/index.html
git -C website commit -m "feat: add survival crafting content"
git add tests/survival_diary_gameplay.test.js
git commit -m "test: cover survival crafting content"
```

### Task 2: Persistent Placeable Entity Rules

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/placement.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Modify: `tests/survival_diary_gameplay.test.js`

**Interfaces:**
- Consumes: `SurvivalContent.PLACEABLES` and inventory records from Task 1.
- Produces: `previewPlacement(state, type, point, rotation)`, `confirmPlacement(state, preview)`, `rotatePlacement(preview)`, `dismantleEntity(state, entityId)`, and `useEntity(state, entityId, action)`.
- An entity is `{ id, type, x, y, rotation, regionKey, durability, createdDay, state }`.

- [ ] **Step 1: Add failing placement, collision, rotation, persistence-shape, and dismantle tests**

```js
test('valid placement consumes one token and creates a persistent entity', () => {
  const state = world.createWorldView('placement');
  state.inventory.campfire = 1;
  const preview = placement.previewPlacement(state, 'campfire', { x: 320, y: 240 }, 0);
  assert.equal(preview.valid, true);
  const result = placement.confirmPlacement(state, preview);
  assert.equal(result.ok, true);
  assert.equal(result.state.inventory.campfire, 0);
  assert.equal(result.state.entities[0].type, 'campfire');
});

test('overlap is rejected without consuming inventory', () => {
  const base = world.createWorldView('collision');
  base.inventory.campfire = 1;
  const placed = placement.confirmPlacement(
    base,
    placement.previewPlacement(base, 'campfire', { x: 320, y: 240 }, 0)
  ).state;
  placed.inventory.storageCrate = 1;
  const preview = placement.previewPlacement(placed, 'storageCrate', { x: 320, y: 240 }, 0);
  assert.equal(preview.valid, false);
  assert.equal(preview.reason, '这里已有建筑');
  assert.equal(placed.inventory.storageCrate, 1);
});
```

- [ ] **Step 2: Run tests and verify the missing-module failure**

Run: `node --test tests/survival_diary_gameplay.test.js`  
Expected: FAIL because the placement API does not exist.

- [ ] **Step 3: Implement deterministic placement rules**

Implement axis-aligned collision using rotated width/height for 0/90/180/270 degrees, stable IDs derived from `nextEntityId`, region ownership from world coordinates, and explicit invalid reasons:

```js
function previewPlacement(state, type, point, rotation = 0) {
  const definition = PLACEABLES[type];
  const normalized = ((rotation % 360) + 360) % 360;
  if (!definition) return { valid: false, reason: '未知建筑' };
  if ((state.inventory[type] || 0) < 1) return { valid: false, reason: '背包中没有该建筑' };
  const bounds = boundsFor(definition, point, normalized);
  if (!isBuildableTerrain(state, point)) return { valid: false, reason: '这里的地形无法建造' };
  if (state.entities.some(entity => overlaps(bounds, entityBounds(entity)))) {
    return { valid: false, reason: '这里已有建筑', type, point, rotation: normalized, bounds };
  }
  return { valid: true, type, point, rotation: normalized, bounds };
}
```

- [ ] **Step 4: Extend world state and renderer integration points**

`createWorldView()` adds `entities: []`, `nextEntityId: 1`, and `gameClock: { day: 1, minute: 480 }`. Export a deterministic `entitySpriteKey(entity)` and render entities sorted by projected `y` after terrain and before the player.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/survival_diary_gameplay.test.js tests/survival_diary_web.test.js`  
Expected: PASS, including collision and no-material-loss failure paths.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/js/placement.js survival-diary.zhengzhengstudio.cn/js/world.js
git -C website commit -m "feat: add persistent placeable entities"
git add tests/survival_diary_gameplay.test.js
git commit -m "test: cover survival placement rules"
```

### Task 3: Journal Facts, History, and Save Migration

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/js/journal.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/save-store.js`
- Modify: `tests/survival_diary_gameplay.test.js`

**Interfaces:**
- Consumes: successful action results from crafting and placement.
- Produces: `migrateSave(raw)`, `recordFact(state, event)`, `editEntry(state, day, patch)`, `entriesForHistory(state)`, and `recordDiscovery(state, discovery)`.
- Fact events are `{ type, day, minute, subject, count?, regionKey? }` and journal entries are `{ day, title, body, facts, updatedAt }`.

- [ ] **Step 1: Add failing migration and journal tests**

```js
test('old saves gain journal and entity fields without losing inventory or coordinates', () => {
  const old = { player: { x: 17, y: 29 }, inventory: { fiber: 7 } };
  const migrated = journal.migrateSave(old);
  assert.deepEqual(migrated.player, old.player);
  assert.equal(migrated.inventory.fiber, 7);
  assert.deepEqual(migrated.entities, []);
  assert.deepEqual(migrated.journalEntries, []);
  assert.equal(migrated.saveSchemaVersion, 2);
});

test('automatic journal facts describe events without inventing feelings', () => {
  const baseState = journal.migrateSave({ inventory: {}, player: { x: 0, y: 0 } });
  const next = journal.recordFact(baseState, { type: 'placed', day: 1, minute: 720, subject: 'campfire' });
  assert.match(next.journalEntries[0].facts[0].text, /放置了篝火/);
  assert.doesNotMatch(next.journalEntries[0].facts[0].text, /开心|害怕|孤独/);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/survival_diary_gameplay.test.js`  
Expected: FAIL because the journal API does not exist.

- [ ] **Step 3: Implement schema-v2 migration and fact aggregation**

`migrateSave` deep-clones known nested records, fills `entities`, `nextEntityId`, `journalEntries`, `discoveries`, `gameClock`, and `saveSchemaVersion`, and stores an original raw backup under the existing save-store backup key before migration. `recordFact` merges identical resource facts from the same day while preserving ordered build and discovery facts.

- [ ] **Step 4: Wire save transactions and debounced journal text**

In `game.js`, successful gather/craft/place/use/dismantle actions call `recordFact()` before `scheduleSave()`. Journal title/body inputs update state after 250ms idle and flush on `visibilitychange` and `beforeunload`. On storage failure, keep state in memory, add `data-save-status="error"`, and retry after 3 seconds.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/survival_diary_gameplay.test.js tests/survival_diary_web.test.js`  
Expected: PASS, including migration idempotence and player-authored text preservation.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/js/journal.js survival-diary.zhengzhengstudio.cn/js/game.js survival-diary.zhengzhengstudio.cn/js/save-store.js
git -C website commit -m "feat: restore persistent survival journal"
git add tests/survival_diary_gameplay.test.js
git commit -m "test: cover survival journal migration"
```

### Task 4: Crafting, Placement, and Journal User Interface

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `tests/survival_diary_web.test.js`

**Interfaces:**
- Consumes: content, crafting, placement, and journal APIs from Tasks 1–3.
- Produces: DOM controllers `openCraftingPanel()`, `selectPlaceable(type)`, `renderPlacementPreview()`, `openJournal()`, and `renderJournalHistory()`.

- [ ] **Step 1: Add failing DOM contract tests**

```js
test('play surface exposes real crafting, placement and journal controls', () => {
  const html = read('index.html');
  for (const id of ['crafting-panel', 'recipe-list', 'placement-toolbar', 'rotate-placement',
    'confirm-placement', 'cancel-placement', 'journal-panel', 'journal-title',
    'journal-body', 'journal-history']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.doesNotMatch(html, />\s*[🔥📦🪓📖]\s*</);
});
```

- [ ] **Step 2: Run the web test and verify it fails**

Run: `node --test tests/survival_diary_web.test.js`  
Expected: FAIL listing the missing semantic controls.

- [ ] **Step 3: Add semantic panels and accessible interaction states**

Use `<aside>` for crafting, `<div role="toolbar">` for placement, and `<section role="dialog" aria-modal="true">` for the mobile journal. Every icon-only button needs a Chinese `aria-label`; invalid placement message uses `role="status"`; buttons expose `disabled` when materials are missing.

- [ ] **Step 4: Implement desktop and mobile layouts**

Desktop: crafting as a left sheet, journal as a right paper drawer, six-slot quick bar at bottom. Mobile: one bottom action dock plus full-screen journal; panels avoid status bars via `env(safe-area-inset-*)`. Add media-query assertions for `max-width: 720px`, `min-height: 100dvh`, 44px touch targets, and no `100vw` element inside padded containers.

- [ ] **Step 5: Wire preview movement, rotation, confirmation, and clear feedback**

Canvas pointer movement updates the placement point; rotation increments 90 degrees; confirm only calls `confirmPlacement` when preview is valid. Draw the sprite at 55% opacity with green `#6e9b78` or red `#b85d52` outline and a short invalid reason anchored above it.

- [ ] **Step 6: Run desktop/mobile browser checks and commit**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_gameplay.test.js`  
Expected: PASS.

Manual checks: 390×844 and 1280×800; no overlap, no horizontal overflow, keyboard focus visible, journal text survives refresh.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/index.html survival-diary.zhengzhengstudio.cn/styles.css survival-diary.zhengzhengstudio.cn/js/game.js
git -C website commit -m "feat: add playable survival game interface"
git add tests/survival_diary_web.test.js
git commit -m "test: cover survival game interface"
```

### Task 5: Detailed 2.5D Placeable Textures and App Icon

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/campfire-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/shelter-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/storage-crate-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/rain-collector-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/workbench-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/fish-rack-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/palisade-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/placeables/garden-plot-v1.png`
- Create: `website/survival-diary.zhengzhengstudio.cn/assets/art/app-icon-master-v1.png`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/manifest.webmanifest`
- Modify: `tests/survival_diary_web.test.js`

**Interfaces:**
- Consumes: `entitySpriteKey(entity)` from Task 2.
- Produces: a one-to-one sprite map from each placeable type to its exact file listed in this task, plus a 1024×1024 icon master.

- [ ] **Step 1: Add failing image asset tests**

```js
test('all eight placeables have detailed transparent textures', () => {
  const PLACEABLE_FILES = [
    'campfire-v1.png', 'shelter-v1.png', 'storage-crate-v1.png', 'rain-collector-v1.png',
    'workbench-v1.png', 'fish-rack-v1.png', 'palisade-v1.png', 'garden-plot-v1.png'
  ];
  for (const file of PLACEABLE_FILES) {
    const png = fs.readFileSync(path.join(site, 'assets/art/placeables', file));
    assert.ok(png.length > 40_000, `${file} is too small to be a detailed texture`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
});
```

Also inspect dimensions and RGBA color type with a small PNG-header helper; require at least 512×512 and an alpha-capable color type.

- [ ] **Step 2: Generate each placeable as an individual project-bound image**

Use the built-in image generation path once per placeable with this fixed visual contract:

```text
Use case: stylized-concept
Asset type: 2.5D game world placeable sprite
Primary request: practical handmade island-survival construction; run one image for each exact subject: campfire, simple shelter, storage crate, rain collector, workbench, fish-drying rack, timber palisade, and garden plot
Style/medium: polished hand-painted 2.5D game asset, crisp readable silhouette, detailed wood grain, rope fibers, stone and fabric wear
Composition/framing: three-quarter top-down view, centered, generous padding, consistent upper-left light
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background
Constraints: one object only; no person; no text; no icon frame; no watermark; no #ff00ff in the object; no cast shadow outside the object footprint
```

Copy each generated source into a project staging directory, remove chroma with the installed `remove_chroma_key.py --auto-key border --soft-matte --despill`, inspect transparency and edges, then save the final files listed above. Retry only the single failed visual attribute.

- [ ] **Step 3: Generate and validate the icon master**

```text
Use case: logo-brand
Asset type: premium survival game app icon master
Primary request: an ocean-worn deep navy field journal whose cover contains an island-shaped cutout and a small embossed compass engraving
Style/medium: refined 2.5D hand-painted game icon, old cloth cover, layered paper edges, salt wear, restrained warm sand and deep ocean palette
Composition/framing: one centered journal, strong silhouette, generous app-icon safe margin, readable at 48px
Constraints: square; no text; no letters; no logo imitation; no tiny scenery; no external frame; no watermark
```

Save the approved 1024×1024 PNG as `app-icon-master-v1.png`; create web 192px and 512px derivatives without overwriting the master.

- [ ] **Step 4: Integrate textures into rendering and PWA metadata**

Preload every texture. If a texture fails to load, draw a neutral geometric fallback and show a single non-blocking asset error; never use emoji. Add the PWA icon derivatives to `manifest.webmanifest`.

- [ ] **Step 5: Run automated and visual checks, then commit**

Run: `node --test tests/survival_diary_web.test.js tests/survival_diary_gameplay.test.js`  
Expected: PASS.

Visual checks at 50%, 100%, and 300% map zoom: no magenta fringe, consistent light direction, correct feet/ground anchor, distinct 48px silhouettes.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/assets/art/placeables survival-diary.zhengzhengstudio.cn/assets/art/app-icon-master-v1.png survival-diary.zhengzhengstudio.cn/manifest.webmanifest survival-diary.zhengzhengstudio.cn/js/game.js
git -C website commit -m "feat: add detailed survival game artwork"
git add tests/survival_diary_web.test.js
git commit -m "test: verify survival artwork assets"
```

### Task 6: Cache, Full Gameplay Regression, and Responsive QA

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/sw.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Modify: `tests/survival_diary_web.test.js`

**Interfaces:**
- Consumes: all playable web modules and assets.
- Produces: `survival-diary-shell-v4`, cached rule modules, cached icon/texture files, and a passing end-to-end manual scenario.

- [ ] **Step 1: Add failing service-worker and responsive regression assertions**

Require `content.js`, `crafting.js`, `placement.js`, `journal.js`, all eight textures, and icon derivatives in the shell list. Assert that CSS includes safe-area padding, journal mobile mode, placement toolbar mode, and reduced-motion behavior.

- [ ] **Step 2: Run web tests and verify the cache-contract failure**

Run: `node --test tests/survival_diary_web.test.js`  
Expected: FAIL until the new files are cached.

- [ ] **Step 3: Bump cache and add all offline gameplay assets**

Change the cache name to `survival-diary-shell-v4`; keep deferred activation and do not call `skipWaiting()` while a game session is open.

- [ ] **Step 4: Execute the complete manual gameplay path**

At 390×844 and 1280×800: local play → move → gather → craft rope → craft axe → craft campfire → enter placement → move preview → rotate → confirm → use campfire to cook fish → open journal → edit body → reload → verify inventory, entity, and journal persist. Capture console errors and fail the task if any related error occurs.

- [ ] **Step 5: Run all web/server tests and commit**

Run: `node --test tests/survival_diary_contracts.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_web.test.js`  
Run: `cd website/survival-diary.zhengzhengstudio.cn/server && npm test`  
Expected: all tests PASS.

```bash
git -C website add survival-diary.zhengzhengstudio.cn/sw.js survival-diary.zhengzhengstudio.cn/styles.css survival-diary.zhengzhengstudio.cn/js/game.js
git -C website commit -m "fix: complete survival offline gameplay"
git add tests/survival_diary_web.test.js
git commit -m "test: verify survival gameplay across viewports"
```

### Task 7: Dedicated Android Production Signing and Launcher Artwork

**Files:**
- Modify: `.gitignore`
- Create: `Android证书/README.md`
- Modify: `apps/LifeDiary-Android/app/build.gradle`
- Modify: `apps/LifeDiary-Android/app/src/main/AndroidManifest.xml`
- Create: `apps/LifeDiary-Android/app/src/survivalDiary/res/mipmap-*/ic_launcher.png`
- Create: `apps/LifeDiary-Android/app/src/survivalDiary/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `apps/LifeDiary-Android/app/src/survivalDiary/res/values/colors.xml`
- Create: `scripts/build_survival_diary_release.sh`
- Modify: `tests/survival_diary_android.test.js`

**Interfaces:**
- Consumes: web release assets and `app-icon-master-v1.png`.
- Produces: `/Users/ljg/Desktop/开发者/TRAE/Android证书/SurvivalDiary-Android-Release.p12`, Keychain service `cn.zhengzhengstudio.survivaldiary.release`, and verified signed APKs.

- [ ] **Step 1: Add failing Android release-contract tests**

```js
test('Survival Diary release is version 0.2.0 build 2 and securely signed', () => {
  const gradle = read('app/build.gradle');
  assert.match(gradle, /versionCode\s+2/);
  assert.match(gradle, /versionName\s+["']0\.2\.0["']/);
  assert.match(gradle, /SURVIVAL_DIARY_STORE_PASSWORD/);
  assert.match(gradle, /signingConfig\s+signingConfigs\.survivalDiaryRelease/);
  assert.doesNotMatch(gradle, /storePassword\s+["'][^"']+["']/);
});
```

- [ ] **Step 2: Run the Android test and verify failure**

Run: `node --test tests/survival_diary_android.test.js`  
Expected: FAIL on version, signing configuration, and product icon resources.

- [ ] **Step 3: Create the certificate directory and dedicated key**

Create `/Users/ljg/Desktop/开发者/TRAE/Android证书`. Generate a random 32-byte password locally without printing it, store it in macOS Keychain under service `cn.zhengzhengstudio.survivaldiary.release`, then create the PKCS#12 key with alias `survival-diary-release`, RSA-3072, SHA-256, and 10,000-day validity. Add ignore rules for `Android证书/*.p12`, `*.jks`, `*.properties`, and secret exports, while explicitly allowing `Android证书/README.md`.

- [ ] **Step 4: Configure Gradle to require environment-provided secrets**

```groovy
signingConfigs {
    survivalDiaryRelease {
        storeFile file(System.getenv('SURVIVAL_DIARY_KEYSTORE'))
        storePassword System.getenv('SURVIVAL_DIARY_STORE_PASSWORD')
        keyAlias 'survival-diary-release'
        keyPassword System.getenv('SURVIVAL_DIARY_KEY_PASSWORD')
        storeType 'PKCS12'
    }
}
```

Apply this signing config only to the `survivalDiaryRelease` variant using Android Components or a flavor-specific build type hook; do not change Life Diary signing.

- [ ] **Step 5: Create product-specific adaptive and legacy icons**

Generate mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi launcher PNGs from the approved master using deterministic resampling. Use a deep-ocean solid adaptive background and a safely inset foreground; verify the Survival Diary APK does not fall back to the Life Diary vector.

- [ ] **Step 6: Build and verify the formal APK**

The build script reads the password from Keychain into non-echoed environment variables, runs `./gradlew clean assembleSurvivalDiaryRelease`, copies the versioned APK, calls `apksigner verify --verbose --print-certs`, rejects `CN=Android Debug`, verifies `android:debuggable` is absent/false, computes SHA-256, and creates the latest copy only after all checks pass.

- [ ] **Step 7: Record the public fingerprint and commit non-secret files**

`Android证书/README.md` records alias, SHA-256 certificate fingerprint, validity dates, package name, Keychain service name, backup requirement, and the fact that the private key/password are not in Git.

```bash
git add .gitignore Android证书/README.md apps/LifeDiary-Android/app/build.gradle apps/LifeDiary-Android/app/src/main/AndroidManifest.xml apps/LifeDiary-Android/app/src/survivalDiary scripts/build_survival_diary_release.sh tests/survival_diary_android.test.js
git commit -m "build: add production signing for survival diary"
```

### Task 8: Release Manifests, Download-Center Sync, and Changelog

**Files:**
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/changelogs.json`
- Create: `tests/survival_diary_release.test.js`
- Modify: `sync_to_termux.js`

**Interfaces:**
- Consumes: signed APK filename, size, SHA-256, signing fingerprint, and build time from Task 7.
- Produces: identical `survival-diary-android` v0.2.0/build 2 entries in private/public manifests and a download-center-visible client entry.

- [ ] **Step 1: Write failing dual-manifest tests**

```js
test('private and public client downloads expose the same formal release', () => {
  const byId = (document, id) => document.apps.find(item => item.id === id);
  const privateItem = byId(privateClient, 'survival-diary-android');
  const publicItem = byId(publicClient, 'survival-diary-android');
  assert.deepEqual(publicItem, privateItem);
  assert.equal(privateItem.version, '0.2.0');
  assert.equal(privateItem.build, 2);
  assert.equal(privateItem.signed, true);
  assert.equal(privateItem.signing, 'android-release');
  assert.equal(privateItem.storeReady, true);
  assert.doesNotMatch(privateItem.fileName, /debug|test-signed/i);
});
```

- [ ] **Step 2: Run release tests and verify failure**

Run: `node --test tests/survival_diary_release.test.js`  
Expected: FAIL because the public client file lacks the entry and the current package is test-signed.

- [ ] **Step 3: Replace the test entry with verified release metadata**

Set version `0.2.0`, build `2`, `signed: true`, `signing: "android-release"`, `storeReady: true`, versioned/latest URLs, exact size, SHA-256, icon URL, and factual notes covering crafting, placeables, journal, mobile UI, and formal signing. Update timestamps once, then copy the canonical object to both client files and both manifest files.

- [ ] **Step 4: Update both changelog stores**

Add one dated entry that lists only delivered facts: detailed textures, twelve recipes, eight persistent placeables, journal restoration, responsive fixes, dedicated Android release signature, and download-center synchronization. Preserve all prior entries.

- [ ] **Step 5: Harden the deploy list against the discovered mirror bug**

Ensure the deployment helper uploads both client files to their distinct remote paths, both manifests, both changelogs, the icon, and both APK names. Treat either APK upload failure as a non-zero release failure.

- [ ] **Step 6: Run release and server tests, then commit**

Run: `node --test tests/survival_diary_release.test.js tests/survival_diary_android.test.js`  
Run: `cd website/survival-diary.zhengzhengstudio.cn/server && npm test`  
Expected: PASS.

```bash
git -C website add api/apps/manifest.json api/apps/client-downloads.json zhengzhengstudio.cn/api/apps/manifest.json zhengzhengstudio.cn/api/apps/client-downloads.json api/data/changelogs.json zhengzhengstudio.cn/api/changelogs.json
git -C website commit -m "release: publish survival diary android 0.2.0"
git add tests/survival_diary_release.test.js
git commit -m "test: verify survival release metadata"
```

Do not stage `sync_to_termux.js` if it still contains environment secrets; keep its necessary deploy-list change local and report that explicitly.

### Task 9: Deploy and Verify the Real User Path

**Files:**
- Deploy: `website/survival-diary.zhengzhengstudio.cn/**`
- Deploy: four release manifests, two changelog stores, icon derivatives, and both APK files
- No source changes unless verification exposes a defect; any defect gets a new failing regression test before repair.

**Interfaces:**
- Consumes: passing web, Android, release, and server tests plus signed build artifacts.
- Produces: a live playable site and a download-center-visible, downloadable, formally signed Android release.

- [ ] **Step 1: Run the complete local verification suite**

Run: `node --test tests/survival_diary_contracts.test.js tests/survival_diary_gameplay.test.js tests/survival_diary_web.test.js tests/survival_diary_android.test.js tests/survival_diary_release.test.js`  
Run: `cd website/survival-diary.zhengzhengstudio.cn/server && npm test`  
Expected: all PASS.

- [ ] **Step 2: Verify both local APK names before upload**

For each APK: compare expected size and SHA-256; run `apksigner verify --verbose --print-certs`; confirm identical signer SHA-256; inspect package `cn.zhengzhengstudio.survivaldiary`, version `0.2.0`, build `2`, label `生存日记`, and non-debuggable status.

- [ ] **Step 3: Deploy with failure-sensitive upload behavior**

Upload website files, public/private manifests, public/private client downloads, changelogs, icon derivatives, and both APKs. Restart the Survival Diary and main API services only after all required files report successful transfer.

- [ ] **Step 4: Verify public health, code, API, and full binary downloads**

Check:

```text
https://survival-diary.zhengzhengstudio.cn/health
https://survival-diary.zhengzhengstudio.cn/js/placement.js
https://zhengzhengstudio.cn/api/downloads
https://zhengzhengstudio.cn/api/apps/manifest.json
https://zhengzhengstudio.cn/api/apps/download/SurvivalDiary-Android-v0.2.0-b2.apk
https://zhengzhengstudio.cn/api/apps/download/SurvivalDiary-Android-latest.apk
```

Download both APK URLs fully, not only with HEAD, and compare hashes to local artifacts.

- [ ] **Step 5: Verify the live browser experience**

On the live site at mobile and desktop sizes, complete the full gameplay path from Task 6. On the live download center, search `生存日记`, confirm the formal v0.2.0 entry and icon are visible, click the versioned download, and verify there are no related console errors.

- [ ] **Step 6: Report completion with evidence and remaining platform scope**

Report test counts, live URLs, APK size/hash, signing fingerprint, download-center result, and the exact certificate backup path. State clearly that iOS, macOS, and both HarmonyOS packages remain separate delivery work unless they were actually built and verified.

---

## Plan Self-Review

- Spec coverage: core loop, twelve items/recipes, eight placeables, detailed textures, journal, persistence, responsive UI, icon, signing, dual client files, changelogs, deployment, and live verification each map to an explicit task.
- Placeholder scan: the plan contains no unresolved markers, deferred implementation language, unspecified error handling, or unnamed tests.
- Type consistency: Tasks 1–6 use `inventory`, `entities`, `journalEntries`, `discoveries`, `gameClock`, and `saveSchemaVersion`; placement and journal signatures remain unchanged across producers and consumers.
- Scope boundary: this plan delivers Web and Android v0.2.0 only and does not claim the remaining native platforms.
