/**
 * Client → Supabase Edge Function `weather-forecast`.
 * Shared cache per city/Viertel (~5 km) or geo-cell so N users at the same
 * place only trigger 1 OWM / Open-Meteo upstream call (adaptive TTL on edge).
 */

import { env } from '../../config/env';
import { isSupabaseConfigured } from '../supabase';
import { weatherCacheKey } from './weatherCacheKey';

export type SharedWeatherResponse = {
  cacheKey: string;
  cacheHit: boolean;
  fetchedAtMs: number;
  expiresAtMs: number;
  lat: number;
  lng: number;
  cityHint: string | null;
  openMeteo: unknown;
  /** OpenWeather One Call raw JSON when edge included it */
  owm?: unknown | null;
};

const FETCH_MS = 8_000;

function weatherEndpoint(): string {
  const custom = env.get('EXPO_PUBLIC_WEATHER_ENDPOINT').trim();
  if (custom) return custom.replace(/\/$/, '');
  const base = env.supabaseUrl().replace(/\/$/, '');
  return base ? `${base}/functions/v1/weather-forecast` : '';
}

/**
 * Fetch weather via shared server cache. Returns null if Supabase/endpoint
 * unavailable (caller falls back to direct Open-Meteo).
 */
export async function fetchSharedWeather(opts: {
  lat: number;
  lng: number;
  cityId?: string | null;
  cityHint?: string | null;
}): Promise<SharedWeatherResponse | null> {
  if (!isSupabaseConfigured()) return null;
  const endpoint = weatherEndpoint();
  const anon = env.supabaseAnonKey();
  if (!endpoint || !anon) return null;

  const cacheKey = weatherCacheKey({
    lat: opts.lat,
    lng: opts.lng,
    cityId: opts.cityId,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const url =
      `${endpoint}?lat=${encodeURIComponent(String(opts.lat))}` +
      `&lng=${encodeURIComponent(String(opts.lng))}` +
      `&cacheKey=${encodeURIComponent(cacheKey)}` +
      (opts.cityId
        ? `&cityId=${encodeURIComponent(opts.cityId)}`
        : '') +
      (opts.cityHint
        ? `&cityHint=${encodeURIComponent(opts.cityHint)}`
        : '');

    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${anon}`,
        apikey: anon,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.warn('[weather] shared cache HTTP', res.status);
      return null;
    }
    const data = (await res.json()) as SharedWeatherResponse;
    if (typeof data?.fetchedAtMs !== 'number') {
      return null;
    }
    if (data.openMeteo == null && data.owm == null) {
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[weather] shared cache failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
