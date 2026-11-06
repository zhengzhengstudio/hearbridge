# SpaceFight Playability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver six genuinely different local missions, instant cockpit/chase camera switching, two continuous environment types, readable native UI, and overflow-safe HarmonyOS phone layouts across Android, iOS, macOS, HarmonyOS online, and HarmonyOS offline.

**Architecture:** Each platform keeps its native renderer and input stack, but implements the same mission identifiers, objective state, camera identifiers, and region rules. Simulation owns mission progress; renderers consume snapshots and camera state; native shells own responsive layout and safe-area behavior. The existing local-first boundary remains unchanged, and HarmonyOS Offline receives no network dependency.

**Tech Stack:** Kotlin/Android Canvas, Swift/SpriteKit with UIKit and AppKit shells, ArkTS/ArkUI Canvas, Node.js contract tests, Gradle with LauncherX JDK 21, Swift compiler, DevEco hvigor.

## Global Constraints

- Mission identifiers are exactly `survival`, `boss`, `escort`, `defense`, `timed`, and `raid` on every native platform.
- Camera identifiers are exactly `cockpit` and `chase`; switching cannot reset mission state or input.
- Initial environments are `canyon` and `storm`; both alter rendering and simulation behavior, not just copy.
- Android, iOS, macOS, HarmonyOS online, and HarmonyOS offline expose the same six local missions.
- HarmonyOS Offline remains free of network permissions, passport code, WebView, and remote update requests.
- HarmonyOS launch action remains visible and clickable at 740x360, 844x390, 1280x800, and narrow split-window layouts.
- Combat UI uses opaque or near-opaque backing surfaces and readable foreground colors over battlefield art.
- No third-party game assets, logos, text, or copied layouts are introduced.

---

### Task 1: Cross-Platform Gameplay Contracts

**Files:**
- Create: `tests/spacefight_infinite_combat_contract.test.js`
- Modify: `tests/spacefight_playability_contract.test.js`

**Interfaces:**
- Consumes: Existing native source files and build metadata.
- Produces: Source and artifact contracts used as the acceptance gate for all following tasks.

- [ ] **Step 1: Write the failing mission and camera contract**

