import type { GraphicsProfile } from '../performance/GraphicsProfile';

export interface WorldStreamProfile {
  readonly activeWorldChunks: number;
  readonly recycleRadius: number;
  readonly debrisPerChunk: readonly number[];
  readonly debrisCollidersPerChunk: readonly number[];
  readonly debrisColliders: boolean;
  readonly debrisColliderCount: number;
  readonly detailedOutpost: boolean;
}

export function createWorldStreamProfile(
  graphicsProfile: Pick<
    GraphicsProfile,
    'activeWorldChunks' | 'decorationBudget' | 'shadows'
  >,
): Readonly<WorldStreamProfile> {
  const sideLength = Math.sqrt(graphicsProfile.activeWorldChunks);
  const recycleRadius = (sideLength - 1) / 2;
  if (!Number.isInteger(recycleRadius) || recycleRadius < 0) {
    throw new Error('activeWorldChunks must be an odd square');
  }
  if (!Number.isInteger(graphicsProfile.decorationBudget)
      || graphicsProfile.decorationBudget < 0) {
    throw new Error('decorationBudget must be a non-negative integer');
  }

  const minimum = Math.floor(
    graphicsProfile.decorationBudget / graphicsProfile.activeWorldChunks,
  );
  const remainder = graphicsProfile.decorationBudget % graphicsProfile.activeWorldChunks;
  const debrisPerChunk = Object.freeze(Array.from(
    { length: graphicsProfile.activeWorldChunks },
    (_, index) => minimum + (index < remainder ? 1 : 0),
  ));
  const colliderBudget = graphicsProfile.shadows
    ? graphicsProfile.decorationBudget
    : Math.min(4, graphicsProfile.decorationBudget);
  const colliderMinimum = Math.floor(colliderBudget / graphicsProfile.activeWorldChunks);
  const colliderRemainder = colliderBudget % graphicsProfile.activeWorldChunks;
  const debrisCollidersPerChunk = Object.freeze(Array.from(
    { length: graphicsProfile.activeWorldChunks },
    (_, index) => colliderMinimum + (index < colliderRemainder ? 1 : 0),
  ));

  return Object.freeze({
    activeWorldChunks: graphicsProfile.activeWorldChunks,
    recycleRadius,
    debrisPerChunk,
    debrisCollidersPerChunk,
    debrisColliders: colliderBudget > 0,
    debrisColliderCount: colliderBudget,
    detailedOutpost: graphicsProfile.shadows,
  });
}
