/**
 * Wenn Tempo-Profil sich ändert → Reisezeiten im heutigen Plan neu rechnen.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { todayDateKey } from '../../types/dayPlan';
import {
  bikeMinutesPlan,
  walkMinutesPlan,
  describeCurrentPace,
} from './bufferMath';
import type { PaceMode } from './paceProfile';

export function refreshDayPlanTravelTimes(mode: PaceMode, kmh: number): void {
  const dateKey = todayDateKey();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  let changed = false;

  const items = day.items.map((it) => {
    const meta = (it.meta ?? {}) as {
      mode?: string;
      distanceM?: number | null;
    };
    const itemMode = meta.mode ?? '';
    const dist =
      typeof meta.distanceM === 'number' && Number.isFinite(meta.distanceM)
        ? meta.distanceM
        : null;
    if (dist == null || dist <= 0) return it;
    if (itemMode === 'taxi' || itemMode === 'transit') return it;
    if (mode === 'walk' && itemMode === 'bike') return it;
    if (mode === 'bike' && itemMode === 'walk') return it;
    if (it.startMs == null) return it;

    const isBike = mode === 'bike' || itemMode === 'bike';
    const travel = isBike ? bikeMinutesPlan(dist) : walkMinutesPlan(dist);
    const newEnd = it.startMs + travel * 60_000;
    if (it.durationMin === travel) return it;
    changed = true;
    return {
      ...it,
      endMs: newEnd,
      durationMin: travel,
      notes:
        (it.notes ? `${it.notes} · ` : '') +
        `Tempo ${kmh.toFixed(1)} km/h → ${travel} Min`,
    };
  });

  if (!changed) return;
  store.replaceItems(dateKey, items);
  store.addChange(dateKey, {
    summary: `Tempo angepasst (${mode} ${kmh.toFixed(1)} km/h) — Zeiten aktualisiert`,
    reason: `Mittel der letzten Strecken. ${describeCurrentPace()}.`,
    significant: true,
  });
}
