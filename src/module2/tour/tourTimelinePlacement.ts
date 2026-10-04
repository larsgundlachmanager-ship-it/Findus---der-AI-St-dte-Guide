/**
 * Tour → Timeline Platzierung (Start nach Soft-Wünschen, Stop-Notes).
 * Ohne Gap-Fill / Kalender-UI — Node-smoke-fähig.
 */

import { todayDateKey } from '../../utils/dateKeys';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import type { TourRequest } from './types';

/** Pro-Stop Notes: nur Dwell — nie Tour-Gesamtminuten auf jeden Halt stempeln. */
export function buildTourStopNotes(dwellMin: number): string {
  const m = Math.max(1, Math.round(dwellMin));
  return `Tour · ~${m} Min`;
}

/**
 * Start der Tour: freie Lücke zwischen Hard- + soft-timed Wünschen
 * (Frühstück/Ankunft) — nie vor Frühstück um 10 wenn leave 9 bekannt.
 */
export function resolveTourStartMs(
  dayKey: string,
  preferMs: number | null | undefined,
  req: TourRequest,
  tourDurationMin: number,
): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const morningHint = /\b(morgen(?:s)?|vormittag|früh|frueh|guten\s+morgen)\b/i.test(
    `${req.title} ${req.context} ${req.areaHint ?? ''}`,
  );
  let defaultPrefer = morningHint
    ? new Date(y!, m! - 1, d!, 9, 30, 0, 0).getTime()
    : preferMs != null && Number.isFinite(preferMs)
      ? preferMs
      : new Date(y!, m! - 1, d!, 11, 0, 0, 0).getTime();

  try {
    const {
      dayBoundsMs,
      findFreeSlotStartMs,
      hardIntervalsFromStops,
      softTimedIntervalsFromStops,
    } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
    const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
    const soft = softTimedIntervalsFromStops(plan.stops);
    // Soft-Morgen (Frühstück/Ankunft) → Tour erst danach, auch wenn prefer 09:30
    const morningSoft = soft
      .filter((iv) => {
        const h = new Date(iv.start).getHours();
        return h >= 7 && h < 14;
      })
      .sort((a, b) => a.end - b.end);
    const afterSoft =
      morningSoft.length > 0
        ? morningSoft[morningSoft.length - 1]!.end + 10 * 60_000
        : null;
    if (afterSoft != null) {
      const preferOrDefault =
        preferMs != null && Number.isFinite(preferMs) ? preferMs : defaultPrefer;
      defaultPrefer = Math.max(preferOrDefault, afterSoft);
    } else if (preferMs != null && Number.isFinite(preferMs)) {
      defaultPrefer = preferMs;
    }

    const bounds = dayBoundsMs(dayKey);
    const free = findFreeSlotStartMs({
      preferredStartMs: defaultPrefer,
      durationMs: Math.max(30, tourDurationMin) * 60_000,
      hardIntervals: hardIntervalsFromStops(plan.stops),
      extraIntervals: soft,
      dayStartMs: bounds.start,
      dayEndMs: bounds.end,
      nowFloorMs:
        dayKey === todayDateKey()
          ? Date.now() + 20 * 60_000
          : bounds.start,
    });
    if (free != null) return free;
  } catch {
    /* soft */
  }

  if (preferMs != null && Number.isFinite(preferMs)) return preferMs;
  try {
    const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
    const stops = [...plan.stops]
      .filter(
        (s) =>
          s.kind !== 'nav_leg' &&
          s.plannedEndMs != null &&
          Number.isFinite(s.plannedEndMs),
      )
      .sort((a, b) => (a.plannedEndMs ?? 0) - (b.plannedEndMs ?? 0));
    const last = stops[stops.length - 1];
    if (last?.plannedEndMs != null) {
      return last.plannedEndMs + 10 * 60_000;
    }
  } catch {
    /* soft */
  }
  return defaultPrefer;
}
