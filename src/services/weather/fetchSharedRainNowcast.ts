/**
 * Client → Supabase Edge `rain-nowcast`.
 * Shared ~1 km Zelle: N User → 1 Bright-Sky Upstream / TTL.
 */

import { env } from '../../config/env';
import { isSupabaseConfigured } from '../supabase';
import {
  type GpsRainNowcast,
  type RainSample,
  timingFromRainSamples,
  precipMmFromRadarUnits,
  RADAR_WET_UNITS,
  RADAR_NOISE_PEAK_MIN,
  RADAR_EARLY_WARN_MS,
  RADAR_LATE_CLEAR_MS,
} from './gpsRainNowcast';
import { rainCacheKey, rainCellCenter } from './rainCacheKey';

export type SharedRainNowcastResponse = {
  cacheKey: string;
  cacheHit: boolean;
  fetchedAtMs: number;
  expiresAtMs: number;
  lat: number;
  lng: number;
  source: string;
  samples: RainSample[];
};

const FETCH_MS = 8_000;

function rainEndpoint(): string {
  const custom = env.get('EXPO_PUBLIC_RAIN_NOWCAST_ENDPOINT').trim();
  if (custom) return custom.replace(/\/$/, '');
  const base = env.supabaseUrl().replace(/\/$/, '');
  return base ? `${base}/functions/v1/rain-nowcast` : '';
}

/**
 * Shared Regen-Radar. null wenn Edge/Supabase nicht erreichbar
 * (Caller fällt auf direkten Bright-Sky/Open-Meteo zurück).
 */
export async function fetchSharedRainNowcast(opts: {
  lat: number;
  lng: number;
  nowMs?: number;
}): Promise<GpsRainNowcast | null> {
  if (!isSupabaseConfigured()) return null;
  const endpoint = rainEndpoint();
  const anon = env.supabaseAnonKey();
  if (!endpoint || !anon) return null;

  const center = rainCellCenter(opts.lat, opts.lng);
  const cacheKey = rainCacheKey(center);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const url =
      `${endpoint}?lat=${encodeURIComponent(String(opts.lat))}` +
      `&lng=${encodeURIComponent(String(opts.lng))}` +
      `&cacheKey=${encodeURIComponent(cacheKey)}`;

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
      console.warn('[rain] shared cache HTTP', res.status);
      return null;
    }
    const data = (await res.json()) as SharedRainNowcastResponse;
    if (!Array.isArray(data?.samples) || !data.samples.length) return null;

    const now = opts.nowMs ?? Date.now();
    const timing = timingFromRainSamples(data.samples, {
      nowMs: now,
      stepMs: 5 * 60_000,
      wetMm: precipMmFromRadarUnits(RADAR_WET_UNITS),
      earlyWarnMs: RADAR_EARLY_WARN_MS,
      lateClearMs: RADAR_LATE_CLEAR_MS,
      noisePeakMin: precipMmFromRadarUnits(RADAR_NOISE_PEAK_MIN),
    });

    return {
      fetchedAtMs: data.fetchedAtMs ?? now,
      lat: data.lat ?? center.lat,
      lng: data.lng ?? center.lng,
      weatherCode: null,
      source: data.source ?? 'brightsky_rv_shared',
      ...timing,
    };
  } catch (err) {
    console.warn('[rain] shared cache failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
