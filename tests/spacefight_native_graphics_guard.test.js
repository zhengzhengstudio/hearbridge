'use strict';

/**
 * 0.13.17~0.13.18 原生 2D Graphics 守卫回归。
 *
 * 真机 HBP-AL00 / Android 16 的 SIGABRT 经 libcocos.so（BuildId 0683a23b…）符号化：
 * 引擎遍历两个平行 vector 时 vector::at 越界，抛 std::out_of_range: vector。
 * 守卫必须在原型层拦住「退化路径」：极小跨度 arc、空路径 fill/stroke、
 * 非 finite 几何、lineWidth <= 0、点数不足的 close。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', 'SpaceFight-Cocos');
const GUARD_PATH = path.join(ROOT, 'assets', 'scripts', 'platform', 'NativeGraphicsGuard.ts');
const DIAGNOSTICS_PATH = path.join(ROOT, 'assets', 'scripts', 'platform', 'NativeDiagnostics.ts');
const HUD_PATH = path.join(ROOT, 'assets', 'scripts', 'game', 'NativeCombatHud.ts');

const API_NAMES = [
  'clear', 'moveTo', 'lineTo', 'close', 'rect', 'circle', 'roundRect', 'ellipse',
  'arc', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke',
];

/** 把 TS 守卫编译进隔离的 CommonJS 沙箱，用 mock Graphics 记录真正下发给原生的调用。 */
function loadGuard(isNative = true) {
  const source = fs.readFileSync(GUARD_PATH, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;

  const calls = [];
  class MockGraphics {
    constructor() {
      this.lineWidth = 1;
    }
  }
  for (const name of API_NAMES) {
    MockGraphics.prototype[name] = function record(...args) {
      calls.push([name, ...args]);
    };
  }

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id === 'cc') return { Graphics: MockGraphics, sys: { isNative } };
      throw new Error(`unexpected require: ${id}`);
    },
    console: { info() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(js, sandbox, { filename: 'NativeGraphicsGuard.js' });
  return {
    install: sandbox.exports.installNativeGraphicsGuard,
    MockGraphics,
    calls,
  };
}

test('守卫在所有其它 Graphics 绘制之前，由 installNativeErrorHooks 安装', () => {
  const diagnostics = fs.readFileSync(DIAGNOSTICS_PATH, 'utf8');
  assert.match(diagnostics, /import \{ installNativeGraphicsGuard, isNativeRuntime \} from '\.\/NativeGraphicsGuard'/);
  const installIndex = diagnostics.indexOf('installNativeGraphicsGuard()');
  const hookIndex = diagnostics.indexOf('export function installNativeErrorHooks');
  assert.ok(installIndex > hookIndex, '守卫必须是错误钩子安装流程的第一步');

  const boot = fs.readFileSync(path.join(ROOT, 'assets', 'scripts', 'game', 'CombatBootstrap.ts'), 'utf8');
  const hookCall = boot.indexOf('installNativeErrorHooks()');
  const hudCall = boot.indexOf('this.initializeNativeHud(scene)');
  assert.ok(hookCall >= 0 && hudCall > hookCall, '守卫必须先于 HUD 构造安装');
});

test('空路径的 fill / stroke 一律不提交给原生绑定', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.fill();
  g.stroke();
  assert.deepEqual(calls, [['clear']], `空路径仍下发了绘制：${JSON.stringify(calls)}`);
});

test('合法几何原样透传，守卫不破坏正常 HUD 绘制', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.rect(1, 2, 100, 8);
  g.fill();
  assert.deepEqual(calls, [
    ['clear'],
    ['rect', 1, 2, 100, 8],
    ['fill'],
  ]);
});

test('零跨度 / 极小跨度 arc 被丢弃，不会再生成单点病态路径', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2, false);
  g.arc(0, 0, 30, 0, 0.01, false);
  g.stroke();
  assert.deepEqual(calls, [['clear']], `退化圆弧未拦截：${JSON.stringify(calls)}`);
});

test('正常跨度 arc 可以描边', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.arc(0, 0, 30, 0, 1.2, false);
  g.stroke();
  assert.deepEqual(calls.map((c) => c[0]), ['clear', 'arc', 'stroke']);
  // ['arc', cx, cy, radius, start, end, counterclockwise]
  assert.equal(calls[1][4], 0);
  assert.equal(calls[1][5], 1.2);
});

test('非 finite / 零负几何被收敛成有限最小尺寸', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.rect(NaN, Infinity, 0, -20);
  g.circle(NaN, NaN, NaN);
  g.roundRect(0, 0, 10, 10, 999);
  g.fill();
  const rect = calls.find((c) => c[0] === 'rect');
  const circle = calls.find((c) => c[0] === 'circle');
  const roundRect = calls.find((c) => c[0] === 'roundRect');
  for (const call of [rect, circle]) {
    for (const value of call.slice(1)) {
      assert.ok(Number.isFinite(value), `${call[0]} 仍含非有限值：${JSON.stringify(call)}`);
    }
  }
  assert.ok(rect[3] >= 0.5 && rect[4] >= 0.5, '零/负宽高必须抬到最小尺寸');
  assert.ok(circle[3] >= 0.5, '零/负半径必须抬到最小尺寸');
  assert.ok(roundRect[5] <= 5, '圆角半径不得超过宽高一半');
});

test('stroke 前把非法 lineWidth 修正为安全值', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.rect(0, 0, 10, 10);
  g.lineWidth = 0;
  g.stroke();
  assert.equal(g.lineWidth, 1);
  assert.ok(calls.some((c) => c[0] === 'stroke'));
});

test('子路径点数不足时 close 不会下发', () => {
  const { install, MockGraphics, calls } = loadGuard();
  install();
  const g = new MockGraphics();
  g.clear();
  g.moveTo(0, 0);
  g.close();
  assert.ok(!calls.some((c) => c[0] === 'close'), '单点 close 会让原生端接到不存在的点');
});

test('非 native 平台不接管原型', () => {
  const { install, MockGraphics, calls } = loadGuard(false);
  install();
  const g = new MockGraphics();
  g.clear();
  g.fill();
  assert.deepEqual(calls.map((c) => c[0]), ['clear', 'fill']);
});

test('HUD 层同步去掉退化补偿，并默认拒绝未登记的空路径', () => {
  const hud = fs.readFileSync(HUD_PATH, 'utf8');
  assert.doesNotMatch(hud, /end = start \+ 0\.01/, '不得再把零跨度圆弧抬成 0.01 弧度');
  assert.match(hud, /span < 0\.12/, 'safeArc 必须丢弃极小跨度');
  assert.match(hud, /graphicsPathSegments\.get\(graphics\) \?\? 0/, 'safeFill/safeStroke 默认值必须为 0');
  assert.match(
    hud,
    /setContentSize\(this\.width, this\.height\)/,
    'resize 必须用兜底后的尺寸，不能把 NaN/0 直接写进 UITransform',
  );
});
