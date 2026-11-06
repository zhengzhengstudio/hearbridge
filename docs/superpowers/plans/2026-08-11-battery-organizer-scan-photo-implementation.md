# Battery Organizer Scan and Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native product-barcode scanning, Battery Organizer QR import/export, and one-photo-per-battery capture and synchronization to both HarmonyOS editions.

**Architecture:** Keep pure QR, barcode, and media-state logic in small ArkTS modules shared by convention across the two independent projects. Use HarmonyOS Scan Kit default UI and CameraPicker for device interaction, app-private files for durable local photos, and an authenticated Express router for remote photos and barcode lookup. The online edition queues photo uploads without blocking local saves; the offline edition contains no network media code.

**Tech Stack:** ArkTS/ArkUI, HarmonyOS Scan Kit, CameraPicker, FileIO, Network Kit HTTP multipart upload, Hypium, Node.js `node:test`, Express, Multer memory storage, Sharp, DevEco Studio/Hvigor.

## Global Constraints

- Support HarmonyOS phone, tablet, and 2in1.
- Use native UI only; do not embed web content.
- Support product barcodes and `zzbattery://import?v=1&data=<base64url-json>` QR records.
- Store at most one primary photo per battery in this release.
- The online edition syncs photos after login; the offline edition never accesses the network.
- Scanning, camera cancellation, and network failure must preserve all form input.
- QR imports never accept record IDs, tokens, account data, photo URLs, or tombstones.
- Uploads accept JPEG, PNG, or WebP up to 5 MB and are re-encoded to remove metadata.
- Do not write backend internals into public changelogs.
- Release versions are online `1.1.28` build `1000128` and offline `1.0.12` build `1000012`.

---

### Task 1: Pure QR and Barcode Domain Logic

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/models/BatteryCaptureModels.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/utils/BatteryQrCodec.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/models/BatteryCaptureModels.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/utils/BatteryQrCodec.ets`
- Replace: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/test/LocalUnit.test.ets`
- Replace: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/test/LocalUnit.test.ets`
- Modify: `tests/battery_organizer_harmony_release.test.js`

**Interfaces:**
- Produces: `BatteryQrRecord`, `BatteryPhotoState`, `BarcodePresetMatch`, `encodeBatteryQr(record): string`, `decodeBatteryQr(value): BatteryQrRecord`, `applyBarcodeMatch(form, match): BatteryFormValues`.
- Consumes: no device APIs, network APIs, or UI state.

- [ ] **Step 1: Write failing Hypium tests for QR validation and barcode merge**

```ts
it('rejectsUnsafeQrFields', 0, () => {
  const encoded = encodeBatteryQr({ name: 'CR2032', type: '2032', quantity: 2 })
  const decoded = decodeBatteryQr(encoded)
  expect(decoded.name).assertEqual('CR2032')
  expect(decoded.quantity).assertEqual(2)
  expect(Object.prototype.hasOwnProperty.call(decoded, 'id')).assertFalse()
})

it('barcodeMatchPreservesUserInventoryFields', 0, () => {
  const result = applyBarcodeMatch(
    { name: '', brand: '', type: '5号', quantity: 8, minimumQuantity: 3, location: '书房' },
    { barcode: '690000000001', name: '南孚 5号', brand: '南孚', type: '5号', chemistry: '碱性', capacity: 0, voltage: 1.5 }
  )
  expect(result.quantity).assertEqual(8)
  expect(result.location).assertEqual('书房')
  expect(result.brand).assertEqual('南孚')
})
```

- [ ] **Step 2: Run unit tests and verify RED**

Run from each project:

```bash
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js test --no-daemon
```

Expected: FAIL because `BatteryQrCodec.ets` and exported functions do not exist.

- [ ] **Step 3: Implement typed models and strict QR codec**

```ts
export interface BatteryQrRecord {
  name: string
  brand?: string
  type: string
  chemistry?: string
  capacity?: number
  voltage?: number
  quantity?: number
  minimumQuantity?: number
  location?: string
  status?: string
  notes?: string
  barcode?: string
}