```js
const missions = ['survival', 'boss', 'escort', 'defense', 'timed', 'raid'];
const cameras = ['cockpit', 'chase'];
for (const source of nativeSources) {
  for (const mission of missions) assert.match(source, new RegExp(`['"]${mission}['"]`));
  for (const camera of cameras) assert.match(source, new RegExp(`['"]${camera}['"]`));
}
```

- [ ] **Step 2: Write the failing behavior-boundary contracts**

Require objective-specific state names `escortHealth`, `controlProgress`, `timeRemaining`, `raidCollected`, and boss component state. Require camera toggle functions, cockpit overlay rendering, chase ship rendering, and `canyon`/`storm` region rules. Require HarmonyOS fixed action layout markers and reject a fixed-height six-card column.

- [ ] **Step 3: Run the new contract and verify failure**

Run: `node --test tests/spacefight_infinite_combat_contract.test.js`

Expected: FAIL because escort, defense, timed, raid, cockpit/chase, and region rules do not exist on all platforms.

- [ ] **Step 4: Commit the red contract**

```bash
git add tests/spacefight_infinite_combat_contract.test.js tests/spacefight_playability_contract.test.js
git commit -m "test: define SpaceFight playability foundation"
```

### Task 2: Android Missions, Cameras, And Readable Shell

**Files:**
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt`
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/values/colors.xml`
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/values/themes.xml`
- Modify: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/values-night/themes.xml`
- Create: `ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/res/drawable/ic_camera.xml`
- Test: `tests/spacefight_infinite_combat_contract.test.js`

**Interfaces:**
- Consumes: `FlightInput`, `Snapshot`, bundled ship sprites, Android window insets.
- Produces: `MissionKind`, `CameraMode`, `RegionKind`, objective fields on `Snapshot`, and a camera control callable from the Activity.

- [ ] **Step 1: Add the minimal mission state types**

```kotlin
enum class MissionKind(val id: String) { SURVIVAL("survival"), BOSS("boss"), ESCORT("escort"), DEFENSE("defense"), TIMED("timed"), RAID("raid") }
enum class CameraMode(val id: String) { COCKPIT("cockpit"), CHASE("chase") }
enum class RegionKind(val id: String) { CANYON("canyon"), STORM("storm") }
data class ObjectiveState(val label: String = "", val progress: Float = 0f, val escortHealth: Int = 100, val controlProgress: Int = 0, val timeRemaining: Float = 0f, val raidCollected: Int = 0, val bossComponents: Int = 0)
```

- [ ] **Step 2: Implement six distinct local completion loops**

Extend `LocalBattle.reset()` and `step()` so escort advances and can lose a transport, defense changes capture progress by player/enemy proximity, timed decrements and extends its timer on valid kills, raid spawns collectible resource bodies, boss exposes destructible components, and survival retains escalating waves.

- [ ] **Step 3: Add camera mapping without changing simulation coordinates**

Add `cameraMode`, `toggleCamera()`, and camera-aware `point(entity)` projection. In cockpit mode do not draw the local ship and render a cockpit frame; in chase mode render the ship and engine bloom. Persist the selected mode in `SharedPreferences`.

- [ ] **Step 4: Replace the three-button mission rail with six compact selections**

Use two rows on compact widths and one vertical rail on wide widths. Put mission detail in one opaque panel, pin `launchButton` below scrolling content, and derive padding from `WindowInsetsCompat.Type.systemBars() or displayCutout()`.

- [ ] **Step 5: Increase combat readability**

Use near-opaque backing rectangles behind status and objective text, increase body copy to at least 12sp-equivalent canvas units, use one amber interaction accent, and keep threat red and friendly cyan semantic colors. Add an icon camera button adjacent to pause.

- [ ] **Step 6: Run Android contract and build**

Run:

```bash
node --test tests/spacefight_infinite_combat_contract.test.js --test-name-pattern=Android
JAVA_HOME="$HOME/Library/Application Support/LauncherX/LauncherX/DownloadedJRE/ZULU_JDK_21_OSX_X64/zulu-21.jdk/Contents/Home" ./gradlew :app:assembleDebug --no-daemon --console=plain -Pkotlin.incremental=false
```

Expected: Android contract PASS and `app-debug.apk` builds successfully.

- [ ] **Step 7: Commit Android implementation**

```bash
git add ZhengZhengStudioApp/ZhengZhengStudioAndroid tests/spacefight_infinite_combat_contract.test.js
git commit -m "feat: expand SpaceFight Android combat"
```

### Task 3: Shared Apple Mission And Camera Engine

**Files:**
- Modify: `apps/SpaceFightShared/NativeGameScene.swift`
- Test: `tests/spacefight_infinite_combat_contract.test.js`

**Interfaces:**
- Consumes: Existing `SFLocalBattle`, `SFSnapshot`, SpriteKit scene and bundled resources.
- Produces: `SFMissionKind`, `SFCameraMode`, `SFRegionKind`, `SFObjectiveState`, and `toggleCamera()` shared by iOS and macOS.

- [ ] **Step 1: Add shared enums and objective state**

```swift
enum SFMissionKind: String, CaseIterable { case survival, boss, escort, defense, timed, raid }
enum SFCameraMode: String, CaseIterable { case cockpit, chase }
enum SFRegionKind: String, CaseIterable { case canyon, storm }
struct SFObjectiveState { var label = ""; var progress: CGFloat = 0; var escortHealth = 100; var controlProgress = 0; var timeRemaining: TimeInterval = 0; var raidCollected = 0; var bossComponents = 0 }
```

- [ ] **Step 2: Implement objective-specific local simulation**

Update `SFLocalBattle` with transport, control point, timer, resource, and boss component entities. Publish objective state in every snapshot and ensure each mission has a separate success and failure condition.

- [ ] **Step 3: Implement SpriteKit cockpit/chase presentation**

Keep one simulation coordinate system. Chase mode shows the local ship and positions the scene camera behind it; cockpit mode hides the local ship, renders fixed cockpit rails, and keeps the reticle centered. `toggleCamera()` changes only presentation and persists via `UserDefaults`.

- [ ] **Step 4: Implement canyon and storm region effects**

Generate deterministic nearby obstacle nodes from region coordinates. Canyon adds collision corridors and warm high-contrast terrain; storm lowers lock range and adds restrained cloud/electrical effects that do not cover HUD text.

- [ ] **Step 5: Run shared Apple contract and type-check**

Run: `node --test tests/spacefight_infinite_combat_contract.test.js --test-name-pattern=Apple`

Then run the existing `swiftc` compilation commands from `apps/build_spacefight_apps.sh --apple-only`.

Expected: Apple contract and both compilation paths PASS.

- [ ] **Step 6: Commit shared Apple engine**

```bash
git add apps/SpaceFightShared tests/spacefight_infinite_combat_contract.test.js
git commit -m "feat: add SpaceFight Apple mission engine"
```

### Task 4: iOS And macOS Native Shells

**Files:**
- Modify: `apps/SpaceFight-iOS/Sources/main.swift`
- Modify: `apps/SpaceFightMac/Sources/main.swift`
- Test: `tests/spacefight_infinite_combat_contract.test.js`

**Interfaces:**
- Consumes: `SFMissionKind.allCases`, `NativeGameScene.start(mode:name:)`, `NativeGameScene.toggleCamera()`.
- Produces: Safe-area iOS mission selector and desktop-density macOS mission selector with pinned launch and camera controls.

- [ ] **Step 1: Add six mission choices to both native shells**

Build controls from `SFMissionKind.allCases`; selection changes the objective, danger, reward, and environment text. Do not create six nested cards.

- [ ] **Step 2: Recompose iOS safe-area layout**

Use a horizontally scrolling mission selector, one opaque detail surface, and a launch button constrained to `view.safeAreaLayoutGuide.bottomAnchor`. In combat, position camera and pause buttons inside the trailing safe area.

- [ ] **Step 3: Recompose macOS layout**

Use a compact vertical mission rail, keyboard focus, visible selected state, and fixed bottom launch action. Add `V` as camera toggle while retaining the icon control.

- [ ] **Step 4: Verify Apple shells compile**

Run: `bash apps/build_spacefight_apps.sh --apple-only`

Expected: iOS IPA and macOS DMG build paths complete without Swift errors.

- [ ] **Step 5: Commit Apple shells**

```bash
git add apps/SpaceFight-iOS apps/SpaceFightMac tests/spacefight_infinite_combat_contract.test.js
git commit -m "feat: rebuild SpaceFight Apple mission shells"
```

### Task 5: HarmonyOS Shared Gameplay Changes

**Files:**
- Modify: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets`
- Modify: `HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets`
- Create: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/resources/base/media/camera.svg`
- Create: `HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/resources/base/media/camera.svg`
- Test: `tests/spacefight_infinite_combat_contract.test.js`

**Interfaces:**
- Consumes: Existing `BattleState`, `LocalBody`, ArkUI Canvas and touch handlers.
- Produces: Matching `MissionKind`, `CameraMode`, `RegionKind`, objective state, camera toggle, and six mission controls in both projects.

- [ ] **Step 1: Add identical mission, camera, region, and objective types**

```ts
type MissionKind = 'survival' | 'boss' | 'escort' | 'defense' | 'timed' | 'raid'
type CameraMode = 'cockpit' | 'chase'
type RegionKind = 'canyon' | 'storm'
interface ObjectiveState { label: string; progress: number; escortHealth: number; controlProgress: number; timeRemaining: number; raidCollected: number; bossComponents: number }
```

- [ ] **Step 2: Implement six local mission state machines in both projects**

Keep networking code only in the online project. Local step logic must update escort, control, timer, raid, and boss component fields and use the same thresholds in both source files.

- [ ] **Step 3: Implement Canvas camera presentation**

Add `cameraMode`, `toggleCamera()`, camera-aware world projection, cockpit overlay, and chase ship visibility. Persist camera choice using Preferences in both projects; Offline remains network-free.

- [ ] **Step 4: Add canyon and storm region rules**

Derive region from player world coordinates and seed. Canyon adds visible obstacles and collision limits; storm alters lock range and energy recovery. Draw environment layers below entities and keep HUD surfaces opaque.

- [ ] **Step 5: Verify shared Harmony contract before layout work**

Run: `node --test tests/spacefight_infinite_combat_contract.test.js --test-name-pattern=Harmony`

Expected: Mission/camera/environment tests PASS; responsive tests may remain red until Task 6.

- [ ] **Step 6: Commit Harmony gameplay**

```bash
git add HarmonyOS-App/SpaceFightHarmony HarmonyOS-App/SpaceFightHarmonyOffline tests/spacefight_infinite_combat_contract.test.js
git commit -m "feat: expand SpaceFight Harmony combat"
```

### Task 6: HarmonyOS Responsive Flight Deck

**Files:**
- Modify: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets`
- Modify: `HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets`
- Test: `tests/spacefight_infinite_combat_contract.test.js`

