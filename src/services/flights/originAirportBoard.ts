/**
 * Origin-FIDS: Gate / Terminal / Check-in vom Abflughafen.
 * Öffentliches JSON der Tafel = gratis. AeroAPI nur als Fallback.
 */

import { dateKeyFromMs } from '../../utils/dateKeys';
import { findAirportByCityHint, normalizeAirportIata } from './airportIata';
import {
  hasJsonOriginBoard,
  hasPublicOriginBoard,
  noteBoardHorizonFromRows,
} from './airportBoardCatalog';
import { discoverOriginBoardRows } from './originBoardDiscover';
import { identsMatch, normalizeFlightIdent } from './flightIdent';
import { CLOCK_SNAP_MS, nextMsWithinWindow } from '../time/clockSnap';
import type { FlightStatus } from './FlightTrackingService';

export { hasJsonOriginBoard, hasPublicOriginBoard } from './airportBoardCatalog';

/** Hermes/ältere RN: AbortSignal.timeout fehlt oft. */
function abortAfterMs(ms: number): AbortSignal {
  if (
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as { timeout?: (n: number) => AbortSignal }).timeout ===
      'function'
  ) {
    return (AbortSignal as { timeout: (n: number) => AbortSignal }).timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* soft */
    }
  }, ms);
  return ctrl.signal;
}

export type OriginBoardRow = {
  ident: string;
  dateKey: string;
  destIata: string | null;
  terminal: string | null;
  gate: string | null;
  checkinDesk: string | null;
  cancelled: boolean;
  plannedMs: number | null;
  expectedMs: number | null;
  status: string | null;
};

type HamDepartureRaw = {
  flightnumber?: string | null;
  plannedDepartureTime?: string | null;
  expectedDepartureTime?: string | null;
  departureTerminal?: string | null;
  gate?: string | null;
  checkinRow?: string | null;
  destinationAirport3LCode?: string | null;
  cancelled?: boolean;
  flightStatusDeparture?: string | null;
};

export type BerFlightRaw = {
  flight_number?: string | null;
  arr_airport_iata?: string | null;
  scheduled_time?: string | null;
  dep_estimated_time?: string | null;
  terminal?: string | null;
  gate?: string | null;
  checkin_counter?: string | null;
  flight_status_id?: string | null;
  flight_status_label?: string | null;
};

export type FraDepartureRaw = {
  fnr?: string | null;
  iata?: string | null;
  sched?: string | null;
  esti?: string | null;
  terminal?: string | null;
  gate?: string | null;
  schalter?: string | null;
  schalterarea?: string | null;
  status?: string | null;
};

export type AnaFlightRaw = {
  day?: string | null;
  time?: string | null;
  terminal?: string | null;
  flightNumber?: string | null;
  destination?: string | null;
  movtype?: string | null;
  state?: { label?: string | null; value?: string | null } | null;
};

const HAM_DEPARTURES_URL =
  'https://www.hamburg-airport.de/service/flightdata/departures';
const HAM_WAIT_URL =
  'https://www.hamburg-airport.de/service/waittimes/waittimes';
const FRA_FILTER_URL =
  'https://www.frankfurt-airport.com/en/_jcr_content.flights.json/filter';
const BER_FLIGHTS_URL = 'https://ber.berlin-airport.de/api.flights.json';
const ANA_FLIGHTS_URL = 'https://www.ana.pt/en/flights_proxy';
const ANA_IATAS = new Set(['LIS', 'OPO', 'FAO']);
const CACHE_MS = 5 * 60_000;

const boardCache = new Map<string, { at: number; rows: OriginBoardRow[] }>();
const boardInflight = new Map<string, Promise<OriginBoardRow[]>>();

export function resetOriginBoardCacheForTests(): void {
  boardCache.clear();
  boardInflight.clear();
}

export function parseHamWaitingMinutes(raw: string | null | undefined): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/<\s*1/i.test(s)) return 1;
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 180 ? n : null;
}

function parseIsoMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/** HAM liefert UTC mit Z; naive Lokalzeit ohne Offset = Europe/Berlin. */
export function parseHamBoardMs(raw: string | null | undefined): number | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return parseIsoMs(s);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(s);
  if (m) {
    const hm = `${m[2]!.padStart(2, '0')}:${m[3]}`;
    return civilTimeInZoneMs(m[1]!, hm, 'Europe/Berlin');
  }
  return parseIsoMs(s);
}

export function hamRawToBoardRow(raw: HamDepartureRaw): OriginBoardRow | null {
  const ident = normalizeFlightIdent(raw.flightnumber || '');
  if (!ident) return null;
  const plannedMs = parseHamBoardMs(raw.plannedDepartureTime);
  const expectedMs = parseHamBoardMs(raw.expectedDepartureTime);
  return {
    ident,
    dateKey: plannedMs != null ? dateKeyFromMs(plannedMs, 'Europe/Berlin') : '',
    destIata: (raw.destinationAirport3LCode || '').trim().toUpperCase() || null,
    terminal: (raw.departureTerminal || '').trim() || null,
    gate: (raw.gate || '').trim() || null,
    checkinDesk: (raw.checkinRow || '').trim() || null,
    cancelled: raw.cancelled === true,
    plannedMs,
    expectedMs,
    status: (raw.flightStatusDeparture || '').trim() || null,
  };
}

/** FRA setzt morgen oft nur die Halle (A/B/C/J) — das ist kein Gate. */
export function fraConcreteGate(raw: string | null | undefined): string | null {
  const g = (raw || '').trim();
  if (!g || /^[A-Z]$/i.test(g)) return null;
  return g;
}

export function fraRawToBoardRow(raw: FraDepartureRaw): OriginBoardRow | null {
  const ident = normalizeFlightIdent(raw.fnr || '');
  if (!ident) return null;
  const plannedMs = parseIsoMs(raw.sched);
  let expectedMs = parseIsoMs(raw.esti);
  if (
    plannedMs != null &&
    expectedMs != null &&
    Math.abs(expectedMs - plannedMs) > 12 * 3600_000
  ) {
    expectedMs = null;
  }
  const status = (raw.status || '').trim() || null;
  return {
    ident,
    dateKey: plannedMs != null ? dateKeyFromMs(plannedMs) : '',
    destIata: (raw.iata || '').trim().toUpperCase() || null,
    terminal: (raw.terminal || '').trim() || null,
    gate: fraConcreteGate(raw.gate),
    checkinDesk:
      (raw.schalterarea || '').trim() || (raw.schalter || '').trim() || null,
    cancelled: /cancel|annull|gestrichen/i.test(status || ''),
    plannedMs,
    expectedMs,
    status,
  };
}

export function berTerminal(raw: string | null | undefined): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  const m = /^T(?:erminal)?\s*(\d+)$/i.exec(t);
  return m ? m[1]! : t;
}

export function berRawToBoardRow(raw: BerFlightRaw): OriginBoardRow | null {
  const ident = normalizeFlightIdent(raw.flight_number || '');
  if (!ident) return null;
  const plannedMs = parseIsoMs(raw.scheduled_time);
  const expectedMs = parseIsoMs(raw.dep_estimated_time);
  const statusId = (raw.flight_status_id || '').trim().toLowerCase();
  const status = (raw.flight_status_label || '').trim() || null;
  return {
    ident,
    dateKey: plannedMs != null ? dateKeyFromMs(plannedMs) : '',
    destIata: (raw.arr_airport_iata || '').trim().toUpperCase() || null,
    terminal: berTerminal(raw.terminal),
    gate: (raw.gate || '').trim() || null,
    checkinDesk: (raw.checkin_counter || '').trim() || null,
    cancelled:
      statusId === 'cancelled' ||
      /cancel|annull|gestrichen/i.test(status || ''),
    plannedMs,
    expectedMs,
    status,
  };
}

function shiftDateKey(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const dt = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]) + days,
    12,
    0,
    0,
  );
  return dateKeyFromMs(dt.getTime());
}

function civilTimeInZoneMs(
  dateKey: string,
  hm: string,
  timeZone: string,
): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const min = Number(tm[2]);
  const utcGuess = Date.UTC(y, mo - 1, d, h, min, 0);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcGuess)).map((p) => [p.type, p.value]),
    );
    const asIf = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second || 0),
    );
    return utcGuess - (asIf - utcGuess);
  } catch {
    return utcGuess;
  }
}

