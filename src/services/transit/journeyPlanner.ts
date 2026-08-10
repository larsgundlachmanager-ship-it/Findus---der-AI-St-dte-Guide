/**
 * Multimodales A→B Routing mit Failover:
 * 1. Transitous (MOTIS) — EU + Live GTFS-RT
 * 2. Google Directions transit/walk/bike — weltweiter Fallback
 */

import {
  fetchRouteDirectionsResult,
  hasGoogleMapsNavKey,
  type PedestrianTravelMode,
  type RouteDirectionsResult,
} from '../navigation/googleMapsNav';
import {
  delaySecFromTimes,
  parseIsoDate,
  placeTuple,
  transitousFetchJson,
} from './adapters/transitousClient';

export type JourneyLegMode =
  | 'WALK'
  | 'BIKE'
  | 'BUS'
  | 'TRAM'
  | 'SUBWAY'
  | 'RAIL'
  | 'FERRY'
  | 'TRANSIT'
  | 'OTHER';

export type JourneyLeg = {
  mode: JourneyLegMode;
  fromName: string;
  toName: string;
  startTime: Date;
  endTime: Date;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  delaySec: number | null;
  durationSec: number;
  distanceM: number | null;
  line: string | null;
  headsign: string | null;
  realTime: boolean;
  fromLat?: number | null;
  fromLng?: number | null;
  toLat?: number | null;
  toLng?: number | null;
};

export type JourneyItinerary = {
  source: 'transitous' | 'google' | 'db_rest';
  startTime: Date;
  endTime: Date;
  durationSec: number;
  transfers: number;
  legs: JourneyLeg[];
  /** Erste ÖPNV-Abfahrt (live), falls vorhanden. */
  firstTransitDeparture: Date | null;
  firstTransitLine: string | null;
  firstTransitDelaySec: number | null;
  walkToStopSec: number | null;
};

export type JourneyPlanResult = {
  itineraries: JourneyItinerary[];
  source: 'transitous' | 'google' | 'db_rest' | 'none';
};

function mapMotisMode(raw: string | undefined): JourneyLegMode {
  const m = (raw || '').toUpperCase();
  if (m === 'WALK' || m === 'FOOT') return 'WALK';
  if (m === 'BICYCLE' || m === 'BIKE') return 'BIKE';
  if (m === 'BUS') return 'BUS';
  if (m === 'TRAM') return 'TRAM';
  if (m === 'SUBWAY' || m === 'METRO' || m === 'SUBURBAN') return 'SUBWAY';
  if (
    m.includes('RAIL') ||
    m === 'TRAIN' ||
    m === 'LONG_DISTANCE' ||
    m === 'HIGHSPEED_RAIL' ||
    m === 'REGIONAL_RAIL' ||
    m === 'OTHER'
  ) {
    if (m === 'OTHER') return 'OTHER';
    return 'RAIL';
  }
  if (m === 'FERRY' || m === 'WATER') return 'FERRY';
  if (m && m !== 'WALK') return 'TRANSIT';
  return 'OTHER';
}

type MotisLeg = {
  mode?: string;
  from?: {
    name?: string;
    departure?: string;
    scheduledDeparture?: string;
    lat?: number;
    lon?: number;
    lng?: number;
  };
  to?: {
    name?: string;
    arrival?: string;
    scheduledArrival?: string;
    lat?: number;
    lon?: number;
    lng?: number;
  };
  startTime?: string;
  endTime?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  duration?: number;
  distance?: number;
  realTime?: boolean;
  headsign?: string;
  routeShortName?: string;
  displayName?: string;
};

type MotisItinerary = {
  duration?: number;
  startTime?: string;
  endTime?: string;
  transfers?: number;
  legs?: MotisLeg[];
};

