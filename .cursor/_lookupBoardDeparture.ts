/**
 * Live-Abfahrtstafel mit Failover (Transitous → DB/HAFAS → GTFS-RT).
 * SSOT für Gleis / Delay / Cancel in Leave-by + Platform-Enrich.
 */

import { fetchLiveDeparturesForCity } from './adapters';
import { searchDbLocations } from './dbRestJourneys';
import {
  linesMatchForPlatform,
  pickBoardPlatform,
} from './enrichJourneyPlatforms';

const MATCH_WINDOW_MS = 8 * 60_000;

export type BoardDepartureHit = {
  line: string;
  whenMs: number;
  plannedWhenMs: number | null;
  delaySec: number | null;
  platform: string | null;
  cancelled: boolean;
  direction: string | null;
  source: string;
};

type BoardCandidate = {
  line: string | null;
  whenMs: number;
  plannedWhenMs: number | null;
  delaySec: number | null;
  platform: string | null;
  cancelled: boolean;
  direction: string | null;
};

function normalizePlat(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Beste Tafel-Zeile für Linie + Abfahrtsfenster (auch ohne Platform / bei Cancel).
 */
export function pickBoardDeparture(opts: {
  line: string | null;
  depMs: number | null;
  headsign?: string | null;
  candidates: BoardCandidate[];
  windowMs?: number;
}): BoardDepartureHit | null {
  const window = opts.windowMs ?? MATCH_WINDOW_MS;
  const dep = opts.depMs;
  if (dep == null || !Number.isFinite(dep)) return null;
  const line = (opts.line || '').trim();
  if (!line) return null;

  let best: { row: BoardCandidate; score: number } | null = null;
  for (const row of opts.candidates) {
    if (!linesMatchForPlatform(row.line, line)) continue;
    const delta = Math.abs(row.whenMs - dep);
    // Cancelled oft nur mit plannedWhen nahe armed.
    const plannedDelta =
      row.plannedWhenMs != null
        ? Math.abs(row.plannedWhenMs - dep)
        : delta;
    if (delta > window && plannedDelta > window) continue;
    let score = 1000 - Math.round(Math.min(delta, plannedDelta) / 1000);
    if (
      (row.line || '').toLowerCase().replace(/\s+/g, '') ===
      line.toLowerCase().replace(/\s+/g, '')
    ) {
      score += 80;
    }
    const head = (opts.headsign || '').trim().toLowerCase();
    const dir = (row.direction || '').trim().toLowerCase();
    if (head && dir && (dir.includes(head) || head.includes(dir))) score += 40;
    if (row.cancelled) score += 20;
    if ((row.platform || '').trim()) score += 10;
    if (!best || score > best.score) best = { row, score };
  }
  if (!best) return null;
  const r = best.row;
  return {
    line: (r.line || line).trim(),
    whenMs: r.whenMs,
    plannedWhenMs: r.plannedWhenMs,
    delaySec: r.delaySec,
    platform: (r.platform || '').trim() || null,
    cancelled: r.cancelled === true,
    direction: r.direction,
    source: 'board',
  };
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

    const candidates: BoardCandidate[] = live.departures.map((d) => ({
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
  /** Bestehendes Plan-Gleis — wird überschrieben wenn Board klar anders. */
  currentPlatform?: string | null;
}): Promise<string | null> {
  const hit = await lookupBoardDeparture(opts);
  const boardPlat = hit?.platform?.trim() || null;
  if (!boardPlat) {
    // Fallback: alte Single-Row-Logik über pickBoardPlatform falls Hit ohne Plat.
    return null;
  }
  const cur = (opts.currentPlatform || '').trim();
  if (!cur) return boardPlat;
  if (normalizePlat(cur) === normalizePlat(boardPlat)) return cur;
  // Board korrigiert Plan-Gleis (gleiche Linie/Fenster bereits in pick).
  return boardPlat;
}

export { pickBoardPlatform, linesMatchForPlatform };
