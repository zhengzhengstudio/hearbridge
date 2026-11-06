# SpaceFight Playability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first independently playable batch of the open-combat redesign: native apps always enter combat, mobile controls provide immediate visual/haptic feedback without sticky input, and the repeated wave loop becomes a deterministic expedition with distinct enemy roles, loot, risk, and return.

**Architecture:** Keep the fixed-step `CombatSimulation` as the deterministic coordinator, but move expedition progression, enemy decisions, and cargo settlement into pure TypeScript modules with immutable snapshots. Cocos presenters consume snapshots only; platform haptics are emitted through a throttled feedback sink, and missing 3D assets fall back to an engine-created ship silhouette instead of blocking startup.

**Tech Stack:** Cocos Creator 3.8.8, TypeScript 4.9 compatibility target, Node.js `node:test`, Cocos native platform bridges, Android/HarmonyOS native builds.

**Spec:** `docs/superpowers/specs/2026-08-28-spacefight-open-combat-vertical-slice-design.md`

## Global Constraints

- Offline single-player must not require a passport, website login, WebView, or network connection.
- Android, HarmonyOS, iOS, and macOS game UI remains Cocos-native; platform bridges are limited to platform services.
- Default flight input is direct response; logical joystick input becomes zero immediately on release.
- UI uses the approved restrained industrial component language: matte charcoal, off-white, desaturated mint for active state, amber only for the primary command, red only for danger.
- All required assets have a local fallback; one missing GLB must never block combat entry.
- This delivery bumps `0.10.22 build 41` to `0.10.23 build 42` and records tests, builds, signing checks, screenshots, and hashes.
- Do not publish a package unless its native smoke test reaches combat.

## Plan Series Boundary

This is plan 1 of the vertical-slice implementation. It intentionally delivers the shared reliability and combat-loop foundation first. The walkable hub, tactical landing/ground combat, full outfitting bench, three-layer authored environment, and complete onboarding mission remain in follow-up plans; their interfaces depend on the expedition, cargo, fallback, and input contracts created here.

---

### Task 1: Deterministic Joystick Feedback State

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/input/TouchStickFeedback.ts`
- Create: `SpaceFight-Cocos/assets/scripts/input/TouchStickFeedback.ts.meta`
- Modify: `SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts`
- Modify: `SpaceFight-Cocos/tools/run-input-tests.js`
- Test: `tests/spacefight_cocos_input.test.js`

**Interfaces:**
- Consumes: movement center/radius from `TouchFlightInput`.
- Produces: `TouchStickFeedbackSnapshot`, `TouchStickThreshold`, `touchStickFeedback(dx, dy, radius, active, previousThreshold)`.

- [ ] **Step 1: Write failing feedback-state tests**

Add tests that compile and import `TouchStickFeedback.ts`, then assert center, deadzone, 75%, full travel, and release behavior:

```js
test('touch stick feedback exposes normalized travel and threshold crossings', () => {
  let state = input.touchStickFeedback(0, 0, 80, true, 'center');
  assert.equal(state.travel, 0);
  assert.equal(state.threshold, 'center');

  state = input.touchStickFeedback(64, 0, 80, true, state.threshold);
  assert.equal(state.travel, 0.8);
  assert.equal(state.threshold, 'cruise');
  assert.equal(state.crossedThreshold, true);

  state = input.touchStickFeedback(120, 0, 80, true, state.threshold);
  assert.equal(state.travel, 1);
  assert.equal(state.threshold, 'full');
});

test('touch stick release zeroes logical displacement immediately', () => {
  const state = input.touchStickFeedback(55, -20, 80, false, 'cruise');
  assert.deepEqual(state.axis, { x: 0, y: 0 });
  assert.equal(state.threshold, 'center');
  assert.equal(state.active, false);
});
```

- [ ] **Step 2: Run input tests and verify failure**

Run: `cd SpaceFight-Cocos && npm run test:input`

Expected: FAIL because `touchStickFeedback` is not exported.

- [ ] **Step 3: Implement the pure feedback model**

Create these exact public types and function:

```ts
export type TouchStickThreshold = 'center' | 'active' | 'cruise' | 'full';

export interface TouchStickFeedbackSnapshot {
  readonly active: boolean;
  readonly axis: { readonly x: number; readonly y: number };
  readonly travel: number;
  readonly angle: number;
  readonly threshold: TouchStickThreshold;
  readonly crossedThreshold: boolean;
}

