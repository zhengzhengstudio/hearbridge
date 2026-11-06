import {
  FlightCommand,
  neutralFlightCommand,
  normalizeFlightCommand,
} from '../core/FlightCommand';
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

const GAMEPLAY_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyQ', 'KeyE', 'KeyR',
  'Enter', 'NumpadEnter',
  'F2', 'Escape',
]);
const LOOK_PIXELS_FOR_FULL_AXIS = 52;

export function neutralInputCommand(): FlightCommand {
  return neutralFlightCommand();
}

export class DesktopFlightInput {
  private readonly settings: InputSettings;
  private readonly keys = new Set<string>();
  private pointerLocked = false;
  private mouseX = 0;
  private mouseY = 0;
  private primaryFire = false;
  private secondaryFire = false;
  private cameraTogglePending = false;
  private pausePending = false;
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
    if (event.isComposing || event.code === 'F5' || !GAMEPLAY_KEYS.has(event.code)) return false;
    if (!event.repeat && event.code === 'F2') this.cameraTogglePending = true;
    if (!event.repeat && event.code === 'Escape') this.pausePending = true;
    this.keys.add(event.code);
    return true;
  }

  handleKeyUp(event: DesktopKeyEvent): boolean {
    if (event.isComposing || !GAMEPLAY_KEYS.has(event.code)) return false;
    this.keys.delete(event.code);
    return true;
  }

  consumeCommand(): FlightCommand {
    const vertical = this.axis('KeyS', 'KeyW') || this.axis('ArrowDown', 'ArrowUp');
    const horizontal = this.axis('KeyA', 'KeyD') || this.axis('ArrowLeft', 'ArrowRight');
    const pitchDirection = this.settings.invertY ? 1 : -1;
    const command = normalizeFlightCommand({
      throttle: vertical,
      strafe: horizontal,
      yaw: (this.mouseX / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity,
      pitch: (this.mouseY / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity * pitchDirection,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      primaryFire: this.primaryFire || this.keys.has('Space'),
      secondaryFire: this.secondaryFire || this.keys.has('KeyQ'),
      // 主副武器互换：E 键，战斗中一键切换主炮 / 副武器火力配置。
      swapWeapons: this.keys.has('KeyE'),
      cameraToggle: this.cameraTogglePending,
      pause: this.pausePending,
      returnRequested: this.keys.has('KeyR'),
      // 决策阶段按 Enter / 空格 确认继续深入（空格已是主武器，
      // 因此只在决策阶段才把空格当作推进，避免误触影响射击手感）。
      advanceRequested: this.keys.has('Enter') || this.keys.has('NumpadEnter')
        || (this.snapshotPhase === 'decision' && this.keys.has('Space')),
    });
    this.mouseX = 0;
    this.mouseY = 0;
    this.cameraTogglePending = false;
    this.pausePending = false;
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
    const mouseMove = (event: Event): void => this.handleMouseMove(event as MouseEvent);
    const mouseDown = (event: Event): void => {
      const mouseEvent = event as MouseEvent;
      if (!this.pointerLocked) {
        if (!canCapturePointer()) return;
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

    documentRef.addEventListener('keydown', keyDown);
    documentRef.addEventListener('keyup', keyUp);
    documentRef.addEventListener('mousemove', mouseMove);
    documentRef.addEventListener('mouseup', mouseUp);
    documentRef.addEventListener('pointerlockchange', pointerLock);
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('contextmenu', contextMenu);
    this.handlePointerLockChange(documentRef.pointerLockElement === canvas);

    this.detachListeners = () => {
      documentRef.removeEventListener('keydown', keyDown);
      documentRef.removeEventListener('keyup', keyUp);
      documentRef.removeEventListener('mousemove', mouseMove);
      documentRef.removeEventListener('mouseup', mouseUp);
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

  private axis(negative: string, positive: string): number {
    return Number(this.keys.has(positive)) - Number(this.keys.has(negative));
  }
}
