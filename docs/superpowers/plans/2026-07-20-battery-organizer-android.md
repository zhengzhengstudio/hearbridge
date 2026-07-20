# Battery Organizer Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-activity generated layout with a Material 3 app structure and offline-safe inventory.

**Architecture:** Keep Java and the existing minimum SDK. Extract persistence/sync and form logic from `MainActivity`, then render three native destinations using stable view IDs and Material components.

**Tech Stack:** Java, Android SDK 24+, Material Components, SharedPreferences, JUnit.

## Global Constraints

- Application ID stays `cn.zhengzhengstudio.batteryorganizer`.
- Do not embed WebView.
- All mutations persist locally before starting network work.

---

### Task 1: Local Repository

**Files:**
- Modify: `app/build.gradle.kts`
- Create: `app/src/main/java/cn/zhengzhengstudio/batteryorganizer/data/BatteryRepository.java`
- Create: `app/src/main/java/cn/zhengzhengstudio/batteryorganizer/data/BatteryPreset.java`
- Create: `app/src/test/java/cn/zhengzhengstudio/batteryorganizer/data/BatteryRepositoryTest.java`

**Interfaces:**
- Produces: `Snapshot observe/getSnapshot`, `upsertBattery`, `changeQuantity`, `deleteBattery`, `upsertPreset`, `mergeSyncResponse`.

- [ ] **Step 1: Add JUnit dependency and failing repository tests**

Add:

```kotlin
dependencies {
    implementation("com.google.android.material:material:1.13.0")
    testImplementation("junit:junit:4.13.2")
}
```

Then test immediate total quantity, persistent pending operation IDs, idempotent sync merge, and anonymous/account separation.

- [ ] **Step 2: Implement SharedPreferences repository**

Use one atomic JSON envelope per account space. Call listeners only after the envelope has been persisted.

- [ ] **Step 3: Run tests**

Run: `cd BatteryOrganizerAndroid && ./gradlew testDebugUnitTest`

Expected: PASS.

### Task 2: Material Navigation and Editor

**Files:**
- Create: `app/src/main/res/layout/activity_main.xml`
- Create: `app/src/main/res/layout/view_inventory.xml`
- Create: `app/src/main/res/layout/view_presets.xml`
- Create: `app/src/main/res/layout/view_settings.xml`
- Create: `app/src/main/res/layout/dialog_battery_editor.xml`
- Modify: `app/src/main/java/cn/zhengzhengstudio/batteryorganizer/MainActivity.java`
- Modify: `app/src/main/res/values/styles.xml`
- Create: `app/src/main/res/values-night/styles.xml`

- [ ] **Step 1: Add Inventory, My Presets, Settings bottom navigation**

Use icon buttons for Add and Refresh in the top app bar. Remove duplicate settings/login buttons from the inventory content.

- [ ] **Step 2: Build the editor**

Preset chips fill controls through one `applyPreset(BatteryPreset preset)` method. Brand is always visible; advanced fields start collapsed.

- [ ] **Step 3: Bind immediate rendering**

Register one repository listener in `onStart`, unregister in `onStop`, and render list and totals from the same snapshot.

- [ ] **Step 4: Add settings and offline status**

Settings includes login/register/logout, sync, appearance, feedback, privacy, child privacy, and version. The status row displays Synced, Waiting for network, Syncing, or Retry.

- [ ] **Step 5: Verify**

Run unit tests and an Android lint/build:

```bash
cd BatteryOrganizerAndroid
./gradlew testDebugUnitTest lintDebug assembleRelease
```

Expected: successful release APK and no fatal lint issues.

### Task 3: Version and Commit

- [ ] **Step 1: Set `versionName = "1.1.10"` and `versionCode = 12`**
- [ ] **Step 2: Commit**

```bash
git add BatteryOrganizerAndroid
git commit -m "feat: redesign battery organizer Android app"
```
