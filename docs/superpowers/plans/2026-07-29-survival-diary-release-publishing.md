# Survival Diary Signed Release and Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce every credential-available signed v0.3.0 artifact, publish it atomically to `website/api/apps`, fix download-center metadata, backfill verifiable history, and prepare truthful HarmonyOS/Bilibili assets.

**Architecture:** A canonical release descriptor generates manifest and client-download entries. Platform build/sign scripts fail closed; an atomic publisher verifies identity, signature, size, and SHA-256 before replacing public files and metadata.

**Tech Stack:** Node.js, Gradle/apksigner, Xcode/codesign/notarytool, DevEco/Hvigor signing, JSON, website download API.

## Global Constraints

- Version is `0.3.0`, normalized build is `3`.
- Artifact names start with `SurvivalDiary-`.
- A signed flag is true only after cryptographic verification.
- A store-ready flag is true only when the channel’s required signing/profile/notarization checks pass.
- Website and live-mirror manifests/client downloads/changelogs must agree.
- Historical entries use verified facts only.
- Real-device photos must be real; composites must be labeled.

---

### Task 1: Define One Canonical Release Descriptor

**Files:**
- Create: `release/survival-diary/0.3.0/release.json`
- Create: `scripts/generate_survival_diary_release_metadata.mjs`
- Create: `tests/survival_diary_release_v3.test.js`

**Interfaces:**
- Produces generated app entries for Web, Android Website, Android Play, iOS, macOS, HarmonyOS Online, and HarmonyOS Offline.

- [ ] **Step 1: Write failing metadata tests**

```js
test('every available package has a real file and verified hash', () => {
  for (const app of survivalEntries(manifest)) {
    if (!app.available) continue;
    assert.equal(sha256(path.join(appsDir, app.fileName)), app.sha256);
    assert.ok(app.size > 0);
  }
});
```

- [ ] **Step 2: Create the descriptor**

Each platform record contains `id`, `platform`, `channel`, `variant`, `bundleIdentifier`, `version`, `build`, `platformVersionCode`, `minimumSystem`, `artifact`, `latestArtifact`, `signingRequirement`, `storeRequirement`, and Chinese notes.

- [ ] **Step 3: Implement generator with unavailable states**

When an expected signed file is absent, generate `available: false`, `signed: false`, `storeReady: false`, and no active download URL. Never point at an unsigned artifact under a signed filename.

- [ ] **Step 4: Run and commit**

```bash
node scripts/generate_survival_diary_release_metadata.mjs --check
node --test tests/survival_diary_release_v3.test.js
git add release/survival-diary scripts/generate_survival_diary_release_metadata.mjs tests/survival_diary_release_v3.test.js
git commit -m "feat: define Survival Diary release metadata"
```

### Task 2: Build Credential Preflight and Platform Signing Gates

