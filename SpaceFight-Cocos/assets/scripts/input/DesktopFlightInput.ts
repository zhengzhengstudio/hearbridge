import {
  FlightCommand,
  neutralFlightCommand,
  normalizeFlightCommand,
} from '../core/FlightCommand';
import {
  boundKeySet,
  isActionPressed,
  type GameAction,
  type KeyBindings,
} from './KeyBindings';
import { InputSettings, normalizeInputSettings } from './InputSettings';

export interface DesktopKeyEvent {
  code: string;
  isComposing?: boolean;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export interface DesktopMouseMoveEvent {
  movementX: number;
  movementY: number;
}

type DesktopDocument = Pick<Document,
  'addEventListener' | 'removeEventListener' | 'pointerLockElement' | 'exitPointerLock'>;
type DesktopCanvas = Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'requestPointerLock'>;
type PointerCaptureGuard = () => boolean;

const LOOK_PIXELS_FOR_FULL_AXIS = 52;

export function neutralInputCommand(): FlightCommand {
  return neutralFlightCommand();
}

export class DesktopFlightInput {
  private readonly settings: InputSettings;
  private readonly bindings: KeyBindings;
  /** 只接受当前绑定里的键，改键后立刻生效，未绑定的键不再抢输入。 */
  private readonly gameplayKeys: Set<string>;
  private readonly keys = new Set<string>();
  private pointerLocked = false;
  private mouseX = 0;
  private mouseY = 0;
  private primaryFire = false;
  private secondaryFire = false;
  private cameraTogglePending = false;
  private pausePending = false;
  private returnPending = false;
  /**
   * 当前战斗阶段快照。仅用于让"空格"在决策阶段兼作"继续深入"，
   * 平时保持射击手感不变。由 GameLoop 每帧同步。
   */
  private snapshotPhase: string | null = null;
  private detachListeners: (() => void) | null = null;

  /** 同步战斗阶段，让输入层知道当前是否处于决策窗口。 */
  setSnapshotPhase(phase: string | null): void {
    this.snapshotPhase = phase || null;
  }

  constructor(settings?: Partial<InputSettings>) {
    this.settings = normalizeInputSettings(settings);
    this.bindings = this.settings.keyBindings;
    this.gameplayKeys = boundKeySet(this.bindings);
  }

  handlePointerLockChange(locked: boolean): void {
    this.pointerLocked = locked;
    this.primaryFire = false;
    this.secondaryFire = false;
    if (!locked) {
      this.mouseX = 0;
      this.mouseY = 0;
    }
  }

  handleMouseMove(event: DesktopMouseMoveEvent): void {
    this.mouseX += Number.isFinite(event.movementX) ? event.movementX : 0;
    this.mouseY += Number.isFinite(event.movementY) ? event.movementY : 0;
  }

  handleMouseButton(button: number, pressed: boolean): void {
    if (button === 0) this.primaryFire = pressed;
    if (button === 2) this.secondaryFire = pressed;
  }

  handleKeyDown(event: DesktopKeyEvent): boolean {
    const code = event.code;
    if (event.isComposing || !this.gameplayKeys.has(code)) return false;
    if (!event.repeat && this.bindings.cameraToggle.includes(code)) this.cameraTogglePending = true;
    if (!event.repeat && this.bindings.pause.includes(code)) this.pausePending = true;
    if (!event.repeat && this.bindings.returnRequested.includes(code)) this.returnPending = true;
    this.keys.add(code);
    return true;
  }

  handleKeyUp(event: DesktopKeyEvent): boolean {
    if (event.isComposing || !this.gameplayKeys.has(event.code)) return false;
    this.keys.delete(event.code);
    return true;
  }

