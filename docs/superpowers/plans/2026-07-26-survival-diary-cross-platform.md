# Survival Diary Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish “生存日记” as a non-block, endless native survival sandbox on Web, iOS, macOS, Android, HarmonyOS online, and HarmonyOS offline, with Kimi-directed diaries, cross-platform friends, updates, signed packages, and competition/store material.

**Architecture:** Each client has a native renderer and input layer, while all platforms consume the same JSON content, save schema, protocol schema, seeded-world fixtures, and milestone definitions. A Node.js authoritative service owns online worlds, friends, tap tokens, cloud saves, and the Kimi proxy; clients remain playable with local saves and a deterministic narrative fallback.

**Tech Stack:** Node.js built-in test runner, Web Canvas/ES modules, Express 5, `ws`, Swift/SpriteKit, Kotlin/Android Canvas or Compose, ArkTS/ArkUI Canvas, APNs/FCM/Huawei Push, Kimi HTTP API, Xcode, Gradle, DevEco/Hvigor, `apksigner`, `codesign`, and `hap-sign-tool`.

## Global Constraints

- The world is non-block, procedurally expanding, and has no final ending, fixed campaign, or day limit.
- The game is free, has no ads or in-app purchases, and uses all-ages presentation.
- The primary login CTA is “建议使用铮铮通行证登录”; the secondary action is “本地游玩”; helper copy is “临时身份和存档仅保存在本机”.
- Kimi may author narrative, suggestions, memories, and candidate events, but may not directly grant resources, apply damage, or set milestone state.
- HarmonyOS offline has a separate bundle ID and excludes accounts, networking, Kimi, friends, tap-to-add, push, and off-store updates.
- A remote update exists only when remote semantic version is greater, or versions match and remote build is greater.
- Every package record includes exact byte size and SHA-256; unsigned artifacts must never be marked `signed` or `storeReady`.
- Website changes must update `website/api/data/changelogs.json` and its main-site mirror.
- Marketing/download surfaces follow `taste-skill`: one accent palette, consistent radii, real imagery, explicit mobile collapse, reduced motion, dual theme, no generic AI-purple, and no fake product screenshots.
- Public Bilibili submission must be a landscape video of at least one minute, tagged `#B站AI创造公开赛#`, and published before 2026-08-20 23:59:59.

## File Map

- `apps/SurvivalDiaryShared/`: canonical content, JSON schemas, deterministic fixtures, release constants, and export scripts.
- `website/survival-diary.zhengzhengstudio.cn/`: playable Web client, PWA files, generated concept assets, and public landing surface.
- `website/survival-diary.zhengzhengstudio.cn/server/`: authoritative world/friend/save/Kimi WebSocket and HTTP service.
- `apps/SurvivalDiary-Apple/`: Swift package with shared simulation plus iOS and macOS SpriteKit app targets.
- `apps/SurvivalDiary-Android/`: Kotlin Android application.
- `apps/SurvivalDiary-HarmonyOS-Online/`: ArkTS online application with NFC/Share Kit invitation entry points.
- `apps/SurvivalDiary-HarmonyOS-Offline/`: store-oriented ArkTS offline application.
- `apps/build_survival_diary_apps.sh`: reproducible cross-platform build and signing coordinator.
- `website/api/scripts/publish_survival_diary.js`: atomic package metadata, mirror, manifest, and changelog publisher.
- `tests/survival_diary_*.test.js`: repository-level contract, package, and release consistency tests.

---

## Phase A: Shared Rules, Server, and Web Vertical Slice

### Task 1: Canonical Contracts and Endless World Fixtures

**Files:**
- Create: `apps/SurvivalDiaryShared/schemas/save.schema.json`
- Create: `apps/SurvivalDiaryShared/schemas/protocol.schema.json`
- Create: `apps/SurvivalDiaryShared/content/items.json`
- Create: `apps/SurvivalDiaryShared/content/recipes.json`
- Create: `apps/SurvivalDiaryShared/content/biomes.json`
- Create: `apps/SurvivalDiaryShared/content/milestones.json`
- Create: `apps/SurvivalDiaryShared/fixtures/world-seed-20260726.json`
- Create: `apps/SurvivalDiaryShared/src/reference-simulation.js`
- Create: `tests/survival_diary_contracts.test.js`

