/**
 * Cocos 3.8 原生 2D Graphics 崩溃守卫（仅 native 端安装）。
 *
 * 真机 0.13.16 / BUILD 80 崩溃（HBP-AL00 / Android 16 / arm64）经 libcocos.so
 * 符号化确认：ScriptEngine 同步调用 2D Graphics binding 时，引擎在遍历两个平行
 * vector 并按索引取元素处抛 std::out_of_range: vector → abort → SIGABRT。
 * 触发源是退化路径：极小角度 arc 只生成 0~1 个点、空路径 fill/stroke、
 * 非 finite 或零/负几何，以及 lineWidth <= 0 时的 polyline 生成。
 *
 * 逐个绘制点补防护已证明会漏（0.13.15 / 0.13.16 各补一轮仍崩），因此在原型层
 * 统一接管：只拦截「确定非法」的调用，合法几何原样透传，HUD 视觉不受影响。
 */

import { Graphics, sys } from 'cc';

/**
 * native 运行时判定：不单一依赖 sys.isNative（某些导出配置下它可能未定义）。
 * reflection API 是 Cocos 原生运行时独有的，可作为确定的辅助信号。
 */
export function isNativeRuntime(): boolean {
  const scope = globalThis as unknown as {
    jsb?: { reflection?: unknown };
    native?: { reflection?: unknown };
  };
  return Boolean(sys.isNative || scope.jsb?.reflection || scope.native?.reflection);
}

type AnyFn = (...args: unknown[]) => unknown;
type GraphicsProto = { [key: string]: unknown; __spaceFightGuarded?: boolean };

interface DrawState {
  /** 自上次 clear 以来提交给原生的可绘制几何段数。 */
  segments: number;
  /** 当前子路径点数，用于判断 close() 是否安全。 */
  subpathPoints: number;
}

const MIN_LENGTH = 0.5;
/** 小于该跨度的 arc 在原生端细分不出足够点，描边时必然越界。 */
const MIN_ARC_SPAN = 0.12;
const MIN_LINE_WIDTH = 0.5;

const states = new WeakMap<object, DrawState>();

