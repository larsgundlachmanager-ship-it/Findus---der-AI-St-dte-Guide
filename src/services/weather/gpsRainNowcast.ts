/**
 * GPS-genaues Regen-Nowcast (Open-Meteo minutely_15).
 *
 * Shared-Cache rundet auf ~5 km — hier: exakte lat/lng.
 * DE/Zentraleuropa: DWD ICON-D2 15-Min (Wolken/Niederschlag an deiner Position).
 * Ohne OWM-Key trotzdem lokalere Regenfront als Stunden-% am Viertel-Zentrum.
 */

const FETCH_MS = 7_000;
/** mm in 15-Min-Bucket ≈ spürbarer Niederschlag */
const WET_MM_15 = 0.05;
/** Wie weit voraus schauen (16×15 Min ≈ 4 h) */
const FORECAST_STEPS = 16;

export type GpsRainNowcast = {
  fetchedAtMs: number;
  lat: number;
  lng: number;
  currentPrecipMm: number | null;
  weatherCode: number | null;
  rainingNow: boolean;
  nextRainAtMs: number | null;
  rainEndsAtMs: number | null;
  rainStartsInMin: number | null;
};

type Minutely15Json = {
  current?: {
    precipitation?: number;
    weather_code?: number;
  };
  minutely_15?: {
    time?: string[];
    precipitation?: number[];
    weather_code?: number[];
  };
};

export function parseGpsRainNowcast(
  data: Minutely15Json,
  opts: { lat: number; lng: number; fetchedAtMs?: number; nowMs?: number },
): GpsRainNowcast | null {
  const times = data.minutely_15?.time ?? [];
  const precips = data.minutely_15?.precipitation ?? [];
  if (!times.length || !precips.length) return null;

  const now = opts.nowMs ?? Date.now();
  const samples: Array<{ atMs: number; precipMm: number; code: number | null }> =
    [];
  for (let i = 0; i < times.length; i++) {
    const atMs = Date.parse(times[i] ?? '');
    if (!Number.isFinite(atMs)) continue;
    const precipMm = Number(precips[i] ?? 0);
    const codeRaw = data.minutely_15?.weather_code?.[i];
    samples.push({
      atMs,
      precipMm: Number.isFinite(precipMm) ? precipMm : 0,
      code: typeof codeRaw === 'number' ? codeRaw : null,
    });
  }
  if (!samples.length) return null;

  const currentPrecip =
    typeof data.current?.precipitation === 'number'
      ? data.current.precipitation
      : null;
  const weatherCode =
    typeof data.current?.weather_code === 'number'
      ? data.current.weather_code
      : samples.find((s) => s.atMs >= now - 20 * 60_000)?.code ?? null;

  const near = samples.filter(
    (s) => s.atMs >= now - 20 * 60_000 && s.atMs <= now + 20 * 60_000,
  );
  const rainingNow =
    (currentPrecip != null && currentPrecip >= 0.1) ||
    near.some((s) => s.precipMm >= WET_MM_15);

  let nextRainAtMs: number | null = null;
  let rainEndsAtMs: number | null = null;

  if (rainingNow) {
    nextRainAtMs = now;
    for (const s of samples) {
      if (s.atMs < now - 5 * 60_000) continue;
      if (s.precipMm < WET_MM_15) {
        rainEndsAtMs = s.atMs;
        break;
      }
    }
    if (rainEndsAtMs == null && samples.length) {
      rainEndsAtMs = samples[samples.length - 1]!.atMs + 15 * 60_000;
    }
  } else {
    for (const s of samples) {
      if (s.atMs < now - 2 * 60_000) continue;
      if (s.precipMm >= WET_MM_15) {
        nextRainAtMs = s.atMs;
        break;
      }
    }
    if (nextRainAtMs != null) {
      let seen = false;
      for (const s of samples) {
        if (s.atMs < nextRainAtMs) continue;
        if (s.precipMm >= WET_MM_15) seen = true;
        else if (seen) {
          rainEndsAtMs = s.atMs;
          break;
        }
      }
      if (seen && rainEndsAtMs == null && samples.length) {
        rainEndsAtMs = samples[samples.length - 1]!.atMs + 15 * 60_000;
      }
    }
  }

  const rainStartsInMin =
    nextRainAtMs != null && !rainingNow
      ? Math.max(0, Math.round((nextRainAtMs - now) / 60_000))
      : rainingNow
        ? 0
        : null;

  return {
    fetchedAtMs: opts.fetchedAtMs ?? now,
    lat: opts.lat,
    lng: opts.lng,
    currentPrecipMm: currentPrecip,
    weatherCode,
    rainingNow,
    nextRainAtMs,
    rainEndsAtMs,
    rainStartsInMin,
  };
}

/** Viertel sagt Regen ≤ so nah → einmal GPS-genau nachziehen. */
export const GPS_NOWCAST_WITHIN_MS = 15 * 60_000;

/**
 * Ab dieser Regenwahrscheinlichkeit (nächste Stunden) lohnt GPS-Nachschauen.
 * Darunter (~20 %) → kein Check (fühlt sich trocken an).
 */
