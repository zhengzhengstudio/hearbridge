/**
 * Cocos 3.8 原生 2D Graphics 隔离 + Sprite 渲染层（0.13.19）。
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
 * 规避（0.13.18→0.13.19 演进）：
 *   0.13.18 让 native 端完全不创建真实 Graphics 组件（空替身），绕开了崩溃，
 *   但矢量线条/填充全部不可见。0.13.19 进一步把替身升级为「Sprite 渲染替身」：
 *   所有 HUD 绘制命令（rect / circle / arc / line / fill / stroke）被记录后，
 *   在 fill()/stroke() 时映射成挂在同一个 Node 下的 Sprite 子节点池，
 *   - rect / roundRect / ellipse / 线段 → 白纹理矩形精灵（按 fillColor/strokeColor 着色）
 *   - 填充圆 → 程序化圆盘纹理精灵
 *   - 描边圆 / 整圆弧 → 程序化圆环纹理精灵
 *   - 部分圆弧 → 沿弧线分段矩形精灵
 *   因为不再走 UIModelProxy 的每帧矢量提交路径，崩溃根因一并消除，且 HUD 真正可见。
 *   坐标严格沿用 Cocos Graphics 局部约定：原点在节点位置、+y 向上、rect(x,y,w,h)
 *   以 (x,y) 为左下角。Web / 桌面端仍返回真实 Graphics 组件，视觉完全不变。
 *
 * 约束：repack 链路只换 runtime JS、不重导资源，故本层零新增资源文件，所有纹理
 * 在运行时程序化生成（失败则降级为白方块，绝不回退到会崩溃的真实 Graphics）。
 */

import {
  Graphics,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  Texture2D,
  PixelFormat,
  builtinResMgr,
} from 'cc';
import type { Color } from 'cc';
import { isNativeRuntime } from './NativeGraphicsGuard';
import { nativeTrace } from './NativeDiagnostics';

type Noop = (...args: unknown[]) => unknown;

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

type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number };

const shims = new WeakMap<Node, GraphicsShim>();
let announced = false;

/** 共享纹理帧：白方块 / 圆盘 / 圆环。懒加载，任意一步失败即降级。 */
let whiteFrame: SpriteFrame | null = null;
let discFrame: SpriteFrame | null = null;
let ringFrame: SpriteFrame | null = null;
let assetsReady = false;

const RADIAL_SIZE = 128;

function tryGetBuiltinWhite(): Texture2D | null {
  try {
    const tex = builtinResMgr.get('white-texture') as Texture2D | null;
    if (tex && (tex as unknown as { width?: number }).width) return tex;
  } catch {
    /* 该 builtin key 在不同引擎版本可能不同，忽略 */
  }
  return null;
}

function makeSolidTexture(width: number, height: number, rgba: [number, number, number, number]): Texture2D | null {
  try {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const o = i * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
    const tex = new Texture2D();
    (tex as unknown as { reset(info: Record<string, unknown>): void }).reset({
      width,
      height,
      format: (PixelFormat as unknown as { RGBA8888?: number }).RGBA8888 ?? 13,
      mipmapLevel: 1,
      data: [data],
    });
    return tex;
  } catch {
    return null;
  }
}

function makeRadialTexture(mode: 'disc' | 'ring', ringRatio = 0.18): Texture2D | null {
  try {
    const size = RADIAL_SIZE;
    const data = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    const maxR = size / 2;
    const inner = 1 - ringRatio;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - c;
        const dy = y - c;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
        let a = 0;
        if (mode === 'disc') {
          a = dist <= 1 ? 255 : 0;
        } else {
          a = dist >= inner && dist <= 1 ? 255 : 0;
        }
        const o = (y * size + x) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = a;
      }
    }
    const tex = new Texture2D();
    (tex as unknown as { reset(info: Record<string, unknown>): void }).reset({
      width: size,
      height: size,
      format: (PixelFormat as unknown as { RGBA8888?: number }).RGBA8888 ?? 13,
      mipmapLevel: 1,
      data: [data],
    });
    return tex;
  } catch {
    return null;
  }
}

function frameFromTexture(tex: Texture2D | null): SpriteFrame | null {
  if (!tex) return null;
  try {
    const frame = new SpriteFrame();
    (frame as unknown as { texture: Texture2D }).texture = tex;
    return frame;
  } catch {
    return null;
  }
}

