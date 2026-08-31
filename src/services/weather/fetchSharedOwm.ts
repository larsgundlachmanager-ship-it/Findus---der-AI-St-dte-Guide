/**
 * OWM via shared Supabase weather-forecast cache, with device-key fallback.
 */

import { getCachedUserProfile } from '../userProfileService';
import {
  fetchOpenWeatherOneCall,
  hasOpenWeatherKey,
  parseOpenWeatherOneCallData,
  type OwmOneCallRaw,
  type OwmOneCallResult,
} from './openWeatherOneCall';
import { fetchSharedWeather } from './weatherSharedCache';

/**
 * Prefer shared edge `owm` payload; only hit OpenWeather from the device
 * when the edge response has no OWM and a local API key exists.
 */
export async function fetchSharedOrDirectOwm(opts: {
  lat: number;
  lng: number;
  cityId?: string | null;
}): Promise<OwmOneCallResult | null> {
  try {
    const profile = getCachedUserProfile();
    const cityId = opts.cityId ?? profile?.cityId ?? null;
    const shared = await fetchSharedWeather({
      lat: opts.lat,
      lng: opts.lng,
      cityId,
      cityHint: profile?.cityName ?? null,
    });
    if (shared?.owm != null && typeof shared.owm === 'object') {
      return parseOpenWeatherOneCallData(shared.owm as OwmOneCallRaw, {
        lat: opts.lat,
        lng: opts.lng,
        fetchedAtMs: shared.fetchedAtMs,
      });
    }
  } catch (err) {
    console.warn('[owm] shared path failed', err);
  }

  if (hasOpenWeatherKey()) {
    return fetchOpenWeatherOneCall({ lat: opts.lat, lng: opts.lng });
  }
  return null;
}