export const GPS_RAIN_RISK_POP_MIN = 45;

/** Bei erhöhtem Risiko: frühestens so oft GPS-Nowcast (App muss ohnehin offen sein). */
export const GPS_RAIN_RISK_PROBE_MS = 15 * 60_000;

/** @deprecated Use GPS_RAIN_RISK_PROBE_MS — Name blieb für Imports. */
export const GPS_DRY_PROBE_MS = GPS_RAIN_RISK_PROBE_MS;

/**
 * Max. Regen-% in den nächsten Stunden aus Base-Wetter (OWM Pop / Fenster).
 * 0–100.
 */
export function maxNearTermRainPopPct(opts: {
  nowMs?: number;
  nextRainProb?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop?: number }> | null;
  /** Hourly pop: 0–1 oder 0–100 */
  hourlyPops?: Array<number | null | undefined> | null;
  /** Horizont für „könnte es bald regnen?“ */
  horizonMs?: number;
}): number {
  const now = opts.nowMs ?? Date.now();
  const horizon = opts.horizonMs ?? 6 * 60 * 60_000;
  let max = 0;
  if (
    opts.nextRainProb != null &&
    Number.isFinite(opts.nextRainProb) &&
    opts.nextRainProb > 0
  ) {
    max = Math.max(max, Math.round(opts.nextRainProb));
  }
  for (const w of opts.rainWindows ?? []) {
    if (!w || w.endMs < now || w.startMs > now + horizon) continue;
    const p = w.pop;
    if (p == null || !Number.isFinite(p)) continue;
    max = Math.max(max, p <= 1 ? Math.round(p * 100) : Math.round(p));
  }
  for (const raw of opts.hourlyPops ?? []) {
    if (raw == null || !Number.isFinite(raw)) continue;
    max = Math.max(max, raw <= 1 ? Math.round(raw * 100) : Math.round(raw));
  }
  return Math.min(100, Math.max(0, max));
}

/**
 * Himmel wirkt unruhig (Wolken/Schauer-Codes) — allein kein Check,
 * aber zusammen mit mittlerer Pop eher nachschauen.
 */
export function skyLooksUnsettled(
  weatherCode: number | null | undefined,
): boolean {
  if (weatherCode == null || !Number.isFinite(weatherCode)) return false;
  const c = weatherCode;
  // OWM: Niederschlag / Gewitter
  if (c >= 200 && c < 700) return true;
  // OWM: stark bewölkt / bedeckt (803–804) — „Wolken und Sonne“ 801–802 nur mit Pop
  if (c >= 803 && c <= 804) return true;
  // WMO/Open-Meteo: bedeckt / Niederschlag
  if (c >= 2 && c <= 3) return true;
  if (c >= 51) return true;
  return false;
}

/** Klarer Himmel (OWM 800 / WMO 0) — bei niedriger Pop kein GPS-Regen-Check. */
export function skyLooksClearDry(
  weatherCode: number | null | undefined,
): boolean {
  if (weatherCode == null || !Number.isFinite(weatherCode)) return false;
  return weatherCode === 800 || weatherCode === 0;
}

/**
 * GPS-Nowcast nur wenn:
 * - es schon nass ist / Regen ≤ ~15 Min, oder
 * - die grobe Lage spürbares Regenrisiko hat (≥ ~45 %) und der letzte Probe alt ist.
 *
 * Nicht: alle X Minuten bei 30° / blauem Himmel / 20 % Pop.
 */