function anaDayToDateKey(day: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(day.trim());
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function anaRawToBoardRow(raw: AnaFlightRaw): OriginBoardRow | null {
  const ident = normalizeFlightIdent(raw.flightNumber || '');
  if (!ident) return null;
  const dateKey = anaDayToDateKey(raw.day || '');
  const plannedMs = dateKey
    ? civilTimeInZoneMs(dateKey, raw.time || '', 'Europe/Lisbon')
    : null;
  const stamp = (raw.state?.value || '').trim();
  const expectedMs =
    dateKey && /^\d{1,2}:\d{2}$/.test(stamp)
      ? civilTimeInZoneMs(dateKey, stamp, 'Europe/Lisbon')
      : null;
  const status = (raw.state?.label || '').trim() || null;
  const destHint = (raw.destination || '').trim();
  const destHit = destHint
    ? findAirportByCityHint(destHint.split(',')[0] || destHint) ??
      findAirportByCityHint(destHint)
    : null;
  return {
    ident,
    dateKey,
    destIata: destHit?.iata ?? null,
    terminal: berTerminal(raw.terminal),
    gate: null,
    checkinDesk: null,
    cancelled: /cancel|anulad/i.test(status || ''),
    plannedMs,
    expectedMs,
    status,
  };
}

export function matchOriginBoardRow(
  rows: OriginBoardRow[],
  opts: {
    ident: string;
    dateKey: string;
    destIata?: string | null;
    clockMs?: number | null;
  },
): OriginBoardRow | null {
  if (!opts.dateKey) return null;
  const ident = normalizeFlightIdent(opts.ident);
  const isClk = !ident || ident.startsWith('CLK');
  const dest = (opts.destIata || '').trim().toUpperCase();
  if (!isClk) {
    const hits = rows.filter(
      (r) =>
        r.dateKey === opts.dateKey &&
        identsMatch(r.ident, ident) &&
        (!dest || !r.destIata || r.destIata === dest),
    );
    const identHit = hits.find((r) => !r.cancelled) ?? hits[0] ?? null;
    if (identHit) return identHit;
  }
  if (!dest) return null;
  const clockMs = opts.clockMs;
  if (clockMs == null || !Number.isFinite(clockMs)) return null;
  const destHits = rows.filter(
    (r) =>
      r.dateKey === opts.dateKey &&
      r.destIata === dest &&
      !r.cancelled &&
      r.plannedMs != null,
  );
  return nextMsWithinWindow(
    destHits,
    (r) => r.plannedMs,
    clockMs,
    CLOCK_SNAP_MS,
  );
}

async function cachedRows(
  key: string,
  loader: () => Promise<OriginBoardRow[]>,
): Promise<OriginBoardRow[]> {
  const now = Date.now();
  const hit = boardCache.get(key);
  // Leere Tafel nicht 5 Min cachen — Timeout/Netz → „nichts gefunden“-Falle
  if (hit && hit.rows.length > 0 && now - hit.at < CACHE_MS) return hit.rows;
  // Kurzer Negativ-Cache — aber nach Fehlschlag sofort neu versuchen
  if (hit && hit.rows.length === 0 && now - hit.at < 8_000) return hit.rows;
  const pending = boardInflight.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      const rows = await loader();
      boardCache.set(key, { at: Date.now(), rows });
      return rows;
    } catch {
      // Kein leeres Cache bei Throw — sonst klebt „Gate fehlt“ 20s
      return hit?.rows ?? [];
    } finally {
      boardInflight.delete(key);
    }
  })();
  boardInflight.set(key, run);
  return run;
}

