/**
 * FlightAware AeroAPI v4 — Flugstatus, Gates, Verspätungen, Gepäckband.
 * Integriert Airport-Buffer in die Multimodal-Pacing-Logik.
 */

import { env } from '../../config/env';
import { planJourney, type JourneyItinerary } from '../transit/journeyPlanner';
import { dateKeyFromMs, localTimeZone } from '../../utils/dateKeys';
import { airportCodeMatches, icaoForIata, normalizeAirportIata, relatedAirportIatas } from './airportIata';
import { identVariants, preferredIataIdent } from './flightIdent';
import { isSaneAirportAccessTransit } from './airportAccessSane';
import { aeroScheduleWindow } from './aeroApiBudget';
import {
  hasJsonOriginBoard,
  listOriginBoardRouteHits,
} from './originAirportBoard';

export { aeroScheduleWindow } from './aeroApiBudget';

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const FETCH_MS = 12_000;

/** AeroAPI rechnet Seiten + Search teuer — RAM-Cache + In-Flight-Dedup. */
const AERO_CACHE_FLIGHT_MS = 90_000;
const AERO_CACHE_SCHEDULE_MS = 15 * 60_000;
const AERO_CACHE_SEARCH_MS = 30 * 60_000;
const AERO_CACHE_FAIL_MS = 6 * 3600_000;
const AERO_CACHE_NET_MS = 30_000;

type AeroCacheEntry = { at: number; ttl: number; data: unknown | null };
const aeroCache = new Map<string, AeroCacheEntry>();
const aeroInflight = new Map<string, Promise<unknown | null>>();

function aeroTtlFor(path: string, status: number | null, ok: boolean): number {
  if (!ok) return status != null && status >= 500 ? AERO_CACHE_FAIL_MS : AERO_CACHE_NET_MS;
  if (path.startsWith('/flights/search')) return AERO_CACHE_SEARCH_MS;
  if (path.startsWith('/schedules/') || path.includes('/scheduled_departures')) {
    return AERO_CACHE_SCHEDULE_MS;
  }
  if (path.startsWith('/flights/')) return AERO_CACHE_FLIGHT_MS;
  return AERO_CACHE_SCHEDULE_MS;
}

/** Defaults wenn keine Live-Security-Queue verfügbar (Großflughafen ≈ 70 Min). */
export const AIRPORT_BUFFER_DEFAULTS = {
  boardingWindowMin: 40,
  securityWaitMin: 20,
  terminalWalkMin: 10,
};

export type AirportBufferMins = {
  boardingWindowMin?: number;
  securityWaitMin?: number;
  terminalWalkMin?: number;
};

export type FlightStatus = {
  ident: string;
  faFlightId: string | null;
  status: string | null;
  originCode: string | null;
  originName: string | null;
  destinationCode: string | null;
  destinationName: string | null;
  scheduledDeparture: Date | null;
  estimatedDeparture: Date | null;
  actualDeparture: Date | null;
  scheduledArrival: Date | null;
  estimatedArrival: Date | null;
  actualArrival: Date | null;
  delayMin: number | null;
  departureTerminal: string | null;
  departureGate: string | null;
  /** Check-in-Zeile vom Abflughafen (HAM-Tafel), nicht AeroAPI. */
  checkinDesk: string | null;
  arrivalTerminal: string | null;
  arrivalGate: string | null;
  baggageClaim: string | null;
  cancelled: boolean;
  diverted: boolean;
  inboundFaFlightId: string | null;
};

export type AirportArrivalPlan = {
  flight: FlightStatus;
  boardingWindowMin: number;
  securityWaitMin: number;
  terminalWalkMin: number;
  /** Hard deadline am Flughafen-Terminal. */
  airportArrivalTarget: Date;
  /** Empfohlene Abfahrt ÖPNV vom aktuellen Standort. */
  suggestedTransitLeave: Date | null;
  transitItinerary: JourneyItinerary | null;
  speechPreFlight: string;
  speechPostLanding: string | null;
};

type AeroFlightRaw = {
  ident?: string;
  ident_iata?: string;
  ident_icao?: string;
  fa_flight_id?: string;
  status?: string;
  origin?: { code?: string; code_iata?: string; name?: string };
  destination?: { code?: string; code_iata?: string; name?: string };
  scheduled_out?: string | null;
  estimated_out?: string | null;
  actual_out?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_in?: string | null;
  departure_delay?: number | null;
  cancelled?: boolean;
  diverted?: boolean;
  terminal_origin?: string | null;
  gate_origin?: string | null;
  terminal_destination?: string | null;
  gate_destination?: string | null;
  baggage_claim?: string | null;
  inbound_fa_flight_id?: string | null;
};

