export type TouchStickThreshold = 'center' | 'active' | 'cruise' | 'full';

export interface TouchStickFeedbackSnapshot {
  readonly active: boolean;
  readonly axis: { readonly x: number; readonly y: number };
  readonly travel: number;
  readonly angle: number;
  readonly threshold: TouchStickThreshold;
  readonly crossedThreshold: boolean;
}

export function touchStickFeedback(
  dx: number,
  dy: number,
  radius: number,
  active: boolean,
  previousThreshold: TouchStickThreshold,
): TouchStickFeedbackSnapshot {
  const safeRadius = Math.max(1, Number.isFinite(radius) ? radius : 1);
  const safeX = Number.isFinite(dx) ? dx : 0;
  const safeY = Number.isFinite(dy) ? dy : 0;
  const length = active ? Math.hypot(safeX, safeY) : 0;
  const travel = Math.min(1, length / safeRadius);
  const threshold: TouchStickThreshold = !active || travel <= 0.04
    ? 'center'
    : travel >= 0.98
      ? 'full'
      : travel >= 0.75
        ? 'cruise'
        : 'active';

  // 操控手感优化 0.13.23：近中心做平滑缓动（smoothstep），小幅推摇杆时转向更精细、
  // 更易微操；travel=1 时 eased 仍为 1，满偏机动不受影响。仅影响原生触屏。
  const eased = travel * travel * (3 - 2 * travel);
  return {
    active,
    axis: length > 0
      ? {
        x: (safeX / length) * eased,
        y: (safeY / length) * eased,
      }
      : { x: 0, y: 0 },
    travel,
    angle: length > 0 ? Math.atan2(safeY, safeX) : 0,
    threshold,
    crossedThreshold: threshold !== previousThreshold,
  };
}
