import type { GraphicsTier } from './GraphicsProfile';

export type SpaceFightAssetBundle = 'resources' | 'spacefight-high';

const LOW_BUNDLES: readonly SpaceFightAssetBundle[] = Object.freeze(['resources']);
const HIGH_BUNDLES: readonly SpaceFightAssetBundle[] = Object.freeze([
  'resources',
  'spacefight-high',
]);

export function selectAssetBundles(tier: GraphicsTier): readonly SpaceFightAssetBundle[] {
  return tier === 'high' ? HIGH_BUNDLES : LOW_BUNDLES;
}
