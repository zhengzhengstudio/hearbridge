# Battery Organizer Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a native-feeling, offline-safe battery organizer on Web, HarmonyOS, Android, iOS/iPadOS, and macOS.

**Architecture:** Implement the versioned, idempotent sync contract first, then migrate each client independently while preserving the legacy battery endpoints. Every client renders from local state, queues mutations, and treats cloud sync as reconciliation rather than replacement.

**Tech Stack:** Node.js/Express, vanilla HTML/CSS/JavaScript, ArkTS/ArkUI, Java/Android Material, Swift/SwiftUI, JSON persistence.

## Global Constraints

- Do not overwrite `website/api/data/battery_organizer.json`; migrate each user record only when that user writes through the v2 API.
- Keep `GET/PUT /api/battery-organizer/batteries` working for installed legacy clients.
- Mobile navigation is Inventory, My Presets, Settings; Add is a command, not a tab.
- Brand remains available in the basic form; model, chemistry, capacity, voltage, and notes are advanced fields.
- Preset selection fills the form and remains editable; it never saves automatically.
- Local mutations update list and statistics immediately and survive offline operation, logout, process termination, and sync failure.
- Light and dark themes must use readable native controls without horizontal overflow.
- Website UI changes require a public entry in `website/api/data/changelogs.json`.
- Do not add HTML files under `website/api`.

## Execution Order

1. [Backend sync plan](./2026-07-20-battery-organizer-backend-sync.md)
2. [Web app plan](./2026-07-20-battery-organizer-web.md)
3. [HarmonyOS plan](./2026-07-20-battery-organizer-harmonyos.md)
4. [Android plan](./2026-07-20-battery-organizer-android.md)
5. [Apple plan](./2026-07-20-battery-organizer-apple.md)
6. Cross-platform release verification

### Task 6: Cross-Platform Release Verification

**Files:**
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: platform version files named in the child plans

**Interfaces:**
- Consumes: `POST /api/battery-organizer/sync` schema version 2 and completed client implementations.
- Produces: Versioned release artifacts and matching update manifests.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
cd website/api && npm test
cd ../../BatteryOrganizerAndroid && ./gradlew testDebugUnitTest
cd ../HarmonyOS-App/BatteryOrganizerHarmony && "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" test
cd ../../BatteryOrganizer/电池收纳器 && xcodebuild -project 电池收纳器.xcodeproj -scheme 电池收纳器 test -destination 'platform=macOS'
```

Expected: every command exits `0`.

- [ ] **Step 2: Run responsive UI verification**

Run the website locally and capture 390x844, 834x1194, and 1440x900 screenshots in light and dark mode. Verify no horizontal overflow with:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

Expected: `true` at every viewport.

- [ ] **Step 3: Exercise the offline acceptance flow**

On each native platform: log in, disable networking, add one battery, change its quantity, terminate and reopen the app, restore networking, tap Refresh, and confirm the item remains visible and reaches a second client.

Expected: the local item never disappears and the final server state contains exactly one copy.

- [ ] **Step 4: Bump release versions once**

Use:

```text
Web: 1.1.10 build 12
HarmonyOS: 1.1.16 build 1000116
Android: 1.1.10 versionCode 12
Apple: 1.1.9 build 9
```

Expected: package metadata, update manifests, and visible Settings versions match.

- [ ] **Step 5: Build release artifacts**

Run platform build commands from the child plans. Copy versioned artifacts to Downloads and update `latest` aliases only after checksums and versions are verified.

- [ ] **Step 6: Commit integration metadata**

```bash
git add website/api/apps/manifest.json website/api/apps/client-downloads.json website/api/data/changelogs.json
git commit -m "release: publish battery organizer native redesign"
```

