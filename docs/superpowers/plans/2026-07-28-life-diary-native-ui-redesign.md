# LifeDiary Native UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every LifeDiary app WebView shell with a platform-native UI, generate a new journal-and-writing-stroke App Icon, preserve the existing website/API, and publish rebuilt packages with honest signing metadata.

**Architecture:** Each platform owns its navigation, screens, persistence adapters, authentication handoff, and system integrations. The clients share API semantics and product rules—not UI code—and use a local-first repository that writes locally before synchronizing with the existing LifeDiary API. Release metadata remains generated from verified artifacts in `website/api/apps`.

**Tech Stack:** SwiftUI/Swift Package Manager (iOS 16+, macOS 13+), Kotlin/Jetpack Compose/Material 3 (Android API 26+), ArkTS/ArkUI (HarmonyOS 6.0+), Node.js contract tests, built-in image generation for the icon, platform build tools.

## Global Constraints

- Keep `website/life.zhengzhengstudio.cn` as the independent web product; do not redesign it in this plan.
- Remove WebView/ArkWeb from every app primary flow. Website and Passport URLs open through platform browser/authentication APIs only.
- Use “纸页与苔痕 2.0”: deep moss green, warm ivory, sage gray, charcoal ink, restrained paper texture, one main accent color.
- Icon motif is an open journal crossed by one continuous writing stroke; no words, letters, dates, screenshots, people, or devices.
- Period and quit-smoking tools are opt-in and never gated by gender.
- Private diary records and community posts are separate objects; publishing always creates and confirms a public copy.
- Minor-mode prompting occurs only after minor registration/login or offline age-profile completion; support later, seven-day suppression, permanent suppression, and restoration in settings.
- HarmonyOS offline declares no INTERNET permission and contains no Passport, sync, community, friend, chat, or online-assistant code path.
- Preserve current package identifiers and minimum versions: iOS 16+, macOS 13+, Android API 26+, HarmonyOS compatible SDK 6.0.0(20).
- Only builds verified with platform release credentials may be marked `signed` or `storeReady`.
- All website-facing release changes update `website/api/data/changelogs.json`.

---

### Task 1: Add Native-App Contract Gates

**Files:**
- Modify: `website/api/test/life_diary_android_contract.test.js`
- Modify: `website/api/test/life_diary_apple_contract.test.js`
- Modify: `website/api/test/life_diary_harmony_online_contract.test.js`
- Modify: `website/api/test/life_diary_harmony_offline_contract.test.js`
- Create: `website/api/test/life_diary_native_ui_contract.test.js`
- Create: `website/api/test/helpers/read_tree.js`

**Interfaces:**
- Consumes: existing app source directories and Node test runner.
- Produces: repository-wide assertions that forbid WebView primary UI and require platform-native navigation, design tokens, secure token storage, and dedicated icon resources.

- [ ] **Step 1: Write the failing native UI contract**

```js
const { readTree } = require('./helpers/read_tree');

test('LifeDiary apps use native UI instead of embedded websites', () => {
  const android = readTree('apps/LifeDiary-Android/app/src/main');
  const ios = readTree('apps/LifeDiary-iOS/Sources/LifeDiary');
  const mac = readTree('apps/LifeDiary-macOS/Sources/LifeDiary');
  const harmony = readTree('apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets');
  assert.doesNotMatch(android, /android\.webkit\.WebView|addJavascriptInterface/);
  assert.doesNotMatch(ios, /WKWebView|UIViewRepresentable/);
  assert.doesNotMatch(mac, /WKWebView|NSViewRepresentable/);
  assert.doesNotMatch(harmony, /ArkWeb|WebviewController|\bWeb\s*\(/);
  assert.match(android, /setContent\s*\{/);
  assert.match(ios, /TabView\s*\(/);
  assert.match(mac, /NavigationSplitView\s*\{/);
  assert.match(harmony, /Tabs\s*\(/);
});
```

Create `helpers/read_tree.js` with this implementation:

