const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const harmony = fs.readFileSync(path.join(root, 'HarmonyOS-App/ZhengZhengGlassesHarmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
const mac = fs.readFileSync(path.join(root, 'apps/ZhengZhengGlassesMac/Sources/main.swift'), 'utf8');

test('HarmonyOS uses a persistent isolated five-step fitting wizard', () => {
  assert.match(harmony, /@State fittingStep: number = 1/);
  assert.match(harmony, /pref\.putSync\('fittingStep'/);
  assert.match(harmony, /private FitStepHeader\(/);
  assert.match(harmony, /private FitNavigation\(/);
  assert.match(harmony, /if \(this\.fittingStep === 1\)/);
  assert.match(harmony, /else if \(this\.fittingStep === 5\)/);

  const fitStart = harmony.indexOf('private FitPage()');
  const wishStart = harmony.indexOf('private WishPage()', fitStart);
  const fit = harmony.slice(fitStart, wishStart);
  assert.match(fit, /第 1 步 · 身份与临时用户/);
  assert.match(fit, /第 2 步 · 多角度采集/);
  assert.match(fit, /第 3 步 · 摄像头试戴/);
  assert.match(fit, /第 4 步 · 报告与导出/);
  assert.match(fit, /第 5 步 · 定制镜框/);
});

test('macOS uses one current fitting step instead of a five-card overview', () => {
  assert.match(mac, /private var fittingStep = 1/);
  assert.match(mac, /private func buildFitStep\(/);
  assert.match(mac, /private func fitNavigation\(/);
  assert.match(mac, /UserDefaults\.standard\.set\(fittingStep, forKey: "zz_glasses_fitting_step"\)/);
  assert.doesNotMatch(mac, /NSGridView\(views: \[\s*\[stepCell\("1"/);
  assert.match(mac, /第 4 步 · 报告与导出/);
  assert.match(mac, /第 5 步 · 定制镜框/);
});
