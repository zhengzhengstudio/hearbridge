/**
 * 设备形态与连续视口适配（2026-11-04）。
 *
 * 目标机型：iPhone 全系（灵动岛/安全区）、Surface Duo 类双屏、常规折叠
 * （内外屏）、阔折叠（近方形外屏）、三折叠（单/双/三屏态）。
 *
 * 这些设备的共同点是「可视宽高比会在不重载页面的情况下突变」——折叠/展开、
 * 跨屏拖拽、铰链遮挡。因此这里全部是**纯函数**：调用方在每次 resize /
 * visualViewport 变化时重新求值，布局按连续量计算，形态标签只作辅助，
 * 绝不把首次 orientation 当成永久状态。
 */

export type DeviceFormFactor =
  | 'phone'
  | 'iphone'
  | 'tablet'
  | 'fold-closed'
  | 'fold-open'
  | 'wide-fold'
  | 'tri-fold-single'
  | 'tri-fold-dual'
  | 'tri-fold-triple'
  | 'dual-screen';

export type AspectClass = 'square' | 'standard' | 'wide' | 'ultrawide' | 'tall';

export interface ViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio?: number;
  readonly touch?: boolean;
  readonly userAgent?: string;
  /** window.getWindowSegments() 的段数；双屏设备 >= 2。 */
  readonly windowSegments?: number;
  /** 铰链/折痕的物理遮挡宽度（CSS px），0 表示无遮挡。 */
  readonly hingeWidth?: number;
}

export interface ViewportLayout {
  readonly formFactor: DeviceFormFactor;
  readonly aspect: number;
  readonly aspectClass: AspectClass;
  readonly portrait: boolean;
  /** launcher 主栅格列数。 */
  readonly columns: 1 | 2 | 3;
  /** HUD 整体缩放，避免近方形屏上控件压住战场。 */
  readonly hudScale: number;
  /** 内容区最大宽度（CSS px），超宽屏上防止文字拉成一行。 */
  readonly contentMaxWidth: number;
  /** 双屏铰链两侧各留出的避让宽度（CSS px）。 */
  readonly seamInset: number;
  /** 近方形/超宽屏下的上下留边比例，交给 CSS letterbox。 */
  readonly letterboxY: number;
  /** 展开态面积变大但 GPU 未变强，建议保守升档。 */
  readonly conservativeUpgrade: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function aspectClassOf(aspect: number): AspectClass {
  if (aspect < 1.16) return 'square';
  if (aspect < 1.62) return 'standard';
  if (aspect < 2.05) return 'wide';
  if (aspect < 2.65) return 'ultrawide';
  return 'tall';
}

/**
 * 形态判定。UA 只用于消歧；折叠态的变化主要靠宽高比连续识别，
 * 因为 UA 在展开/折叠时不会变。
 */
export function resolveDeviceFormFactor(metrics: ViewportMetrics): DeviceFormFactor {
  const width = finite(metrics.width, 1280);
  const height = finite(metrics.height, 720);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const aspect = longEdge / Math.max(1, shortEdge);
  const ua = (metrics.userAgent || '').toLowerCase();
  const segments = metrics.windowSegments ?? 0;
  const hinge = finite(metrics.hingeWidth, 0);

  // 双屏：window.getWindowSegments() 是唯一可靠信号；UA 兜底 Surface Duo。
  if (segments >= 2 || (hinge > 0 && ua.includes('surface duo')) || ua.includes('surface duo')) {
    return 'dual-screen';
  }

  const triFoldHint = ua.includes('mate xt') || ua.includes('trifold') || ua.includes('tri-fold');
  if (triFoldHint) {
    if (aspect < 1.22) return 'tri-fold-dual';
    if (aspect < 1.75) return 'tri-fold-triple';
    return 'tri-fold-single';
  }

  const wideFoldHint = ua.includes('pura x') || ua.includes('wide-fold') || ua.includes('pocket2');
  // 阔折叠外屏接近方形；内屏展开后回到常规宽屏。
  if (wideFoldHint && aspect < 1.3) return 'wide-fold';

  // iPad / 平板：UA 或短边足够大且比例不极端。
  if (ua.includes('ipad') || (ua.includes('macintosh') && metrics.touch)) return 'tablet';
  if (ua.includes('iphone') || ua.includes('ipod')) return 'iphone';

  // 常规折叠外屏：极窄长条（横过来后 aspect 很大）；内屏：接近 4:3。
  if (aspect >= 2.4) return 'fold-closed';
  if (shortEdge >= 700 && aspect >= 1.2 && aspect <= 1.55) return 'fold-open';

  if (shortEdge >= 760 && aspect <= 1.7) return 'tablet';
  return 'phone';
}

/**
 * 把尺寸连续映射成布局参数。所有输出都是纯数值，便于写入 CSS 自定义属性，
 * 也便于原生端换算成设计分辨率下的坐标。
 */
export function resolveViewportLayout(metrics: ViewportMetrics): ViewportLayout {
  const width = finite(metrics.width, 1280);
  const height = finite(metrics.height, 720);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const aspect = longEdge / Math.max(1, shortEdge);
  const portrait = height > width;
  const formFactor = resolveDeviceFormFactor(metrics);
  const aspectClass = aspectClassOf(aspect);

  const columns: 1 | 2 | 3 = shortEdge < 560 ? 1 : shortEdge < 900 ? 2 : 3;
  const hudScale = clamp(0.82 + (shortEdge - 480) / 2600, 0.82, 1.12);
  const contentMaxWidth = clamp(shortEdge * 1.9, 720, 1680);
  const seamInset = formFactor === 'dual-screen'
    ? Math.round(Math.min(96, Math.max(24, finite(metrics.hingeWidth, 34))))
    : 0;
  // 近方形屏把战场上下留一点边，避免 HUD 贴住折痕；超宽屏同理。
  const letterboxY = aspect < 1.18 ? 0.055 : aspect > 2.5 ? 0.035 : 0;
  const conservativeUpgrade = formFactor === 'tri-fold-dual'
    || formFactor === 'tri-fold-triple'
    || formFactor === 'fold-open'
    || formFactor === 'dual-screen';

  return {
    formFactor,
    aspect: Math.round(aspect * 1000) / 1000,
    aspectClass,
    portrait,
    columns,
    hudScale: Math.round(hudScale * 1000) / 1000,
    contentMaxWidth: Math.round(contentMaxWidth),
    seamInset,
    letterboxY,
    conservativeUpgrade,
  };
}

/** 供 launcher 显示的形态短标签（本地化键）。 */
export function formFactorLabelKey(formFactor: DeviceFormFactor): string {
  switch (formFactor) {
    case 'iphone': return 'device.iphone';
    case 'tablet': return 'device.tablet';
    case 'dual-screen': return 'device.dualScreen';
    case 'fold-closed':
    case 'fold-open': return 'device.foldable';
    case 'wide-fold': return 'device.wideFold';
    case 'tri-fold-single':
    case 'tri-fold-dual':
    case 'tri-fold-triple': return 'device.triFold';
    default: return 'device.phone';
  }
}
