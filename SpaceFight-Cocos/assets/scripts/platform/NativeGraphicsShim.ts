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
 *   - rect / roundRect / ellipse / 线段 → builtin 白纹理矩形精灵（按 fillColor/strokeColor 着色）
 *   - 填充圆 → builtin 白纹理 + Sprite.FILLED/RADIAL 把方图裁成圆
 *   - 描边圆 / 圆弧 → 沿弧线分段白条拼出平滑圆环
 *   因为不再走 UIModelProxy 的每帧矢量提交路径，崩溃根因一并消除，且 HUD 真正可见。
 *   坐标严格沿用 Cocos Graphics 局部约定：原点在节点位置、+y 向上、rect(x,y,w,h)
 *   以 (x,y) 为左下角。Web / 桌面端仍返回真实 Graphics 组件，视觉完全不变。
 *
 * 约束：repack 链路只换 runtime JS、不重导资源，故本层零新增资源文件。圆形不再走
 * 运行时生成的径向纹理（真机 GPU 对运行时 reset() 出的纹理采样不稳定，会导致圆圈整片
 * 消失、只剩文字），统一复用 builtin 白纹理（引擎托管、采样可靠）。
 */

import {
  Graphics,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  Texture2D,
  Rect,
  Size,
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

type Point = { x: number; y: number };

type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'poly'; pts: Point[]; filled?: boolean };

const shims = new WeakMap<Node, GraphicsShim>();
let announced = false;

/** 共享纹理帧：只用 builtin 白纹理（引擎托管、GPU 上肯定能采样）。 */
let whiteFrame: SpriteFrame | null = null;
let assetsReady = false;

function tryGetBuiltinWhite(): Texture2D | null {
  for (const key of ['white-texture', 'default-texture']) {
    try {
      const tex = builtinResMgr.get(key) as Texture2D | null;
      if (!tex) continue;
      const source = tex as unknown as {
        width?: number; height?: number;
        image?: { width?: number; height?: number };
      };
      // ⚠️ 不能只看 tex.width：builtin 纹理的尺寸可能在初始化早期还是 0，
      // 那时判空会把「本来可用的 builtin 白纹理」误判为不可用，白白退化成运行时纹理。
      const w = source.width || source.image?.width || 0;
      const h = source.height || source.image?.height || 0;
      if (w > 0 && h > 0) return tex;
    } catch {
      /* 该 builtin key 在不同引擎版本可能不同，忽略 */
    }
  }
  return null;
}

/**
 * 用引擎官方 `reset()` 一次性设置 texture / rect / originalSize。
 *
 * 🔴 顺序陷阱（此前真机「按钮没有边框、没有摇杆、满屏杂物」的根因）：
 *   Cocos 的 `SpriteFrame.texture` setter 内部走 `reset({ texture }, true)`，
 *   会把 `_rect` 重置成「纹理尺寸」、`_originalSize` 清零，并**立刻** `_calculateUV()`。
 *   若此刻纹理尺寸还是 0，UV 就按 0×0 区域算 → 精灵退化成不可见，
 *   或被拉成横贯屏幕的色块（正是截图里那条横贯画面的青色横带）。
 *   走 `reset({ texture, rect, originalSize })` 则保证 `_calculateUV()` 在 rect 就位之后才跑。
 */
function frameFromTexture(tex: Texture2D | null): SpriteFrame | null {
  if (!tex) return null;
  try {
    const source = tex as unknown as {
      width?: number; height?: number;
      image?: { width?: number; height?: number };
    };
    const w = Math.max(1, Math.round(source.width || source.image?.width || 0) || 1);
    const h = Math.max(1, Math.round(source.height || source.image?.height || 0) || 1);
    const frame = new SpriteFrame();
    (frame as unknown as {
      reset(info: Record<string, unknown>): void;
    }).reset({
      texture: tex,
      rect: new Rect(0, 0, w, h),
      originalSize: new Size(w, h),
    });
    return frame;
  } catch {
    return null;
  }
}

/** 只准备 builtin 白纹理帧（引擎托管，GPU 上可靠采样）。 */
let whiteFrameReady = false;
let retryScheduled = false;

