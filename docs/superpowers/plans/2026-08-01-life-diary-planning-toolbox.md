# LifeDiary Planning Toolbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional private planning toolbox—tasks, daily schedule, courses, homework/exams, habits, countdowns, focus sessions, and lists—to every native LifeDiary client and the Web app, including just-in-time notifications, HarmonyOS service cards, and a download-center release flow that cannot overwrite other products.

**Architecture:** Define one versioned planning contract and one private `planning` sync domain, then implement platform-native repositories and views against that contract. “Today” reads a derived agenda from enabled tools; diary insertion is an explicit draft conversion. Release generators merge app entries by stable ID and validate artifacts before publishing.

**Tech Stack:** Node.js `node:test`/Express/file store, browser IndexedDB/vanilla JS, Kotlin/Jetpack Compose/WorkManager, Swift/SwiftUI/UserNotifications/EventKit, ArkTS/ArkUI/Preferences/NotificationKit/FormExtensionAbility, JSON/CSV/ICS.

## Global Constraints

- Personal planning data is private by default and never automatically enters community, chat, diary, or companion context.
- Online clients are local-first and sync through Passport; HarmonyOS Offline remains entirely local and declares no network permission.
- Homework is a private task type only; no submission, teacher, grading, classroom-management, or assignment-upload workflow.
- “Write into today’s diary” creates an editable draft and requires explicit save confirmation.
- Notification permission is requested only after the user enables their first reminder; denial never blocks saving.
- HarmonyOS Online and Offline both ship native service cards; Offline cards read only local data.
- Mobile navigation keeps at most five bottom destinations; toolbox is reached from Today. macOS uses a sidebar group.
- No WebView, WKWebView, ArkWeb, embedded browser shell, or generated website wrapper.
- Release metadata must state signing truthfully and preserve every unrelated product entry.
- Website changes update `website/api/data/changelogs.json` unless they are administrator-only, highly sensitive backend-only, or high-risk security fixes.

## Spec Coverage Map

- 下载中心与清单防覆盖：Task 1、Task 12
- 私密 `planning` 同步域与陪伴助手显式选择：Task 2、Task 3、Task 10
- Web 工具箱：Task 4
- Android 原生工具箱与通知：Task 5
- iOS 原生工具箱与系统日历单向导出：Task 6
- macOS 桌面工具箱：Task 7
- HarmonyOS Online 工具箱、通知与服务卡片：Task 8
- HarmonyOS Offline 本地工具箱、备份迁移与服务卡片：Task 9
- CSV/ICS、JSON、跨端隐私与互操作：Task 10、Task 11
- 0.3.0 构建、签名核验、包发布和更新日志：Task 12

---

### Task 1: Isolate the LifeDiary branch and repair release-manifest merging

**Files:**
- Create: `website/api/scripts/lib/merge_app_entries.js`
- Modify: `website/api/scripts/update_lifediary_release.js`
- Modify: `apps/build_spacefight_apps.sh`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Test: `website/api/test/app_manifest_merge_contract.test.js`
- Test: `website/api/test/life_diary_release_contract.test.js`

**Interfaces:**
- Consumes: release entries with stable `id`, `version`, `build`, file path, size, and SHA-256.
- Produces: `mergeAppEntries(existing, incoming, incomingProductIds)` and `writeMirroredManifests(...)`; manifests containing LifeDiary 0.2.0 and SpaceFight regardless of publication order.

- [ ] **Step 1: Create an isolated worktree before edits**

Run the `superpowers:using-git-worktrees` skill, create `codex/lifediary-planning-toolbox` from the last LifeDiary commit, and cherry-pick the approved spec commit `b2745bc` if the spec is absent.

- [ ] **Step 2: Write the failing merge-order test**

```js
test('LifeDiary and SpaceFight releases survive either publication order', () => {
  const life = [{ id: 'lifediary-android', product: 'lifediary', version: '0.2.0' }];
  const space = [{ id: 'spacefight-android', product: 'spacefight', version: '0.9.5' }];
  const first = mergeAppEntries(mergeAppEntries([], life, ['lifediary-android']), space, ['spacefight-android']);
  const second = mergeAppEntries(mergeAppEntries([], space, ['spacefight-android']), life, ['lifediary-android']);
  assert.deepEqual(first.map(item => item.id).sort(), second.map(item => item.id).sort());
  assert.deepEqual(first.map(item => item.id).sort(), ['lifediary-android', 'spacefight-android']);
});
```

