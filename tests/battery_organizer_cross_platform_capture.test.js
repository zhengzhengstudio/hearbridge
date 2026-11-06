const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');

test('Apple battery model and form expose barcode, QR and photo capture fields', () => {
  const model = read('电池收纳器/电池收纳器/Models/Battery.swift');
  const form = read('电池收纳器/电池收纳器/Views/Forms/BatteryFormView.swift');

  for (const field of ['barcode', 'photoLocalPath', 'photoRemoteURL', 'photoSyncState']) {
    assert.match(model, new RegExp(`var ${field}:`));
  }
  for (const marker of ['scanProductBarcode', 'scanBatteryQR', 'captureBatteryPhoto']) {
    assert.match(form, new RegExp(marker));
  }
});

test('Android online and offline flavors share native scan and photo capture without WebView', () => {
  const activity = read('BatteryOrganizerAndroid/app/src/main/java/cn/zhengzhengstudio/batteryorganizer/MainActivity.java');
  const manifest = read('BatteryOrganizerAndroid/app/src/main/AndroidManifest.xml');
  const gradle = read('BatteryOrganizerAndroid/app/build.gradle.kts');

  assert.match(activity, /startProductBarcodeScan/);
  assert.match(activity, /startBatteryQrScan/);
  assert.match(activity, /captureBatteryPhoto/);
  assert.match(activity, /photoSyncState/);
  assert.doesNotMatch(activity, /WebView/);
  assert.match(manifest, /FileProvider/);
  assert.match(gradle, /play-services-code-scanner/);
});

test('web battery form provides live scan, QR import and photo capture controls', () => {
  const html = read('website/zhengzhengstudio.cn/battery-organizer/index.html');
  const script = read('website/zhengzhengstudio.cn/battery-organizer/battery-organizer.js');

  for (const id of ['scanBarcodeButton', 'scanBatteryQrButton', 'capturePhotoButton', 'batteryPhotoPreview']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /BarcodeDetector/);
  assert.match(script, /\/api\/battery-organizer\/photos/);
  assert.match(script, /zzbattery:\/\/import/);
});

test('all native clients expose pending active retired lifecycle transitions', () => {
  const appleModel = read('电池收纳器/电池收纳器/Models/Battery.swift');
  const appleStore = read('电池收纳器/电池收纳器/BatteryStore.swift');
  const android = read('BatteryOrganizerAndroid/app/src/main/java/cn/zhengzhengstudio/batteryorganizer/MainActivity.java');
  const harmony = read('HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/Index.ets');
  const harmonyOffline = read('HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/pages/Index.ets');

  assert.match(appleModel, /BatteryLifecycle/);
  assert.match(appleModel, /BatteryUsagePurpose/);
  assert.match(appleStore, /transitionLifecycle/);
  assert.match(android, /LIFECYCLE_PENDING/);
  assert.match(android, /transitionLifecycle/);
  assert.match(android, /usagePurposes/);
  assert.match(harmony, /LIFECYCLE_PENDING/);
  assert.match(harmony, /transitionLifecycle/);
  assert.match(harmony, /usagePurposes/);
  assert.match(harmonyOffline, /LIFECYCLE_RETIRED/);
  assert.match(harmonyOffline, /transitionLifecycle/);
});