async function loadHamDepartures(): Promise<OriginBoardRow[]> {
  return cachedRows('HAM:all', async () => {
    let lastErr: unknown = null;
    // ~1.2 MB JSON — 8s ist auf Mobilfunk oft zu knapp
    const timeouts = [18_000, 32_000];
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      try {
        const res = await fetch(HAM_DEPARTURES_URL, {
          headers: {
            Accept: 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Yorro/1.0',
          },
          signal: abortAfterMs(timeouts[attempt]!),
        });
        if (!res.ok) {
          lastErr = new Error(`HAM board HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as unknown;
        const list = Array.isArray(json) ? json : [];
        const rows = list
          .map((x) => hamRawToBoardRow(x as HamDepartureRaw))
          .filter((x): x is OriginBoardRow => x != null);
        noteBoardHorizonFromRows(
          'HAM',
          rows,
          Date.now(),
          dateKeyFromMs(Date.now(), 'Europe/Berlin'),
        );
        if (rows.length === 0 && lastErr) throw lastErr;
        return rows;
      } catch (err) {
        lastErr = err;
      }
    }
    if (__DEV__ && lastErr) {
      console.warn('[originBoard] HAM fetch failed', lastErr);
    }
    // Throw → cachedRows behält alten Treffer, kein leerer Negativ-Cache
    throw lastErr instanceof Error
      ? lastErr
      : new Error('HAM board fetch failed');
  });
}

async function loadFraFilter(q: string): Promise<OriginBoardRow[]> {
  const query = q.trim();
  if (!query) return [];
  return cachedRows(`FRA:q:${query.toUpperCase()}`, async () => {
    const rows: OriginBoardRow[] = [];
    // Früher 8 Seiten — oft reicht 1–3; Cap 4 spart Latenz
    for (let page = 1; page <= 4; page++) {
      const url = `${FRA_FILTER_URL}?q=${encodeURIComponent(query)}&perpage=50&page=${page}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: abortAfterMs(10_000),
      });
      if (!res.ok) break;
      const json = (await res.json()) as {
        data?: FraDepartureRaw[];
        hasnext?: boolean;
        maxpage?: number;
      };
      const chunk = (json.data || [])
        .map((x) => fraRawToBoardRow(x))
        .filter((x): x is OriginBoardRow => x != null);
      rows.push(...chunk);
      const maxPage = Math.min(Number(json.maxpage || page), 4);
      if (chunk.length === 0 || page >= maxPage || !json.hasnext) break;
    }
    noteBoardHorizonFromRows('FRA', rows, Date.now(), dateKeyFromMs(Date.now()));
    return rows;
  });
}

async function loadBerSearch(
  q: string,
  fromKey: string,
  untilKey: string,
): Promise<OriginBoardRow[]> {
  const query = q.trim();
  if (!query || !fromKey) return [];
  const until = untilKey || shiftDateKey(fromKey, 1);
  return cachedRows(`BER:q:${query.toUpperCase()}:${fromKey}:${until}`, async () => {
    const rows: OriginBoardRow[] = [];
    for (let page = 1; page <= 6; page++) {
      const params = new URLSearchParams({
        arrivalDeparture: 'D',
        dateFrom: `${fromKey}T00:00:00`,
        dateUntil: `${until}T00:00:00`,
        search: query,
        lang: 'de',
        page: String(page),
        terminal: '',
        itemsPerPage: '100',
      });
      const res = await fetch(`${BER_FLIGHTS_URL}?${params}`, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://ber.berlin-airport.de/de/fliegen/abfluege-ankuenfte.html',
        },
        signal: abortAfterMs(14_000),
      });
      if (!res.ok) break;
      const json = (await res.json()) as {
        data?: { items?: BerFlightRaw[]; total_pages?: number };
        error?: boolean;
      };
      if (json.error) break;
      const chunk = (json.data?.items || [])
        .map((x) => berRawToBoardRow(x))
        .filter((x): x is OriginBoardRow => x != null);
      rows.push(...chunk);
      const maxPage = Math.min(Number(json.data?.total_pages || page), 6);
      if (chunk.length === 0 || page >= maxPage) break;
    }
    noteBoardHorizonFromRows('BER', rows, Date.now(), dateKeyFromMs(Date.now()));
    return rows;
  });
}

