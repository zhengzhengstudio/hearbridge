# SpaceFight Cocos 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split web/native 2D implementations with one landscape-only Cocos Creator 3.8.8 3D game core and ship a signed HarmonyOS offline APP/HAP vertical slice.

**Architecture:** A new `SpaceFight-Cocos` project owns simulation, rendering, input, HUD, mission flow, and platform build configuration. Platform adapters only handle orientation, safe areas, haptics, lifecycle, update metadata, and package signing; the existing clients stay untouched until the Cocos vertical slice passes the playability gate.

**Tech Stack:** Cocos Creator 3.8.8, TypeScript, Cocos Physics/Bullet, WebGL2, Cocos native C++ runtime, Gradle/JDK 21, Xcode, DevEco Studio/Hvigor, `hap-sign-tool.jar`.

## Global Constraints

- Release version is `0.10.0`, build `18`.
- Mobile and tablet gameplay is landscape-only; portrait displays a rotate-device gate.
- Native apps must not load the SpaceFight website and must not contain a WebView.
- Offline mode does not require a passport and does not make login, update, or multiplayer requests.
- The player can switch between cockpit and chase cameras while preserving one weapon ray and one projectile origin.
- HarmonyOS offline bundle ID remains `cn.zhengzhengstudio.spacefight.hmos.offline`.
- Preserve the verified legacy backup at `/Users/ljg/Downloads/SpaceFight-legacy-backup-20260801-130849.tar.gz`.

---

### Task 1: Install and prove the Cocos toolchain

**Files:**
- Create: `SpaceFight-Cocos/package.json`
- Create: `SpaceFight-Cocos/tsconfig.json`
- Create: `SpaceFight-Cocos/settings/v2/packages/project.json`
- Create: `SpaceFight-Cocos/tools/check-toolchain.js`
- Test: `tests/spacefight_cocos_toolchain.test.js`

**Interfaces:**
- Produces: `check-toolchain.js`, which prints JSON containing `creatorVersion`, `deveco`, `jdk21`, `xcode`, and supported build targets.

- [ ] Write a failing Node test requiring Creator `3.8.8`, DevEco, JDK 21, Xcode, and the Harmony sign tool.
- [ ] Run `node --test tests/spacefight_cocos_toolchain.test.js` and confirm the missing Cocos project/toolchain failure.
- [ ] Install the official Cocos Creator 3.8.8 macOS build under `/Applications/Cocos/Creator/3.8.8/` and scaffold the project metadata.
- [ ] Implement `check-toolchain.js` without embedding passwords or signing secrets.
- [ ] Run the toolchain test and a Creator project-open/import check.

### Task 2: Define the shared flight command and deterministic combat core

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts`
- Create: `SpaceFight-Cocos/assets/scripts/core/WeaponCatalog.ts`
- Create: `SpaceFight-Cocos/assets/data/missions/vertical-slice.json`
- Test: `tests/spacefight_cocos_simulation.test.js`

**Interfaces:**
- Produces: `FlightCommand` with `throttle`, `strafe`, `yaw`, `pitch`, `boost`, `primaryFire`, `secondaryFire`, `cameraToggle`, and `pause`.
- Produces: fixed-step `CombatSimulation.step(command, delta)` snapshots consumed by scene presentation and later networking.

- [ ] Write failing tests for neutral input, clamping, fixed-step movement, cooldowns, projectile origin, damage, and mission completion.
- [ ] Implement command normalization and shared tuning constants.
- [ ] Implement the minimum deterministic player, enemy, projectile, pickup, and mission state.
- [ ] Verify identical snapshots for the same seed and command stream.

### Task 3: Build the real 3D combat scene

**Files:**
- Create: `SpaceFight-Cocos/assets/scenes/Combat.scene`
- Create: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Create: `SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts`
- Create: `SpaceFight-Cocos/assets/scripts/game/ProjectilePresenter.ts`
- Create: `SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts`
- Copy: approved GLB assets from `website/spacefight.zhengzhengstudio.cn/assets/models/`
- Test: `tests/spacefight_cocos_scene_contract.test.js`

**Interfaces:**
- Consumes: `CombatSimulation` snapshots.
- Produces: pooled ship/projectile nodes, true muzzle transforms, station/debris chunks, and a playable `Combat.scene`.

- [ ] Write scene-contract tests for camera, lighting, player, muzzle, colliders, pooled projectiles, and world chunks.
- [ ] Import the interceptor and enemy GLBs, normalize scale/orientation, and reject missing or fallback primitive player models.
- [ ] Add directional/key lighting, environment lighting, shadows, speed particles, damage feedback, and projectile trails.
- [ ] Implement chunk recycling around the player without a visible fixed arena boundary.
- [ ] Run the scene in Creator and confirm nonblank moving pixels at 1920x1080 and 1280x720.

### Task 4: Unify desktop and touch controls

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/input/InputRouter.ts`
- Create: `SpaceFight-Cocos/assets/scripts/input/DesktopFlightInput.ts`
- Create: `SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts`
- Create: `SpaceFight-Cocos/assets/scripts/input/InputSettings.ts`
- Create: `SpaceFight-Cocos/assets/prefabs/ui/TouchControls.prefab`
- Test: `tests/spacefight_cocos_input.test.js`

**Interfaces:**
- Produces: one normalized `FlightCommand` per rendered frame.
- Touch input tracks movement, look, primary fire, secondary fire, and boost by pointer ID independently.

