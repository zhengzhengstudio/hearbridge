import {
  EventKeyboard,
  EventMouse,
  EventTouch,
  game,
  Game,
  input as cocosInput,
  Input,
  KeyCode,
  sys,
  view,
} from 'cc';
import {
  movementControlCircle,
  pointerRoleAt,
  safeInsetsFromRect,
  type BrowserPointerRole,
  type ControlCircle,
  type TouchSafeInsets,
} from './BrowserInputBridge';
import { DesktopFlightInput } from './DesktopFlightInput';
import { InputRouter, type InputMode } from './InputRouter';
import type { InputSettings } from './InputSettings';
import { TouchFlightInput } from './TouchFlightInput';
import {
  touchStickFeedback,
  type TouchStickFeedbackSnapshot,
  type TouchStickThreshold,
} from './TouchStickFeedback';

export const NATIVE_SAFE_INSETS: TouchSafeInsets = {
  left: 16,
  right: 16,
  top: 8,
  bottom: 8,
};

export interface NativeTouchLayout {
  readonly actions: readonly ControlCircle[];
  readonly movement: ControlCircle;
}

export interface NativeInputFeedback {
  resize(
    width: number,
    height: number,
    safeInsets: TouchSafeInsets,
    leftHanded: boolean,
    controlScale: number,
  ): void;
  setStick(x: number, y: number, active: boolean): void;
  setStickFeedback(snapshot: TouchStickFeedbackSnapshot): void;
  setAction(role: BrowserPointerRole, active: boolean): void;
  touchLayout?(): NativeTouchLayout;
  blocksFlightInput?(): boolean;
  allowsPauseToggle?(): boolean;
}

const KEY_CODES = new Map<number, string>([
  [KeyCode.KEY_W, 'KeyW'],
  [KeyCode.KEY_A, 'KeyA'],
  [KeyCode.KEY_S, 'KeyS'],
  [KeyCode.KEY_D, 'KeyD'],
  [KeyCode.KEY_Q, 'KeyQ'],
  [KeyCode.KEY_E, 'KeyE'],
  [KeyCode.KEY_R, 'KeyR'],
  [KeyCode.ARROW_UP, 'ArrowUp'],
  [KeyCode.ARROW_DOWN, 'ArrowDown'],
  [KeyCode.ARROW_LEFT, 'ArrowLeft'],
  [KeyCode.ARROW_RIGHT, 'ArrowRight'],
  [KeyCode.SHIFT_LEFT, 'ShiftLeft'],
  [KeyCode.CTRL_LEFT, 'ControlLeft'],
  [KeyCode.CTRL_RIGHT, 'ControlRight'],
  [KeyCode.ALT_LEFT, 'AltLeft'],
  [KeyCode.ALT_RIGHT, 'AltRight'],
  [KeyCode.SPACE, 'Space'],
  [KeyCode.F2, 'F2'],
  [KeyCode.ESCAPE, 'Escape'],
]);

export function cocosKeyCodeToDesktopCode(keyCode: number): string | undefined {
  return KEY_CODES.get(keyCode);
}

export class CocosInputBridge {
  private readonly roles = new Map<number, BrowserPointerRole>();
  private readonly heldKeys = new Set<string>();
  private attached = false;
  private mode: InputMode = 'desktop';
  private safeInsets: TouchSafeInsets = NATIVE_SAFE_INSETS;
  private stickThreshold: TouchStickThreshold = 'center';
  private lastStickHapticAt = Number.NEGATIVE_INFINITY;
  private nativeCursorCaptured = false;

  constructor(
    private readonly router: InputRouter,
    private readonly desktop: DesktopFlightInput,
    private readonly touch: TouchFlightInput,
    private readonly settings: InputSettings,
    private feedback?: NativeInputFeedback,
    private readonly emitHaptic?: () => void,
  ) {}

  setFeedback(feedback?: NativeInputFeedback): void {
    this.feedback = feedback;
    this.syncViewport();
    if (this.mode === 'touch') {
      const center = this.touch.movementCenter();
      this.updateStickFeedback(center.x, center.y, false);
    }
  }

  attach(mode: InputMode): void {
    if (this.attached) this.detach();
    this.mode = mode;
    this.router.setMode(mode);
    this.desktop.handlePointerLockChange(false);
    this.setNativeCursorCaptured(false);
    this.syncViewport();

    cocosInput.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    cocosInput.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    cocosInput.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    cocosInput.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    cocosInput.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    cocosInput.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    cocosInput.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    cocosInput.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    cocosInput.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    // 修复：补 view 尺寸/旋转变化与切后台监听，变化时重新 syncViewport 并清理指针状态。
    view.on('design-resolution-changed', this.onViewportChanged, this);
    game.on(Game.EVENT_HIDE, this.onGameHide, this);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    view.off('design-resolution-changed', this.onViewportChanged, this);
    game.off(Game.EVENT_HIDE, this.onGameHide, this);
    cocosInput.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    cocosInput.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    cocosInput.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    cocosInput.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    cocosInput.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    cocosInput.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    cocosInput.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    cocosInput.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    cocosInput.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    this.roles.clear();
    this.heldKeys.clear();
    this.router.releaseAll();
    if (this.mode === 'touch') {
      const center = this.touch.movementCenter();
      this.updateStickFeedback(center.x, center.y, false);
    }
    this.desktop.handlePointerLockChange(false);
    this.setNativeCursorCaptured(false);
    this.attached = false;
  }

