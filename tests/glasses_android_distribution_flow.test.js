const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', 'ZhengZhengStudioApp', 'ZhengZhengGlasses');
const activity = fs.readFileSync(path.join(root, 'app/src/main/java/com/zzsys/zhengzhengglasses/NativeMainActivity.java'), 'utf8');
const tryOn = fs.readFileSync(path.join(root, 'app/src/main/java/com/zzsys/zhengzhengglasses/NativeTryOnActivity.java'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');
const storeManifest = fs.readFileSync(path.join(root, 'app/src/store/AndroidManifest.xml'), 'utf8');
const modelPath = path.join(root, 'app/src/main/assets/face_landmarker.task');

test('market builds update through an app market while website builds install verified APKs', () => {
  assert.match(gradle, /STORE_DISTRIBUTION/);
  assert.match(gradle, /create\("website"\)/);
  assert.match(gradle, /create\("store"\)/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(storeManifest, /tools:node="remove"/);
  assert.match(activity, /isAppMarketInstall\(\)/);
  assert.match(activity, /openAppMarket\(\)/);
  assert.match(activity, /market:\/\/details\?id=/);
  assert.match(activity, /downloadAndInstall\(item\)/);
});

test('native fitting entry follows the same five-step order as the website', () => {
  const labels = [
    '第 1 步 · 身份与临时用户',
    '第 2 步 · 多角度采集',
    '第 3 步 · 摄像头试戴',
    '第 4 步 · 报告与导出',
    '第 5 步 · 定制镜框'
  ];
  let previous = -1;
  for (const label of labels) {
    const index = activity.indexOf(label);
    assert.ok(index > previous, `missing or out-of-order workflow label: ${label}`);
    previous = index;
  }
  assert.match(activity, /showCustomizationPage\(\)/);
  assert.match(tryOn, /captureMode/);
  assert.match(tryOn, /overlay\.drawGlasses = !captureMode/);
});

test('native MediaPipe ships a real offline model and exposes recovery UI', () => {
  assert.ok(fs.existsSync(modelPath), 'face landmarker model must be packaged');
  assert.ok(fs.statSync(modelPath).size > 3_000_000, 'model must not be an iCloud placeholder');
  assert.ok(!fs.existsSync(path.join(root, 'app/src/main/assets/.face_landmarker.task.icloud')));
  assert.match(tryOn, /retryFaceLandmarker\(\)/);
  assert.match(tryOn, /模型加载失败/);
});

test('native fitting is a real five-step wizard with isolated responsibilities', () => {
  assert.match(activity, /showFittingStep\(int step\)/);
  assert.match(activity, /addStepHeader\(/);
  assert.match(activity, /stepNavigation\(/);

  const measurementStart = activity.indexOf('private void showMeasurementPage()');
  const measurementEnd = activity.indexOf('private void saveMeasurementInputs(', measurementStart);
  const measurement = activity.slice(measurementStart, measurementEnd);
  assert.doesNotMatch(measurement, /右眼度数|左眼度数|试戴感受|rightDegree|leftDegree/);

  const catalogStart = activity.indexOf('private void showCatalogPage()');
  const catalogEnd = activity.indexOf('private View frameRow(', catalogStart);
  const catalog = activity.slice(catalogStart, catalogEnd);
  assert.match(catalog, /摄像头试戴/);
  assert.doesNotMatch(catalog, /右眼度数|左眼度数|saveOptometryInputs|发送给商家/);
  assert.match(activity, /试戴此款/);

  const reportStart = activity.indexOf('private void showReportPage()');
  const reportEnd = activity.indexOf('private void showCustomizationPage()', reportStart);
  const report = activity.slice(reportStart, reportEnd);
  assert.match(report, /右眼度数/);
  assert.match(report, /左眼度数/);
  assert.match(report, /saveOptometryInputs/);
});