function apiKey(): string {
  return (
    env.flightAwareApiKey?.() ||
    env.get('EXPO_PUBLIC_FLIGHTAWARE_API_KEY') ||
    ''
  ).trim();
}

export function hasFlightAwareKey(): boolean {
  const k = apiKey();
  return k.length > 8 && !k.includes('your-');
}

function parseIso(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function mapFlight(raw: AeroFlightRaw): FlightStatus {
  const scheduled = parseIso(raw.scheduled_out);
  const estimated = parseIso(raw.estimated_out);
  let delayMin: number | null = null;
  if (typeof raw.departure_delay === 'number' && Number.isFinite(raw.departure_delay)) {
    delayMin = Math.round(raw.departure_delay / 60);
  } else if (scheduled && estimated) {
    delayMin = Math.round((estimated.getTime() - scheduled.getTime()) / 60_000);
  }

  const rawIdent = (raw.ident_iata || raw.ident || raw.ident_icao || '').toUpperCase();
  return {
    ident: preferredIataIdent(rawIdent),
    faFlightId: raw.fa_flight_id ?? null,
    status: raw.status ?? null,
    originCode: raw.origin?.code_iata || raw.origin?.code || null,
    originName: raw.origin?.name ?? null,
    destinationCode:
      raw.destination?.code_iata || raw.destination?.code || null,
    destinationName: raw.destination?.name ?? null,
    scheduledDeparture: scheduled,
    estimatedDeparture: estimated,
    actualDeparture: parseIso(raw.actual_out),
    scheduledArrival: parseIso(raw.scheduled_in),
    estimatedArrival: parseIso(raw.estimated_in),
    actualArrival: parseIso(raw.actual_in),
    delayMin,
    departureTerminal: raw.terminal_origin ?? null,
    departureGate: raw.gate_origin ?? null,
    checkinDesk: null,
    arrivalTerminal: raw.terminal_destination ?? null,
    arrivalGate: raw.gate_destination ?? null,
    baggageClaim: raw.baggage_claim ?? null,
    cancelled: raw.cancelled === true || /cancel/i.test(raw.status ?? ''),
    diverted: raw.diverted === true,
    inboundFaFlightId: raw.inbound_fa_flight_id ?? null,
  };
}

/**
 * Live-Abflugzeit (estimated → scheduled).
 */
export function flightLiveDeparture(flight: FlightStatus): Date | null {
  return (
    flight.estimatedDeparture ??
    flight.scheduledDeparture ??
    null
  );
}

/**
 * T_airport = Dep_flight_live − (Boarding + Security + TerminalWalk)
 */
export function computeAirportArrivalTarget(
  flight: FlightStatus,
  buffers?: AirportBufferMins,
): Date | null {
  const dep = flightLiveDeparture(flight);
  if (!dep) return null;
  const boarding =
    buffers?.boardingWindowMin ?? AIRPORT_BUFFER_DEFAULTS.boardingWindowMin;
  const security =
    buffers?.securityWaitMin ?? AIRPORT_BUFFER_DEFAULTS.securityWaitMin;
  const walk =
    buffers?.terminalWalkMin ?? AIRPORT_BUFFER_DEFAULTS.terminalWalkMin;
  return new Date(dep.getTime() - (boarding + security + walk) * 60_000);
}

function pickUpcomingFlight(
  flights: FlightStatus[],
  opts?: {
    dateKey?: string;
    destIata?: string;
    faFlightId?: string | null;
    includeCancelled?: boolean;
  },
): FlightStatus | null {
  if (opts?.faFlightId) {
    const hit = flights.find((f) => f.faFlightId === opts.faFlightId);
    if (hit) return hit;
  }
  let list = opts?.includeCancelled
    ? flights.slice()
    : flights.filter((f) => !f.cancelled);
  if (!list.length) return null;
  if (opts?.destIata) {
    const dest = opts.destIata.trim().toUpperCase();
    const matched = list.filter((f) =>
      airportCodeMatches(f.destinationCode, dest),
    );
    if (matched.length) list = matched;
  }
  if (opts?.dateKey) {
    const onDay = list.filter((f) => {
      const t = (f.estimatedDeparture ?? f.scheduledDeparture)?.getTime();
      return t != null && dateKeyFromMs(t, localTimeZone()) === opts.dateKey;
    });
    if (onDay.length) list = onDay;
  }
  const now = Date.now();
  const upcoming = list
    .filter((f) => !f.actualDeparture)
    .sort((a, b) => {
      const ta = (a.estimatedDeparture ?? a.scheduledDeparture)?.getTime() ?? 0;
      const tb = (b.estimatedDeparture ?? b.scheduledDeparture)?.getTime() ?? 0;
      return ta - tb;
    });
  if (upcoming.length) {
    const soon = upcoming.find((f) => {
      const t = (f.estimatedDeparture ?? f.scheduledDeparture)?.getTime();
      return t != null && t >= now - 2 * 3600_000;
    });
    return soon ?? upcoming[0] ?? null;
  }
  const landed = list
    .filter((f) => f.actualArrival || f.estimatedArrival)
    .sort((a, b) => {
      const ta = (a.actualArrival ?? a.estimatedArrival)?.getTime() ?? 0;
      const tb = (b.actualArrival ?? b.estimatedArrival)?.getTime() ?? 0;
      return tb - ta;
    });
  return landed[0] ?? list[0] ?? null;
}

export async function fetchFlightByIdent(
  flightCode: string,
  opts?: {
    dateKey?: string;
    destIata?: string;
    faFlightId?: string | null;
    includeCancelled?: boolean;
  },
): Promise<FlightStatus | null> {
  const ident = flightCode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(ident)) return null;
  if (!hasFlightAwareKey()) return null;

  if (opts?.faFlightId) {
    const byId = await fetchFlightByFaId(opts.faFlightId);
    if (byId) return byId;
  }

  for (const variant of identVariants(ident)) {
    const data = (await aeroGet(`/flights/${encodeURIComponent(variant)}`)) as {
      flights?: AeroFlightRaw[];
    } | null;
    const flights = (data?.flights ?? []).map(mapFlight);
    const picked = pickUpcomingFlight(flights, opts);
    if (picked) return picked;
    // Trefferliste da, nur Filter passt nicht — ICAO-Zweitcall spart nichts.
    if (flights.length) return null;
  }
  return null;
}