**Interfaces:**
- Consumes: Six mission definitions and camera control from Task 5.
- Produces: `compactDeck`, horizontal mission rail, scrollable details, and a bottom-pinned launch action in both HarmonyOS editions.

- [ ] **Step 1: Separate scrolling content from fixed launch action**

Use a root `Column` sized to `100%`. Place header and mission/detail content in a `Scroll` with `layoutWeight(1)`, then render the launch action in a non-scrolling safe-area footer. Do not assign a total fixed height to the six missions and detail content.

- [ ] **Step 2: Add compact and wide layouts**

Set `compactDeck` from measured width and height. Compact mode uses a horizontal `Scroll` mission rail and hides secondary copy; wide mode uses mission rail, preview, and detail columns. Both keep launch visible.

- [ ] **Step 3: Bound combat controls to actual canvas size**

Compute HUD and touch anchors from `canvasWidth`, `canvasHeight`, and safe insets. Clamp weapon strip width and camera/pause buttons so 740x360 and 844x390 do not overlap.

- [ ] **Step 4: Run responsive contract and build both Harmony projects**

Run:

```bash
node --test tests/spacefight_infinite_combat_contract.test.js --test-name-pattern=Harmony
bash HarmonyOS-App/SpaceFightHarmony/build-hap.sh
bash HarmonyOS-App/SpaceFightHarmonyOffline/build-hap.sh
```

