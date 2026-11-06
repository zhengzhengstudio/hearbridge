# Survival Diary iOS and macOS Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build native SwiftUI/SpriteKit Survival Diary clients for iOS and macOS with shared Apple domain code, adaptive controls, safe saves, online play, and platform-compliant updates.

**Architecture:** A new `apps/SurvivalDiary-Apple` Swift package isolates the game from Life Diary. `SurvivalDiaryCore` owns v2 state and fixtures, `SurvivalDiaryGame` owns SpriteKit, and separate iOS/macOS app targets own platform UI and update behavior.

**Tech Stack:** Swift 5.10, SwiftUI, SpriteKit, Codable, URLSession/WebSocket, Keychain, XCTest, Xcode.

## Global Constraints

- iOS bundle ID is `cn.zhengzhengstudio.survivaldiary.ios`.
- macOS bundle ID is `cn.zhengzhengstudio.survivaldiary.macos`.
- Version is `0.3.0`, build is `3`.
- Deployment targets are iOS 16 and macOS 13.
- No `WKWebView`, HTML, or JavaScript game resources.
- iOS update UI opens App Store/TestFlight; it does not install arbitrary IPA files.

---

### Task 1: Create Separate Apple Targets

**Files:**
- Create: `apps/SurvivalDiary-Apple/Package.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/GameSave.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryIOS/SurvivalDiaryIOSApp.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryMac/SurvivalDiaryMacApp.swift`
- Modify: `tests/survival_diary_native_clients.test.js`

**Interfaces:**
- Produces products `SurvivalDiaryCore`, `SurvivalDiaryIOS`, and `SurvivalDiaryMac`.

- [ ] **Step 1: Extend the failing native source contract**

```js
assert.doesNotMatch(readTree('apps/SurvivalDiary-Apple'), /WKWebView|import WebKit|\\.html|\\.js/);
assert.match(read('Package.swift'), /SurvivalDiaryCore/);
assert.match(read('Package.swift'), /SurvivalDiaryIOS/);
assert.match(read('Package.swift'), /SurvivalDiaryMac/);
```

- [ ] **Step 2: Create package and minimal SwiftUI apps**

Both apps host a native `SpriteView(scene:)` and a SwiftUI overlay. Keep bundle packaging in platform scripts; do not import files from `apps/LifeDiary-*`.

- [ ] **Step 3: Build**

```bash
cd apps/SurvivalDiary-Apple
swift test
swift build --product SurvivalDiaryMac
```

- [ ] **Step 4: Commit**

```bash
git add apps/SurvivalDiary-Apple tests/survival_diary_native_clients.test.js
git commit -m "feat: scaffold native Survival Diary Apple apps"
```

### Task 2: Implement Swift v2 Domain and Save Migration

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/Simulation.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/Environment.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryCore/SaveRepository.swift`
- Create: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryCoreTests/FixtureParityTests.swift`

**Interfaces:**
- Produces: `Simulation.create(seed:playMode:)`, `Simulation.step(_:command:)`, `SaveRepository.load(slot:)`, `save(slot:state:)`.

- [ ] **Step 1: Write failing fixture test**

```swift
func testGoldenFixtureDigest() throws {
    let fixture = try Fixture.load("world-v2-seed-20260729")
    let result = try fixture.commands.reduce(Simulation.create(seed: fixture.seed, playMode: .guided), Simulation.step)
    XCTAssertEqual(result.stableDigest, fixture.expectedDigest)
}
```

- [ ] **Step 2: Implement Codable v2 models and deterministic ordering**

Use integer minutes, explicit enums, sorted dictionary encoding for digests, and shared JSON copied into Swift package resources at build time.

- [ ] **Step 3: Implement atomic saves and exported-v1 import**

iOS stores in Application Support with complete-file protection; macOS stores in Application Support. Import only a user-selected exported legacy file and keep the original.

- [ ] **Step 4: Run and commit**

```bash
swift test
git add Sources/SurvivalDiaryCore Tests/SurvivalDiaryCoreTests
git commit -m "feat: add Apple Survival Diary domain"
```

### Task 3: Build SpriteKit World, Camera, Weather, and Placement

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/IslandScene.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/CameraController.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/AtlasLoader.swift`
- Create: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryGameTests/CameraControllerTests.swift`

**Interfaces:**
- Produces: `IslandScene.apply(state:)`, `CameraController.zoom(by:)`, `rotateQuarterTurn()`, `worldPoint(from:)`.

- [ ] **Step 1: Write failing camera tests**

Test reversible transforms, zoom 0.35–3.0, four rotations, same scale for actors/entities, and screen-space task marker conversion.

