import { DesktopFlightInput } from './DesktopFlightInput';
import { InputRouter, type InputMode } from './InputRouter';
import type { InputSettings } from './InputSettings';
import { TouchFlightInput, type TouchAction } from './TouchFlightInput';

export type BrowserPointerRole = 'movement' | 'look' | TouchAction;

export interface ControlCircle {
  readonly role: TouchAction | 'movement';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface TouchSafeInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const ZERO_SAFE_INSETS: TouchSafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

export function prefersTouchInput(
  width: number,
  height: number,
  coarsePointer: boolean,
  maxTouchPoints: number,
  finePointer = false,
  explicitMode?: InputMode,
): boolean {
  void width;
  void height;
  void maxTouchPoints;
  if (explicitMode === 'touch') return true;
  if (explicitMode === 'desktop') return false;
  return coarsePointer && !finePointer;
}

function inputModeOverride(documentRef: Document): InputMode | undefined {
  const mode = documentRef.body.dataset.inputModeOverride;
  return mode === 'desktop' || mode === 'touch' ? mode : undefined;
}

export function normalizeSafeInsets(insets?: Partial<TouchSafeInsets>): TouchSafeInsets {
  return {
    left: Math.max(0, insets?.left || 0),
    right: Math.max(0, insets?.right || 0),
    top: Math.max(0, insets?.top || 0),
    bottom: Math.max(0, insets?.bottom || 0),
  };
}

export function safeInsetsFromRect(
  width: number,
  height: number,
  rect?: Partial<{ x: number; y: number; width: number; height: number }> | null,
  fallback: Partial<TouchSafeInsets> = ZERO_SAFE_INSETS,
): TouchSafeInsets {
  if (
    !rect
    || !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
  ) return normalizeSafeInsets(fallback);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const left = Math.max(0, Math.min(safeWidth, rect.x as number));
  const bottom = Math.max(0, Math.min(safeHeight, rect.y as number));
  const rectWidth = Math.max(0, Math.min(safeWidth - left, rect.width as number));
  const rectHeight = Math.max(0, Math.min(safeHeight - bottom, rect.height as number));
  return {
    left,
    right: Math.max(0, safeWidth - left - rectWidth),
    top: Math.max(0, safeHeight - bottom - rectHeight),
    bottom,
  };
}

function normalizedControlScale(value: number): number {
  return Number.isFinite(value) ? Math.max(0.75, Math.min(1.35, value)) : 1;
}

function distanceSquared(x: number, y: number, circle: ControlCircle): number {
  return ((x - circle.x) ** 2) + ((y - circle.y) ** 2);
}

export function touchActionLayout(
  width: number,
  height: number,
  leftHanded = false,
  safeInsets?: Partial<TouchSafeInsets>,
  controlScale = 1,
): readonly ControlCircle[] {
  const safe = normalizeSafeInsets(safeInsets);
  const scale = Math.max(0.65, Math.min(1, width / 960, height / 540));
  const sizedScale = scale * normalizedControlScale(controlScale);
  const actionInset = 76 * sizedScale;
  const secondaryInset = 174 * sizedScale;
  const pauseInset = 136 * sizedScale;
  const actionEdge = leftHanded ? safe.left + actionInset : width - safe.right - actionInset;
  const secondaryEdge = leftHanded ? safe.left + secondaryInset : width - safe.right - secondaryInset;
  const utilityEdge = leftHanded ? safe.left + actionInset : width - safe.right - actionInset;
  const pauseEdge = leftHanded ? safe.left + pauseInset : width - safe.right - pauseInset;
  return [
    { role: 'primaryFire', x: actionEdge, y: height - safe.bottom - actionInset, radius: 50 * sizedScale },
    { role: 'secondaryFire', x: secondaryEdge, y: height - safe.bottom - (82 * sizedScale), radius: 38 * sizedScale },
    // 主副武器互换按钮：放在副武器左侧，避免与右侧主炮 / 加速键重叠
    { role: 'swapWeapons', x: secondaryEdge - (92 * sizedScale), y: height - safe.bottom - (82 * sizedScale), radius: 34 * sizedScale },
    { role: 'boost', x: actionEdge, y: height - safe.bottom - (170 * sizedScale), radius: 40 * sizedScale },
    { role: 'cameraToggle', x: utilityEdge, y: safe.top + (40 * sizedScale), radius: 29 * sizedScale },
    { role: 'pause', x: pauseEdge, y: safe.top + (40 * sizedScale), radius: 29 * sizedScale },
  ];
}

export function movementControlCircle(
  width: number,
  height: number,
  leftHanded = false,
  safeInsets?: Partial<TouchSafeInsets>,
  controlScale = 1,
): ControlCircle {
  const safe = normalizeSafeInsets(safeInsets);
  const scale = Math.max(0.65, Math.min(1, width / 960, height / 540));
  const radius = 78 * scale * normalizedControlScale(controlScale);
  const edgeGap = Math.min(24, height * 0.046);
  return {
    role: 'movement',
    x: leftHanded
      ? width - safe.right - radius - edgeGap
      : safe.left + radius + edgeGap,
    y: height - safe.bottom - radius - edgeGap,
    radius,
  };
}

export function returnControlCircle(
  width: number,
  height: number,
  safeInsets?: Partial<TouchSafeInsets>,
  controlScale = 1,
): ControlCircle {
  const safe = normalizeSafeInsets(safeInsets);
  const scale = Math.max(0.65, Math.min(1, width / 960, height / 540));
  const sizedScale = scale * normalizedControlScale(controlScale);
  return {
    role: 'returnRequested',
    x: width / 2,
    y: height - safe.bottom - (58 * sizedScale),
    radius: 42 * sizedScale,
  };
}

export function pointerRoleAt(
  x: number,
  y: number,
  width: number,
  height: number,
  leftHanded = false,
  safeInsets?: Partial<TouchSafeInsets>,
  controlCircles?: readonly ControlCircle[],
  movementCircle?: ControlCircle,
  controlScale = 1,
): BrowserPointerRole {
  const actions = controlCircles
    || touchActionLayout(width, height, leftHanded, safeInsets, controlScale);
  const matchedAction = actions
    .filter((circle) => distanceSquared(x, y, circle) <= circle.radius ** 2)
    .sort((left, right) => (
      distanceSquared(x, y, left) / (left.radius ** 2)
      - distanceSquared(x, y, right) / (right.radius ** 2)
    ))[0];
  if (matchedAction) return matchedAction.role;
  const movement = movementCircle
    || movementControlCircle(width, height, leftHanded, safeInsets, controlScale);
  const movementHitRadius = movement.radius * 1.12;
  return distanceSquared(x, y, movement) <= movementHitRadius ** 2 ? 'movement' : 'look';
}

export class BrowserInputBridge {
  private readonly roles = new Map<number, BrowserPointerRole>();
  private detachListeners: (() => void) | null = null;
  private explicitMode: InputMode | undefined;

