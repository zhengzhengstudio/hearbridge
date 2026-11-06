# Survival Diary Native Apps Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the approved world-first survival experience to Android, iOS, macOS, and HarmonyOS offline with native rendering, native lifecycle handling, platform-appropriate input, and shared content parity.

**Architecture:** Use the shared schema v4 fixture as the behavioral contract. Each native renderer owns presentation and input while reproducing the same normalized actions, content IDs, save lifecycle, quality profiles, and HUD hierarchy.

**Tech Stack:** Kotlin/Jetpack Compose/Canvas, Swift/SpriteKit/SwiftUI, ArkTS/ArkUI Canvas, Gradle, Swift Package Manager, Hvigor, Node contract tests.

## Global Constraints

- Native apps must not embed the Web game in a WebView.
- Mobile uses a closer 2.5D camera, one primary context action, one secondary action, and a five-slot belt.
- macOS uses desktop keyboard, mouse pan, and wheel zoom.
- HarmonyOS defaults to balanced or quality on mid/high-end devices; compatibility mode is never forced merely because the platform is HarmonyOS.
- Every platform loads the same items, recipes, resource IDs, building IDs, and save schema version.
- Existing progress survives restart and backgrounding; destructive restart requires a second confirmation.
- Every completed platform stage produces a real simulator, previewer, or native runtime screenshot and updates `docs/survival-diary/IMPLEMENTATION_LOG.md`.

---

### Task 1: Native Parity Fixture and Contract Gate

**Files:**
- Create: `apps/SurvivalDiaryShared/fixtures/real-game-v4.json`
- Modify: `tests/survival_diary_android_native.test.js`
- Modify: `tests/survival_diary_apple_native.test.js`
- Modify: `tests/survival_diary_harmony_native.test.js`

**Interfaces:**
- Produces fixture fields `schemaVersion`, `camera`, `qualityProfile`, `worldDrops`, `discoveries`, `hotbar`, `contextAction`, and `containers` for all native ports.

- [ ] **Step 1: Add failing native parity assertions**

```js
for (const source of [androidSource, appleSource, harmonySource]) {
  assert.match(source, /qualityProfile/);
  assert.match(source, /contextAction/);
  assert.match(source, /worldDrops/);
}
assert.equal(fixture.schemaVersion, 4);
```

- [ ] **Step 2: Verify all three native contract suites fail**

Run: `node --test tests/survival_diary_android_native.test.js tests/survival_diary_apple_native.test.js tests/survival_diary_harmony_native.test.js`  
Expected: FAIL on schema v4 fields.

- [ ] **Step 3: Add the deterministic v4 parity fixture**

```json
{
  "schemaVersion": 4,
  "qualityProfile": "balanced",
  "hotbar": ["stone-axe", "knife", "spear", null, null],
  "contextAction": { "kind": "harvest", "targetId": "reeds@8,7" },
  "worldDrops": {},
  "containers": {}
}
```

- [ ] **Step 4: Run parity tests and commit**

Run: `node --test tests/survival_diary_*_native.test.js`  
Expected: existing assertions pass; new assertions remain failing until each platform task completes.

```bash
git add apps/SurvivalDiaryShared/fixtures/real-game-v4.json tests/survival_diary_*_native.test.js
git commit -m "test(survival-diary): define native real-game parity"
```

### Task 2: Android World, Input, and HUD

**Files:**
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/NativeGameView.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/ChunkRenderer.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/WorldPresentation.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/Camera2D.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/TouchInputController.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/WorldPresentationTest.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/CameraTest.kt`

**Interfaces:**
- Produces Kotlin `GameInputAction` sealed interface and `ContextAction(kind, targetId, label, enabled)`.

- [ ] **Step 1: Add failing Android scale, depth, and gesture tests**

```kotlin
assertTrue(presentation.playerScreenHeightRatio in 0.08f..0.10f)
assertEquals(listOf("rock", "player", "tree"), presentation.depthSorted(ids))
assertEquals(GameInputAction.CameraZoom(1.2f), controller.onPinch(120f, 144f))
```

- [ ] **Step 2: Run Android unit tests**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest`  
Expected: FAIL on the new presentation/input assertions.

- [ ] **Step 3: Implement touch actions and a closer camera**

```kotlin
sealed interface GameInputAction {
  data class Move(val x: Float, val y: Float) : GameInputAction
  data class CameraPan(val dx: Float, val dy: Float) : GameInputAction
  data class CameraZoom(val factor: Float) : GameInputAction
  data object Primary : GameInputAction
}
```

- [ ] **Step 4: Replace equal-size entities with foot-anchored presentation bounds**

