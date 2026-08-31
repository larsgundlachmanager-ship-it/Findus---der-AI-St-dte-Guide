/**
 * Deutsche Bahn live via transport.rest (HAFAS-kompatibel).
 * Locations + Journeys + Delays — kein offizieller DB-Client-Secret nötig.
 */

import { env } from '../../config/env';
import type { JourneyItinerary, JourneyLeg, JourneyLegMode } from './journeyPlanner';

const FETCH_MS = 14_000;

function baseUrl(): string {
  return (
    env.dbHafasBaseUrl() ||
    'https://v6.db.transport.rest'
  ).replace(/\/$/, '');
}

function parseWhen(raw: unknown): Date | null {
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function mapProduct(raw?: string | null): JourneyLegMode {
  const p = (raw ?? '').toLowerCase();
  if (/bus/.test(p)) return 'BUS';
  if (/tram|streetcar/.test(p)) return 'TRAM';
  if (/subway|u-bahn|metro/.test(p)) return 'SUBWAY';
  if (/ferry|fähre|faehre/.test(p)) return 'FERRY';
  if (/walk|foot/.test(p)) return 'WALK';
  if (/bike|bicycle/.test(p)) return 'BIKE';
  if (p) return 'RAIL';
  return 'TRANSIT';
}

export type DbLocationHit = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
};

export async function searchDbLocations(
  query: string,
  opts?: { lat?: number; lng?: number; results?: number },
): Promise<DbLocationHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(`${baseUrl()}/locations`);
    u.searchParams.set('query', q);
    u.searchParams.set('results', String(opts?.results ?? 5));
    u.searchParams.set('stops', 'true');
    u.searchParams.set('addresses', 'false');
    u.searchParams.set('poi', 'false');
    if (opts?.lat != null && opts?.lng != null) {
      u.searchParams.set('latitude', String(opts.lat));
      u.searchParams.set('longitude', String(opts.lng));
    }
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      id?: string;
      name?: string;
      latitude?: number;
      longitude?: number;
      type?: string;
    }>;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (x) =>
          x.id &&
          x.name &&
          typeof x.latitude === 'number' &&
          typeof x.longitude === 'number',
      )
      .map((x) => ({
        id: String(x.id),
        name: String(x.name),
        lat: x.latitude!,
        lng: x.longitude!,
        type: x.type ?? 'stop',
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

type DbJourneyLegRaw = {
  walking?: boolean;
  origin?: {
    name?: string;
    departure?: string;
    plannedDeparture?: string;
    departurePlatform?: string | null;
    plannedDeparturePlatform?: string | null;
    platform?: string | null;
    latitude?: number;
    longitude?: number;
    location?: { latitude?: number; longitude?: number };
  };
  destination?: {
    name?: string;
    arrival?: string;
    plannedArrival?: string;
    arrivalPlatform?: string | null;
    plannedArrivalPlatform?: string | null;
    platform?: string | null;
    latitude?: number;
    longitude?: number;
    location?: { latitude?: number; longitude?: number };
  };
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  departureDelay?: number | null;
  arrivalDelay?: number | null;
  departurePlatform?: string | null;
  arrivalPlatform?: string | null;
  line?: { name?: string; productName?: string; product?: string };
  direction?: string;
  distance?: number | null;
  polyline?: unknown;
  stopovers?: Array<{
    stop?: {
      name?: string;
      latitude?: number;
      longitude?: number;
      location?: { latitude?: number; longitude?: number };
    };
    arrival?: string | null;
    departure?: string | null;
    plannedArrival?: string | null;
    plannedDeparture?: string | null;
  }>;
};

function dbCoords(o?: {
  latitude?: number;
  longitude?: number;
  location?: { latitude?: number; longitude?: number };
}): { lat: number | null; lng: number | null } {
  const lat =
    typeof o?.latitude === 'number'
      ? o.latitude
      : typeof o?.location?.latitude === 'number'
        ? o.location.latitude
        : null;
  const lng =
    typeof o?.longitude === 'number'
      ? o.longitude
      : typeof o?.location?.longitude === 'number'
        ? o.location.longitude
        : null;
  return { lat, lng };
}

export function coordsFromDbPolyline(raw: unknown): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  const push = (lng: unknown, lat: unknown) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    out.push({ lat, lng });
  };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as {
    features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }>;
    coordinates?: unknown;
  };
  if (Array.isArray(obj.features)) {
    for (const f of obj.features) {
      const g = f?.geometry;
      if (!g) continue;
      if (g.type === 'Point' && Array.isArray(g.coordinates)) {
        push(g.coordinates[0], g.coordinates[1]);
      } else if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
        for (const c of g.coordinates as unknown[]) {
          if (Array.isArray(c)) push(c[0], c[1]);
        }
      }
    }
  } else if (Array.isArray(obj.coordinates)) {
    for (const c of obj.coordinates as unknown[]) {
      if (Array.isArray(c)) push(c[0], c[1]);
    }
  }
  return out;
}

