import { LOOK_AXIS_LIMIT } from './FlightCommand';
import type { FlightLookCommand } from './FlightCommand';

export interface FlightAttitudeState {
  aimYaw: number;
  aimPitch: number;
  hullYaw: number;
  hullPitch: number;
  hullYawVelocity: number;
  hullPitchVelocity: number;
}

export interface FlightAttitudeTuning {
  readonly lookYawRate: number;
  readonly lookPitchRate: number;
  readonly hullYawAcceleration: number;
  readonly hullPitchAcceleration: number;
  readonly hullYawRateMax: number;
  readonly hullPitchRateMax: number;
  readonly maxPitch: number;
}

export const DEFAULT_ATTITUDE_TUNING = {
  lookYawRate: Math.PI * 4.4,
  lookPitchRate: Math.PI * 3.2,
  hullYawAcceleration: Math.PI * 15.5,
  hullPitchAcceleration: Math.PI * 11.5,
  hullYawRateMax: Math.PI * 3.1,
  hullPitchRateMax: Math.PI * 2.2,
  maxPitch: Math.PI * 0.43,
} as const;

const FULL_TURN = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedLookAxis(value: number): number {
  return clamp(finiteOr(value, 0), -LOOK_AXIS_LIMIT, LOOK_AXIS_LIMIT);
}

function wrappedAngle(value: number): number {
  let wrapped = value % FULL_TURN;
  if (wrapped > Math.PI) wrapped -= FULL_TURN;
  if (wrapped < -Math.PI) wrapped += FULL_TURN;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function shortestAngleError(target: number, current: number): number {
  return wrappedAngle(target - current);
}

function moveToward(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(current + maximumDelta, target);
  if (current > target) return Math.max(current - maximumDelta, target);
  return target;
}

interface PursuitResult {
  value: number;
  velocity: number;
}

function pursue(
  current: number,
  target: number,
  velocity: number,
  dt: number,
  acceleration: number,
  rateMax: number,
  angular: boolean,
): PursuitResult {
  const error = angular ? shortestAngleError(target, current) : target - current;
  const boundedVelocity = clamp(velocity, -rateMax, rateMax);
  if (error === 0) {
    const nextVelocity = moveToward(boundedVelocity, 0, acceleration * dt);
    const value = current + nextVelocity * dt;
    return {
      value: angular ? wrappedAngle(value) : value,
      velocity: nextVelocity,
    };
  }

  const accelerationStep = acceleration * dt;
  const canStopWithinAcceleration = Math.abs(boundedVelocity) <= accelerationStep;
  const stoppingRate = Math.max(
    0,
    Math.sqrt(
      accelerationStep * accelerationStep + 2 * acceleration * Math.abs(error),
    ) - accelerationStep,
  );
  const arrivalRate = error / dt;
  const canArriveAndStop = canStopWithinAcceleration
    && Math.abs(arrivalRate) <= rateMax
    && Math.abs(arrivalRate - boundedVelocity) <= accelerationStep;
  const desiredVelocity = canArriveAndStop
    ? arrivalRate
    : Math.sign(error) * Math.min(rateMax, stoppingRate);
  const nextVelocity = moveToward(
    boundedVelocity,
    desiredVelocity,
    acceleration * dt,
  );
  const travel = nextVelocity * dt;
  if (
    canStopWithinAcceleration
    && Math.sign(travel) === Math.sign(error)
    && Math.abs(travel) >= Math.abs(error)
  ) {
    return { value: target, velocity: 0 };
  }

  const value = current + travel;
  return {
    value: angular ? wrappedAngle(value) : value,
    velocity: nextVelocity,
  };
}

export function neutralAttitude(): FlightAttitudeState {
  return {
    aimYaw: 0,
    aimPitch: 0,
    hullYaw: 0,
    hullPitch: 0,
    hullYawVelocity: 0,
    hullPitchVelocity: 0,
  };
}

export function stepFlightAttitude(
  state: FlightAttitudeState,
  command: FlightLookCommand,
  dt: number,
  tuning: FlightAttitudeTuning = DEFAULT_ATTITUDE_TUNING,
): FlightAttitudeState {
  if (!Number.isFinite(dt) || dt <= 0) return { ...state };

  const aimYaw = wrappedAngle(
    finiteOr(state.aimYaw, 0) + normalizedLookAxis(command.yaw) * tuning.lookYawRate * dt,
  );
  const aimPitch = clamp(
    finiteOr(state.aimPitch, 0) + normalizedLookAxis(command.pitch) * tuning.lookPitchRate * dt,
    -tuning.maxPitch,
    tuning.maxPitch,
  );
  const hullYaw = pursue(
    wrappedAngle(finiteOr(state.hullYaw, 0)),
    aimYaw,
    finiteOr(state.hullYawVelocity, 0),
    dt,
    tuning.hullYawAcceleration,
    tuning.hullYawRateMax,
    true,
  );
  const hullPitch = pursue(
    clamp(finiteOr(state.hullPitch, 0), -tuning.maxPitch, tuning.maxPitch),
    aimPitch,
    finiteOr(state.hullPitchVelocity, 0),
    dt,
    tuning.hullPitchAcceleration,
    tuning.hullPitchRateMax,
    false,
  );

  return {
    aimYaw,
    aimPitch,
    hullYaw: hullYaw.value,
    hullPitch: clamp(hullPitch.value, -tuning.maxPitch, tuning.maxPitch),
    hullYawVelocity: hullYaw.velocity,
    hullPitchVelocity: hullPitch.velocity,
  };
}