**Files:**
- Create: `scripts/preflight_survival_diary_signing.sh`
- Create: `scripts/build_survival_diary_android_v3.sh`
- Create: `scripts/build_survival_diary_apple_v3.sh`
- Create: `scripts/build_survival_diary_harmony_v3.sh`
- Create: `Android证书/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Preflight emits `release/survival-diary/0.3.0/signing-status.json` without secret values.

- [ ] **Step 1: Write failing script contracts**

Check that scripts read secrets from Keychain/environment, reject debug/ad-hoc identities for formal channels, verify package IDs and version/build, and never echo passwords.

- [ ] **Step 2: Implement Android gate**

Use the dedicated keystore under `Android证书`, build Website and Play release APK/AAB, run `apksigner verify --verbose --print-certs`, reject `CN=Android Debug`, and record certificate SHA-256.

- [ ] **Step 3: Implement Apple gate**

iOS uses Apple Distribution and the matching provisioning profile. macOS direct build uses Developer ID Application, hardened runtime, notarization, stapling, `codesign --verify --deep --strict`, and `spctl --assess`.

- [ ] **Step 4: Implement Harmony gate**

Load the configured release signing profile without copying its password into source. Build Online/Offline HAP and APP, verify bundle names/versionCode/signature, and record certificate fingerprint.

- [ ] **Step 5: Run preflight**

```bash
scripts/preflight_survival_diary_signing.sh
```

Expected: each platform is `ready` or reports the exact missing certificate/profile/account; no secret appears in output.

- [ ] **Step 6: Commit**

```bash
git add scripts/*survival_diary* Android证书/README.md .gitignore
git commit -m "build: add Survival Diary signing gates"
```

### Task 3: Publish Artifacts Atomically

**Files:**
- Create: `scripts/publish_survival_diary_v3.mjs`
- Modify: `tests/survival_diary_release_v3.test.js`

**Interfaces:**
- `publish({ descriptor, stagingDirectory, appsDirectory })` either replaces the complete verified set or leaves the previous public set unchanged.

- [ ] **Step 1: Write failure-injection tests**

Test bad hash, wrong package identity, wrong signature, truncated copy, and forced rename failure. Every case must preserve old latest/versioned files and metadata.

- [ ] **Step 2: Implement staged verification**

Copy into `website/api/apps/.survival-diary-v3-staging-<pid>`, verify all artifacts, write sidecar hashes, then rename the complete set. Keep a rollback map until metadata generation finishes.

- [ ] **Step 3: Publish credential-available builds**

```bash
scripts/build_survival_diary_android_v3.sh
scripts/build_survival_diary_apple_v3.sh
scripts/build_survival_diary_harmony_v3.sh
node scripts/publish_survival_diary_v3.mjs --descriptor release/survival-diary/0.3.0/release.json
```

Expected: available signed artifacts appear with versioned and latest names; unavailable platforms remain unavailable without fake files.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/survival_diary_release_v3.test.js
git add scripts/publish_survival_diary_v3.mjs website/api/apps/SurvivalDiary-* release/survival-diary/0.3.0
git commit -m "release: stage Survival Diary 0.3.0 artifacts"
```

### Task 4: Fix Manifest, Client Downloads, and Historical Changelogs

**Files:**
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `website/zhengzhengstudio.cn/api/data/changelogs.json`
- Create: `scripts/reconcile_survival_diary_history.mjs`

**Interfaces:**
- Generator updates only Survival Diary entries while preserving unrelated products.

- [ ] **Step 1: Write failing mirror/history tests**

Assert equivalent Survival Diary entry sets in both manifest locations and both client-download locations. Every backfilled history item must cite a verifiable package, old manifest entry, commit, or dated spec in its internal `evidence` field.

- [ ] **Step 2: Reconcile v0.1.0, v0.2.0, and v0.3.0**

Use existing artifacts and commit/spec dates. Do not infer features absent from evidence. Mark v0.2.0 as the final WebView-shell Android release and v0.3.0 as the native transition only when the native artifact exists.

- [ ] **Step 3: Generate all mirrors**

```bash
node scripts/reconcile_survival_diary_history.mjs
node scripts/generate_survival_diary_release_metadata.mjs --write
node --test tests/survival_diary_release_v3.test.js
```

- [ ] **Step 4: Commit**

```bash
git add website/api/apps/*.json website/zhengzhengstudio.cn/api/apps/*.json website/api/data/changelogs.json website/zhengzhengstudio.cn/api/data/changelogs.json scripts/reconcile_survival_diary_history.mjs
git commit -m "fix: publish Survival Diary downloads and history"
```

### Task 5: Verify the Real Download Center

**Files:**
- Modify: `website/zhengzhengstudio.cn/download.html`
- Modify: `website/zhengzhengstudio.cn/js/downloads.js`
- Modify: `website/zhengzhengstudio.cn/css/downloads.css`
- Create: `tests/survival_diary_download_center.test.js`

**Interfaces:**
- Download cards consume generated `client-downloads.json`; they do not embed version data.

- [ ] **Step 1: Write failing card tests**

Verify platform detection, platform switcher, Offline/Online labels, unavailable state, icon, summary, version/build, size, checksum, install route, and no active button for missing artifacts.

- [ ] **Step 2: Implement responsive download cards**

Prefer the current device’s platform but expose all platforms. On mobile, keep one primary action above the fold. Show App Store/AppGallery/Play links for store channels and files only for direct channels.

- [ ] **Step 3: Add the required website changelog entry**

Record the download-center and native-client visibility changes in `website/api/data/changelogs.json` and mirror through the generator.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/survival_diary_download_center.test.js tests/survival_diary_release_v3.test.js
git add website tests/survival_diary_download_center.test.js
git commit -m "feat: show Survival Diary native downloads"
```

### Task 6: Produce Truthful HarmonyOS Store and Bilibili Assets

**Files:**
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store-assets/listing.zh-CN.md`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store-assets/shot-list.md`
- Create: `apps/SurvivalDiary-HarmonyOS-Offline/store-assets/device-photo-shot-list.md`
- Create: `docs/survival-diary-bilibili-demo-script.md`
- Create: `tests/survival_diary_store_assets.test.js`

- [ ] **Step 1: Write asset truthfulness tests**

Check that offline listing contains no friends, Kimi, chat, public islands, tap, or self-update claims; every screenshot filename maps to a captured native screen; composites contain a visible “宣传合成图” marker.

- [ ] **Step 2: Capture native screenshots**

Capture phone/tablet scenes for first guided entry, sunrise, rain collector, snow biome, build placement, and offline diary. Store original-resolution images with device/model/build metadata.

- [ ] **Step 3: Capture real device photos**

Use a physical HarmonyOS device showing the signed offline build. Photograph front, angled hand-held, and tabletop views with readable screen content. If no device is available, keep the shot list and do not create files named or described as real photos.

- [ ] **Step 4: Write store copy and competition script**

The Bilibili sequence is: default A entry → continuous guidance → multi-biome exploration → day/night and rain/snow → craft/place/use → diary → A/B switch preserving save → online friend/island → Harmony tap preview/confirm → native app/download proof.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/survival_diary_store_assets.test.js
git add apps/SurvivalDiary-HarmonyOS-Offline/store-assets docs/survival-diary-bilibili-demo-script.md tests/survival_diary_store_assets.test.js
git commit -m "docs: add Survival Diary store and demo assets"
```

### Task 7: Final Release Verification

**Files:**
- Create: `release/survival-diary/0.3.0/verification-report.json`
- Modify: `tests/survival_diary_release_v3.test.js`

- [ ] **Step 1: Run full automated suites**

```bash
node --test tests/survival_diary_*.test.js
cd website/survival-diary.zhengzhengstudio.cn/server && npm test
cd ../../../apps/SurvivalDiary-Android && ./gradlew test
cd ../SurvivalDiary-Apple && swift test
```

- [ ] **Step 2: Verify every built artifact**

Run platform signature tools, compare package identity/version/build, calculate SHA-256, install over the previous same-signature build where possible, launch, migrate/save, and verify A/B plus world persistence.

- [ ] **Step 3: Verify HTTP delivery**

Fetch manifest/client downloads, then download every available latest and versioned artifact completely. Compare byte count and SHA-256 with the generated record.

- [ ] **Step 4: Send and verify release pushes**

Call the authenticated release notification job with version `0.3.0`, build `3`, and the canonical manifest URL. Verify opted-in Web, Android, iOS/macOS, and HarmonyOS Online test devices receive only version/build, then confirm each client independently re-fetches the manifest. HarmonyOS Offline must receive nothing.

- [ ] **Step 5: Record truthfully blocked platforms**

`verification-report.json` contains per-platform `passed`, `blocked`, or `notBuilt`, the exact verification commands, fingerprints without secrets, and evidence paths. Overall release cannot claim “all-platform formal packages” while any required platform is blocked.

- [ ] **Step 6: Commit**

```bash
git add release/survival-diary/0.3.0/verification-report.json tests/survival_diary_release_v3.test.js
git commit -m "test: verify Survival Diary 0.3.0 release"
```