function buildPreFlightSpeech(
  flight: FlightStatus,
  plan: {
    airportArrivalTarget: Date;
    securityWaitMin: number;
    transitLeave: Date | null;
    transitLine: string | null;
  },
): string {
  const dep = flightLiveDeparture(flight);
  const depStr = dep ? formatClock(dep) : '—';
  const gate = flight.departureGate
    ? ` ab Gate ${flight.departureGate}`
    : flight.departureTerminal
      ? ` ab Terminal ${flight.departureTerminal}`
      : '';
  const delay =
    flight.delayMin != null && flight.delayMin > 0
      ? ` Dein Flug hat ${flight.delayMin} Min Verspätung.`
      : '';
  const dest = flight.destinationName || flight.destinationCode || 'dein Ziel';
  const liveWindow =
    Date.now() >= plan.airportArrivalTarget.getTime() - 60 * 60_000 &&
    Date.now() <= plan.airportArrivalTarget.getTime() + 30 * 60_000;
  const securityNote = liveWindow
    ? `Am Flughafen ist die Sicherheitskontrolle gerade etwa ${plan.securityWaitMin} Min.`
    : `Für die Sicherheitskontrolle rechne ich mit ca. ${plan.securityWaitMin} Minuten.`;

  let leaveClause = '';
  if (plan.transitLeave && plan.transitLine) {
    leaveClause =
      ` Um pünktlich um ${formatClock(plan.airportArrivalTarget)} Uhr am Terminal zu sein, ` +
      `musst du um ${formatClock(plan.transitLeave)} Uhr die ${plan.transitLine} nehmen. ` +
      `Ich erinnere dich 10 Minuten vorher!`;
  } else {
    leaveClause =
      ` Sei spätestens um ${formatClock(plan.airportArrivalTarget)} Uhr am Terminal.`;
  }

  return (
    `Dein Flug ${flight.ident} nach ${dest} startet um ${depStr} Uhr${gate}.${delay} ` +
    `${securityNote}${leaveClause}`
  );
}