function mapMotisItinerary(it: MotisItinerary): JourneyItinerary | null {
  const startTime = parseIsoDate(it.startTime);
  const endTime = parseIsoDate(it.endTime);
  if (!startTime || !endTime) return null;
  const legs: JourneyLeg[] = [];
  for (const leg of it.legs ?? []) {
    const s =
      parseIsoDate(leg.startTime) ??
      parseIsoDate(leg.from?.departure) ??
      startTime;
    const e =
      parseIsoDate(leg.endTime) ??
      parseIsoDate(leg.to?.arrival) ??
      endTime;
    const scheduledStart =
      parseIsoDate(leg.scheduledStartTime) ??
      parseIsoDate(leg.from?.scheduledDeparture);
    const scheduledEnd =
      parseIsoDate(leg.scheduledEndTime) ??
      parseIsoDate(leg.to?.scheduledArrival);
    legs.push({
      mode: mapMotisMode(leg.mode),
      fromName: leg.from?.name?.trim() || 'Start',
      toName: leg.to?.name?.trim() || 'Ziel',
      startTime: s,
      endTime: e,
      scheduledStart,
      scheduledEnd,
      delaySec: delaySecFromTimes(s, scheduledStart),
      durationSec:
        typeof leg.duration === 'number'
          ? leg.duration
          : Math.max(0, Math.round((e.getTime() - s.getTime()) / 1000)),
      distanceM:
        typeof leg.distance === 'number' ? Math.round(leg.distance) : null,
      line: leg.routeShortName || leg.displayName || null,
      headsign: leg.headsign || null,
      realTime: leg.realTime === true,
      fromLat: typeof leg.from?.lat === 'number' ? leg.from.lat : null,
      fromLng:
        typeof leg.from?.lon === 'number'
          ? leg.from.lon
          : typeof leg.from?.lng === 'number'
            ? leg.from.lng
            : null,
      toLat: typeof leg.to?.lat === 'number' ? leg.to.lat : null,
      toLng:
        typeof leg.to?.lon === 'number'
          ? leg.to.lon
          : typeof leg.to?.lng === 'number'
            ? leg.to.lng
            : null,
    });
  }
  if (!legs.length) return null;

  const firstTransit = legs.find(
    (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
  );
  const walkToStop = legs[0]?.mode === 'WALK' ? legs[0].durationSec : null;

  return {
    source: 'transitous',
    startTime,
    endTime,
    durationSec:
      typeof it.duration === 'number'
        ? it.duration
        : Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    transfers: typeof it.transfers === 'number' ? it.transfers : 0,
    legs,
    firstTransitDeparture: firstTransit?.startTime ?? null,
    firstTransitLine: firstTransit?.line ?? null,
    firstTransitDelaySec: firstTransit?.delaySec ?? null,
    walkToStopSec: walkToStop,
  };
}

async function planViaTransitous(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  arriveBy?: Date | null;
  departAt?: Date | null;
  numItineraries?: number;
}): Promise<JourneyItinerary[]> {
  const params = new URLSearchParams();
  params.set('fromPlace', placeTuple(opts.from.lat, opts.from.lng));
  params.set('toPlace', placeTuple(opts.to.lat, opts.to.lng));
  params.set('numItineraries', String(opts.numItineraries ?? 3));
  if (opts.arriveBy) {
    params.set('arriveBy', 'true');
    params.set('time', opts.arriveBy.toISOString());
  } else if (opts.departAt) {
    params.set('arriveBy', 'false');
    params.set('time', opts.departAt.toISOString());
  }

  const data = await transitousFetchJson(`/v5/plan?${params.toString()}`);
  const raw = (data as { itineraries?: MotisItinerary[] } | null)?.itineraries;
  if (!raw?.length) return [];
  const out: JourneyItinerary[] = [];
  for (const it of raw) {
    const mapped = mapMotisItinerary(it);
    if (mapped) out.push(mapped);
  }
  return out;
}

function googleResultToItinerary(
  result: RouteDirectionsResult,
): JourneyItinerary | null {
  if (!result.steps.length) return null;
  const now = new Date();
  let cursor = now.getTime();
  const legs: JourneyLeg[] = [];

  for (const step of result.steps) {
    const durationSec = Math.max(
      30,
      Math.round((step.distanceM || 80) / (step.travelMode === 'TRANSIT' ? 8 : 1.3)),
    );
    const start = new Date(cursor);
    const end = new Date(cursor + durationSec * 1000);
    cursor = end.getTime();
    const isTransit = (step.travelMode || '').toUpperCase() === 'TRANSIT';
    legs.push({
      mode: isTransit ? 'TRANSIT' : result.travelMode === 'bicycling' ? 'BIKE' : 'WALK',
      fromName: step.instruction?.slice(0, 40) || 'Zwischenstopp',
      toName: step.roadName || 'Weiter',
      startTime: start,
      endTime: end,
      scheduledStart: null,
      scheduledEnd: null,
      delaySec: null,
      durationSec,
      distanceM: step.distanceM,
      line: null,
      headsign: null,
      realTime: false,
    });
  }

  const startTime = legs[0].startTime;
  const endTime = legs[legs.length - 1].endTime;
  const firstTransit = legs.find((l) => l.mode === 'TRANSIT');
  return {
    source: 'google',
    startTime,
    endTime,
    durationSec: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    transfers: Math.max(0, result.stations.filter((s) => s.role === 'departure').length - 1),
    legs,
    firstTransitDeparture: firstTransit?.startTime ?? null,
    firstTransitLine: result.stations[0]?.line ?? null,
    firstTransitDelaySec: null,
    walkToStopSec: legs[0]?.mode === 'WALK' ? legs[0].durationSec : null,
  };
}

