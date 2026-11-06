# Survival Diary Release and Download Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the redesigned release as version 0.5.0 build 13 with verified signed artifacts, working updater metadata, complete descriptions, compatibility entry, and synchronized download-center documents.

**Architecture:** Treat `release/survival-diary/0.5.0/release.json` as the release descriptor. Build platform artifacts first, validate signatures and hashes, then generate private/public manifests and client-downloads deterministically; never advertise a missing or unsigned artifact as available.

**Tech Stack:** Gradle, Swift build scripts, Hvigor, Node metadata generator/tests, JSON manifests, website download center.

## Global Constraints

- Release version is `0.5.0`; common build is `13` unless a platform requires a monotonically larger platform code recorded in the descriptor.
- Formal packages go under `website/api/apps` and mirror to `website/zhengzhengstudio.cn/api/apps`.
- Android APK must use the existing formal Android certificate.
- HarmonyOS offline HAP/APP is published only after the existing profile and certificate complete release signing.
- Apple artifacts are marked available only when distribution identity and provisioning permit a formal distributable package.
- Manifest and client-downloads must include name, introduction, version, build, size, SHA-256, signing state, minimum system, recommended configuration, and compatibility-mode URL.
- `website/api/data/changelogs.json` must contain all previously omitted Survival Diary changes plus the current release.
- Updater compares both semantic version and build, downloads to the platform Downloads location when permitted, verifies integrity, and invokes the system installer/open flow.

---

### Task 1: Version and Release Descriptor

**Files:**
- Create: `release/survival-diary/0.5.0/release.json`
- Modify: `apps/SurvivalDiary-Android/app/build.gradle.kts`
- Modify: `apps/SurvivalDiary-Apple/Package.swift`
- Modify: `apps/SurvivalDiary-Apple/Support/iOS-Info.plist`
- Modify: `apps/SurvivalDiary-Apple/Support/macOS-Info.plist`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/AppScope/app.json5`
- Modify: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/module.json5`
- Modify: `scripts/generate_survival_diary_release_metadata.mjs`
- Test: `tests/survival_diary_release_v3.test.js`

**Interfaces:**
- Produces descriptor platform entries consumed by the metadata generator.

- [ ] **Step 1: Add failing 0.5.0/build 13 release assertions**

```js
assert.equal(descriptor.version, '0.5.0');
assert.equal(descriptor.build, 13);
assert.equal(android.versionName, '0.5.0');
assert.equal(android.versionCode, 13);
```

- [ ] **Step 2: Run release tests and verify failure**

Run: `node --test tests/survival_diary_release_v3.test.js`  
Expected: FAIL while descriptor and projects remain 0.4.7/build 12.

- [ ] **Step 3: Create the descriptor with honest availability**

```json
{
  "product": "survival-diary",
  "version": "0.5.0",
  "build": 13,
  "description": "开放式 2.5D 海岛生存：探索、采集、制作、建造与日记。",
  "compatibilityUrl": "https://survival-diary.zhengzhengstudio.cn/?mode=compatibility"
}
```

Each platform begins with `available: false` until its artifact validation task succeeds.

- [ ] **Step 4: Make metadata generator accept a descriptor path**

```js
const releaseFile = process.argv.find(value => value.endsWith('release.json'))
  ?? path.join(root, 'release/survival-diary/0.5.0/release.json');
```

- [ ] **Step 5: Run version tests and commit**

Run: `node --test tests/survival_diary_release_v3.test.js`  
Expected: PASS.

```bash
git add release/survival-diary/0.5.0 apps/SurvivalDiary-* scripts/generate_survival_diary_release_metadata.mjs tests/survival_diary_release_v3.test.js
git commit -m "chore(survival-diary): prepare 0.5.0 release"
```

