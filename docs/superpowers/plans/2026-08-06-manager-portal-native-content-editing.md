# Manager Portal Native Content Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Manager Portal raw JSON workspaces with permission-aware native editing for media, downloads, documents, websites, and works, then publish private version 1.5.2 build 14 packages for all four platforms.

**Architecture:** A focused backend library converts existing domain data into a normalized native workspace contract and maps a small allowlist of actions to existing protected APIs. Android, iOS, macOS, and HarmonyOS render the same field and action contract with native controls, while the server remains responsible for authorization, input validation, revision checks, and audit logging.

**Tech Stack:** Node.js `node:test`, Express, Axios, Java/Android Views, Swift/UIKit, Swift/AppKit, ArkTS/ArkUI, Gradle, `swiftc`, DevEco hvigor, shell release tooling.

## Global Constraints

- Release version is exactly `1.5.2`; release build is exactly `14`.
- Manager Portal packages remain private and must not enter public app manifests or public download routes.
- No generic JSON mutation endpoint, arbitrary URL, arbitrary HTTP method, arbitrary filesystem path, or executable source update is accepted from a native client.
- Every read and mutation requires a valid administrator session and the module-specific permission.
- HTTP 401 clears local credentials and returns the client to login; HTTP 403 keeps the session and reports missing permission.
- Native binary upload and chunked transfer remain in the existing web workflow for this release.
- Website-facing release changes update `website/api/data/changelogs.json` and `website/zhengzhengstudio.cn/api/changelogs.json`.

## File Structure

- Create `website/api/lib/manager_native_content.js`: pure workspace normalization, revision hashing, input validation, and action allowlist mapping.
- Create `website/api/test/manager_native_content.test.js`: backend contract and security tests.
- Modify `website/api/server.js`: authenticated workspace/action routes, existing protected API delegation, session and audit handling.
- Modify `apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java`: native record list and edit form renderer.
- Modify `apps/ManagerPortal-iOS/Sources/main.swift`: UIKit record list and edit form renderer.
- Modify `apps/ManagerPortalMac/Sources/main.swift`: AppKit record list and edit form renderer.
- Modify `apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets`: ArkUI record list and edit form renderer.
- Create `tests/manager_portal_native_content_contract.test.js`: cross-platform source and session behavior contract.
- Modify platform version files and `apps/build_manager_portal_apps.sh`: version 1.5.2 build 14 and private manifest generation.
- Create `tests/manager_portal_release_contract.test.js`: release version, package naming, privacy, and notes contract.
- Modify both changelog JSON files with the same public release entry.

---

### Task 1: Normalize Editable Module Data

**Files:**
- Create: `website/api/lib/manager_native_content.js`
- Create: `website/api/test/manager_native_content.test.js`

**Interfaces:**
- Consumes: existing response objects from `/api/admin/media/:type`, `/api/admin/websites`, and `/api/works/public`.
- Produces: `buildManagerWorkspace(moduleId, sourceData)`, `createRecordRevision(moduleId, record)`, `getManagerModuleDefinition(moduleId)`.
- Workspace shape: `{ schemaVersion, module, canCreate, createFields, records }` where each record is `{ id, group, title, subtitle, revision, fields, actions }`.
- Field shape: `{ key, label, type, value, editable, required, maxLength }` with type in `text`, `multiline`, `url`, or `choice`.

- [ ] **Step 1: Write failing normalization tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildManagerWorkspace,
  createRecordRevision,
  getManagerModuleDefinition
} = require('../lib/manager_native_content');

test('media workspace exposes editable metadata without raw JSON', () => {
  const workspace = buildManagerWorkspace('downloads', {
    files: [{ name: 'tool.apk', title: 'Tool', size: 42, category: 'APP', remarks: 'Stable' }]
  });
  assert.equal(workspace.schemaVersion, 1);
  assert.equal(workspace.records[0].id, 'tool.apk');
  assert.deepEqual(workspace.records[0].actions, ['update', 'delete']);
  assert.equal(workspace.records[0].fields.find(field => field.key === 'size').editable, false);
  assert.equal(workspace.records[0].fields.find(field => field.key === 'title').editable, true);
  assert.equal('data' in workspace, false);
});