- [ ] **Step 3: Run RED**

Run: `cd website/api && node --test test/app_manifest_merge_contract.test.js`
Expected: FAIL because `merge_app_entries.js` does not exist.

- [ ] **Step 4: Implement stable-ID replacement without whole-file replacement**

```js
function mergeAppEntries(existing, incoming, ownedIds) {
  const owned = new Set(ownedIds);
  const byId = new Map(existing.filter(item => !owned.has(item.id)).map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
```

The writer must reject duplicate IDs, missing package files, mismatched size, or mismatched SHA-256 before atomically replacing both API and public mirror JSON files.

- [ ] **Step 5: Restore LifeDiary 0.2.0 entries and run release tests**

Run: `cd website/api && node scripts/update_lifediary_release.js && node --test test/app_manifest_merge_contract.test.js test/life_diary_release_contract.test.js`
Expected: PASS; eight LifeDiary entries remain at 0.2.0 after a simulated SpaceFight merge.

- [ ] **Step 6: Commit**

```bash
git add website/api/scripts/lib/merge_app_entries.js website/api/scripts/update_lifediary_release.js apps/build_spacefight_apps.sh website/api/test/app_manifest_merge_contract.test.js website/api/test/life_diary_release_contract.test.js website/api/apps/manifest.json website/api/apps/client-downloads.json website/zhengzhengstudio.cn/api/apps/manifest.json website/zhengzhengstudio.cn/api/apps/client-downloads.json
git commit -m "fix: preserve LifeDiary download entries"
```

### Task 2: Define the planning contract and pure agenda engine

**Files:**
- Create: `contracts/lifediary/planning.schema.json`
- Create: `contracts/lifediary/planning-fixtures.json`
- Create: `website/life.zhengzhengstudio.cn/assets/js/planning-models.js`
- Test: `website/api/test/life_diary_planning_models.test.js`

**Interfaces:**
- Produces: `LifePlanning.expandTaskOccurrences(task, range)`, `expandCourseOccurrences(course, overrides, range)`, `buildTodayAgenda(snapshot, now)`, and `homeworkDiaryDraft(homework, completedAt)`.
- Canonical entity kinds: `task`, `goal`, `event`, `course`, `homework`, `exam`, `habit`, `countdown`, `focusSession`, `checklist`, `toolPreference`.

- [ ] **Step 1: Write failing pure-model tests**

```js
test('homework completion produces an unsaved private diary draft', () => {
  const draft = LifePlanning.homeworkDiaryDraft({ id: 'hw-1', title: '数学练习', courseTitle: '数学' }, '2026-08-01T10:00:00Z');
  assert.equal(draft.saved, false);
  assert.equal(draft.visibility, 'private');
  assert.match(draft.body, /数学练习/);
});

test('an odd-week course excludes even weeks and accepts a temporary move', () => {
  const result = LifePlanning.expandCourseOccurrences(oddWeekCourse, [moveWeekThree], augustRange);
  assert.deepEqual(result.map(item => item.start), ['2026-08-03T08:00:00+08:00', '2026-08-19T10:00:00+08:00']);
});
```

- [ ] **Step 2: Run RED**

Run: `cd website/api && node --test test/life_diary_planning_models.test.js`
Expected: FAIL because `LifePlanning` functions are missing.

- [ ] **Step 3: Implement the versioned schema and pure functions**

Every entity requires `id`, `kind`, `createdAt`, `updatedAt`, `revision`, and `deletedAt`. Recurrence stores `frequency`, `interval`, `weekdays`, `monthDay`, `validFrom`, `validUntil`, and `timeZone`. Course overrides use `courseId`, `originalDate`, `status`, `replacementStart`, `replacementEnd`, and replacement location.

- [ ] **Step 4: Run GREEN and commit**

Run: `cd website/api && node --test test/life_diary_planning_models.test.js`

```bash
git add contracts/lifediary website/life.zhengzhengstudio.cn/assets/js/planning-models.js website/api/test/life_diary_planning_models.test.js
git commit -m "feat: define LifeDiary planning contract"
```

### Task 3: Add the authenticated private planning sync domain

**Files:**
- Modify: `website/api/lib/life_diary_store.js`
- Modify: `website/api/routes/life_diary.js`
- Modify: `website/api/life_server.js`
- Test: `website/api/test/life_diary_store.test.js`
- Test: `website/api/test/life_diary_routes.test.js`

