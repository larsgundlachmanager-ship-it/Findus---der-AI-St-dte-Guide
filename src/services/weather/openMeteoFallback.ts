/**
 * Kostenloser Wetter-Fallback ohne API-Key (Open-Meteo).
 * Nur wenn OpenWeather nicht konfiguriert / offline ist.
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

export async function fetchOpenMeteoFallback(opts: {
  lat: number;
  lng: number;
}): Promise<OpenMeteoFallback | null> {
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
    u.searchParams.set('forecast_days', '1');
    u.searchParams.set('timezone', 'auto');
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        precipitation?: number;
        time?: string;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        precipitation?: number[];
      };
    };
    const temp =
      typeof data.current?.temperature_2m === 'number'
        ? data.current.temperature_2m
        : null;
    const code =
      typeof data.current?.weather_code === 'number'
        ? data.current.weather_code
        : null;
    const precip =
      typeof data.current?.precipitation === 'number'
        ? data.current.precipitation
        : null;

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
      if (pop >= 40 || mm >= 0.2) {
        if (nextRainAtMs == null) {
          nextRainAtMs = t;
          nextRainProb = pop; // 0–100 wie OWM
        }
        const end = Date.parse(times[i + 1] ?? '') || t + 60 * 60_000;
        rainWindows.push({ startMs: t, endMs: end, pop });
      }
    }

    const label = wmoLabel(code);
    const rainingNow =
      (precip != null && precip >= 0.2) ||
      (code != null && code >= 51 && code <= 99);
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
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i] ?? '');
      if (!Number.isFinite(t) || t < now - 30 * 60_000 || t > evening) continue;
      const ht = Number(temps[i]);
      if (Number.isFinite(ht)) {
        dayHigh = dayHigh == null ? ht : Math.max(dayHigh, ht);
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

    const tempBit =
      temp != null ? `${Math.round(temp)}°` : 'Temperatur unklar';
    const summaryLine = `Aktuell ${tempBit} · ${label} · ${forecastBit}`;
    const promptBlock = [
      '=== WETTER (Open-Meteo Fallback) ===',
      summaryLine,
      outlook.speechSuffix.trim(),
      precip != null ? `Niederschlag jetzt: ${precip} mm` : null,
      dayHigh != null ? `Tageshoch bis Abend ca. ${Math.round(dayHigh)}°.` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      fetchedAtMs: Date.now(),
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
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
