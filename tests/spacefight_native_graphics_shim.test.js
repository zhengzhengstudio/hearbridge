'use strict';

/**
 * 0.13.18 / BUILD 82 原生 2D Graphics 隔离回归。
 *
 * 真机 pc 0xa87c4c 符号化 + Cocos 3.8.8 引擎源码交叉验证：
 * UIModelProxy::uploadData() 按 drawInfos.size() 循环却用 subModelList.at(i)
 * 取元素，subModel 数量落后时抛 std::out_of_range → SIGABRT。
 * 与几何参数合法与否无关，因此 native 端必须完全不创建真实 Graphics 组件。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', 'SpaceFight-Cocos');
const SHIM_PATH = path.join(ROOT, 'assets', 'scripts', 'platform', 'NativeGraphicsShim.ts');
const GUARD_PATH = path.join(ROOT, 'assets', 'scripts', 'platform', 'NativeGraphicsGuard.ts');
const DIAGNOSTICS_PATH = path.join(ROOT, 'assets', 'scripts', 'platform', 'NativeDiagnostics.ts');
const HUD_PATH = path.join(ROOT, 'assets', 'scripts', 'game', 'NativeCombatHud.ts');
const BOOT_PATH = path.join(ROOT, 'assets', 'scripts', 'game', 'CombatBootstrap.ts');
const ACTIVITY_PATH = path.join(
  ROOT, 'native', 'engine', 'android', 'app', 'src', 'com', 'cocos', 'game', 'AppActivity.java',
);

const DRAW_METHODS = [
  'clear', 'moveTo', 'lineTo', 'close', 'rect', 'circle', 'roundRect', 'ellipse',
  'arc', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke',
];

/** 把 TS 隔离层编译进 CommonJS 沙箱，用 mock 节点记录是否真的挂了组件。 */
function loadShim(isNative = true) {
  const js = ts.transpileModule(fs.readFileSync(SHIM_PATH, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;

  const added = [];
  const traces = [];
  class MockGraphics {
    constructor() {
      this.__real = true;
    }
  }
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id === 'cc') return { Graphics: MockGraphics };
      if (id === './NativeGraphicsGuard') return { isNativeRuntime: () => isNative };
      if (id === './NativeDiagnostics') return { nativeTrace: (stage) => traces.push(stage) };
      throw new Error(`unexpected require: ${id}`);
    },
    console: { info() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(js, sandbox, { filename: 'NativeGraphicsShim.js' });

  const node = (name) => ({
    name,
    addComponent(type) {
      added.push(type);
      return new MockGraphics();
    },
    getComponent() {
      return { __fromGet: true };
    },
  });

  return {
    attach: sandbox.exports.attachGraphics,
    graphicsOf: sandbox.exports.graphicsOf,
    added,
    traces,
    node,
  };
}

test('native 下 attachGraphics 不创建真实 Graphics 组件', () => {
  const { attach, added, node } = loadShim(true);
  const target = node('HullStatusBar');
  const shim = attach(target);
  assert.equal(added.length, 0, 'native 端一旦挂真实 Graphics 组件就会回到 UIModelProxy 崩溃路径');
  assert.equal(shim.node, target, '替身必须绑定同一节点，保留 node.active / setSiblingIndex 等操作');
  assert.equal(shim.__real, undefined);
});

test('替身所有绘制方法都是空实现，属性仍可读写', () => {
  const { attach, node, added } = loadShim(true);
  const shim = attach(node('Reticle'));
  shim.fillColor = { r: 1 };
  shim.strokeColor = { r: 2 };
  shim.lineWidth = 3;
  shim.enabled = false;
  for (const name of DRAW_METHODS) {
    assert.equal(typeof shim[name], 'function', `${name} 必须可用`);
    assert.doesNotThrow(() => shim[name](NaN, Infinity, 0, -1), `${name} 不能抛错`);
  }
  assert.equal(shim.lineWidth, 3);
  assert.equal(shim.enabled, false);
  assert.equal(added.length, 0);
});

test('graphicsOf 取回同一个替身，未登记节点返回 null', () => {
  const { attach, graphicsOf, node } = loadShim(true);
  const target = node('NativeBootShade');
  const shim = attach(target);
  assert.equal(graphicsOf(target), shim);
  assert.equal(graphicsOf(null), null);
  assert.equal(graphicsOf(undefined), null);
  assert.equal(graphicsOf(node('Other')), null);
});

test('native 隔离状态写入轨迹，且只播报一次', () => {
  const { attach, node, traces } = loadShim(true);
  attach(node('A'));
  attach(node('B'));
  assert.equal(traces.length, 1);
  assert.match(traces[0], /UIModelProxy bypass/);
});

test('Web / 桌面端仍使用真实 Graphics 组件，视觉不变', () => {
  const { attach, graphicsOf, added, node, traces } = loadShim(false);
  const target = node('Button');
  const graphics = attach(target);
  assert.equal(added.length, 1);
  assert.equal(graphics.__real, true);
  assert.equal(graphicsOf(target).__fromGet, true);
  assert.equal(traces.length, 0);
});

test('HUD 全部 25 处创建与 4 处获取都走隔离层', () => {
  const hud = fs.readFileSync(HUD_PATH, 'utf8');
  assert.doesNotMatch(hud, /addComponent\(Graphics\)/, '不得残留真实组件创建');
  assert.doesNotMatch(hud, /getComponent\(Graphics\)/, '不得残留真实组件获取');
  assert.match(hud, /import \{ attachGraphics, graphicsOf \} from '\.\.\/platform\/NativeGraphicsShim'/);
  assert.ok((hud.match(/attachGraphics\(/g) || []).length >= 25, '25 处组件创建必须全部走隔离层');
  assert.ok((hud.match(/graphicsOf\(/g) || []).length >= 4, '4 处组件获取必须全部走隔离层');
});

test('native 判定不再单一依赖 sys.isNative', () => {
  const guard = fs.readFileSync(GUARD_PATH, 'utf8');
  assert.match(guard, /export function isNativeRuntime\(\)/);
  assert.match(guard, /scope\.jsb\?\.reflection \|\| scope\.native\?\.reflection/);
  assert.match(guard, /installNativeGraphicsGuard\(\): boolean/, '守卫安装结果必须可观测');
});

test('诊断钩子记录守卫安装状态与 native 判定', () => {
  const diagnostics = fs.readFileSync(DIAGNOSTICS_PATH, 'utf8');
  assert.match(diagnostics, /boot: graphics guard/);
  assert.match(diagnostics, /isNativeRuntime\(\)/);
});

test('引擎根因与规避策略写进代码注释，便于后续版本不再走回头路', () => {
  const shim = fs.readFileSync(SHIM_PATH, 'utf8');
  assert.match(shim, /UIModelProxy\.cpp:89/);
  assert.match(shim, /getDynamicRenderDrawInfos/);
  assert.match(shim, /subModelList\.at\(i\)/);
});

test('启动轨迹镜像到外部存储，并带 0.5/1.5/3/6 秒存活心跳', () => {
  const activity = fs.readFileSync(ACTIVITY_PATH, 'utf8');
  assert.match(activity, /getExternalFilesDir\(Environment\.DIRECTORY_DOWNLOADS\)/);
  const boot = fs.readFileSync(BOOT_PATH, 'utf8');
  assert.match(boot, /\[0\.5, 1\.5, 3, 6\]/);
  assert.match(boot, /boot: alive \$\{delay\}s/);
});