**Interfaces:**
- Produces: `createWorld(seed: string): WorldState`, `stepWorld(state: WorldState, command: WorldCommand): WorldState`, and JSON `schemaVersion: 1`.
- Produces protocol messages: `join`, `command`, `snapshot`, `friend_request`, `tap_token_create`, `tap_token_redeem`, `diary_request`, and `error`.

- [ ] **Step 1: Write failing contract tests**

```js
test('same seed and commands produce the same region digest', () => {
  const commands = fixture.commands;
  const a = commands.reduce(stepWorld, createWorld(fixture.seed));
  const b = commands.reduce(stepWorld, createWorld(fixture.seed));
  assert.equal(digestWorld(a), digestWorld(b));
});

test('world expansion is non-block and does not define an ending', () => {
  const biomes = readJson('apps/SurvivalDiaryShared/content/biomes.json');
  const milestones = readJson('apps/SurvivalDiaryShared/content/milestones.json');
  assert.ok(biomes.every(item => item.terrainModel === 'continuous-low-poly'));
  assert.ok(milestones.every(item => item.terminal !== true));
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/survival_diary_contracts.test.js`
Expected: FAIL because shared schemas and simulation exports do not exist.

- [ ] **Step 3: Implement minimal schemas, content, seeded region generation, and milestone evaluation**

```js
function createWorld(seed) {
  return { schemaVersion: 1, seed, day: 1, time: 360, regions: {}, players: {}, milestones: {} };
}

function stepWorld(state, command) {
  const next = structuredClone(state);
  if (command.type === 'discover_region') next.regions[command.region.id] = command.region;
  if (command.type === 'advance_time') next.time += command.minutes;
  return next;
}
```

- [ ] **Step 4: Run the contract tests and validate every JSON file parses**

Run: `node --test tests/survival_diary_contracts.test.js`
Expected: PASS with deterministic digest and no terminal milestone.

- [ ] **Step 5: Commit the shared contract**

```bash
git add apps/SurvivalDiaryShared tests/survival_diary_contracts.test.js
git commit -m "feat: add survival diary shared contracts"
```

### Task 2: Authoritative World, Friend, Save, and Tap Service

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/package.json`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/friend-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/tap-tokens.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/server.test.js`
- Modify: `sync_to_termux.js`

**Interfaces:**
- Consumes: Task 1 protocol and `stepWorld` reference behavior.
- Produces: `POST /session`, `GET/PUT /saves/:slot`, `GET /islands/public`, `POST /islands/:id/visit`, `POST /friends/requests`, `POST /tap-tokens`, `POST /tap-tokens/:token/redeem`, and WebSocket `/ws`.
- Authenticates passport users through the existing `POST /api/zz-pass/session`; guest IDs are scoped to one device and cannot create permanent friends.

- [ ] **Step 1: Write failing tests for authority and one-time tap tokens**

```js
test('tap token expires and cannot be redeemed twice', async () => {
  const token = createTapToken({ senderUid: 'u1', kind: 'friend', now: 1000 });
  assert.equal(redeemTapToken(token.value, 'u2', 1050).senderUid, 'u1');
  assert.throws(() => redeemTapToken(token.value, 'u3', 1060), /used/);
  const expired = createTapToken({ senderUid: 'u1', kind: 'friend', now: 1000 });
  assert.throws(() => redeemTapToken(expired.value, 'u2', 61001), /expired/);
});

test('server rejects inventory mutation not backed by a command', () => {
  assert.throws(() => validateCommand({ type: 'set_inventory', amount: 999 }), /unsupported/);
});
```

- [ ] **Step 2: Verify the service tests fail**

Run: `node --test website/survival-diary.zhengzhengstudio.cn/server/test/*.test.js`
Expected: FAIL because stores and validators are missing.