type DbJourneyRaw = {
  legs?: DbJourneyLegRaw[];
  refreshToken?: string;
};

function mapDbJourney(j: DbJourneyRaw): JourneyItinerary | null {
  const legsRaw = j.legs ?? [];
  if (!legsRaw.length) return null;
  const legs: JourneyLeg[] = [];
  for (const leg of legsRaw) {
    const start =
      parseWhen(leg.departure) ??
      parseWhen(leg.origin?.departure) ??
      parseWhen(leg.plannedDeparture) ??
      parseWhen(leg.origin?.plannedDeparture);
    const end =
      parseWhen(leg.arrival) ??
      parseWhen(leg.destination?.arrival) ??
      parseWhen(leg.plannedArrival) ??
      parseWhen(leg.destination?.plannedArrival);
    if (!start || !end) continue;
    const scheduledStart =
      parseWhen(leg.plannedDeparture) ??
      parseWhen(leg.origin?.plannedDeparture);
    const scheduledEnd =
      parseWhen(leg.plannedArrival) ??
      parseWhen(leg.destination?.plannedArrival);
    const delaySec =
      typeof leg.departureDelay === 'number'
        ? leg.departureDelay
        : scheduledStart
          ? Math.round((start.getTime() - scheduledStart.getTime()) / 1000)
          : null;
    const walking = leg.walking === true;
    const mode = walking
      ? 'WALK'
      : mapProduct(leg.line?.product ?? leg.line?.productName);
    const fromC = dbCoords(leg.origin);
    const toC = dbCoords(leg.destination);
    const intermediateStops: import('./journeyPlanner').JourneyStop[] = [];
    const stopovers = leg.stopovers ?? [];
    // Erster/letzter Stopover oft Einstieg/Ausstieg — innere zählen als Zwischenhalte
    const inner =
      stopovers.length >= 2 ? stopovers.slice(1, -1) : stopovers;
    for (const so of inner) {
      const name = so.stop?.name?.trim();
      if (!name) continue;
      const c = dbCoords(so.stop);
      intermediateStops.push({
        name,
        lat: c.lat,
        lng: c.lng,
        arrival: parseWhen(so.arrival) ?? parseWhen(so.plannedArrival),
        departure: parseWhen(so.departure) ?? parseWhen(so.plannedDeparture),
      });
    }
    const isTransit = mode !== 'WALK' && mode !== 'BIKE';
    const fromPlat =
      leg.departurePlatform ||
      leg.origin?.departurePlatform ||
      leg.origin?.platform ||
      leg.origin?.plannedDeparturePlatform ||
      null;
    const toPlat =
      leg.arrivalPlatform ||
      leg.destination?.arrivalPlatform ||
      leg.destination?.platform ||
      leg.destination?.plannedArrivalPlatform ||
      null;
    const poly = coordsFromDbPolyline(leg.polyline);
    const stationPath = [
      ...(fromC.lat != null && fromC.lng != null
        ? [{ lat: fromC.lat, lng: fromC.lng }]
        : []),
      ...intermediateStops
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ lat: s.lat as number, lng: s.lng as number })),
      ...(toC.lat != null && toC.lng != null
        ? [{ lat: toC.lat, lng: toC.lng }]
        : []),
    ];
    legs.push({
      mode,
      fromName: leg.origin?.name?.trim() || 'Start',
      toName: leg.destination?.name?.trim() || 'Ziel',
      startTime: start,
      endTime: end,
      scheduledStart,
      scheduledEnd,
      delaySec,
      durationSec: Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 1000),
      ),
      distanceM:
        typeof leg.distance === 'number' ? Math.round(leg.distance) : null,
      line: leg.line?.name || leg.line?.productName || null,
      headsign: leg.direction || null,
      fromPlatform: fromPlat,
      toPlatform: toPlat,
      realTime: delaySec != null || typeof leg.departureDelay === 'number',
      fromLat: fromC.lat,
      fromLng: fromC.lng,
      toLat: toC.lat,
      toLng: toC.lng,
      intermediateStops: intermediateStops.length
        ? intermediateStops
        : undefined,
      stationCount: isTransit ? intermediateStops.length + 1 : null,
      path: isTransit
        ? poly.length >= 3
          ? poly
          : stationPath.length >= 3
            ? stationPath
            : undefined
        : undefined,
    });
  }
  if (!legs.length) return null;
  const startTime = legs[0]!.startTime;
  const endTime = legs[legs.length - 1]!.endTime;
  const firstTransit = legs.find((l) => l.mode !== 'WALK' && l.mode !== 'BIKE');
  return {
    source: 'db_rest' as JourneyItinerary['source'],
    startTime,
    endTime,
    durationSec: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    transfers: Math.max(
      0,
      legs.filter((l) => l.mode !== 'WALK' && l.mode !== 'BIKE').length - 1,
    ),
    legs,
    firstTransitDeparture: firstTransit?.startTime ?? null,
    firstTransitLine: firstTransit?.line ?? null,
    firstTransitDelaySec: firstTransit?.delaySec ?? null,
    walkToStopSec: legs[0]?.mode === 'WALK' ? legs[0].durationSec : null,
  };
}

