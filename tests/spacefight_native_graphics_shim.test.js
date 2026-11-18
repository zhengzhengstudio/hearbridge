'use strict';

/**
 * 0.13.19 / BUILD 83 原生 2D Graphics → Sprite 渲染替身回归。
 *
 * 真机 pc 0xa87c4c 符号化 + Cocos 3.8.8 引擎源码交叉验证：
 * UIModelProxy::uploadData() 按 drawInfos.size() 循环却用 subModelList.at(i)
 * 取元素，subModel 数量落后时抛 std::out_of_range → SIGABRT。
 * 与几何参数合法与否无关，因此 native 端必须完全不创建真实 Graphics 组件，
 * 改为把绘制命令映射到挂在同节点下的 Sprite 池（rect/line→白方块、圆→圆盘/
 * 圆环纹理、弧→分段矩形），既绕开崩溃又让 HUD 真正可见。
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

/** 记录 HUD 节点上的 addComponent 调用，判断有没有创建真实 Graphics。 */
function makeNode(name) {
  return new MockNode(name);
}

class MockNode {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.active = true;
    this.angle = 0;
    this.position = { x: 0, y: 0, z: 0 };
    this._comps = {};
  }
  addComponent(type) {
    const c = new type();
    c.node = this;
    this._comps[type.name] = c;
    return c;
  }
  getComponent(type) {
    return this._comps[type.name] || null;
  }
  addChild(child) {
    this.children.push(child);
  }
  setPosition(x, y) {
    this.position = { x, y, z: 0 };
  }
}

class MockGraphics { constructor() { this.__real = true; } }
class MockSprite {
  constructor() { this.spriteFrame = null; this.color = null; this.sizeMode = null; this.type = null; }
}
MockSprite.SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
MockSprite.Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
class MockSpriteFrame { constructor() { this.texture = null; } }
class MockUITransform { setContentSize(w, h) { this.width = w; this.height = h; } }
class MockTexture { reset() {} }