**Interfaces:**
- Consumes: sync operations `{ id, domain: 'planning', type, baseRevision, payload }`.
- Produces: existing `/api/life/me`, `/api/life/sync`, and `/api/life/export` responses with `domains.planning`; no public planning route.

- [ ] **Step 1: Extend failing store and route tests**

```js
assert.ok(PRIVATE_DOMAINS.includes('planning'));
const result = await store.syncUser('reader-1', { operations: [{
  id: 'op-plan-1', domain: 'planning', type: 'upsert', baseRevision: 0,
  payload: { id: 'task-1', kind: 'task', title: '交电费', visibility: 'public', uid: 'forged' }
}] });
assert.equal(result.record.domains.planning['task-1'].title, '交电费');
assert.equal('uid' in result.record.domains.planning['task-1'], false);
assert.equal('visibility' in result.record.domains.planning['task-1'], false);
```

- [ ] **Step 2: Run RED**

Run: `cd website/api && node --test test/life_diary_store.test.js test/life_diary_routes.test.js`
Expected: FAIL because `planning` is rejected.

- [ ] **Step 3: Add `planning` to the private domain list and schema-versioned export**

Keep existing idempotency, per-user locking, conflict response, atomic file writes, and maximum 200 operations. Export `schemaVersion: 2`; import compatibility is implemented client-side and must accept schema 1 with an empty planning domain.

- [ ] **Step 4: Run GREEN and commit**

```bash
cd website/api && node --test test/life_diary_store.test.js test/life_diary_routes.test.js
git add lib/life_diary_store.js routes/life_diary.js life_server.js test/life_diary_store.test.js test/life_diary_routes.test.js
git commit -m "feat: sync private LifeDiary planning data"
```

### Task 4: Build the Web toolbox, Today agenda, and explicit diary conversion

**Files:**
- Create: `website/life.zhengzhengstudio.cn/tools.html`
- Create: `website/life.zhengzhengstudio.cn/assets/js/planning-store.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/tools.js`
- Modify: `website/life.zhengzhengstudio.cn/index.html`
- Modify: `website/life.zhengzhengstudio.cn/diary.html`
- Modify: `website/life.zhengzhengstudio.cn/assets/js/today.js`
- Modify: `website/life.zhengzhengstudio.cn/assets/js/diary.js`
- Modify: `website/life.zhengzhengstudio.cn/assets/css/life.css`
- Test: `website/api/test/life_diary_planning_web.test.js`

**Interfaces:**
- Produces: IndexedDB `planning` records, queued `domain: 'planning'` operations, `[data-today-agenda]`, and `lifediary:diary-draft` handoff.

- [ ] **Step 1: Write the failing DOM/source contract**

```js
assert.match(toolsHtml, /data-tool="tasks"/);
assert.match(toolsHtml, /data-tool="courses"/);
assert.match(toolsJs, /requestNotificationPermissionAfterReminderEnabled/);
assert.match(toolsJs, /lifediary:diary-draft/);
assert.doesNotMatch(toolsHtml + toolsJs, /提交作业|教师端|批改/);
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

Run RED: `cd website/api && node --test test/life_diary_planning_web.test.js`

Implement eight optional tool modules with accessible native HTML controls, one Today agenda, explicit draft confirmation, IndexedDB-first persistence, sync queueing, CSV/ICS import validation, and no automatic notification prompt.

Run GREEN: `cd website/api && node --test test/life_diary_planning_web.test.js test/life_diary_design.test.js`

- [ ] **Step 3: Update the website changelog and commit**

Add a non-sensitive LifeDiary planning-toolbox entry to `website/api/data/changelogs.json`.

```bash
git add website/life.zhengzhengstudio.cn website/api/test/life_diary_planning_web.test.js website/api/data/changelogs.json
git commit -m "feat: add LifeDiary Web planning toolbox"
```

### Task 5: Implement Android planning storage, Compose UI, and reminders

**Files:**
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/planning/PlanningModels.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/planning/PlanningRepository.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/planning/PlanningScheduler.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/tools/ToolsScreen.kt`
- Modify: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/ui/today/TodayScreen.kt`
- Modify: `apps/LifeDiary-Android/app/src/main/AndroidManifest.xml`
- Test: `apps/LifeDiary-Android/app/src/test/java/cn/zhengzhengstudio/lifediary/planning/PlanningRepositoryTest.kt`
- Test: `apps/LifeDiary-Android/app/src/test/java/cn/zhengzhengstudio/lifediary/planning/PlanningEngineTest.kt`

**Interfaces:**
- Produces: `PlanningRepository.snapshot: StateFlow<PlanningSnapshot>`, `save(entity)`, `completeOccurrence`, `buildTodayAgenda`, and `PlanningScheduler.enableReminder(activity, reminder)`.

- [ ] **Step 1: Write tests for atomic save, recurrence, and draft-only diary conversion**

```kotlin
@Test fun homeworkDraftIsPrivateAndUnsaved() {
    val draft = homeworkDiaryDraft(Homework(id="h1", title="数学练习", courseTitle="数学"))
    assertFalse(draft.saved)
    assertEquals("private", draft.visibility)
}
```

- [ ] **Step 2: Run RED**

Run: `cd apps/LifeDiary-Android && ./gradlew testDebugUnitTest --tests '*Planning*'`

- [ ] **Step 3: Implement local-first JSON envelope schema 2 and Compose toolbox**

Use one atomic file containing diary plus planning or separate atomic `life-planning.json`; never partially rewrite existing diary data. Today links to `ToolsScreen` without adding a sixth `LifeDestination`. Use `POST_NOTIFICATIONS` only on API 33+ and request it from the first reminder toggle, not app startup. Schedule exact user-visible reminders with WorkManager/AlarmManager according to platform availability; saving succeeds even if scheduling fails.

- [ ] **Step 4: Run tests, lint, build, and commit**

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug
git add app/src/main app/src/test
git commit -m "feat: add Android planning toolbox"
```