- [ ] **Step 3: Implement atomic JSON persistence, authoritative commands, persistent co-op/public islands, asynchronous friend visits, friend privacy, block/report rules, and 60-second one-use tokens**

```js
function createTapToken({ senderUid, kind, islandId = '', now = Date.now() }) {
  const value = crypto.randomBytes(24).toString('base64url');
  records.set(value, { senderUid, kind, islandId, expiresAt: now + 60_000, used: false });
  return { value, expiresAt: now + 60_000 };
}

function redeemTapToken(value, receiverUid, now = Date.now()) {
  const record = records.get(value);
  if (!record) throw new Error('unknown token');
  if (record.used) throw new Error('token already used');
  if (now > record.expiresAt) throw new Error('token expired');
  record.used = true;
  return { ...record, receiverUid };
}
```

- [ ] **Step 4: Add `survival-diary.zhengzhengstudio.cn/server` and its data directories to the Termux sync allowlist without syncing secrets**

- [ ] **Step 5: Run service and existing API tests**

Run: `node --test website/survival-diary.zhengzhengstudio.cn/server/test/*.test.js && (cd website/api && npm test)`
Expected: all new tests pass and existing API tests report zero failures.

- [ ] **Step 6: Commit the server slice**

```bash
git add website/survival-diary.zhengzhengstudio.cn/server sync_to_termux.js
git commit -m "feat: add survival diary authoritative service"
```