/** 把 TS 隔离层编译进 CommonJS 沙箱，用 mock 节点记录是否真的挂了 Graphics 组件。 */
function loadShim(isNative = true) {
  const js = ts.transpileModule(fs.readFileSync(SHIM_PATH, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;

  const addedToHud = [];
  const traces = [];
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id === 'cc') {
        return {
          Graphics: MockGraphics,
          Node: MockNode,
          Sprite: MockSprite,
          SpriteFrame: MockSpriteFrame,
          UITransform: MockUITransform,
          Texture2D: MockTexture,
          PixelFormat: { RGBA8888: 13 },
          builtinResMgr: { get() { return null; } },
        };
      }
      if (id === './NativeGraphicsGuard') return { isNativeRuntime: () => isNative };
      if (id === './NativeDiagnostics') return { nativeTrace: (stage) => traces.push(stage) };
      throw new Error(`unexpected require: ${id}`);
    },
    console: { info() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(js, sandbox, { filename: 'NativeGraphicsShim.js' });

  const hudNode = makeNode('Hud');
  // 劫持 HUD 节点的 addComponent 记录
  const origAdd = hudNode.addComponent.bind(hudNode);
  hudNode.addComponent = (type) => { addedToHud.push(type); return origAdd(type); };

  return {
    attach: sandbox.exports.attachGraphics,
    graphicsOf: sandbox.exports.graphicsOf,
    addedToHud,
    traces,
    hudNode,
  };
}

test('native 下 attachGraphics 不创建真实 Graphics 组件', () => {
  const { attach, addedToHud, hudNode } = loadShim(true);
  const shim = attach(hudNode);
  assert.equal(addedToHud.length, 0, 'native 端一旦挂真实 Graphics 组件就会回到 UIModelProxy 崩溃路径');
  assert.equal(shim.node, hudNode, '替身必须绑定同一节点，保留 node.active / setSiblingIndex 等操作');
  assert.equal(shim.__real, undefined);
});

test('绘制方法不抛错、属性可读写，且 fill/stroke 会把命令渲染成 Sprite 子节点', () => {
  const { attach, hudNode, addedToHud } = loadShim(true);
  const shim = attach(hudNode);
  shim.fillColor = { r: 1, g: 1, b: 1, a: 255 };
  shim.strokeColor = { r: 2, g: 2, b: 2, a: 255 };
  shim.lineWidth = 3;
  shim.enabled = true;
  for (const name of DRAW_METHODS) {
    assert.equal(typeof shim[name], 'function', `${name} 必须可用`);
    assert.doesNotThrow(() => shim[name](NaN, Infinity, 0, -1), `${name} 不能抛错`);
  }
  // 真正绘制一个矩形并填充，应当产生至少一个 Sprite 子节点（可见），而非空操作。
  shim.clear();
  shim.rect(0, -4, 120, 8);
  shim.fill();
  assert.ok(hudNode.children.length >= 1, '填充矩形必须映射成 Sprite 可见');
  shim.lineWidth = 2;
  shim.clear();
  shim.moveTo(-10, 0);
  shim.lineTo(10, 0);
  shim.stroke();
  assert.ok(hudNode.children.length >= 1, '描边线段必须映射成 Sprite 可见');
  assert.equal(shim.lineWidth, 2);
  assert.equal(shim.enabled, true);
  assert.equal(addedToHud.length, 0, 'native 端不得创建真实 Graphics');
});

test('圆与整圆弧映射成圆盘/圆环精灵；部分弧映射成多个分段精灵', () => {
  const { attach, hudNode } = loadShim(true);
  const shim = attach(hudNode);
  shim.fillColor = { r: 1, g: 1, b: 1, a: 255 };
  shim.strokeColor = { r: 2, g: 2, b: 2, a: 255 };
  const activeSprites = () => hudNode.children.filter((child) => child.active).length;
  // 填充圆
  shim.clear();
  shim.circle(0, 0, 24);
  shim.fill();
  assert.ok(activeSprites() >= 1, '填充圆必须可见');
  // 完整描边圆（→ 圆环由一圈白条拼出）
  shim.clear();
  shim.circle(0, 0, 30);
  shim.stroke();
  assert.ok(activeSprites() >= 2, '完整描边圆必须由多段白条拼出');
  // 部分弧（→ 分段矩形，多个精灵）
  shim.clear();
  shim.arc(0, 0, 40, -Math.PI / 2, Math.PI / 2, false);
  shim.stroke();
  assert.ok(activeSprites() >= 2, '部分弧必须映射成多个分段精灵');
});

test('clear() 会回收上一帧多余的 Sprite 子节点', () => {
  const { attach, hudNode } = loadShim(true);
  const shim = attach(hudNode);
  shim.fillColor = { r: 1, g: 1, b: 1, a: 255 };
  shim.clear();
  shim.rect(0, 0, 10, 10);
  shim.rect(20, 0, 10, 10);
  shim.rect(40, 0, 10, 10);
  shim.fill();
  const grown = hudNode.children.length;
  assert.equal(grown, 3, '三块矩形应产生 3 个精灵');
  // 下一帧只画 1 块，多余的应被隐藏
  shim.clear();
  shim.rect(0, 0, 10, 10);
  shim.fill();
  const visibleAfter = hudNode.children.filter((c) => c.active).length;
  assert.equal(visibleAfter, 1, 'clear 后只应保留当前帧可见的精灵');
});

test('graphicsOf 取回同一个替身，未登记节点返回 null', () => {
  const { attach, graphicsOf, hudNode } = loadShim(true);
  const shim = attach(hudNode);
  assert.equal(graphicsOf(hudNode), shim);
  assert.equal(graphicsOf(null), null);
  assert.equal(graphicsOf(undefined), null);
  assert.equal(graphicsOf(makeNode('Other')), null);
});

test('native 隔离状态写入轨迹，且只播报一次', () => {
  const { attach, hudNode, traces } = loadShim(true);
  attach(hudNode);
  attach(makeNode('B'));
  assert.equal(traces.length, 1);
  assert.match(traces[0], /UIModelProxy bypass/);
});

test('Web / 桌面端仍使用真实 Graphics 组件，视觉不变', () => {
  const { attach, graphicsOf, addedToHud, hudNode, traces } = loadShim(false);
  const graphics = attach(hudNode);
  assert.ok(addedToHud.some((t) => t === MockGraphics), 'Web 端必须创建真实 Graphics');
  assert.equal(graphics.__real, true);
  assert.equal(graphicsOf(hudNode).__real, true);
  assert.equal(traces.length, 0);
});

test('HUD 全部 25 处创建与 4 处获取都走隔离层', () => {
  const hud = fs.readFileSync(HUD_PATH, 'utf8');
  assert.doesNotMatch(hud, /addComponent\(Graphics\)/, '不得残留真实组件创建');
  assert.doesNotMatch(hud, /getComponent\(Graphics\)/, '不得残留真实组件获取');
  assert.match(hud, /import \{[^}]*\battachGraphics\b[^}]*\} from '\.\.\/platform\/NativeGraphicsShim'/);
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

test('引擎根因与 Sprite 渲染规避策略写进代码注释', () => {
  const shim = fs.readFileSync(SHIM_PATH, 'utf8');
  assert.match(shim, /UIModelProxy\.cpp:89/);
  assert.match(shim, /getDynamicRenderDrawInfos/);
  assert.match(shim, /subModelList\.at\(i\)/);
  assert.match(shim, /Sprite 渲染替身/);
});

test('启动轨迹镜像到外部存储，并带 0.5/1.5/3/6 秒存活心跳', () => {
  const activity = fs.readFileSync(ACTIVITY_PATH, 'utf8');
  assert.match(activity, /getExternalFilesDir\(Environment\.DIRECTORY_DOWNLOADS\)/);
  const boot = fs.readFileSync(BOOT_PATH, 'utf8');
  assert.match(boot, /\[0\.5, 1\.5, 3, 6\]/);
  assert.match(boot, /boot: alive \$\{delay\}s/);
});

test('白纹理帧必须用引擎官方 reset() 构造，且不得退化到运行时纹理', () => {
  const shim = fs.readFileSync(SHIM_PATH, 'utf8');
  // SpriteFrame.texture setter 内部会立刻按「当前 rect」重算 UV，手工逐个赋值会让 UV 按
  // 0 尺寸算 → 精灵不可见或被拉成横贯屏幕的色块。必须走 reset({texture, rect, originalSize})。
  assert.match(shim, /\.reset\(\{[\s\S]*?texture: tex[\s\S]*?rect:[\s\S]*?originalSize:/);
  assert.doesNotMatch(shim, /makeSolidTexture/, '不得再退化到运行时生成的纹理（真机 GPU 采样不到）');
  assert.doesNotMatch(shim, /new Texture2D\(\)/, '不得在运行时新建纹理');
  assert.doesNotMatch(shim, /PixelFormat/, '不再需要像素格式常量');
  // 拿不到 builtin 白纹理时必须明确报错，而不是静默画不出来
  assert.match(shim, /builtin 白纹理不可用/);
});

test('池节点复用前必须复位角度，避免扫描线继承上一帧分段条角度', () => {
  const shim = fs.readFileSync(SHIM_PATH, 'utf8');
  const obtain = shim.match(/shim\.__obtain = function[\s\S]*?\n  \};/);
  assert.ok(obtain, '应存在 __obtain');
  assert.match(obtain[0], /n\.angle = 0/, '复用前必须把角度归零');
  const disc = shim.match(/shim\.__renderDisc = function[\s\S]*?\n  \};/);
  assert.ok(disc, '应存在 __renderDisc');
  assert.match(disc[0], /seg\.angle = 0/, '扫描线必须显式水平，不能继承池中残留角度');
});

test('shim 造出的精灵节点必须与宿主 Graphics 节点同层，否则 UI 相机看不见', () => {
  const shim = fs.readFileSync(SHIM_PATH, 'utf8');
  const obtain = shim.match(/shim\.__obtain = function[\s\S]*?\n  \};/);
  assert.ok(obtain, '应存在 __obtain');
  // Cocos 的 Node 默认 layer = DEFAULT(1<<30)，setParent 不传播，Canvas 3.8 也不补偿；
  // UI 相机的 visibility 被设成 Layers.Enum.UI_2D —— 不显式设层，精灵就永远隐形。
  assert.match(
    obtain[0],
    /n\.layer = node\.layer/,
    '精灵节点必须跟随宿主 Graphics 节点的 layer（UI_2D），否则按钮边框/摇杆/圆盘全部不显示',
  );
});
