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
 * Start der Tour: freie Lücke zwischen Hard-Terminen — nie über Meetings legen.
 * Morgen-Wunsch → eher Vormittag; sonst preferMs / Mittag-Fallback.
 */
function resolveTourStartMs(
  dayKey: string,
  preferMs: number | null | undefined,
  req: TourRequest,
  tourDurationMin: number,
): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const morningHint = /\b(morgen(?:s)?|vormittag|früh|frueh|guten\s+morgen)\b/i.test(
    `${req.title} ${req.context} ${req.areaHint ?? ''}`,
  );
  const defaultPrefer = morningHint
    ? new Date(y!, m! - 1, d!, 9, 30, 0, 0).getTime()
    : preferMs != null && Number.isFinite(preferMs)
      ? preferMs
      : new Date(y!, m! - 1, d!, 11, 0, 0, 0).getTime();

  try {
    const {
      dayBoundsMs,
      findFreeSlotStartMs,
      hardIntervalsFromStops,
    } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
    const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
    const bounds = dayBoundsMs(dayKey);
    const free = findFreeSlotStartMs({
      preferredStartMs: defaultPrefer,
      durationMs: Math.max(30, tourDurationMin) * 60_000,
      hardIntervals: hardIntervalsFromStops(plan.stops),
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

  // Nächster Hard-Termin → Tour darf nicht drüberlaufen
  try {
    const {
      hardIntervalsFromStops,
      isHardFixedStop,
    } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
    const plan = useFuturePlanStore.getState().getPlanForDay(dk);
    const hard = hardIntervalsFromStops(plan.stops).sort(
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
    void isHardFixedStop;
  } catch {
    /* soft */
  }

  let inserted = 0;
  const transport = req.mobility === 'bike' ? 'bike' : 'walk';
  let sumDwell = 0;

  for (let i = 0; i < result.stops.length; i++) {
    const s = result.stops[i]!;
    const dwellMin = Math.max(1, s.dwellMin ?? 15);
    const legMin =
      i < result.legs.length && result.legs[i]?.durationSec != null
        ? Math.max(2, Math.round(result.legs[i]!.durationSec / 60))
        : 8;
    sumDwell += dwellMin + (i > 0 ? legMin : 0);

    // Hard-Konflikt: Stop überspringen statt drüberbuchen
    try {
      const { hardIntervalsFromStops } =
        require('../planning/planHardLock') as typeof import('../planning/planHardLock');
      const plan = useFuturePlanStore.getState().getPlanForDay(dk);
      const end = t + dwellMin * 60_000;
      const clash = hardIntervalsFromStops(plan.stops).some(
        (h) => t < h.end && end > h.start,
      );
      if (clash) {
        const nextHard = hardIntervalsFromStops(plan.stops)
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
      notes: `Tour · ~${result.totalMin || sumDwell} Min`,
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
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  return inserted;
}
