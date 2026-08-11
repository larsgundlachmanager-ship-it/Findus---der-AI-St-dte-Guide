/**
 * Tour-Ergebnis → Tages-Timeline (Stops + Gap-Fill-Route + Kalender auf).
 */

import { todayDateKey } from '../../utils/dateKeys';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
} from '../timeline/planCalendarUiStore';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { TOUR_BUFFER_MIN } from './exactValidate';
import type { TourRequest, TourResult } from './types';

/**
 * Nach erfolgreicher Tourplanung: Orte mit Zeiten eintragen, Laufwege,
 * Timeline öffnen — Überblick prüfen bevor/ohne Live-Nav.
 */
export function mirrorTourToTimeline(
  result: TourResult,
  req: TourRequest,
  dayKey = todayDateKey(),
): number {
  if (
    result.softFail ||
    result.needsDurationAsk ||
    !result.stops.length
  ) {
    return 0;
  }

  useFuturePlanStore.getState().ensureDay(dayKey);

  // Alte Tour-Stops derselben Anfrage ersetzen (Re-Plan)
  try {
    const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
    for (const s of [...plan.stops]) {
      if (s.id.startsWith(`tour_${result.requestId}_`)) {
        useFuturePlanStore.getState().ensureDay(dayKey);
        useFuturePlanStore.getState().removeStop(s.id);
      }
    }
  } catch {
    /* soft */
  }

  let t = Date.now() + 5 * 60_000;
  let inserted = 0;
  const transport = req.mobility === 'bike' ? 'bike' : 'walk';

  for (let i = 0; i < result.stops.length; i++) {
    const s = result.stops[i]!;
    const dwellMin = Math.max(1, s.dwellMin ?? 15);
    const legMin =
      i < result.legs.length && result.legs[i]?.durationSec != null
        ? Math.max(2, Math.round(result.legs[i]!.durationSec / 60))
        : 8;

    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id: `tour_${result.requestId}_${s.poiId}`,
      title: s.name.slice(0, 48),
      lat: s.lat,
      lng: s.lng,
      plannedStartMs: t,
      plannedEndMs: t + dwellMin * 60_000,
      kind: 'stop',
      bufferMin: TOUR_BUFFER_MIN,
      transport,
      status: 'planned',
      planPriority: 6,
      emoji: '🗺️',
      notes: `Tour · ~${result.totalMin} Min`,
      planTaskId: result.requestId,
    });
    t += (dwellMin + legMin) * 60_000;
    inserted += 1;
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    if (result.actions?.length) {
      usePlanCalendarUiStore
        .getState()
        .setMirroredActions(result.actions.slice(0, 4));
    }
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  return inserted;
}
