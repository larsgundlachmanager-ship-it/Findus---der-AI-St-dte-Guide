/**
 * Grobe GPU/JS-Tier-Schätzung — Feature-Caps für Extract-Clip.
 * Kein natives SDK nötig; konservativ auf Android-API.
 */

import { Platform } from 'react-native';

export type MapDeviceTier = 'low' | 'mid' | 'high';

let cachedTier: MapDeviceTier | null = null;

export function peekMapDeviceTier(): MapDeviceTier {
  if (cachedTier) return cachedTier;
  if (Platform.OS === 'android') {
    const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
    if (api > 0 && api <= 28) cachedTier = 'low';
    else if (api <= 32) cachedTier = 'mid';
    else cachedTier = 'high';
  } else {
    cachedTier = 'high';
  }
  return cachedTier;
}

export function mapExtractCapsForRadius(
  radiusM: number,
  tier: MapDeviceTier = peekMapDeviceTier(),
): { maxRoads: number; maxBuildings: number } {
  const near = radiusM <= 6_000;
  if (tier === 'low') {
    return near
      ? { maxRoads: 1_500, maxBuildings: 800 }
      : { maxRoads: 2_200, maxBuildings: 1_200 };
  }
  if (tier === 'mid') {
    return near
      ? { maxRoads: 2_200, maxBuildings: 1_200 }
      : { maxRoads: 2_800, maxBuildings: 1_500 };
  }
  if (near) {
    return { maxRoads: 2_800, maxBuildings: 1_400 };
  }
  if (radiusM <= 10_000) {
    return { maxRoads: 3_200, maxBuildings: 1_800 };
  }
  return { maxRoads: 4_500, maxBuildings: 2_400 };
}
