export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AimAttitude {
  readonly position: Vec3Like;
  readonly aimYaw: number;
  readonly aimPitch: number;
}

export interface HullAttitude {
  readonly yaw: number;
  readonly pitch: number;
}

export interface ShipPresentationAttitude extends HullAttitude {
  readonly roll: number;
}

export interface RayLike {
  readonly origin: Vec3Like;
  readonly direction: Vec3Like;
}

export const AIM_CONVERGENCE_DISTANCE = 360;
export const PRIMARY_MUZZLE_LOCAL_POSITION: Vec3Like = Object.freeze({
  x: -0.68,
  y: -0.04,
  z: -2.25,
});
export const SECONDARY_MUZZLE_LOCAL_POSITION: Vec3Like = Object.freeze({
  x: 0.68,
  y: -0.04,
  z: -2.25,
});

const DEFAULT_DIRECTION: Vec3Like = Object.freeze({ x: 0, y: 0, z: -1 });
const MAX_VISUAL_ROLL = Math.PI * 24 / 180;
const VISUAL_ROLL_GAIN = 0.45;
const TAU = Math.PI * 2;

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function canonical(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function safeVector(value: Vec3Like | undefined): Vec3Like {
  return {
    x: canonical(finite(value?.x)),
    y: canonical(finite(value?.y)),
    z: canonical(finite(value?.z)),
  };
}

function normalized(value: Vec3Like | undefined): Vec3Like {
  const vector = safeVector(value);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return { ...DEFAULT_DIRECTION };
  }
  return {
    x: canonical(vector.x / length),
    y: canonical(vector.y / length),
    z: canonical(vector.z / length),
  };
}

function shortestAngleDelta(target: number, current: number): number {
  let delta = (target - current) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

export function computeAimRay(player: AimAttitude): RayLike {
  const yaw = finite(player?.aimYaw);
  const pitch = finite(player?.aimPitch);
  const cosPitch = Math.cos(pitch);
  return {
    origin: safeVector(player?.position),
    direction: normalized({
      x: Math.sin(yaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cosPitch,
    }),
  };
}

export function computeConvergencePoint(aimRay: RayLike, distance: number): Vec3Like {
  const origin = safeVector(aimRay?.origin);
  const direction = normalized(aimRay?.direction);
  const safeDistance = Number.isFinite(distance) && distance > 0
    ? distance
    : AIM_CONVERGENCE_DISTANCE;
  return {
    x: canonical(origin.x + direction.x * safeDistance),
    y: canonical(origin.y + direction.y * safeDistance),
    z: canonical(origin.z + direction.z * safeDistance),
  };
}

export function computeMuzzleDirection(
  muzzlePosition: Vec3Like,
  convergencePoint: Vec3Like,
): Vec3Like {
  const muzzle = safeVector(muzzlePosition);
  const point = safeVector(convergencePoint);
  return normalized({
    x: point.x - muzzle.x,
    y: point.y - muzzle.y,
    z: point.z - muzzle.z,
  });
}

export function computeMuzzlePosition(
  shipPosition: Vec3Like,
  hull: HullAttitude,
  localPosition: Vec3Like,
): Vec3Like {
  const ship = safeVector(shipPosition);
  const local = safeVector(localPosition);
  const yaw = finite(hull?.yaw);
  const pitch = finite(hull?.pitch);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const pitchedY = local.y * cosPitch - local.z * sinPitch;
  const pitchedZ = local.y * sinPitch + local.z * cosPitch;
  return {
    x: canonical(ship.x + local.x * cosYaw - pitchedZ * sinYaw),
    y: canonical(ship.y + pitchedY),
    z: canonical(ship.z + local.x * sinYaw + pitchedZ * cosYaw),
  };
}

export function computeShipPresentationAttitude(
  player: AimAttitude & HullAttitude,
): ShipPresentationAttitude {
  const yaw = finite(player?.yaw);
  const pitch = finite(player?.pitch);
  const aimYaw = finite(player?.aimYaw, yaw);
  const requestedRoll = -shortestAngleDelta(aimYaw, yaw) * VISUAL_ROLL_GAIN;
  return {
    yaw,
    pitch,
    roll: canonical(Math.max(-MAX_VISUAL_ROLL, Math.min(MAX_VISUAL_ROLL, requestedRoll))),
  };
}
