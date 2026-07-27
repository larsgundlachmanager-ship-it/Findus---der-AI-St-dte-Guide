/**
 * Tide-Status via PEGELONLINE (WSV) — kein API-Key.
 * Primär: Wangerooge West für condition_rule `tide_low`.
 */

export type TideStatus = 'low' | 'high' | 'unknown';

export type TideState = {
  status: TideStatus;
  levelCm?: number;
  fetchedAtMs: number;
  stationId: string;
  mtnwCm?: number;
  mthwCm?: number;
  thresholdCm?: number;
};

type StationConfig = {
  uuid: string;
  /** Fallback MTnw / MThw wenn API keine Characteristic Values liefert. */
  fallbackMtnwCm: number;
  fallbackMthwCm: number;
};

/** cityId → PEGELONLINE station */
const STATIONS: Record<string, StationConfig> = {
  wangerooge: {
    uuid: '70039212-c8a8-43fc-82a5-150d95831772', // WANGEROOGE WEST
    fallbackMtnwCm: 366,
    fallbackMthwCm: 652,
  },
};

const CACHE_TTL_MS = 18 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
/** Unter Midpoint − Bias → klar Niedrigwasser-Seite. */
const LOW_BIAS_CM = 40;

const cache = new Map<string, TideState>();

type PegelChar = { shortname?: string; value?: number };
type PegelTimeseries = {
  shortname?: string;
  currentMeasurement?: { value?: number; timestamp?: string };
  characteristicValues?: PegelChar[];
};
type PegelStation = {
  uuid?: string;
  timeseries?: PegelTimeseries[];
};

function stationUrl(uuid: string): string {
  return (
    `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/${uuid}.json` +
    `?includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true`
  );
}

function charValue(chars: PegelChar[] | undefined, name: string): number | undefined {
  const hit = chars?.find(
    (c) => (c.shortname ?? '').toUpperCase() === name.toUpperCase(),
  );
  return typeof hit?.value === 'number' ? hit.value : undefined;
}

/**
 * Low wenn Pegel klar unter der Mitte zwischen MTnw und MThw liegt.
 * Exportiert für Smoke-Tests.
 */
export function classifyTideLevel(
  levelCm: number,
  mtnwCm: number,
  mthwCm: number,
  biasCm: number = LOW_BIAS_CM,
): 'low' | 'high' {
  const mid = (mtnwCm + mthwCm) / 2;
  const threshold = mid - biasCm;
  return levelCm <= threshold ? 'low' : 'high';
}

export function resolveTideThresholdCm(
  mtnwCm: number,
  mthwCm: number,
  biasCm: number = LOW_BIAS_CM,
): number {
  return (mtnwCm + mthwCm) / 2 - biasCm;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`PEGELONLINE HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function unknownState(stationId: string): TideState {
  return {
    status: 'unknown',
    fetchedAtMs: Date.now(),
    stationId,
  };
}

/**
 * Liefert Tide-Status für eine Stadt. Unbekannte Städte / Fehler → unknown.
 */
export async function getTideState(
  cityId: string,
  _now: Date = new Date(),
): Promise<TideState> {
  const id = (cityId || '').trim().toLowerCase();
  const station = STATIONS[id];
  if (!station) {
    return unknownState(`none:${id || 'unknown'}`);
  }

  const cached = cache.get(id);
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const raw = (await fetchJsonWithTimeout(
      stationUrl(station.uuid),
    )) as PegelStation;
    const wSeries =
      raw.timeseries?.find((t) => (t.shortname ?? '').toUpperCase() === 'W') ??
      raw.timeseries?.[0];
    const level = wSeries?.currentMeasurement?.value;
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      const miss = unknownState(station.uuid);
      cache.set(id, miss);
      return miss;
    }

    const chars = wSeries?.characteristicValues;
    const mtnw =
      charValue(chars, 'MTnw') ??
      charValue(chars, 'MTNW') ??
      station.fallbackMtnwCm;
    const mthw =
      charValue(chars, 'MThw') ??
      charValue(chars, 'MTHW') ??
      station.fallbackMthwCm;

    const status = classifyTideLevel(level, mtnw, mthw);
    const state: TideState = {
      status,
      levelCm: level,
      fetchedAtMs: Date.now(),
      stationId: station.uuid,
      mtnwCm: mtnw,
      mthwCm: mthw,
      thresholdCm: resolveTideThresholdCm(mtnw, mthw),
    };
    cache.set(id, state);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(
        `[tide] ${id} level=${level}cm thr=${state.thresholdCm} → ${status}`,
      );
    }
    return state;
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[tide] fetch failed:', e);
    }
    // Stale cache besser als unknown, wenn vorhanden
    if (cached) return cached;
    const miss = unknownState(station.uuid);
    cache.set(id, miss);
    return miss;
  }
}

/** Test-Hilfe: Cache leeren. */
export function clearTideCache(): void {
  cache.clear();
}