async function loadAnaProxy(
  origin: string,
  opts: { ident?: string | null; destIata?: string | null },
): Promise<OriginBoardRow[]> {
  const ident = normalizeFlightIdent(opts.ident || '');
  const q = ident && !ident.startsWith('CLK') ? ident : '';
  const cacheKey = q ? `ANA:${origin}:id:${q}` : `ANA:${origin}:day`;
  return cachedRows(cacheKey, async () => {
    const params = q
      ? { flight: q, movtype: 'D' }
      : {
          movtype: 'D',
          IATA: origin,
          day: 'hoje',
          hour: '00:00',
          hourF: '23:55',
          PagAtual: '1',
        };
    const res = await fetch(`${ANA_FLIGHTS_URL}?${new URLSearchParams(params)}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.ana.pt/en/content-topic/find-flights',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: abortAfterMs(14_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { flights?: AnaFlightRaw[]; error?: boolean };
    const rows = (json.flights || [])
      .filter((x) => (x.movtype || 'D').toUpperCase() === 'D')
      .map((x) => anaRawToBoardRow(x))
      .filter((x): x is OriginBoardRow => x != null);
    noteBoardHorizonFromRows(origin, rows, Date.now(), dateKeyFromMs(Date.now()));
    return rows;
  });
}

async function loadOriginBoardRows(
  originRaw: string,
  opts?: { ident?: string | null; destIata?: string | null; dateKey?: string | null },
): Promise<OriginBoardRow[]> {
  const origin = normalizeAirportIata(originRaw) || originRaw.trim().toUpperCase();
  if (origin === 'HAM') return loadHamDepartures();
  if (origin === 'FRA') {
    const ident = normalizeFlightIdent(opts?.ident || '');
    if (ident && !ident.startsWith('CLK')) return loadFraFilter(ident);
    const dest = (opts?.destIata || '').trim().toUpperCase();
    if (dest) return loadFraFilter(dest);
  }
  if (origin === 'BER') {
    const today = dateKeyFromMs(Date.now());
    const ident = normalizeFlightIdent(opts?.ident || '');
    if (ident && !ident.startsWith('CLK')) {
      return loadBerSearch(ident, today, shiftDateKey(today, 8));
    }
    const dest = (opts?.destIata || '').trim().toUpperCase();
    if (dest) {
      const day = opts?.dateKey || today;
      return loadBerSearch(dest, day, shiftDateKey(day, 1));
    }
  }
  if (ANA_IATAS.has(origin)) {
    return loadAnaProxy(origin, {
      ident: opts?.ident,
      destIata: opts?.destIata,
    });
  }
  const ident = normalizeFlightIdent(opts?.ident || '');
  if (ident && !ident.startsWith('CLK')) {
    const rows = await discoverOriginBoardRows({
      originIata: origin,
      ident,
      destIata: opts?.destIata,
      dateKey: opts?.dateKey,
    });
    if (rows.length) {
      noteBoardHorizonFromRows(origin, rows, Date.now(), dateKeyFromMs(Date.now()));
      return rows;
    }
  }
  return [];
}

/** Prefetch — Call-1 Flug erkannt → Tafel schon laden während Slots mergen. */
export function warmOriginBoard(opts: {
  originIata?: string | null;
  dateKey?: string | null;
  destIata?: string | null;
}): void {
  const origin =
    normalizeAirportIata(opts.originIata || 'HAM') ||
    (opts.originIata || 'HAM').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin)) return;
  void loadOriginBoardRows(origin, {
    destIata: opts.destIata,
    dateKey: opts.dateKey,
  }).catch(() => {});
}

export async function listOriginBoardRouteHits(opts: {
  originIata: string;
  destIata: string;
  dateKey: string;
}): Promise<
  Array<{
    ident: string;
    originCode: string;
    destinationCode: string | null;
    scheduledDeparture: Date | null;
    estimatedDeparture: Date | null;
    scheduledArrival: Date | null;
  }>
> {
  const origin =
    normalizeAirportIata(opts.originIata) || opts.originIata.trim().toUpperCase();
  const dest = opts.destIata.trim().toUpperCase();
  if (!hasJsonOriginBoard(origin) || !dest || !opts.dateKey) return [];
  let destFamily = new Set([dest]);
  try {
    const { relatedAirportIatas } = require('./airportIata') as {
      relatedAirportIatas: (iata: string) => string[];
    };
    destFamily = new Set(relatedAirportIatas(dest));
  } catch {
    /* soft */
  }
  const rows = await loadOriginBoardRows(origin, { destIata: dest, dateKey: opts.dateKey });
  return rows
    .filter(
      (r) =>
        !r.cancelled &&
        r.dateKey === opts.dateKey &&
        Boolean(r.destIata && destFamily.has(r.destIata)) &&
        r.plannedMs != null,
    )
    .map((r) => ({
      ident: r.ident,
      originCode: origin,
      destinationCode: r.destIata,
      scheduledDeparture: r.plannedMs != null ? new Date(r.plannedMs) : null,
      estimatedDeparture:
        r.expectedMs != null
          ? new Date(r.expectedMs)
          : r.plannedMs != null
            ? new Date(r.plannedMs)
            : null,
      scheduledArrival: null,
    }));
}

export async function fetchHamSecurityWaitMin(): Promise<number | null> {
  try {
    const res = await fetch(HAM_WAIT_URL, {
      headers: { Accept: 'application/json' },
      signal: abortAfterMs(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { waitingTime?: string };
    return parseHamWaitingMinutes(json.waitingTime);
  } catch {
    return null;
  }
}

/**
 * Belegte Ops vom Abflughafen (Gate/Check-in/Terminal).
 * Preferiert Tafel-Werte — AeroAPI hat Check-in nie und Gate oft leer.
 */
export async function enrichFlightFromOriginBoard(
  flight: FlightStatus,
  opts: {
    originIata?: string | null;
    dateKey?: string | null;
    destIata?: string | null;
  },
): Promise<FlightStatus> {
  const origin =
    normalizeAirportIata(opts.originIata || flight.originCode || '') || '';
  const dateKey = opts.dateKey || null;
  if (!dateKey) return flight;
  const ident = normalizeFlightIdent(flight.ident);
  if (!hasPublicOriginBoard(origin) && (!ident || ident.startsWith('CLK'))) {
    return flight;
  }
  let rows = await loadOriginBoardRows(origin, {
    ident: flight.ident,
    destIata: opts.destIata || flight.destinationCode,
    dateKey,
  });
  // HAM-JSON tot → Discover/HTML als Fallback (Detailseite)
  if (
    rows.length === 0 &&
    origin === 'HAM' &&
    ident &&
    !ident.startsWith('CLK')
  ) {
    try {
      rows = await discoverOriginBoardRows({
        originIata: origin,
        ident,
        destIata: opts.destIata || flight.destinationCode,
        dateKey,
      });
    } catch {
      /* soft */
    }
  }
  const hit = matchOriginBoardRow(rows, {
    ident: flight.ident,
    dateKey,
    destIata: opts.destIata || flight.destinationCode,
    clockMs: (
      flight.estimatedDeparture ?? flight.scheduledDeparture
    )?.getTime(),
  });
  if (!hit) return flight;
  const planned =
    hit.plannedMs != null ? new Date(hit.plannedMs) : flight.scheduledDeparture;
  const estimated =
    hit.expectedMs != null ? new Date(hit.expectedMs) : flight.estimatedDeparture;
  let delayMin = flight.delayMin;
  if (hit.plannedMs != null && hit.expectedMs != null) {
    delayMin = Math.round((hit.expectedMs - hit.plannedMs) / 60_000);
  }
  // Tafel schlägt Aero bei Terminal/Gate/Check-in (auch bei Gate-Wechsel)
  return {
    ...flight,
    ident:
      ident.startsWith('CLK') && hit.ident ? hit.ident : flight.ident,
    originCode:
      normalizeAirportIata(flight.originCode) ||
      origin ||
      flight.originCode,
    destinationCode: hit.destIata || flight.destinationCode,
    departureTerminal: hit.terminal ?? flight.departureTerminal,
    departureGate: hit.gate ?? flight.departureGate,
    checkinDesk: hit.checkinDesk ?? flight.checkinDesk ?? null,
    cancelled: hit.cancelled || flight.cancelled,
    scheduledDeparture: planned,
    estimatedDeparture: estimated ?? planned,
    delayMin,
    status: hit.status || flight.status,
  };
}
