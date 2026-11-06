# SpaceFight 0.8 Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a polished tactical-cinematic SpaceFight 0.8 experience on web, Android, iOS, macOS, and HarmonyOS, with native offline-first apps and rebuilt downloadable packages.

**Architecture:** Preserve each platform's existing renderer and local battle simulator, but unify their visual hierarchy, mission model, HUD composition, asset naming, and release metadata. Web remains Three.js plus optimized sprites; Android remains View/Canvas; Apple remains UIKit/AppKit plus SpriteKit; HarmonyOS remains ArkUI plus Canvas. Native clients call JSON APIs for passport and updates but never load website UI.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Three.js, Kotlin Android View/Canvas, Swift UIKit/AppKit/SpriteKit, ArkTS ArkUI/Canvas, Node.js tests, Gradle/JDK 21, Swift compiler/Xcode SDK, DevEco Hvigor.

## Global Constraints

- Package identifier is exactly `cn.zhengzhengstudio.spacefight` on every native platform.
- Release is exactly `0.8.0`, build `10`.
- Offline missions run locally at 60 Hz and do not open WebSocket connections.
- Native apps contain no WebView, WKWebView, ArkWeb, bundled HTML, or website UI.
- One amber action accent is used throughout; cyan is limited to shield and navigation telemetry.
- Primary screens contain no emoji controls, generic dashboard cards, placeholder geometry, or CSS-built weapon illustrations.
- Web changes require an entry in `website/api/data/changelogs.json`.
- Existing unrelated worktree changes must remain untouched.

---

### Task 1: Cross-Platform Product Contracts

**Files:**
- Create: `tests/spacefight_product_contract.test.js`
- Create: `tests/spacefight_release_contract.test.js`

**Interfaces:**
- Consumes: the current five platform source trees and both app distribution directories.
- Produces: executable contract checks for native boundaries, version identity, assets, SVG use, manifest integrity, and package parity.

- [ ] **Step 1: Add source contract tests**

Use Node's built-in test runner to assert that native sources do not contain `WebView`, `WKWebView`, `ArkWeb`, or a `spacefight.zhengzhengstudio.cn` page load; that offline mode labels exist; that web weapon items reference five SVG files; and that all platform source versions equal `0.8.0` build `10`.

```js
test('native clients never embed the website', () => {
  for (const source of nativeSources) {
    assert.doesNotMatch(read(source), /\b(?:WKWebView|WebView|ArkWeb)\b/);
  }
});

test('release identity is consistent', () => {
  for (const source of versionSources) {
    assert.match(read(source), /0\.8\.0/);
    assert.match(read(source), /(?:build|versionCode|APP_BUILD)[^\n]*10/i);
  }
});
```

- [ ] **Step 2: Run contracts and record the expected baseline failure**

Run: `node --test tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js`

Expected: FAIL because sources and manifests still declare `0.7.0` build `9`, and the new release packages do not exist.

- [ ] **Step 3: Commit the contract tests**

```bash
git add tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js
git commit -m "test: define SpaceFight 0.8 product contracts"
```

### Task 2: Web Flight Deck And Combat Presentation

**Files:**
- Modify: `website/spacefight.zhengzhengstudio.cn/index.html`
- Modify: `website/spacefight.zhengzhengstudio.cn/css/style.css`
- Modify: `website/spacefight.zhengzhengstudio.cn/js/app-shell.js`
- Modify: `website/spacefight.zhengzhengstudio.cn/js/renderer.js`
- Modify: `website/spacefight.zhengzhengstudio.cn/js/game.js`
- Modify: `website/spacefight.zhengzhengstudio.cn/js/sim.js`
- Modify: `website/api/data/changelogs.json`

**Interfaces:**
- Consumes: existing GLB models, rendered ship sprites, battlefield image, and SVG icon set.
- Produces: a full-bleed flight deck, edge-anchored tactical HUD, cinematic hit/engine feedback, and responsive touch layout.

- [ ] **Step 1: Add DOM contract assertions for the flight deck and HUD**

Extend `tests/spacefight_product_contract.test.js` to require `mission-rail`, `ship-dossier`, `threat-indicator`, `combat-vignette`, five SVG weapon icons, and the absence of visible app utility controls while `#hud` is active.

