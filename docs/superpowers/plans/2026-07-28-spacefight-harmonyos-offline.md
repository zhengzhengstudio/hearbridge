# SpaceFight HarmonyOS Offline Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish co-installable online and offline HarmonyOS SpaceFight HAPs with `.hmos` and `.hmos.offline` bundle names.

**Architecture:** Keep the existing native ArkTS project as the online edition and create a second native project for Offline. The Offline source retains the Canvas renderer, local simulation, controls, tutorial, and preferences while physically removing HTTP, WebSocket, passport, public mode, network permission, and runtime update code. The release builder treats both HAPs as distinct artifacts and metadata entries.

**Tech Stack:** HarmonyOS ArkTS, Hvigor/DevEco Studio, Bash release builder, Node.js contract tests and JSON metadata.

## Global Constraints

- Online bundle name is exactly `cn.zhengzhengstudio.spacefight.hmos`.
- Offline bundle name is exactly `cn.zhengzhengstudio.spacefight.hmos.offline`.
- Offline has no passport UI or stored passport state.
- Offline has no internet permission, HTTP client, WebSocket, public mode, or runtime update request.
- Both variants remain native apps and never embed the website.
- Version stays `0.8.0`, build stays `10`.
- Unsigned packages must include `-unsigned` in filenames and metadata.
- Both publication roots and the website changelog must be updated.

---

### Task 1: Bundle And Offline Boundaries

**Files:**
- Modify: `tests/spacefight_product_contract.test.js`
- Modify: `HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5`
- Modify: `HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets`
- Create: `HarmonyOS-App/SpaceFightHarmonyOffline/**`

**Interfaces:**
- Consumes: Existing `SpaceFightHarmony` native project and local game implementation.
- Produces: Online project bundle `cn.zhengzhengstudio.spacefight.hmos` and offline project bundle `cn.zhengzhengstudio.spacefight.hmos.offline`.

- [ ] **Step 1: Write the failing product contract**

Add an offline project path and assertions equivalent to:

```js
const offlineRoot = 'HarmonyOS-App/SpaceFightHarmonyOffline';
assert.match(read(`${offlineRoot}/AppScope/app.json5`), /cn\.zhengzhengstudio\.spacefight\.hmos\.offline/);
assert.match(read(sources.harmonyApp), /cn\.zhengzhengstudio\.spacefight\.hmos/);
const offline = read(`${offlineRoot}/entry/src/main/ets/pages/Index.ets`);
assert.doesNotMatch(offline, /@ohos\.net\.(?:http|webSocket)|passport|公开协作|checkUpdates|manifestUrl/i);
assert.doesNotMatch(read(`${offlineRoot}/entry/src/main/module.json5`), /ohos\.permission\.INTERNET/);
assert.match(offline, /stepLocalBattle|updateMove|updateFire|trainingStep/);
```

- [ ] **Step 2: Run the product contract and verify RED**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL because the online bundle lacks `.hmos` and `SpaceFightHarmonyOffline` does not exist.

- [ ] **Step 3: Migrate the online bundle name**

Change `AppScope/app.json5` to `cn.zhengzhengstudio.spacefight.hmos`, update the visible package line in `Index.ets`, and change its signing-material lookup identity in the release builder in Task 3.

- [ ] **Step 4: Create and sanitize the Offline project**

Mechanically copy `SpaceFightHarmony` to `SpaceFightHarmonyOffline` without `.git`, `.preview`, or `build` output. In Offline:

```json5
"bundleName": "cn.zhengzhengstudio.spacefight.hmos.offline"
```

Remove `ohos.permission.INTERNET` from `module.json5`. Change app strings to `SpaceFight Offline`. Remove HTTP/WebSocket imports and types, account/password/login state, socket state, `connectSocket`, `send`, `parseMessage`, `login`, `checkUpdates`, online utility buttons, profile/login panels, and the public mission action. `startGame()` must always reset and start `localRunning` with the local 60 Hz timers.

- [ ] **Step 5: Run the product contract and verify GREEN**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: PASS with both bundle names and all offline network exclusions enforced.

### Task 2: Offline Build Output

**Files:**
- Modify: `tests/spacefight_product_contract.test.js`
- Modify: `HarmonyOS-App/SpaceFightHarmonyOffline/build-hap.sh`

**Interfaces:**
- Consumes: Offline project from Task 1.
- Produces: `entry/build/default/outputs/default/SpaceFight-HarmonyOS-Offline-v0.8.0.hap`.

- [ ] **Step 1: Add a failing build-script contract**

Assert the offline script contains:

```js
assert.match(offlineBuild, /SpaceFight-HarmonyOS-Offline-v\$\{VERSION:-test\}\.hap/);
assert.match(offlineBuild, /SpaceFightHarmonyOffline-build/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/spacefight_product_contract.test.js`

