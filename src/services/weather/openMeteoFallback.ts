/**
 * Kostenloser Wetter-Fallback ohne API-Key (Open-Meteo).
 * Zuerst Shared-Cache (Supabase weather-forecast), sonst direkter Open-Meteo-Call.
 */

import {
  buildRainOutlook,
  eveningCutoffMs,
} from './weatherRainOutlook';

const FETCH_MS = 8_000;

export type OpenMeteoFallback = {
  fetchedAtMs: number;
  lat: number;
  lng: number;
  currentTemp: number | null;
  weatherCode: number | null;
  precipitationMm: number | null;
  summaryLine: string;
  promptBlock: string;
  nextRainAtMs: number | null;
  nextRainProb: number | null;
  rainWindows: Array<{ startMs: number; endMs: number; pop: number }>;
  dayHighC: number | null;
  tomorrowSummary: string | null;
  nightLowC: number | null;
};

type OpenMeteoJson = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    precipitation?: number;
    time?: string;
  };
  /** Legacy Open-Meteo (`current_weather=true`) — Shared-Cache/Edge */
  current_weather?: {
    temperature?: number;
    weathercode?: number;
    weather_code?: number;
    time?: string;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
    precipitation_probability_max?: number[];
  };
};

function wmoLabel(code: number | null): string {
  if (code == null) return 'wechselhaft';
  if (code === 0) return 'klar';
  if (code <= 3) return 'leicht bewölkt';
  if (code <= 48) return 'neblig';
  if (code <= 57) return 'Nieselregen';
  if (code <= 67) return 'Regen';
  if (code <= 77) return 'Schnee';
  if (code <= 82) return 'Schauer';
  if (code <= 99) return 'Gewitter';
  return 'wechselhaft';
}

function readCurrentTemp(data: OpenMeteoJson): number | null {
  if (typeof data.current?.temperature_2m === 'number') {
    return data.current.temperature_2m;
  }
  if (typeof data.current_weather?.temperature === 'number') {
    return data.current_weather.temperature;
  }
  // Fallback: nächste Stunden-Temp
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const now = Date.now();
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] ?? '');
    const ht = Number(temps[i]);
    if (!Number.isFinite(t) || !Number.isFinite(ht)) continue;
    const d = Math.abs(t - now);
    if (d < bestDist) {
      bestDist = d;
      best = ht;
    }
  }
  return best;
}

function readCurrentCode(data: OpenMeteoJson): number | null {
  if (typeof data.current?.weather_code === 'number') {
    return data.current.weather_code;
  }
  const legacy = data.current_weather?.weathercode ?? data.current_weather?.weather_code;
  return typeof legacy === 'number' ? legacy : null;
}

function readCurrentPrecip(data: OpenMeteoJson): number | null {
  if (typeof data.current?.precipitation === 'number') {
    return data.current.precipitation;
  }
  return null;
}

