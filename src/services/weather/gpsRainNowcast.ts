/**
 * GPS-Punkt Regen-Nowcast.
 *
 * Primär (DE): Bright Sky `/radar` = DWD RADOLAN/RV, 1 km · 5 Min (+ ~2 h Forecast).
 * Fallback: Open-Meteo minutely_15 (ICON-D2, 15 Min) — nicht Radar.
 *
 * Bias: Start etwas früher warnen, Ende etwas länger halten.
 * Nie „regnet schon“, wenn der Punkt-Radar noch trocken ist.
 */

import { RAIN_END_MIN_DRY_GAP_MS } from './rainIncomingPolicy';

const FETCH_MS = 7_000;
/** mm in 15-Min-Bucket ≈ spürbarer Niederschlag (Open-Meteo Fallback) */
const WET_MM_15 = 0.05;
/** Wie weit voraus schauen (16×15 Min ≈ 4 h) */
const FORECAST_STEPS = 16;

/**
 * Bright Sky `precipitation_5`: Einheit 0.01 mm / 5 Min.
 * ≥1 = Spurregen (wie leichte Radar-Kante); Peak-Filter killt Rauschen.
 */
export const RADAR_WET_UNITS = 1;
/** Runs mit Peak darunter = Flecken, kein HUD-Schauer. */
export const RADAR_NOISE_PEAK_MIN = 3;
/** Countdown: Start so viele ms früher zeigen (nicht „schon nass“). */
export const RADAR_EARLY_WARN_MS = 2 * 60_000;
/** Nach Radar-trocken noch so lange „fällt noch“. */
export const RADAR_LATE_CLEAR_MS = 3 * 60_000;
/** 3×3 um den GPS-Punkt (1 km Radius). */
const RADAR_DISTANCE_M = 1000;

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
  /** 'brightsky_rv' | 'open_meteo_15' | null */
  source?: string | null;
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

export type BrightSkyRadarJson = {
  radar?: Array<{
    timestamp?: string;
    precipitation_5?: number[][];
  }>;
  latlon_position?: { x?: number; y?: number };
  bbox?: number[];
};

export type RainSample = { atMs: number; precipMm: number };

/**
 * Punkt-Serie → rainingNow / Start / Ende.
 * earlyWarn verschiebt nur den Countdown-Start (nicht rainingNow).
 * lateClear hält rainingNow nach dem letzten nassen Frame.
 */
export function timingFromRainSamples(
  samples: RainSample[],
  opts: {
    nowMs: number;
    stepMs: number;
    wetMm: number;
    earlyWarnMs?: number;
    lateClearMs?: number;
    /** Optional: Peak-Filter für zusammenhängende Runs (Radar-Rauschen). */
    noisePeakMin?: number | null;
  },
): Pick<
  GpsRainNowcast,
  'rainingNow' | 'nextRainAtMs' | 'rainEndsAtMs' | 'rainStartsInMin' | 'currentPrecipMm'
