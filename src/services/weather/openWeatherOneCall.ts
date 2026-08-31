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

/** Raw One Call 3.0 JSON (shared cache or direct API). */
export type OwmOneCallRaw = {
  current?: {
    temp?: number;
    sunrise?: number;
    sunset?: number;
    weather?: Array<{ id: number; description: string }>;
    rain?: { '1h'?: number };
  };
  minutely?: OwmMinutely[];
  hourly?: OwmHourly[];
  daily?: Array<{
    dt?: number;
    temp?: { min?: number; max?: number };
    weather?: Array<{ id?: number; description?: string }>;
    pop?: number;
  }>;
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
  /** Ende des aktuellen/kommenden Regenblocks (minutely oder hourly) */
  rainEndsAtMs: number | null;
  summaryLine: string;
  promptBlock: string;
  /** Gleichbleibend trocken den Tag über? */
  dayStableDry: boolean;
  /** Regenfenster für Planung (Modul 5) */
  rainWindows: Array<{ startMs: number; endMs: number; pop: number }>;
  rawHourly: OwmHourly[];
  /** Sonnenuntergang heute (ms), aus current.sunset */
  sunsetMs: number | null;
  /** Tageshoch bis Abend */
  dayHighC: number | null;
  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
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

/** Kurzer Himmel — nur aus belegter OWM-ID, kein Fantasie-Gewitter. */
function owmSkyBit(id: number | null | undefined): string | null {
  if (id == null || !Number.isFinite(id)) return null;
  if (id === 800) return 'klar / Sonne';
  if (id >= 801 && id <= 802) return 'Wolken und Sonne';
  if (id >= 803 && id <= 804) return 'bewölkt';
  if (id >= 200 && id < 300) return 'Gewitter';
  if (id >= 300 && id < 400) return 'Niesel';
  if (id >= 500 && id < 600) return 'Regen';
  if (id >= 600 && id < 700) return 'Schnee';
  if (id >= 700 && id < 800) return 'diesig';
  return null;
}

function buildTomorrowSummary(opts: {
  daily?: Array<{
    dt?: number;
    temp?: { min?: number; max?: number };
    weather?: Array<{ id?: number; description?: string }>;
    pop?: number;
  }>;
  hourly: OwmHourly[];
  nowMs: number;
}): string | null {
  const day = opts.daily?.[1];
  if (day?.temp) {
    const lo = day.temp.min;
    const hi = day.temp.max;
    const wid = day.weather?.[0]?.id ?? null;
    const popPct =
      typeof day.pop === 'number' && Number.isFinite(day.pop)
        ? Math.round(day.pop * 100)
        : null;
    const bits: string[] = [];
    if (
      typeof lo === 'number' &&
      typeof hi === 'number' &&
      Number.isFinite(lo) &&
      Number.isFinite(hi)
    ) {
      bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
    } else if (typeof hi === 'number' && Number.isFinite(hi)) {
      bits.push(`bis ${Math.round(hi)}°`);
    }
    const sky = owmSkyBit(wid);
    if (sky) bits.push(sky);
    if (popPct != null && popPct >= 30) {
      bits.push(`Regenrisiko ${popPct}%`);
    }
    if (bits.length) return bits.join(', ');
  }

  // Fallback: Hourly 24–48 h
  const start = opts.nowMs + 20 * 3600_000;
  const end = opts.nowMs + 44 * 3600_000;
  const slice = opts.hourly.filter((h) => {
    const t = h.dt * 1000;
    return t >= start && t <= end;
  });
  if (!slice.length) return null;
  let lo: number | null = null;
  let hi: number | null = null;
  let maxPop = 0;
  let skyId: number | null = null;
  for (const h of slice) {
    if (typeof h.temp === 'number' && Number.isFinite(h.temp)) {
      lo = lo == null ? h.temp : Math.min(lo, h.temp);
      hi = hi == null ? h.temp : Math.max(hi, h.temp);
    }
    maxPop = Math.max(maxPop, h.pop ?? 0);
    const id = h.weather?.[0]?.id;
    if (typeof id === 'number') skyId = id;
  }
  const bits: string[] = [];
  if (lo != null && hi != null) bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
  const sky = owmSkyBit(skyId);
  if (sky) bits.push(sky);
  const popPct = Math.round(maxPop * 100);
  if (popPct >= 30) bits.push(`Regenrisiko ${popPct}%`);
  return bits.length ? bits.join(', ') : null;
}

/**
 * Parse One Call JSON (from shared edge cache or direct API) into tracker/HUD result.
 */
export function parseOpenWeatherOneCallData(
  data: OwmOneCallRaw,
  opts: { lat: number; lng: number; fetchedAtMs?: number },
): OwmOneCallResult {
  const now =
    typeof opts.fetchedAtMs === 'number' && Number.isFinite(opts.fetchedAtMs)
      ? opts.fetchedAtMs
      : Date.now();
  const minutely = data.minutely ?? [];
  const hourly = data.hourly ?? [];

  let rainStartsInMin: number | null = null;
  let rainStartIdx = -1;
  for (let i = 0; i < minutely.length; i++) {
    const m = minutely[i]!;
    if ((m.precipitation ?? 0) >= PRECIP_MIN_MM) {
      rainStartIdx = i;
      rainStartsInMin = Math.max(0, Math.round((m.dt * 1000 - now) / 60_000));
      break;
    }
  }

  let nextRainAtMs: number | null = null;
  let nextRainProb: number | null = null;
  if (rainStartIdx >= 0) {
    nextRainAtMs = minutely[rainStartIdx]!.dt * 1000;
    nextRainProb = 90;
  }
  // Hourly: Countdown nur mit mm — Pop allein (z. B. 68 % / 0 mm) ≠ „Regen in 38 Min“.
  if (nextRainAtMs == null) {
    for (const h of hourly.slice(0, 18)) {
      const pop = h.pop ?? 0;
      const rainMm = h.rain?.['1h'] ?? 0;
      if (rainMm >= PRECIP_MIN_MM) {
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
    const wet =
      (h.rain?.['1h'] ?? 0) >= PRECIP_MIN_MM ||
      ((h.pop ?? 0) >= POP_THRESHOLD && (h.rain?.['1h'] ?? 0) > 0);
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

  /** Ende des nassen Blocks aus minutely (Wolke schneller/langsamer → neuer Fetch). */
  let rainEndsAtMs: number | null = null;
  if (minutely.length) {
    const fromIdx = rainStartIdx >= 0 ? rainStartIdx : 0;
    let seenWet = rainStartIdx >= 0;
    for (let j = fromIdx; j < minutely.length; j++) {
      const wet = (minutely[j]!.precipitation ?? 0) >= PRECIP_MIN_MM;
      if (wet) seenWet = true;
      else if (seenWet) {
        rainEndsAtMs = minutely[j]!.dt * 1000;
        break;
      }
    }
    if (seenWet && rainEndsAtMs == null) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
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
  const precipNow =
    data.current?.rain?.['1h'] ??
    (hourly[0]?.rain?.['1h'] ?? 0);
  // Minutely Slot 0/1 nass = fällt JETZT — nicht „in 25 Min“ obwohl draußen Schauer.
  const minutelyNowWet = minutely
    .slice(0, 2)
    .some((m) => (m.precipitation ?? 0) >= PRECIP_MIN_MM);
  const descWet =
    /regen|schauer|gewitter|drizzle|thunderstorm|\brain\b/i.test(desc);
  const weatherWet =
    typeof wid === 'number' && wid >= 200 && wid < 700;
  const rainingNow =
    precipNow >= PRECIP_MIN_MM ||
    minutelyNowWet ||
    weatherWet ||
    descWet ||
    (rainStartsInMin != null && rainStartsInMin <= 1);

  // Wenn's schon nass ist, Ende ab jetzt (nicht ab einem späteren Minutely-Start).
  if (rainingNow && minutely.length && rainStartIdx > 0) {
    let seenWet = false;
    let endFromNow: number | null = null;
    for (let j = 0; j < minutely.length; j++) {
      const wet = (minutely[j]!.precipitation ?? 0) >= PRECIP_MIN_MM;
      if (wet) seenWet = true;
      else if (seenWet) {
        endFromNow = minutely[j]!.dt * 1000;
        break;
      }
    }
    if (endFromNow != null) rainEndsAtMs = endFromNow;
    else if (seenWet) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
  }

  // Hourly-Fenster als Fallback wenn minutely kein Ende kennt
  if (rainEndsAtMs == null && rainWindows.length) {
    const anchor = rainingNow ? now : nextRainAtMs ?? now;
    const hit = rainWindows.find(
      (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
    );
    if (hit) rainEndsAtMs = hit.endMs;
  }

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

    if (rainingNow) {
      let shortLabel = desc;
      if (rainEndsAtMs != null && rainEndsAtMs > now + 60_000) {
        const leftMin = Math.max(1, Math.round((rainEndsAtMs - now) / 60_000));
        shortLabel =
          leftMin <= 60
            ? `Regen noch ${leftMin} Min`
            : `Regen bis ${clockLabel(rainEndsAtMs)}`;
      } else {
        shortLabel = 'Regen jetzt';
      }
      const untilSpeech =
        rainEndsAtMs != null && rainEndsAtMs > now + 60_000
          ? ` bis ${clockLabel(rainEndsAtMs)}`
          : '';
      outlook = {
        ...outlook,
        kind: 'raining',
        speechSuffix: ` Gerade ${desc}${untilSpeech}.`,
        shortLabel,
        nextRainAtMs: now,
        nextRainPopPct: Math.max(nextRainProb ?? 0, 80),
      };
      nextRainAtMs = now;
      nextRainProb = outlook.nextRainPopPct;
      rainStartsInMin = 0;
    } else if (rainStartsInMin != null && nextRainAtMs != null) {
    const pct = nextRainProb ?? 90;
    outlook = {
      ...outlook,
      kind: 'rain_timed',
      speechSuffix: ` Regen ab ca. ${clockLabel(nextRainAtMs)} (in ${rainStartsInMin} Min, ca. ${pct} %).`,
      shortLabel:
        rainStartsInMin <= 60
          ? `Regen in ${rainStartsInMin} Min`
          : `Regen ab ${clockLabel(nextRainAtMs)}`,
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

  const summaryLine = `Aktuell ${Math.round(temp ?? 0)}° · ${desc} · ${outlook.shortLabel}`;

  // Tageshoch aus Hourly (bis Abend) — sinnvollere HUD-Prognose
  let dayHigh: number | null = null;
  const evening = eveningCutoffMs(now);
  for (const h of hourly.slice(0, 24)) {
    if (h.dt * 1000 > evening) break;
    if (typeof h.temp === 'number' && Number.isFinite(h.temp)) {
      dayHigh = dayHigh == null ? h.temp : Math.max(dayHigh, h.temp);
    }
  }
  const forecastBit =
    outlook.kind === 'dry' && dayHigh != null
      ? `heute bis ${Math.round(dayHigh)}°`
      : outlook.kind === 'rain_timed' && outlook.nextRainAtMs
        ? `Regen ab ${clockLabel(outlook.nextRainAtMs)}`
        : outlook.shortLabel;
  const hudSummary =
    temp != null
      ? `Aktuell ${Math.round(temp)}° · ${desc} · ${forecastBit}`
      : summaryLine;

  const tomorrowSummary = buildTomorrowSummary({
    daily: data.daily,
    hourly,
    nowMs: now,
  });

  const promptBlock = [
    '=== OPENWEATHER ONE CALL 3.0 ===',
    hudSummary,
    outlook.speechSuffix.trim(),
    rainingNow
      ? rainEndsAtMs != null
        ? `Minutely: Regen jetzt bis ca. ${clockLabel(rainEndsAtMs)}.`
        : 'Minutely: Regen fällt gerade.'
      : rainStartsInMin != null
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
    dayHigh != null ? `Tageshoch bis Abend ca. ${Math.round(dayHigh)}°.` : '',
    tomorrowSummary ? `Morgen: ${tomorrowSummary}` : '',
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
    rainEndsAtMs,
    summaryLine: hudSummary,
    promptBlock,
    dayStableDry,
    rainWindows,
    rawHourly: hourly.slice(0, 48),
    sunsetMs: data.current?.sunset
      ? data.current.sunset * 1000
      : null,
    dayHighC: dayHigh,
    tomorrowSummary,
  };
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
    // daily behalten — sonst fehlt Morgen-Vorhersage (Chat improvisiert dann Quatsch)
    u.searchParams.set('exclude', 'alerts');

    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      console.warn('[owm] HTTP', res.status);
      return null;
    }
    const data = (await res.json()) as OwmOneCallRaw;
    return parseOpenWeatherOneCallData(data, {
      lat: opts.lat,
      lng: opts.lng,
    });
  } catch (err) {
    console.warn('[owm] fetch failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