function ensureAssets(): void {
  if (assetsReady) return;
  assetsReady = true;
  const whiteTex = tryGetBuiltinWhite();
  whiteFrame = frameFromTexture(whiteTex);
  whiteFrameReady = Boolean(whiteFrame);
  if (!whiteFrameReady) {
    // ⚠️ 不再退化到「运行时生成的 1×1 纹理」：那类纹理在 yy 真机上 GPU 采样不到，
    // 结果是所有矢量绘制整片不可见（没有边框、没有摇杆）却毫无提示。
    // 宁可明确报错，也不要静默画不出来。
    console.error('[SpaceFight gfx] builtin 白纹理暂不可用：HUD 矢量绘制静默降级，不会崩；稍后重试');
    // 关键诊断轨迹：崩溃报告里若出现这行，即可确认「白纹理未就绪」这条根因路径。
    nativeTrace('gfx: white frame MISSING - sprite shim degraded (no crash)');
    // 初始化早期 builtin 纹理尺寸可能为 0，下一帧再试一次以恢复 HUD 矢量绘制。
    if (!retryScheduled) {
      retryScheduled = true;
      setTimeout(() => {
        if (whiteFrame) return;
        const tex = tryGetBuiltinWhite();
        whiteFrame = frameFromTexture(tex);
        whiteFrameReady = Boolean(whiteFrame);
        if (whiteFrameReady) {
          nativeTrace('gfx: builtin 白纹理重试就绪，HUD 矢量绘制已恢复');
        } else {
          console.error('[SpaceFight gfx] builtin 白纹理仍不可用：HUD 矢量绘制持续降级');
        }
      }, 250);
    }
  }
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
  let points: Point[] = [];
  let startPoint: Point | null = null;
  let pathStart = 0;

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
    __renderPolygon(pts: Point[], color: Color): void;
    __render(op: Op, color: Color, lw: number, filled: boolean): void;
  };

  shim.__obtain = function (kind: 'white' | 'disc' | 'ring'): Node {
    let n = pool[used];
    if (!n) {
      n = new Node('gfx-sprite');
      node.addChild(n);
      pool[used] = n;
    }
    // 🔴 防御（0.13.30 修复 HBP-AL00 偶发 SIGSEGV 根因）：builtin 白纹理帧不可用时，
    // 绝不挂 Sprite 组件——否则渲染线程会解引用空的 SpriteFrame* → null pointer dereference。
    // 此时该节点只作占位、不可见，HUD 矢量绘制静默降级（ensureAssets 已打错误日志），绝不崩。
    // 若白纹理在稍后（初始化早期尺寸为 0 的情况）就绪，下一次 obtain 会在此补挂 Sprite。
    let sp = shim.__spriteOf(n);
    if (!sp && whiteFrame) {
      n.addComponent(UITransform);
      // 必须与宿主 Graphics 节点同层（UI_2D）：Cocos 的 Node 默认 layer 是 DEFAULT(1<<30)，
      // setParent 不传播 layer，UI 相机 visibility=UI_2D 时默认层精灵对相机隐形。
      n.layer = node.layer;
      sp = n.addComponent(Sprite) as Sprite;
      sp.sizeMode = (Sprite as unknown as { SizeMode: { CUSTOM: number } }).SizeMode.CUSTOM;
      sp.type = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
      (n as unknown as { __sprite: Sprite }).__sprite = sp;
    }
    if (sp && whiteFrame && sp.spriteFrame !== whiteFrame) sp.spriteFrame = whiteFrame;
    n.active = true;
    // 🔴 复位节点角度：池节点会被不同绘制复用。实心圆的扫描线条如果继承了上一帧
    // 分段条（圆环）的角度，就会歪成乱码阶梯 —— 那正是真机截图里「满屏杂物」的成因。
    n.angle = 0;
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

  // 圆盘（实心圆）：用一圈水平白条（SIMPLE 矩形精灵，与已验证可渲染的描边圆环、矩形面板
  // 同一机制）做扫描线填充。彻底不依赖 FILLED-RADIAL / 运行时纹理采样——那一类机制在 yy 的
  // 真机上反复出现过「整片不可见」，而 SIMPLE 白条从第一版起就稳定出图。
  shim.__renderDisc = function (cx: number, cy: number, r: number, color: Color): void {
    const Simple = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
    // 半径取整：条高取整后，每条扫描线的上下边缘都落在整数像素上，
    // 既不会因半像素采样出现横向接缝，也不会因相邻条重叠而叠出横条纹（真机「杂物」之一）。
    const radius = Math.max(2, Math.min(320, Math.round(r)));
    const bars = Math.max(4, Math.min(72, Math.ceil((radius * 2) / 3)));
    const barH = Math.max(1, Math.ceil((radius * 2) / bars));
    for (let i = 0; i < bars; i += 1) {
      const y = -radius + barH * (i + 0.5);
      if (y > radius) break;
      const half = Math.sqrt(Math.max(0, radius * radius - y * y));
      if (half < 0.5) continue;
      const seg = shim.__obtain('white');
      seg.setPosition(cx, cy + y);
      seg.angle = 0; // 扫描线必须水平，不能继承池中残留的分段条角度
      shim.__setSize(seg, half * 2, barH);
      const sp = shim.__spriteOf(seg);
      if (sp) sp.type = Simple;
      shim.__setColor(seg, color);
    }
  };

  // 圆环 / 圆弧：用一圈相切的白条（SIMPLE 矩形精灵）拼出平滑圆环，同样只依赖 builtin 白纹理。
  shim.__renderSegments = function (
    cx: number, cy: number, r: number, start: number, end: number, lw: number, color: Color,
  ): void {
    let s = start;
    let e = end;
    if (e < s) { const t = s; s = e; e = t; }
    const span = e - s;
    if (span < 0.001) return;
    // 分段数封顶：超大半径 + 过密分段会一次性造出成百上千个精灵节点，
    // 真机上既拖帧又容易在池复用时出现错位色块。
    const steps = Math.min(64, Math.max(2, Math.round(span / 0.26)));
    const segLen = (span * r) / steps + lw;
    const Simple = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
    for (let i = 0; i < steps; i += 1) {
      const a = s + (span * (i + 0.5)) / steps;
      const n = shim.__obtain('white');
      n.setPosition(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      shim.__setSize(n, segLen, Math.max(1, lw));
      // 让矩形的长边沿切线方向（径向方向 +90°），短边沿径向 = 圆环厚度。
      n.angle = (a * 180) / Math.PI + 90;
      const sp = shim.__spriteOf(n);
      if (sp) sp.type = Simple;
      shim.__setColor(n, color);
    }
  };

  /**
   * 闭合多边形填充（0.13.30）：扫描线 + 水平白条，与圆盘、圆环同一套 SIMPLE 机制。
   *
   * 🔴 此前 close() 只补一条 line，fill() 时多边形被画成 1px 细条 —— 按钮 / 面板
   * 的切角底色、玻璃质感整片丢失，真机上只剩线框和纯色块，也就是 yy 反复反馈的
   * 「没有边框 / 不好看」。真实 Graphics 的 fill() 会填充闭合路径，这里必须等价实现。
   * 条高按高度自适应并封顶 56 条，避免大面板一次造出上千个精灵节点。
   */
  shim.__renderPolygon = function (pts: Point[], color: Color): void {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    const height = maxY - minY;
    if (height < 1 || maxX - minX < 1) return;
    const step = Math.max(2, height / 56);
    const Simple = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
    for (let y = minY + step / 2; y < maxY; y += step) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x1 = xs[i];
        const x2 = xs[i + 1];
        if (x2 - x1 < 0.5) continue;
        const n = shim.__obtain('white');
        n.setPosition((x1 + x2) / 2, y);
        n.angle = 0;
        shim.__setSize(n, x2 - x1, step + 0.8);
        const sp = shim.__spriteOf(n);
        if (sp) sp.type = Simple;
        shim.__setColor(n, color);
      }
    }
  };

  shim.__render = function (op: Op, color: Color, lw: number, filled: boolean): void {
    const Simple = (Sprite as unknown as { Type: { SIMPLE: number } }).Type.SIMPLE;
    if (op.t === 'poly') {
      if (filled) {
        shim.__renderPolygon(op.pts, color);
      } else {
        // 沿多边形每条边画一条可旋转的白条，闭合边由取模自动补上。
        for (let i = 0; i < op.pts.length; i += 1) {
          const a = op.pts[i];
          const b = op.pts[(i + 1) % op.pts.length];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length < 0.001) continue;
          const n = shim.__obtain('white');
          n.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2);
          n.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          shim.__setSize(n, length + Math.max(1, lw), Math.max(1, lw));
          const sp = shim.__spriteOf(n);
          if (sp) sp.type = Simple;
          shim.__setColor(n, color);
        }
      }
      return;
    }
    if (op.t === 'rect') {
      if (!filled) {
        // 🔴 旧实现把 stroke 的矩形也画成实心块：顶部任务板、按钮内框的
        // 「深色背板 + 细描边」会糊成一整片实心色，层次全丢。改为四条边线。
        const t = Math.max(1, lw);
        const edges: Array<[number, number, number, number]> = [
          [op.x + op.w / 2, op.y, op.w, t],
          [op.x + op.w / 2, op.y + op.h, op.w, t],
          [op.x, op.y + op.h / 2, t, op.h],
          [op.x + op.w, op.y + op.h / 2, t, op.h],
        ];
        for (const [cx, cy, w, h] of edges) {
          const edge = shim.__obtain('white');
          edge.setPosition(cx, cy);
          edge.angle = 0;
          shim.__setSize(edge, w, h);
          const esp = shim.__spriteOf(edge);
          if (esp) esp.type = Simple;
          shim.__setColor(edge, color);
        }
        return;
      }
      const n = shim.__obtain('white');
      n.setPosition(op.x + op.w / 2, op.y + op.h / 2);
      shim.__setSize(n, op.w, op.h);
      n.angle = 0;
      const sp = shim.__spriteOf(n);
      if (sp) sp.type = Simple;
      shim.__setColor(n, color);
      return;
    }
    if (op.t === 'circle') {
      if (filled) {
        // 实心圆：扫描线填充（水平白条），与描边圆环、矩形面板同一渲染机制，绝不出图失败。
        shim.__renderDisc(op.cx, op.cy, op.r, color);
      } else {
        // 整圆描边 = 闭合圆环，用一圈相切白条拼出平滑圆环。
        shim.__renderSegments(op.cx, op.cy, op.r, 0, Math.PI * 2, lw, color);
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
      const sp = shim.__spriteOf(n);
      if (sp) sp.type = Simple;
      shim.__setColor(n, color);
      return;
    }
    if (op.t === 'arc') {
      // 圆弧（含近整圆）统一用分段白条拼，不再依赖径向纹理。
      shim.__renderSegments(op.cx, op.cy, op.r, op.start, op.end, lw, color);
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
    pathStart = pending.length;
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
      // 提交闭合路径本体：fill() 填充、stroke() 描边。旧实现只补一条 line，
      // 会把切角多边形削成 1px 线框，按钮底色 / 面板玻璃层全部丢失。
      // 同一路径此前 push 的 line 由 poly 取代，避免 stroke() 把每条边重复画一遍。
      const poly: Op = { t: 'poly', pts: points.slice() };
      pending.length = Math.min(pathStart, pending.length);
      pending.push(poly);
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
    // 真实 Graphics 的 fill()/stroke() 共用同一批路径，且 fill() 不画开放线条。
    // 这里保留 line / poly 给紧随其后的 stroke()，只消费填充类几何；否则切角按钮
    // 填完底色后描边就丢了，视觉又会退回「纯色块 + 细线」。
    const kept: Op[] = [];
    for (const op of pending) {
      if (op.t === 'line') {
        kept.push(op);
        continue;
      }
      if (op.t === 'poly') {
        if (!op.filled) {
          shim.__render(op, color, 0, true);
          op.filled = true;
        }
        kept.push(op);
        continue;
      }
      shim.__render(op, color, 0, true);
    }
    pending.length = 0;
    for (const op of kept) pending.push(op);
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
    nativeTrace(`gfx: native 2D Graphics -> Sprite shim (UIModelProxy bypass), white frame ${whiteFrameReady ? 'ok' : 'MISSING'}`);
  }
  return shim as unknown as Graphics;
}

/** 与 attachGraphics 配套：native 从 WeakMap 取回同一个替身。 */
export function graphicsOf(node: Node | null | undefined): Graphics | null {
  if (!node) return null;
  if (!isNativeRuntime()) return node.getComponent(Graphics);
  return (shims.get(node) as unknown as Graphics) ?? null;
}

/**
 * 矢量绘制层是否就绪（builtin 白纹理帧是否可用）。
 *
 * 供 HUD 决定要不要挂降级徽标：此前按钮边框 / 摇杆 / 准星在真机上整片隐形，
 * 却没有任何提示，只能靠猜。有了这个开关，下次截图一眼就能区分
 * 「图形层坏了」与「布局错了」。
 */
export function graphicsLayerReady(): boolean {
  return whiteFrameReady;
}
