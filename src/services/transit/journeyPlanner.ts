/**
 * Multimodales A→B Routing mit Failover:
 * 1. DB + Transitous parallel — sobald eine Seite liefert, kurz auf die andere warten
 * 2. Google Directions nur wenn beide leer (weltweiter Fallback)
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
import { encodedPathFromMotisLeg } from './journeyPath';
import { pickSoonestCatchable } from './pickSoonestJourney';
import { collectUntilUseful } from './collectUntilUseful';

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

export type JourneyStop = {
  name: string;
  lat: number | null;
  lng: number | null;
  arrival: Date | null;
  departure: Date | null;
};

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
  /** Gleis am Einstieg, wenn der Feed es liefert. */
  fromPlatform?: string | null;
  /** Gleis am Ausstieg. */
  toPlatform?: string | null;
  realTime: boolean;
  fromLat?: number | null;
  fromLng?: number | null;
  toLat?: number | null;
  toLng?: number | null;
  /** Zwischenhalte bis Ausstieg (ohne Einstieg, mit Ausstieg als Ziel separat). */
  intermediateStops?: JourneyStop[];
  /** Stationen bis Ausstieg inkl. Zielhalt (für Countdown). */
  stationCount?: number | null;
  pathEncoded?: string | null;
  /** MOTIS EncodedPolyline.precision — 6 für /v2+/v5, sonst Google 5. */
  pathPrecision?: number | null;
  path?: Array<{ lat: number; lng: number }>;
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
  /** true: nächste Bahn ist knapper als Fußweg + Bahnhofspuffer. */
  tight?: boolean;
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
    track?: string;
    scheduledTrack?: string;
  };
  to?: {
    name?: string;
    arrival?: string;
    scheduledArrival?: string;
    lat?: number;
    lon?: number;
    lng?: number;
    track?: string;
    scheduledTrack?: string;
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
  intermediateStops?: Array<{
    name?: string;
    lat?: number;
    lon?: number;
    lng?: number;
    arrival?: string;
    departure?: string;
    scheduledArrival?: string;
    scheduledDeparture?: string;
  }>;
  legGeometry?: { points?: string; precision?: number };
  polyline?: string;
  steps?: Array<{ polyline?: { points?: string } | string }>;
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
    const mode = mapMotisMode(leg.mode);
    const intermediateStops: JourneyStop[] = [];
    for (const s of leg.intermediateStops ?? []) {
      const name = s.name?.trim();
      if (!name) continue;
      intermediateStops.push({
        name,
        lat: typeof s.lat === 'number' ? s.lat : null,
        lng:
          typeof s.lon === 'number'
            ? s.lon
            : typeof s.lng === 'number'
              ? s.lng
              : null,
        arrival: parseIsoDate(s.arrival) ?? parseIsoDate(s.scheduledArrival),
        departure:
          parseIsoDate(s.departure) ?? parseIsoDate(s.scheduledDeparture),
      });
    }
    const isTransit = mode !== 'WALK' && mode !== 'BIKE';
    const geom = encodedPathFromMotisLeg(leg);
    legs.push({
      mode,
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
      fromPlatform: leg.from?.track || leg.from?.scheduledTrack || null,
      toPlatform: leg.to?.track || leg.to?.scheduledTrack || null,
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
      intermediateStops: intermediateStops.length
        ? intermediateStops
        : undefined,
      // Zwischenhalte + Ausstieg
      stationCount: isTransit
        ? intermediateStops.length + 1
        : null,
      pathEncoded: geom?.points ?? null,
      pathPrecision: geom?.precision ?? null,
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
  params.set('detailedLegs', 'true');
  params.set('detailedTransfers', 'true');
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

function googleStationPairs(
  stations: RouteDirectionsResult['stations'],
): Array<{
    line: string | null;
    fromName: string;
    toName: string;
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
  }> {
  const pairs: Array<{
    line: string | null;
    fromName: string;
    toName: string;
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
  }> = [];
  for (let i = 0; i < stations.length; i++) {
    const dep = stations[i]!;
    if (dep.role !== 'departure') continue;
    const arr = stations.slice(i + 1).find((s) => s.role === 'arrival');
    if (!arr) continue;
    pairs.push({
      line: dep.line ?? arr.line ?? null,
      fromName: dep.name,
      toName: arr.name,
      fromLat: dep.lat,
      fromLng: dep.lng,
      toLat: arr.lat,
      toLng: arr.lng,
    });
  }
  return pairs;
}

function googleResultToItinerary(
  result: RouteDirectionsResult,
  opts?: { arriveByMs?: number; departAtMs?: number },
): JourneyItinerary | null {
  if (!result.steps.length) return null;
  const pairs = googleStationPairs(result.stations);
  let prevTo: string | null = null;
  const stepSecs = result.steps.map((step) => {
    if (typeof step.durationSec === 'number' && step.durationSec > 0) {
      return step.durationSec;
    }
    const isTransit = (step.travelMode || '').toUpperCase() === 'TRANSIT';
    return Math.max(
      30,
      Math.round((step.distanceM || 80) / (isTransit ? 8 : 1.3)),
    );
  });
  const rawSum = stepSecs.reduce((n, s) => n + s, 0);
  const totalSec =
    result.durationSec && result.durationSec > 0
      ? result.durationSec
      : Math.max(60, rawSum);
  let cursor =
    opts?.arriveByMs && opts.arriveByMs > Date.now() + 60_000
      ? opts.arriveByMs - totalSec * 1000
      : opts?.departAtMs && opts.departAtMs > Date.now()
        ? opts.departAtMs
        : Date.now();
  const legs: JourneyLeg[] = [];
  let pairIdx = 0;

  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i]!;
    const durationSec = Math.max(
      20,
      Math.round(totalSec * (stepSecs[i]! / Math.max(1, rawSum))),
    );
    const start = new Date(cursor);
    const end = new Date(cursor + durationSec * 1000);
    cursor = end.getTime();
    const isTransit = (step.travelMode || '').toUpperCase() === 'TRANSIT';
    const pair = isTransit ? pairs[pairIdx++] : null;
    const nextPair = isTransit ? null : pairs[pairIdx];
    const lastArr = [...result.stations]
      .reverse()
      .find((s) => s.role === 'arrival');
    const tidy = (raw: string | null | undefined): string | null => {
      const s = (raw || '').replace(/\s+/g, ' ').trim();
      if (!s || /^(weiter|zwischenstopp|ziel|continue)$/i.test(s)) return null;
      return s;
    };
    const toName = isTransit
      ? tidy(pair?.toName) || 'Haltestelle'
      : tidy(nextPair?.fromName) || tidy(lastArr?.name) || 'Ziel';
    const fromName = isTransit
      ? tidy(pair?.fromName) || 'Halt'
      : tidy(prevTo) || tidy(nextPair?.fromName) || 'Start';
    prevTo = toName;
    legs.push({
      mode: isTransit
        ? 'TRANSIT'
        : result.travelMode === 'bicycling'
          ? 'BIKE'
          : 'WALK',
      fromName,
      toName,
      startTime: start,
      endTime: end,
      scheduledStart: null,
      scheduledEnd: null,
      delaySec: null,
      durationSec,
      distanceM: step.distanceM,
      line: pair?.line ?? (isTransit ? result.stations[0]?.line ?? null : null),
      headsign: null,
      fromPlatform: null,
      realTime: false,
      fromLat: pair?.fromLat ?? step.lat,
      fromLng: pair?.fromLng ?? step.lng,
      toLat: pair?.toLat ?? null,
      toLng: pair?.toLng ?? null,
      pathEncoded: isTransit ? result.overviewPolyline : null,
      path:
        isTransit && result.pathPoints && result.pathPoints.length >= 2
          ? result.pathPoints
          : undefined,
    });
  }

  const startTime = legs[0]!.startTime;
  const endTime = legs[legs.length - 1]!.endTime;
  const firstTransit = legs.find((l) => l.mode === 'TRANSIT');
  return {
    source: 'google',
    startTime,
    endTime,
    durationSec: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    transfers: Math.max(
      0,
      result.stations.filter((s) => s.role === 'departure').length - 1,
    ),
    legs,
    firstTransitDeparture: firstTransit?.startTime ?? null,
    firstTransitLine:
      firstTransit?.line ?? result.stations[0]?.line ?? null,
    firstTransitDelaySec: null,
    walkToStopSec: legs[0]?.mode === 'WALK' ? legs[0].durationSec : null,
  };
}

async function planViaGoogle(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode: PedestrianTravelMode;
  arriveBy?: Date | null;
}): Promise<JourneyItinerary[]> {
  if (!hasGoogleMapsNavKey()) return [];
  const arriveByMs = opts.arriveBy?.getTime();
  const result = await fetchRouteDirectionsResult(
    opts.from,
    opts.to,
    opts.mode,
    arriveByMs ? { arriveByMs } : undefined,
  );
  if (!result) return [];
  const mapped = googleResultToItinerary(result, { arriveByMs });
  return mapped ? [mapped] : [];
}