```kotlin
val scale = when (entity.kind) { TREE -> 1.65f; PLAYER -> 1.25f; ORE -> 0.9f; PICKUP -> 0.42f }
val footY = screenPosition.y + sprite.height * scale * 0.48f
```

- [ ] **Step 5: Replace dashboard HUD with mobile game HUD**

Keep compact vitals, collapsed minimap, five-slot belt, one context button, journal and backpack tabs; remove the permanent bottom navigation row.

- [ ] **Step 6: Run Android tests and assemble debug APK**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest assembleDebug`  
Expected: PASS and a native debug APK.

- [ ] **Step 7: Commit Android world/HUD**

```bash
git add apps/SurvivalDiary-Android tests/survival_diary_android_native.test.js
git commit -m "feat(survival-diary): rebuild Android game presentation"
```

### Task 3: Android Gameplay Pages, Save, and Quality

**Files:**
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/InventoryScreen.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/CraftingScreen.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/StorageScreen.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/QualityProfile.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/SaveLifecycleTest.kt`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/StorageRulesTest.kt`

**Interfaces:**
- Consumes: normalized Android input and fixture v4.
- Produces: `QualityProfile.AUTO/PERFORMANCE/BALANCED/QUALITY` and atomic current/previous save repository.

- [ ] **Step 1: Add failing restore, restart-confirmation, and profile tests**

```kotlin
assertEquals(previous, repository.loadOrRecover())
assertFalse(viewModel.restartGame(confirm = false))
assertEquals(QualityProfile.BALANCED, QualityPolicy.defaultFor(DeviceClass.HARMONY_EQUIVALENT_MID_HIGH))
```

- [ ] **Step 2: Run failing Android lifecycle tests**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest`  
Expected: FAIL on atomic recovery/profile policy.

- [ ] **Step 3: Implement atomic current/previous saves**

```kotlin
fun save(value: GameSave) { previousFile.replaceWith(currentFile); tempFile.writeText(json.encodeToString(value)); tempFile.renameTo(currentFile) }
fun loadOrRecover(): GameSave = decode(currentFile) ?: decode(previousFile) ?: createNewSave()
```

- [ ] **Step 4: Implement full-screen inventory/crafting/storage and drag transfer**

Use the same item IDs and capacities as schema v4; do not duplicate recipe rules in Composables.

- [ ] **Step 5: Run Android lifecycle and UI contract suites**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest`  
Run: `node --test tests/survival_diary_android.test.js tests/survival_diary_android_native.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit Android pages/save**

```bash
git add apps/SurvivalDiary-Android tests/survival_diary_android*.test.js
git commit -m "feat(survival-diary): complete Android game lifecycle"
```

### Task 4: Apple SpriteKit World and Adaptive HUD

**Files:**
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/IslandScene.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/CameraController.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/InputController.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameHUD.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameContainerView.swift`
- Test: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryGameTests/SmokeTests.swift`

**Interfaces:**
- Produces Swift `GameInputAction`, `ContextAction`, and adaptive `GameHUDLayout.mobile/tablet/desktop`.

- [ ] **Step 1: Add failing SpriteKit depth/camera/HUD tests**

```swift
XCTAssertEqual(scene.zPosition(forFootY: 320), -320)
XCTAssertTrue((0.08...0.10).contains(scene.playerHeightRatio))
XCTAssertEqual(GameHUDLayout.forSize(.init(width: 390, height: 844)), .mobile)
```

- [ ] **Step 2: Run Apple tests**

Run: `cd apps/SurvivalDiary-Apple && swift test`  
Expected: FAIL on new layout and scene contracts.

- [ ] **Step 3: Implement platform input mapping**

```swift
enum GameInputAction: Equatable { case move(CGVector), cameraPan(CGVector), cameraZoom(CGFloat), primary, secondary, hotbar(Int) }
```

- [ ] **Step 4: Rebuild scene composition and restrained HUD**

Use foot-position z-order, per-kind scale tiers, foreground occlusion and one selected target. On iPhone use the mobile belt/context layout; on macOS use keyboard/mouse and edge-safe HUD.

- [ ] **Step 5: Run Swift and Node Apple contracts**