test('website workspace supports create and preserves stable ids', () => {
  const workspace = buildManagerWorkspace('websites', [{ id: 'site-1', name: 'Lab', url: 'https://example.com' }]);
  assert.equal(workspace.canCreate, true);
  assert.equal(workspace.records[0].id, 'site-1');
  assert.deepEqual(workspace.records[0].actions, ['update', 'delete']);
});

test('unknown modules are rejected', () => {
  assert.throws(() => getManagerModuleDefinition('code'), /不支持原生编辑/);
});

test('record revisions are stable and change with editable values', () => {
  const first = createRecordRevision('websites', { id: '1', name: 'A', url: 'https://a.example' });
  const same = createRecordRevision('websites', { url: 'https://a.example', name: 'A', id: '1' });
  const changed = createRecordRevision('websites', { id: '1', name: 'B', url: 'https://a.example' });
  assert.equal(first, same);
  assert.notEqual(first, changed);
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `node --test website/api/test/manager_native_content.test.js`

Expected: FAIL because `../lib/manager_native_content` does not exist.

- [ ] **Step 3: Implement the module definitions and normalizer**

Implement an immutable definition table for exactly `media`, `downloads`, `documents`, `websites`, and `works`. Sort object keys before SHA-256 revision hashing. Normalize file modules from `sourceData.files`, websites from an array, and works from either an array or `sourceData.works`.

Use these editable fields:

```js
const EDITABLE_FIELDS = {
  media: ['title', 'artist', 'category', 'remarks', 'lyrics', 'links'],
  downloads: ['title', 'category', 'remarks', 'links', 'bundleIdentifier', 'bundleVersion'],
  documents: ['title', 'category', 'remarks', 'links'],
  websites: ['name', 'url', 'description', 'category', 'icon'],
  works: ['title', 'description', 'category', 'version', 'runUrl', 'cover', 'language', 'author']
};
```

Filename, size, modification time, ids, ownership, deployed paths, code, and server fields remain read-only. Only websites expose `canCreate: true` in this release.

- [ ] **Step 4: Run normalization tests**

Run: `node --test website/api/test/manager_native_content.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the normalized workspace contract**

```bash
git -C website add api/lib/manager_native_content.js api/test/manager_native_content.test.js
git -C website commit -m "feat(manager): define native content workspace"
```

### Task 2: Validate And Map Native Mutations

**Files:**
- Modify: `website/api/lib/manager_native_content.js`
- Modify: `website/api/test/manager_native_content.test.js`

**Interfaces:**
- Consumes: `{ moduleId, action, recordId, revision, values, confirmation }`.
- Produces: `validateManagerAction(input)` and `buildManagerActionRequest(input)`.
- `buildManagerActionRequest` returns only `{ method, path, body }` selected by the server definition table.

- [ ] **Step 1: Add failing allowlist and validation tests**

```js
test('download metadata update maps to the protected media endpoint', () => {
  const request = buildManagerActionRequest({
    moduleId: 'downloads', action: 'update', recordId: 'tool.apk', revision: 'a'.repeat(64),
    values: { title: 'Tool 2', category: 'APP', remarks: 'Updated' }
  });
  assert.deepEqual(request, {
    method: 'POST',
    path: '/api/admin/media/downloads/metadata',
    body: { filename: 'tool.apk', title: 'Tool 2', category: 'APP', remarks: 'Updated' }
  });
});

test('delete requires the exact target confirmation', () => {
  assert.throws(() => buildManagerActionRequest({
    moduleId: 'documents', action: 'delete', recordId: 'guide.pdf',
    revision: 'b'.repeat(64), confirmation: 'wrong', values: {}
  }), /确认目标不一致/);
});

test('arbitrary module, action, path, and fields are rejected', () => {
  assert.throws(() => buildManagerActionRequest({ moduleId: 'code', action: 'save', recordId: 'server.js', values: { path: '/tmp/x' } }));
  assert.throws(() => buildManagerActionRequest({ moduleId: 'websites', action: 'proxy', recordId: '1', values: { method: 'DELETE' } }));
  assert.throws(() => buildManagerActionRequest({ moduleId: 'works', action: 'update', recordId: '1', revision: 'c'.repeat(64), values: { code: 'process.exit()' } }), /字段/);
});

test('website URL and text limits are validated', () => {
  assert.throws(() => validateManagerAction({ moduleId: 'websites', action: 'create', values: { name: 'A', url: 'javascript:alert(1)' } }), /URL/);
  assert.throws(() => validateManagerAction({ moduleId: 'websites', action: 'create', values: { name: 'x'.repeat(201), url: 'https://example.com' } }), /长度/);
});
```

- [ ] **Step 2: Run the targeted test and verify allowlist failures**

Run: `node --test website/api/test/manager_native_content.test.js`

Expected: FAIL because the action functions are not exported.

- [ ] **Step 3: Implement strict action mapping**

Map only these operations:

- `media|downloads|documents update` -> `POST /api/admin/media/{type}/metadata`.
- `media|downloads|documents delete` -> `DELETE /api/admin/media/{type}/{encoded recordId}`.
- `websites create` -> `POST /api/admin/websites`.
- `websites update` -> `PUT /api/admin/websites/{encoded recordId}`.
- `websites delete` -> `DELETE /api/admin/websites/{encoded recordId}`.
- `works update|delete` -> `POST /api/works/admin/manage` with `{ action, id, data }`.

Reject extra keys, path separators in filenames, non-HTTP(S) URLs, missing required values, text above the field limit, malformed 64-character revisions, and delete requests whose `confirmation` is not exactly `recordId`.

- [ ] **Step 4: Run all backend library tests**

Run: `node --test website/api/test/manager_native_content.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the mutation allowlist**

```bash
git -C website add api/lib/manager_native_content.js api/test/manager_native_content.test.js
git -C website commit -m "feat(manager): allow safe native content actions"
```

### Task 3: Add Authenticated Workspace And Action Routes

**Files:**
- Modify: `website/api/server.js` near the existing `/api/admin/manager/module-data/:moduleId` route.
- Modify: `website/api/test/manager_native_content.test.js`

**Interfaces:**
- Consumes: `buildManagerWorkspace`, `createRecordRevision`, and `buildManagerActionRequest` from Task 2.
- Produces: `GET /api/admin/manager/content/:moduleId` and `POST /api/admin/manager/content/:moduleId/action`.

- [ ] **Step 1: Add failing route-source contract tests**

Add assertions that `server.js` imports the new library, both routes call `requireManagerAppIdentity`, module permission is checked through `adminHasPermission`, stale revisions return 409, and delegated requests copy `x-admin-username` and `x-admin-token`. Slice the source between the two new route markers before checking that this route block never reads a target path, method, or URL from `req.body`; other unrelated routes in the large server file legitimately use their own request fields.

```js
test('server exposes protected native content routes', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /app\.get\('\/api\/admin\/manager\/content\/:moduleId'/);
  assert.match(source, /app\.post\('\/api\/admin\/manager\/content\/:moduleId\/action'/);
  assert.match(source, /return res\.status\(409\)/);
  const routeBlock = source.slice(source.indexOf("app.get('/api/admin/manager/content/:moduleId'"), source.indexOf('// END MANAGER NATIVE CONTENT ROUTES'));
  assert.doesNotMatch(routeBlock, /req\.body\.(?:path|method|url)/);
});
```

- [ ] **Step 2: Run the test and verify route absence**

Run: `node --test website/api/test/manager_native_content.test.js`

Expected: FAIL because the content routes do not exist.

- [ ] **Step 3: Implement the GET route**

Authenticate with `requireManagerAppIdentity`, look up the module definition, enforce its permission, fetch the existing protected source API over `127.0.0.1:${PORT}`, normalize the result, and return `{ success: true, workspace }`. For `media`, fetch audio, music, movie, and photo lists and attach the media type as each record group.

- [ ] **Step 4: Implement the POST action route**

Authenticate and authorize again, build the allowlisted request, re-read the target record, compare its current revision with the submitted revision, and return 409 on mismatch. Delegate the protected operation with the current administrator headers. Record module, action, record id, result, and actor in the audit log; omit token and full text values.

For media, download, and document deletion, update the existing protected delete operation so the file deletion and metadata cleanup have an explicit combined result. If metadata cleanup fails after the file is removed, return a non-success response that identifies the cleanup failure and write it to the audit/error log; never return a silent complete-success response.

Return normalized responses:

```json
{ "success": true, "record": {}, "workspaceRevision": "..." }
```

For upstream 400, 401, 403, 404, or 409, preserve the status and a safe error message. For other failures, return 502 without upstream HTML.

- [ ] **Step 5: Run backend tests and syntax checks**

Run:

```bash
node --test website/api/test/manager_native_content.test.js
node -c website/api/lib/manager_native_content.js
node -c website/api/server.js
```

Expected: tests PASS and both syntax checks exit 0.

- [ ] **Step 6: Commit the protected API integration**

```bash
git -C website add api/server.js api/test/manager_native_content.test.js
git -C website commit -m "feat(manager): expose protected native content editing"
```

### Task 4: Replace Android Raw JSON With Native Forms

**Files:**
- Modify: `apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java`
- Create: `tests/manager_portal_native_content_contract.test.js`

**Interfaces:**
- Consumes: `GET /api/admin/manager/content/:moduleId` workspace and `POST /api/admin/manager/content/:moduleId/action`.
- Produces: Android methods `showContentWorkspace`, `renderContentRecord`, `showContentEditor`, `submitContentAction`, and `expireSessionAndShowLogin`.

- [ ] **Step 1: Write a failing Android source contract test**

Assert that the Android source calls the new content endpoint, creates `EditText` controls from workspace fields, supports update/delete/create actions, handles status 401 through `expireSessionAndShowLogin`, and no longer calls `toString(2)` in `showNativeModuleWorkspace`.

- [ ] **Step 2: Run the contract test and verify the old JSON viewer fails**

Run: `node --test tests/manager_portal_native_content_contract.test.js`

Expected: FAIL on the Android structured workspace assertions.

- [ ] **Step 3: Preserve HTTP status in the Android request layer**

Change the request result to carry `statusCode`, parsed JSON, and a safe error. On 401, clear `managerToken`, `managerUsername`, saved permissions, cached workspace state, and return to the login view. On 403, keep credentials and show the server permission message.

- [ ] **Step 4: Render records and native editors**

Replace `showNativeModuleWorkspace` for the five scoped ids with `showContentWorkspace`. Render title, subtitle, group, and read-only details as labels. Build editable controls from field type, retain unsaved values after network errors, disable Save while sending, and refresh the workspace after success.

Delete uses an `AlertDialog` naming the record and submits `confirmation: recordId`. Website create uses the workspace `createFields` and action `create`.

- [ ] **Step 5: Run the source contract and Android build**

Run:

```bash
node --test tests/manager_portal_native_content_contract.test.js
cd apps/ManagerPortal-Android && ./gradlew :app:assembleDebug
```

Expected: contract PASS and `app-debug.apk` is produced.

- [ ] **Step 6: Commit Android native editing**

```bash
git add apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java tests/manager_portal_native_content_contract.test.js
git commit -m "feat(manager): add Android native content editing"
```

### Task 5: Add Native Forms To iOS And macOS

**Files:**
- Modify: `apps/ManagerPortal-iOS/Sources/main.swift`
- Modify: `apps/ManagerPortalMac/Sources/main.swift`
- Modify: `tests/manager_portal_native_content_contract.test.js`

**Interfaces:**
- Consumes: the same workspace/action contract as Android.
- Produces: `showContentWorkspace`, `contentRecordView`, `showContentEditor`, `submitContentAction`, and `expireSessionAndShowLogin` in both Swift clients.

- [ ] **Step 1: Extend the failing source contract to both Swift clients**

Assert both sources use `/api/admin/manager/content/`, render editable controls (`UITextField`/`UITextView` on iOS and `NSTextField`/`NSTextView` on macOS), provide update/delete/create, and route 401 to credential clearing. Assert scoped workspaces no longer use `prettyJSON` as their primary renderer.

- [ ] **Step 2: Run the contract test and verify Swift failures**

Run: `node --test tests/manager_portal_native_content_contract.test.js`

Expected: FAIL on iOS and macOS structured editing assertions.

- [ ] **Step 3: Implement shared behavior in each existing single-file client**

Use the existing request and stack helpers. Add status-aware response handling, native record rows, modal/sheet editors, field validation messages, disabled saving state, destructive confirmation, 401 logout, and 403 permission messaging. Keep platform layout conventions: iOS pushes or presents a form sheet; macOS uses the existing content panel and sheet.

- [ ] **Step 4: Run source contracts and compile both clients**

Run:

```bash
node --test tests/manager_portal_native_content_contract.test.js
xcrun swiftc -typecheck -framework Cocoa -framework UserNotifications apps/ManagerPortalMac/Sources/main.swift
xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios16.0 -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" -framework UIKit -framework UserNotifications apps/ManagerPortal-iOS/Sources/main.swift
```

Expected: contract PASS and both type checks exit 0.

- [ ] **Step 5: Commit Apple native editing**

```bash
git add apps/ManagerPortal-iOS/Sources/main.swift apps/ManagerPortalMac/Sources/main.swift tests/manager_portal_native_content_contract.test.js
git commit -m "feat(manager): add Apple native content editing"
```

### Task 6: Add HarmonyOS Native Forms

**Files:**
- Modify: `apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets`
- Modify: `tests/manager_portal_native_content_contract.test.js`

**Interfaces:**
- Consumes: the same workspace/action contract as Tasks 4 and 5.
- Produces: ArkUI workspace list, editor sheet/dialog, action submission, and session expiration handling.

- [ ] **Step 1: Extend the failing contract to HarmonyOS**

Assert the ArkTS source calls the new content endpoint, renders `TextInput` and `TextArea`, submits create/update/delete, clears preferences on 401, and no longer assigns `JSON.stringify(data, null, 2)` to the scoped workspace.

- [ ] **Step 2: Run the contract and verify HarmonyOS failure**

Run: `node --test tests/manager_portal_native_content_contract.test.js`

Expected: FAIL on HarmonyOS structured editing assertions.

- [ ] **Step 3: Implement ArkUI record and editor state**

Add typed workspace, record, and field interfaces. Render records with `ForEach`, open an editor using the existing page state, preserve draft values on failed requests, show a target-naming delete confirmation, and refresh after success. Update the request helper to pass HTTP status through and call the existing logout cleanup on 401.

- [ ] **Step 4: Run the contract and HarmonyOS build**

Run:

```bash
node --test tests/manager_portal_native_content_contract.test.js
DEVECO_APP=/Applications/DevEco-Studio.app bash -lc 'cd /tmp && rm -rf ManagerPortal-HarmonyOS-plan-check && ditto "/Users/ljg/Desktop/开发者/TRAE/apps/ManagerPortal-HarmonyOS" ManagerPortal-HarmonyOS-plan-check && cd ManagerPortal-HarmonyOS-plan-check && "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap --mode module -p product=default -p module=entry@default -p buildMode=release --no-daemon'
```

Expected: contract PASS and an unsigned HAP is produced. If the installed DevEco SDK is unavailable, record the exact tool failure and do not publish a stale HAP as build 14.

- [ ] **Step 5: Commit HarmonyOS native editing**

```bash
git add apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets tests/manager_portal_native_content_contract.test.js
git commit -m "feat(manager): add HarmonyOS native content editing"
```

### Task 7: Version, Build, And Publish Private Packages

**Files:**
- Modify: `apps/ManagerPortal-Android/app/build.gradle.kts`
- Modify: `apps/ManagerPortal-iOS/Sources/main.swift`
- Modify: `apps/ManagerPortalMac/Sources/main.swift`
- Modify: `apps/ManagerPortal-HarmonyOS/AppScope/app.json5`
- Modify: `apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets`
- Modify: `apps/build_manager_portal_apps.sh`
- Create: `tests/manager_portal_release_contract.test.js`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/changelogs.json`

**Interfaces:**
- Consumes: buildable clients from Tasks 4-6.
- Produces: four versioned packages, four latest aliases, and `website/zhengzhengstudio.cn/manager_portal/apps.json` entries.

- [ ] **Step 1: Write the failing release contract**

Assert every source and build config reports version `1.5.2` build `14`, the build script uses the four exact filenames from the design, release notes mention native structured editing and expired-session logout, and public manifests contain no id beginning with `manager-portal-`.

- [ ] **Step 2: Run the release contract and verify old 1.5.1 values fail**

Run: `node --test tests/manager_portal_release_contract.test.js`

Expected: FAIL because current files contain 1.5.1 build 13.

- [ ] **Step 3: Update versions and release metadata**

Replace 1.5.1/13 with 1.5.2/14 in all four clients and the build script. Add release notes describing structured lists/forms, safe edit/delete, website creation, permission checks, and automatic logout on 401. Add the same dated changelog entry to both changelog files.

- [ ] **Step 4: Run release and existing package tests before building**

Run:

```bash
node --test tests/manager_portal_release_contract.test.js
node --test tests/sync_to_termux_packages.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Build all available packages and regenerate the private manifest**

Run: `bash apps/build_manager_portal_apps.sh`

Expected: macOS DMG, iOS unsigned IPA, Android APK, and HarmonyOS unsigned HAP are created when their SDKs succeed; `manager_portal/apps.json` reports version 1.5.2 build 14 with current sizes and SHA-256 values.

- [ ] **Step 6: Verify package privacy and integrity**

Run a Node verification that hashes each package, compares it to the private manifest, verifies every available file exists, verifies public manifests have no Manager Portal entries, and confirms no Manager Portal package exists in `website/zhengzhengstudio.cn/api/apps`.

Expected: every published private package hash matches and all public privacy checks PASS.

- [ ] **Step 7: Commit release artifacts and metadata**

Stage only Manager Portal source, build metadata, private packages, private manifest, tests, and the two changelog files. Do not stage unrelated workspace changes.

```bash
git commit -m "feat(manager): release native content editing 1.5.2"
```

### Task 8: Deploy And Verify The Live Flow

**Files:**
- Modify: `sync_to_termux.js` only if the private Manager Portal 1.5.2 filenames are not already covered by its private app-package rules.

**Interfaces:**
- Consumes: server changes, private manifest, and packages from Tasks 1-7.
- Produces: live authenticated Manager Portal workspace/action routes and private update availability.

- [ ] **Step 1: Run the complete local verification suite**

Run:

```bash
node --test website/api/test/manager_native_content.test.js
node --test tests/manager_portal_native_content_contract.test.js
node --test tests/manager_portal_release_contract.test.js
node --test tests/sync_to_termux_packages.test.js
node -c website/api/server.js
node -c website/api/lib/manager_native_content.js
node -c sync_to_termux.js
```

Expected: all tests PASS and syntax checks exit 0.

- [ ] **Step 2: Sync only required server, manifest, changelog, and private package files**

Use the existing protected Termux sync path. Confirm each file is accepted by the intended private path. Do not copy Manager Portal packages into the public static app directory.

- [ ] **Step 3: Restart the default Termux API and confirm the new build is active**

Run the existing default `node start_termux.js` flow. Poll `/api/health` until uptime resets and status is `ok`. Confirm the deployed `server.js` and `manager_native_content.js` SHA-256 values match local files.

- [ ] **Step 4: Verify authentication and authorization behavior**

With an authenticated administrator test session:

- GET a permitted workspace and verify structured records with no raw `data` dump.
- Submit one reversible website create/update/delete sequence and verify all three actions.
- Submit a stale revision and verify HTTP 409.
- Submit with a user lacking the module permission and verify HTTP 403.
- Submit with an expired token and verify HTTP 401.
- Verify arbitrary module/action requests return 400 or 404 without execution.

- [ ] **Step 5: Verify the private package page and public exclusion**

Confirm `/api/admin/manager/apps` reports 1.5.2 build 14 for each successfully built platform, each download token retrieves the matching hash, and `/api/downloads` plus `/api/apps/manifest.json` contain no Manager Portal package.

- [ ] **Step 6: Perform final client smoke checks**

Install or launch the locally available Android and macOS builds. Verify login, one structured list, one metadata save, one cancelled delete, one confirmed reversible website operation, token expiration logout, update prompt, and package download. Record unavailable device-specific checks explicitly rather than inferring success.

- [ ] **Step 7: Final verification commit if deployment rules changed**

If `sync_to_termux.js` required a scoped filename-rule change, commit that file with its test only:

```bash
git add sync_to_termux.js tests/sync_to_termux_packages.test.js
git commit -m "fix(sync): include private manager 1.5.2 packages"
```