### Task 6: Implement iOS planning repository, SwiftUI tools, notifications, and calendar export

**Files:**
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Planning/PlanningModels.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Planning/PlanningRepository.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Planning/PlanningScheduler.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Tools/ToolsView.swift`
- Modify: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/Today/TodayView.swift`
- Modify: `apps/LifeDiary-iOS/Sources/LifeDiary/Views/AppView.swift`
- Modify: `apps/LifeDiary-iOS/Support/Info.plist`
- Test: `apps/LifeDiary-iOS/Tests/LifeDiaryTests/PlanningTests.swift`

**Interfaces:**
- Produces: `PlanningRepository`, `TodayAgenda`, `ReminderAuthorizer.requestAfterUserEnabledReminder()`, and `CalendarExporter.export(_ event: ScheduleEvent)`.

- [ ] **Step 1: Write failing Swift tests**

```swift
func testNotificationPermissionIsNotRequestedByRepositoryStartup() async throws {
    let authorizer = SpyReminderAuthorizer()
    _ = try PlanningRepository(store: MemoryPlanningStore(), reminderAuthorizer: authorizer)
    XCTAssertEqual(authorizer.requestCount, 0)
}
```

- [ ] **Step 2: Run RED, implement native SwiftUI, then run GREEN**

Run RED: `cd apps/LifeDiary-iOS && swift test --filter PlanningTests`

Implement Codable schema 2 storage with atomic replacement, Tools navigation from Today, UNUserNotificationCenter just-in-time permission, privacy-safe notification bodies, and per-item EventKit export after explicit authorization. Do not add a sixth TabView item.

Run GREEN: `swift test && xcodebuild -scheme LifeDiary -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`

- [ ] **Step 3: Commit**

```bash
git add apps/LifeDiary-iOS
git commit -m "feat: add iOS planning toolbox"
```

### Task 7: Implement macOS desktop planning workflows

**Files:**
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Planning/PlanningModels.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Planning/PlanningRepository.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/Planning/PlanningView.swift`
- Modify: `apps/LifeDiary-macOS/Sources/LifeDiary/Views/ContentView.swift`
- Modify: `apps/LifeDiary-macOS/Sources/LifeDiary/App/LifeDiaryApp.swift`
- Test: `apps/LifeDiary-macOS/Tests/LifeDiaryTests/PlanningTests.swift`

**Interfaces:**
- Produces: sidebar destinations `todayAgenda`, `tasks`, `schedule`, `courses`, `habits`, `focus`, and keyboard command `LifeDiary.newPlanningItem`.

- [ ] **Step 1: Write failing repository and navigation tests**

```swift
func testTwoWindowsDoNotLoseInterleavedPlanningSaves() async throws {
    async let first = repository.save(.task(Task.fixture(id: "one")))
    async let second = repository.save(.task(Task.fixture(id: "two")))
    _ = try await (first, second)
    XCTAssertEqual(Set(repository.snapshot.entities.keys), ["one", "two"])
}
```

- [ ] **Step 2: Implement, verify, and commit**

Use the existing single shared repository/multi-window locking pattern, desktop sidebar, searchable tables, keyboard creation, UNUserNotificationCenter, and EventKit single-direction export.

Run: `cd apps/LifeDiary-macOS && swift test && swift build -c release`

```bash
git add apps/LifeDiary-macOS
git commit -m "feat: add macOS planning toolbox"
```

### Task 8: Implement HarmonyOS Online planning and service cards

**Files:**
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/models/PlanningModels.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/stores/PlanningStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/services/PlanningNotificationService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/ToolsPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/widget/PlanningFormAbility.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/resources/base/profile/form_config.json`
- Modify: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/TodayPage.ets`
- Modify: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/module.json5`
- Test: `website/api/test/life_diary_harmony_planning_contract.test.js`