function buildPostLandingSpeech(flight: FlightStatus): string | null {
  if (!flight.actualArrival && !flight.baggageClaim) return null;
  const city =
    flight.destinationName?.split('/')[0]?.trim() ||
    flight.destinationCode ||
    'deinem Ziel';
  const bag = flight.baggageClaim
    ? ` Dein Gepäck kommt auf Band ${flight.baggageClaim} heraus.`
    : '';
  return (
    `Willkommen in ${city}!${bag} Danach zeige ich dir direkt den Bus in die Innenstadt.`
  );
}

/**
 * Volle Airport-Pacing-Planung inkl. ÖPNV zum Flughafen.
 * seedFlight: wenn Aero fehlt/dünn — Tafel-Ops trotzdem anwenden.
 */
export async function buildAirportArrivalPlan(opts: {
  flightCode: string;
  from?: { lat: number; lng: number } | null;
  airportCoords?: { lat: number; lng: number } | null;
  securityWaitMin?: number;
  boardingWindowMin?: number;
  terminalWalkMin?: number;
  dateKey?: string;
  destIata?: string;
  originIata?: string | null;
  seedFlight?: FlightStatus | null;
}): Promise<AirportArrivalPlan | null> {
  let rawFlight =
    (await fetchFlightByIdent(opts.flightCode, {
      dateKey: opts.dateKey,
      destIata: opts.destIata,
    })) ?? opts.seedFlight ?? null;
  if (!rawFlight) return null;
  const { enrichFlightFromOriginBoard } = await import('./originAirportBoard');
  const originIata =
    normalizeAirportIata(opts.originIata || rawFlight.originCode) ||
    opts.originIata ||
    rawFlight.originCode;
  const flight = await enrichFlightFromOriginBoard(rawFlight, {
    originIata,
    dateKey: opts.dateKey,
    destIata: opts.destIata,
  });

  const boardingWindowMin =
    opts.boardingWindowMin ?? AIRPORT_BUFFER_DEFAULTS.boardingWindowMin;
  const securityWaitMin =
    opts.securityWaitMin ?? AIRPORT_BUFFER_DEFAULTS.securityWaitMin;
  const terminalWalkMin =
    opts.terminalWalkMin ?? AIRPORT_BUFFER_DEFAULTS.terminalWalkMin;

  const airportArrivalTarget = computeAirportArrivalTarget(flight, {
    boardingWindowMin,
    securityWaitMin,
    terminalWalkMin,
  });
  if (!airportArrivalTarget) return null;

  let transitItinerary: JourneyItinerary | null = null;
  let suggestedTransitLeave: Date | null = null;

  if (opts.from && opts.airportCoords) {
    if (airportArrivalTarget.getTime() > Date.now() + 5 * 60_000) {
      const plan = await planJourney({
        from: opts.from,
        to: opts.airportCoords,
        travelMode: 'transit',
        arriveBy: airportArrivalTarget,
        numItineraries: 2,
      });
      const cand = plan.itineraries[0] ?? null;
      const taxiMinGuess = 40;
      transitItinerary =
        cand &&
        isSaneAirportAccessTransit(cand, {
          arriveByMs: airportArrivalTarget.getTime(),
          taxiMin: taxiMinGuess,
        })
          ? cand
          : null;
      if (transitItinerary) {
        suggestedTransitLeave = transitItinerary.startTime;
      }
    }
  }

  const speechPreFlight = buildPreFlightSpeech(flight, {
    airportArrivalTarget,
    securityWaitMin,
    transitLeave: suggestedTransitLeave,
    transitLine: transitItinerary?.firstTransitLine ?? null,
  });

  return {
    flight,
    boardingWindowMin,
    securityWaitMin,
    terminalWalkMin,
    airportArrivalTarget,
    suggestedTransitLeave,
    transitItinerary,
    speechPreFlight,
    speechPostLanding: buildPostLandingSpeech(flight),
  };
}

