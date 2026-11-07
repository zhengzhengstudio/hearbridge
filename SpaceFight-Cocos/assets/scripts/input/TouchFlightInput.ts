import { FlightCommand, normalizeFlightCommand } from '../core/FlightCommand';
import { InputSettings, normalizeInputSettings } from './InputSettings';

export interface TouchViewport {
  width: number;
  height: number;
  safeLeft?: number;
  safeRight?: number;
  safeTop?: number;
  safeBottom?: number;
}

export type TouchAction =
  | 'primaryFire'
  | 'secondaryFire'
  | 'boost'
  | 'cameraToggle'
  | 'pause'
  | 'returnRequested'
  /** 决策阶段"继续深入"按钮。 */
  | 'advanceRequested'
  /** 战斗中主副武器互换（与桌面 E 键、手柄 X 键一致）。 */
  | 'swapWeapons';

interface Point {
  x: number;
  y: number;
}

interface MovementGeometry {
  center: Point;
  radius: number;
}

interface LookPointer extends Point {
  id: number;
}

const ANALOG_DEADZONE = 0.03;
const ANALOG_RESPONSE_EXPONENT = 0.62;
const LOOK_PIXELS_FOR_FULL_AXIS = 32;

function shapeMovement(x: number, y: number, radius: number): Point {
  const length = Math.hypot(x, y);
  if (length <= radius * ANALOG_DEADZONE) return { x: 0, y: 0 };
  const raw = Math.min(1, length / radius);
  const response = Math.pow(
    (raw - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE),
    ANALOG_RESPONSE_EXPONENT,
  );
  return {
    x: (x / length) * response,
    y: (y / length) * response,
  };
}

export class TouchFlightInput {
  private viewport: Required<TouchViewport>;
  private readonly settings: InputSettings;
  private movementPointer: number | null = null;
  private movementPosition: Point | null = null;
  private lookPointer: LookPointer | null = null;
  private lookX = 0;
  private lookY = 0;
  private readonly actions = new Map<number, TouchAction>();
  private movementGeometry: MovementGeometry | null = null;

  constructor(viewport: TouchViewport, settings?: Partial<InputSettings>) {
    this.viewport = this.normalizeViewport(viewport);
    this.settings = normalizeInputSettings(settings);
  }

  movementCenter(): Point {
    if (this.movementGeometry) return { ...this.movementGeometry.center };
    const radius = this.stickRadius();
    const edgeGap = Math.min(24, this.viewport.height * 0.046);
    const x = this.settings.leftHanded
      ? this.viewport.width - this.viewport.safeRight - radius - edgeGap
      : this.viewport.safeLeft + radius + edgeGap;
    return {
      x,
      y: this.viewport.height - this.viewport.safeBottom - radius - edgeGap,
    };
  }

  beginMovement(pointerId: number, x: number, y: number): boolean {
    if (this.movementPointer !== null && this.movementPointer !== pointerId) return false;
    this.movementPointer = pointerId;
    this.movementPosition = { x, y };
    return true;
  }

  // 修复：返回是否接受该指针，供上层在被第二指占用而拒绝时不写入 roles。
  beginLook(pointerId: number, x: number, y: number): boolean {
    if (this.lookPointer && this.lookPointer.id !== pointerId) return false;
    this.lookPointer = { id: pointerId, x, y };
    return true;
  }

  beginAction(pointerId: number, action: TouchAction): void {
    this.actions.set(pointerId, action);
  }

  movePointer(pointerId: number, x: number, y: number): void {
    if (this.movementPointer === pointerId) this.movementPosition = { x, y };
    if (this.lookPointer?.id === pointerId) {
      this.lookX += x - this.lookPointer.x;
      this.lookY += y - this.lookPointer.y;
      this.lookPointer.x = x;
      this.lookPointer.y = y;
    }
  }

  endPointer(pointerId: number): void {
    if (this.movementPointer === pointerId) {
      this.movementPointer = null;
      this.movementPosition = null;
    }
    if (this.lookPointer?.id === pointerId) {
      this.lookPointer = null;
    }
    this.actions.delete(pointerId);
  }

  consumeCommand(): FlightCommand {
    const center = this.movementCenter();
    const radius = this.stickRadius();
    const movement = this.movementPosition || center;
    const shapedMovement = shapeMovement(
      movement.x - center.x,
      movement.y - center.y,
      radius,
    );
    const pitchDirection = this.settings.invertY ? 1 : -1;
    const activeActions = new Set(this.actions.values());
    const command = normalizeFlightCommand({
      throttle: -shapedMovement.y,
      strafe: shapedMovement.x,
      yaw: (this.lookX / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity,
      pitch: (this.lookY / LOOK_PIXELS_FOR_FULL_AXIS) * this.settings.sensitivity * pitchDirection,
      primaryFire: activeActions.has('primaryFire'),
      secondaryFire: activeActions.has('secondaryFire'),
      boost: activeActions.has('boost'),
      cameraToggle: activeActions.has('cameraToggle'),
      pause: activeActions.has('pause'),
      returnRequested: activeActions.has('returnRequested'),
      advanceRequested: activeActions.has('advanceRequested'),
      swapWeapons: activeActions.has('swapWeapons'),
    });
    this.lookX = 0;
    this.lookY = 0;
    return command;
  }

  releaseAll(): void {
    this.movementPointer = null;
    this.movementPosition = null;
    this.lookPointer = null;
    this.lookX = 0;
    this.lookY = 0;
    this.actions.clear();
  }

  resize(viewport: TouchViewport): void {
    this.viewport = this.normalizeViewport(viewport);
  }

  setMovementGeometry(center: Point, radius: number): void {
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(radius) || radius <= 0) {
      this.movementGeometry = null;
      return;
    }
    this.movementGeometry = {
      center: { x: center.x, y: center.y },
      radius,
    };
  }

  private stickRadius(): number {
    if (this.movementGeometry) return this.movementGeometry.radius;
    const viewportScale = Math.max(
      0.65,
      Math.min(1, this.viewport.width / 960, this.viewport.height / 540),
    );
    return 78 * viewportScale * this.settings.controlScale;
  }

  private normalizeViewport(viewport: TouchViewport): Required<TouchViewport> {
    return {
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height),
      safeLeft: Math.max(0, viewport.safeLeft || 0),
      safeRight: Math.max(0, viewport.safeRight || 0),
      safeTop: Math.max(0, viewport.safeTop || 0),
      safeBottom: Math.max(0, viewport.safeBottom || 0),
    };
  }
}