**Interfaces:**
- Produces: Preferences-backed `PlanningStore`, authenticated `planning` sync operations, NotificationKit reminder opt-in, and five service-card variants keyed by `today`, `nextCourse`, `countdown`, `quickCheck`, `quickDiary`.

- [ ] **Step 1: Write failing source/build contract tests**

```js
assert.match(moduleFile, /PlanningFormAbility/);
assert.match(formConfig, /nextCourse/);
assert.match(notificationService, /requestEnableNotification/);
assert.doesNotMatch(mainPage, /TabContent\(\).*工具箱/s);
```

- [ ] **Step 2: Implement ArkUI toolbox and privacy-aware form data**

Cards must use a redacted DTO containing only `title`, `timeText`, `progress`, and `deepLink`. When privacy lock is active, title becomes “打开生活日记查看”. Online cards read last committed local data and do not start network synchronization.

- [ ] **Step 3: Build and commit**

Run from an ASCII-only temporary copy with DevEco SDK: `hvigorw assembleApp --mode project -p product=default --no-daemon`.

```bash
git add apps/LifeDiary-HarmonyOS-Online website/api/test/life_diary_harmony_planning_contract.test.js
git commit -m "feat: add HarmonyOS online planning cards"
```

### Task 9: Implement HarmonyOS Offline planning, backup migration, and service cards

**Files:**
- Modify: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/models/OfflineModels.ets`
- Modify: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/services/LocalDiaryStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/ToolsPage.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/services/PlanningNotificationService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/widget/PlanningFormAbility.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/resources/base/profile/form_config.json`
- Modify: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/TodayPage.ets`
- Modify: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/module.json5`
- Test: `website/api/test/life_diary_harmony_offline_contract.test.js`

**Interfaces:**
- Produces: `OfflineData.schema = 3` with `planning: PlanningSnapshot`; imports schema 2 by adding an empty planning snapshot; no network permission or online identifiers.

- [ ] **Step 1: Write failing offline migration and isolation contracts**

```js
assert.match(store, /envelope\.schema\s*===\s*2/);
assert.match(store, /schema:\s*3/);
assert.doesNotMatch(offlinePlanningTree, /http|Passport|community|friends|chat|sync/i);
assert.match(moduleFile, /PlanningFormAbility/);
```

- [ ] **Step 2: Implement migration, local tools, notifications, and cards**

The importer validates all planning arrays before one atomic save. Notification permission is requested only from a reminder toggle. Card data comes from the same local Preferences file and is redacted under privacy mode.

- [ ] **Step 3: Build and commit**

Run the ASCII temporary-copy `hvigorw assembleApp` command and the offline contract tests.

```bash
git add apps/LifeDiary-HarmonyOS-Offline website/api/test/life_diary_harmony_offline_contract.test.js
git commit -m "feat: add offline HarmonyOS planning cards"
```

### Task 10: Add cross-platform CSV/ICS import, JSON export, and companion selection

**Files:**
- Modify planning import/export services created in Tasks 4–9.
- Modify: `website/api/routes/life_diary_companion.js`
- Modify platform companion request builders.
- Test: `website/api/test/life_diary_planning_interop.test.js`
- Test: native planning test targets.

**Interfaces:**
- Produces: `PlanningArchive(schemaVersion: 1, entities)`, `CourseCSVCodec`, `ICalendarCodec`, and companion payload `selectedPlanningIds` with a matching disclosure list.

- [ ] **Step 1: Add shared fixtures for UTF-8 CSV, quoted commas, CRLF, timezone ICS, and malformed records**

