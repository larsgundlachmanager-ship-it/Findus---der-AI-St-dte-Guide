/**
 * FlightAware AeroAPI v4 — Flugstatus, Gates, Verspätungen, Gepäckband.
 * Integriert Airport-Buffer in die Multimodal-Pacing-Logik.
 */

import { env } from '../../config/env';
import { planJourney, type JourneyItinerary } from '../transit/journeyPlanner';

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const FETCH_MS = 12_000;

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
  arrivalTerminal: string | null;
  arrivalGate: string | null;
  baggageClaim: string | null;
  cancelled: boolean;
  diverted: boolean;
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

  return {
    ident: (raw.ident || '').toUpperCase(),
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
    arrivalTerminal: raw.terminal_destination ?? null,
    arrivalGate: raw.gate_destination ?? null,
    baggageClaim: raw.baggage_claim ?? null,
    cancelled: raw.cancelled === true,
    diverted: raw.diverted === true,
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

export async function fetchFlightByIdent(
  flightCode: string,
): Promise<FlightStatus | null> {
  const ident = flightCode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(ident)) return null;
  if (!hasFlightAwareKey()) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}`, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'x-apikey': apiKey(),
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { flights?: AeroFlightRaw[] };
    const flights = (data.flights ?? []).map(mapFlight);
    if (!flights.length) return null;

    const now = Date.now();
    // Nächster noch nicht abgeflogener Flug
    const upcoming = flights
      .filter((f) => !f.actualDeparture && !f.cancelled)
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
      return soon ?? upcoming[0];
    }

    // Gelandet: jüngste Ankunft
    const landed = flights
      .filter((f) => f.actualArrival || f.estimatedArrival)
      .sort((a, b) => {
        const ta = (a.actualArrival ?? a.estimatedArrival)?.getTime() ?? 0;
        const tb = (b.actualArrival ?? b.estimatedArrival)?.getTime() ?? 0;
        return tb - ta;
      });
    return landed[0] ?? flights[0];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  const securityNote =
    plan.securityWaitMin <= 12
      ? `Am Flughafen ist die Sicherheitskontrolle aktuell entspannt (ca. ${plan.securityWaitMin} Min).`
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
 */
export async function buildAirportArrivalPlan(opts: {
  flightCode: string;
  from?: { lat: number; lng: number } | null;
  airportCoords?: { lat: number; lng: number } | null;
  securityWaitMin?: number;
  boardingWindowMin?: number;
  terminalWalkMin?: number;
}): Promise<AirportArrivalPlan | null> {
  const flight = await fetchFlightByIdent(opts.flightCode);
  if (!flight) return null;

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
    const plan = await planJourney({
      from: opts.from,
      to: opts.airportCoords,
      travelMode: 'transit',
      arriveBy: airportArrivalTarget,
      numItineraries: 2,
    });
    transitItinerary = plan.itineraries[0] ?? null;
    if (transitItinerary) {
      suggestedTransitLeave = transitItinerary.startTime;
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

export const FlightTrackingService = {
  hasKey: hasFlightAwareKey,
  fetchFlightByIdent,
  computeAirportArrivalTarget,
  flightLiveDeparture,
  buildAirportArrivalPlan,
  AIRPORT_BUFFER_DEFAULTS,
};

export default FlightTrackingService;
