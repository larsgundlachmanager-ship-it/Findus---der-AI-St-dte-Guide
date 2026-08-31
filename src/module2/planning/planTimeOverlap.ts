/**
 * Zeit-Überlappung in der Timeline. Kein RN.
 * Gleicher groupId (ÖPNV-Akkordeon, Flug) zählt nicht als Konflikt.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';

function intervalsOverlap(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const a0 = a.plannedStartMs;
  const b0 = b.plannedStartMs;
  if (a0 == null || b0 == null) return false;
  const a1 = a.plannedEndMs ?? a0 + 45 * 60_000;
  const b1 = b.plannedEndMs ?? b0 + 45 * 60_000;
  return a0 < b1 && b0 < a1;
}

function isCalendarConflictCandidate(s: FuturePlanStop): boolean {
  if (s.kind === 'wish' || s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_')) return false;
  if (s.plannedStartMs == null) return false;
  return true;
}

function samePlanGroup(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const g = a.groupId?.trim();
  return Boolean(g) && g === b.groupId;
}

export function planStopsOverlap(stops: FuturePlanStop[]): boolean {
  const timed = stops.filter(isCalendarConflictCandidate);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (samePlanGroup(a, b)) continue;
      if (intervalsOverlap(a, b)) return true;
    }
  }
  return false;
}

export function findPlanOverlapPair(
  stops: FuturePlanStop[],
): [FuturePlanStop, FuturePlanStop] | null {
  const timed = stops.filter(isCalendarConflictCandidate);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (samePlanGroup(a, b)) continue;
      if (intervalsOverlap(a, b)) return [a, b];
    }
  }
  return null;
}