  /** 修复：view 尺寸/旋转变化时重新同步视口并清理所有指针，避免坐标错位导致持续输入。 */
  private readonly onViewportChanged = (): void => {
    this.syncViewport();
    this.clearAllPointers();
  };

  /** 修复：切后台时清理所有指针状态并重新同步视口。 */
  private readonly onGameHide = (): void => {
    this.clearAllPointers();
    this.syncViewport();
  };

  /** 统一清理所有活动指针、按键与 HUD 动作高亮。 */
  private clearAllPointers(): void {
    for (const role of new Set(this.roles.values())) {
      if (role !== 'movement' && role !== 'look') this.feedback?.setAction(role, false);
    }
    for (const pointerId of this.roles.keys()) {
      this.touch.endPointer(pointerId);
    }
    this.roles.clear();
    this.heldKeys.clear();
    this.router.releaseAll();
    if (this.mode === 'touch') {
      const center = this.touch.movementCenter();
      this.updateStickFeedback(center.x, center.y, false);
    }
  }

  private readonly onKeyDown = (event: EventKeyboard): void => {
    if (this.mode !== 'desktop') return;
    const code = cocosKeyCodeToDesktopCode(event.keyCode);
    if (!code) return;
    const repeat = this.heldKeys.has(code);
    this.heldKeys.add(code);
    if (this.modifierHeld('Control') && this.modifierHeld('Alt')) {
      this.setNativeCursorCaptured(false);
      this.desktop.handlePointerLockChange(false);
      this.desktop.releaseAll();
      return;
    }
    if (code === 'Escape') {
      if (this.feedback?.allowsPauseToggle?.() === false
        || (!this.feedback?.allowsPauseToggle && this.feedback?.blocksFlightInput?.())) return;
      this.desktop.handleKeyDown({ code, repeat });
      this.releaseNativeCursor();
      return;
    }
    if (this.feedback?.blocksFlightInput?.()) return;
    this.desktop.handleKeyDown({ code, repeat });
  };

  private readonly onKeyUp = (event: EventKeyboard): void => {
    if (this.mode !== 'desktop') return;
    const code = cocosKeyCodeToDesktopCode(event.keyCode);
    if (!code) return;
    this.heldKeys.delete(code);
    this.desktop.handleKeyUp({ code });
  };

  private readonly onMouseMove = (event: EventMouse): void => {
    if (this.mode !== 'desktop' || this.feedback?.blocksFlightInput?.()) return;
    const delta = event.getDelta();
    this.desktop.handleMouseMove({
      movementX: event.movementX || delta.x,
      movementY: event.movementY || -delta.y,
    });
  };

  private readonly onMouseDown = (event: EventMouse): void => {
    if (this.mode !== 'desktop' || this.feedback?.blocksFlightInput?.()) return;
    if (!this.nativeCursorCaptured) {
      this.setNativeCursorCaptured(true);
      this.desktop.handlePointerLockChange(true);
      return;
    }
    this.desktop.handleMouseButton(event.getButton(), true);
  };

  private readonly onMouseUp = (event: EventMouse): void => {
    if (this.mode === 'desktop') this.desktop.handleMouseButton(event.getButton(), false);
  };

  private readonly onTouchStart = (event: EventTouch): void => {
    if (this.mode !== 'touch' || this.feedback?.blocksFlightInput?.()) return;
    this.syncViewport();
    const pointerId = event.getID();
    if (pointerId === null) return;
    const point = this.touchPoint(event);
    const size = view.getVisibleSize();
    const visibleLayout = this.feedback?.touchLayout?.();
    const role = pointerRoleAt(
      point.x,
      point.y,
      size.width,
      size.height,
      this.settings.leftHanded,
      this.safeInsets,
      visibleLayout?.actions,
      visibleLayout?.movement || movementControlCircle(
        size.width,
        size.height,
        this.settings.leftHanded,
        this.safeInsets,
        this.settings.controlScale,
      ),
      this.settings.controlScale,
    );
    this.roles.set(pointerId, role);
    if (role === 'movement') {
      if (!this.touch.beginMovement(pointerId, point.x, point.y)) {
        this.roles.delete(pointerId);
        return;
      }
      this.updateStickFeedback(point.x, point.y, true);
    } else if (role === 'look') {
      this.touch.beginLook(pointerId, point.x, point.y);
    } else {
      this.touch.beginAction(pointerId, role);
      this.feedback?.setAction(role, true);
      if (role === 'primaryFire') this.emitHaptic?.();
    }
  };