async function aeroGetUncached(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${AEROAPI_BASE}${path}`, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'x-apikey': apiKey(),
      },
    });
    const data = res.ok ? await res.json() : null;
    aeroCache.set(path, {
      at: Date.now(),
      ttl: aeroTtlFor(path, res.status, res.ok),
      data,
    });
    return data;
  } catch {
    aeroCache.set(path, { at: Date.now(), ttl: AERO_CACHE_NET_MS, data: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function aeroGet(path: string): Promise<unknown | null> {
  if (!hasFlightAwareKey()) return null;
  const hit = aeroCache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const pending = aeroInflight.get(path);
  if (pending) return pending;
  const job = aeroGetUncached(path).finally(() => aeroInflight.delete(path));
  aeroInflight.set(path, job);
  return job;
}

/** Live-Flug per FlightAware-ID (Zubringer). */
export async function fetchFlightByFaId(
  faId: string,
): Promise<FlightStatus | null> {
  const id = faId.trim();
  if (!id) return null;
  const data = (await aeroGet(`/flights/${encodeURIComponent(id)}`)) as {
    flights?: AeroFlightRaw[];
  } | null;
  const flights = (data?.flights ?? []).map(mapFlight);
  return flights[0] ?? null;
}

export type RouteScheduleHit = {
  ident: string;
  originCode: string | null;
  destinationCode: string | null;
  scheduledDeparture: Date | null;
  estimatedDeparture: Date | null;
  scheduledArrival: Date | null;
};

function collectRouteHits(
  rawList: AeroFlightRaw[],
  destIatas: string[],
  destIcaos: string[],
): RouteScheduleHit[] {
  const hits: RouteScheduleHit[] = [];
  const icaoSet = new Set(destIcaos.map((c) => c.toUpperCase()));
  for (const f of rawList.map(mapFlight)) {
    if (f.cancelled) continue;
    const destOk =
      destIatas.some((d) => airportCodeMatches(f.destinationCode, d)) ||
      icaoSet.has((f.destinationCode || '').toUpperCase());
    if (!destOk) continue;
    if (!/^[A-Z0-9]{2,8}$/.test(f.ident)) continue;
    hits.push({
      ident: f.ident,
      originCode: f.originCode,
      destinationCode: f.destinationCode,
      scheduledDeparture: f.scheduledDeparture,
      estimatedDeparture: f.estimatedDeparture,
      scheduledArrival: f.scheduledArrival,
    });
  }
  return hits;
}

/**
 * Linienflüge origin→dest. Kein `/flights/search` (≈ 5 Cent) und kein
 * `/schedules` (bei uns 500). Nur IATA-Abflüge, 1 Seite, enges Zeitfenster.
 */
export async function searchRouteSchedule(opts: {
  originIata: string;
  destIata: string;
  dateKey: string;
  clockHm?: string | null;
  afterMs?: number;
}): Promise<RouteScheduleHit[]> {
  const origin = opts.originIata.trim().toUpperCase();
  const dest = opts.destIata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) return [];

  const dests = relatedAirportIatas(dest);
  const destIcaos = dests
    .map((d) => icaoForIata(d))
    .filter((c): c is string => Boolean(c));

  // Tafel zuerst (gecacht/vorgewärmt). Aero nur wenn Tafel leer — spart Kosten.
  if (hasJsonOriginBoard(origin)) {
    try {
      const boardHits = await listOriginBoardRouteHits({
        originIata: origin,
        destIata: dest,
        dateKey: opts.dateKey,
      });
      if (boardHits.length > 0) return boardHits;
    } catch {
      /* Aero-Fallback */
    }
  }

  const window = aeroScheduleWindow({
    dateKey: opts.dateKey,
    clockHm: opts.clockHm,
    afterMs: opts.afterMs,
  });
  if (!window || !hasFlightAwareKey()) return [];

  const dep = (await aeroGet(
    `/airports/${encodeURIComponent(origin)}/flights/scheduled_departures?start=${encodeURIComponent(window.start)}&end=${encodeURIComponent(window.end)}&max_pages=1`,
  )) as {
    scheduled_departures?: AeroFlightRaw[];
    departures?: AeroFlightRaw[];
  } | null;
  return collectRouteHits(
    dep?.scheduled_departures ?? dep?.departures ?? [],
    dests,
    destIcaos,
  );
}

export const FlightTrackingService = {
  hasKey: hasFlightAwareKey,
  fetchFlightByIdent,
  fetchFlightByFaId,
  searchRouteSchedule,
  computeAirportArrivalTarget,
  flightLiveDeparture,
  buildAirportArrivalPlan,
  AIRPORT_BUFFER_DEFAULTS,
};

export default FlightTrackingService;