```js
const fs = require('node:fs');
const path = require('node:path');
const skipped = new Set(['build', '.build', '.gradle', '.hvigor', 'dist']);

function readTree(root) {
  const chunks = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !skipped.has(entry.name)) visit(path.join(directory, entry.name));
      if (entry.isFile() && /\.(java|kt|swift|ets)$/.test(entry.name)) {
        chunks.push(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
      }
    }
  }
  visit(root);
  return chunks.join('\n');
}

module.exports = { readTree };
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `cd website/api && node --test test/life_diary_native_ui_contract.test.js`

Expected: FAIL because the current Android, Apple, and HarmonyOS online apps contain WebView code.

- [ ] **Step 3: Add explicit platform requirements to existing contracts**

```js
assert.match(androidGradle, /org\.jetbrains\.kotlin\.android/);
assert.match(androidGradle, /androidx\.compose\.material3/);
assert.match(iosSources, /ASWebAuthenticationSession/);
assert.match(macSources, /Commands/);
assert.match(harmonyOfflineModule, /requestPermissions\s*:\s*\[\s*\]/);
```

- [ ] **Step 4: Re-run and retain the expected failures as the implementation gate**

Run: `cd website/api && node --test test/life_diary_*contract.test.js`

Expected: only the new native requirements fail; existing API/release assertions continue to pass.

- [ ] **Step 5: Commit the RED gate**

```bash
git -C website add api/test/life_diary_*contract.test.js api/test/helpers/read_tree.js
git -C website commit -m "test: require native LifeDiary app surfaces"
```

### Task 2: Generate and Package the New App Icon

**Files:**
- Create: `apps/LifeDiary-Brand/icon/lifediary-icon-master-1024.png`
- Create: `apps/LifeDiary-Brand/icon/lifediary-icon-foreground-transparent.png`
- Create: `apps/LifeDiary-Brand/icon/icon-generation.md`
- Create: `apps/LifeDiary-Brand/scripts/build_icons.sh`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json`
- Create: `apps/LifeDiary-Android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `apps/LifeDiary-Android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Create: `apps/LifeDiary-Android/app/src/main/res/drawable/ic_launcher_monochrome.xml`
- Create: `apps/LifeDiary-Android/app/src/main/res/values/icon_colors.xml`
- Replace: `apps/LifeDiary-HarmonyOS-Online/AppScope/resources/base/media/foreground.png`
- Replace: `apps/LifeDiary-HarmonyOS-Offline/AppScope/resources/base/media/foreground.png`
- Create: `website/api/test/life_diary_icon_contract.test.js`

**Interfaces:**
- Consumes: confirmed “open journal + one continuous writing stroke” motif.
- Produces: `lifediary-icon-master-1024.png`, iOS asset catalog, Android adaptive foreground/background/monochrome resources, macOS `.icns` inputs, and HarmonyOS layered artwork.

- [ ] **Step 1: Write the failing icon asset test**

```js
const requiredIconFiles = [
  '../../../apps/LifeDiary-Brand/icon/lifediary-icon-master-1024.png',
  '../../../apps/LifeDiary-Brand/icon/lifediary-icon-foreground-transparent.png',
  '../../../apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
  '../../../apps/LifeDiary-macOS/LifeDiary.icns',
  '../../../apps/LifeDiary-Android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  '../../../apps/LifeDiary-HarmonyOS-Online/AppScope/resources/base/media/foreground.png',
  '../../../apps/LifeDiary-HarmonyOS-Offline/AppScope/resources/base/media/foreground.png'
].map(file => path.resolve(__dirname, file));
for (const file of requiredIconFiles) {
  assert.equal(fs.existsSync(file), true, `${file} must exist`);
  assert.ok(fs.statSync(file).size > 4096, `${file} must not be a placeholder`);
}
assert.doesNotMatch(androidIconXml, /@drawable\/ic_launcher/);
```

- [ ] **Step 2: Run the icon test and verify RED**

Run: `cd website/api && node --test test/life_diary_icon_contract.test.js`

Expected: FAIL because the independent master and platform icon sets do not exist.

- [ ] **Step 3: Generate the independent icon master with built-in image generation**

Use this exact prompt:

```text
Use case: logo-brand
Asset type: premium mobile app icon master
Primary request: an original icon for the Chinese product LifeDiary, built from one open journal crossed by one continuous hand-drawn writing stroke that flows from the left page to the right page
Style/medium: simple dimensional vector-like icon, strong silhouette, calm and premium, no photorealism
Composition: centered, one dominant journal shape, large safe margins, readable at 32 px
Color palette: deep moss green background, warm ivory pages, muted sage detail, charcoal-ink stroke
Constraints: no letters, no words, no numbers, no date grid, no screenshot, no person, no hand, no phone, no third-party mark, no watermark, no pre-rounded corners, opaque square canvas
```

Inspect the output at 1024 px and 32 px. Reject outputs with text-like marks, multiple notebooks, tiny decorative detail, or a screenshot-like layout.

Generate a second asset from the accepted master using built-in image editing: preserve only the journal and continuous stroke, center them on a perfectly flat `#ff00ff` background, remove all shadows and background shapes, and add generous padding. Copy it into the brand directory, run the imagegen `remove_chroma_key.py` helper with `--auto-key border --soft-matte --despill`, and save the result as `lifediary-icon-foreground-transparent.png`.

- [ ] **Step 4: Add a deterministic platform export script**