export function touchStickFeedback(
  dx: number,
  dy: number,
  radius: number,
  active: boolean,
  previousThreshold: TouchStickThreshold,
): TouchStickFeedbackSnapshot {
  const safeRadius = Math.max(1, Number.isFinite(radius) ? radius : 1);
  const length = active ? Math.hypot(dx, dy) : 0;
  const travel = Math.min(1, length / safeRadius);
  const threshold: TouchStickThreshold = !active || travel <= 0.04
    ? 'center'
    : travel >= 0.98 ? 'full' : travel >= 0.75 ? 'cruise' : 'active';
  return {
    active,
    axis: length > 0 ? { x: (dx / length) * travel, y: (dy / length) * travel } : { x: 0, y: 0 },
    travel,
    angle: length > 0 ? Math.atan2(dy, dx) : 0,
    threshold,
    crossedThreshold: threshold !== previousThreshold,
  };
}
```

Update the input test compiler/export harness to include the new file. Keep `TouchFlightInput.endPointer()` and `releaseAll()` as immediate logical resets; do not add release interpolation to input state.

- [ ] **Step 4: Run input tests**

Run: `cd SpaceFight-Cocos && npm run test:input`

Expected: all input tests PASS.

- [ ] **Step 5: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/input/TouchStickFeedback.ts SpaceFight-Cocos/assets/scripts/input/TouchStickFeedback.ts.meta SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts SpaceFight-Cocos/tools/run-input-tests.js tests/spacefight_cocos_input.test.js
git commit -m "feat: add deterministic touch stick feedback state"
```

---

### Task 2: Native Joystick Visual and Haptic Feedback

**Files:**
- Modify: `SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/platform/PlatformBridge.ts`
- Test: `tests/spacefight_input_responsive.test.js`
- Test: `tests/spacefight_platform_bridge.test.js`

**Interfaces:**
- Consumes: `touchStickFeedback()` from Task 1 and `PlatformBridge.haptic('ui-light')`.
- Produces: `NativeInputFeedback.setStickFeedback(snapshot)` and a throttled threshold haptic path.

- [ ] **Step 1: Write failing native-feedback contract tests**

Assert that the Cocos bridge computes feedback snapshots, that the HUD draws a direction arc and deadzone ring, and that release tweening is visual-only:

```js
test('native joystick has threshold, direction, and visual-only release feedback', () => {
  const bridge = read('SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts');
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  assert.match(bridge, /touchStickFeedback/);
  assert.match(bridge, /setStickFeedback/);
  assert.match(hud, /drawStickDirection/);
  assert.match(hud, /drawStickDeadzone/);
  assert.match(hud, /tween\(this\.stickThumb\)/);
  assert.match(hud, /duration: 0\.1/);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/spacefight_input_responsive.test.js tests/spacefight_platform_bridge.test.js`

Expected: FAIL because the new feedback methods do not exist.

- [ ] **Step 3: Extend the feedback interface and bridge**

Add to `NativeInputFeedback`:

```ts
setStickFeedback(snapshot: TouchStickFeedbackSnapshot): void;
```

Track `TouchStickThreshold` in `CocosInputBridge`. On movement start/move/end, call `touchStickFeedback`; call `setStickFeedback` every time. Invoke an injected callback only when crossing into `cruise` or `full`, with a minimum 120ms interval. Add an optional constructor parameter:

```ts
private readonly emitHaptic?: () => void
```

Pass `() => { void this.platform?.haptic('ui-light'); }` from `CombatBootstrap` after platform initialization.

- [ ] **Step 4: Draw restrained joystick feedback in Cocos**

In `NativeCombatHud`, retain the fixed base but replace the glowing disc with:

- one 1px outer ring;
- one low-contrast deadzone ring;
- four short cardinal ticks;
- one mint direction arc while active;
- a thumb scale of `0.96` while pressed;
- a 100ms visual return tween on release.

`setStickFeedback()` must use snapshot axis/travel and must not write back to `TouchFlightInput`.

- [ ] **Step 5: Run focused and input tests**

