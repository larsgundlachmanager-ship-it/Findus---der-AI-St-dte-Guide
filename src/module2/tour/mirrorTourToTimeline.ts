/**
 * Tour-Ergebnis → Tages-Timeline (Stops + Gap-Fill-Route + Kalender auf).
 */

import { todayDateKey } from '../../utils/dateKeys';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
} from '../timeline/planCalendarUiStore';
import { TOUR_BUFFER_MIN } from './exactValidate';
import {
  buildTourStopNotes,
  resolveTourStartMs,
} from './tourTimelinePlacement';
import type { TourRequest, TourResult } from './types';

export { buildTourStopNotes, resolveTourStartMs } from './tourTimelinePlacement';

function resolveTourDayKey(explicit?: string | null): string {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  try {
    const { usePlanSessionStore } = require('../planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => { plan: { targetDate?: string } | null };
      };
    };
    const d = usePlanSessionStore.getState().plan?.targetDate;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch {
    /* soft */
  }
  try {
    const dk = useFuturePlanStore.getState().plan.dayKey;
    if (dk && /^\d{4}-\d{2}-\d{2}$/.test(dk)) return dk;
  } catch {
    /* soft */
  }
  return todayDateKey();
}

/**
 * Nach erfolgreicher Tourplanung: Orte mit Zeiten eintragen, Laufwege,
 * Timeline öffnen — Überblick prüfen bevor/ohne Live-Nav.
 */
export function mirrorTourToTimeline(
  result: TourResult,
  req: TourRequest,
  dayKey = resolveTourDayKey(),
  startMs?: number | null,
): number {
  if (
    result.softFail ||
    result.needsDurationAsk ||
    !result.stops.length
  ) {
    return 0;
  }

  const dk = resolveTourDayKey(dayKey);
  useFuturePlanStore.getState().ensureDay(dk);

  // Alte Tour-Stops derselben Anfrage ersetzen (Re-Plan)
  try {
    const plan = useFuturePlanStore.getState().getPlanForDay(dk);
    for (const s of [...plan.stops]) {
      if (s.id.startsWith(`tour_${result.requestId}_`)) {
        useFuturePlanStore.getState().ensureDay(dk);
        useFuturePlanStore.getState().removeStop(s.id);
      }
    }
  } catch {
    /* soft */
  }

  const tourMin =
    result.totalMin ||
    result.stops.reduce((acc, s) => acc + Math.max(1, s.dwellMin ?? 15), 0) +
      20;
  let t = resolveTourStartMs(dk, startMs ?? req.preferStartMs, req, tourMin);

  // Nächster Hard-/Soft-Block → Tour darf nicht drüberlaufen
  try {
    const {
      blockIntervalsFromStops,
    } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
    const plan = useFuturePlanStore.getState().getPlanForDay(dk);
    const hard = blockIntervalsFromStops(plan.stops).sort(
      (a, b) => a.start - b.start,
    );
    const next = hard.find((h) => h.start > t);
    if (next) {
      const maxEnd = next.start - 10 * 60_000;
      const need = tourMin * 60_000;
      if (t + need > maxEnd) {
        // Zu eng: nur starten wenn mind. 25 Min Platz, sonst abbrechen
        if (maxEnd - t < 25 * 60_000) {
          return 0;
        }
      }
    }
  } catch {
    /* soft */
  }

  let inserted = 0;
  const transport = req.mobility === 'bike' ? 'bike' : 'walk';

  for (let i = 0; i < result.stops.length; i++) {
    const s = result.stops[i]!;
    const dwellMin = Math.max(1, s.dwellMin ?? 15);
    const legMin =
      i < result.legs.length && result.legs[i]?.durationSec != null
        ? Math.max(2, Math.round(result.legs[i]!.durationSec / 60))
        : 8;

    // Hard-/Soft-Konflikt: Stop überspringen statt drüberbuchen
    try {
      const { blockIntervalsFromStops } =
        require('../planning/planHardLock') as typeof import('../planning/planHardLock');
      const plan = useFuturePlanStore.getState().getPlanForDay(dk);
      const end = t + dwellMin * 60_000;
      const clash = blockIntervalsFromStops(plan.stops).some(
        (h) => t < h.end && end > h.start,
      );
      if (clash) {
        const nextHard = blockIntervalsFromStops(plan.stops)
          .filter((h) => h.end > t)
          .sort((a, b) => a.end - b.end)[0];
        if (nextHard) {
          t = nextHard.end + 10 * 60_000;
        } else {
          break;
        }
      }
    } catch {
      /* soft */
    }

    useFuturePlanStore.getState().upsertStopOnDay(dk, {
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
      notes: buildTourStopNotes(dwellMin),
      planTaskId: result.requestId,
    });
    t += (dwellMin + legMin) * 60_000;
    inserted += 1;
  }

  try {
    const { applyGapFillTravelLegs } = require('../timeline/gapFillTravel') as {
      applyGapFillTravelLegs: (opts?: {
        skipQuietResolve?: boolean;
      }) => unknown;
    };
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  // Soft-Overlaps vor Kalender-Open still schieben
  try {
    const { resolveOverlapsQuietly, speakUnresolvedPlanConflict } =
      require('../planning/planConflictResolve') as {
        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;
        speakUnresolvedPlanConflict: () => void;
      };
    const still = resolveOverlapsQuietly({ speakIfStuck: false });
    if (still) speakUnresolvedPlanConflict();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
    usePlanCalendarUiStore.getState().requestDayKey(dk);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    // Planung: keine Tour-Start-Route-Buttons
    const suppressNav = req.uiLayout === 'timeline_stack';
    if (result.actions?.length && !suppressNav) {
      usePlanCalendarUiStore
        .getState()
        .setMirroredActions(result.actions.slice(0, 4));
    } else {
      usePlanCalendarUiStore.getState().setMirroredActions([]);
    }
    // Hard/short Nav: still spiegeln, Timeline NICHT aufklappen.
    if (req.uiLayout === 'timeline_stack') {
      requestOpenPlanCalendar();
    }
  } catch {
    /* soft */
  }

  return inserted;
}
