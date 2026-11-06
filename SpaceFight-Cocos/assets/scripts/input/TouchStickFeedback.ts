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

  return {
    active,
    axis: length > 0
      ? {
        x: (safeX / length) * travel,
        y: (safeY / length) * travel,
      }
      : { x: 0, y: 0 },
    travel,
    angle: length > 0 ? Math.atan2(safeY, safeX) : 0,
    threshold,
    crossedThreshold: threshold !== previousThreshold,
  };
}
