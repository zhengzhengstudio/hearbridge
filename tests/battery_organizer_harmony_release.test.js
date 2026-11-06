const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const online = read('HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/pages/Index.ets');
const offline = read('HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/ets/pages/Index.ets');
const onlineApp = read('HarmonyOS-App/BatteryOrganizerHarmony/AppScope/app.json5');
const offlineApp = read('HarmonyOS-App/BatteryOrganizerHarmonyOffline/AppScope/app.json5');
const onlineModule = read('HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/module.json5');
const offlineModule = read('HarmonyOS-App/BatteryOrganizerHarmonyOffline/entry/src/main/module.json5');

const captureDomainFiles = [
  'entry/src/main/ets/models/BatteryCaptureModels.ets',
  'entry/src/main/ets/utils/BatteryQrCodec.ets'
];

const captureServiceFiles = [
  'entry/src/main/ets/services/BatteryScanService.ets',
  'entry/src/main/ets/services/BatteryPhotoService.ets'
];

function methodBody(source, methodName, nextMethodName) {
  const start = source.indexOf(`private ${methodName}`);
  const end = source.indexOf(`private ${nextMethodName}`, start + 1);
  assert.notEqual(start, -1, `${methodName} should exist`);
  assert.notEqual(end, -1, `${nextMethodName} should follow ${methodName}`);
  return source.slice(start, end);
}

test('low-stock filter uses the same strict threshold as the dashboard count', () => {
  for (const [name, source] of [['online', online], ['offline', offline]]) {
    const visible = methodBody(source, 'visibleBatteries()', name === 'online' ? 'request(' : 'refreshCloud()');
    assert.match(visible, /minimumQuantity\s*>\s*0/);
    assert.match(visible, /quantity\s*<\s*item\.minimumQuantity/);
    assert.doesNotMatch(visible, /quantity\s*>\s*item\.minimumQuantity/);
  }
});

test('online sync fetches and merges the latest server snapshot before uploading', () => {
  const replaceCloud = methodBody(online, 'replaceCloud()', 'login(');
  const getIndex = replaceCloud.indexOf('http.RequestMethod.GET');
  const putIndex = replaceCloud.indexOf('http.RequestMethod.PUT');
  assert.ok(getIndex >= 0, 'replaceCloud should fetch remote state');
  assert.ok(putIndex > getIndex, 'replaceCloud should upload only after the fetch callback');
  assert.match(replaceCloud, /mergeBatteries/);
  assert.match(replaceCloud, /mergePresets/);
});

test('online HTTP responses are normalized before JSON parsing callbacks receive them', () => {
  assert.match(online, /private responseText\(/);
  const request = methodBody(online, 'request(', 'refreshCloud()');
  assert.match(request, /done\(this\.responseText\(data\.result\)\)/);
});

test('online and offline releases remain separate native packages for phone tablet and 2in1', () => {
  assert.match(onlineApp, /"bundleName"\s*:\s*"cn\.zhengzhengstudio\.batteryorganizer\.hmos"/);
  assert.match(offlineApp, /"bundleName"\s*:\s*"cn\.zhengzhengstudio\.batteryorganizeronedevice\.hmos"/);
  for (const moduleSource of [onlineModule, offlineModule]) {
    assert.match(moduleSource, /"phone"/);
    assert.match(moduleSource, /"tablet"/);
    assert.match(moduleSource, /"2in1"/);
  }
  assert.doesNotMatch(offlineModule, /ohos\.permission\.INTERNET/);
});

test('displayed versions match package metadata for both editions', () => {
  for (const [source, appConfig] of [[online, onlineApp], [offline, offlineApp]]) {
    const versionName = appConfig.match(/"versionName"\s*:\s*"([^"]+)"/)[1];
    const versionCode = appConfig.match(/"versionCode"\s*:\s*(\d+)/)[1];
    assert.ok(source.includes(`appVersion: string = '${versionName}'`));
    assert.ok(source.includes(`appBuild: string = '${versionCode}'`));
  }
});

test('both editions provide complete dark-mode color resources', () => {
  for (const edition of ['BatteryOrganizerHarmony', 'BatteryOrganizerHarmonyOffline']) {
    const base = JSON.parse(read(`HarmonyOS-App/${edition}/entry/src/main/resources/base/element/color.json`));
    const dark = JSON.parse(read(`HarmonyOS-App/${edition}/entry/src/main/resources/dark/element/color.json`));
    const baseNames = base.color.map((item) => item.name).sort();
    const darkNames = dark.color.map((item) => item.name).sort();
    assert.deepEqual(darkNames, baseNames);
  }
});

