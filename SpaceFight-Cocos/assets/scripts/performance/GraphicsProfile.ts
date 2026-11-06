export type GraphicsTier = 'low' | 'high';

export interface GraphicsProfile {
  readonly targetFps: 30 | 60;
  readonly renderScaleMin: number;
  readonly renderScaleMax: number;
  readonly shadows: boolean;
  readonly particleCapacity: number;
  readonly activeWorldChunks: number;
  readonly decorationBudget: number;
  readonly projectilePoolSize: number;
  readonly projectileTrails: boolean;
  readonly feedbackPoolSize: number;
  readonly feedbackLights: boolean;
  readonly maxVisibleEnemies: number;
}

export const GRAPHICS_PROFILES = {
  low: {
    targetFps: 30,
    renderScaleMin: 0.48,
    renderScaleMax: 0.64,
    shadows: false,
    particleCapacity: 16,
    activeWorldChunks: 1,
    decorationBudget: 14,
    projectilePoolSize: 18,
    projectileTrails: false,
    feedbackPoolSize: 8,
    feedbackLights: false,
    maxVisibleEnemies: 4,
  },
  high: {
    targetFps: 60,
    renderScaleMin: 0.82,
    renderScaleMax: 1,
    shadows: true,
    particleCapacity: 180,
    activeWorldChunks: 25,
    decorationBudget: 180,
    projectilePoolSize: 48,
    projectileTrails: true,
    feedbackPoolSize: 18,
    feedbackLights: true,
    maxVisibleEnemies: 10,
  },
} as const satisfies Record<GraphicsTier, GraphicsProfile>;

export function resolveRenderScale(
  profile: GraphicsProfile,
  requestedScale = profile.renderScaleMax,
): number {
  return Math.min(profile.renderScaleMax, Math.max(profile.renderScaleMin, requestedScale));
}