> {
  const now = opts.nowMs;
  const early = opts.earlyWarnMs ?? 0;
  const late = opts.lateClearMs ?? 0;
  const noisePeak = opts.noisePeakMin ?? null;
  const sorted = [...samples]
    .filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.precipMm))
    .sort((a, b) => a.atMs - b.atMs);
  if (!sorted.length) {
    return {
      rainingNow: false,
      nextRainAtMs: null,
      rainEndsAtMs: null,
      rainStartsInMin: null,
      currentPrecipMm: null,
    };
  }

  const wetFlags = sorted.map((s) => s.precipMm >= opts.wetMm);
  type Run = { startI: number; endI: number; peak: number };
  const runs: Run[] = [];
  let i = 0;
  while (i < wetFlags.length) {
    if (!wetFlags[i]) {
      i++;
      continue;
    }
    const startI = i;
    let peak = sorted[i]!.precipMm;
    i++;
    while (i < wetFlags.length && wetFlags[i]) {
      peak = Math.max(peak, sorted[i]!.precipMm);
      i++;
    }
    runs.push({ startI, endI: i - 1, peak });
  }

  const significantRaw =
    noisePeak == null
      ? runs
      : runs.filter((r) => r.peak >= noisePeak);

  // Flatterpausen < 30 Min = noch derselbe Schauer (nicht „hört in 36 Min auf“).
  const significant: Run[] = [];
  for (const r of significantRaw) {
    if (!significant.length) {
      significant.push({ ...r });
      continue;
    }
    const prev = significant[significant.length - 1]!;
    const gapMs = sorted[r.startI]!.atMs - sorted[prev.endI]!.atMs;
    if (gapMs < RAIN_END_MIN_DRY_GAP_MS) {
      prev.endI = r.endI;
      prev.peak = Math.max(prev.peak, r.peak);
    } else {
      significant.push({ ...r });
    }
  }

  // Aktueller Frame ≈ letzter Sample ≤ now (+ halber Step Toleranz).
  let curIdx = -1;
  for (let k = 0; k < sorted.length; k++) {
    if (sorted[k]!.atMs <= now + opts.stepMs / 2) curIdx = k;
  }
  const currentPrecipMm =
    curIdx >= 0 ? Math.round(sorted[curIdx]!.precipMm * 1000) / 1000 : null;

  // Aktiver / nächster Run: noch nicht vorbei (inkl. Late-Clear), Start im Horizont.
  const horizonMs = now + 12 * 60 * 60_000;
  const active =
    significant.find((r) => {
      const startMs = sorted[r.startI]!.atMs;
      const after = r.endI + 1;
      const endMs =
        after < sorted.length
          ? sorted[after]!.atMs
          : sorted[r.endI]!.atMs + opts.stepMs;
      return endMs + late > now && startMs - early <= horizonMs;
    }) ?? null;

  let radarStartMs: number | null = null;
  let radarEndMs: number | null = null;
  if (active) {
    // Midpoint zwischen letztem trocken / erstem nass (03:20→03:25 ⇒ ~03:22).
    const si = active.startI;
    radarStartMs =
      si > 0
        ? Math.round((sorted[si - 1]!.atMs + sorted[si]!.atMs) / 2)
        : sorted[si]!.atMs;
    const after = active.endI + 1;
    radarEndMs =
      after < sorted.length
        ? Math.round((sorted[active.endI]!.atMs + sorted[after]!.atMs) / 2)
        : sorted[active.endI]!.atMs + Math.round(opts.stepMs / 2);
  }

  const warnStartMs =
    radarStartMs != null ? radarStartMs - early : null;
  const holdEndMs = radarEndMs != null ? radarEndMs + late : null;

  // „Schon nass“ erst ab echtem Radar-Start; Late-Clear hält bis holdEnd.
  // Early-Warn nur für Countdown (warnStart), nie für rainingNow.
  const rainingNow =
    radarStartMs != null &&
    holdEndMs != null &&
    now >= radarStartMs &&
    now < holdEndMs;

  // Countdown zeigt warnStart (früher); im Early-Fenster tickt bis Radar-Start.
  let nextRainAtMs: number | null = null;
  if (rainingNow) {
    nextRainAtMs = now;
  } else if (warnStartMs != null && radarStartMs != null) {
    if (now < warnStartMs) nextRainAtMs = warnStartMs;
    else if (now < radarStartMs) nextRainAtMs = radarStartMs;
  }

  const rainEndsAtMs =
    holdEndMs != null && (rainingNow || nextRainAtMs != null)
      ? holdEndMs
      : null;

  const rainStartsInMin =
    nextRainAtMs != null && !rainingNow
      ? Math.max(0, Math.round((nextRainAtMs - now) / 60_000))
      : rainingNow
        ? 0
        : null;

  return {
    rainingNow,
    nextRainAtMs,
    rainEndsAtMs,
    rainStartsInMin,
    currentPrecipMm: rainingNow
      ? Math.max(currentPrecipMm ?? 0, 0.05)
      : currentPrecipMm ?? 0,
  };
}

/** Bright Sky Grid → mm am GPS-Pixel. */
export function precipMmFromRadarUnits(units: number): number {
  // 1 Unit = 0.01 mm / 5 Min
  return Math.max(0, units) * 0.01;
}

export function parseBrightSkyRadarNowcast(
  data: BrightSkyRadarJson,
  opts: {
    lat: number;
    lng: number;
    fetchedAtMs?: number;
    nowMs?: number;
    earlyWarnMs?: number;
    lateClearMs?: number;
  },
): GpsRainNowcast | null {
  const frames = data.radar ?? [];
  if (!frames.length) return null;
  const pos = data.latlon_position ?? { x: 0, y: 0 };
  const samples: RainSample[] = [];

  for (const frame of frames) {
    const atMs = Date.parse(frame.timestamp ?? '');
    if (!Number.isFinite(atMs)) continue;
    const grid = frame.precipitation_5;
    if (!grid?.length) continue;
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    if (!cols) continue;
    const ix = Math.max(0, Math.min(cols - 1, Math.round(Number(pos.x) || 0)));
    const iy = Math.max(0, Math.min(rows - 1, Math.round(Number(pos.y) || 0)));
    const units = Number(grid[iy]?.[ix] ?? 0);
    samples.push({
      atMs,
      precipMm: precipMmFromRadarUnits(Number.isFinite(units) ? units : 0),
    });
  }
  if (!samples.length) return null;

  const now = opts.nowMs ?? Date.now();
  const timing = timingFromRainSamples(samples, {
    nowMs: now,
    stepMs: 5 * 60_000,
    wetMm: precipMmFromRadarUnits(RADAR_WET_UNITS),
    earlyWarnMs: opts.earlyWarnMs ?? RADAR_EARLY_WARN_MS,
    lateClearMs: opts.lateClearMs ?? RADAR_LATE_CLEAR_MS,
    noisePeakMin: precipMmFromRadarUnits(RADAR_NOISE_PEAK_MIN),
  });

  return {
    fetchedAtMs: opts.fetchedAtMs ?? now,
    lat: opts.lat,
    lng: opts.lng,
    weatherCode: null,
    source: 'brightsky_rv',
    ...timing,
  };
}