test('app_name is declared once per edition and the store icon has no alpha channel', () => {
  for (const edition of ['BatteryOrganizerHarmony', 'BatteryOrganizerHarmonyOffline']) {
    const appStrings = JSON.parse(read(`HarmonyOS-App/${edition}/AppScope/resources/base/element/string.json`));
    const entryStrings = JSON.parse(read(`HarmonyOS-App/${edition}/entry/src/main/resources/base/element/string.json`));
    const declarations = [...appStrings.string, ...entryStrings.string]
      .filter((item) => item.name === 'app_name');
    assert.equal(declarations.length, 1);
  }
  const storeIcon = fs.readFileSync(path.join(root, '电池收纳器app-icon-huawei-solid-1024.png'));
  assert.equal(storeIcon.readUInt8(25), 2, 'AppGallery icon should be RGB without an alpha channel');
});

test('both editions ship the same QR and barcode domain behavior', () => {
  for (const relativePath of captureDomainFiles) {
    const onlinePath = path.join(root, 'HarmonyOS-App/BatteryOrganizerHarmony', relativePath);
    const offlinePath = path.join(root, 'HarmonyOS-App/BatteryOrganizerHarmonyOffline', relativePath);
    assert.ok(fs.existsSync(onlinePath), `online ${relativePath} should exist`);
    assert.ok(fs.existsSync(offlinePath), `offline ${relativePath} should exist`);
    assert.equal(fs.readFileSync(onlinePath, 'utf8'), fs.readFileSync(offlinePath, 'utf8'));
  }
});

test('both editions use native scanning and camera picker services', () => {
  for (const relativePath of captureServiceFiles) {
    const onlinePath = path.join(root, 'HarmonyOS-App/BatteryOrganizerHarmony', relativePath);
    const offlinePath = path.join(root, 'HarmonyOS-App/BatteryOrganizerHarmonyOffline', relativePath);
    assert.ok(fs.existsSync(onlinePath), `online ${relativePath} should exist`);
    assert.ok(fs.existsSync(offlinePath), `offline ${relativePath} should exist`);
    assert.equal(fs.readFileSync(onlinePath, 'utf8'), fs.readFileSync(offlinePath, 'utf8'));
  }

  const scanService = read(`HarmonyOS-App/BatteryOrganizerHarmony/${captureServiceFiles[0]}`);
  const photoService = read(`HarmonyOS-App/BatteryOrganizerHarmony/${captureServiceFiles[1]}`);
  assert.match(scanService, /scanBarcode\.startScanForResult/);
  assert.match(scanService, /scanCore\.ScanType\.QR_CODE/);
  assert.match(scanService, /scanCore\.ScanType\.EAN13_CODE/);
  assert.match(photoService, /cameraPicker\.pick/);
  assert.match(photoService, /context\.filesDir/);
  assert.doesNotMatch(onlineModule, /ohos\.permission\.CAMERA/);
  assert.doesNotMatch(offlineModule, /ohos\.permission\.CAMERA/);
});

test('both native editions expose scan and photo actions in the battery form', () => {
  for (const source of [online, offline]) {
    assert.match(source, /scanBatteryCode/);
    assert.match(source, /takeBatteryPhoto/);
    assert.match(source, /扫商品码/);
    assert.match(source, /扫电池二维码/);
    assert.match(source, /拍摄电池照片/);
    assert.match(source, /barcode: string/);
    assert.match(source, /photoLocalUri: string/);
  }
});

test('online edition downloads authenticated cloud photos while offline edition stays local-only', () => {
  const syncServicePath = 'HarmonyOS-App/BatteryOrganizerHarmony/entry/src/main/ets/services/BatteryPhotoSyncService.ets';
  assert.ok(fs.existsSync(path.join(root, syncServicePath)));
  const syncService = read(syncServicePath);
  assert.match(syncService, /HttpDataType\.ARRAY_BUFFER/);
  assert.match(syncService, /Authorization/);
  assert.match(online, /downloadBatteryPhoto/);
  assert.doesNotMatch(offline, /BatteryPhotoSyncService|downloadBatteryPhoto/);
});
