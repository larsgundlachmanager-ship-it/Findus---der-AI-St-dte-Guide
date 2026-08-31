/**
 * Aktive Stadt für Concierge: GPS-first, Profil nur Fallback.
 */

import { useGpsStore } from '../../store/useGpsStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  resolveCityIdFromGps,
  resolveCityNameFromGps,
} from './resolveCityFromGps';
import { resolveCityCoverageBoundsSync } from '../discovery/cityCoverageBounds';
import { peekCityIndexCache } from '../cityCatalogService';

export type ActiveCityContext = {
  cityId: string;
  cityName: string;
  source: 'gps' | 'profile';
};

export function getActiveCityForConcierge(): ActiveCityContext | null {
  const gps = useGpsStore.getState();
  const gpsId = resolveCityIdFromGps(gps.lat, gps.lng);
  if (gpsId) {
    const name =
      resolveCityNameFromGps(gps.lat, gps.lng) ??
      resolveCityCoverageBoundsSync(gpsId)?.name ??
      gpsId;
    return { cityId: gpsId, cityName: name, source: 'gps' };
  }
  const profile = getCachedUserProfile();
  const profileId = (profile?.cityId ?? '').trim().toLowerCase();
  if (!profileId) return null;
  const name =
    profile?.cityName?.trim() ||
    resolveCityCoverageBoundsSync(profileId)?.name ||
    peekCityIndexCache()?.find((c) => c.id === profileId)?.name ||
    profileId;
  return { cityId: profileId, cityName: name, source: 'profile' };
}