- [ ] **Step 2: Run the web contract and verify the new selectors fail**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL naming the missing flight deck or HUD selector.

- [ ] **Step 3: Restructure the flight deck and HUD markup**

Keep the battlefield full-bleed. Place the SpaceFight mark and mission rail on the lower-left visual axis, a selected-ship dossier on the opposite edge, and one launch command at the bottom. Move combat bars to the upper-left, score/wave/objective to upper-right, weapon rail to the lower edge, and leave the center clear except for reticle and threat direction.

- [ ] **Step 4: Replace the remaining legacy CSS layer**

Consolidate the duplicate `#spacefight-appbar`, `.logo-icon`, `.weapon-*::before`, and old card rules. Use 0-4 px corners, thin neutral rules, amber active state, tabular numbers, explicit desktop/mobile grids, and no stacked cards.

- [ ] **Step 5: Add restrained cinematic feedback**

Drive engine intensity, projectile trails, hit flash, damage vignette, target lock, and short camera impulse from simulator events. Clamp opacity and duration so effects never obscure targets or touch controls.

- [ ] **Step 6: Run browser verification**

Run Playwright at `1440x900`, `390x844`, and `844x390`. Assert zero failed requests and console errors, all SVG images have non-zero natural dimensions, controls remain inside the viewport, the app toolbar hides in combat, local simulation advances, and touch controls appear only on touch viewports.

- [ ] **Step 7: Commit the web presentation**

```bash
git add website/spacefight.zhengzhengstudio.cn website/api/data/changelogs.json tests/spacefight_product_contract.test.js
git commit -m "feat: rebuild SpaceFight flight deck and combat HUD"
```

### Task 3: Shared Apple Battle Scene

**Files:**
- Modify: `apps/SpaceFightShared/NativeGameScene.swift`
- Modify: `apps/SpaceFightShared/Resources/ships/*.png`
- Modify: `apps/SpaceFightShared/Resources/spacefight-battlefield.png`

**Interfaces:**
- Consumes: `SFLocalBattle.step(dt:throttle:strafe:turn:boost:fire:weapon:) -> SFSnapshot`.
- Produces: a shared SpriteKit battle scene used unchanged by iOS and macOS, including edge HUD, threat cues, hit effects, and local-only mission execution.

- [ ] **Step 1: Add source assertions for Apple scene nodes**

Require named nodes `hud.health`, `hud.shield`, `hud.energy`, `hud.objective`, `hud.weapon`, `fx.damage`, and `fx.threat` in `tests/spacefight_product_contract.test.js`.

- [ ] **Step 2: Run the source contract and verify failure**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL because the shared scene does not yet expose the named HUD/effect nodes.

- [ ] **Step 3: Refactor the shared scene composition**

Split node construction into focused methods `buildBattlefield()`, `buildHUD()`, `buildTouchControls()`, and `buildEffects()`. Keep SpriteKit rendering native, use bundled ship images, apply consistent ship scale, and update nodes from `SFSnapshot` without recreating the hierarchy each frame.

- [ ] **Step 4: Make offline execution the default boundary**

Ensure `start(mode:name:)` calls `SFLocalBattle` for `solo`, `boss`, and `onslaught`; only the explicitly secondary `public` mode may call `SpaceFightSocket.connect`. No startup or offline path creates a WebSocket task.

- [ ] **Step 5: Type-check the shared scene**

Run the existing macOS `swiftc` build command from `apps/build_spacefight_apps.sh`.

Expected: successful executable creation with no Swift errors.

- [ ] **Step 6: Commit the Apple battle scene**

```bash
git add apps/SpaceFightShared tests/spacefight_product_contract.test.js
git commit -m "feat: add tactical cinematic Apple battle scene"
```

### Task 4: Native iOS And macOS Flight Decks

**Files:**
- Modify: `apps/SpaceFight-iOS/Sources/main.swift`
- Modify: `apps/SpaceFightMac/Sources/main.swift`

**Interfaces:**
- Consumes: `NativeGameScene.start(mode:name:)`, native passport JSON API, and app manifest JSON API.
- Produces: platform-native flight deck, profile, login, update, pause, and game-over presentation around the shared battle scene.