Run: `cd SpaceFight-Cocos && npm run test:input && cd .. && node --test tests/spacefight_input_responsive.test.js tests/spacefight_platform_bridge.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/input/CocosInputBridge.ts SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts SpaceFight-Cocos/assets/scripts/platform/PlatformBridge.ts tests/spacefight_input_responsive.test.js tests/spacefight_platform_bridge.test.js
git commit -m "feat: add native joystick visual and haptic feedback"
```

---

### Task 3: Non-blocking Ship Asset Fallback

**Files:**
- Modify: `SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CocosRuntime.d.ts`
- Test: `tests/spacefight_native_startup.test.js`
- Test: `tests/spacefight_ship_model_rig.test.js`

**Interfaces:**
- Consumes: existing ship shells, collider normalization, and model load errors.
- Produces: `ShipPresenter.ensurePlayerVisual(): Promise<'prefab' | 'fallback'>` and `createFallbackShipVisual(root, kind)`.

- [ ] **Step 1: Write failing startup fallback tests**

```js
test('required player model timeout falls back instead of blocking combat', () => {
  const presenter = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  assert.match(presenter, /ensurePlayerVisual\(\): Promise<'prefab' \| 'fallback'>/);
  assert.match(presenter, /createFallbackShipVisual/);
  assert.match(bootstrap, /required ship visual degraded to fallback/);
  assert.doesNotMatch(bootstrap, /required combat visuals unavailable; combat entry blocked/);
});
```

- [ ] **Step 2: Run startup tests and verify failure**

Run: `node --test tests/spacefight_native_startup.test.js tests/spacefight_ship_model_rig.test.js`

Expected: FAIL because startup still throws after the model timeout.

- [ ] **Step 3: Implement an engine-created fallback silhouette**

Use Cocos primitive meshes and the existing ship shell. Create a parent `FallbackVisual` with a central capsule/box body, two tapered wing boxes, and two emissive engine markers. Reuse `MODEL_NORMALIZATION[kind]` for scale and orientation. Preserve existing muzzle nodes and colliders.

Expose:

```ts
public async ensurePlayerVisual(): Promise<'prefab' | 'fallback'> {
  try {
    await this.loadPlayerVisual();
    return this.isPlayerVisualReady() ? 'prefab' : this.installPlayerFallback();
  } catch (error: unknown) {
    console.warn('[SpaceFight assets] player prefab unavailable; using fallback', error);
    return this.installPlayerFallback();
  }
}
```

Enemy model failures must install a lower-detail fallback and continue; they must not create invisible colliders.

- [ ] **Step 4: Remove the blocking bootstrap throw**

Replace the current required-visual catch with a call to `ensurePlayerVisual()`, log the returned mode, sync the presenter, then set `initialized = true`. Keep camera, input, and directional light as true startup requirements.

- [ ] **Step 5: Run startup, rig, and scene tests**

Run: `node --test tests/spacefight_native_startup.test.js tests/spacefight_ship_model_rig.test.js tests/spacefight_cocos_scene_contract.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts SpaceFight-Cocos/assets/scripts/game/CocosRuntime.d.ts tests/spacefight_native_startup.test.js tests/spacefight_ship_model_rig.test.js
git commit -m "fix: keep combat playable when ship assets fail"
```

---

### Task 4: Expedition Director and Return Decision

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/core/ExpeditionDirector.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/ExpeditionDirector.ts.meta`
- Modify: `SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts`
- Modify: `SpaceFight-Cocos/assets/data/missions/vertical-slice.json`
- Modify: `SpaceFight-Cocos/tools/run-simulation-tests.js`
- Test: `tests/spacefight_cocos_simulation.test.js`
- Test: `tests/spacefight_dynamic_expedition.test.js`

**Interfaces:**
- Consumes: deterministic seed, elapsed fixed ticks, completed objectives, and player return request.
- Produces: `ExpeditionSnapshot`, `ExpeditionEventDefinition`, `ExpeditionDirector.step(input)`.

- [ ] **Step 1: Write failing deterministic expedition tests**

Compile the new module and add behavior tests:

```js
test('expedition offers a return decision after the primary objective', () => {
  const director = new core.ExpeditionDirector({ seed: 1337, primaryEvent: 'breach' });
  director.completeEvent('primary');
  const snapshot = director.snapshot();
  assert.equal(snapshot.phase, 'decision');
  assert.equal(snapshot.canReturn, true);
  assert.equal(snapshot.availableEvents.length, 2);
});

