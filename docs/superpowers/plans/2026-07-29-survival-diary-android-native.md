# Survival Diary Android Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Kotlin/Compose Android game that renders and plays Survival Diary natively, migrates the old shell save, and supports compliant updates.

**Architecture:** A new `apps/SurvivalDiary-Android` project isolates the product from Life Diary. Pure Kotlin domain code consumes copied canonical JSON and golden fixtures; Compose owns menus/HUD/diary while `NativeGameView` owns Canvas rendering and touch transforms.

**Tech Stack:** Kotlin, Android SDK 34, minSdk 26, Jetpack Compose, Kotlin serialization, Canvas, Room/DataStore, OkHttp/WebSocket, JUnit.

## Global Constraints

- Application ID is `cn.zhengzhengstudio.survivaldiary`.
- Version is `0.3.0`, `versionCode 3`.
- No `android.webkit.WebView` import or bundled HTML/JavaScript game.
- New local install defaults to guided mode.
- Website-distributed APK may open PackageInstaller only after user confirmation.
- Google Play flavor must not request `REQUEST_INSTALL_PACKAGES`.

---

### Task 1: Create the Isolated Native Project

**Files:**
- Create: `apps/SurvivalDiary-Android/settings.gradle.kts`
- Create: `apps/SurvivalDiary-Android/build.gradle.kts`
- Create: `apps/SurvivalDiary-Android/app/build.gradle.kts`
- Create: `apps/SurvivalDiary-Android/app/src/main/AndroidManifest.xml`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/MainActivity.kt`
- Create: `tests/survival_diary_native_clients.test.js`

**Interfaces:**
- Produces: `MainActivity` hosting `SurvivalDiaryApp()`.

- [ ] **Step 1: Write a failing source contract**

```js
test('Android game is native and product-isolated', () => {
  const files = readTree('apps/SurvivalDiary-Android');
  assert.match(files, /NativeGameView\\.kt/);
  assert.doesNotMatch(files, /android\\.webkit|WebView|file:\\/\\/\\/android_asset/);
  assert.match(read('app/build.gradle.kts'), /applicationId = "cn\\.zhengzhengstudio\\.survivaldiary"/);
});
```

- [ ] **Step 2: Verify failure**

Run `node --test tests/survival_diary_native_clients.test.js`.

- [ ] **Step 3: Add Compose project configuration**

Use `compileSdk = 34`, `minSdk = 26`, `targetSdk = 34`, `versionName = "0.3.0"`, and `versionCode = 3`. Add `website` and `play` product flavors; only `website` declares installer permission through a flavor manifest.

- [ ] **Step 4: Build the empty native shell**

Run:

```bash
cd apps/SurvivalDiary-Android
./gradlew :app:assembleWebsiteDebug
```

Expected: APK builds and contains no WebView classes.

- [ ] **Step 5: Commit**

```bash
git add apps/SurvivalDiary-Android tests/survival_diary_native_clients.test.js
git commit -m "feat: scaffold native Survival Diary Android"
```

### Task 2: Implement Kotlin Save v2 and Fixture Parity

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/Simulation.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt`
- Create: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/FixtureParityTest.kt`

**Interfaces:**
- Produces: `Simulation.create(seed, playMode)`, `Simulation.step(save, command)`, `SaveRepository.load(slot)`, `SaveRepository.save(slot, save)`.

- [ ] **Step 1: Write failing fixture test**

```kotlin
@Test fun goldenFixtureMatches() {
    val fixture = fixture("world-v2-seed-20260729.json")
    val result = fixture.commands.fold(Simulation.create(fixture.seed, PlayMode.GUIDED), Simulation::step)
    assertEquals(fixture.expectedDigest, result.stableDigest())
}
```

- [ ] **Step 2: Implement v2 serializable models and deterministic hashing**

Use integer time, fixed ordering for maps, and the canonical content JSON copied by a Gradle `syncSurvivalDiaryContent` task into `generated/res/raw`.

- [ ] **Step 3: Implement atomic local saves and legacy import**

Write pending/current/previous files under app-private storage. On first native run, offer import from the old product’s exported v1 JSON; never read another app sandbox directly.

- [ ] **Step 4: Run and commit**

```bash
./gradlew :app:testWebsiteDebugUnitTest
git add apps/SurvivalDiary-Android
git commit -m "feat: add Android Survival Diary domain"
```

### Task 3: Render the Native 2.5D World and Camera

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/NativeGameView.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/Camera2D.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/Atlas.kt`
- Create: `apps/SurvivalDiary-Android/app/src/androidTest/java/cn/zhengzhengstudio/survivaldiary/CameraGestureTest.kt`

**Interfaces:**
- Produces: `Camera2D.worldToScreen`, `screenToWorld`, `zoomBy`, `rotateQuarterTurn`.

- [ ] **Step 1: Write failing transform and gesture tests**

Assert reversible transforms, zoom range 0.35–3.0, two-finger zoom, drag pan, four rotations, and identical scale for actors/buildings.