- [ ] **Step 1: Add shell source assertions**

Require one primary launch action, three offline mission choices, native symbol configuration, `0.8.0`, build `10`, and no URL-opening call for profile or passport actions.

- [ ] **Step 2: Run the source contract and verify failure**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL on old version or missing shell markers.

- [ ] **Step 3: Rebuild iOS layout with safe-area constraints**

Use an asymmetrical mission rail and ship presentation, compact top utility icons, one launch button, and landscape-safe touch targets. Profile, passport, update, and errors remain native sheets or panels.

- [ ] **Step 4: Rebuild macOS layout for keyboard and pointer use**

Use the same hierarchy with tighter density, hover/pressed states, keyboard focus, and visible selected mission. Do not mimic iOS control sizes on desktop.

- [ ] **Step 5: Compile both Apple clients**

Run: `bash apps/build_spacefight_apps.sh --apple-only` after adding the selective build flag in Task 7, or execute the two existing `swiftc` commands directly before that flag exists.

Expected: iOS and macOS binaries compile with native frameworks only.

- [ ] **Step 6: Commit both Apple shells**

```bash
git add apps/SpaceFight-iOS apps/SpaceFightMac tests/spacefight_product_contract.test.js
git commit -m "feat: redesign native SpaceFight Apple flight decks"
```

### Task 5: Native Android Experience