test('same seed produces the same optional events', () => {
  const first = new core.ExpeditionDirector({ seed: 41, primaryEvent: 'breach' }).snapshot();
  const second = new core.ExpeditionDirector({ seed: 41, primaryEvent: 'breach' }).snapshot();
  assert.deepEqual(first.availableEvents, second.availableEvents);
});
```

- [ ] **Step 2: Run simulation tests and verify failure**

Run: `cd SpaceFight-Cocos && npm run test:simulation`

Expected: FAIL because `ExpeditionDirector` is absent.

- [ ] **Step 3: Implement director types and state machine**

Use these public values:

```ts
export type ExpeditionEventKind = 'intercept' | 'signal' | 'breach' | 'surge' | 'hunt';
export type ExpeditionPhase = 'infiltration' | 'primary' | 'decision' | 'deep-zone' | 'returning' | 'complete' | 'failed';

export interface ExpeditionSnapshot {
  readonly phase: ExpeditionPhase;
  readonly threat: number;
  readonly completedEvents: readonly string[];
  readonly availableEvents: readonly ExpeditionEventDefinition[];
  readonly canReturn: boolean;
  readonly returnProgress: number;
}
```

Primary completion enters `decision`. Continuing raises threat by one and chooses two deterministic optional events from the five kinds. Return requires staying inside the return zone for six fixed-step seconds; damage pauses progress for one second instead of resetting it.

- [ ] **Step 4: Integrate director into combat snapshots**

Add `returnRequested?: boolean` to `FlightCommandInput`. Replace wave-completion spawning with director phases. Keep an emergency endless fallback only behind an explicit debug flag; do not expose wave/event names as fake HUD content.

- [ ] **Step 5: Run simulation and dynamic expedition tests**

Run: `cd SpaceFight-Cocos && npm run test:simulation && cd .. && node --test tests/spacefight_dynamic_expedition.test.js`

Expected: PASS with tests asserting event phases instead of `wave += 1`.

- [ ] **Step 6: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/core/ExpeditionDirector.ts SpaceFight-Cocos/assets/scripts/core/ExpeditionDirector.ts.meta SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts SpaceFight-Cocos/assets/data/missions/vertical-slice.json SpaceFight-Cocos/tools/run-simulation-tests.js tests/spacefight_cocos_simulation.test.js tests/spacefight_dynamic_expedition.test.js
git commit -m "feat: replace combat waves with expedition decisions"
```

---

### Task 5: Enemy Roles, Cargo, and Limited-Risk Settlement

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/core/EnemyBehaviorSystem.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/EnemyBehaviorSystem.ts.meta`
- Create: `SpaceFight-Cocos/assets/scripts/core/LootAndCargoSystem.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/LootAndCargoSystem.ts.meta`
- Modify: `SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts`
- Modify: `SpaceFight-Cocos/tools/run-simulation-tests.js`
- Test: `tests/spacefight_cocos_simulation.test.js`
- Test: `tests/spacefight_playability_contract.test.js`

**Interfaces:**
- Consumes: player/enemy positions, threat, fixed delta, destroyed enemy descriptors, and return outcome.
- Produces: `EnemyIntent`, `CargoSnapshot`, `LootDrop`, `settleExpedition(outcome)`.

- [ ] **Step 1: Write failing role and settlement tests**

```js
test('enemy roles choose different readable distance bands', () => {
  const system = new core.EnemyBehaviorSystem(1337);
  assert.equal(system.intent(enemy('interceptor', 70), player()).mode, 'close');
  assert.equal(system.intent(enemy('suppressor', 70), player()).mode, 'hold');
  assert.equal(system.intent(enemy('bomber', 18), player()).mode, 'retreat');
});

