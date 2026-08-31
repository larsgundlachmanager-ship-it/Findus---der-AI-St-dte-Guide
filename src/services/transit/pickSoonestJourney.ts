/**
 * ÖPNV-Auswahl: nächste erreichbare Verbindung, bei Gleichstand die kürzere.
 * Nicht „die mit den meisten Zwischenhalten“.
 */

import type { JourneyItinerary } from './journeyPlanner';
import { STATION_ARRIVE_BEFORE_MIN } from './stationArriveBuffer';
import { nextMsWithinWindow } from '../time/clockSnap';

export const STATION_BUFFER_MIN = STATION_ARRIVE_BEFORE_MIN;
export const CATCHABLE_SLACK_MS = STATION_ARRIVE_BEFORE_MIN * 60_000;

export function depMsOf(it: JourneyItinerary): number {
  const d = it.firstTransitDeparture ?? it.startTime;
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : NaN;
}

export function walkMinFromItinerary(it: JourneyItinerary): number {
  const sec = it.walkToStopSec;
  if (typeof sec === 'number' && Number.isFinite(sec) && sec > 20) {
    return Math.max(1, Math.round(sec / 60));
  }
  const walk = (it.legs ?? []).find((l) => l.mode === 'WALK' || l.mode === 'BIKE');
  if (walk && typeof walk.durationSec === 'number' && walk.durationSec > 20) {
    return Math.max(1, Math.round(walk.durationSec / 60));
  }
  return 8;
}

export function isCatchable(
  it: JourneyItinerary,
  nowMs: number,
  slackMs = CATCHABLE_SLACK_MS,
): boolean {
  const dep = depMsOf(it);
  if (!Number.isFinite(dep)) return false;
  const walkMin = walkMinFromItinerary(it);
  const needMs = Math.max(
    slackMs,
    (walkMin + STATION_ARRIVE_BEFORE_MIN) * 60_000,
  );
  return dep >= nowMs + needMs;
}

/** Noch nicht abgefahren — auch wenn's knapp wird (Sprint). */
export function hasNotDeparted(
  it: JourneyItinerary,
  nowMs: number,
  graceMs = 20_000,
): boolean {
  const dep = depMsOf(it);
  return Number.isFinite(dep) && dep + graceMs > nowMs;
}

export function isComfortable(
  it: JourneyItinerary,
  nowMs: number,
  bufferMin = STATION_BUFFER_MIN,
): boolean {
  const dep = depMsOf(it);
  if (!Number.isFinite(dep)) return false;
  const walkMin = walkMinFromItinerary(it);
  return dep >= nowMs + (walkMin + bufferMin) * 60_000;
}

export function rankSoonestThenFastest(
  a: JourneyItinerary,
  b: JourneyItinerary,
): number {
  const da = depMsOf(a);
  const db = depMsOf(b);
  const aOk = Number.isFinite(da);
  const bOk = Number.isFinite(db);
  if (aOk && bOk && da !== db) return da - db;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return a.durationSec - b.durationSec;
}

function normalizeLine(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function firstTransitName(it: JourneyItinerary, which: 'from' | 'to'): string {
  const leg = (it.legs ?? []).find((l) => l.mode !== 'WALK' && l.mode !== 'BIKE');
  const n = which === 'from' ? leg?.fromName : leg?.toName;
  return String(n ?? '')
    .toLowerCase()
    .slice(0, 12);
}

/** Gleiche Linie, fast gleiche Abfahrt → eine Fahrt (Soll vs. Live). */
export function sameTransitRide(a: JourneyItinerary, b: JourneyItinerary): boolean {
  const la = normalizeLine(a.firstTransitLine);
  const lb = normalizeLine(b.firstTransitLine);
  if (!la || la !== lb) return false;
  const da = depMsOf(a);
  const db = depMsOf(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  if (Math.abs(da - db) > 7 * 60_000) return false;
  const fa = firstTransitName(a, 'from');
  const fb = firstTransitName(b, 'from');
  if (fa && fb && fa.slice(0, 6) !== fb.slice(0, 6) && !fa.includes(fb.slice(0, 5))) {
    return false;
  }
  return true;
}

/** Mehr Live-Daten / Gleise / Geometrie schlägt Google-Sollzeit. */
export function itineraryDetailScore(it: JourneyItinerary): number {
  let n = it.source === 'google' ? 0 : 8;
  for (const leg of it.legs ?? []) {
    if (leg.fromPlatform) n += 3;
    if (leg.toPlatform) n += 2;
    if (leg.headsign) n += 2;
    if (leg.realTime) n += 3;
    if (typeof leg.delaySec === 'number' && Math.abs(leg.delaySec) >= 30) n += 2;
    if (leg.fromLat != null && leg.toLat != null) n += 4;
    if ((leg.pathEncoded?.length ?? 0) >= 16) n += 6;
    if ((leg.path?.length ?? 0) >= 3) n += 5;
    if ((leg.intermediateStops?.length ?? 0) > 0) n += 1;
  }
  return n;
}

export function pickRichestSameRide(its: JourneyItinerary[]): JourneyItinerary[] {
  const out: JourneyItinerary[] = [];
  for (const it of its) {
    const idx = out.findIndex((g) => sameTransitRide(g, it));
    if (idx < 0) {
      out.push(it);
      continue;
    }
    const cur = out[idx]!;
    out[idx] = itineraryDetailScore(it) > itineraryDetailScore(cur) ? it : cur;
  }
  return out;
}

/**
 * Nächste Verbindung, die noch nicht weg ist. Knapp = tight (Sprint),
 * nicht automatisch die Folgefahrt.
 * Mit aroundMs (gewünschte Uhr): ±45 Min ok, bei mehreren die nächste Zeit.
 */
export function pickSoonestCatchable(
  its: JourneyItinerary[],
  nowMs = Date.now(),
  opts?: { aroundMs?: number | null },
): {
  ordered: JourneyItinerary[];
  pick: JourneyItinerary | null;
  tight: boolean;
} {
  const ranked = pickRichestSameRide(its).sort(rankSoonestThenFastest);
  const stillComing = ranked.filter((it) => hasNotDeparted(it, nowMs));
  const around =
    opts?.aroundMs != null && Number.isFinite(opts.aroundMs)
      ? opts.aroundMs
      : null;
  const pool = stillComing.length ? stillComing : ranked;
  const snapped =
    around != null
      ? nextMsWithinWindow(pool, (it) => {
          const d = depMsOf(it);
          return Number.isFinite(d) ? d : null;
        }, around)
      : null;
  const pick = (snapped ?? stillComing[0] ?? null) as JourneyItinerary | null;
  if (!pick) return { ordered: ranked, pick: null, tight: false };
  const rest = ranked.filter((it) => it !== pick);
  return {
    ordered: [pick, ...rest],
    pick,
    tight: !isComfortable(pick, nowMs),
  };
}