Run: `cd apps/SurvivalDiary-Apple && swift test`  
Run: `node --test tests/survival_diary_apple_native.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit Apple presentation**

```bash
git add apps/SurvivalDiary-Apple tests/survival_diary_apple_native.test.js
git commit -m "feat(survival-diary): rebuild Apple game presentation"
```

### Task 5: Apple Save, Pages, and Updates Surface

**Files:**
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/GameSave.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/SaveRepository.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameStore.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/DiaryBookView.swift`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/UpdateService.swift`
- Test: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryCoreTests/SmokeTests.swift`
- Test: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryOnlineTests/UpdateServiceTests.swift`

**Interfaces:**
- Consumes schema v4 and adaptive HUD.
- Produces recoverable save envelope and a non-blocking `UpdateNotice` model.

- [ ] **Step 1: Add failing save recovery and update notice tests**

```swift
XCTAssertEqual(try repository.loadOrRecover(), previousSave)
XCTAssertEqual(UpdateService.notice(current: 12, manifest: 13)?.presentation, .collapsible)
```

- [ ] **Step 2: Run failing Apple tests**

Run: `cd apps/SurvivalDiary-Apple && swift test`  
Expected: FAIL on recovery and collapsible update model.

- [ ] **Step 3: Implement atomic persistence and full game pages**

Store current/previous saves, pause world input while full pages are open, retain placement camera controls, and require confirmation before restart.

- [ ] **Step 4: Run Apple suites and commit**

Run: `cd apps/SurvivalDiary-Apple && swift test`  
Expected: PASS.

```bash
git add apps/SurvivalDiary-Apple
git commit -m "feat(survival-diary): complete Apple game lifecycle"
```

### Task 6: HarmonyOS Offline World, HUD, Save, and Quality

**Files:**
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/game/GameCanvas.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/game/InputController.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/game/QualityProfile.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/ui/GameHud.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/pages/Index.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/shared/model/GameSave.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/shared/data/SaveRepository.ets`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/test/FixtureParity.test.ets`
- Test: `tests/survival_diary_harmony_native.test.js`

**Interfaces:**
- Produces ArkTS `GameInputAction`, `ContextAction`, `QualityProfile` and schema v4 persistence.

- [ ] **Step 1: Add failing Harmony parity/profile assertions**

```ts
expect(QualityPolicy.defaultFor(DeviceClass.MID_HIGH)).assertEqual(QualityProfile.QUALITY)
expect(save.schemaVersion).assertEqual(4)
expect(hud.primaryActionCount).assertEqual(1)
```

- [ ] **Step 2: Run Harmony contract test**

Run: `node --test tests/survival_diary_harmony_native.test.js`  
Expected: FAIL because current HUD exposes many direct gather/craft buttons.

- [ ] **Step 3: Implement world input, depth sorting, and context targeting**

```ts
export type GameInputAction =
  | { kind: 'move', x: number, y: number }
  | { kind: 'camera-pan', dx: number, dy: number }
  | { kind: 'camera-zoom', factor: number }
  | { kind: 'primary' };
```

- [ ] **Step 4: Replace direct resource buttons with the approved HUD**

Keep compact vitals, time/weather, collapsed map, five-slot belt and one context action; move mode, crafting, restart and local-save controls into full pages.

- [ ] **Step 5: Implement mid/high default and rendering-only fallback**

```ts
const defaultProfile = deviceClass === DeviceClass.LOW ? QualityProfile.BALANCED : QualityProfile.QUALITY;
```

- [ ] **Step 6: Run ArkTS/Node tests and unsigned build validation**

Run: `node --test tests/survival_diary_harmony_native.test.js`  
Run: `cd apps/SurvivalDiary-HarmonyOS-Offline && hvigorw assembleHap --mode module -p product=default -p buildMode=release`  
Expected: contract PASS and release compilation reaches signing stage.

- [ ] **Step 7: Commit Harmony native redesign**

```bash
git add apps/SurvivalDiary-HarmonyOS-Offline tests/survival_diary_harmony_native.test.js
git commit -m "feat(survival-diary): rebuild HarmonyOS offline game"
```

### Task 7: Native Runtime Evidence

**Files:**
- Create: `docs/survival-diary/screenshots/2026-08-03-android-real-game.png`
- Create: `docs/survival-diary/screenshots/2026-08-03-ios-real-game.png`
- Create: `docs/survival-diary/screenshots/2026-08-03-macos-real-game.png`
- Create: `docs/survival-diary/screenshots/2026-08-03-harmony-real-game.png`
- Modify: `docs/survival-diary/IMPLEMENTATION_LOG.md`

**Interfaces:**
- Produces real native runtime or official platform preview evidence.

- [ ] **Step 1: Run all native unit and contract suites**

Run Android Gradle tests, `swift test`, Harmony fixture tests, and the three Node native contract files.  
Expected: PASS.

- [ ] **Step 2: Capture one active gameplay state per platform**

Each image must show a visible character, non-zero vitals, one selected target, varied entity scale, continuous terrain and the platform-appropriate HUD.

- [ ] **Step 3: Record results and limitations**

Append exact commands, pass counts, screenshot links, and any signing limitation to `IMPLEMENTATION_LOG.md`.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/survival-diary
git commit -m "docs(survival-diary): record native redesign evidence"
```

