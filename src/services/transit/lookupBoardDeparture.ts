/**
 * Live-Abfahrtstafel mit Failover (Transitous → DB/HAFAS → GTFS-RT).
 * SSOT für Gleis / Delay / Cancel in Leave-by + Platform-Enrich.
 */

import { fetchLiveDeparturesForCity } from './adapters';
import { searchDbLocations } from './dbRestJourneys';
import {
  pickBoardDeparture,
  type BoardDepartureHit,
} from './enrichJourneyPlatforms';

export type { BoardDepartureHit };
export { pickBoardDeparture } from './enrichJourneyPlatforms';

function normalizePlat(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Live-Board für benannte Haltestelle + Linie (Failover-Stack).
 */
export async function lookupBoardDeparture(opts: {
  stationName: string | null;
  line: string | null;
  depMs?: number | null;
  lat?: number | null;
  lng?: number | null;
  headsign?: string | null;
  cityId?: string | null;
  limit?: number;
}): Promise<BoardDepartureHit | null> {
  const station = (opts.stationName || '').trim();
  const line = (opts.line || '').trim();
  if (!station || !line) return null;

  let stopId = station;
  try {
    const stops = await searchDbLocations(station, {
      lat: opts.lat ?? undefined,
      lng: opts.lng ?? undefined,
      results: 3,
    });
    if (stops[0]?.id) stopId = stops[0].id;
  } catch {
    /* soft — Transitous kann Name/Lat lösen */
  }

  try {
    const live = await fetchLiveDeparturesForCity({
      cityId: opts.cityId,
      stopId,
      limit: opts.limit ?? 12,
      stationLat: opts.lat,
      stationLng: opts.lng,
      stationName: station,
      directionHint: opts.headsign ?? null,
    });
    if (!live?.departures?.length) return null;

    const candidates = live.departures.map((d) => ({
      line: d.line,
      whenMs: d.when.getTime(),
      plannedWhenMs: d.plannedWhen?.getTime() ?? null,
      delaySec: d.delaySec,
      platform: d.platform ?? null,
      cancelled: d.cancelled === true,
      direction: d.direction ?? null,
    }));

    const depMs =
      opts.depMs != null && Number.isFinite(opts.depMs)
        ? opts.depMs
        : candidates[0]?.whenMs ?? null;

    const hit = pickBoardDeparture({
      line,
      depMs,
      headsign: opts.headsign,
      candidates,
    });
    if (!hit) return null;
    return { ...hit, source: live.source || live.adapterLabel || 'board' };
  } catch {
    return null;
  }
}

/**
 * Nur Gleis — mit Failover; optional Korrektur wenn Board ≠ Plan.
 */
export async function lookupPlatformWithFailover(opts: {
  stationName: string | null;
  line: string | null;
  depMs?: number | null;
  lat?: number | null;
  lng?: number | null;
  headsign?: string | null;
  cityId?: string | null;
  currentPlatform?: string | null;
}): Promise<string | null> {
  const hit = await lookupBoardDeparture(opts);
  const boardPlat = hit?.platform?.trim() || null;
  if (!boardPlat) return null;
  const cur = (opts.currentPlatform || '').trim();
  if (!cur) return boardPlat;
  if (normalizePlat(cur) === normalizePlat(boardPlat)) return cur;
  return boardPlat;
}