/**
 * Primär DB + Transitous, Google nur als Fallback wenn beide leer.
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

  if (opts.travelMode !== 'foot' && opts.travelMode !== 'bike') {
    const dbJob = (async () => {
      const { planDbJourneys } = await import('./dbRestJourneys');
      return planDbJourneys({
        from: opts.from,
        to: opts.to,
        arriveBy: opts.arriveBy,
        departAt: opts.departAt,
        results: opts.numItineraries ?? 5,
      });
    })();
    const motisJob = planViaTransitous({
      from: opts.from,
      to: opts.to,
      arriveBy: opts.arriveBy,
      departAt: opts.departAt,
      numItineraries: opts.numItineraries,
    });
    const merged = (
      await collectUntilUseful([dbJob, motisJob], {
        graceMs: 1_200,
        hardMs: 6_500,
      })
    ).filter((it) => it.durationSec > 0 && it.durationSec <= 4 * 3600);
    if (merged.length) {
      const ranked = pickSoonestCatchable(merged, Date.now(), {
        aroundMs: opts.departAt?.getTime() ?? null,
      });
      const top = ranked.ordered.slice(0, opts.numItineraries ?? 5);
      return {
        itineraries: top,
        source: top[0]!.source,
        tight: ranked.tight,
      };
    }
  }

  const google = await planViaGoogle({
    from: opts.from,
    to: opts.to,
    mode: googleMode,
    arriveBy: opts.arriveBy,
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