export function shouldFetchGpsRainNowcast(opts: {
  nowMs?: number;
  nextRainAtMs?: number | null;
  rainStartsInMin?: number | null;
  rainingNow?: boolean;
  currentPrecipMm?: number | null;
  lastGpsNowcastAtMs?: number | null;
  /** true = Tageslage klar trocken (OWM) */
  dayStableDry?: boolean | null;
  nextRainProb?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop?: number }> | null;
  hourlyPops?: Array<number | null | undefined> | null;
  weatherCode?: number | null;
  /** Vorberechnetes Max-%; sonst aus den Feldern oben. */
  maxNearPopPct?: number | null;
}): boolean {
  if (opts.rainingNow) return true;
  if (
    opts.currentPrecipMm != null &&
    Number.isFinite(opts.currentPrecipMm) &&
    opts.currentPrecipMm >= 0.1
  ) {
    return true;
  }
  const now = opts.nowMs ?? Date.now();
  if (
    opts.nextRainAtMs != null &&
    Number.isFinite(opts.nextRainAtMs) &&
    opts.nextRainAtMs - now <= GPS_NOWCAST_WITHIN_MS &&
    opts.nextRainAtMs >= now - 5 * 60_000
  ) {
    return true;
  }
  if (
    opts.rainStartsInMin != null &&
    Number.isFinite(opts.rainStartsInMin) &&
    opts.rainStartsInMin >= 0 &&
    opts.rainStartsInMin * 60_000 <= GPS_NOWCAST_WITHIN_MS
  ) {
    return true;
  }

  const pop =
    opts.maxNearPopPct != null && Number.isFinite(opts.maxNearPopPct)
      ? Math.round(opts.maxNearPopPct)
      : maxNearTermRainPopPct({
          nowMs: now,
          nextRainProb: opts.nextRainProb,
          rainWindows: opts.rainWindows,
          hourlyPops: opts.hourlyPops,
        });

  // Stabil trocken + klarer Himmel + niedrige Pop → nie spekulativ pollen.
  if (
    opts.dayStableDry &&
    pop < GPS_RAIN_RISK_POP_MIN &&
    (skyLooksClearDry(opts.weatherCode) || pop < 25)
  ) {
    return false;
  }

  // Risiko zu niedrig (z. B. 20 %) → kein GPS-Check.
  // Ab ~45–50 % (oder unruhiger Himmel mit mind. 40 %) → periodisch nachsehen.
  const riskEnough =
    pop >= GPS_RAIN_RISK_POP_MIN ||
    (pop >= 40 && skyLooksUnsettled(opts.weatherCode));
  if (!riskEnough) return false;

  const last = opts.lastGpsNowcastAtMs;
  const interval =
    pop >= 70 ? Math.floor(GPS_RAIN_RISK_PROBE_MS * 0.67) : GPS_RAIN_RISK_PROBE_MS;
  if (last == null || !Number.isFinite(last) || now - last >= interval) {
    return true;
  }
  return false;
}

/**
 * Exakte GPS-Position → 15-Min-Niederschlag (DWD ICON-D2 in DE).
 * Nicht über Shared-Cell — Absicht: dein Punkt, nicht das Viertel-Zentrum.
 */
export async function fetchGpsRainNowcast(opts: {
  lat: number;
  lng: number;
}): Promise<GpsRainNowcast | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(opts.lat));
    u.searchParams.set('longitude', String(opts.lng));
    u.searchParams.set('current', 'precipitation,weather_code');
    u.searchParams.set('minutely_15', 'precipitation,weather_code');
    u.searchParams.set('forecast_minutely_15', String(FORECAST_STEPS));
    u.searchParams.set('timezone', 'auto');
    // Nächste Modellzelle am GPS, nicht interpolierte Flächenmitte
    u.searchParams.set('cell_selection', 'nearest');
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Minutely15Json;
    return parseGpsRainNowcast(data, {
      lat: opts.lat,
      lng: opts.lng,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Nowcast schlägt grobe Stunden-% für Timing; Temp/Tageslage bleibt vom Base. */
export function applyGpsNowcastToTiming<
  T extends {
    nextRainAtMs: number | null;
    rainStartsInMin?: number | null;
    rainEndsAtMs?: number | null;
    currentPrecipMm?: number | null;
    currentWeatherId?: number | null;
    dayStableDry?: boolean;
    summaryLine?: string;
    currentTemp?: number | null;
  },
>(base: T, nowcast: GpsRainNowcast | null): T {
  if (!nowcast) return base;
  const next = { ...base };
  // Nowcast kennt die nächsten ~4 h an deinem GPS — Vorrang vor Pop-Stunden.
  next.nextRainAtMs = nowcast.nextRainAtMs;
  next.rainStartsInMin = nowcast.rainStartsInMin;
  next.rainEndsAtMs = nowcast.rainEndsAtMs ?? base.rainEndsAtMs ?? null;
  if (nowcast.currentPrecipMm != null) {
    next.currentPrecipMm = nowcast.currentPrecipMm;
  }
  if (nowcast.weatherCode != null && 'currentWeatherId' in next) {
    next.currentWeatherId = nowcast.weatherCode;
  }
  if ('dayStableDry' in next) {
    next.dayStableDry = nowcast.nextRainAtMs == null && !nowcast.rainingNow;
  }
  // HUD-Summary oft noch „leicht bewölkt“, obwohl GPS schon nass ist.
  if (nowcast.rainingNow && typeof next.summaryLine === 'string') {
    next.summaryLine = summaryWithGpsRain(next, nowcast);
  }
  return next;
}

function clockBit(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Temp behalten, Himmelslage durch Regen ersetzen (HUD-Emoji/Headline). */
export function summaryWithGpsRain(
  base: {
    summaryLine?: string;
    currentTemp?: number | null;
    currentTempC?: number | null;
  },
  nowcast: Pick<GpsRainNowcast, 'rainEndsAtMs' | 'rainingNow'>,
): string {
  const tempRaw = base.currentTemp ?? base.currentTempC ?? null;
  const tempBit =
    tempRaw != null && Number.isFinite(tempRaw)
      ? `Aktuell ${Math.round(tempRaw)}° · `
      : '';
  const until =
    nowcast.rainEndsAtMs != null && nowcast.rainEndsAtMs > Date.now() + 60_000
      ? ` bis ${clockBit(nowcast.rainEndsAtMs)}`
      : '';
  return `${tempBit}Regen${until}`.trim();
}
