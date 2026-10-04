/**
 * Quiet soft-overlap resolve — pure (kein RN / kein Speech).
 * Soft-Wünsche mit Zeit zählen als Anker; Banner-Overlap = planStopsOverlap.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';
import {
  isHardFixedStop,
  isSoftMovableStop,
  prioOfStop,
} from './planHardLock';
import { findPlanOverlapPair, planStopsOverlap } from './planTimeOverlap';

function prioOf(s: FuturePlanStop): number {
  return prioOfStop(s);
}

function softerOf(a: FuturePlanStop, b: FuturePlanStop): FuturePlanStop {
  const aHard = isHardFixedStop(a);
  const bHard = isHardFixedStop(b);
  if (aHard !== bHard) return aHard ? b : a;
  return prioOf(a) >= prioOf(b) ? a : b;
}

function harderOf(a: FuturePlanStop, b: FuturePlanStop): FuturePlanStop {
  const aHard = isHardFixedStop(a);
  const bHard = isHardFixedStop(b);
  if (aHard !== bHard) return aHard ? a : b;
  return prioOf(a) < prioOf(b) ? a : b;
}

function isQuietResolveCandidate(s: FuturePlanStop): boolean {
  if (s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_')) return false;
  // Live-ÖPNV-Tour hat feste Abfahrten — nicht hinter spätere Züge schieben.
  if (s.groupId === 'live_journey') return false;
  if (s.plannedStartMs == null || !Number.isFinite(s.plannedStartMs)) {
    return false;
  }
  return true;
}

function quietIntervalEndMs(s: FuturePlanStop): number {
  const a0 = s.plannedStartMs!;
  if (s.plannedEndMs != null && s.plannedEndMs > a0) return s.plannedEndMs;
  return a0 + 45 * 60_000;
}

export function findQuietOverlapPair(
  stops: FuturePlanStop[],
): [FuturePlanStop, FuturePlanStop] | null {
  const timed = stops.filter(isQuietResolveCandidate);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (a.groupId && a.groupId === b.groupId) continue;
      const a0 = a.plannedStartMs!;
      const b0 = b.plannedStartMs!;
      const a1 = quietIntervalEndMs(a);
      const b1 = quietIntervalEndMs(b);
      if (a0 < b1 && b0 < a1) return [a, b];
    }
  }
  return null;
}

/** Soft hinter härteren Anker schieben — pure, ohne Store. */
export function shiftStopPastHarderPure(
  soft: FuturePlanStop,
  hard: FuturePlanStop,
  reason = 'Verschoben',
): FuturePlanStop | null {
  if (soft.groupId === 'live_journey' || hard.groupId === 'live_journey') {
    return null;
  }
  if (isHardFixedStop(soft) || !isSoftMovableStop(soft)) return null;
  const hardEnd =
    hard.plannedEndMs ??
    (hard.plannedStartMs != null
      ? hard.plannedStartMs + 45 * 60_000
      : null);
  if (hardEnd == null) return null;
  const duration =
    soft.plannedEndMs != null && soft.plannedStartMs != null
      ? Math.max(20 * 60_000, soft.plannedEndMs - soft.plannedStartMs)
      : 45 * 60_000;
  const nextStart = hardEnd + 10 * 60_000;
  return {
    ...soft,
    plannedStartMs: nextStart,
    plannedEndMs: nextStart + duration,
    status: 'pending_change',
    notes: [soft.notes, reason].filter(Boolean).join('\n'),
  };
}

export type QuietResolveResult = {
  stops: FuturePlanStop[];
  /** true = Banner-Fall (Stop-Stop-Overlap bleibt). */
  stillOverlapping: boolean;
  shiftedIds: string[];
  stuck: boolean;
};

/**
 * Soft-Overlaps still schieben (kein Ask, kein Drop).
 * stillOverlapping = planStopsOverlap nach max. Shifts.
 */
export function resolveOverlapsQuietlyOnStops(
  input: FuturePlanStop[],
  opts?: { maxShifts?: number },
): QuietResolveResult {
  const max = Math.max(1, opts?.maxShifts ?? 12);
  let stops = [...input];
  const shiftedIds: string[] = [];
  let guard = 0;
  let stuck = false;

  while (guard < max) {
    guard += 1;
    const pair =
      findQuietOverlapPair(stops) ?? findPlanOverlapPair(stops);
    if (!pair) break;

    const soft = softerOf(pair[0], pair[1]);
    const hard = harderOf(pair[0], pair[1]);

    if (isHardFixedStop(soft) || !isSoftMovableStop(soft)) {
      stuck = true;
      break;
    }
    if (
      soft.groupId === 'live_journey' ||
      hard.groupId === 'live_journey'
    ) {
      stuck = true;
      break;
    }

    const next = shiftStopPastHarderPure(soft, hard, 'Verschoben (auto)');
    if (!next) {
      stuck = true;
      break;
    }

    stops = stops.map((s) => (s.id === soft.id ? next : s));
    shiftedIds.push(soft.id);
  }

  const quietLeft = Boolean(findQuietOverlapPair(stops));
  if (quietLeft && !stuck) {
    // Max-Shifts erschöpft mit Rest-Quiet-Overlap
    stuck = true;
  }

  return {
    stops,
    stillOverlapping: planStopsOverlap(stops),
    shiftedIds,
    stuck,
  };
}