/**
 * Open-Meteo 15-Min Fallback.
 * rainingNow nur aus Current / vergangenen+aktuellen Buckets — nie aus Zukunft (±20 Min Bug).
 */
export function parseGpsRainNowcast(
  data: Minutely15Json,
  opts: {
    lat: number;
    lng: number;
    fetchedAtMs?: number;
    nowMs?: number;
    earlyWarnMs?: number;
    lateClearMs?: number;
  },
): GpsRainNowcast | null {
  const times = data.minutely_15?.time ?? [];
  const precips = data.minutely_15?.precipitation ?? [];
  if (!times.length || !precips.length) return null;

  const now = opts.nowMs ?? Date.now();
  const samples: RainSample[] = [];
  for (let i = 0; i < times.length; i++) {
    const atMs = Date.parse(times[i] ?? '');
    if (!Number.isFinite(atMs)) continue;
    const precipMm = Number(precips[i] ?? 0);
    samples.push({
      atMs,
      precipMm: Number.isFinite(precipMm) ? precipMm : 0,
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
      : null;

  // Current-Hook: wenn API „jetzt“ nass meldet, Sample bei now anreichern.
  if (currentPrecip != null && currentPrecip >= 0.1) {
    samples.push({ atMs: now, precipMm: currentPrecip });
  }

  const timing = timingFromRainSamples(samples, {
    nowMs: now,
    stepMs: 15 * 60_000,
    wetMm: WET_MM_15,
    earlyWarnMs: opts.earlyWarnMs ?? RADAR_EARLY_WARN_MS,
    lateClearMs: opts.lateClearMs ?? RADAR_LATE_CLEAR_MS,
    noisePeakMin: null,
  });

  return {
    fetchedAtMs: opts.fetchedAtMs ?? now,
    lat: opts.lat,
    lng: opts.lng,
    weatherCode,
    source: 'open_meteo_15',
    ...timing,
    currentPrecipMm:
      currentPrecip != null ? currentPrecip : timing.currentPrecipMm,
  };
}

/** Viertel sagt Regen ≤ so nah → einmal GPS-genau nachziehen. */
export const GPS_NOWCAST_WITHIN_MS = 15 * 60_000;

/**
 * Ab dieser Regenwahrscheinlichkeit (nächste Stunden) lohnt GPS-Nachschauen.
 * Darunter (~20 %) → kein Check (fühlt sich trocken an).
 */
export const GPS_RAIN_RISK_POP_MIN = 45;

/** Bei erhöhtem Risiko: frühestens so oft Nowcast (Shared-Radar-Takt ~5 Min). */
export const GPS_RAIN_RISK_PROBE_MS = 5 * 60_000;

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
  // WMO/Open-Meteo (0–99): bedeckt / Niederschlag — nicht OWM 8xx treffen
  if (c >= 2 && c <= 3) return true;
  if (c >= 51 && c <= 99) return true;
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
  // Bewölkt/unruhig darf trotz „dayStableDry“/niedriger Pop nachschauen
  // (lokale Schauer, die OWM-Viertel noch als trocken führen).
  if (
    opts.dayStableDry &&
    pop < GPS_RAIN_RISK_POP_MIN &&
    skyLooksClearDry(opts.weatherCode)
  ) {
    return false;
  }

  const last = opts.lastGpsNowcastAtMs;
  const interval =
    pop >= 70 ? Math.floor(GPS_RAIN_RISK_PROBE_MS * 0.67) : GPS_RAIN_RISK_PROBE_MS;
  const due =
    last == null || !Number.isFinite(last) || now - last >= interval;

  // Unbekannter Himmel (frisch / nur GPS): einmal Radar, sonst bleibt Regen unsichtbar.
  if (
    due &&
    (opts.weatherCode == null || !Number.isFinite(opts.weatherCode))
  ) {
    return true;
  }

  // Ab ~45 % Pop — oder bedeckt/unruhig: GPS-Radar (lokale Schauer).
  const riskEnough =
    pop >= GPS_RAIN_RISK_POP_MIN || skyLooksUnsettled(opts.weatherCode);
  if (!riskEnough) return false;
  return due;
}

async function fetchBrightSkyRadarNowcast(opts: {
  lat: number;
  lng: number;
  signal: AbortSignal;
}): Promise<GpsRainNowcast | null> {
  const u = new URL('https://api.brightsky.dev/radar');
  u.searchParams.set('lat', String(opts.lat));
  u.searchParams.set('lon', String(opts.lng));
  u.searchParams.set('distance', String(RADAR_DISTANCE_M));
  u.searchParams.set('format', 'plain');
  u.searchParams.set('tz', 'Europe/Berlin');
  const res = await fetch(u.toString(), {
    signal: opts.signal,
    headers: {
      Accept: 'application/json',
      // Bright Sky verlangt explizit br|zstd|gzip für plain/bytes.
      'Accept-Encoding': 'gzip',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as BrightSkyRadarJson;
  return parseBrightSkyRadarNowcast(data, {
    lat: opts.lat,
    lng: opts.lng,
  });
}

async function fetchOpenMeteoRainNowcast(opts: {
  lat: number;
  lng: number;
  signal: AbortSignal;
}): Promise<GpsRainNowcast | null> {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(opts.lat));
  u.searchParams.set('longitude', String(opts.lng));
  u.searchParams.set('current', 'precipitation,weather_code');
  u.searchParams.set('minutely_15', 'precipitation,weather_code');
  u.searchParams.set('forecast_minutely_15', String(FORECAST_STEPS));
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('cell_selection', 'nearest');
  const res = await fetch(u.toString(), { signal: opts.signal });
  if (!res.ok) return null;
  const data = (await res.json()) as Minutely15Json;
  return parseGpsRainNowcast(data, {
    lat: opts.lat,
    lng: opts.lng,
  });
}

/**
 * Regen-Nowcast: Shared Edge (~1 km Zelle) first, sonst Bright Sky am GPS,
 * sonst Open-Meteo 15-Min.
 */
export async function fetchGpsRainNowcast(opts: {
  lat: number;
  lng: number;
}): Promise<GpsRainNowcast | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    try {
      const { fetchSharedRainNowcast } = await import(
        './fetchSharedRainNowcast'
      );
      const shared = await fetchSharedRainNowcast({
        lat: opts.lat,
        lng: opts.lng,
      });
      if (shared) return shared;
    } catch {
      /* shared optional */
    }
    const radar = await fetchBrightSkyRadarNowcast({
      lat: opts.lat,
      lng: opts.lng,
      signal: ctrl.signal,
    });
    if (radar) return radar;
    return await fetchOpenMeteoRainNowcast({
      lat: opts.lat,
      lng: opts.lng,
      signal: ctrl.signal,
    });
  } catch {
    try {
      return await fetchOpenMeteoRainNowcast({
        lat: opts.lat,
        lng: opts.lng,
        signal: ctrl.signal,
      });
    } catch {
      return null;
    }
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
  // Nowcast kennt die nächsten ~2–4 h an deinem GPS — Vorrang vor Pop-Stunden.
  next.nextRainAtMs = nowcast.nextRainAtMs;
  next.rainStartsInMin = nowcast.rainStartsInMin;
  next.rainEndsAtMs = nowcast.rainEndsAtMs ?? base.rainEndsAtMs ?? null;
  if (nowcast.currentPrecipMm != null) {
    next.currentPrecipMm = nowcast.currentPrecipMm;
  } else if (nowcast.rainingNow) {
    // Minutely nass, current oft 0 — HUD braucht spürbaren Precip-Hint.
    const prev = next.currentPrecipMm;
    if (prev == null || !Number.isFinite(prev) || prev < 0.1) {
      next.currentPrecipMm = 0.15;
    }
  } else {
    // Radar trocken → OWM-„schon nass“-Fake (Weather-Code / Desc) entkräften.
    next.currentPrecipMm = 0;
  }
  if (nowcast.weatherCode != null && 'currentWeatherId' in next) {
    next.currentWeatherId = nowcast.weatherCode;
  } else if (!nowcast.rainingNow && 'currentWeatherId' in next) {
    const wid = next.currentWeatherId;
    // OWM 2xx–6xx allein würde sonst „Regen noch …“ erzwingen.
    if (typeof wid === 'number' && wid >= 200 && wid < 700) {
      next.currentWeatherId = 803; // bedeckt, ohne Precip-Semantik
    }
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
