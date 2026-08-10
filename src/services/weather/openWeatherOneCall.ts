/**
 * OpenWeatherMap One Call API 3.0 — minutely + hourly Regen.
 * Key: EXPO_PUBLIC_OPENWEATHER_API_KEY
 */

import { env } from '../../config/env';
import {
  buildRainOutlook,
  eveningCutoffMs,
  pop01ToPct,
} from './weatherRainOutlook';

export type OwmMinutely = { dt: number; precipitation: number };
export type OwmHourly = {
  dt: number;
  temp: number;
  pop: number;
  weather?: Array<{ id: number; main: string; description: string }>;
  rain?: { '1h'?: number };
  wind_gust?: number;
};

export type OwmOneCallResult = {
  fetchedAtMs: number;
  lat: number;
  lng: number;
  currentTemp: number | null;
  currentWeatherId: number | null;
  currentPrecipMm: number | null;
  /** Erster Zeitpunkt mit spürbarem Regen (ms) */
  nextRainAtMs: number | null;
  nextRainProb: number | null;
  /** Minutely: Regen startet in X Minuten (präzise) */
  rainStartsInMin: number | null;
  summaryLine: string;
  promptBlock: string;
  /** Gleichbleibend trocken den Tag über? */
  dayStableDry: boolean;
  /** Regenfenster für Planung (Modul 5) */
  rainWindows: Array<{ startMs: number; endMs: number; pop: number }>;
  rawHourly: OwmHourly[];
  /** Sonnenuntergang heute (ms), aus current.sunset */
  sunsetMs: number | null;
};

const FETCH_MS = 10_000;
const PRECIP_MIN_MM = 0.1;
/** Ab dieser Wahrscheinlichkeit: Regenfenster nennen */
const POP_THRESHOLD = 0.4;

export function hasOpenWeatherKey(): boolean {
  return Boolean(env.openWeatherApiKey?.() || env.get('EXPO_PUBLIC_OPENWEATHER_API_KEY').trim());
}

function apiKey(): string {
  return (
    env.openWeatherApiKey?.() ||
    env.get('EXPO_PUBLIC_OPENWEATHER_API_KEY') ||
    ''
  ).trim();
}

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Fetch One Call 3.0. Returns null if no key / network fail.
 */
