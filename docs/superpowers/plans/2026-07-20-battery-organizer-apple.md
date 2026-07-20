# Battery Organizer Apple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide native iPhone, iPad, and macOS navigation with the same local-first inventory and preset behavior.

**Architecture:** Extend the existing SwiftUI store into an actor-backed persistence/sync service. Use platform-specific roots: TabView on compact iOS, NavigationSplitView on iPad/macOS, and a macOS Settings scene.

**Tech Stack:** Swift, SwiftUI, XCTest, URLSession, JSON files.

## Global Constraints

- Preserve the existing Xcode project and SwiftUI stack.
- Use system toolbar and sidebar icons.
- Settings is a dedicated destination on iOS and a Settings scene on macOS.

---

### Task 1: Local-First Store

**Files:**
- Modify: `BatteryOrganizer/电池收纳器/Models/Battery.swift`
- Create: `BatteryOrganizer/电池收纳器/Models/BatteryPreset.swift`
- Create: `BatteryOrganizer/电池收纳器/Services/BatterySyncService.swift`
- Modify: `BatteryOrganizer/电池收纳器/BatteryStore.swift`
- Create: `BatteryOrganizer/电池收纳器Tests/BatteryStoreSyncTests.swift`

**Interfaces:**
- Produces: `BatteryPreset`, `SyncOperation`, `SyncEnvelope`, and async `sync()`.
- Store exposes published `batteries`, `presets`, `syncState`, `totalQuantity`, `lowStockCount`.

- [ ] **Step 1: Write failing XCTest cases**

```swift
func testQuantityChangesImmediatelyWhileOffline() throws {
    let store = BatteryStore(storage: .memory)
    let id = store.addBattery(.fixture(quantity: 2))
    store.changeQuantity(id: id, delta: 1)
    XCTAssertEqual(store.totalQuantity, 3)
    XCTAssertEqual(store.pendingOperations.count, 2)
}
```

Also test preset draft filling and anonymous-to-account merge confirmation.

- [ ] **Step 2: Run tests and confirm failure**

Run: `xcodebuild -project 电池收纳器.xcodeproj -scheme 电池收纳器 test -destination 'platform=macOS'`

- [ ] **Step 3: Implement atomic local persistence and sync**

Write one `SyncEnvelope` JSON file atomically. UI mutations occur on `@MainActor`; network reconciliation occurs in `BatterySyncService` and returns a value merged on the main actor.

- [ ] **Step 4: Run tests**

Expected: PASS.

### Task 2: Adaptive SwiftUI Shell

**Files:**
- Modify: `Views/Main/ContentView.swift`
- Modify: `Views/Forms/BatteryFormView.swift`
- Create: `Views/Presets/PresetsView.swift`
- Modify: `Views/Settings/SettingsView.swift`
- Modify: `App/BatteryOrganizerApp.swift`

- [ ] **Step 1: Add compact and regular roots**

Compact iOS uses `TabView` with Inventory, My Presets, and Settings. Regular width and macOS use `NavigationSplitView`.

- [ ] **Step 2: Rebuild the battery form**

Add horizontal system/custom preset selection, visible Brand field, a Date Unknown toggle, and an advanced DisclosureGroup for model, chemistry, capacity, voltage, and notes.

- [ ] **Step 3: Rebuild settings**

Add account login/register/logout, sync status/refresh, appearance, feedback, privacy, child privacy, and version. macOS exposes this through `Settings { SettingsView() }`.

- [ ] **Step 4: Verify Apple layouts**

Build and inspect iPhone, iPad, and macOS. Expected: no duplicated settings window content, no clipped toolbar controls, and immediate list/stat updates.

### Task 3: Version, Build, Commit

- [ ] **Step 1: Set marketing version 1.1.9 and build 9**
- [ ] **Step 2: Run macOS and iOS builds**

```bash
xcodebuild -project 'BatteryOrganizer/电池收纳器/电池收纳器.xcodeproj' -scheme '电池收纳器' -configuration Release -destination 'platform=macOS' build
xcodebuild -project 'BatteryOrganizer/电池收纳器/电池收纳器.xcodeproj' -scheme '电池收纳器' -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

- [ ] **Step 3: Commit in the nested Apple repository**

```bash
cd BatteryOrganizer/电池收纳器
git add App BatteryStore.swift Models Services Views 电池收纳器.xcodeproj
git commit -m "feat: redesign battery organizer Apple apps"
```