function stateOf(graphics: object): DrawState {
  let state = states.get(graphics);
  if (!state) {
    state = { segments: 0, subpathPoints: 0 };
    states.set(graphics, state);
  }
  return state;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeLength(value: unknown, fallback = MIN_LENGTH): number {
  const resolved = finite(value, fallback);
  return resolved < MIN_LENGTH ? MIN_LENGTH : resolved;
}

let warnOnce = false;
function warn(api: string, error: unknown): void {
  if (warnOnce) return;
  warnOnce = true;
  console.error(`[SpaceFight graphics guard] ${api} failed`, error);
}

function rawCall(originals: Record<string, AnyFn>, name: string, target: object, args: unknown[]): unknown {
  const fn = originals[name];
  if (!fn) return undefined;
  try {
    return fn.apply(target, args);
  } catch (error) {
    warn(name, error);
    return undefined;
  }
}

export function installNativeGraphicsGuard(): boolean {
  if (!isNativeRuntime()) return false;

  const proto = Graphics.prototype as unknown as GraphicsProto;
  if (!proto || proto.__spaceFightGuarded) return false;

  const names = [
    'clear', 'moveTo', 'lineTo', 'close', 'rect', 'circle', 'roundRect', 'ellipse',
    'arc', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke',
  ] as const;
  const originals: Record<string, AnyFn> = {};
  for (const name of names) {
    const method = proto[name];
    if (typeof method === 'function') originals[name] = method as AnyFn;
  }
  // 没有 clear/fill/stroke 说明引擎 API 变了，宁可不接管也不制造半套守卫。
  if (!originals.clear || !originals.fill || !originals.stroke) {
    console.warn('[SpaceFight graphics guard] unexpected Graphics API; guard skipped');
    return false;
  }

  const define = (name: string, fn: (this: object, ...args: unknown[]) => unknown): void => {
    try {
      Object.defineProperty(proto, name, { configurable: true, writable: true, value: fn });
    } catch (error) {
      warn(`define ${name}`, error);
    }
  };

  define('clear', function (this: object) {
    stateOf(this).segments = 0;
    stateOf(this).subpathPoints = 0;
    return rawCall(originals, 'clear', this, []);
  });

  define('moveTo', function (this: object, x: unknown, y: unknown) {
    const s = stateOf(this);
    s.subpathPoints = 1;
    return rawCall(originals, 'moveTo', this, [finite(x), finite(y)]);
  });

  define('lineTo', function (this: object, x: unknown, y: unknown) {
    const s = stateOf(this);
    s.subpathPoints += 1;
    s.segments += 1;
    return rawCall(originals, 'lineTo', this, [finite(x), finite(y)]);
  });

  define('close', function (this: object) {
    const s = stateOf(this);
    // 点数不足时原生端会把闭合边接到不存在的点上。
    if (s.subpathPoints < 2) return undefined;
    s.segments += 1;
    return rawCall(originals, 'close', this, []);
  });

  define('rect', function (this: object, x: unknown, y: unknown, w: unknown, h: unknown) {
    stateOf(this).segments += 1;
    return rawCall(originals, 'rect', this, [
      finite(x), finite(y), safeLength(w), safeLength(h),
    ]);
  });

  define('circle', function (this: object, x: unknown, y: unknown, r: unknown) {
    stateOf(this).segments += 1;
    return rawCall(originals, 'circle', this, [finite(x), finite(y), safeLength(r)]);
  });

  define('roundRect', function (this: object, x: unknown, y: unknown, w: unknown, h: unknown, r: unknown) {
    const width = safeLength(w);
    const height = safeLength(h);
    const radius = Math.min(safeLength(r, 1), width / 2, height / 2);
    stateOf(this).segments += 1;
    return rawCall(originals, 'roundRect', this, [
      finite(x), finite(y), width, height, Math.max(MIN_LENGTH, radius),
    ]);
  });

  define('ellipse', function (this: object, x: unknown, y: unknown, rx: unknown, ry: unknown) {
    stateOf(this).segments += 1;
    return rawCall(originals, 'ellipse', this, [
      finite(x), finite(y), safeLength(rx), safeLength(ry),
    ]);
  });

  define('arc', function (
    this: object,
    cx: unknown, cy: unknown, r: unknown,
    startAngle: unknown, endAngle: unknown, counterclockwise: unknown,
  ) {
    const start = finite(startAngle);
    const end = finite(endAngle, start);
    const radius = safeLength(r);
    const span = Math.abs(end - start);
    // 返航环 progress≈0 会产生 0 跨度；上一版把它抬成 0.01 弧度，反而生成
    // 只有单个点的病态路径，stroke() 时 vector::at 越界。这里直接不提交几何。
    if (!Number.isFinite(span) || span < MIN_ARC_SPAN) return undefined;
    if (radius < MIN_LENGTH) return undefined;
    const s = stateOf(this);
    s.segments += 1;
    s.subpathPoints += 2;
    return rawCall(originals, 'arc', this, [
      finite(cx), finite(cy), radius, start, end, Boolean(counterclockwise),
    ]);
  });

  define('bezierCurveTo', function (this: object, ...coords: unknown[]) {
    stateOf(this).segments += 1;
    return rawCall(originals, 'bezierCurveTo', this, coords.map((v) => finite(v)));
  });

  define('quadraticCurveTo', function (this: object, ...coords: unknown[]) {
    stateOf(this).segments += 1;
    return rawCall(originals, 'quadraticCurveTo', this, coords.map((v) => finite(v)));
  });

  define('fill', function (this: object) {
    if (stateOf(this).segments <= 0) return undefined;
    return rawCall(originals, 'fill', this, []);
  });

  define('stroke', function (this: object) {
    if (stateOf(this).segments <= 0) return undefined;
    // lineWidth 为 0 / NaN 时原生 polyline 生成器会算出零宽三角形并索引越界。
    try {
      const width = (this as unknown as { lineWidth?: number }).lineWidth;
      if (typeof width !== 'number' || !Number.isFinite(width) || width < MIN_LINE_WIDTH) {
        (this as unknown as { lineWidth: number }).lineWidth = 1;
      }
    } catch (error) {
      warn('lineWidth', error);
    }
    return rawCall(originals, 'stroke', this, []);
  });

  try {
    Object.defineProperty(proto, '__spaceFightGuarded', { configurable: true, value: true });
  } catch {
    // 标记失败不影响守卫本身
  }
  console.info('[SpaceFight graphics guard] installed for native 2D path');
  return true;
}