```bash
#!/bin/bash
set -euo pipefail
brand_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$brand_root/../.." && pwd)"
master="$brand_root/icon/lifediary-icon-master-1024.png"
ios_dir="$repo_root/apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Assets.xcassets/AppIcon.appiconset"
mac_set="$repo_root/apps/LifeDiary-macOS/AppIcon.iconset"
test -f "$master"
mkdir -p "$ios_dir" "$mac_set"
sips -z 1024 1024 "$master" --out "$ios_dir/AppIcon-1024.png" >/dev/null
for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$master" --out "$mac_set/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$master" --out "$mac_set/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$mac_set" -o "$repo_root/apps/LifeDiary-macOS/LifeDiary.icns"

foreground="$brand_root/icon/lifediary-icon-foreground-transparent.png"
android_res="$repo_root/apps/LifeDiary-Android/app/src/main/res"
for spec in "mdpi 108 48" "hdpi 162 72" "xhdpi 216 96" "xxhdpi 324 144" "xxxhdpi 432 192"; do
  set -- $spec
  density="$1"; adaptive="$2"; legacy="$3"
  mkdir -p "$android_res/mipmap-$density"
  sips -z "$adaptive" "$adaptive" "$foreground" --out "$android_res/mipmap-$density/ic_launcher_foreground.png" >/dev/null
  sips -z "$legacy" "$legacy" "$master" --out "$android_res/mipmap-$density/ic_launcher.png" >/dev/null
done

for project in LifeDiary-HarmonyOS-Online LifeDiary-HarmonyOS-Offline; do
  for target in AppScope/resources/base/media entry/src/main/resources/base/media; do
    sips -z 1024 1024 "$foreground" --out "$repo_root/apps/$project/$target/foreground.png" >/dev/null
  done
done
```

Add Android adaptive icon XML that points to a solid moss `@color/ic_launcher_background`, the generated foreground, and a single-color journal/stroke vector for `monochrome`. The script never flattens the full square master into the adaptive foreground.

- [ ] **Step 5: Generate platform resources and validate**

Run: `bash apps/LifeDiary-Brand/scripts/build_icons.sh`

Run: `cd website/api && node --test test/life_diary_icon_contract.test.js`

Expected: PASS; all raster files have the required dimensions and no platform uses the old composed launcher drawable.

- [ ] **Step 6: Commit the icon system**

```bash
git add apps/LifeDiary-Brand apps/LifeDiary-Android/app/src/main/res apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Assets.xcassets apps/LifeDiary-macOS apps/LifeDiary-HarmonyOS-Online/AppScope/resources apps/LifeDiary-HarmonyOS-Offline/AppScope/resources
git commit -m "design: add generated LifeDiary app icon system"
git -C website add api/test/life_diary_icon_contract.test.js
git -C website commit -m "test: verify LifeDiary platform icons"
```

### Task 3: Build the iOS Local-First Core

**Files:**
- Modify: `apps/LifeDiary-iOS/Package.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/DiaryEntry.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/HealthRecord.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/ConnectionModels.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/CommunityDraft.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/SyncState.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Stores/LifeRepository.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Services/LifeAPIClient.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Services/PassportSession.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Services/SecureTokenStore.swift`
- Create: `apps/LifeDiary-iOS/Tests/LifeDiaryTests/LifeRepositoryTests.swift`

**Interfaces:**
- Produces: `protocol LifeRepositoryProtocol`, `@MainActor final class LifeRepository`, `protocol LifeAPIClientProtocol`, and `@MainActor final class PassportSession`.
- `LifeRepositoryProtocol` exposes `entries`, `syncState`, `save(entry:)`, `deleteEntry(id:)`, `sync()`; `DiaryStoreProtocol` exposes atomic `load()` and `save(_:)` operations. `MemoryDiaryStore`, `APIStub`, and `DiaryEntry.fixture` are test-only types declared in `LifeRepositoryTests.swift`.

- [ ] **Step 1: Add the Swift test target and failing local-first tests**

```swift
func testSaveCommitsLocallyBeforeRemoteSync() async throws {
    let api = APIStub(result: .failure(TestError.offline))
    let repository = LifeRepository(store: MemoryDiaryStore(), api: api)
    try await repository.save(entry: .fixture(title: "今天"))
    XCTAssertEqual(repository.entries.count, 1)
    XCTAssertEqual(repository.syncState, .pending(count: 1))
}
```

- [ ] **Step 2: Run the iOS tests and verify RED**

Run: `cd apps/LifeDiary-iOS && swift test`

Expected: FAIL because repository, models, and test target are absent.

- [ ] **Step 3: Implement value models and the repository boundary**

```swift
protocol LifeRepositoryProtocol: AnyObject {
    var entries: [DiaryEntry] { get }
    var syncState: SyncState { get }
    func save(entry: DiaryEntry) async throws
    func deleteEntry(id: UUID) async throws
    func sync() async
}
```

Store JSON in Application Support using atomic replacement; keep API calls behind `LifeAPIClientProtocol`. Save locally and enqueue before attempting `/api/life/private/sync`.

- [ ] **Step 4: Implement Passport browser handoff and secure tokens**

```swift
let session = ASWebAuthenticationSession(
    url: passportURL,
    callbackURLScheme: "lifediary"
) { callbackURL, error in
    Task { await self.finishAuthorization(callbackURL, error: error) }
}
session.prefersEphemeralWebBrowserSession = true
```

Persist only the access token and account identifier in Keychain; never store tokens in `UserDefaults`.

- [ ] **Step 5: Run tests and commit**

Run: `cd apps/LifeDiary-iOS && swift test`

Expected: PASS.

```bash
git add apps/LifeDiary-iOS
git commit -m "feat: add LifeDiary iOS native data core"
```

### Task 4: Replace the iOS Web Shell with Native SwiftUI Screens

