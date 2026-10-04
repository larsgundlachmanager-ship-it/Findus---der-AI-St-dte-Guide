/**
 * Zeit-Überlappung in der Timeline. Kein RN.
 * Gleicher groupId (ÖPNV-Akkordeon, Flug) zählt nicht als Konflikt.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';

function isTransitLike(s: FuturePlanStop): boolean {
  if (s.transport === 'transit') return true;
  if (s.groupId === 'live_journey') return true;
  if (/^live_journey_/i.test(s.id) || /^live_nav_/i.test(s.id)) return true;
  if (/^\d+\s*·/.test(s.title)) return true;
  if (/\b(RB|RE|S|U|Bus|Bahn|zu Fuß|END)\b/i.test(s.title)) return true;
  return false;
}

/** Punkt-Stops (Umstieg/END) ohne Endzeit: nicht 45 Min blocken — sonst Fake-Konflikt mit Dinner. */
function intervalEndMs(s: FuturePlanStop): number {
  const a0 = s.plannedStartMs!;
  if (s.plannedEndMs != null && s.plannedEndMs > a0) return s.plannedEndMs;
  if (isTransitLike(s)) return a0 + 2 * 60_000;
  if (s.kind === 'nav_leg') return a0 + 5 * 60_000;
  return a0 + 45 * 60_000;
}

function intervalsOverlap(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const a0 = a.plannedStartMs;
  const b0 = b.plannedStartMs;
  if (a0 == null || b0 == null) return false;
  const a1 = intervalEndMs(a);
  const b1 = intervalEndMs(b);
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
  if (g && g === b.groupId) return true;
  // ÖPNV-Akkordeon ohne groupId: nur Kette (Überlapp oder ≤20 Min Lücke), nicht jede Bahn am Tag
  if (isTransitLike(a) && isTransitLike(b)) {
    const a0 = a.plannedStartMs!;
    const b0 = b.plannedStartMs!;
    const a1 = intervalEndMs(a);
    const b1 = intervalEndMs(b);
    if (a0 < b1 && b0 < a1) return true;
    const gap = Math.min(Math.abs(a1 - b0), Math.abs(b1 - a0));
    if (gap <= 20 * 60_000) return true;
  }
  return false;
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
