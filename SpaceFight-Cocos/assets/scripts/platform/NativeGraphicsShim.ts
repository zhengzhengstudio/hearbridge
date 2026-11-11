/**
 * Cocos 3.8 原生 2D Graphics 隔离层（0.13.18）。
 *
 * 根因（真机 backtrace pc 0xa87c4c 符号化 + Cocos 3.8.8 引擎源码交叉验证）：
 *   native/cocos/2d/renderer/UIModelProxy.cpp:89
 *     const auto& drawInfos = entity->getDynamicRenderDrawInfos();
 *     const auto& subModelList = _model->getSubModels();
 *     for (i = 0; i < drawInfos.size(); i++)
 *         auto* ia = subModelList.at(i)->getInputAssembler();
 *   activeSubModels() 里 `if (drawInfo == nullptr) return;` 会让 subModel 数量
 *   落后于动态 drawInfo；每帧 clear() + 重绘改变路径段数后，at(i) 抛
 *   std::out_of_range → abort → SIGABRT。这与几何参数是否合法无关，所以
 *   0.13.15~17 的逐点防护和原型守卫都没能解决。
 *
 * 规避：native 运行时不再给 HUD 挂真实 Graphics 组件，改为返回绑定到同一
 * Node 的空实现替身。Label / Sprite / UITransform / 按钮 / 布局以及
 * `graphics.node` 操作全部保留，只有矢量线条不绘制。Web 端仍用真实
 * Graphics，视觉完全不变。
 */

import { Graphics } from 'cc';
import type { Color, Node } from 'cc';
import { isNativeRuntime } from './NativeGraphicsGuard';
import { nativeTrace } from './NativeDiagnostics';

type Noop = (...args: unknown[]) => void;

interface GraphicsShim {
  node: Node;
  lineWidth: number;
  fillColor: Color | null;
  strokeColor: Color | null;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  enabled: boolean;
  clear: Noop;
  moveTo: Noop;
  lineTo: Noop;
  close: Noop;
  rect: Noop;
  circle: Noop;
  roundRect: Noop;
  ellipse: Noop;
  arc: Noop;
  bezierCurveTo: Noop;
  quadraticCurveTo: Noop;
  fill: Noop;
  stroke: Noop;
}

const shims = new WeakMap<Node, GraphicsShim>();
let announced = false;

function noop(): void {}

function createShim(node: Node): GraphicsShim {
  return {
    node,
    lineWidth: 1,
    fillColor: null,
    strokeColor: null,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    enabled: true,
    clear: noop,
    moveTo: noop,
    lineTo: noop,
    close: noop,
    rect: noop,
    circle: noop,
    roundRect: noop,
    ellipse: noop,
    arc: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    fill: noop,
    stroke: noop,
  };
}

/** 统一入口：native 返回空实现替身；其它端返回真实 Graphics 组件。 */
export function attachGraphics(node: Node): Graphics {
  if (!isNativeRuntime()) return node.addComponent(Graphics);
  const shim = createShim(node);
  shims.set(node, shim);
  if (!announced) {
    announced = true;
    nativeTrace('gfx: native 2D Graphics isolated (UIModelProxy bypass)');
  }
  return shim as unknown as Graphics;
}

/** 与 attachGraphics 配套：native 从 WeakMap 取回同一个替身。 */
export function graphicsOf(node: Node | null | undefined): Graphics | null {
  if (!node) return null;
  if (!isNativeRuntime()) return node.getComponent(Graphics);
  return (shims.get(node) as unknown as Graphics) ?? null;
}