- [ ] **Step 2: Implement scene node hierarchy**

Use root nodes `terrain`, `entities`, `actors`, `weather`, and `screenMarkers`. Apply camera transform to the first four only. Use texture atlases; no SVG world items.

- [ ] **Step 3: Add native placement**

Placement preview uses domain validation and SpriteKit collision shapes. Confirmation emits one command; no inventory mutation occurs in the scene.

- [ ] **Step 4: Run and commit**

```bash
swift test
git add Sources/SurvivalDiaryGame Tests/SurvivalDiaryGameTests
git commit -m "feat: render Survival Diary with SpriteKit"
```

### Task 4: Add Adaptive SwiftUI HUD, A/B Mode, and Diary

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameContainerView.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/GameHUD.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/DiaryBookView.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/PlayModeSettingsView.swift`
- Create: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryUITests/PlayModeTests.swift`

**Interfaces:**
- `GameStore` is `@MainActor ObservableObject` with immutable state transitions.

- [ ] **Step 1: Write failing shared-save mode test**

Verify a first save is guided, mode changes persist, entities and diary remain byte-equivalent, and free mode returns no continuous guide cue.

- [ ] **Step 2: Implement iPhone/iPad HUD**

Use safe areas, 44-point controls, gesture coexistence, bottom quickbar, and full-screen diary. Support Dynamic Type and Reduce Motion.

- [ ] **Step 3: Implement macOS HUD**

Add keyboard movement, scroll zoom, edge pan, shortcuts, resizable side panels, and window-size-specific layouts.

- [ ] **Step 4: Implement diary pages**

Render facts, authored entries, map notes, discoveries, build album, and friend visits locally. Kimi action is optional and clearly labeled.

- [ ] **Step 5: Run and commit**

```bash
swift test
git add Sources/SurvivalDiaryUI Tests/SurvivalDiaryUITests
git commit -m "feat: add Apple Survival Diary UI and diary"
```

### Task 5: Add Passport, Friends, Cloud Sync, and Updates

**Files:**
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/SurvivalAPI.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/ReconnectQueue.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/UpdateService.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/ReleasePushService.swift`
- Create: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryOnlineTests/UpdateServiceTests.swift`

**Interfaces:**
- Produces: `check(currentVersion:build:)`, `openUpdate()`, and revisioned online commands.

- [ ] **Step 1: Write failing update tests**

For iOS, assert higher build opens configured App Store/TestFlight URL. For macOS direct distribution, assert SHA-256 verification and only notarized/signature-matching package metadata can be opened.

- [ ] **Step 2: Implement secure sessions and reconnect**

Store Passport token in Keychain. Persist unsent event IDs and base revisions without private diary text unless the user enables diary sync.

- [ ] **Step 3: Implement platform update behavior**

Use conditional compilation: iOS opens store URL; macOS downloads to Downloads, verifies checksum, then uses `NSWorkspace.open`.

- [ ] **Step 4: Register APNs release notifications**

`ReleasePushService` requests notification permission only after an explanatory opt-in screen, registers the APNs device token with `/push/subscriptions`, and re-fetches the manifest after a release notification. macOS uses the same APNs contract when direct-distribution push entitlement/profile is available.

- [ ] **Step 5: Run and commit**

```bash
swift test
git add Sources/SurvivalDiaryOnline Tests/SurvivalDiaryOnlineTests
git commit -m "feat: add Apple online play and updates"
```

### Task 6: Package and Verify Unsigned/Locally Signed Apple Builds

**Files:**
- Create: `apps/SurvivalDiary-Apple/scripts/build_ios.sh`
- Create: `apps/SurvivalDiary-Apple/scripts/build_macos.sh`
- Create: `apps/SurvivalDiary-Apple/Support/iOS-Info.plist`
- Create: `apps/SurvivalDiary-Apple/Support/macOS-Info.plist`
- Create: `tests/survival_diary_apple_native.test.js`

- [ ] **Step 1: Add package/source checks**

Check bundle IDs, version/build, app icons, no WebKit/HTML/JS, SpriteKit presence, deployment targets, and explicit unsigned status when credentials are missing.

- [ ] **Step 2: Build and test**

```bash
cd apps/SurvivalDiary-Apple
swift test
./scripts/build_ios.sh --unsigned
./scripts/build_macos.sh --unsigned
node ../../tests/survival_diary_apple_native.test.js
```

Expected: unsigned local artifacts build and are labeled unsigned; release signing is deferred to the publishing plan.

- [ ] **Step 3: Commit**

```bash
git add apps/SurvivalDiary-Apple tests/survival_diary_apple_native.test.js
git commit -m "test: verify native Survival Diary Apple apps"
```