  consumeCommand(): FlightCommand {
    const pressed = (action: GameAction): boolean => isActionPressed(this.bindings, action, this.keys);
    const command = normalizeFlightCommand({
      throttle: this.axis('throttleBack', 'throttleForward'),
      strafe: this.axis('strafeLeft', 'strafeRight'),
      yaw: (this.mouseX / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity,
      pitch: (this.mouseY / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity
        * (this.settings.invertY ? 1 : -1),
      boost: pressed('boost'),
      // 鼠标左右键与键盘绑定并存，任何一端按下都算开火。
      primaryFire: this.primaryFire || pressed('primaryFire'),
      secondaryFire: this.secondaryFire || pressed('secondaryFire'),
      swapWeapons: pressed('swapWeapons'),
      deviceAbility: pressed('deviceAbility'),
      cameraToggle: this.cameraTogglePending,
      pause: this.pausePending,
      returnRequested: this.returnPending || pressed('returnRequested'),
      // 决策阶段主武器键兼作「继续深入」；平时不抢射击手感。
      advanceRequested: pressed('advanceRequested')
        || (this.snapshotPhase === 'decision' && pressed('primaryFire')),
    });
    this.mouseX = 0;
    this.mouseY = 0;
    this.cameraTogglePending = false;
    this.pausePending = false;
    this.returnPending = false;
    return command;
  }

  releaseAll(): void {
    this.keys.clear();
    this.mouseX = 0;
    this.mouseY = 0;
    this.primaryFire = false;
    this.secondaryFire = false;
    this.cameraTogglePending = false;
    this.pausePending = false;
    this.returnPending = false;
  }

  attach(
    canvas: DesktopCanvas,
    documentRef: DesktopDocument = document,
    canCapturePointer: PointerCaptureGuard = () => true,
    canHandleGameplay: PointerCaptureGuard = canCapturePointer,
  ): () => void {
    this.detach();
    const keyDown = (event: Event): void => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.ctrlKey && keyboardEvent.altKey) {
        documentRef.exitPointerLock?.();
        this.handlePointerLockChange(false);
        keyboardEvent.preventDefault();
        return;
      }
      if (!canHandleGameplay()) return;
      const target = keyboardEvent.target as Element | null;
      if (target?.closest?.('input, select, textarea, button, [contenteditable="true"]')) return;
      if (keyboardEvent.code === 'Escape') {
        const handled = this.handleKeyDown(keyboardEvent);
        documentRef.exitPointerLock?.();
        this.handlePointerLockChange(false);
        if (handled) keyboardEvent.preventDefault();
        return;
      }
      if (this.handleKeyDown(keyboardEvent)) keyboardEvent.preventDefault();
    };
    const keyUp = (event: Event): void => {
      const keyboardEvent = event as KeyboardEvent;
      if (this.handleKeyUp(keyboardEvent)) keyboardEvent.preventDefault();
    };
    const mouseMove = (event: Event): void => {
      if (canCapturePointer()) this.handleMouseMove(event as MouseEvent);
    };
    const mouseDown = (event: Event): void => {
      const mouseEvent = event as MouseEvent;
      if (!canCapturePointer()) return;
      if (!this.pointerLocked) {
        try {
          const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          void request?.catch?.(() => {});
        } catch (_) {
          // Relative mouse fallback remains active when the browser rejects pointer lock.
        }
        mouseEvent.preventDefault();
        return;
      }
      this.handleMouseButton(mouseEvent.button, true);
      mouseEvent.preventDefault();
    };
    const mouseUp = (event: Event): void => this.handleMouseButton((event as MouseEvent).button, false);
    const pointerLock = (): void => this.handlePointerLockChange(documentRef.pointerLockElement === canvas);
    const contextMenu = (event: Event): void => event.preventDefault();

    // Cocos stops gameplay events before they bubble out of its canvas.
    documentRef.addEventListener('keydown', keyDown, true);
    documentRef.addEventListener('keyup', keyUp, true);
    documentRef.addEventListener('mousemove', mouseMove, true);
    documentRef.addEventListener('mouseup', mouseUp, true);
    documentRef.addEventListener('pointerlockchange', pointerLock);
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('contextmenu', contextMenu);
    this.handlePointerLockChange(documentRef.pointerLockElement === canvas);

    this.detachListeners = () => {
      documentRef.removeEventListener('keydown', keyDown, true);
      documentRef.removeEventListener('keyup', keyUp, true);
      documentRef.removeEventListener('mousemove', mouseMove, true);
      documentRef.removeEventListener('mouseup', mouseUp, true);
      documentRef.removeEventListener('pointerlockchange', pointerLock);
      canvas.removeEventListener('mousedown', mouseDown);
      canvas.removeEventListener('contextmenu', contextMenu);
      this.releaseAll();
      this.handlePointerLockChange(false);
    };
    return () => this.detach();
  }

  detach(): void {
    const cleanup = this.detachListeners;
    this.detachListeners = null;
    cleanup?.();
  }

  /** 正方向动作减去负方向动作；一个动作允许绑多个键，任一按下即算。 */
  private axis(negative: GameAction, positive: GameAction): number {
    const negativePressed = isActionPressed(this.bindings, negative, this.keys);
    const positivePressed = isActionPressed(this.bindings, positive, this.keys);
    return Number(positivePressed) - Number(negativePressed);
  }
}