### Task 3: Kimi Diary Director and Offline Narrative Fallback

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/kimi-director.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/narrative-fallback.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/kimi-director.test.js`
- Create: `apps/SurvivalDiaryShared/content/narrative-templates.json`
- Modify: `website/api/.env.example`

**Interfaces:**
- Consumes: `DiarySummary` with only `regions`, `events`, `resourceKinds`, `buildings`, `companions`, `journalText`, and `milestoneIds`.
- Produces: `DiaryResult { title, body, suggestion, memory, candidateEventId, source: 'kimi'|'fallback' }`.

- [ ] **Step 1: Write failing tests for prompt minimization, schema rejection, and fallback**

```js
test('invalid Kimi result falls back without granting resources', async () => {
  const result = await createDirector({ request: async () => ({ grant: { wood: 999 } }) }).write(summary);
  assert.equal(result.source, 'fallback');
  assert.equal('grant' in result, false);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test website/survival-diary.zhengzhengstudio.cn/server/test/kimi-director.test.js`
Expected: FAIL because the director is absent.

- [ ] **Step 3: Implement Kimi HTTP request with server key, per-user limits, one retry after all-ages filtering, strict result projection, and deterministic local templates**

- [ ] **Step 4: Add `KIMI_API_KEY`, `KIMI_MODEL`, and `SURVIVAL_DIARY_DAILY_AI_LIMIT` names to `.env.example` without adding a real key**

- [ ] **Step 5: Run director and server tests**

Run: `node --test website/survival-diary.zhengzhengstudio.cn/server/test/*.test.js`
Expected: PASS for Kimi success, timeout, malformed output, unsafe output, quota, and offline fallback.

- [ ] **Step 6: Commit the AI director**

```bash
git add website/survival-diary.zhengzhengstudio.cn/server apps/SurvivalDiaryShared/content/narrative-templates.json website/api/.env.example
git commit -m "feat: add Kimi survival diary director"
```

### Task 4: Web Game, Landing Surface, PWA, and Browser QA

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/index.html`
- Create: `website/survival-diary.zhengzhengstudio.cn/styles.css`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/game.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/world.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/network.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/save-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/js/update.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/manifest.webmanifest`
- Create: `website/survival-diary.zhengzhengstudio.cn/sw.js`
- Create: `tests/survival_diary_web.test.js`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/changelogs.json`

**Interfaces:**
- Consumes: Task 1 content/schema and Task 2 HTTP/WebSocket protocol.
- Produces browser methods: `startLocalWorld(seed)`, `joinOnlineWorld(invite)`, `writeDiary(text)`, `saveLocal(slot)`, and `checkForUpdate()`.

- [ ] **Step 1: Use the installed image generation workflow to create the full game screen, diary screen, island layers, props, character states, and marketing hero; save candidate assets under `website/survival-diary.zhengzhengstudio.cn/assets/` and present the complete concept for user approval before implementation**

- [ ] **Step 2: After concept approval, declare the design read and tokens before code**

```css
:root {
  --ocean: #176b78;
  --forest: #2f6b4f;
  --coral: #e56f51;
  --radius-panel: 14px;
  --radius-control: 9px;
}
```

- [ ] **Step 3: Write failing structural tests**

```js
test('login hierarchy and local-only disclosure are exact', () => {
  const html = fs.readFileSync(page, 'utf8');
  assert.match(html, /建议使用铮铮通行证登录/);
  assert.match(html, /本地游玩/);
  assert.match(html, /临时身份和存档仅保存在本机/);
  assert.doesNotMatch(html, /WebView|最终结局|通关/);
});
```

- [ ] **Step 4: Run the test and verify failure**

Run: `node --test tests/survival_diary_web.test.js`
Expected: FAIL because the site is absent.

- [ ] **Step 5: Implement the complete local loop, expanding low-poly island regions, free-place/rotate/snap building parts, HUD, journal, milestones, encrypted local Kimi-key option, friend/public-island screens, local saves, online join, loading/empty/error states, keyboard/touch/gamepad input, and reduced-motion behavior**

- [ ] **Step 6: Add PWA caching that preserves an active game and only prompts to refresh after a newer asset manifest is ready**

- [ ] **Step 7: Append evidence-based changelog entries to both changelog files in the same patch**

- [ ] **Step 8: Run unit tests, launch the local site, and capture desktop 1440×900, mobile 390×844, and tablet 1024×768 screenshots in light and dark modes**

Run: `node --test tests/survival_diary_web.test.js`
Expected: PASS.

- [ ] **Step 9: Compare the accepted concept and latest browser screenshots with `view_image`; fix layout, interaction, responsiveness, and copy until they match**

- [ ] **Step 10: Run Lighthouse and verify LCP < 2.5s, INP < 200ms, CLS < 0.1, and no critical accessibility issue**

- [ ] **Step 11: Commit the Web vertical slice and changelog**

```bash
git add website/survival-diary.zhengzhengstudio.cn website/api/data/changelogs.json website/zhengzhengstudio.cn/api/changelogs.json tests/survival_diary_web.test.js
git commit -m "feat: add survival diary web game"
```

---

## Phase B: Native Apple and Android Clients

### Task 5: iOS and macOS Native SpriteKit Clients

**Files:**
- Create: `apps/SurvivalDiary-Apple/Package.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalCore/World.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalCore/SaveStore.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalCore/Protocol.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalUI/SurvivalScene.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryiOS/main.swift`
- Create: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryMac/main.swift`
- Create: `apps/SurvivalDiary-Apple/Tests/SurvivalCoreTests/WorldTests.swift`
- Create: `tests/survival_diary_apple_contract.test.js`

**Interfaces:**
- Consumes: Task 1 JSON content, save schema, fixture commands, and Task 2 protocol.
- Produces native `SDWorld`, `SDCommand`, `SDSaveStore`, `SDNetworkClient`, and `SurvivalScene`.

- [ ] **Step 1: Write Swift fixture and update-comparison tests**

```swift
@Test func sameSeedMatchesCanonicalDigest() throws {
    var world = SDWorld(seed: "20260726")
    for command in try Fixture.commands() { world.apply(command) }
    #expect(world.digest == Fixture.expectedDigest)
}

@Test func buildOnlyUpdateIsDetected() {
    #expect(UpdateVersion("1.0.0", 2).isNewer(than: UpdateVersion("1.0.0", 1)))
}
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/SurvivalDiary-Apple && swift test`
Expected: FAIL because native core types are absent.

- [ ] **Step 3: Implement native world loading, SpriteKit region streaming, character/input, free-form building, HUD, journal, Keychain Kimi key, atomic saves, WebSocket reconnect, and exact login hierarchy**

- [ ] **Step 4: Implement platform-compliant update flows: iOS opens App Store/TestFlight/authorized OTA; macOS downloads verified DMG to `~/Downloads` and opens it**

- [ ] **Step 5: Run Swift and repository contract tests**

Run: `cd apps/SurvivalDiary-Apple && swift test && cd ../.. && node --test tests/survival_diary_apple_contract.test.js`
Expected: PASS with fixture digest parity and no WebView imports.

- [ ] **Step 6: Build iOS simulator/device and macOS Release targets, launch each, and capture gameplay, diary, friend, update, and offline-state screenshots**

Run: `xcodebuild -scheme SurvivalDiaryiOS -configuration Release build && xcodebuild -scheme SurvivalDiaryMac -configuration Release build`
Expected: both schemes exit 0.

- [ ] **Step 7: Commit the Apple clients**

```bash
git add apps/SurvivalDiary-Apple tests/survival_diary_apple_contract.test.js
git commit -m "feat: add native Apple survival diary clients"
```

### Task 6: Android Native Client

**Files:**
- Create: `apps/SurvivalDiary-Android/settings.gradle.kts`
- Create: `apps/SurvivalDiary-Android/build.gradle.kts`
- Create: `apps/SurvivalDiary-Android/app/build.gradle.kts`
- Create: `apps/SurvivalDiary-Android/app/src/main/AndroidManifest.xml`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/MainActivity.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/World.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/GameSurface.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveStore.kt`
- Create: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/UpdateInstaller.kt`
- Create: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/WorldTest.kt`

**Interfaces:**
- Consumes: Task 1 fixture and Task 2 protocol.
- Produces Kotlin `WorldState`, `WorldCommand`, `GameSurface`, `SaveStore`, and `UpdateInstaller`.

- [ ] **Step 1: Write failing seeded-world, atomic-save, and version/build tests**

```kotlin
@Test fun fixtureDigestMatches() {
    val world = Fixture.commands.fold(WorldState("20260726")) { state, command -> state.apply(command) }
    assertEquals(Fixture.expectedDigest, world.digest())
}
```

- [ ] **Step 2: Verify unit test failure**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest`
Expected: FAIL because the game classes are absent.

- [ ] **Step 3: Implement native Canvas renderer, touch/gamepad input, expanding regions, free building placement, HUD, journal, encrypted user key, saves, friends, WebSocket reconnect, and exact login hierarchy**

- [ ] **Step 4: Implement DownloadManager to public Downloads, SHA-256 verification, FileProvider URI, unknown-source permission flow, and system package installer**

- [ ] **Step 5: Run Android unit, lint, and assemble tests**

Run: `cd apps/SurvivalDiary-Android && ./gradlew testDebugUnitTest lintDebug assembleRelease`
Expected: exit 0 with a release APK.

- [ ] **Step 6: Install on emulator/device and verify cold start, rotate, background resume, offline save, update permission return, and reconnect**

- [ ] **Step 7: Commit the Android client**

```bash
git add apps/SurvivalDiary-Android
git commit -m "feat: add native Android survival diary client"
```

---

## Phase C: HarmonyOS Online and Store-Offline Clients

### Task 7: HarmonyOS Online Client with Tap-to-Add and Island Invite

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Online/AppScope/app.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/build-profile.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/module.json5`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/pages/Index.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/game/World.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/game/GameCanvas.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/TapInviteService.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SaveStore.ets`
- Create: `apps/SurvivalDiary-HarmonyOS-Online/entry/src/test/World.test.ets`
- Create: `tests/survival_diary_harmony_contract.test.js`

**Interfaces:**
- Consumes: Task 1 fixture, Task 2 `tap_token_create/redeem`, and server island privacy flags.
- Produces ArkTS `WorldState`, `GameCanvas`, `TapInviteService.createFriendToken()`, and `TapInviteService.createIslandToken(islandId)`.

- [ ] **Step 1: Write failing source and behavior contracts for native Canvas, exact login copy, 60-second tokens, and no private-island invite action**

```js
test('Harmony online exposes friend tap but gates island tap', () => {
  const source = readTree(onlineRoot);
  assert.match(source, /碰一下加好友/);
  assert.match(source, /isPublicIsland|allowNearbyInvite/);
  assert.doesNotMatch(source, /WebView/);
});
```

- [ ] **Step 2: Verify contract failure**

Run: `node --test tests/survival_diary_harmony_contract.test.js`
Expected: FAIL because Harmony projects are absent.

- [ ] **Step 3: Implement ArkUI Canvas gameplay, region streaming, free building placement, HUD, diary, secure key storage, saves, friends, WebSocket reconnect, and Push Kit registration**

- [ ] **Step 4: Implement NFC/Share Kit/App Linking tap transfer with two-sided confirmation; add QR/invite-code fallback when tap capability is unavailable**

- [ ] **Step 5: Run ArkTS tests, repository contracts, and signed-build dry run**

Run: `node --test tests/survival_diary_harmony_contract.test.js && cd apps/SurvivalDiary-HarmonyOS-Online && hvigorw assembleHap --mode module -p product=default`
Expected: contract tests pass and Hvigor produces an unsigned HAP ready for release signing.

- [ ] **Step 6: Commit the online HarmonyOS client**

```bash
git add apps/SurvivalDiary-HarmonyOS-Online tests/survival_diary_harmony_contract.test.js
git commit -m "feat: add HarmonyOS online survival diary client"
```

### Task 8: HarmonyOS Offline Store Variant

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/` by copying only approved gameplay/content modules from the online project.
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/test/OfflineBoundary.test.ets`
- Modify: `tests/survival_diary_harmony_contract.test.js`

**Interfaces:**
- Consumes: Task 7 renderer/gameplay and Task 1 local narrative templates.
- Produces bundle `cn.zhengzhengstudio.survivaldiary.offline` with no network/system-update/social capability.

- [ ] **Step 1: Extend the failing contract to ban network and social APIs from offline source**

```js
test('Harmony offline contains no network, account, Kimi, push, tap, or external updater', () => {
  const source = readTree(offlineRoot);
  assert.doesNotMatch(source, /NetworkKit|PushKit|ShareKit|KIMI|WebSocket|碰一下|通行证|manifest\.json/);
});
```

- [ ] **Step 2: Run the contract and verify it fails while the offline project is absent**

- [ ] **Step 3: Build the separate project with local saves, local narrative fallback, all gameplay content, store-safe permissions, and no hidden online code**

- [ ] **Step 4: Run boundary tests and assemble HAP/APP candidates**

Run: `node --test tests/survival_diary_harmony_contract.test.js && cd apps/SurvivalDiary-HarmonyOS-Offline && hvigorw assembleHap --mode module -p product=default && hvigorw assembleApp --mode project -p product=default`
Expected: PASS and unsigned HAP/APP outputs ready for the same release-signing identity.

- [ ] **Step 5: Commit the store-offline client**

```bash
git add apps/SurvivalDiary-HarmonyOS-Offline tests/survival_diary_harmony_contract.test.js
git commit -m "feat: add HarmonyOS offline survival diary client"
```

---

## Phase D: Updates, Packages, Download Center, and Competition Material

### Task 9: Cross-Platform Update Manifest and Push Registration

**Files:**
- Create: `apps/SurvivalDiaryShared/src/version.js`
- Create: `tests/survival_diary_updates.test.js`
- Modify: all online client update modules from Tasks 4-7.
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`

**Interfaces:**
- Produces `isRemoteNewer(localVersion, localBuild, remoteVersion, remoteBuild): boolean` with the same fixture on every platform.
- Produces push registration `{ uid, platform, token, appId, version, build }` and server `release_available` notification payload.

- [ ] **Step 1: Write comparison fixtures that cover semantic precedence, equal-version build, downgrade, malformed versions, and platform entry selection**

- [ ] **Step 2: Run all update tests and verify at least one client fails the fixture**

Run: `node --test tests/survival_diary_updates.test.js`
Expected: FAIL until every online client contains the correct comparison and package ID.

- [ ] **Step 3: Implement identical comparison and manifest selection on Web, Apple, Android, and HarmonyOS online**

```js
function isRemoteNewer(localVersion, localBuild, remoteVersion, remoteBuild) {
  const versionOrder = compareSemver(remoteVersion, localVersion);
  return versionOrder > 0 || (versionOrder === 0 && Number(remoteBuild) > Number(localBuild));
}
```

- [ ] **Step 4: Add opt-in push registration and release notification dispatch; keep startup, foreground, and manual manifest checks as fallback**

- [ ] **Step 5: Run shared, Web, Apple, Android, and Harmony contract tests**

Expected: all version fixtures pass on every online client; offline Harmony contains no updater.

- [ ] **Step 6: Commit update and push behavior**

```bash
git add apps/SurvivalDiaryShared apps/SurvivalDiary-Apple apps/SurvivalDiary-Android apps/SurvivalDiary-HarmonyOS-Online website/survival-diary.zhengzhengstudio.cn tests/survival_diary_updates.test.js
git commit -m "feat: add survival diary update and push flow"
```

### Task 10: Reproducible Signed Builds and Artifact Verification

**Files:**
- Create: `apps/build_survival_diary_apps.sh`
- Create: `apps/verify_survival_diary_artifacts.sh`
- Create: `tests/survival_diary_artifacts.test.js`
- Modify: platform release configurations created in Tasks 5-8.

**Interfaces:**
- Produces versioned and `latest` APK, IPA/plist, DMG, online HAP/APP, and offline HAP/APP under `website/api/apps`.
- Produces `apps/build_output/SurvivalDiary/release-report.json` with signer, verification status, size, SHA-256, version, build, and source commit.

- [ ] **Step 1: Write artifact tests that reject missing, stale, unsigned, mismatched-version, and mismatched-latest packages**

- [ ] **Step 2: Run tests and verify failure because artifacts do not exist**

Run: `node --test tests/survival_diary_artifacts.test.js`
Expected: FAIL listing every missing release artifact.

- [ ] **Step 3: Implement build coordinator with explicit `VERSION` and `BUILD`, exact target paths, signing-material preflight, and no silent fallback from release signing to ad-hoc signing**

- [ ] **Step 4: Build each platform sequentially and verify with `apksigner`, `codesign`, `spctl`, embedded provisioning inspection, and `hap-sign-tool verify-app`**

- [ ] **Step 5: Copy only verified artifacts to `website/api/apps`, create byte-identical latest aliases, and write release report**

- [ ] **Step 6: Run artifact tests**

Run: `node --test tests/survival_diary_artifacts.test.js`
Expected: PASS only for artifacts whose release report says `verified: true`.

- [ ] **Step 7: Commit build scripts and non-secret release configuration; do not commit signing passwords or private keys**

```bash
git add apps/build_survival_diary_apps.sh apps/verify_survival_diary_artifacts.sh tests/survival_diary_artifacts.test.js apps/SurvivalDiary-Apple apps/SurvivalDiary-Android apps/SurvivalDiary-HarmonyOS-Online apps/SurvivalDiary-HarmonyOS-Offline
git commit -m "build: add verified survival diary releases"
```

### Task 11: Manifest, Client Downloads, Historical Changelog, and Download Center

**Files:**
- Create: `website/api/scripts/publish_survival_diary.js`
- Create: `tests/survival_diary_release_manifest.test.js`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/changelogs.json`
- Modify: the existing main-site download-center renderer that consumes `client-downloads.json`.

**Interfaces:**
- Consumes: Task 10 release report and verified artifacts.
- Produces entries with `product: 'survival-diary'`, `variant: 'online'|'offline'`, exact `size/fileSize`, `sha256/checksum`, platform, bundle ID, version/build, minimum system, notes, and store readiness.

- [ ] **Step 1: Write failing mirror and byte-integrity tests modeled after `tests/boardgame_release_manifest.test.js`**

- [ ] **Step 2: Run the test and verify missing entries**

Run: `node --test tests/survival_diary_release_manifest.test.js`
Expected: FAIL for missing product entries and package metadata.

- [ ] **Step 3: Implement atomic publisher that reads actual files, refuses unverified release reports, updates both manifests, and mirrors exact JSON**

- [ ] **Step 4: Audit package history, dated documents, existing manifest entries, and file metadata; append only evidence-backed missing changelog entries, newest first, to both changelog files**

- [ ] **Step 5: Add concise download-center copy for Web, iOS, macOS, Android, HarmonyOS online, and HarmonyOS offline; display online/offline tags and signed/store-ready truthfully**

- [ ] **Step 6: Run JSON parse, release, existing API, and download-route tests**

Run: `node --test tests/survival_diary_release_manifest.test.js && (cd website/api && npm test)`
Expected: all tests pass; both manifest mirrors and both changelog mirrors match.

- [ ] **Step 7: Commit release metadata and required changelog updates**

```bash
git add website/api/apps/manifest.json website/api/apps/client-downloads.json website/zhengzhengstudio.cn/api/apps/manifest.json website/zhengzhengstudio.cn/api/apps/client-downloads.json website/api/data/changelogs.json website/zhengzhengstudio.cn/api/changelogs.json website/api/scripts/publish_survival_diary.js tests/survival_diary_release_manifest.test.js
git commit -m "release: publish survival diary downloads"
```

### Task 12: Harmony Store Listing, Real Screens, Promotional Composites, and Bilibili Submission Kit

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store/listing-zh-CN.md`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store/privacy-checklist.md`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store/screenshots/`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store/promotional-composites/`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store/preview-video-script.md`
- Create: `docs/survival-diary-bilibili-submission.md`

**Interfaces:**
- Consumes: verified Task 8 app screens and Task 10 package metadata.
- Produces store-ready Chinese copy, actual running screenshots, clearly labeled AI promotional composites when no physical device photo exists, and a landscape competition-video script longer than one minute.

- [ ] **Step 1: Capture real running screens for exploration, building, diary, inventory, settings, and local-save recovery at required phone and tablet dimensions**

- [ ] **Step 2: Use image generation for separate photorealistic promotional phone-in-hand scenes; save them under `promotional-composites` and label them as promotional composites in metadata**

- [ ] **Step 3: Write exact store copy covering no ads/IAP, all-ages presentation, offline boundary, permissions, privacy, update notes, and online/offline differences**

- [ ] **Step 4: Write the Bilibili video script with hook, real interaction, AI-before/after diary demonstration, cross-platform montage, Harmony tap-to-add demonstration, disclosure of AI usage, and final participation tag**

- [ ] **Step 5: Inspect every screenshot/composite with `view_image`, proofread every visible string, and verify no generated image is represented as a physical photograph**

- [ ] **Step 6: Run final product checklist**

Run: `node --test tests/survival_diary_*.test.js && (cd website/api && npm test)`
Expected: zero failures.

- [ ] **Step 7: Commit store and competition material**

```bash
git add apps/SurvivalDiary-HarmonyOS-Offline/store docs/survival-diary-bilibili-submission.md
git commit -m "docs: add survival diary store and competition kit"
```

## Final Verification

- [ ] Run all repository Survival Diary tests: `node --test tests/survival_diary_*.test.js`.
- [ ] Run API regression tests: `(cd website/api && npm test)`.
- [ ] Run Swift tests and both Release builds.
- [ ] Run Android unit, lint, and Release assemble tasks.
- [ ] Run HarmonyOS online/offline HAP and APP builds and signature verification.
- [ ] Verify every published package against manifest size and SHA-256.
- [ ] Download each entry through the local API route and compare SHA-256 with the source artifact.
- [ ] Launch Web plus all installable clients and exercise local play, save/load, diary fallback, login, friend invitation, update check, and offline behavior.
- [ ] Confirm HarmonyOS offline has no network, account, Kimi, friend, tap, push, or external-update code or permission.
- [ ] Confirm both changelog mirrors include this website and release work plus every evidence-backed historical omission.
- [ ] Confirm store screenshots are actual running screens and promotional composites are not described as real photographs.