**Files:**
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt`
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/drawable/*.xml`
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/build.gradle.kts`

**Interfaces:**
- Consumes: `LocalBattle.reset(mode)` and `LocalBattle.step(dt, input)` in the existing native Activity source.
- Produces: an Android-native flight deck and Canvas battle HUD with bundled vector controls and no WebView.

- [ ] **Step 1: Extend the source contract for Android vectors and offline launch**

Require local drawable resources for profile, update, pause, and three weapon families; require `versionCode = 10`, `versionName = "0.8.0"`; reject an offline call to `newWebSocket`.

- [ ] **Step 2: Run the Android contract and verify failure**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL on old version and missing vector resources.

- [ ] **Step 3: Recompose the Activity shell**

Replace the generic horizontal top bar and boxed launch panel with a compact native command strip, mission rail, ship status, and one launch action over the bundled battlefield. Use vector drawables inside icon buttons with content descriptions.

- [ ] **Step 4: Recompose Canvas HUD and feedback**

Draw edge bars, objective telemetry, target/threat cues, weapon rail, engine bloom, hit flash, and damage vignette using stable pixel-independent dimensions. Preserve 60 Hz local state updates and touch controls.

- [ ] **Step 5: Build with LauncherX JDK 21**

Run: `JAVA_HOME="$HOME/Library/Application Support/LauncherX/LauncherX/DownloadedJRE/ZULU_JDK_21_OSX_X64/zulu-21.jdk/Contents/Home" ./gradlew :app:assembleDebug`

Expected: `app/build/outputs/apk/debug/app-debug.apk` exists and has package `cn.zhengzhengstudio.spacefight`.

- [ ] **Step 6: Commit Android changes**

```bash
git add ZhengZhengStudioApp/ZhengZhengStudioAndroid tests/spacefight_product_contract.test.js
git commit -m "feat: redesign native SpaceFight Android experience"
```

### Task 6: Native HarmonyOS Experience

**Files:**
- Modify: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets`
- Create: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/resources/base/media/profile.svg`
- Create: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/resources/base/media/update.svg`
- Create: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/resources/base/media/pause.svg`
- Modify: `HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5`

**Interfaces:**
- Consumes: the existing local battle state and Canvas renderer in `Index.ets`.
- Produces: an ArkUI-native flight deck and battle HUD with bundled vector media and local-first behavior.

- [ ] **Step 1: Extend source contracts for HarmonyOS native media**

Require the three SVG media files, `appVersion = '0.8.0'`, `appBuild = 10`, and no ArkWeb import or `Web()` component.

- [ ] **Step 2: Run the HarmonyOS contract and verify failure**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL on version and missing SVG media.

- [ ] **Step 3: Recompose the ArkUI shell**

Use `Stack`, `Row`, `Column`, `Canvas`, `Image`, and native dialogs only. Place the ship presentation behind the mission rail, use icon buttons for utility actions, and keep online collaboration secondary.

- [ ] **Step 4: Recompose Canvas HUD and touch controls**

Use edge telemetry, a compact lower weapon strip, two thumb controls, target cue, hit flash, damage vignette, and stable responsive bounds for phone, tablet, and 2-in-1 windows.

- [ ] **Step 5: Build the HAP**

Run: `bash HarmonyOS-App/SpaceFightHarmony/build-hap.sh`

Expected: a HAP exists under `entry/build/default/outputs/default/` and contains no ArkWeb module reference.

- [ ] **Step 6: Commit HarmonyOS changes**

```bash
git add HarmonyOS-App/SpaceFightHarmony tests/spacefight_product_contract.test.js
git commit -m "feat: redesign native SpaceFight HarmonyOS experience"
```

### Task 7: Release Build And Distribution Metadata

**Files:**
- Modify: `apps/build_spacefight_apps.sh`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `tests/spacefight_release_contract.test.js`

**Interfaces:**
- Consumes: four successful platform builds and version `0.8.0` build `10`.
- Produces: versioned/latest packages in both distribution directories with exact size and SHA-256 metadata.

- [ ] **Step 1: Update the release script and metadata notes**

Set `VERSION="0.8.0"` and `BUILD="10"`. Add selective build flags without changing the default all-platform behavior. Ensure notes describe the native flight deck, tactical HUD, cinematic feedback, bundled vector controls, and offline-first execution.

- [ ] **Step 2: Run all product contracts before packaging**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: PASS.

- [ ] **Step 3: Build all four packages**

Run: `bash apps/build_spacefight_apps.sh`

Expected: Android APK, macOS DMG, iOS IPA, and HarmonyOS HAP are copied into `website/api/apps` with both versioned and latest names.

- [ ] **Step 4: Validate package contents and metadata**

The release test must calculate SHA-256 and byte size for each versioned package, compare both app directories byte-for-byte, assert manifest build `10`, and scan unpacked native packages for forbidden web containers and bundled website files.

- [ ] **Step 5: Run release contracts**

Run: `node --test tests/spacefight_release_contract.test.js`

Expected: PASS for four platforms, eight aliases, two manifests, and two download indexes.

- [ ] **Step 6: Commit release metadata and packages**

Stage only SpaceFight release files and the changelog, leaving unrelated staged work untouched.

### Task 8: Visual Verification And Termux Sync

**Files:**
- Verify: all files modified by Tasks 2-7
- Verify: `sync_to_termux.js`

**Interfaces:**
- Consumes: completed web source, four native packages, and updated manifests.
- Produces: desktop/mobile screenshots, native runtime evidence where available, successful Termux uploads, and final delivery summary.

- [ ] **Step 1: Capture final web screenshots**

Use Playwright for `1440x900`, `390x844`, and `844x390` menu/combat states. Inspect screenshots and canvas pixels; reject blank scenes, clipped text, covered controls, or low-resolution ship scaling.

- [ ] **Step 2: Exercise the macOS app**

Launch the rebuilt `.app`, capture flight deck and combat screenshots, verify keyboard movement/fire/pause, and confirm no website process or web view exists in the app hierarchy.

- [ ] **Step 3: Validate iOS, Android, and HarmonyOS artifacts**

Run available simulator/device builds. Where a runtime is unavailable, inspect package contents, resource dimensions, identifiers, versions, signatures, and native source contracts; state that limitation explicitly.

- [ ] **Step 4: Sync changed web files and packages**

Run: `node sync_to_termux.js --watch-only --ip=192.168.124.12`, wait for the watcher baseline, then trigger and observe uploads for every changed web/release file. Require a success result for each package and metadata file before stopping the watcher.

- [ ] **Step 5: Verify remote files**

Fetch the SpaceFight HTML and SVG through the Termux host route. Send HEAD requests for every latest/versioned package and assert remote `Content-Length` matches local bytes.

- [ ] **Step 6: Run the full final verification set**

Run: `node --test tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js`, `node --check` for changed web scripts, `xmllint --noout` for SVG/XML assets, and package hash comparison.

Expected: all checks pass with no lingering build, browser, or sync processes.