### Task 2: Cross-Platform Updater Behavior

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/js/update.js`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/UpdateRepository.kt`
- Modify: `apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/ReleasePushService.kt`
- Modify: `apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/UpdateService.swift`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/update/UpdateService.ets`
- Test: `apps/SurvivalDiary-Android/app/src/test/java/cn/zhengzhengstudio/survivaldiary/UpdateRepositoryTest.kt`
- Test: `apps/SurvivalDiary-Apple/Tests/SurvivalDiaryOnlineTests/UpdateServiceTests.swift`
- Test: `tests/survival_diary_release.test.js`

**Interfaces:**
- Produces common decision semantics: update when `manifest.version > current.version` or equal version with `manifest.build > current.build`; state `idle/checking/available/downloading/verified/installing/error`.

- [ ] **Step 1: Add failing version/build and progress tests**

```js
assert.equal(needsUpdate({ version: '0.5.0', build: 13 }, { version: '0.5.0', build: 14 }), true);
assert.equal(needsUpdate({ version: '0.5.0', build: 13 }, { version: '0.4.9', build: 99 }), false);
assert.equal(updatePresentation('downloading').collapsible, true);
```

- [ ] **Step 2: Run updater suites and verify failure**

Run Node, Android, and Swift update tests.  
Expected: FAIL on shared build comparison or collapsible progress.

- [ ] **Step 3: Implement decision and integrity flow**

```text
idle → checking → available → downloading(received/total) → verified(SHA-256) → installing
                                             ↘ error(retryable)
```

- [ ] **Step 4: Implement platform install handoff**

Android uses Downloads plus package installer intent; Harmony uses the supported package install/open flow; Apple opens the signed distribution or store URL; Web opens the verified download URL. No platform claims silent installation.

- [ ] **Step 5: Run all updater tests and commit**

Run: Android unit test, `swift test`, and `node --test tests/survival_diary_release.test.js`.  
Expected: PASS.

```bash
git add website/survival-diary.zhengzhengstudio.cn/js/update.js apps/SurvivalDiary-* tests
git commit -m "feat(survival-diary): restore verified update flow"
```

### Task 3: Build and Validate Platform Artifacts

**Files:**
- Modify: `scripts/build_survival_diary_release.sh`
- Modify: `release/survival-diary/0.5.0/release.json`
- Create when valid: `website/api/apps/SurvivalDiary-Android-v0.5.0-b13.apk`
- Create when valid: `website/api/apps/SurvivalDiary-HarmonyOS-Offline-v0.5.0-b13.hap`
- Create when valid: Apple 0.5.0 artifacts named in the descriptor.
- Test: `tests/survival_diary_publish_contract.test.js`

**Interfaces:**
- Consumes built platform projects.
- Produces artifacts plus `size`, `sha256`, `signed`, `signing`, and `available` descriptor fields.

- [ ] **Step 1: Build Android release and verify formal signature**

Run: `scripts/build_survival_diary_release.sh android 0.5.0 13`  
Expected: signed APK, `apksigner verify --verbose --print-certs` succeeds, debuggable is false.

- [ ] **Step 2: Build Apple distributables and record capability honestly**

Run the iOS/macOS build scripts. If a distribution profile or identity is unavailable, keep the corresponding descriptor entry unavailable with the exact blocking reason; do not copy an unsigned placeholder.

- [ ] **Step 3: Build HarmonyOS offline release with the existing profile**

Run the project release build. If keystore authorization is required, pause for the user to complete the signing prompt. Validate bundle name, version, certificate chain and non-debuggable state before marking available.

- [ ] **Step 4: Compute size and SHA-256 from final bytes**

```js
platform.size = fs.statSync(artifact).size;
platform.sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
platform.available = signatureVerified;
```

- [ ] **Step 5: Run publish contract tests and commit descriptor/scripts**

Run: `node --test tests/survival_diary_publish_contract.test.js tests/survival_diary_release_v3.test.js`  
Expected: PASS; unavailable platforms have empty download URLs.

```bash
git add scripts/build_survival_diary_release.sh release/survival-diary/0.5.0 website/api/apps/SurvivalDiary-*
git commit -m "build(survival-diary): produce 0.5.0 artifacts"
```

### Task 4: Download Center, Manifests, and Changelog

**Files:**
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: download-center page consuming `client-downloads.json` as located by `tests/survival_diary_publish_contract.test.js`
- Modify: `scripts/generate_survival_diary_release_metadata.mjs`
- Test: `tests/survival_diary_publish_contract.test.js`
- Test: `tests/survival_diary_release.test.js`

**Interfaces:**
- Produces synchronized private/public app entries with `compatibilityUrl`, `minimumSystem`, `recommendedSystem`, `description`, and verified artifact fields.

- [ ] **Step 1: Add failing metadata completeness assertions**

```js
for (const entry of survivalEntries) {
  assert.ok(entry.description.length >= 30);
  assert.ok(entry.minimumSystem);
  assert.ok(entry.recommendedSystem);
  assert.equal(entry.compatibilityUrl.endsWith('?mode=compatibility'), true);
}
```

- [ ] **Step 2: Verify manifests currently fail 0.5.0 completeness**

Run: `node --test tests/survival_diary_publish_contract.test.js tests/survival_diary_release.test.js`  
Expected: FAIL before generation.

- [ ] **Step 3: Generate all four metadata documents from the descriptor**

Run: `node scripts/generate_survival_diary_release_metadata.mjs release/survival-diary/0.5.0/release.json --write`  
Expected: four documents contain identical Survival Diary entries and valid URLs only for available artifacts.

- [ ] **Step 4: Add the compatibility choice to the download center**

```html
<a href="https://survival-diary.zhengzhengstudio.cn/?mode=compatibility" class="download-compatibility">兼容模式<span>适合旧手机、集显电脑和低内存设备</span></a>
```

- [ ] **Step 5: Reconcile historical and current changelog entries**

Run the existing reconciliation script, then add the 0.5.0 entry covering world-first HUD, action feedback, schema v4 save continuity, adaptive native layouts, quality profiles and updater restoration. Do not expose signing secrets or internal certificate paths.

- [ ] **Step 6: Run metadata and download-center tests**

Run: `node --test tests/survival_diary_publish_contract.test.js tests/survival_diary_release.test.js tests/survival_diary_release_v3.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit website release metadata**

