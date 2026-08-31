/**
 * Harte vs. weiche Timeline-Anker — feste User-Termine nie auto-verschieben.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';
import type { PlanPriority } from './planningTypes';

export function prioOfStop(s: Pick<FuturePlanStop, 'planPriority' | 'hardAnchor'>): PlanPriority {
  return (s.planPriority ?? (s.hardAnchor ? 1 : 5)) as PlanPriority;
}

/** User-fixer / Prio-1–2 / hardAnchor — nur manuell verschiebbar. */
export function isHardFixedStop(
  s: Pick<
    FuturePlanStop,
    'hardAnchor' | 'userFixedTime' | 'planPriority' | 'kind' | 'id'
  > | null | undefined,
): boolean {
  if (!s) return false;
  if (s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_') || s.id.startsWith('explore_')) return false;
  if (s.hardAnchor) return true;
  if (s.userFixedTime) return true;
  return prioOfStop(s) <= 2;
}

/** Soft Tour-/Wunsch-Items dürfen Yorro verschieben. */
export function isSoftMovableStop(
  s: Pick<
    FuturePlanStop,
    'hardAnchor' | 'userFixedTime' | 'planPriority' | 'kind' | 'id'
  >,
): boolean {
  if (s.kind === 'nav_leg') return false;
  if (isHardFixedStop(s)) return false;
  return prioOfStop(s) >= 3;
}

function intervalOf(s: FuturePlanStop, fallbackDurMs = 45 * 60_000): {
  start: number;
  end: number;
} | null {
  if (s.plannedStartMs == null) return null;
  return {
    start: s.plannedStartMs,
    end: s.plannedEndMs ?? s.plannedStartMs + fallbackDurMs,
  };
}

export function intervalsOverlapMs(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  return a0 < b1 && b0 < a1;
}

/** Harte Intervalle eines Tages (für Slot-Suche). */
export function hardIntervalsFromStops(
  stops: FuturePlanStop[],
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const s of stops) {
    if (s.kind === 'nav_leg' || s.id.startsWith('choice_')) continue;
    if (!isHardFixedStop(s)) continue;
    const iv = intervalOf(s);
    if (iv) out.push(iv);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Bevorzugte Startzeit behalten, sonst in die nächste Lücke vor/nach Hard-Ankern.
 */
export function findFreeSlotStartMs(opts: {
  preferredStartMs: number | null;
  durationMs: number;
  hardIntervals: Array<{ start: number; end: number }>;
  dayStartMs: number;
  dayEndMs: number;
  nowFloorMs?: number | null;
}): number | null {
  const dur = Math.max(15 * 60_000, opts.durationMs);
  const floor = opts.nowFloorMs ?? opts.dayStartMs;
  let preferred = opts.preferredStartMs;
  if (preferred != null && preferred < floor) preferred = floor;

  const overlapsHard = (start: number): boolean => {
    const end = start + dur;
    return opts.hardIntervals.some((h) =>
      intervalsOverlapMs(start, end, h.start, h.end),
    );
  };

  if (preferred != null && !overlapsHard(preferred)) {
    return preferred;
  }

  // Nach jedem Hard-Ende + 10 Min Puffer versuchen
  const candidates: number[] = [];
  if (preferred != null) candidates.push(preferred);
  candidates.push(Math.max(floor, opts.dayStartMs + 11 * 60 * 60_000)); // ~11:00
  candidates.push(Math.max(floor, opts.dayStartMs + 12 * 60 * 60_000));
  candidates.push(Math.max(floor, opts.dayStartMs + 12.5 * 60 * 60_000));
  candidates.push(Math.max(floor, opts.dayStartMs + 17 * 60 * 60_000));
  for (const h of opts.hardIntervals) {
    candidates.push(h.end + 10 * 60_000);
    candidates.push(h.start - dur - 10 * 60_000);
  }

  const unique = [...new Set(candidates)]
    .filter((t) => t >= floor && t + dur <= opts.dayEndMs)
    .sort((a, b) => a - b);

  for (const t of unique) {
    if (!overlapsHard(t)) return t;
  }

  // Fallback: direkt hinter dem letzten Hard-Anker — nie überlappend zurückgeben
  const last = opts.hardIntervals[opts.hardIntervals.length - 1];
  if (last) {
    const t = Math.max(floor, last.end + 10 * 60_000);
    if (t + dur <= opts.dayEndMs && !overlapsHard(t)) return t;
  }
  return null;
}

export function msToHmLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dayBoundsMs(dayKey: string): { start: number; end: number } {
  const [y, mo, d] = dayKey.split('-').map(Number);
  const start = new Date(y!, mo! - 1, d!, 7, 0, 0, 0).getTime();
  const end = new Date(y!, mo! - 1, d!, 22, 30, 0, 0).getTime();
  return { start, end };
}