```js
assert.deepEqual(importCourseCSV(exportCourseCSV(fixtures.courses)), fixtures.courses);
assert.throws(() => importCourseCSV('title,start\n数学,not-a-time'), /invalid_start/);
```

- [ ] **Step 2: Implement staged imports and explicit companion selection**

Parse and validate the complete file in memory, show a count/error preview, and atomically commit only after confirmation. Companion APIs accept selected IDs only, resolve them from the authenticated private store, and return the IDs actually used. Homework or task notes are never interpolated into notifications.

- [ ] **Step 3: Run all interop/native tests and commit**

```bash
git add contracts website apps/LifeDiary-Android apps/LifeDiary-iOS apps/LifeDiary-macOS apps/LifeDiary-HarmonyOS-Online apps/LifeDiary-HarmonyOS-Offline
git commit -m "feat: add LifeDiary planning interoperability"
```

### Task 11: Full privacy, accessibility, and behavior regression

**Files:**
- Modify only failures found, with a reproducing test in the owning target.
- Test: `website/api/test/life_diary_planning_privacy_contract.test.js`

**Interfaces:**
- Consumes: completed toolbox implementations.
- Produces: evidence that all clients preserve privacy, notification timing, offline isolation, and zero-WebView constraints.

- [ ] **Step 1: Run server/Web suites**

Run: `cd website/api && node --test test/life_diary*.test.js test/app_manifest_merge_contract.test.js`

- [ ] **Step 2: Run native tests and builds**

```bash
(cd apps/LifeDiary-Android && ./gradlew clean testDebugUnitTest lintDebug assembleRelease)
(cd apps/LifeDiary-iOS && swift test && xcodebuild -scheme LifeDiary -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build)
(cd apps/LifeDiary-macOS && swift test && swift build -c release)
```

Build both HarmonyOS variants with the DevEco ASCII-copy workflow.

- [ ] **Step 3: Run privacy source audits**

```bash
rg -n "WKWebView|android\.webkit\.WebView|ArkWeb|WebviewController|addJavascriptInterface" apps/LifeDiary-*
rg -n "INTERNET|https?://|Passport|community|chat|sync" apps/LifeDiary-HarmonyOS-Offline/entry/src/main
```

Expected: no embedded web APIs; no offline runtime networking/online feature matches.

- [ ] **Step 4: Inspect representative UI states**

Verify light/dark, empty/populated, notifications denied, reminder enabled, conflicting edits, minor quiet hours, large text, phone/tablet/2-in-1, macOS narrow/wide, and HarmonyOS card redaction.

### Task 12: Version, build, publish, and document LifeDiary 0.3.0

**Files:**
- Modify all platform version/build files to 0.3.0 with monotonic builds.
- Modify: `website/api/scripts/update_lifediary_release.js`
- Modify: `website/api/data/changelogs.json`
- Modify manifests and client downloads in both API and public mirror directories.
- Add versioned packages and latest aliases under both `website/api/apps` and `website/zhengzhengstudio.cn/api/apps`.

**Interfaces:**
- Produces: truthful 0.3.0 packages, hashes, download cards, update metadata, and changelog entries.

- [ ] **Step 1: Write the failing 0.3.0 release contract**

```js
for (const app of lifeDiaryApps) {
  assert.equal(app.version, '0.3.0');
  assert.match(app.description, /计划|课程|工具箱/);
  if (app.kind !== 'web') assert.equal(sha256(fileFor(app)), app.sha256);
}
```

- [ ] **Step 2: Build every package and inspect signing**

Use `apksigner verify`, `codesign --verify --deep --strict`, provisioning inspection, and HarmonyOS build signing logs. Set `signed` and `storeReady` only from evidence; unsigned filenames remain explicit.

- [ ] **Step 3: Publish with merge-safe generator and verify public downloads**

Run generator, full release tests, byte-for-byte API/public mirror comparisons, and live/local download URL checks. Confirm SpaceFight and all other prior entries remain present.

- [ ] **Step 4: Commit in the correct repositories**

```bash
git add apps/LifeDiary-* contracts/lifediary
git commit -m "release: build LifeDiary planning toolbox 0.3.0"
git -C website add api/apps zhengzhengstudio.cn/api/apps api/data/changelogs.json api/scripts api/test life.zhengzhengstudio.cn
git -C website commit -m "release: publish LifeDiary 0.3.0"
```
