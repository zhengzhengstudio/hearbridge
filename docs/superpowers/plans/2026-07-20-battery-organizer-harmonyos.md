# Battery Organizer HarmonyOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an AppGallery-ready HarmonyOS phone, tablet, and 2in1 app with working presets, immediate statistics, and offline-safe sync.

**Architecture:** Split `Index.ets` into models, a state store, reusable views, and three destinations. The root uses Tabs on phones and NavigationSplit-style columns at wider breakpoints.

**Tech Stack:** ArkTS, ArkUI, Preferences, HTTP client, Hypium.

## Global Constraints

- Bundle name stays `cn.zhengzhengstudio.batteryorganizer.hmos`.
- No in-app installer or update download UI.
- API 23/24 layouts must not overflow.
- Use resource colors for every text, field, border, and surface.

---

### Task 1: Store and Preset Regression

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/model/BatteryModels.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/store/BatteryStore.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/test/BatteryStore.test.ets`

**Interfaces:**
- Produces: `Battery`, `BatteryPreset`, `SyncOperation`, `BatterySnapshot`, and `BatteryStore`.
- Store methods: `applyPreset`, `saveBattery`, `changeQuantity`, `deleteBattery`, `queueSync`, `mergeServerChanges`.

- [ ] **Step 1: Write a failing preset test**

```ts
it('fills an editable draft from a preset', 0, () => {
  const draft = store.applyPreset(SYSTEM_PRESETS[0])
  expect(draft.brand).assertEqual('南孚')
  expect(draft.name.length > 0).assertTrue()
  expect(store.snapshot.batteries.length).assertEqual(0)
})
```

- [ ] **Step 2: Write immediate-total and offline-persistence tests**

Assert that `changeQuantity` changes `totalCount` in the same call and that recreating the store from Preferences restores pending operations.

- [ ] **Step 3: Implement the store and run tests**

Run:

```bash
cd HarmonyOS-App/BatteryOrganizerHarmony
"$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" test \
  --mode module \
  -p product=default \
  -p module=entry@default \
  --no-daemon
```

Expected: all store tests pass.

### Task 2: Native Navigation and Forms

**Files:**
- Create: `entry/src/main/ets/pages/InventoryPage.ets`
- Create: `entry/src/main/ets/pages/PresetsPage.ets`
- Create: `entry/src/main/ets/pages/SettingsPage.ets`
- Create: `entry/src/main/ets/components/BatteryEditor.ets`
- Create: `entry/src/main/ets/components/SyncStatus.ets`
- Modify: `entry/src/main/ets/pages/Index.ets`

**Interfaces:**
- Consumes: one shared `BatteryStore` instance.
- Produces: phone Tabs and wide three-column navigation.

- [ ] **Step 1: Reduce Index to root navigation**

Phone root contains Inventory, My Presets, and Settings tabs. Wide root uses a fixed navigation rail and one content destination. Settings and editor must never be built under Inventory simultaneously.

- [ ] **Step 2: Build the inventory destination**

Use a compact three-value statistics row, filter control, refresh icon, add icon, and keyed battery list. Subscribe directly to the store snapshot so totals update immediately.

- [ ] **Step 3: Build the editor**

Render presets with `ForEach(..., preset => preset.id)` and attach `onClick(() => store.selectPreset(preset.id))` to the complete button surface. Keep brand in the basic section and advanced fields in a disclosure.

- [ ] **Step 4: Build presets and settings**

Presets supports unlimited account/local records. Settings contains login/register/logout, sync, appearance, feedback, privacy, child privacy, and version.

- [ ] **Step 5: Verify themes and breakpoints**

Check 360vp phone, foldable portrait, tablet landscape, and 2in1. Expected: no horizontal clipping; dark input text and placeholder text remain readable.

### Task 3: Build and Version

**Files:**
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/AppScope/app.json5`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/build-hap.sh`

- [ ] **Step 1: Set version 1.1.16 build 1000116**

- [ ] **Step 2: Build**

Run: `cd HarmonyOS-App/BatteryOrganizerHarmony && ./build-hap.sh`

Expected: signed `.hap` when signing environment variables are available; no secret is written to source.

- [ ] **Step 3: Commit**

```bash
git add HarmonyOS-App/BatteryOrganizerHarmony
git commit -m "feat: rebuild battery organizer for HarmonyOS"
```