**Files:**
- Delete: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/LifeWebView.swift`
- Modify: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/AppView.swift`
- Modify: `apps/LifeDiary-iOS/Sources/LifeDiary/Models/AppTab.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/DesignSystem/LifeTheme.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Today/TodayView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Diary/DiaryTimelineView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Diary/DiaryEditorView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Connections/ConnectionsView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Companion/CompanionView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Profile/ProfileView.swift`
- Create: `apps/LifeDiary-iOS/Tests/LifeDiaryTests/AppTabTests.swift`

**Interfaces:**
- Consumes: Task 3 repository and Passport session.
- Produces: five-tab native iOS app with routes for diary editor, health tools, community copies, chat, assistant sources, settings, and external website links.

- [ ] **Step 1: Write failing navigation and privacy tests**

```swift
func testPrimaryTabsMatchApprovedInformationArchitecture() {
    XCTAssertEqual(AppTab.allCases.map(\.title), ["今天", "日记", "连接", "陪伴", "我的"])
}

func testCommunityDraftIsACopy() {
    let privateEntry = DiaryEntry.fixture(body: "private")
    let draft = CommunityDraft(copying: privateEntry)
    XCTAssertNotEqual(draft.id.uuidString, privateEntry.id.uuidString)
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd apps/LifeDiary-iOS && swift test`

Expected: FAIL because the five-tab model and community-copy initializer are missing.

- [ ] **Step 3: Implement the native root and design tokens**

```swift
TabView(selection: $selection) {
    TodayView(repository: repository).tabItem { Label("今天", systemImage: "sun.max") }.tag(AppTab.today)
    DiaryTimelineView(repository: repository).tabItem { Label("日记", systemImage: "book.pages") }.tag(AppTab.diary)
    ConnectionsView().tabItem { Label("连接", systemImage: "person.2") }.tag(AppTab.connections)
    CompanionView().tabItem { Label("陪伴", systemImage: "sparkles") }.tag(AppTab.companion)
    ProfileView().tabItem { Label("我的", systemImage: "person.crop.circle") }.tag(AppTab.profile)
}
.tint(LifeTheme.moss)
```

Use native `Form`, `List`, `ContentUnavailableView` fallback for iOS 16, `.sheet(item:)`, `ShareLink`, dynamic type styles, accessibility labels, and Reduce Motion checks.

- [ ] **Step 4: Remove bundled website resources and verify no WebKit imports**

Run: `rg -n "WebKit|WKWebView|LifeWebView|Resources/life" apps/LifeDiary-iOS`

Expected: no matches in app source or package resources.

- [ ] **Step 5: Build, test, and commit**

Run: `cd apps/LifeDiary-iOS && swift test && xcodebuild -scheme LifeDiary -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`

Expected: PASS and BUILD SUCCEEDED.

```bash
git add apps/LifeDiary-iOS
git commit -m "feat: rebuild LifeDiary iOS with native SwiftUI"
git -C website add api/test/life_diary_apple_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify native LifeDiary iOS"
```

### Task 5: Build the macOS Repository, Authentication, and Desktop Shell

**Files:**
- Modify: `apps/LifeDiary-macOS/Package.swift`
- Delete: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/LifeWebView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Models/LifeSection.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Stores/LifeRepository.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Services/LifeAPIClient.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Services/PassportSession.swift`
- Modify: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/ContentView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/SidebarView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/EntryListView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/EntryDetailView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/LifeDetailRouter.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/ConnectionsView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/CompanionView.swift`
- Create: `apps/LifeDiary-macOS/Tests/LifeDiaryTests/DesktopNavigationTests.swift`

**Interfaces:**
- Produces: `LifeSection`, `LifeRepository`, three-column selection state, `PassportSession`, and menu commands for new entry, search, export, lock, and update.

- [ ] **Step 1: Write failing sidebar and command tests**

```swift
func testSidebarGroupsUseDesktopInformationArchitecture() {
    XCTAssertEqual(LifeSection.record.map(\.title), ["今天", "个人日记", "健康记录"])
    XCTAssertEqual(LifeSection.connection.map(\.title), ["社区", "好友", "消息"])
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd apps/LifeDiary-macOS && swift test`

Expected: FAIL because desktop navigation types are absent.

- [ ] **Step 3: Implement the native split view and system commands**

```swift
NavigationSplitView {
    SidebarView(selection: $selection)
} content: {
    EntryListView(selection: $entrySelection)
} detail: {
    LifeDetailRouter(section: selection, entry: entrySelection)
}
.searchable(text: $query, placement: .toolbar)
```

Add `CommandGroup(after: .newItem)` for New Entry and `CommandMenu("生活日记")` for Lock, Export, and Check for Updates. Keep the settings scene separate.

- [ ] **Step 4: Implement local-first persistence, Keychain, and browser authorization**

Use the same JSON field names and revision rules as iOS, but keep macOS types local to the macOS target. Open the website with `NSWorkspace.shared.open` and Passport with `ASWebAuthenticationSession`; do not embed a browser view.

- [ ] **Step 5: Test, build, and commit**

Run: `cd apps/LifeDiary-macOS && swift test && swift build -c release`

Expected: PASS.

