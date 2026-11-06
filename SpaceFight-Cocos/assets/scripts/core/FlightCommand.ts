export interface FlightLookCommand {
  yaw: number;
  pitch: number;
}

export interface FlightCommand extends FlightLookCommand {
  throttle: number;
  strafe: number;
  boost: boolean;
  primaryFire: boolean;
  secondaryFire: boolean;
  /** 战斗中主副武器互换（边沿触发，按一次切换一次，长按不会反复切换）。 */
  swapWeapons: boolean;
  cameraToggle: boolean;
  pause: boolean;
  returnRequested: boolean;
  /** 决策阶段主动确认"继续深入"，推进到下一波。 */
  advanceRequested: boolean;
}

export type FlightCommandInput = Partial<FlightCommand>;

export const LOOK_AXIS_LIMIT = 4;

function clampAxis(value: unknown, limit = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.max(-limit, Math.min(limit, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

function isPressed(value: unknown): boolean {
  return value === true;
}

export function neutralFlightCommand(): FlightCommand {
  return {
    throttle: 0,
    strafe: 0,
    yaw: 0,
    pitch: 0,
    boost: false,
    primaryFire: false,
    secondaryFire: false,
    swapWeapons: false,
    cameraToggle: false,
    pause: false,
    returnRequested: false,
    advanceRequested: false,
  };
}

export function normalizeFlightCommand(input?: FlightCommandInput | null): FlightCommand {
  const source = input || {};
  return {
    throttle: clampAxis(source.throttle),
    strafe: clampAxis(source.strafe),
    yaw: clampAxis(source.yaw, LOOK_AXIS_LIMIT),
    pitch: clampAxis(source.pitch, LOOK_AXIS_LIMIT),
    boost: isPressed(source.boost),
    primaryFire: isPressed(source.primaryFire),
    secondaryFire: isPressed(source.secondaryFire),
    swapWeapons: isPressed(source.swapWeapons),
    cameraToggle: isPressed(source.cameraToggle),
    pause: isPressed(source.pause),
    returnRequested: isPressed(source.returnRequested),
    advanceRequested: isPressed(source.advanceRequested),
  };
}