async function planViaGoogle(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode: PedestrianTravelMode;
}): Promise<JourneyItinerary[]> {
  if (!hasGoogleMapsNavKey()) return [];
  const result = await fetchRouteDirectionsResult(opts.from, opts.to, opts.mode);
  if (!result) return [];
  const mapped = googleResultToItinerary(result);
  return mapped ? [mapped] : [];
}

/**
 * Primär DB transport.rest (DE), dann Transitous, Fallback Google Directions.
 */
export async function planJourney(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** foot | bike | transit — steuert Google-Fallback-Mode. */
  travelMode?: 'foot' | 'bike' | 'transit';
  arriveBy?: Date | null;
  departAt?: Date | null;
  numItineraries?: number;
}): Promise<JourneyPlanResult> {
  const googleMode: PedestrianTravelMode =
    opts.travelMode === 'bike'
      ? 'bicycling'
      : opts.travelMode === 'foot'
        ? 'walking'
        : 'transit';

  // DB / HAFAS live zuerst für ÖPNV
  if (opts.travelMode !== 'foot' && opts.travelMode !== 'bike') {
    try {
      const { planDbJourneys } = await import('./dbRestJourneys');
      const db = await planDbJourneys({
        from: opts.from,
        to: opts.to,
        arriveBy: opts.arriveBy,
        departAt: opts.departAt,
        results: opts.numItineraries ?? 5,
      });
      if (db.length) {
        return { itineraries: db, source: 'db_rest' };
      }
    } catch {
      /* Transitous unten */
    }

    try {
      const transitous = await planViaTransitous({
        from: opts.from,
        to: opts.to,
        arriveBy: opts.arriveBy,
        departAt: opts.departAt,
        numItineraries: opts.numItineraries,
      });
      if (transitous.length) {
        return { itineraries: transitous, source: 'transitous' };
      }
    } catch {
      // Fallback unten
    }
  }

  const google = await planViaGoogle({
    from: opts.from,
    to: opts.to,
    mode: googleMode,
  });
  if (google.length) {
    return { itineraries: google, source: 'google' };
  }

  // Letzter Versuch: Transitous auch für reine Fuß/Rad-Ziele (Fußbein)
  if (opts.travelMode === 'foot' || opts.travelMode === 'bike') {
    try {
      const transitous = await planViaTransitous({
        from: opts.from,
        to: opts.to,
        arriveBy: opts.arriveBy,
        departAt: opts.departAt,
        numItineraries: 1,
      });
      if (transitous.length) {
        return { itineraries: transitous, source: 'transitous' };
      }
    } catch {
      /* ignore */
    }
  }

  return { itineraries: [], source: 'none' };
}

/** Nächste Verbindung neu berechnen (z. B. nach verpasstem Bus). */
export async function recalculateNextConnection(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  after?: Date;
  /** Bevorzugte Linie (gleiche Linie priorisieren). */
  preferLine?: string | null;
  numItineraries?: number;
}): Promise<JourneyItinerary | null> {
  const result = await recalculateMissedConnection(opts);
  return result.primary;
}

/**
 * Verpasste Verbindung: gleiche Linie + optional schnellste Alternative.
 */
export async function recalculateMissedConnection(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  after?: Date;
  preferLine?: string | null;
  numItineraries?: number;
  missedLineLabel?: string | null;
}): Promise<import('./missedConnectionPolicy').MissedConnectionPick> {
  const { pickMissedConnection } = await import('./missedConnectionPolicy');
  const departAt = opts.after ?? new Date(Date.now() + 60_000);
  const plan = await planJourney({
    from: opts.from,
    to: opts.to,
    travelMode: 'transit',
    departAt,
    numItineraries: opts.numItineraries ?? 5,
  });
  return pickMissedConnection({
    itineraries: plan.itineraries,
    preferLine: opts.preferLine,
    nowMs: departAt.getTime(),
    missedLineLabel: opts.missedLineLabel ?? opts.preferLine,
  });
}