function ensureAssets(): void {
  if (assetsReady) return;
  assetsReady = true;
  const whiteTex = tryGetBuiltinWhite() ?? makeSolidTexture(1, 1, [255, 255, 255, 255]);
  whiteFrame = frameFromTexture(whiteTex);
  discFrame = frameFromTexture(makeRadialTexture('disc'));
  ringFrame = frameFromTexture(makeRadialTexture('ring'));
  // 圆盘/圆环纹理生成失败时降级为白方块：圆会变方，但绝不会崩溃、也不会不可见。
  if (!discFrame) discFrame = whiteFrame;
  if (!ringFrame) ringFrame = whiteFrame;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeLength(value: unknown, fallback = 1): number {
  const resolved = safeNumber(value, fallback);
  return resolved < 1 ? 1 : resolved;
}

function createShim(node: Node): GraphicsShim {
  const pending: Op[] = [];
  const pool: Node[] = [];
  let used = 0;
  let points: Array<{ x: number; y: number }> = [];
  let startPoint: { x: number; y: number } | null = null;

  const shim = {
    node,
    lineWidth: 1,
    fillColor: null as Color | null,
    strokeColor: null as Color | null,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    enabled: true,
  } as GraphicsShim & {
    __spriteOf(n: Node): Sprite | null;
    __obtain(kind: 'white' | 'disc' | 'ring'): Node;
    __setSize(n: Node, w: number, h: number): void;
    __setColor(n: Node, color: Color): void;
    __render(op: Op, color: Color, lw: number, filled: boolean): void;
  };

  shim.__obtain = function (kind: 'white' | 'disc' | 'ring'): Node {
    let n = pool[used];
    if (!n) {
      n = new Node('gfx-sprite');
      n.addComponent(UITransform);
      const sp = n.addComponent(Sprite) as Sprite;
      sp.sizeMode = (Sprite as unknown as { SizeMode: { CUSTOM: number } }).SizeMode.CUSTOM;
      sp.type = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
      (n as unknown as { __sprite: Sprite }).__sprite = sp;
      node.addChild(n);
      pool[used] = n;
    }
    const sp = shim.__spriteOf(n);
    const frame = kind === 'white' ? whiteFrame : kind === 'disc' ? discFrame : ringFrame;
    if (sp && frame && sp.spriteFrame !== frame) sp.spriteFrame = frame;
    n.active = true;
    used += 1;
    return n;
  };

  shim.__spriteOf = function (n: Node): Sprite | null {
    return (n as unknown as { __sprite?: Sprite }).__sprite ?? null;
  };

  shim.__setSize = function (n: Node, w: number, h: number): void {
    const ui = n.getComponent(UITransform);
    if (ui) ui.setContentSize(w, h);
  };

  shim.__setColor = function (n: Node, color: Color): void {
    const sp = shim.__spriteOf(n);
    if (sp) sp.color = color;
  };

  shim.__render = function (op: Op, color: Color, lw: number, filled: boolean): void {
    if (op.t === 'rect') {
      const n = shim.__obtain('white');
      n.setPosition(op.x + op.w / 2, op.y + op.h / 2);
      shim.__setSize(n, op.w, op.h);
      n.angle = 0;
      shim.__setColor(n, color);
      return;
    }
    if (op.t === 'circle') {
      if (filled) {
        const n = shim.__obtain('disc');
        n.setPosition(op.cx, op.cy);
        shim.__setSize(n, op.r * 2, op.r * 2);
        n.angle = 0;
        shim.__setColor(n, color);
      } else {
        const n = shim.__obtain('ring');
        n.setPosition(op.cx, op.cy);
        shim.__setSize(n, op.r * 2, op.r * 2);
        n.angle = 0;
        shim.__setColor(n, color);
      }
      return;
    }
    if (op.t === 'line') {
      const dx = op.x2 - op.x1;
      const dy = op.y2 - op.y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 0.001) return;
      const n = shim.__obtain('white');
      n.setPosition((op.x1 + op.x2) / 2, (op.y1 + op.y2) / 2);
      shim.__setSize(n, length, Math.max(1, lw));
      n.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      shim.__setColor(n, color);
      return;
    }
    if (op.t === 'arc') {
      const span = op.end - op.start;
      if (span >= Math.PI * 2 * 0.98) {
        const n = shim.__obtain('ring');
        n.setPosition(op.cx, op.cy);
        shim.__setSize(n, op.r * 2, op.r * 2);
        n.angle = 0;
        shim.__setColor(n, color);
        return;
      }
      const steps = Math.max(2, Math.round(span / 0.18));
      let px = op.cx + Math.cos(op.start) * op.r;
      let py = op.cy + Math.sin(op.start) * op.r;
      for (let i = 1; i <= steps; i += 1) {
        const a = op.start + (span * i) / steps;
        const nx = op.cx + Math.cos(a) * op.r;
        const ny = op.cy + Math.sin(a) * op.r;
        const seg: Op = { t: 'line', x1: px, y1: py, x2: nx, y2: ny };
        shim.__render(seg, color, lw, filled);
        px = nx;
        py = ny;
      }
      return;
    }
  };

  shim.clear = function (): GraphicsShim {
    for (let i = 0; i < pool.length; i += 1) {
      if (pool[i]) pool[i].active = false;
    }
    used = 0;
    pending.length = 0;
    points = [];
    startPoint = null;
    return shim;
  };

  shim.rect = function (x: unknown, y: unknown, w: unknown, h: unknown): GraphicsShim {
    pending.push({ t: 'rect', x: safeNumber(x), y: safeNumber(y), w: safeLength(w), h: safeLength(h) });
    return shim;
  };
  shim.roundRect = function (x: unknown, y: unknown, w: unknown, h: unknown): GraphicsShim {
    shim.rect(x, y, w, h);
    return shim;
  };
  shim.ellipse = function (x: unknown, y: unknown, rx: unknown, ry: unknown): GraphicsShim {
    pending.push({ t: 'circle', cx: safeNumber(x), cy: safeNumber(y), r: safeLength(Math.max(safeLength(rx), safeLength(ry))) });
    return shim;
  };
  shim.circle = function (cx: unknown, cy: unknown, r: unknown): GraphicsShim {
    pending.push({ t: 'circle', cx: safeNumber(cx), cy: safeNumber(cy), r: safeLength(r) });
    return shim;
  };

  shim.moveTo = function (x: unknown, y: unknown): GraphicsShim {
    const p = { x: safeNumber(x), y: safeNumber(y) };
    points = [p];
    if (!startPoint) startPoint = p;
    return shim;
  };
  shim.lineTo = function (x: unknown, y: unknown): GraphicsShim {
    const p = { x: safeNumber(x), y: safeNumber(y) };
    if (points.length === 0) {
      points.push(p);
      startPoint = p;
    } else {
      const last = points[points.length - 1];
      pending.push({ t: 'line', x1: last.x, y1: last.y, x2: p.x, y2: p.y });
      points.push(p);
    }
    return shim;
  };
  shim.close = function (): GraphicsShim {
    if (startPoint && points.length > 1) {
      const last = points[points.length - 1];
      pending.push({ t: 'line', x1: last.x, y1: last.y, x2: startPoint.x, y2: startPoint.y });
    }
    return shim;
  };
  shim.arc = function (
    cx: unknown, cy: unknown, r: unknown,
    startAngle: unknown, endAngle: unknown,
  ): GraphicsShim {
    const start = safeNumber(startAngle, 0);
    const end = safeNumber(endAngle, start);
    const radius = safeLength(r);
    const span = Math.abs(end - start);
    // 极小跨度不提交几何（与引擎原型层守卫一致），避免病态路径。
    if (!Number.isFinite(span) || span < 0.12) return shim;
    pending.push({ t: 'arc', cx: safeNumber(cx), cy: safeNumber(cy), r: radius, start: Math.min(start, end), end: Math.max(start, end) });
    return shim;
  };
  shim.bezierCurveTo = function (): GraphicsShim {
    return shim;
  };
  shim.quadraticCurveTo = function (): GraphicsShim {
    return shim;
  };

  shim.fill = function (): GraphicsShim {
    if (!shim.enabled) {
      pending.length = 0;
      return shim;
    }
    const color = shim.fillColor;
    if (!color) {
      pending.length = 0;
      return shim;
    }
    for (const op of pending) shim.__render(op, color, 0, true);
    pending.length = 0;
    points = [];
    startPoint = null;
    return shim;
  };
  shim.stroke = function (): GraphicsShim {
    if (!shim.enabled) {
      pending.length = 0;
      return shim;
    }
    const color = shim.strokeColor;
    const lw = Math.max(1, shim.lineWidth || 1);
    if (!color) {
      pending.length = 0;
      return shim;
    }
    for (const op of pending) shim.__render(op, color, lw, false);
    pending.length = 0;
    points = [];
    startPoint = null;
    return shim;
  };

  return shim;
}

/** 统一入口：native 返回 Sprite 渲染替身；其它端返回真实 Graphics 组件。 */
export function attachGraphics(node: Node): Graphics {
  if (!isNativeRuntime()) return node.addComponent(Graphics);
  ensureAssets();
  const shim = createShim(node);
  shims.set(node, shim as unknown as GraphicsShim);
  if (!announced) {
    announced = true;
    nativeTrace('gfx: native 2D Graphics -> Sprite shim (UIModelProxy bypass)');
  }
  return shim as unknown as Graphics;
}

/** 与 attachGraphics 配套：native 从 WeakMap 取回同一个替身。 */
export function graphicsOf(node: Node | null | undefined): Graphics | null {
  if (!node) return null;
  if (!isNativeRuntime()) return node.getComponent(Graphics);
  return (shims.get(node) as unknown as Graphics) ?? null;
}
