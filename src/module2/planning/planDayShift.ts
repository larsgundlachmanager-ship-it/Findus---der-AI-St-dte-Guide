/**
 * Pure helpers: ganzen Plan-Tag auf einen anderen dayKey verschieben.
 * Kein Store — smokes + planLiveEdits.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';

function parseDayParts(dayKey: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** Uhrzeit beibehalten, Kalendertag auf toDay legen. */
export function remapClockMsToDay(
  ms: number | null | undefined,
  toDay: string,
): number | null {
  if (ms == null || !Number.isFinite(ms)) return ms ?? null;
  const parts = parseDayParts(toDay);
  if (!parts) return ms;
  const src = new Date(ms);
  return new Date(
    parts.y,
    parts.m - 1,
    parts.d,
    src.getHours(),
    src.getMinutes(),
    src.getSeconds(),
    src.getMilliseconds(),
  ).getTime();
}

export type ShiftPlanDayStopsResult = {
  /** Stops für den Zieltag (ohne nav_leg — Legs neu gap-fillen). */
  moved: FuturePlanStop[];
  /** IDs der verworfenen Travel-Legs / Reminder auf dem Quelltag. */
  droppedNavIds: string[];
};

/**
 * Alle inhaltlichen Stops von fromDay → toDay (Uhrzeiten relativ/absolut erhalten).
 * nav_leg / leave_ / nav_remind_ werden nicht mitkopiert (alte Legs clearen).
 */
export function shiftPlanDayStops(input: {
  fromDay: string;
  toDay: string;
  stops: FuturePlanStop[];
}): ShiftPlanDayStopsResult {
  const from = (input.fromDay || '').trim();
  const to = (input.toDay || '').trim();
  const stops = input.stops ?? [];
  if (!from || !to || from === to) {
    return {
      moved: stops.filter(
        (s) =>
          s.kind !== 'nav_leg' &&
          !s.id.startsWith('nav_remind_') &&
          !s.id.startsWith('leave_'),
      ),
      droppedNavIds: [],
    };
  }

  const droppedNavIds: string[] = [];
  const moved: FuturePlanStop[] = [];

  for (const s of stops) {
    const isTravelArtifact =
      s.kind === 'nav_leg' ||
      s.id.startsWith('nav_remind_') ||
      s.id.startsWith('leave_') ||
      s.id.startsWith('choice_');
    if (isTravelArtifact) {
      droppedNavIds.push(s.id);
      continue;
    }
    const start = remapClockMsToDay(s.plannedStartMs, to);
    const end = remapClockMsToDay(s.plannedEndMs, to);
    moved.push({
      ...s,
      plannedStartMs: start,
      plannedEndMs: end,
      status: 'pending_change',
      journeyDetail: null,
      routeEstimate: null,
    });
  }

  return { moved, droppedNavIds };
}