- [ ] **Step 2: Implement Canvas renderer**

`NativeGameView.onDraw` renders terrain chunks, entities, actors, shadows, precipitation, fog, and screen-space markers using one camera matrix. Load WebP atlases from Android resources; do not rasterize SVG world items.

- [ ] **Step 3: Add touch input and LOD**

One finger moves/selects according to active control region; two fingers pan/zoom; rotation uses a dedicated accessible button. LOD reduces vegetation and animation frames only.

- [ ] **Step 4: Run and commit**

```bash
./gradlew :app:testWebsiteDebugUnitTest :app:connectedWebsiteDebugAndroidTest
git add apps/SurvivalDiary-Android
git commit -m "feat: render Survival Diary natively on Android"
```

### Task 4: Add Compose HUD, A/B Mode, Placement, and Diary

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/DiaryScreen.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/PlacementControls.kt`
- Create: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/PlayModeTest.kt`

**Interfaces:**
- `GameViewModel` exposes `StateFlow<GameUiState>` and actions `setPlayMode`, `craft`, `beginPlacement`, `confirmPlacement`, `writeDiary`.

- [ ] **Step 1: Write failing default/switch test**

```kotlin
@Test fun switchingModePreservesIsland() {
    val before = viewModel.state.value.save
    viewModel.setPlayMode(PlayMode.FREE)
    val after = viewModel.state.value.save
    assertEquals(before.entities, after.entities)
    assertEquals(PlayMode.FREE, after.playMode)
}
```

- [ ] **Step 2: Implement thumb-reachable phone HUD and adaptive tablet layout**

Keep status/time/weather at top, quickbar at bottom, movement left, contextual actions right, and diary as a full-screen destination. Use 48dp touch targets and safe insets.

- [ ] **Step 3: Implement placement and diary**

Preview reason text comes from domain validation. Diary pages render facts, authored text, discoveries, map notes, build album, and friend visits without requiring network.

- [ ] **Step 4: Run and commit**

```bash
./gradlew :app:testWebsiteDebugUnitTest :app:connectedWebsiteDebugAndroidTest
git add apps/SurvivalDiary-Android
git commit -m "feat: add Android game HUD and diary"
```

### Task 5: Add Online Services and Compliant Updates

**Files:**
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/SurvivalApi.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/ReconnectQueue.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/UpdateRepository.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/ReleasePushService.kt`
- Create: `apps/SurvivalDiary-Android/app/src/website/AndroidManifest.xml`
- Create: `apps/SurvivalDiary-Android/app/src/play/AndroidManifest.xml`
- Create: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/UpdateRepositoryTest.kt`

**Interfaces:**
- Produces: `check(currentVersion, currentBuild)`, `downloadAndVerify(update)`, `openInstaller(file)`.

- [ ] **Step 1: Write failing version and channel tests**

Verify semantic version/build comparison, SHA-256 rejection, signature mismatch rejection, Website installer intent, and Play store-link behavior.

- [ ] **Step 2: Implement Passport, friends, cloud save, and reconnect queue**

Persist tokens in Android Keystore-backed encrypted storage. Each queued command has an event ID and base revision.

- [ ] **Step 3: Implement update channel separation**

Website flavor downloads to `Downloads/SurvivalDiary/` and invokes PackageInstaller after explicit tap. Play flavor has no installer permission and opens its Play listing.

- [ ] **Step 4: Register opt-in release push**

`ReleasePushService` registers the FCM token and current build with `/push/subscriptions`. On a release message it reads `BuildConfig.MANIFEST_URL`, runs `UpdateRepository.check`, and ignores any download URL carried by the push payload.

- [ ] **Step 5: Run and commit**

```bash
./gradlew :app:testWebsiteDebugUnitTest :app:testPlayDebugUnitTest
git add apps/SurvivalDiary-Android
git commit -m "feat: add Android online play and updates"
```

### Task 6: Android Native Acceptance Gate

**Files:**
- Create: `tests/survival_diary_android_native.test.js`

- [ ] **Step 1: Add APK/source acceptance checks**

Check identity, version/build, native class presence, absence of WebView/HTML/JS assets, atlas assets, non-debuggable release configuration, flavor permissions, and signing env indirection.

- [ ] **Step 2: Run all Android checks**

```bash
node --test tests/survival_diary_native_clients.test.js tests/survival_diary_android_native.test.js
cd apps/SurvivalDiary-Android
./gradlew clean :app:testWebsiteDebugUnitTest :app:testPlayDebugUnitTest :app:assembleWebsiteRelease :app:assemblePlayRelease
```

Expected: source and unit tests pass; release builds either sign with provided credentials or fail with an explicit missing-credential message.

- [ ] **Step 3: Commit**

```bash
git add tests/survival_diary_android_native.test.js apps/SurvivalDiary-Android
git commit -m "test: verify native Survival Diary Android"
```