- [ ] Write failing tests for mouse delta, pointer lock release, composition-key filtering, fixed left stick, relative right swipe, and three-finger independence.
- [ ] Implement desktop pointer lock and keyboard mapping with lifecycle cleanup.
- [ ] Implement a fixed left stick, relative right-side look surface, and safe-area action buttons.
- [ ] Add sensitivity, invert-Y, left-handed layout, and control-scale persistence.
- [ ] Verify that ending one touch does not clear the other active controls.

### Task 5: Add chase/cockpit cameras and game HUD

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/camera/FlightCameraRig.ts`
- Create: `SpaceFight-Cocos/assets/scripts/ui/CombatHud.ts`
- Create: `SpaceFight-Cocos/assets/scripts/ui/PauseController.ts`
- Create: `SpaceFight-Cocos/assets/prefabs/ui/CombatHud.prefab`
- Create: `SpaceFight-Cocos/assets/prefabs/ui/PauseMenu.prefab`
- Test: `tests/spacefight_cocos_camera_hud.test.js`

**Interfaces:**
- Consumes: player transform, muzzle transform, weapon ray, and combat snapshot.
- Produces: cockpit/chase camera poses, ballistic reticle, edge HUD, radar, and pause state.

- [ ] Write failing tests that camera switching never changes projectile direction or muzzle origin.
- [ ] Implement chase damping, cockpit mount, FOV response, light roll feedback, and view persistence.
- [ ] Project the weapon ray into the reticle and show convergence only when muzzle and target align.
- [ ] Build the landscape HUD without nested cards or center-screen panels.
- [ ] Ensure pause freezes simulation, releases held inputs, and exposes resume/settings/restart/hangar actions.

### Task 6: Enforce landscape across every target

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/platform/OrientationGate.ts`
- Create: `SpaceFight-Cocos/build-templates/web-mobile/index.ejs`
- Create: `SpaceFight-Cocos/build-templates/jsb-link/frameworks/runtime-src/proj.android-studio/app/AndroidManifest.xml`
- Create: `SpaceFight-Cocos/tools/patch-apple-orientation.js`
- Create: `SpaceFight-Cocos/tools/patch-harmony-orientation.js`
- Test: `tests/spacefight_cocos_landscape.test.js`

**Interfaces:**
- Produces: web portrait gate and native manifests restricted to landscape directions.

- [ ] Write failing artifact tests for web CSS/JS, Android `sensorLandscape`, iOS landscape masks, and Harmony Ability orientation.
- [ ] Implement the web rotate-device gate and fullscreen orientation lock attempt.
- [ ] Add native template/patch scripts for Android, Apple, and HarmonyOS Next.
- [ ] Verify 16:9, 19.5:9, 20:9, tablet 4:3 landscape, and notched safe-area layouts.

### Task 7: Build and sign the HarmonyOS offline release

**Files:**
- Create: `SpaceFight-Cocos/tools/build-harmony-offline.sh`
- Create: `SpaceFight-Cocos/tools/sign-harmony-release.sh`
- Create: `SpaceFight-Cocos/build-config/harmonyos-next.json`
- Modify: `apps/build_spacefight_apps.sh`
- Test: `tests/spacefight_cocos_harmony_release.test.js`

**Interfaces:**
- Consumes: Cocos HarmonyOS Next export and existing signing material directory.
- Produces: `SpaceFight-HarmonyOS-Offline-v0.10.0.hap` and `SpaceFight-HarmonyOS-Offline-v0.10.0.app` with verified release signatures.

- [ ] Write failing tests for bundle ID, version/build, no network permission, no WebView, signing inputs, and expected artifacts.
- [ ] Export the Cocos native HarmonyOS Next project with JSVM.
- [ ] Patch package/version/orientation, build HAP and APP using Hvigor, and sign both with the existing offline release material.
- [ ] Run `hap-sign-tool verify-app` and parse the embedded Profile bundle name and type.
- [ ] Copy verified artifacts to `website/api/apps`, `website/zhengzhengstudio.cn/api/apps`, and Downloads.

### Task 8: Build Web, Android, iOS, and macOS vertical slices

**Files:**
- Create: `SpaceFight-Cocos/build-config/web-desktop.json`
- Create: `SpaceFight-Cocos/build-config/android.json`
- Create: `SpaceFight-Cocos/build-config/ios.json`
- Create: `SpaceFight-Cocos/build-config/mac.json`
- Modify: `apps/build_spacefight_apps.sh`
- Test: `tests/spacefight_cocos_release_matrix.test.js`

**Interfaces:**
- Produces: Web build, APK, IPA, DMG, signed offline HAP, and signed offline APP for version `0.10.0` build `18`.

- [ ] Write failing release-matrix tests for all targets and native-no-WebView checks.
- [ ] Export each Cocos target using checked-in build configuration.
- [ ] Build native packages with JDK 21/Xcode/DevEco and preserve platform identifiers.
- [ ] Run desktop and mobile-size visual smoke checks plus input playback.

### Task 9: Publish without losing the legacy fallback

**Files:**
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `sync_to_termux.js`
- Test: `tests/spacefight_cocos_publish.test.js`

**Interfaces:**
- Publishes: version `0.10.0` build `18` only after all package and playability checks pass.

- [ ] Write failing tests for manifest version/build, hashes, signed flags, landscape notes, and download URLs.
- [ ] Add the website changelog entry required by repository policy.
- [ ] Keep legacy `0.9.6` versioned artifacts available while switching only `latest` aliases.
- [ ] Run the focused Termux SpaceFight sync and verify every online package by SHA-256.
- [ ] Run the full SpaceFight and sync test suites and record the final release matrix.

