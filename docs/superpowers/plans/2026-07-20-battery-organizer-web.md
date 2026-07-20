# Battery Organizer Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the battery website into a responsive application shell with local-first inventory, presets, and settings.

**Architecture:** Split the current monolithic HTML into semantic HTML, CSS, a pure local store, and a controller. Render from local state immediately; queue sync operations in localStorage and reconcile through the v2 API.

**Tech Stack:** Vanilla HTML, CSS, JavaScript, `node:test`, browser automation.

## Global Constraints

- Keep Passport redirect login.
- Do not add HTML below `website/api`.
- Update `website/api/data/changelogs.json`.
- Do not show platform download cards in the primary inventory workflow.

---

### Task 1: Web Local Store

**Files:**
- Create: `website/zhengzhengstudio.cn/battery-organizer/battery-store.js`
- Create: `website/zhengzhengstudio.cn/battery-organizer/battery-store.test.cjs`

**Interfaces:**
- Produces: `createBatteryStore(storage, now)`.
- Store methods: `getSnapshot()`, `upsertBattery()`, `deleteBattery()`, `changeQuantity()`, `upsertPreset()`, `deletePreset()`, `mergeSyncResponse()`.

- [ ] **Step 1: Write failing tests**

Test immediate totals, persisted pending operations, duplicate server changes, anonymous/account namespace separation, and login merge choice.

- [ ] **Step 2: Run tests**

Run: `node --test website/zhengzhengstudio.cn/battery-organizer/battery-store.test.cjs`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Persist this envelope under `battery-organizer-v2`:

```js
{
  activeSpace: 'anonymous',
  spaces: {
    anonymous: { cursor: 0, batteries: {}, presets: {}, pending: [] }
  }
}
```

Each mutation writes the entity and operation in one synchronous storage update before notifying subscribers.

- [ ] **Step 4: Run tests**

Expected: PASS.

### Task 2: Responsive App Shell

**Files:**
- Create: `website/zhengzhengstudio.cn/battery-organizer/battery-organizer.css`
- Create: `website/zhengzhengstudio.cn/battery-organizer/battery-organizer.js`
- Modify: `website/zhengzhengstudio.cn/battery-organizer/index.html`

**Interfaces:**
- Consumes: `createBatteryStore`.
- Produces: Inventory, My Presets, Settings navigation and an add/edit dialog.

- [ ] **Step 1: Replace the monolithic layout**

Use semantic regions:

```html
<aside class="app-sidebar" aria-label="主要导航"></aside>
<main class="app-content" id="mainContent"></main>
<nav class="mobile-tabs" aria-label="主要导航"></nav>
<dialog id="batteryDialog"></dialog>
```

- [ ] **Step 2: Apply native-style responsive CSS**

At widths below `720px`, hide the sidebar, show fixed bottom tabs, use a single-column form, and reserve bottom safe-area padding. At `720px` and above, show the sidebar and constrain content to `1280px`.

- [ ] **Step 3: Implement preset behavior**

System and custom preset buttons set selected state and fill form controls through one `applyPreset(preset)` function. Brand remains outside the advanced disclosure.

- [ ] **Step 4: Implement local-first sync**

`saveBattery()` first calls the local store and closes the dialog; `flushSyncQueue()` runs afterward with a 5-second timeout and never rolls back successful local writes.

- [ ] **Step 5: Add Settings and merge confirmation**

Settings contains account, sync, appearance, feedback, privacy, child privacy, and version. First account login with anonymous records opens a merge confirmation before upload.

- [ ] **Step 6: Add the public changelog entry**

Prepend one `电池收纳器` improvement entry describing the navigation, offline queue, custom presets, responsive layout, and theme fixes. Do not mention backend internals.

- [ ] **Step 7: Verify**

Run the store tests and browser checks at 390x844, 834x1194, and 1440x900 in both themes.

- [ ] **Step 8: Commit**

```bash
git add website/zhengzhengstudio.cn/battery-organizer/index.html website/zhengzhengstudio.cn/battery-organizer/battery-organizer.css website/zhengzhengstudio.cn/battery-organizer/battery-organizer.js website/zhengzhengstudio.cn/battery-organizer/battery-store.js website/zhengzhengstudio.cn/battery-organizer/battery-store.test.cjs website/api/data/changelogs.json
git commit -m "feat: redesign battery organizer web app"
```