export function parseOpenMeteoForecast(
  data: OpenMeteoJson,
  opts: { lat: number; lng: number; fetchedAtMs?: number },
): OpenMeteoFallback | null {
  if (!data || typeof data !== 'object') return null;
  const temp = readCurrentTemp(data);
  const code = readCurrentCode(data);
  const precip = readCurrentPrecip(data);

  let nextRainAtMs: number | null = null;
  let nextRainProb: number | null = null;
  const rainWindows: Array<{ startMs: number; endMs: number; pop: number }> =
    [];
  const times = data.hourly?.time ?? [];
  const pops = data.hourly?.precipitation_probability ?? [];
  const precips = data.hourly?.precipitation ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const now = Date.now();
  const hours = times.map((iso, i) => ({
    atMs: Date.parse(iso ?? ''),
    popPct: Number(pops[i] ?? 0),
    precipMm: Number(precips[i] ?? 0),
  }));

  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] ?? '');
    if (!Number.isFinite(t) || t < now - 30 * 60_000) continue;
    const pop = Number(pops[i] ?? 0);
    const mm = Number(precips[i] ?? 0);
    // Fenster/Countdown nur mit mm — reine Pop% ohne Tropfen = kein „Regen in X Min“.
    if (mm >= 0.2) {
      if (nextRainAtMs == null) {
        nextRainAtMs = t;
        nextRainProb = pop;
      }
      const end = Date.parse(times[i + 1] ?? '') || t + 60 * 60_000;
      rainWindows.push({ startMs: t, endMs: end, pop });
    }
  }

  const label = wmoLabel(code);
  // precip=0 + WMO 80 (Schauer-Code) ist oft Modell-Rest, kein echter Regen.
  const rainingNow =
    (precip != null && precip >= 0.2) ||
    (precip == null && code != null && code >= 51 && code <= 99);
  const outlook = buildRainOutlook({
    hours,
    nowMs: now,
    untilMs: eveningCutoffMs(now),
    rainingNow,
    rainLabelNow: rainingNow ? label : null,
  });
  if (outlook.nextRainAtMs != null) {
    nextRainAtMs = outlook.nextRainAtMs;
    nextRainProb = outlook.nextRainPopPct;
  } else if (outlook.kind === 'dry') {
    nextRainAtMs = null;
    nextRainProb = null;
  } else if (outlook.kind === 'possible') {
    nextRainAtMs = null;
    nextRainProb = outlook.nextRainPopPct;
  }

  const evening = eveningCutoffMs(now);
  let dayHigh: number | null = null;
  let nightLow: number | null = null;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] ?? '');
    if (!Number.isFinite(t) || t < now - 30 * 60_000 || t > evening) continue;
    const ht = Number(temps[i]);
    if (Number.isFinite(ht)) {
      dayHigh = dayHigh == null ? ht : Math.max(dayHigh, ht);
    }
  }
  const nightEnd = now + 12 * 3600_000;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] ?? '');
    if (!Number.isFinite(t) || t < now || t > nightEnd) continue;
    const hr = new Date(t).getHours();
    if (hr < 21 && hr >= 8) continue;
    const ht = Number(temps[i]);
    if (Number.isFinite(ht)) {
      nightLow = nightLow == null ? ht : Math.min(nightLow, ht);
    }
  }

  const forecastBit =
    outlook.kind === 'dry' && dayHigh != null
      ? `heute bis ${Math.round(dayHigh)}°`
      : outlook.kind === 'rain_timed' && outlook.nextRainAtMs
        ? `Regen ab ${new Date(outlook.nextRainAtMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : outlook.shortLabel;

  const tempBit = temp != null ? `${Math.round(temp)}°` : 'Temperatur unklar';
  const summaryLine = `Aktuell ${tempBit} · ${label} · ${forecastBit}`;
  const dailyTimes = data.daily?.time ?? [];
  const dailyMax = data.daily?.temperature_2m_max ?? [];
  const dailyMin = data.daily?.temperature_2m_min ?? [];
  const dailyCode = data.daily?.weather_code ?? [];
  const dailyPop = data.daily?.precipitation_probability_max ?? [];
  let tomorrowSummary: string | null = null;
  if (dailyTimes.length >= 2) {
    const hi = Number(dailyMax[1]);
    const lo = Number(dailyMin[1]);
    const codeT = Number(dailyCode[1]);
    const popT = Number(dailyPop[1]);
    const bits: string[] = [];
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
    } else if (Number.isFinite(hi)) {
      bits.push(`bis ${Math.round(hi)}°`);
    }
    if (Number.isFinite(codeT)) bits.push(wmoLabel(codeT));
    if (Number.isFinite(popT) && popT >= 30) {
      bits.push(`Regenrisiko ${Math.round(popT)}%`);
    }
    if (bits.length) tomorrowSummary = bits.join(', ');
  }
  const promptBlock = [
    '=== WETTER (Open-Meteo Fallback) ===',
    summaryLine,
    outlook.speechSuffix.trim(),
    precip != null ? `Niederschlag jetzt: ${precip} mm` : null,
    dayHigh != null ? `Tageshoch bis Abend ca. ${Math.round(dayHigh)}°.` : null,
    tomorrowSummary,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    fetchedAtMs: opts.fetchedAtMs ?? Date.now(),
    lat: opts.lat,
    lng: opts.lng,
    currentTemp: temp,
    weatherCode: code,
    precipitationMm: precip,
    summaryLine,
    promptBlock,
    nextRainAtMs,
    nextRainProb,
    rainWindows,
    dayHighC: dayHigh,
    tomorrowSummary,
    nightLowC: nightLow,
  };
}

export async function fetchOpenMeteoFallback(opts: {
  lat: number;
  lng: number;
}): Promise<OpenMeteoFallback | null> {
  try {
    const { fetchSharedWeather } = await import('./weatherSharedCache');
    const { getCachedUserProfile } = await import('../userProfileService');
    const profile = getCachedUserProfile();
    const shared = await fetchSharedWeather({
      lat: opts.lat,
      lng: opts.lng,
      cityId: profile?.cityId ?? null,
      cityHint: profile?.cityName ?? null,
    });
    if (shared?.openMeteo && typeof shared.openMeteo === 'object') {
      const parsed = parseOpenMeteoForecast(shared.openMeteo as OpenMeteoJson, {
        lat: opts.lat,
        lng: opts.lng,
        fetchedAtMs: shared.fetchedAtMs,
      });
      if (parsed) return parsed;
    }
  } catch {
    /* fall through to direct Open-Meteo */
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(opts.lat));
    u.searchParams.set('longitude', String(opts.lng));
    u.searchParams.set(
      'current',
      'temperature_2m,weather_code,precipitation,wind_speed_10m',
    );
    u.searchParams.set(
      'hourly',
      'temperature_2m,precipitation_probability,precipitation',
    );
    u.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    );
    u.searchParams.set('forecast_days', '3');
    u.searchParams.set('timezone', 'auto');
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoJson;
    return parseOpenMeteoForecast(data, {
      lat: opts.lat,
      lng: opts.lng,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