  constructor(
    private readonly router: InputRouter,
    private readonly desktop: DesktopFlightInput,
    private readonly touch: TouchFlightInput,
    private readonly settings: InputSettings,
  ) {}

  attach(
    canvas: HTMLCanvasElement,
    documentRef: Document = document,
    windowRef: Window = window,
  ): () => void {
    this.detach();
    this.desktop.attach(
      canvas,
      documentRef,
      () => documentRef.body.dataset.playing === 'true'
        && documentRef.body.dataset.paused !== 'true'
        && documentRef.body.dataset.orientationBlocked !== 'true',
      () => documentRef.body.dataset.playing === 'true'
        && documentRef.body.dataset.orientationBlocked !== 'true',
    );
    this.explicitMode = inputModeOverride(documentRef);
    const prefersTouch = prefersTouchInput(
      windowRef.innerWidth,
      windowRef.innerHeight,
      windowRef.matchMedia('(pointer: coarse)').matches,
      windowRef.navigator.maxTouchPoints,
      windowRef.matchMedia('(pointer: fine)').matches,
      this.explicitMode,
    );
    this.setMode(prefersTouch ? 'touch' : 'desktop', documentRef);

    let safeInsets = ZERO_SAFE_INSETS;
    let visibleActionLayout: readonly ControlCircle[] | undefined;
    let visibleMovementCircle: ControlCircle | undefined;
    const resize = (): void => {
      const probe = documentRef.getElementById('SafeAreaProbe');
      const styles = probe ? windowRef.getComputedStyle(probe) : null;
      safeInsets = styles ? normalizeSafeInsets({
        left: Number.parseFloat(styles.paddingLeft),
        right: Number.parseFloat(styles.paddingRight),
        top: Number.parseFloat(styles.paddingTop),
        bottom: Number.parseFloat(styles.paddingBottom),
      }) : ZERO_SAFE_INSETS;
      this.touch.resize({
        width: windowRef.innerWidth,
        height: windowRef.innerHeight,
        safeLeft: safeInsets.left,
        safeRight: safeInsets.right,
        safeTop: safeInsets.top,
        safeBottom: safeInsets.bottom,
      });
      const moveStick = documentRef.getElementById('MoveStick');
      if (moveStick) {
        const rect = moveStick.getBoundingClientRect();
        const radius = Math.min(rect.width, rect.height) / 2;
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        if (radius > 0) {
          this.touch.setMovementGeometry(center, radius);
          visibleMovementCircle = { role: 'movement', ...center, radius };
        } else {
          this.touch.setMovementGeometry(center, 0);
          visibleMovementCircle = undefined;
        }
      } else {
        this.touch.setMovementGeometry({ x: 0, y: 0 }, 0);
        visibleMovementCircle = undefined;
      }
      // 修复：补齐控件表以覆盖 TouchAction 全集（含 swapWeapons / advanceRequested 等），
      // 避免默认布局里的相应区域在采用测量布局时被整体丢弃。
      const controls: ReadonlyArray<readonly [string, TouchAction]> = [
        ['PrimaryControl', 'primaryFire'],
        ['SecondaryControl', 'secondaryFire'],
        ['BoostControl', 'boost'],
        ['CameraControl', 'cameraToggle'],
        ['PauseControl', 'pause'],
        ['ReturnControl', 'returnRequested'],
        ['AdvanceControl', 'advanceRequested'],
        ['SwapWeaponsControl', 'swapWeapons'],
      ];
      const measured = controls.flatMap(([id, role]) => {
        const element = documentRef.getElementById(id);
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return [];
        return [{
          role,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          radius: Math.min(rect.width, rect.height) / 2,
        }];
      });
      // 修复：只有全部必需控件都测量成功才采用测量布局；否则回退完整默认布局，
      // 不因某个控件不存在就丢掉默认布局里的其它动作（如 swapWeapons）。
      visibleActionLayout = measured.length === controls.length ? measured : undefined;
    };
    const pointerDown = (event: PointerEvent): void => {
      resize();
      // 修复：模式在 attach 时确定；仅当当前没有任何活动指针时才允许按指针类型切换，
      // 有活动指针时忽略新指针的类型切换，避免多设备混用互相 releaseAll。
      // 运行时读取 body.dataset.inputModeOverride 作为显式覆盖（若存在）。
      const override = inputModeOverride(documentRef);
      const pointerMode = event.pointerType === 'touch' || event.pointerType === 'pen'
        ? 'touch'
        : 'desktop';
      const desiredMode = override || pointerMode;
      if (this.roles.size === 0) {
        this.setMode(desiredMode, documentRef);
      }
      const mode = this.router.currentMode();
      if (mode === 'desktop') {
        return;
      }
      const role = pointerRoleAt(
        event.clientX,
        event.clientY,
        windowRef.innerWidth,
        windowRef.innerHeight,
        this.settings.leftHanded,
        safeInsets,
        visibleActionLayout,
        visibleMovementCircle,
        this.settings.controlScale,
      );
      // 修复：先登记角色，再检查 beginMovement / beginLook 是否被接受；被拒绝时
      // （已有其它指针占用该输入）不写 roles，避免第一指抬起后摇杆/视角失效。
      this.roles.set(event.pointerId, role);
      if (role === 'movement') {
        if (!this.touch.beginMovement(event.pointerId, event.clientX, event.clientY)) {
          this.roles.delete(event.pointerId);
          return;
        }
      } else if (role === 'look') {
        if (!this.touch.beginLook(event.pointerId, event.clientX, event.clientY)) {
          this.roles.delete(event.pointerId);
          return;
        }
      } else {
        this.touch.beginAction(event.pointerId, role);
      }
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch (_) {
        // Synthetic test events are not active pointers; real touches still capture normally.
      }
      event.preventDefault();
    };
    const pointerMove = (event: PointerEvent): void => {
      if (!this.roles.has(event.pointerId)) return;
      this.touch.movePointer(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
    };
    const pointerEnd = (event: PointerEvent): void => {
      if (!this.roles.has(event.pointerId)) return;
      this.roles.delete(event.pointerId);
      this.touch.endPointer(event.pointerId);
      event.preventDefault();
    };
    // 修复：切后台/隐藏/离开页面时对所有活动 pointerId 逐一收尾，
    // 再 releaseAll 并清空角色，避免隐藏时持续开火/加速卡住。
    const clearActivePointers = (): void => {
      for (const pointerId of this.roles.keys()) {
        this.touch.endPointer(pointerId);
      }
      this.roles.clear();
      this.router.releaseAll();
    };
    const blur = (): void => {
      clearActivePointers();
    };
    const onVisibilityChange = (): void => {
      // fake/test 环境下 visibilityState 可能缺失：非明确可见即按隐藏处理。
      if (documentRef.visibilityState !== 'visible') clearActivePointers();
    };
    const onPageHide = (): void => {
      clearActivePointers();
    };

    resize();
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    windowRef.addEventListener('resize', resize);
    windowRef.addEventListener('blur', blur);
    windowRef.addEventListener('pagehide', onPageHide);
    documentRef.addEventListener('visibilitychange', onVisibilityChange);

    this.detachListeners = () => {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('pointercancel', pointerEnd);
      windowRef.removeEventListener('resize', resize);
      windowRef.removeEventListener('blur', blur);
      windowRef.removeEventListener('pagehide', onPageHide);
      documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      this.desktop.detach();
      this.roles.clear();
      this.router.releaseAll();
      this.explicitMode = undefined;
      delete documentRef.body.dataset.inputMode;
    };
    return () => this.detach();
  }

  detach(): void {
    const cleanup = this.detachListeners;
    this.detachListeners = null;
    cleanup?.();
  }

  private setMode(mode: InputMode, documentRef: Document): void {
    this.router.setMode(mode);
    documentRef.body.dataset.inputMode = mode;
  }
}