test('failed expedition keeps equipped and insured items only', () => {
  const cargo = new core.LootAndCargoSystem(6);
  cargo.add({ id: 'module-a', category: 'equipment', insured: false, rarity: 'common' });
  cargo.add({ id: 'collection-first', category: 'cosmetic', insured: false, rarity: 'rare', firstDiscovery: true });
  const settlement = cargo.settleExpedition('failed');
  assert.deepEqual(settlement.kept.map((item) => item.id), ['collection-first']);
  assert.deepEqual(settlement.lost.map((item) => item.id), ['module-a']);
});
```

- [ ] **Step 2: Run simulation tests and verify failure**

Run: `cd SpaceFight-Cocos && npm run test:simulation`

Expected: FAIL because the systems are absent.

- [ ] **Step 3: Implement readable enemy intents**

Define roles `interceptor`, `suppressor`, `bomber`, `support`, and `elite`. `EnemyIntent.mode` is `close | flank | hold | retreat | support`; include desired velocity, telegraph seconds, and fire permission. Replace straight-line chase with role intent, seeded flank side, and minimum separation. Every damaging attack has at least 250ms visible telegraph except point-blank collision damage.

- [ ] **Step 4: Implement typed loot and cargo settlement**

Define categories `equipment | material | currency | intel | cosmetic`, fixed cargo capacity, insurance flags, first-discovery protection, and deterministic drops based on enemy role/event kind. `settleExpedition('returned')` keeps all cargo; `failed` keeps insured, equipped, key, and first-discovery items only.

- [ ] **Step 5: Integrate systems into combat snapshots**

Expose enemy role/intent for presenters, cargo capacity/used slots, nearby loot, and provisional return rewards. Destroyed enemies enqueue typed loot rather than only adding score. Keep score as a derived session statistic, not progression currency.

- [ ] **Step 6: Run tests**

Run: `cd SpaceFight-Cocos && npm run test:simulation && cd .. && node --test tests/spacefight_playability_contract.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/core/EnemyBehaviorSystem.ts SpaceFight-Cocos/assets/scripts/core/EnemyBehaviorSystem.ts.meta SpaceFight-Cocos/assets/scripts/core/LootAndCargoSystem.ts SpaceFight-Cocos/assets/scripts/core/LootAndCargoSystem.ts.meta SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts SpaceFight-Cocos/tools/run-simulation-tests.js tests/spacefight_cocos_simulation.test.js tests/spacefight_playability_contract.test.js
git commit -m "feat: add enemy roles and expedition cargo risk"
```

---

### Task 6: Native Expedition HUD and Contextual Return Control

**Files:**
- Modify: `SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/ui/Localization.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CocosRuntime.d.ts`
- Test: `tests/spacefight_native_loadout_hud.test.js`
- Test: `tests/spacefight_web_shell_responsive.test.js`
- Test: `tests/spacefight_localization.test.js`

**Interfaces:**
- Consumes: expedition/cargo/enemy snapshots from Tasks 4-5.
- Produces: native objective strip, cargo strip, target-role health display, and `returnRequested` input.

- [ ] **Step 1: Write failing HUD contract tests**

Assert the HUD contains `ExpeditionObjectiveStrip`, `CargoStrip`, `ReturnAction`, target role/health, and no legacy wave label. Assert all eight locale dictionaries contain the new objective, cargo, and return keys.

- [ ] **Step 2: Run HUD/localization tests and verify failure**

Run: `node --test tests/spacefight_native_loadout_hud.test.js tests/spacefight_web_shell_responsive.test.js tests/spacefight_localization.test.js`

Expected: FAIL because expedition HUD keys and controls are absent.

- [ ] **Step 3: Build restrained native HUD components**

Use Cocos `Graphics`, `Label`, and `UITransform` with 1px separators and no glowing discs. Add:

- top-left objective strip with phase and progress;
- top-right cargo usage and risk state;
- target role, health, shield, and telegraph near the reticle;
- a contextual `返航` control only when `canReturn` is true;
- return hold progress around the control;
- compact pause and camera icon buttons inside safe insets.

Desktop must not show touch controls. Mobile layouts must derive every position from safe insets and visible size.

- [ ] **Step 4: Add all eight localized strings**

Add exact semantic keys rather than concatenated text: `expedition.primary`, `expedition.decision`, `expedition.deepZone`, `expedition.return`, `cargo.capacity`, `cargo.atRisk`, `target.role.*`, and `tutorial.return`. Keep Chinese, English, Japanese, Korean, Spanish, French, German, and Russian dictionaries complete.

- [ ] **Step 5: Wire return input**

Add a contextual return action to touch/browser input and normalize it through `FlightCommandInput.returnRequested`; holding the button is a command state, while the six-second progress remains simulation-owned.

- [ ] **Step 6: Run HUD, localization, responsive, input, and simulation tests**

Run: `cd SpaceFight-Cocos && npm run test:input && npm run test:simulation && cd .. && node --test tests/spacefight_native_loadout_hud.test.js tests/spacefight_web_shell_responsive.test.js tests/spacefight_localization.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts SpaceFight-Cocos/assets/scripts/input/BrowserInputBridge.ts SpaceFight-Cocos/assets/scripts/ui/Localization.ts SpaceFight-Cocos/assets/scripts/game/CocosRuntime.d.ts tests/spacefight_native_loadout_hud.test.js tests/spacefight_web_shell_responsive.test.js tests/spacefight_localization.test.js
git commit -m "feat: add native expedition combat HUD"
```

---

### Task 7: Version, Verification, Native Builds, and Delivery Record

**Files:**
- Modify: `SpaceFight-Cocos/package.json`
- Modify: `SpaceFight-Cocos/settings/v2/packages/project.json`
- Modify: `SpaceFight-Cocos/native/engine/android/app/build.gradle`
- Modify: `SpaceFight-Cocos/native/engine/harmonyos-next/AppScope/app.json5`
- Modify: `HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/app.json5`
- Modify: `docs/spacefight/COCOS_REFACTOR_LOG.md`
- Modify: `website/api/apps/manifest.json` only after native smoke tests pass
- Modify: `website/api/data/*` changelog selected by the existing website changelog convention if website downloads change
- Create: versioned build logs and screenshots under the existing SpaceFight process-artifact directory
- Test: all `tests/spacefight_*.test.js`

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: `0.10.23 build 42` verified build artifacts and an auditable delivery record.

- [ ] **Step 1: Bump version metadata**

Set `SpaceFight-Cocos/package.json` to:

```json
{
  "version": "0.10.23",
  "build": 42
}
```

Apply the same version/build to `settings/v2/packages/project.json`, Android `versionName`/`versionCode`, both HarmonyOS app manifests, and generated native metadata. Do not touch Apple release metadata unless an Apple package is built in this batch.

- [ ] **Step 2: Run the full test suite**

Run: `node --test tests/spacefight_*.test.js`

Expected: all tests PASS with zero skipped startup/input/playability tests.

- [ ] **Step 3: Build web release and native release packages**

Run the existing repository build entry points:

```bash
cd SpaceFight-Cocos
npm run build:web:release
npm run build:native:android
npm run build:native:harmony-offline
npm run package:native:harmony-offline-release
```

Capture complete stdout/stderr to versioned logs without hiding failures.

- [ ] **Step 4: Verify signatures and package identity**

Verify Android signing certificate/package and HarmonyOS outer `.app`, inner `.hap`, profile, bundle name `cn.zhengzhengstudio.spacefight.huawei`, version `0.10.23`, and build `42`. Record SHA-256 for each deliverable.

- [ ] **Step 5: Smoke test Android and HarmonyOS**

Install clean release builds, cold start, reach the native combat HUD, move with the joystick, turn the camera, fire, pause, release every touch, and confirm no input remains held. Simulate or temporarily remove the low-detail interceptor asset and confirm combat still starts with fallback visuals.

- [ ] **Step 6: Capture responsive evidence**

Capture 1920×1080 desktop, common landscape phone, and tablet screenshots for startup, combat HUD, joystick full travel, return decision, and settlement. Check that controls remain inside safe insets and that desktop has no joystick.

- [ ] **Step 7: Publish only verified artifacts**

After smoke tests pass, copy APK/HAP/APP files into the existing `website/api/apps` download paths, update `manifest.json`, the download center, and the website changelog. Run `sync_to_termux.js` with package extensions enabled and confirm the remote hashes match; exclude the Citiescapes IPA as previously required.

- [ ] **Step 8: Update process log**

Append version, commits, tests, build commands, signature identities, hashes, device results, known limitations, and absolute screenshot links to `docs/spacefight/COCOS_REFACTOR_LOG.md`.

- [ ] **Step 9: Commit release metadata and records**

```bash
git add SpaceFight-Cocos/package.json SpaceFight-Cocos/settings/v2/packages/project.json SpaceFight-Cocos/native/engine/android/app/build.gradle SpaceFight-Cocos/native/engine/harmonyos-next/AppScope/app.json5 HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/app.json5 docs/spacefight/COCOS_REFACTOR_LOG.md website/api/apps/manifest.json website/api/data
git commit -m "release: prepare SpaceFight 0.10.23 playability build"
```