/**
 * Live A→B über DB transport.rest `/journeys`.
 */
export async function planDbJourneys(opts: {
  from: { lat: number; lng: number; name?: string };
  to: { lat: number; lng: number; name?: string };
  arriveBy?: Date | null;
  departAt?: Date | null;
  results?: number;
}): Promise<JourneyItinerary[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(`${baseUrl()}/journeys`);
    u.searchParams.set('from', `${opts.from.lat},${opts.from.lng}`);
    u.searchParams.set('to', `${opts.to.lat},${opts.to.lng}`);
    u.searchParams.set('results', String(opts.results ?? 5));
    u.searchParams.set('stopovers', 'true');
    u.searchParams.set('polylines', 'true');
    u.searchParams.set('language', 'de');
    if (opts.arriveBy) {
      u.searchParams.set('arrival', opts.arriveBy.toISOString());
    } else if (opts.departAt) {
      u.searchParams.set('departure', opts.departAt.toISOString());
    }
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { journeys?: DbJourneyRaw[] };
    const out: JourneyItinerary[] = [];
    for (const j of data.journeys ?? []) {
      const mapped = mapDbJourney(j);
      if (mapped) out.push(mapped);
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live-Abfahrt / Verspätung für benannten Zug (z. B. ICE) an einem Bahnhof.
 */
export async function lookupTrainDeparture(opts: {
  stationQuery: string;
  trainHint?: string | null;
  aroundMs?: number;
  biasLat?: number;
  biasLng?: number;
}): Promise<{
  line: string;
  when: Date;
  plannedWhen: Date | null;
  delaySec: number | null;
  platform: string | null;
  cancelled: boolean;
  stationName: string;
} | null> {
  const stops = await searchDbLocations(opts.stationQuery, {
    lat: opts.biasLat,
    lng: opts.biasLng,
    results: 3,
  });
  const stop = stops[0];
  if (!stop) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(
      `${baseUrl()}/stops/${encodeURIComponent(stop.id)}/departures`,
    );
    u.searchParams.set('results', '12');
    u.searchParams.set('duration', '180');
    if (opts.aroundMs) {
      u.searchParams.set('when', new Date(opts.aroundMs).toISOString());
    }
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      departures?: Array<{
        direction?: string;
        when?: string | null;
        plannedWhen?: string | null;
        delay?: number | null;
        cancelled?: boolean;
        platform?: string | null;
        line?: { name?: string };
      }>;
    };
    const hint = (opts.trainHint ?? '').toLowerCase();
    let rows = data.departures ?? [];
    if (hint) {
      const filtered = rows.filter((d) =>
        (d.line?.name ?? '').toLowerCase().includes(hint.replace(/\s+/g, '')),
      );
      if (filtered.length) rows = filtered;
    }
    const hit = rows[0];
    const when = parseWhen(hit?.when) ?? parseWhen(hit?.plannedWhen);
    if (!hit || !when) return null;
    const plannedWhen = parseWhen(hit.plannedWhen);
    return {
      line: hit.line?.name?.trim() || 'Zug',
      when,
      plannedWhen,
      delaySec:
        typeof hit.delay === 'number'
          ? hit.delay
          : plannedWhen
            ? Math.round((when.getTime() - plannedWhen.getTime()) / 1000)
            : null,
      platform: hit.platform ?? null,
      cancelled: hit.cancelled === true,
      stationName: stop.name,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
