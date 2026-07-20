# Battery Organizer Offline Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build installable HarmonyOS, Android, iOS/iPadOS, and macOS offline editions that share the redesigned local inventory UI but contain no online service capability.

**Architecture:** First define and test one schema-v2 import/export contract per language. Then add compile-time offline variants with separate package identities and exclude authentication, sync, feedback, push, linking, and update modules from those variants.

**Tech Stack:** ArkTS/ArkUI, Java/Android Gradle, Swift/SwiftUI/Xcode, JSON and native document pickers.

## Global Constraints

- No Web offline edition.
- Display name is `电池收纳器单机版`.
- HarmonyOS bundle name is `cn.zhengzhengstudio.batteryorganizeroffline.hmos`.
- Android application ID is `cn.zhengzhengstudio.batteryorganizer.offline`.
- Apple Bundle ID is `cn.zhengzhengstudio.batteryorganizer.offline`.
- Offline artifacts must not declare network permission or contain executable requests to `zhengzhengstudio.cn`.
- Online and offline applications must install side by side and use separate data containers.
- Import validates the full document before changing local data.

---

### Task 1: Shared Import/Export Contract

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/model/InventoryArchive.ets`
- Create: `BatteryOrganizerAndroid/app/src/main/java/cn/zhengzhengstudio/batteryorganizer/data/InventoryArchive.java`
- Create: `BatteryOrganizer/电池收纳器/Models/InventoryArchive.swift`
- Test: each platform store test file from the cross-platform plan

**Interfaces:**
- Archive shape: `{ format, schemaVersion, exportedAt, batteries, presets, tombstones }`.
- Produces: `encodeArchive`, `validateArchive`, `mergeArchive`, and `replaceWithArchive`.

- [ ] **Step 1: Add failing archive tests**

Test valid round trips, rejection of a wrong `format`, rejection of `schemaVersion > 2`, merge deduplication by UUID, and replace preserving the old state when validation fails.

- [ ] **Step 2: Implement the same schema in ArkTS, Java, and Swift**

Use `format = "cn.zhengzhengstudio.battery-organizer"` and `schemaVersion = 2`. Validate arrays and required entity IDs before beginning a local transaction.

- [ ] **Step 3: Run platform unit tests**

Expected: all archive tests pass.

### Task 2: HarmonyOS Offline Product

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/offline/module.json5`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/build-profile.json5`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/entry/build-profile.json5`
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/OfflineSettingsPage.ets`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/build-hap.sh`

**Interfaces:**
- Consumes: local `BatteryStore` and `InventoryArchive`.
- Produces: offline HAP/APP with no `ohos.permission.INTERNET`.

- [ ] **Step 1: Add an `offline` product**

Set bundle name `cn.zhengzhengstudio.batteryorganizeroffline.hmos`, label `电池收纳器单机版`, and compile-time boolean `OFFLINE_EDITION`.

- [ ] **Step 2: Exclude online settings**

Build `OfflineSettingsPage` with backup, restore, import, export, appearance, privacy, child privacy, and version only.

- [ ] **Step 3: Add document picker import/export**

Use the HarmonyOS file picker and write/read the schema-v2 archive. Present Merge and Replace confirmation before applying imported records.

- [ ] **Step 4: Build and inspect**

Build the offline product, unpack the HAP metadata, and assert no `ohos.permission.INTERNET`, Push Kit, App Linking, or `zhengzhengstudio.cn` string is present.

### Task 3: Android Offline Flavor

**Files:**
- Modify: `BatteryOrganizerAndroid/app/build.gradle.kts`
- Create: `BatteryOrganizerAndroid/app/src/offline/AndroidManifest.xml`
- Create: `BatteryOrganizerAndroid/app/src/offline/res/values/strings.xml`
- Create: `BatteryOrganizerAndroid/app/src/offline/java/cn/zhengzhengstudio/batteryorganizer/OfflineSettingsController.java`

**Interfaces:**
- Consumes: `BatteryRepository` and `InventoryArchive`.
- Produces: `offlineRelease` APK.

- [ ] **Step 1: Add `online` and `offline` product flavors**

Use one `edition` dimension. Offline sets the independent application ID and `BuildConfig.OFFLINE_EDITION = true`.

- [ ] **Step 2: Remove network permission**

The offline manifest uses manifest merger removal for `android.permission.INTERNET` and contains no online service declarations.

- [ ] **Step 3: Add Storage Access Framework import/export**

Use `ACTION_CREATE_DOCUMENT` and `ACTION_OPEN_DOCUMENT`; validate before showing Merge or Replace.

- [ ] **Step 4: Build and inspect**

Run `./gradlew assembleOfflineRelease`. Inspect the merged manifest and APK strings for forbidden online capabilities.

### Task 4: Apple Offline Target

**Files:**
- Modify: `BatteryOrganizer/电池收纳器/电池收纳器.xcodeproj/project.pbxproj`
- Create: `BatteryOrganizer/电池收纳器/App/OfflineBatteryOrganizerApp.swift`
- Create: `BatteryOrganizer/电池收纳器/Views/Settings/OfflineSettingsView.swift`
- Modify target membership for `BatterySyncService.swift`

**Interfaces:**
- Consumes: local `BatteryStore` and `InventoryArchive`.
- Produces: offline iOS/iPadOS and macOS products.

- [ ] **Step 1: Add offline target/configuration**

Set Bundle ID, display name, app icon set, and `OFFLINE_EDITION` compilation condition. Keep a separate app data container.

- [ ] **Step 2: Exclude network services**

Do not include `BatterySyncService.swift` or online account code in offline target membership.

- [ ] **Step 3: Add fileImporter/fileExporter**

Use a Codable `FileDocument` wrapper for schema-v2 JSON. Validate before merge/replace.

- [ ] **Step 4: Build and inspect**

Build generic iOS and macOS offline products and scan binaries/resources for `zhengzhengstudio.cn`.

### Task 5: Release Verification

**Files:**
- Modify native version metadata only.
- Do not add offline products to the website or website download center.

- [ ] **Step 1: Verify side-by-side identities**

Confirm online and offline bundle/application IDs differ on every platform.

- [ ] **Step 2: Verify airplane-mode acceptance**

Add, edit, delete, create a preset, export, clear, and import while networking is disabled.

- [ ] **Step 3: Build versioned local backups**

Copy offline HAP/APP, APK, IPA/archive, and macOS app artifacts to Downloads with platform and version in each filename.

- [ ] **Step 4: Commit**

Commit each platform independently after its tests pass; do not commit signing passwords, keystores, profiles, or generated build directories.

