/**
 * Transitous / MOTIS Adapter: Live-Abfahrten (stoptimes) + Stop-Auflösung.
 */

import type { AdapterDeparture, TransitAdapter } from './types';
import {
  delaySecFromTimes,
  parseIsoDate,
  placeTuple,
  transitousFetchJson,
} from './transitousClient';
import { directionMatchesHint } from '../directionMatch';

type MotisStopTime = {
  place?: {
    name?: string;
    departure?: string;
    scheduledDeparture?: string;
    cancelled?: boolean;
    track?: string;
    scheduledTrack?: string;
  };
  mode?: string;
  realTime?: boolean;
  headsign?: string;
  routeShortName?: string;
  displayName?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
};

type MotisGeocodeHit = {
  type?: string;
  name?: string;
  id?: string;
  lat?: number;
  lon?: number;
  modes?: string[];
};

/** Motis liefert oft ein blankes Array, selten `{ value: [...] }`. */
function asMatchList(data: unknown): MotisGeocodeHit[] {
  if (Array.isArray(data)) return data as MotisGeocodeHit[];
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as { value?: unknown }).value)
  ) {
    return (data as { value: MotisGeocodeHit[] }).value;
  }
  return [];
}

function isStopHit(h: MotisGeocodeHit): boolean {
  if (!h?.id) return false;
  if (!h.type) return true; // manche Feeds ohne type
  return h.type === 'STOP' || h.type === 'stop';
}

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Nächste Transitous-Halt-ID per Geocode / Reverse-Geocode.
 */
export async function resolveTransitousStopId(opts: {
  stopIdHint?: string | null;
  nameHint?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<string | null> {
  const hint = opts.stopIdHint?.trim();
  // Bereits MOTIS-ID (z. B. de-DELFI_…)
  if (hint && /[_:]/.test(hint) && !/^\d{6,8}$/.test(hint)) {
    return hint;
  }

  if (opts.lat != null && opts.lng != null && Number.isFinite(opts.lat)) {
    const rev = await transitousFetchJson(
      `/v1/reverse-geocode?place=${encodeURIComponent(
        placeTuple(opts.lat, opts.lng),
      )}&type=STOP`,
    );
    const hits = asMatchList(rev);
    const stop = hits.find((h) => isStopHit(h));
    if (stop?.id) return stop.id;
  }

  const text =
    opts.nameHint?.trim() ||
    (hint && /^\d{6,8}$/.test(hint) ? undefined : hint) ||
    null;
  if (text && text.length >= 2) {
    const geo = await transitousFetchJson(
      `/v1/geocode?text=${encodeURIComponent(text)}&language=de&type=STOP`,
    );
    const hits = asMatchList(geo);
    let best: MotisGeocodeHit | null = null;
    let bestDist = Infinity;
    for (const h of hits) {
      if (!isStopHit(h) || !h.id) continue;
      if (opts.lat != null && opts.lng != null && h.lat != null && h.lon != null) {
        const d = haversineM(opts.lat, opts.lng, h.lat, h.lon);
        if (d < bestDist) {
          bestDist = d;
          best = h;
        }
      } else if (!best) {
        best = h;
      }
    }
    if (best?.id && (bestDist < 2500 || opts.lat == null)) return best.id;
  }

  // IBNR als Suchtext (DELFI oft …:8004888)
  if (hint && /^\d{6,8}$/.test(hint)) {
    const geo = await transitousFetchJson(
      `/v1/geocode?text=${encodeURIComponent(hint)}&language=de&type=STOP`,
    );
    const hits = asMatchList(geo);
    const match = hits.find(
      (h) =>
        isStopHit(h) &&
        typeof h.id === 'string' &&
        h.id.includes(hint),
    );
    if (match?.id) return match.id;
    if (hits[0] && isStopHit(hits[0]) && hits[0].id) return hits[0].id;
  }

  return null;
}

function mapStopTime(
  row: MotisStopTime,
  directionHint?: string | null,
): AdapterDeparture | null {
  if (row.cancelled || row.tripCancelled || row.place?.cancelled) {
    const when =
      parseIsoDate(row.place?.departure) ??
      parseIsoDate(row.place?.scheduledDeparture);
    if (!when) return null;
    return {
      line: row.routeShortName || row.displayName || 'Linie',
      direction: row.headsign || '—',
      when,
      plannedWhen: parseIsoDate(row.place?.scheduledDeparture),
      delaySec: null,
      cancelled: true,
      planned: !row.realTime,
      platform: row.place?.track || row.place?.scheduledTrack || null,
    };
  }

  const when =
    parseIsoDate(row.place?.departure) ??
    parseIsoDate(row.place?.scheduledDeparture);
  if (!when) return null;
  const plannedWhen = parseIsoDate(row.place?.scheduledDeparture);
  const delaySec = delaySecFromTimes(when, plannedWhen);
  const direction = (row.headsign || '—').trim();
  const hint = (directionHint ?? '').toLowerCase().trim();
  if (hint && !directionMatchesHint(direction, hint)) {
    return null;
  }

  return {
    line: (row.routeShortName || row.displayName || 'Linie').trim(),
    direction,
    when,
    plannedWhen,
    delaySec,
    cancelled: false,
    planned: !row.realTime,
    platform: row.place?.track || row.place?.scheduledTrack || null,
  };
}

export function createTransitousAdapter(opts?: {
  label?: string;
  /** Optional: Lat/Lng der Station für Stop-ID-Auflösung. */
  stationLat?: number | null;
  stationLng?: number | null;
  stationName?: string | null;
}): TransitAdapter {
  return {
    kind: 'transitous',
    label: opts?.label ?? 'Transitous (MOTIS / GTFS-RT)',
    async fetchDepartures({ stopId, directionHint, limit = 6 }) {
      const resolved = await resolveTransitousStopId({
        stopIdHint: stopId,
        nameHint: opts?.stationName,
        lat: opts?.stationLat,
        lng: opts?.stationLng,
      });
      if (!resolved) return null;

      const data = await transitousFetchJson(
        `/v5/stoptimes?stopId=${encodeURIComponent(resolved)}&n=${Math.min(
          12,
          Math.max(limit, 4),
        )}`,
      );
      const rows = (data as { stopTimes?: MotisStopTime[] } | null)?.stopTimes;
      if (!rows?.length) return null;

      const out: AdapterDeparture[] = [];
      const hint = (directionHint ?? '').trim();

      for (const row of rows) {
        const mapped = mapStopTime(row, hint);
        if (!mapped) continue;
        out.push(mapped);
        if (out.length >= limit) break;
      }

      // Wenn Richtungsfilter alles verworfen hat → ungefiltert (Caller kann Ziel-Journey nutzen)
      if (!out.length && hint) {
        for (const row of rows) {
          const mapped = mapStopTime(row, null);
          if (!mapped) continue;
          out.push(mapped);
          if (out.length >= limit) break;
        }
      }

      return out.length ? out : null;
    },
  };
}