  private readonly onTouchMove = (event: EventTouch): void => {
    if (this.mode !== 'touch' || this.feedback?.blocksFlightInput?.()) return;
    const pointerId = event.getID();
    if (pointerId === null || !this.roles.has(pointerId)) return;
    const point = this.touchPoint(event);
    this.touch.movePointer(pointerId, point.x, point.y);
    if (this.roles.get(pointerId) === 'movement') {
      this.updateStickFeedback(point.x, point.y, true);
    }
  };

  private readonly onTouchEnd = (event: EventTouch): void => {
    if (this.mode !== 'touch') return;
    const pointerId = event.getID();
    if (pointerId === null) return;
    const role = this.roles.get(pointerId);
    this.roles.delete(pointerId);
    this.touch.endPointer(pointerId);
    if (role === 'movement') {
      const center = this.touch.movementCenter();
      this.updateStickFeedback(center.x, center.y, false);
    } else if (role && role !== 'look') {
      // 修复：多指同按同一动作时，只有没有其它指针仍持有该 role 才熄灭高亮，
      // 避免任一指抬起就把仍在开火的动作置为 false。
      const stillHeld = [...this.roles.values()].some((held) => held === role);
      if (!stillHeld) this.feedback?.setAction(role, false);
    }
  };

  private syncViewport(): void {
    const size = view.getVisibleSize();
    try {
      this.safeInsets = safeInsetsFromRect(
        size.width,
        size.height,
        sys.getSafeAreaRect(false),
        NATIVE_SAFE_INSETS,
      );
    } catch (_) {
      this.safeInsets = NATIVE_SAFE_INSETS;
    }
    this.touch.resize({
      width: size.width,
      height: size.height,
      safeLeft: this.safeInsets.left,
      safeRight: this.safeInsets.right,
      safeTop: this.safeInsets.top,
      safeBottom: this.safeInsets.bottom,
    });
    this.feedback?.resize(
      size.width,
      size.height,
      this.safeInsets,
      this.settings.leftHanded,
      this.settings.controlScale,
    );
    const visibleMovement = this.feedback?.touchLayout?.().movement;
    if (visibleMovement) {
      this.touch.setMovementGeometry(
        { x: visibleMovement.x, y: visibleMovement.y },
        visibleMovement.radius,
      );
    }
  }

  private updateStickFeedback(x: number, y: number, active: boolean): void {
    const center = this.touch.movementCenter();
    const radius = this.feedback?.touchLayout?.().movement.radius
      || movementControlCircle(
        view.getVisibleSize().width,
        view.getVisibleSize().height,
        this.settings.leftHanded,
        this.safeInsets,
        this.settings.controlScale,
      ).radius;
    const snapshot = touchStickFeedback(
      x - center.x,
      y - center.y,
      radius,
      active,
      this.stickThreshold,
    );
    this.stickThreshold = snapshot.threshold;
    this.feedback?.setStickFeedback(snapshot);

    if (!snapshot.crossedThreshold || (snapshot.threshold !== 'cruise' && snapshot.threshold !== 'full')) {
      return;
    }
    const now = Date.now();
    if (now - this.lastStickHapticAt < 120) return;
    this.lastStickHapticAt = now;
    this.emitHaptic?.();
  }

  private touchPoint(event: EventTouch): { x: number; y: number } {
    const point = event.getUILocation();
    point.y = view.getVisibleSize().height - point.y;
    return point;
  }

  private modifierHeld(prefix: 'Control' | 'Alt'): boolean {
    return this.heldKeys.has(`${prefix}Left`) || this.heldKeys.has(`${prefix}Right`);
  }

  refreshInteractionState(): void {
    if (this.mode === 'desktop' && this.feedback?.blocksFlightInput?.()) {
      this.releaseNativeCursor();
    }
  }

  private releaseNativeCursor(): void {
    this.setNativeCursorCaptured(false);
    this.desktop.handlePointerLockChange(false);
  }

  private setNativeCursorCaptured(captured: boolean): void {
    this.nativeCursorCaptured = captured;
    const nativeGlobal = globalThis as typeof globalThis & {
      jsb?: { setCursorEnabled?: (enabled: boolean) => void };
    };
    try {
      nativeGlobal.jsb?.setCursorEnabled?.(!captured);
    } catch (_) {
      // Mobile builds and test shims may not expose the desktop cursor API.
    }
  }
}