export async function fetchOpenWeatherOneCall(opts: {
  lat: number;
  lng: number;
}): Promise<OwmOneCallResult | null> {
  if (!hasOpenWeatherKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://api.openweathermap.org/data/3.0/onecall');
    u.searchParams.set('lat', String(opts.lat));
    u.searchParams.set('lon', String(opts.lng));
    u.searchParams.set('appid', apiKey());
    u.searchParams.set('units', 'metric');
    u.searchParams.set('lang', 'de');
    u.searchParams.set('exclude', 'daily,alerts');

    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      console.warn('[owm] HTTP', res.status);
      return null;
    }
    const data = (await res.json()) as {
      current?: {
        temp?: number;
        sunrise?: number;
        sunset?: number;
        weather?: Array<{ id: number; description: string }>;
        rain?: { '1h'?: number };
      };
      minutely?: OwmMinutely[];
      hourly?: OwmHourly[];
    };

    const now = Date.now();
    const minutely = data.minutely ?? [];
    const hourly = data.hourly ?? [];

    let rainStartsInMin: number | null = null;
    for (let i = 0; i < minutely.length; i++) {
      const m = minutely[i]!;
      if ((m.precipitation ?? 0) >= PRECIP_MIN_MM) {
        rainStartsInMin = Math.max(0, Math.round((m.dt * 1000 - now) / 60_000));
        break;
      }
    }

    let nextRainAtMs: number | null = null;
    let nextRainProb: number | null = null;
    if (rainStartsInMin != null && minutely.length) {
      const idx = minutely.findIndex(
        (m) => (m.precipitation ?? 0) >= PRECIP_MIN_MM,
      );
      if (idx >= 0) {
        nextRainAtMs = minutely[idx]!.dt * 1000;
        nextRainProb = 90;
      }
    }
    if (nextRainAtMs == null) {
      for (const h of hourly.slice(0, 18)) {
        const pop = h.pop ?? 0;
        const rainMm = h.rain?.['1h'] ?? 0;
        if (pop >= POP_THRESHOLD || rainMm >= PRECIP_MIN_MM) {
          nextRainAtMs = h.dt * 1000;
          nextRainProb = Math.round(pop * 100);
          break;
        }
      }
    }

    const rainWindows: OwmOneCallResult['rainWindows'] = [];
    let winStart: number | null = null;
    let winPop = 0;
    for (const h of hourly.slice(0, 24)) {
      const wet = (h.pop ?? 0) >= POP_THRESHOLD || (h.rain?.['1h'] ?? 0) >= PRECIP_MIN_MM;
      if (wet) {
        if (winStart == null) {
          winStart = h.dt * 1000;
          winPop = h.pop ?? 0;
        } else {
          winPop = Math.max(winPop, h.pop ?? 0);
        }
      } else if (winStart != null) {
        rainWindows.push({
          startMs: winStart,
          endMs: h.dt * 1000,
          pop: Math.round(winPop * 100),
        });
        winStart = null;
        winPop = 0;
      }
    }
    if (winStart != null) {
      const last = hourly[Math.min(23, hourly.length - 1)];
      rainWindows.push({
        startMs: winStart,
        endMs: (last?.dt ?? Date.now() / 1000) * 1000 + 3600_000,
        pop: Math.round(winPop * 100),
      });
    }

    const dayStableDry =
      nextRainAtMs == null &&
      rainWindows.length === 0 &&
      hourly.slice(0, 12).every((h) => (h.pop ?? 0) < 0.2);

    const temp = data.current?.temp ?? hourly[0]?.temp ?? null;
    const wid = data.current?.weather?.[0]?.id ?? null;
    const desc =
      data.current?.weather?.[0]?.description ??
      hourly[0]?.weather?.[0]?.description ??
      'unbekannt';
    const precipNow = data.current?.rain?.['1h'] ?? 0;
    const rainingNow =
      precipNow >= PRECIP_MIN_MM ||
      (typeof wid === 'number' && wid >= 200 && wid < 700);

    let outlook = buildRainOutlook({
      hours: hourly.slice(0, 24).map((h) => ({
        atMs: h.dt * 1000,
        popPct: pop01ToPct(h.pop),
        precipMm: h.rain?.['1h'] ?? 0,
      })),
      nowMs: now,
      untilMs: eveningCutoffMs(now),
      rainingNow,
      rainLabelNow: rainingNow ? desc : null,
    });

    if (rainStartsInMin != null && nextRainAtMs != null && !rainingNow) {
      const pct = nextRainProb ?? 90;
      outlook = {
        ...outlook,
        kind: 'rain_timed',
        speechSuffix: ` Regen ab ca. ${clockLabel(nextRainAtMs)} (in ${rainStartsInMin} Min, ca. ${pct} %).`,
        shortLabel: `Regen in ${rainStartsInMin} Min`,
        nextRainAtMs,
        nextRainPopPct: pct,
      };
    } else if (outlook.nextRainAtMs != null) {
      nextRainAtMs = outlook.nextRainAtMs;
      nextRainProb = outlook.nextRainPopPct;
    } else if (outlook.kind === 'dry') {
      nextRainAtMs = null;
      nextRainProb = null;
    }

    const summaryLine = `Wetter: ${Math.round(temp ?? 0)}° · ${desc} · ${outlook.shortLabel}`;

    const promptBlock = [
      '=== OPENWEATHER ONE CALL 3.0 ===',
      summaryLine,
      outlook.speechSuffix.trim(),
      rainStartsInMin != null
        ? `Minutely: Regen startet in ca. ${rainStartsInMin} Minuten.`
        : 'Minutely: kein unmittelbarer Regen.',
      rainWindows.length
        ? `Regenfenster: ${rainWindows
            .slice(0, 3)
            .map(
              (w) =>
                `${clockLabel(w.startMs)}–${clockLabel(w.endMs)} (~${w.pop}%)`,
            )
            .join(' · ')}`
        : 'Keine klaren Regenfenster heute.',
      dayStableDry
        ? 'Tageslage: gleichbleibend trocken → seltener rechecken.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      fetchedAtMs: now,
      lat: opts.lat,
      lng: opts.lng,
      currentTemp: temp,
      currentWeatherId: wid,
      currentPrecipMm: precipNow,
      nextRainAtMs,
      nextRainProb,
      rainStartsInMin,
      summaryLine,
      promptBlock,
      dayStableDry,
      rainWindows,
      rawHourly: hourly.slice(0, 24),
      sunsetMs: data.current?.sunset
        ? data.current.sunset * 1000
        : null,
    };
  } catch (err) {
    console.warn('[owm] fetch failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
