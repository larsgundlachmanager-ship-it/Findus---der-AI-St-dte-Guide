/**
 * Live-Wetter / Shared-Cache nur wenn:
 * - App-Session ≥ 30 Min (Ressourcen sparen bei kurzem Öffnen)
 * - GPS da und User in einer bekannten Stadt (nicht „irgendwo“ pollen)
 */

import {
  markRainWarnSessionStart,
  weatherSessionStartedAtMs,
} from './rainWarnSessionGate';

/** Erst nach so langer Nutzung Live-Wetter/Shared-Cache anstoßen. */
export const WEATHER_LIVE_AFTER_USE_MS = 30 * 60_000;

export type WeatherFetchGateResult = {
  ok: boolean;
  reason?: 'no_gps' | 'session_too_short' | 'not_in_city';
  sessionAgeMs: number;
  cityId: string | null;
};

function profileCityId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    const id = mod.getCachedUserProfile()?.cityId;
    return (id ?? '').toString().trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

export function canFetchLiveWeather(opts?: {
  lat?: number | null;
  lng?: number | null;
  cityId?: string | null;
  nowMs?: number;
  /** User-Frage / Regen im Cache / Force — Session-30-Min überspringen. */
  bypassSession?: boolean;
}): WeatherFetchGateResult {
  const now = opts?.nowMs ?? Date.now();
  markRainWarnSessionStart(now);
  const started = weatherSessionStartedAtMs();
  const sessionAgeMs = Math.max(0, now - started);

  const lat = opts?.lat;
  const lng = opts?.lng;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return { ok: false, reason: 'no_gps', sessionAgeMs, cityId: null };
  }

  const hintedCity =
    (opts?.cityId ?? '').toString().trim().toLowerCase() || profileCityId();

  if (
    !opts?.bypassSession &&
    sessionAgeMs < WEATHER_LIVE_AFTER_USE_MS
  ) {
    return {
      ok: false,
      reason: 'session_too_short',
      sessionAgeMs,
      cityId: hintedCity,
    };
  }

  let cityId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const boundsMod = require('../discovery/cityCoverageBounds') as {
      cityContainsPoint: (
        lat: number,
        lng: number,
        bounds: unknown,
      ) => boolean;
      resolveCityCoverageBoundsSync: (cityId: string) => unknown;
      smallestCityIdContainingPoint: (lat: number, lng: number) => string | null;
    };
    if (hintedCity) {
      const bounds = boundsMod.resolveCityCoverageBoundsSync(hintedCity);
      if (bounds && boundsMod.cityContainsPoint(lat, lng, bounds)) {
        cityId = hintedCity;
      }
    }
    if (!cityId) {
      cityId = boundsMod.smallestCityIdContainingPoint(lat, lng);
    }
  } catch {
    return { ok: false, reason: 'not_in_city', sessionAgeMs, cityId: null };
  }

  if (!cityId) {
    return { ok: false, reason: 'not_in_city', sessionAgeMs, cityId: null };
  }

  return { ok: true, sessionAgeMs, cityId };
}