Expected: Contracts PASS and both HAP builds complete.

- [ ] **Step 5: Commit Harmony responsive fix**

```bash
git add HarmonyOS-App/SpaceFightHarmony HarmonyOS-App/SpaceFightHarmonyOffline tests/spacefight_infinite_combat_contract.test.js
git commit -m "fix: keep SpaceFight Harmony controls in bounds"
```

### Task 7: Cross-Platform Verification And Website Release Record

**Files:**
- Modify: `website/api/data/changelogs.json`
- Modify after successful builds: `website/api/apps/manifest.json`
- Modify after successful builds: `website/api/apps/client-downloads.json`
- Modify after successful builds: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify after successful builds: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Test: `tests/spacefight_infinite_combat_contract.test.js`
- Test: `tests/spacefight_playability_contract.test.js`
- Test: `tests/spacefight_product_contract.test.js`
- Test: `tests/spacefight_release_contract.test.js`

**Interfaces:**
- Consumes: Successful Android, Apple, HarmonyOS builds and release artifacts.
- Produces: Verified packages, matching dual website metadata, and required public changelog entry.

- [ ] **Step 1: Run all SpaceFight contracts**

```bash
node --test tests/spacefight_infinite_combat_contract.test.js tests/spacefight_playability_contract.test.js tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js
```

Expected: All tests PASS with no stale three-mission assertions.

- [ ] **Step 2: Inspect package contents and identities**

Verify Android package id/version, Apple bundle metadata, HarmonyOS bundle/version/Profile, no web containers, and no network permission in HarmonyOS Offline. Compare SHA-256 for build output, Downloads, and both website roots.

- [ ] **Step 3: Perform viewport and device checks where available**

Validate 740x360, 844x390, 1280x800, phone portrait, and split-window layouts. If no HarmonyOS device is connected, record that limitation instead of claiming an installation pass.

- [ ] **Step 4: Update website metadata only for successfully built packages**

Set version, build, filename, size, SHA-256, signed status, and latest/versioned URLs from actual artifacts. Do not mark unsigned or unverified packages store-ready.

- [ ] **Step 5: Add the required website changelog entry**

Record six missions, dual cameras, two environments, UI readability, HarmonyOS overflow repair, actual package/signing state, and verification results in `website/api/data/changelogs.json`.

- [ ] **Step 6: Run final verification and commit**

```bash
node --test tests/spacefight_infinite_combat_contract.test.js tests/spacefight_playability_contract.test.js tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js
git add website/api/data/changelogs.json website/api/apps website/zhengzhengstudio.cn/api/apps tests
git commit -m "release: publish SpaceFight playability foundation"
```