```bash
git add apps/LifeDiary-macOS
git commit -m "feat: rebuild LifeDiary macOS as a native desktop app"
git -C website add api/test/life_diary_apple_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify native LifeDiary macOS"
```

### Task 6: Convert Android to a Dedicated Kotlin Compose App

**Files:**
- Modify: `apps/LifeDiary-Android/build.gradle`
- Modify: `apps/LifeDiary-Android/app/build.gradle`
- Modify: `apps/LifeDiary-Android/settings.gradle`
- Delete: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/MainActivity.java`
- Delete: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/LifeBridge.java`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/MainActivity.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/LifeDiaryApp.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/navigation/LifeDestination.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/theme/LifeTheme.kt`
- Create: `apps/LifeDiary-Android/app/src/test/java/cn/zhengzhengstudio/lifediary/BuildIsolationTest.kt`

**Interfaces:**
- Produces: one `cn.zhengzhengstudio.lifediary` application, Compose root, Material 3 theme, five-destination `LifeDestination` enum.

- [ ] **Step 1: Write a failing isolation test**

```kotlin
@Test fun destinationsAreLifeDiaryOnly() {
    assertEquals(listOf("today", "diary", "connections", "companion", "profile"), LifeDestination.entries.map { it.route })
    assertFalse(BuildConfig::class.java.declaredFields.any { it.name == "LOCAL_URL" })
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd apps/LifeDiary-Android && ./gradlew testLifeDiaryDebugUnitTest`

Expected: FAIL because Kotlin/Compose and `LifeDestination` are not configured.

- [ ] **Step 3: Remove SurvivalDiary flavor and web-copy tasks, then enable Compose**

```groovy
plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}
android {
    buildFeatures { compose true; buildConfig true }
    composeOptions { kotlinCompilerExtensionVersion '1.5.14' }
}
dependencies {
    implementation platform('androidx.compose:compose-bom:2024.06.00')
    implementation 'androidx.compose.material3:material3'
    implementation 'androidx.navigation:navigation-compose:2.7.7'
}
```

Delete `syncLifeWeb`, `syncSurvivalDiaryWeb`, generated web asset source sets, and both product flavors. Keep version/update constants for LifeDiary only.

- [ ] **Step 4: Implement the Compose activity and root navigation**

```kotlin
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { LifeTheme { LifeDiaryApp() } }
    }
}
```

- [ ] **Step 5: Run unit tests and commit**

Run: `cd apps/LifeDiary-Android && ./gradlew test lint`

```bash
git add apps/LifeDiary-Android
git commit -m "refactor: convert LifeDiary Android to Compose"
git -C website add api/test/life_diary_android_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify native LifeDiary Android shell"
```

### Task 7: Add Android Local-First Data, Passport, and Platform Services

**Files:**
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/data/Models.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/data/LifeRepository.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/network/LifeApi.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/auth/PassportManager.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/security/SecureTokenStore.kt`
- Convert: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/UpdateChecker.java`
- Create: `apps/LifeDiary-Android/app/src/test/java/cn/zhengzhengstudio/lifediary/data/LifeRepositoryTest.kt`

**Interfaces:**
- Produces: `interface LifeRepository`, `class DefaultLifeRepository`, `interface LifeApi`, `class PassportManager`, `class SecureTokenStore`, and coroutine-based `UpdateChecker`. `FakeLocalStore` and `FailingLifeApi` are test-only classes declared in `LifeRepositoryTest.kt`.

- [ ] **Step 1: Write failing local-first and version tests**

```kotlin
@Test fun saveSurvivesOfflineSyncFailure() = runTest {
    val repo = DefaultLifeRepository(FakeLocalStore(), FailingLifeApi())
    repo.save(DiaryEntry.fixture("今天"))
    assertEquals(1, repo.entries.first().size)
    assertEquals(SyncState.Pending(1), repo.syncState.first())
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd apps/LifeDiary-Android && ./gradlew test`

- [ ] **Step 3: Implement repository, encrypted token storage, and browser auth**

Use Android Keystore AES/GCM to encrypt a token blob stored in app-private preferences, app-private atomic JSON for records, Kotlin coroutines/Flow for state, and Custom Tabs for Passport. Register an App Link/URI callback and reject callbacks without the expected state value.

- [ ] **Step 4: Convert update checking without changing security rules**

Keep exact platform ID matching, semantic version/build comparison, SHA-256 verification, deletion on mismatch, Downloads destination, and system package installer intent.

- [ ] **Step 5: Test and commit**

Run: `cd apps/LifeDiary-Android && ./gradlew test lint`

```bash
git add apps/LifeDiary-Android
git commit -m "feat: add LifeDiary Android native data services"
```

### Task 8: Implement the Android Native Screens

**Files:**
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/today/TodayScreen.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/diary/DiaryScreen.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/connections/ConnectionsScreen.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/companion/CompanionScreen.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/profile/ProfileScreen.kt`
- Create: `apps/LifeDiary-Android/app/src/androidTest/java/cn/zhengzhengstudio/lifediary/NativeNavigationTest.kt`

**Interfaces:**
- Consumes: Tasks 6–7 destinations, repository, auth, and services.
- Produces: adaptive Material 3 phone/tablet UI and accessibility semantics.

- [ ] **Step 1: Write failing Compose navigation tests**

```kotlin
@Test fun bottomNavigationOpensPrivateDiary() {
    composeRule.setContent { LifeDiaryApp() }
    composeRule.onNodeWithText("日记").performClick()
    composeRule.onNodeWithText("个人日记").assertIsDisplayed()
    composeRule.onNodeWithText("发布到社区").assertDoesNotExist()
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd apps/LifeDiary-Android && ./gradlew connectedLifeDiaryDebugAndroidTest`

- [ ] **Step 3: Implement five destinations and window-size adaptation**

Use `NavigationBar` on compact width and `NavigationRail` on expanded width. Use Material 3 `Scaffold`, `TopAppBar`, `LazyColumn`, `ModalBottomSheet`, and standard dialogs. Add content descriptions and minimum 48 dp touch targets.

- [ ] **Step 4: Add empty/offline/conflict/minor-mode states**

Every network-backed screen consumes a sealed `LoadState`; diary screens show local save status separately from sync status. Minor prompt is shown only after `PassportManager` reports an authenticated minor event.

- [ ] **Step 5: Test, assemble, and commit**

Run: `cd apps/LifeDiary-Android && ./gradlew test lint assembleRelease`

```bash
git add apps/LifeDiary-Android
git commit -m "feat: add LifeDiary Android native screens"
git -C website add api/test/life_diary_android_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify LifeDiary Android screens"
```

### Task 9: Build the HarmonyOS Online Native Foundation

**Files:**
- Delete: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/Index.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/MainPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/models/LifeModels.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/stores/LifeStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/services/LifeApiService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/services/PassportService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/test/NativeStore.test.ets`

**Interfaces:**
- Produces: `LifeStore`, `LifeApiService`, `PassportService`, `LifeTab`, and `MainPage` without ArkWeb. `MemoryPersistence` and `OfflineLifeApi` are test-only classes declared in `NativeStore.test.ets`.

- [ ] **Step 1: Write failing ArkTS repository tests**

```ts
it('keeps a diary entry when sync is offline', 0, async () => {
  const store = new LifeStore(new MemoryPersistence(), new OfflineLifeApi())
  await store.saveDiary(new DiaryEntry('entry-1', '今天', '正文', 0))
  expect(store.diaries.length).assertEqual(1)
  expect(store.pendingSyncCount).assertEqual(1)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `cd apps/LifeDiary-HarmonyOS-Online && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon`

- [ ] **Step 3: Implement Preferences-backed local-first store and API service**

Use Preferences for indexes/metadata and app-private files for serialized records. `LifeApiService` owns request construction and Authorization headers; pages never build URLs directly.

- [ ] **Step 4: Replace ArkWeb login with Account Kit/system authorization**

`PassportService.signIn()` opens the Passport system authorization flow and resolves only after verifying callback state. Persist the token using platform secure storage and emit `{ authenticated: true, isMinor }` for the minor prompt service.

- [ ] **Step 5: Test and commit**

Run: `cd website/api && node --test test/life_diary_harmony_online_contract.test.js test/life_diary_native_ui_contract.test.js`

```bash
git add apps/LifeDiary-HarmonyOS-Online
git commit -m "feat: add LifeDiary HarmonyOS native foundation"
git -C website add api/test/life_diary_harmony_online_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify native LifeDiary HarmonyOS foundation"
```

### Task 10: Implement HarmonyOS Online Native Screens and System Capabilities

**Files:**
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/TodayPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/DiaryPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/ConnectionsPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/CompanionPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/ProfilePage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/components/LifeComponents.ets`
- Modify: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/services/TapFriendService.ets`
- Modify: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/services/MinorModeService.ets`

**Interfaces:**
- Consumes: Task 9 store/auth/API, existing one-time tap-token API, update service.
- Produces: five native tabs, adaptive phone/tablet/2in1 layouts, pending friend request sharing, minor prompt sheet, and system update action.

- [ ] **Step 1: Extend contract tests for five native pages and no device names**

```js
for (const page of ['TodayPage', 'DiaryPage', 'ConnectionsPage', 'CompanionPage', 'ProfilePage']) {
  assert.ok(sources.includes(`struct ${page}`));
}
assert.doesNotMatch(sources, /deviceName|getDeviceName/);
```

- [ ] **Step 2: Run and verify RED**

Run: `cd website/api && node --test test/life_diary_harmony_online_contract.test.js`

- [ ] **Step 3: Implement Tabs/Navigation and responsive breakpoints**

Use `Tabs` for compact devices, a side navigation layout for wide devices, system dialogs/sheets, and ArkUI semantic accessibility properties. Keep community publication in a dedicated confirmation page that constructs a copied DTO.

- [ ] **Step 4: Reconnect tap friend, minor mode, and updates to native UI**

The tap action reads the secure Passport token, requests a one-time server token, shares only that token, and shows a pending request state. Minor prompt actions call the existing seven-day/permanent persistence service. Update actions keep exact app-ID matching.

- [ ] **Step 5: Build HAP/APP and commit**

Run: `cd apps/LifeDiary-HarmonyOS-Online && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon`

Expected: BUILD SUCCESSFUL and no ArkWeb imports.

```bash
git add apps/LifeDiary-HarmonyOS-Online
git commit -m "feat: rebuild LifeDiary HarmonyOS online UI"
git -C website add api/test/life_diary_harmony_online_contract.test.js
git -C website commit -m "test: verify LifeDiary HarmonyOS online screens"
```

### Task 11: Rebuild HarmonyOS Offline as a Structured Native App

**Files:**
- Replace: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/Index.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/MainPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/TodayPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/DiaryPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/HealthPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/ProfilePage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/models/OfflineModels.ets`
- Refactor: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/services/LocalDiaryStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/test/OfflinePrivacy.test.ets`

**Interfaces:**
- Produces: four-tab offline UI, typed diary/period/smoking records, import/export, application lock, and minor-mode settings with no network dependencies. `offlineTabIds(): string[]` returns `['today', 'diary', 'health', 'profile']` for navigation and tests.

- [ ] **Step 1: Write failing privacy and model tests**

```ts
it('does not expose online features', 0, () => {
  expect(offlineTabIds().join(',')).assertEqual('today,diary,health,profile')
})

it('period and smoking tools are opt-in', 0, () => {
  const profile = new OfflineProfile()
  expect(profile.periodEnabled).assertFalse()
  expect(profile.smokingEnabled).assertFalse()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `cd apps/LifeDiary-HarmonyOS-Offline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon`

- [ ] **Step 3: Split the monolithic page and add typed records**

Implement separate record types for diary, period, and smoking data. Preserve atomic JSON import/export and reject unknown schema versions without replacing the current store.

- [ ] **Step 4: Implement the four-tab UI and native states**

Use ArkUI `Tabs`, `Navigation`, Lists, system pickers, dialogs, and responsive columns. Health tools stay hidden until individually enabled. Show “只保存在这台设备” persistently without turning it into a large banner.

- [ ] **Step 5: Verify zero network capability, build, and commit**

Run: `cd website/api && node --test test/life_diary_harmony_offline_contract.test.js test/life_diary_native_ui_contract.test.js`

Run: `cd apps/LifeDiary-HarmonyOS-Offline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon`

```bash
git add apps/LifeDiary-HarmonyOS-Offline
git commit -m "feat: rebuild LifeDiary HarmonyOS offline UI"
git -C website add api/test/life_diary_harmony_offline_contract.test.js api/test/life_diary_native_ui_contract.test.js
git -C website commit -m "test: verify LifeDiary HarmonyOS offline screens"
```

### Task 12: Cross-Platform Privacy, Minor Mode, and Deep-Link Acceptance

**Files:**
- Modify: each platform’s Passport session, navigation router, notification service, and minor-mode store created in Tasks 3–11.
- Create: `website/api/test/life_diary_native_privacy_contract.test.js`

**Interfaces:**
- Consumes: native clients and existing Passport/API behavior.
- Produces: consistent callback validation, neutral notifications, four minor-mode prompt choices, and external website links.

- [ ] **Step 1: Write failing cross-platform privacy contracts**

```js
const { readTree } = require('./helpers/read_tree');
const onlineClientSources = [
  readTree('../../../apps/LifeDiary-Android/app/src/main'),
  readTree('../../../apps/LifeDiary-iOS/Sources/LifeDiary'),
  readTree('../../../apps/LifeDiary-macOS/Sources/LifeDiary'),
  readTree('../../../apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets')
];
for (const source of onlineClientSources) {
  assert.match(source, /sevenDays|suppressSevenDays/);
  assert.match(source, /neverPrompt|setNeverPrompt/);
  assert.match(source, /restorePrompt|恢复未成年人提示/);
  assert.doesNotMatch(source, /通知.*正文|notification.*bodyText/i);
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd website/api && node --test test/life_diary_native_privacy_contract.test.js`

- [ ] **Step 3: Implement exact prompt timing and deep-link validation**

Only authenticated-minor events or offline age-profile completion may call `shouldPresentMinorModePrompt`. All callback handlers validate scheme, host, state, and one-time nonce before accepting tokens.

- [ ] **Step 4: Add neutral notification payloads and application-lock privacy**

Notifications use only product-safe titles such as “生活日记有一条提醒”. App switcher snapshots blur sensitive content while locked.

- [ ] **Step 5: Run all native contracts and commit**

Run: `cd website/api && node --test test/life_diary_native_*.test.js test/life_diary_*contract.test.js`

```bash
git add apps/LifeDiary-Android apps/LifeDiary-iOS apps/LifeDiary-macOS apps/LifeDiary-HarmonyOS-Online apps/LifeDiary-HarmonyOS-Offline
git commit -m "feat: align LifeDiary native privacy behavior"
git -C website add api/test/life_diary_native_privacy_contract.test.js
git -C website commit -m "test: verify LifeDiary native privacy behavior"
```

### Task 13: Rebuild Packages and Update Release Metadata

**Files:**
- Modify: platform version/build files under `apps/LifeDiary-*`
- Replace: `website/api/apps/LifeDiary-*`
- Replace: `website/zhengzhengstudio.cn/api/apps/LifeDiary-*`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/api/scripts/update_lifediary_release.js`
- Modify: `website/api/test/life_diary_release_contract.test.js`

**Interfaces:**
- Consumes: verified platform builds from Tasks 2–12.
- Produces: versioned packages, latest aliases, SHA-256/size metadata, descriptions that say “native app”, and evidence-based changelog entries. `lifeDiaryApps` and `fileFor(app)` are helpers declared in `life_diary_release_contract.test.js` and resolve entries/files from the generated manifests.

- [ ] **Step 1: Bump all clients to version `0.2.0` with monotonically higher builds and write the failing release test**

```js
for (const app of lifeDiaryApps) {
  assert.equal(app.version, '0.2.0');
  assert.match(app.description, /原生|native/i);
  assert.equal(sha256(fileFor(app)), app.sha256);
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd website/api && node --test test/life_diary_release_contract.test.js`

- [ ] **Step 3: Build each platform**

Run:

```bash
(cd apps/LifeDiary-Android && ./gradlew clean test lint assembleRelease)
(cd apps/LifeDiary-iOS && swift test && xcodebuild -scheme LifeDiary -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build)
(cd apps/LifeDiary-macOS && swift test && swift build -c release)
(cd apps/LifeDiary-HarmonyOS-Online && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon)
(cd apps/LifeDiary-HarmonyOS-Offline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon)
```

- [ ] **Step 4: Verify signing truthfully**

Use `apksigner verify`, `codesign --verify --deep --strict`, provisioning inspection, and HarmonyOS signing verification. Set `signed` and `storeReady` only from these results; keep unsigned/test-signed filenames explicit when credentials are absent.

- [ ] **Step 5: Publish artifacts and regenerate manifests**

Run: `cd website && node api/scripts/update_lifediary_release.js`

Add a 2026-07-28 changelog entry describing generated icons, removal of app WebViews, platform-native UI, accessibility, and unchanged private/community separation. Do not disclose backend-sensitive details.

- [ ] **Step 6: Run release tests and commit in the correct repositories**

Run: `cd website/api && node --test test/life_diary_release_contract.test.js`

```bash
git add apps/LifeDiary-* apps/LifeDiary-Brand
git commit -m "release: build LifeDiary native apps 0.2.0"
git -C website add api/apps zhengzhengstudio.cn/api/apps api/data/changelogs.json api/scripts/update_lifediary_release.js api/test/life_diary_release_contract.test.js
git -C website commit -m "release: publish LifeDiary native apps 0.2.0"
```

### Task 14: Full Regression and Platform Acceptance

**Files:**
- Modify only files required by failures found during this task; each defect receives a reproducing test in the owning platform test target.

**Interfaces:**
- Consumes: all completed native apps and release outputs.
- Produces: final evidence that web/API behavior is preserved and every native package meets the approved design.

- [ ] **Step 1: Run the complete LifeDiary server and contract suite**

Run: `cd website/api && node --test test/life_diary*.test.js`

Expected: all tests pass.

- [ ] **Step 2: Run every platform test/build suite**

Run:

```bash
(cd apps/LifeDiary-Android && ./gradlew clean test lint assembleRelease)
(cd apps/LifeDiary-iOS && swift test && xcodebuild -scheme LifeDiary -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build)
(cd apps/LifeDiary-macOS && swift test && swift build -c release)
(cd apps/LifeDiary-HarmonyOS-Online && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon)
(cd apps/LifeDiary-HarmonyOS-Offline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleApp --mode project -p product=default --no-daemon)
```

Expected: all available unsigned/test-signed builds succeed.

- [ ] **Step 3: Perform source-level privacy audits**

Run:

```bash
rg -n "WKWebView|android\.webkit\.WebView|ArkWeb|WebviewController|addJavascriptInterface" apps/LifeDiary-Android apps/LifeDiary-iOS apps/LifeDiary-macOS apps/LifeDiary-HarmonyOS-Online apps/LifeDiary-HarmonyOS-Offline
rg -n "INTERNET|http://|https://|Passport|community|chat" apps/LifeDiary-HarmonyOS-Offline
```

Expected: first command has no primary-flow matches; second has no offline networking or online-feature matches.

- [ ] **Step 4: Inspect representative UI states**

Capture and review light/dark, empty/populated, offline, sync conflict, minor prompt, dynamic-type/large-text, phone/tablet/2in1, and macOS narrow/wide window states. Reject clipped text, inaccessible contrast, web-like navigation, repeated card walls, or platform-inappropriate dialogs.

- [ ] **Step 5: Verify public downloads**

Check every LifeDiary manifest entry, hash, file size, version/build, and download URL. Verify `https://life.zhengzhengstudio.cn/api/health` and the independent website remain available.

- [ ] **Step 6: Close acceptance or return failures to their owning task**

If every command and inspection passes, finish without creating an empty commit. If a check fails, return to the matching platform task, add a reproducing test there, implement the smallest fix, rerun that platform task, and then rerun Task 14 from Step 1.
