/**
 * Fuß-/Rad-Route auf dem Stadt-Graph (Pack-Extract), ohne Netz.
 */

import { ensureCityMapExtract } from '../homeMap/cityMapExtract';
import type { PedestrianTravelMode } from './googleMapsNav';
import {
  routeOnExtractGraph,
  type OfflineCityRoute,
} from './offlineCityGraph';

export type { OfflineCityRoute };
export { routeOnExtractGraph };

export async function routeOfflineOnCityGraph(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode;
  cityId?: string | null;
}): Promise<OfflineCityRoute | null> {
  if (opts.travelMode === 'transit') return null;
  const { getCachedUserProfile } = await import('../userProfileService');
  const cityId =
    opts.cityId || getCachedUserProfile()?.cityId?.toLowerCase() || null;
  const extract = await ensureCityMapExtract(cityId);
  if (!extract) return null;
  return routeOnExtractGraph(
    extract,
    { lat: opts.originLat, lng: opts.originLng },
    { lat: opts.destLat, lng: opts.destLng },
    opts.travelMode,
  );
}
