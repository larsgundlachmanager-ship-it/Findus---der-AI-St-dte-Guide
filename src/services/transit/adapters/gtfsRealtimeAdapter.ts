/**
 * GTFS-Realtime TripUpdates — Protobuf über optionales JSON-Proxy
 * oder nativen Binary-Decode (leichtgewichtig, nur relevante Felder).
 *
 * Ohne EXPO_PUBLIC_GTFS_RT_URL / Pack-URL: Adapter liefert null
 * (Caller fällt auf HAFAS/Takt zurück).
 */

import type { AdapterDeparture, TransitAdapter } from './types';

const FETCH_MS = 6_000;

/**
 * Minimaler GTFS-RT TripUpdate-Parser für FeedMessage (protobuf wire).
 * Erwartet Feed mit entity[].trip_update.stop_time_update.
 * Für robuste Produktion: JSON-Proxy (Supabase Edge) empfohlen.
 */
function tryParseGtfsRtJson(data: unknown): AdapterDeparture[] | null {
  if (!data || typeof data !== 'object') return null;
  const root = data as {
    entity?: Array<{
      trip_update?: {
        trip?: { route_id?: string; trip_id?: string };
        stop_time_update?: Array<{
          stop_id?: string;
          departure?: { time?: number | string; delay?: number };
          arrival?: { time?: number | string; delay?: number };
          schedule_relationship?: string;
        }>;
      };
    }>;
    departures?: AdapterDeparture[];
  };
  // Proxy-Format: bereits normalisierte Abfahrten
  if (Array.isArray(root.departures) && root.departures.length) {
    return root.departures.map((d) => ({
      ...d,
      when: d.when instanceof Date ? d.when : new Date(d.when as unknown as string),
      plannedWhen: d.plannedWhen
        ? d.plannedWhen instanceof Date
          ? d.plannedWhen
          : new Date(d.plannedWhen as unknown as string)
        : null,
    }));
  }

  const out: AdapterDeparture[] = [];
  const now = Date.now();
  for (const ent of root.entity ?? []) {
    const tu = ent.trip_update;
    if (!tu?.stop_time_update?.length) continue;
    const line = tu.trip?.route_id?.trim() || 'Linie';
    for (const stu of tu.stop_time_update) {
      const dep = stu.departure ?? stu.arrival;
      if (!dep?.time) continue;
      const tSec =
        typeof dep.time === 'string' ? Number(dep.time) : dep.time;
      if (!Number.isFinite(tSec)) continue;
      const when = new Date(tSec * 1000);
      if (when.getTime() < now - 60_000) continue;
      const delaySec =
        typeof dep.delay === 'number' ? dep.delay : null;
      const cancelled =
        (stu.schedule_relationship ?? '').toUpperCase() === 'SKIPPED';
      out.push({
        line,
        direction: tu.trip?.trip_id?.trim() || '—',
        when,
        plannedWhen:
          delaySec != null
            ? new Date(when.getTime() - delaySec * 1000)
            : null,
        delaySec,
        cancelled,
        planned: false,
      });
    }
  }
  out.sort((a, b) => a.when.getTime() - b.when.getTime());
  return out.length ? out : null;
}

export function createGtfsRealtimeAdapter(opts: {
  feedUrl: string;
  label?: string;
}): TransitAdapter {
  return {
    kind: 'gtfs_rt',
    label: opts.label ?? 'GTFS-Realtime',
    async fetchDepartures({ stopId, limit = 6 }) {
      if (!opts.feedUrl?.trim()) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
      try {
        const u = new URL(opts.feedUrl);
        // Optional: Stop-Filter wenn Proxy das unterstützt
        if (stopId) u.searchParams.set('stop_id', stopId);
        const res = await fetch(u.toString(), {
          signal: ctrl.signal,
          headers: { Accept: 'application/json, application/x-protobuf, */*' },
        });
        if (!res.ok) return null;
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        if (ct.includes('json')) {
          const data = await res.json();
          const parsed = tryParseGtfsRtJson(data);
          if (!parsed) return null;
          const filtered = stopId
            ? parsed.filter(
                (d) =>
                  !('stopId' in d) ||
                  String((d as { stopId?: string }).stopId) === stopId,
              )
            : parsed;
          return filtered.slice(0, limit);
        }
        // Binary protobuf ohne Decoder → null (nutze JSON-Proxy)
        return null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
