# Survival Diary HarmonyOS Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build separate native HarmonyOS online and offline Survival Diary apps with ArkUI Canvas gameplay, shared deterministic rules, and online-only tap/friend features.

**Architecture:** New `SurvivalDiary-HarmonyOS-Online` and `SurvivalDiary-HarmonyOS-Offline` projects share copied content and ArkTS domain sources through a deterministic sync script. Neither project imports ArkWeb; the offline app has a compile-time capability set that excludes all networking.

**Tech Stack:** ArkTS, ArkUI Canvas, Preferences/File APIs, Network Kit, Share Kit/nearby capability where available, Hvigor, ohosTest.

## Global Constraints

- Online bundle name is `cn.zhengzhengstudio.survivaldiary.hmos`.
- Offline bundle name is `cn.zhengzhengstudio.survivaldiary.offline.hmos`.
- Version is `0.3.0`, `versionCode 30000`.
- No `@kit.ArkWeb`, `webview`, or `Web(...)`.
- Offline source and final HAP/APP contain no network, Passport, Kimi, friend, chat, public-island, update-download, or tap capability.
- Tap receiver always previews and confirms.

---

### Task 1: Create Isolated Online and Offline Projects

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Online/build-profile.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/AppScope/app.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/pages/Index.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/build-profile.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/AppScope/app.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/pages/Index.ets`
- Modify: `tests/survival_diary_native_clients.test.js`

**Interfaces:**
- Both entry pages host `GameCanvas` and `GameHud`.

- [ ] **Step 1: Extend failing native client checks**

```js
for (const edition of ['Online', 'Offline']) {
  const tree = readTree(`apps/SurvivalDiary-HarmonyOS-${edition}`);
  assert.match(tree, /Canvas/);
  assert.doesNotMatch(tree, /ArkWeb|webview|\\bWeb\\s*\\(/);
}
```

- [ ] **Step 2: Scaffold both ArkUI apps**

Use independent app identities and resources. Copy only approved icon/atlas assets; do not copy Life Diary pages or services.

- [ ] **Step 3: Build debug HAPs**

```bash
cd apps/SurvivalDiary-HarmonyOS-Online && hvigorw assembleHap --mode module -p product=default -p buildMode=debug
cd ../SurvivalDiary-HarmonyOS-Offline && hvigorw assembleHap --mode module -p product=default -p buildMode=debug
```

- [ ] **Step 4: Commit**

```bash
git add apps/SurvivalDiary-HarmonyOS-* tests/survival_diary_native_clients.test.js
git commit -m "feat: scaffold native Survival Diary Harmony apps"
```

### Task 2: Implement ArkTS v2 Domain and Fixture Parity

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/model/GameSave.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/domain/Simulation.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/data/SaveRepository.ets`
- Create: `scripts/sync_survival_diary_harmony_shared.mjs`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/test/FixtureParity.test.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/test/FixtureParity.test.ets`

**Interfaces:**
- Produces: `Simulation.create(seed, mode)`, `Simulation.step(state, command)`, `SaveRepository.load/save`.

- [ ] **Step 1: Write failing fixture tests**

```ts
it('matches world v2 fixture', 0, () => {
  const result = fixture.commands.reduce((state, command) => Simulation.step(state, command),
    Simulation.create(fixture.seed, PlayMode.GUIDED))
  expect(result.stableDigest()).assertEqual(fixture.expectedDigest)
})
```

- [ ] **Step 2: Implement strict ArkTS models**

Use explicit interfaces/unions, integer minutes, sorted digest serialization, and no dynamic `any`.

- [ ] **Step 3: Implement atomic Preferences/file saves**

Persist pending/current/previous records. Offline and online use distinct app sandboxes and offer exported-file migration only.

- [ ] **Step 4: Sync, test, and commit**

```bash
node scripts/sync_survival_diary_harmony_shared.mjs
hvigorw test
git add apps/SurvivalDiary-HarmonyOS-* scripts/sync_survival_diary_harmony_shared.mjs
git commit -m "feat: add Harmony Survival Diary domain"
```

### Task 3: Build ArkUI Canvas World and Responsive HUD

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/game/GameCanvas.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/game/Camera2D.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/ui/GameHud.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Shared/ets/ui/DiaryBook.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/test/Camera2D.test.ets`

**Interfaces:**
- Produces reversible camera transforms, four rotations, 0.35–3.0 zoom, placement preview, and screen-space task markers.

- [ ] **Step 1: Write failing transform and mode tests**

Test zoom/rotation, same actor/entity scale, first-run guided mode, A/B shared save, and placement without partial material loss.

- [ ] **Step 2: Implement Canvas renderer**

Render terrain chunks, entities, actors, shadows, precipitation, fog, wet/snow states, and LOD with PNG/WebP atlases. Canvas hit testing uses the same camera transform.

- [ ] **Step 3: Implement ArkUI HUD and diary**

Use safe areas, phone/tablet breakpoints, 48vp targets, bottom quickbar, left movement, right actions, full-page diary, and pause-menu A/B switch.

- [ ] **Step 4: Sync, test, and commit**

```bash
node scripts/sync_survival_diary_harmony_shared.mjs
cd apps/SurvivalDiary-HarmonyOS-Online && hvigorw test
git add apps/SurvivalDiary-HarmonyOS-*
git commit -m "feat: render Survival Diary natively on Harmony"
```

### Task 4: Add Online Friends, Islands, Reconnect, and Tap

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SurvivalApi.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/ReconnectQueue.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/TapInviteService.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/ReleasePushService.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/pages/TapPreview.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/test/TapInvite.test.ets`

**Interfaces:**
- `TapInviteService.create(kind, islandId?)`, `preview(token)`, `confirm(token)`, `share(payload)`.

- [ ] **Step 1: Write failing tap tests**

Verify friend request, public/non-personal island invite, allowed non-personal invite, private rejection, preview-before-confirm, expiry, replay rejection, and block rejection.

- [ ] **Step 2: Implement Passport and online queue**

Use system secure storage for tokens. Commands carry event IDs/base revisions and survive reconnect.

- [ ] **Step 3: Implement system share/nearby adapter**

Transmit only an HTTPS/App Linking token. If direct nearby touch capability is unavailable on the device, use Share Kit with the same preview/confirm flow and show the compatibility explanation.

- [ ] **Step 4: Register Huawei release push**

`ReleasePushService` registers only after opt-in, sends the push token/current build to `/push/subscriptions`, and re-reads the manifest before showing AppGallery/direct-channel update actions. The Offline edition has no push source or permission.

- [ ] **Step 5: Run and commit**

```bash
hvigorw test
git add apps/SurvivalDiary-HarmonyOS-Online
git commit -m "feat: add Harmony Survival Diary tap and online play"
```

### Task 5: Enforce the Offline Capability Boundary

**Files:**
- Create: `tests/survival_diary_harmony_offline.test.js`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/module.json5`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/oh-package.json5`

- [ ] **Step 1: Write failing offline source/package test**

Reject network permissions, HTTP/WebSocket imports, Passport/Kimi/friend/tap strings, remote URLs, and online dependencies in both source and unpacked release artifacts.

- [ ] **Step 2: Remove forbidden capabilities from the offline edition**

Offline settings show “本版本完全离线”; update help explains that AppGallery handles upgrades. Do not include a disabled online button.

- [ ] **Step 3: Build, inspect, and commit**

```bash
node --test tests/survival_diary_harmony_offline.test.js
cd apps/SurvivalDiary-HarmonyOS-Offline
hvigorw assembleHap --mode module -p product=default -p buildMode=release
git add apps/SurvivalDiary-HarmonyOS-Offline tests/survival_diary_harmony_offline.test.js
git commit -m "feat: enforce Survival Diary Harmony offline edition"
```

### Task 6: Harmony Native Acceptance Gate

**Files:**
- Create: `tests/survival_diary_harmony_native.test.js`

- [ ] **Step 1: Verify identities, builds, and native assets**

Check both bundle names, version/versionCode, app icons, Canvas source, no ArkWeb, online-only networking, offline exclusion, and signing config indirection.

- [ ] **Step 2: Run**

```bash
node --test tests/survival_diary_native_clients.test.js tests/survival_diary_harmony_offline.test.js tests/survival_diary_harmony_native.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/survival_diary_harmony_native.test.js
git commit -m "test: verify native Survival Diary Harmony apps"
```