export interface BatteryPhotoState {
  localUri?: string
  remoteId?: string
  remoteUrl?: string
  updatedAt?: string
  syncState?: 'local' | 'pending' | 'synced' | 'failed'
}
```

Implement base64url encoding with `util.Base64Helper`, require scheme `zzbattery`, version `1`, decoded JSON length at most 4096 bytes, strings at most 200 characters except notes at 500, quantity in `1...9999`, minimum in `0...9999`, capacity in `0...100000`, and voltage in `0...1000`. Construct a new object field-by-field so unapproved fields cannot survive decoding.

- [ ] **Step 4: Run both Hypium suites and Node release tests**

Run:

```bash
node --test tests/battery_organizer_harmony_release.test.js
```

Expected: PASS, including a parity assertion that both editions contain byte-identical model and codec source.

- [ ] **Step 5: Commit domain logic**

```bash
git add HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/models \
  HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/utils \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/models \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/utils \
  HarmonyOS-App/BatteryOrganizerHarmony/entry/src/test \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/test \
  tests/battery_organizer_harmony_release.test.js
git commit -m "feat: add battery QR and barcode domain logic"
```

### Task 2: Native Scan and Photo Capture Services

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/services/BatteryScanService.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/services/BatteryPhotoService.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/services/BatteryScanService.ets`
- Create: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/services/BatteryPhotoService.ets`
- Modify: both `entry/src/test/LocalUnit.test.ets`
- Modify: `tests/battery_organizer_harmony_release.test.js`

**Interfaces:**
- Produces: `scanCode(context, mode): Promise<ScanValue | null>`, `capturePhoto(context, stableKey): Promise<string | null>`, `removeLocalPhoto(uri): Promise<void>`.
- Consumes: `BatteryQrCodec`, `common.UIAbilityContext`, `scanBarcode`, `scanCore`, `cameraPicker`, `fileIo`.

- [ ] **Step 1: Add failing source-contract and pure cancellation tests**

```js
test('both editions use system scan and camera pickers without CAMERA permission', () => {
  for (const source of [onlineScan, offlineScan]) {
    assert.match(source, /startScanForResult/)
  }
  for (const source of [onlinePhoto, offlinePhoto]) {
    assert.match(source, /cameraPicker\.pick/)
    assert.match(source, /filesDir/)
  }
  assert.doesNotMatch(onlineModule + offlineModule, /ohos\.permission\.CAMERA/)
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/battery_organizer_harmony_release.test.js`

Expected: FAIL because the service files are missing.

- [ ] **Step 3: Implement Scan Kit wrapper**

Use `scanBarcode.startScanForResult(context, { enableAlbum: true, enableMultiMode: false })`. Return `null` for cancellation error `1000500002`; rethrow other errors with a user-safe message. Product mode accepts EAN/UPC/Code128/GS1 values; record mode accepts only QR values beginning with `zzbattery://`.

- [ ] **Step 4: Implement CameraPicker and durable file copy**

Use `cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], profile)`. Copy the result into `${context.filesDir}/battery-photos/<stableKey>-<timestamp>.jpg` through FileIO, close both descriptors in `finally`, and delete a partially written target after failure. Return `null` when the user cancels.

- [ ] **Step 5: Run tests and build both projects**

Run:

```bash
node --test tests/battery_organizer_harmony_release.test.js
bash scripts/build_battery_organizer_harmony.sh --build-only
```

Expected: tests PASS and both ArkTS release builds succeed.

- [ ] **Step 6: Commit native services**

```bash
git add HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/services \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/services \
  HarmonyOS-App/BatteryOrganizerHarmony/entry/src/test \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/test \
  tests/battery_organizer_harmony_release.test.js
git commit -m "feat: add native battery scan and photo capture"
```

### Task 3: Add and Edit Form Integration

**Files:**
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/Index.ets`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/pages/Index.ets`
- Create: both editions' `entry/src/main/resources/base/media/ic_scan.svg`
- Create: both editions' `entry/src/main/resources/base/media/ic_camera.svg`
- Create: both editions' `entry/src/main/resources/base/media/ic_photo_remove.svg`
- Modify: `tests/battery_organizer_harmony_release.test.js`

**Interfaces:**
- Consumes: Task 1 codec/models and Task 2 scan/photo services.
- Produces: form state fields `formBarcode`, `formPhotoLocalUri`, `formPhotoRemoteId`, `formPhotoRemoteUrl`, `formPhotoUpdatedAt`, `formPhotoSyncState` and handlers `scanProductBarcode`, `scanBatteryQr`, `takeBatteryPhoto`, `removeBatteryPhoto`, `shareBatteryQr`.

- [ ] **Step 1: Write failing UI contract tests**

Assert that both editions render SVG scan/camera controls in `AddForm`, render a photo thumbnail with replace/remove actions, and preserve `formQuantity`, `formMinimum`, and `formLocation` in barcode application handlers.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/battery_organizer_harmony_release.test.js`

Expected: FAIL on missing handlers, media resources, and `Battery` optional fields.

- [ ] **Step 3: Extend the Battery model and normalization**

Add optional `barcode` and photo fields. Normalize missing fields to empty values without rejecting old cache or server records. `resetForm` clears media state; `editBattery` copies it; `saveBattery` writes it without blocking on upload.

- [ ] **Step 4: Add compact quick-action UI**

Implement two 44vp icon buttons under the add/edit heading. Use a menu for product barcode versus Battery QR. Keep icon dimensions at 18vp, button radius at 8vp, and use the current color tokens in light and dark mode. Add accessibility labels for icon-only compact layouts.

- [ ] **Step 5: Add scan confirmation and photo preview**

Product matches populate only descriptive fields. QR imports show a confirmation section and get a new ID only when saved. Photo preview uses `ImageFit.Cover`, 96vp square dimensions, and icon controls for retake/remove.

- [ ] **Step 6: Add QR sharing from battery details**

Use Scan Kit `generateBarcode` to render a QR PixelMap from `encodeBatteryQr`. Exclude photo and internal synchronization fields. Provide the system share action and a local save fallback.

- [ ] **Step 7: Verify UI contracts and release builds**

Run:

```bash
node --test tests/battery_organizer_harmony_release.test.js
node scripts/test_battery_organizer_harmony_theme.js
bash scripts/build_battery_organizer_harmony.sh --build-only
```

Expected: all tests and both builds PASS.

- [ ] **Step 8: Commit form integration**

```bash
git add HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main \
  tests/battery_organizer_harmony_release.test.js
git commit -m "feat: integrate scanning and photos into battery forms"
```

### Task 4: Authenticated Barcode and Photo API

**Files:**
- Create: `website/api/routes/battery_organizer_media.js`
- Create: `website/api/data/battery_barcode_catalog.json`
- Create: `website/api/test/battery_organizer_media.test.js`
- Modify: `website/api/server.js`
- Modify: `website/api/package.json`
- Modify: `website/api/package-lock.json`

**Interfaces:**
- Produces: `createBatteryMediaRouter({ getUser, rootDir, catalogFile })` mounted at `/api/battery-organizer`.
- Endpoints: `GET /barcodes/:code`, `POST /photos`, `GET /photos/:id`, `DELETE /photos/:id`.
- Consumes: passport user resolver and bearer authentication from `server.js`.

- [ ] **Step 1: Write failing API tests**

Use an isolated temporary directory and a fake authenticated user resolver. Test known/unknown barcode lookup, rejected path-like codes, anonymous upload/read/delete rejection, valid JPEG upload, MIME spoof rejection, 5 MB limit, cross-account denial, and owner deletion.

```js
test('photo ownership prevents cross-account reads', async () => {
  const uploaded = await uploadPhoto(app, 'user-a', fixtureJpeg)
  const response = await request(app).get(`/api/battery-organizer/photos/${uploaded.id}`)
    .set('Authorization', tokenFor('user-b'))
  assert.equal(response.status, 404)
})
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `cd website/api && node --test test/battery_organizer_media.test.js`

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement safe media router**

Use Multer memory storage with a 5 MB limit. Detect the real image format, decode and re-encode with Sharp, generate UUID filenames, and store metadata in `uploads/battery-organizer/index.json` through an atomic temporary-file rename. Never expose the filesystem path. Owner mismatch returns 404.

- [ ] **Step 4: Add barcode catalog and route validation**

Seed the catalog with verified entries only; include the existing system presets as type-level fallbacks rather than invented GTIN values. Accept `^[0-9]{6,32}$` and a bounded GS1 character set. Return `{ success: true, preset }` or JSON 404.

- [ ] **Step 5: Mount router and install Sharp**

Mount after `getZzPassUserFromRequest` is defined:

```js
app.use('/api/battery-organizer', createBatteryMediaRouter({
  getUser: getZzPassUserFromRequest,
  rootDir: path.join(UPLOADS_DIR, 'battery-organizer'),
  catalogFile: path.join(__dirname, 'data', 'battery_barcode_catalog.json')
}))
```

- [ ] **Step 6: Run complete API tests**

Run: `cd website/api && npm test`

Expected: all API tests PASS with no files written outside temporary test directories.

- [ ] **Step 7: Commit API**

```bash
git add website/api/routes/battery_organizer_media.js \
  website/api/data/battery_barcode_catalog.json \
  website/api/test/battery_organizer_media.test.js \
  website/api/server.js website/api/package.json website/api/package-lock.json
git commit -m "feat: add battery barcode and photo API"
```

### Task 5: Online Photo Queue and Offline Isolation

**Files:**
- Create: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/services/BatteryPhotoSyncService.ets`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/Index.ets`
- Modify: `HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/pages/Index.ets`
- Modify: `tests/battery_organizer_harmony_release.test.js`

**Interfaces:**
- Produces: `uploadPendingPhoto(token, battery): Promise<PhotoUploadResult>`, `deleteRemotePhoto(token, remoteId): Promise<void>`, `retryPendingPhotos(token, batteries): Promise<Battery[]>`.
- Consumes: API from Task 4 and Task 3 media fields.

- [ ] **Step 1: Write failing synchronization contract tests**

Assert online source uses HTTP multipart `multiFormDataList`, uploads pending photos before publishing their remote fields, retries on login/refresh/start, and never removes local photos after upload failure. Assert offline source and module contain no photo endpoint, multipart upload, INTERNET permission, or remote photo state transition.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/battery_organizer_harmony_release.test.js`

Expected: FAIL because photo synchronization is absent.

- [ ] **Step 3: Implement upload and delete service**

Upload with bearer authorization and `multiFormDataList` file data. Treat 401 as an authentication failure without deleting local state; treat timeout/5xx as retryable; accept only a response with `id`, `url`, and `updatedAt`.

- [ ] **Step 4: Integrate pending queue into lifecycle**

Call `retryPendingPhotos` after cache load, successful login, manual refresh, and network sync completion. Update the local battery immediately on success, persist, then merge and upload the latest cloud snapshot. Use a per-battery in-flight set to prevent duplicate uploads.

- [ ] **Step 5: Implement replacement and deletion cleanup**

Replacing a photo creates a new pending item and schedules old remote deletion only after the new upload succeeds. Deleting a battery removes its local file immediately and queues remote deletion independently from the battery tombstone.

- [ ] **Step 6: Verify tests and build both editions**

Run:

```bash
node --test tests/battery_organizer_harmony_release.test.js
bash scripts/build_battery_organizer_harmony.sh --build-only
```

Expected: PASS and offline HAP contains no INTERNET permission.

- [ ] **Step 7: Commit sync integration**

```bash
git add HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main \
  tests/battery_organizer_harmony_release.test.js
git commit -m "feat: sync battery photos without blocking local saves"
```

### Task 6: Privacy, Versions, Changelog, and Release Metadata

**Files:**
- Modify: `website/zhengzhengstudio.cn/battery-organizer/privacy.html`
- Modify: `website/zhengzhengstudio.cn/battery-organizer/child-privacy.html`
- Modify: both `AppScope/app.json5`
- Modify: both `entry/src/main/ets/pages/Index.ets`
- Modify: `scripts/publish_battery_organizer_harmony_release.mjs`
- Modify: `website/api/data/changelogs.json`
- Modify: `tests/battery_organizer_harmony_release.test.js`

**Interfaces:**
- Produces: release metadata for online `1.1.28/1000128` and offline `1.0.12/1000012`.
- Consumes: completed functionality and signed output names from Tasks 1-5.

- [ ] **Step 1: Write failing release metadata tests**

Assert version display matches app metadata, privacy pages mention barcode/camera/photo/local/cloud/deletion behavior, changelog has one user-facing entry, and the publish script references both new versions.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/battery_organizer_harmony_release.test.js`

Expected: FAIL on old versions and missing privacy copy.

- [ ] **Step 3: Update privacy and child privacy pages**

State that camera and scanning activate only after user action, photos are stored locally, online photos upload only while signed in, single-device photos never upload, and deletion removes the visible item immediately with cloud cleanup retry. Do not claim face recognition, OCR, advertising use, or background camera access.

- [ ] **Step 4: Bump versions and publish metadata**

Set online to `1.1.28` build `1000128`, offline to `1.0.12` build `1000012`, and update the publish script source/output names. Add a changelog entry describing扫码添加、二维码导入、照片留档和离线补传，不描述存储目录或后台路由。

- [ ] **Step 5: Run release tests and HTML checks**

Run:

```bash
node --test tests/battery_organizer_harmony_release.test.js
node scripts/test_battery_organizer_harmony_theme.js
```

Expected: PASS.

- [ ] **Step 6: Commit release metadata**

```bash
git add website/zhengzhengstudio.cn/battery-organizer/privacy.html \
  website/zhengzhengstudio.cn/battery-organizer/child-privacy.html \
  HarmonyOS-App/BatteryOrganizerHarmony/AppScope/app.json5 \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/AppScope/app.json5 \
  HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/Index.ets \
  HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/pages/Index.ets \
  scripts/publish_battery_organizer_harmony_release.mjs \
  website/api/data/changelogs.json tests/battery_organizer_harmony_release.test.js
git commit -m "chore: prepare battery scan and photo releases"
```

### Task 7: Full Verification, Signing, and Local Publication

**Files:**
- Modify only if verification reveals a defect: files owned by Tasks 1-6.
- Generate: `/Users/ljg/Downloads/BatteryOrganizer-HarmonyOS-v1.1.28-signed.hap`
- Generate: `/Users/ljg/Downloads/BatteryOrganizer-HarmonyOS-v1.1.28-signed.app`
- Generate: `/Users/ljg/Downloads/BatteryOrganizer-Offline-HarmonyOS-v1.0.12-signed.hap`
- Generate: `/Users/ljg/Downloads/BatteryOrganizer-Offline-HarmonyOS-v1.0.12-signed.app`

**Interfaces:**
- Consumes: formal profiles already configured for each distinct bundle name.
- Produces: verified store APP files, device HAP files, versioned local backups, and updated local `api/apps` manifests.

- [ ] **Step 1: Run all automated tests**

```bash
node --test tests/battery_organizer_harmony_release.test.js
node scripts/test_battery_organizer_harmony_theme.js
cd website/api && npm test
```

Expected: all PASS.

- [ ] **Step 2: Build both release editions**

Run: `bash scripts/build_battery_organizer_harmony.sh --build-only`

Expected: online and offline APP/HAP build successfully with no duplicate resources or ArkTS errors.

- [ ] **Step 3: Sign and verify all four artifacts**

Use the existing formal online and offline profile configurations. Run `hap-sign-tool verify-app` for both HAPs and APPs; require `verify codesign success` and `Digest verify result: true`.

- [ ] **Step 4: Perform real-device smoke tests**

On phone, tablet, and 2in1 where available, test light/dark mode, product barcode, Battery QR, album scan, cancellation, capture, restart persistence, replacement, deletion, airplane-mode save, reconnection upload, and cross-device photo appearance. Record any unavailable device class explicitly rather than treating it as passed.

- [ ] **Step 5: Publish locally and verify every manifest hash**

Run: `node scripts/publish_battery_organizer_harmony_release.mjs`

Verify versioned and `latest` APP/HAP SHA-256 values across `website/api/apps`, `website/zhengzhengstudio.cn/api/apps`, product manifest, download center manifest, and boardgames compatibility manifests.

- [ ] **Step 6: Final review**

Confirm the AppGallery icon is the 1024x1024 RGB image without alpha, the store upload uses `.app`, no test credentials are present, no photo path appears in logs, and only user-facing changes appear in changelogs.

