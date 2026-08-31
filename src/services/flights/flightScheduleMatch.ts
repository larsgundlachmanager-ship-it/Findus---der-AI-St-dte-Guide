/**
 * Uhr → Linienflug auf einer Strecke.
 * Abweichung bis 45 Min ok; bei mehreren Treffern immer die nächste Zeit.
 * Abflug-Uhr in der Zeitzone des Abflughafens — nicht Device-local.
 */

import { CLOCK_SNAP_MIN, signedClockDiffMin } from '../time/clockSnap';

export { CLOCK_SNAP_MIN, nextMsWithinWindow } from '../time/clockSnap';

export type ClockHit = {
  ident: string;
  estimatedDeparture: Date | null;
  scheduledDeparture: Date | null;
};

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function clockHmInZone(d: Date, timeZone = 'Europe/Berlin'): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
    const h = parts.hour ?? '00';
    const m = parts.minute ?? '00';
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

function depMinutes(hit: ClockHit, timeZone?: string): number | null {
  const t = hit.estimatedDeparture ?? hit.scheduledDeparture;
  if (!t || !Number.isFinite(t.getTime())) return null;
  if (timeZone) return hmToMinutes(clockHmInZone(t, timeZone));
  return t.getHours() * 60 + t.getMinutes();
}

/**
 * Genau ein Treffer im Fenster um die genannte Uhr — sonst null (nachfragen).
 */
export function pickUniqueHitByClock<T extends ClockHit>(
  hits: T[],
  clockHm: string,
  windowMin = CLOCK_SNAP_MIN,
  timeZone?: string,
): T | null {
  const target = hmToMinutes(clockHm);
  const near = hits
    .map((h) => {
      const m = depMinutes(h, timeZone);
      return m == null
        ? null
        : { h, diff: Math.abs(signedClockDiffMin(m, target)) };
    })
    .filter((x): x is { h: T; diff: number } => x != null && x.diff <= windowMin)
    .sort((a, b) => a.diff - b.diff);
  if (near.length === 1) return near[0]!.h;
  return null;
}

/** Nächster Treffer im Fenster — 11:00 nimmt 11:05, nicht 10:40. 20:00 nimmt 19:55. */
export function pickBestHitByClock<T extends ClockHit>(
  hits: T[],
  clockHm: string,
  windowMin = CLOCK_SNAP_MIN,
  timeZone?: string,
): T | null {
  return nextHitByClock(hits, clockHm, windowMin, timeZone);
}

export function nearestHitByClock<T extends ClockHit>(
  hits: T[],
  clockHm: string,
  maxMin: number,
  timeZone?: string,
): T | null {
  const target = hmToMinutes(clockHm);
  let best: T | null = null;
  let bestDiff = maxMin + 1;
  for (const h of hits) {
    const m = depMinutes(h, timeZone);
    if (m == null) continue;
    const diff = Math.abs(signedClockDiffMin(m, target));
    if (diff < bestDiff) {
      best = h;
      bestDiff = diff;
    }
  }
  return bestDiff <= maxMin ? best : null;
}

/** Bei mehreren Treffern im Fenster: immer die nächste Uhr (gleich oder danach). */
export function nextHitByClock<T extends ClockHit>(
  hits: T[],
  clockHm: string,
  windowMin = CLOCK_SNAP_MIN,
  timeZone?: string,
): T | null {
  const target = hmToMinutes(clockHm);
  const scored: Array<{ h: T; diff: number }> = [];
  for (const h of hits) {
    const m = depMinutes(h, timeZone);
    if (m == null) continue;
    const diff = signedClockDiffMin(m, target);
    if (Math.abs(diff) > windowMin) continue;
    scored.push({ h, diff });
  }
  if (!scored.length) return null;
  const after = scored.filter((s) => s.diff >= 0).sort((a, b) => a.diff - b.diff);
  if (after[0]) return after[0].h;
  scored.sort((a, b) => b.diff - a.diff);
  return scored[0]?.h ?? null;
}
