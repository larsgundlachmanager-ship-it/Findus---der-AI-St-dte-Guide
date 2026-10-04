/**
 * Fehlendes/falsches Gleis aus Live-Abfahrtstafel (Failover) — nur Belegtes.
 */

import type { JourneyLeg } from './journeyPlanner';
import { linesMatch } from './missedConnectionPolicy';
import { isTransitJourneyMode } from './journeyPath';

export type PlatformBoardRow = {
  line: string | null;
  whenMs: number;
  platform: string | null;
  direction?: string | null;
};

const MATCH_WINDOW_MS = 8 * 60_000;

function normalizeLineKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9äöüß]/gi, '');
}

function normalizePlat(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/** Wie linesMatch, aber S6 ≠ S60 / Bus 1 ≠ Bus 11. */
export function linesMatchForPlatform(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeLineKey(a);
  const nb = normalizeLineKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (!linesMatch(a, b)) return false;
  if (na.length < nb.length && nb.startsWith(na) && /\d/.test(nb[na.length]!)) {
    return false;
  }
  if (nb.length < na.length && na.startsWith(nb) && /\d/.test(na[nb.length]!)) {
    return false;
  }
  return true;
}

/**
 * Wählt ein Gleis nur wenn Linie + Abfahrtsfenster passen und die Tafel ein Platform hat.
 */
export function pickBoardPlatform(opts: {
  line: string | null;
  depMs: number | null;
  headsign?: string | null;
  candidates: PlatformBoardRow[];
  windowMs?: number;
}): string | null {
  const window = opts.windowMs ?? MATCH_WINDOW_MS;
  const dep = opts.depMs;
  if (dep == null || !Number.isFinite(dep)) return null;
  const line = (opts.line || '').trim();
  if (!line) return null;

  let best: { plat: string; score: number } | null = null;
  for (const row of opts.candidates) {
    const plat = (row.platform || '').trim();
    if (!plat) continue;
    if (!linesMatchForPlatform(row.line, line)) continue;
    const delta = Math.abs(row.whenMs - dep);
    if (delta > window) continue;
    let score = 1000 - Math.round(delta / 1000);
    if (normalizeLineKey(row.line) === normalizeLineKey(line)) score += 80;
    const head = (opts.headsign || '').trim().toLowerCase();
    const dir = (row.direction || '').trim().toLowerCase();
    if (head && dir && (dir.includes(head) || head.includes(dir))) score += 40;
    if (!best || score > best.score) best = { plat, score };
  }
  return best?.plat ?? null;
}

async function lookupPlatformForLeg(leg: JourneyLeg): Promise<{
  from: string | null;
  to: string | null;
  delaySec: number | null;
  cancelled: boolean;
}> {
  const curFrom = (leg.fromPlatform || '').trim() || null;
  const curTo = (leg.toPlatform || '').trim() || null;
  if (!isTransitJourneyMode(leg.mode)) {
    return {
      from: curFrom,
      to: curTo,
      delaySec: leg.delaySec ?? null,
      cancelled: false,
    };
  }

  let from = curFrom;
  let delaySec = leg.delaySec ?? null;
  let cancelled = false;

  if ((leg.fromName || '').trim() && leg.line) {
    try {
      const { lookupBoardDeparture } = await import('./lookupBoardDeparture');
      const hit = await lookupBoardDeparture({
        stationName: leg.fromName,
        line: leg.line,
        depMs: leg.startTime?.getTime?.() ?? null,
        lat: leg.fromLat ?? null,
        lng: leg.fromLng ?? null,
        headsign: leg.headsign,
      });
      if (hit) {
        cancelled = hit.cancelled;
        if (hit.delaySec != null) delaySec = hit.delaySec;
        if (hit.platform) {
          if (!from || normalizePlat(from) !== normalizePlat(hit.platform)) {
            from = hit.platform;
          }
        }
      }
    } catch {
      /* soft */
    }
  }

  return { from, to: curTo, delaySec, cancelled };
}

/**
 * Füllt/korrigiert fromPlatform (+ Delay) aus Live-Tafel mit Failover.
 */
export async function enrichJourneyPlatforms(
  legs: JourneyLeg[],
): Promise<JourneyLeg[]> {
  const out: JourneyLeg[] = [];
  for (const leg of legs) {
    if (!isTransitJourneyMode(leg.mode)) {
      out.push(leg);
      continue;
    }
    const filled = await lookupPlatformForLeg(leg);
    out.push({
      ...leg,
      fromPlatform: filled.from ?? leg.fromPlatform ?? null,
      toPlatform: filled.to ?? leg.toPlatform ?? null,
      delaySec: filled.delaySec ?? leg.delaySec ?? null,
    });
  }
  return out;
}

/**
 * Live-Gleis für Tour-Board-Stop (am Halt nachziehen, Failover).
 */
export async function lookupPlatformForBoard(opts: {
  stationName: string | null;
  line: string | null;
  headsign?: string | null;
  depMs: number | null;
  lat?: number | null;
  lng?: number | null;
  currentPlatform?: string | null;
}): Promise<string | null> {
  try {
    const { lookupPlatformWithFailover } = await import('./lookupBoardDeparture');
    return await lookupPlatformWithFailover({
      stationName: opts.stationName,
      line: opts.line,
      depMs: opts.depMs,
      lat: opts.lat,
      lng: opts.lng,
      headsign: opts.headsign,
      currentPlatform: opts.currentPlatform,
    });
  } catch {
    return null;
  }
}
