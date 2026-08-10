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
  origin?: { name?: string; departure?: string; plannedDeparture?: string };
  destination?: { name?: string; arrival?: string; plannedArrival?: string };
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  departureDelay?: number | null;
  arrivalDelay?: number | null;
  line?: { name?: string; productName?: string; product?: string };
  direction?: string;
  distance?: number | null;
};

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
    legs.push({
      mode: walking
        ? 'WALK'
        : mapProduct(leg.line?.product ?? leg.line?.productName),
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
      realTime: delaySec != null || typeof leg.departureDelay === 'number',
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
    u.searchParams.set('stopovers', 'false');
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