```bash
git add website/api/apps website/zhengzhengstudio.cn/api/apps website/api/data/changelogs.json scripts/generate_survival_diary_release_metadata.mjs tests
git commit -m "release(survival-diary): publish 0.5.0 download metadata"
```

### Task 5: Final Release Verification and Evidence

**Files:**
- Modify: `docs/survival-diary/IMPLEMENTATION_LOG.md`
- Create: `docs/survival-diary/screenshots/2026-08-03-download-center-0.5.0.png`
- Create: `release/survival-diary/0.5.0/verification.txt`

**Interfaces:**
- Produces the final trace from gameplay source to signed artifact to visible download-center entry.

- [ ] **Step 1: Run the complete Survival Diary suite**

Run: `node --test tests/survival_diary*.test.js`, Android unit tests, Apple Swift tests, and Harmony fixture/build checks.  
Expected: PASS except a formally recorded external signing blocker for any platform that cannot be signed locally.

- [ ] **Step 2: Verify every available file from the manifest**

For each entry with `available: true`, resolve the local artifact, compare byte size, SHA-256, version/build, package identifier and signature. Store the results in `verification.txt`.

- [ ] **Step 3: Open the real download center and capture evidence**

The screenshot must show the 0.5.0 introduction, platform cards, compatibility entry, version/build and actual download button for every available artifact.

- [ ] **Step 4: Append the final process record**

Record version, build, filenames, hashes, signing state, tests, download-center screenshot and unresolved external requirements in `IMPLEMENTATION_LOG.md`.

- [ ] **Step 5: Commit the release evidence**

```bash
git add docs/survival-diary release/survival-diary/0.5.0/verification.txt
git commit -m "docs(survival-diary): verify 0.5.0 release"
```