Expected: FAIL because the copied script still emits the online filename.

- [ ] **Step 3: Give Offline an independent temporary build path and artifact name**

Set:

```bash
BUILD_DIR="/tmp/SpaceFightHarmonyOffline-build"
HAP_NAME="SpaceFight-HarmonyOS-Offline-v${VERSION:-test}.hap"
```

- [ ] **Step 4: Compile both ArkTS projects**

Run: `HarmonyOS-App/SpaceFightHarmony/build-hap.sh && HarmonyOS-App/SpaceFightHarmonyOffline/build-hap.sh`

Expected: both Hvigor builds succeed and produce separate HAPs.

### Task 3: Dual HarmonyOS Release Metadata

**Files:**
- Modify: `tests/spacefight_release_contract.test.js`
- Modify: `apps/build_spacefight_apps.sh`
- Generated: `website/api/apps/manifest.json`
- Generated: `website/api/apps/client-downloads.json`
- Generated: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Generated: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`

**Interfaces:**
- Consumes: Online and Offline HAP outputs.
- Produces: `spacefight-harmonyos` and `spacefight-harmonyos-offline` release entries and latest aliases.

- [ ] **Step 1: Extend the release contract and verify RED**

Add release expectations:

```js
'spacefight-harmonyos': {
  bundleIdentifier: 'cn.zhengzhengstudio.spacefight.hmos',
  versionedPattern: /^SpaceFight-HarmonyOS-v0\.8\.0(-unsigned)?\.hap$/,
},
'spacefight-harmonyos-offline': {
  bundleIdentifier: 'cn.zhengzhengstudio.spacefight.hmos.offline',
  variant: 'offline',
  versionedPattern: /^SpaceFight-HarmonyOS-Offline-v0\.8\.0(-unsigned)?\.hap$/,
},
```

Run: `node --test tests/spacefight_release_contract.test.js`

Expected: FAIL because Offline package and metadata are absent.

- [ ] **Step 2: Extend the builder**

Add `HARMONY_OFFLINE_DIR`, separate signed/unsigned Offline filenames, a `build_harmony_offline()` function, independent signing fallback using `cn.zhengzhengstudio.spacefight.hmos.offline`, and copy both versioned/latest artifacts to both app roots.

Generate online metadata with bundle `cn.zhengzhengstudio.spacefight.hmos`. Generate Offline metadata with bundle `cn.zhengzhengstudio.spacefight.hmos.offline`, `variant: 'offline'`, no passport/update claims, and title `SpaceFight Offline HarmonyOS`.

- [ ] **Step 3: Build and publish both HarmonyOS variants**

Run: `bash apps/build_spacefight_apps.sh --harmony-only`

Expected: online and Offline HAPs build, metadata lists five SpaceFight entries, and both roots receive matching artifacts.

- [ ] **Step 4: Run release contract and verify GREEN**

Run: `node --test tests/spacefight_release_contract.test.js`

Expected: PASS for filenames, bundle identifiers, variants, aliases, sizes, SHA-256 hashes, and directory parity.

### Task 4: Changelog And Package Inspection

**Files:**
- Modify: `website/api/data/changelogs.json`
- Test: `tests/spacefight_playability_contract.test.js`
- Test: `tests/spacefight_product_contract.test.js`
- Test: `tests/spacefight_release_contract.test.js`

**Interfaces:**
- Consumes: Published HAPs and metadata from Task 3.
- Produces: User-facing release record and final verification evidence.

- [ ] **Step 1: Update the SpaceFight 0.8.0 changelog entry**

Record the online `.hmos` migration, Offline `.hmos.offline` package, absence of passport/network permission, separate filenames, and unsigned status.

- [ ] **Step 2: Inspect both HAP manifests**

Run:

```bash
unzip -p website/api/apps/SpaceFight-HarmonyOS-v0.8.0-unsigned.hap module.json
unzip -p website/api/apps/SpaceFight-HarmonyOS-Offline-v0.8.0-unsigned.hap module.json
```

Expected: online bundle is `cn.zhengzhengstudio.spacefight.hmos` with INTERNET permission; Offline bundle is `cn.zhengzhengstudio.spacefight.hmos.offline` without INTERNET permission.

- [ ] **Step 3: Run all SpaceFight contracts**

Run:

```bash
node --test tests/spacefight_playability_contract.test.js tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js
node -e "JSON.parse(require('fs').readFileSync('website/api/data/changelogs.json'))"
```

Expected: all contracts pass and changelog JSON parses.

- [ ] **Step 4: Verify package parity**

Run `shasum -a 256` for both versioned HAPs in both publication roots.

Expected: each package has the same SHA-256 in `website/api/apps` and `website/zhengzhengstudio.cn/api/apps`.
