/**
 * Timeline-Snapshot für Prompts (Call 1, Wetter, Modul 5) — SSOT aus futurePlanState.
 */

import { useFuturePlanStore, type FuturePlanStop } from './futurePlanState';
import { todayDateKey } from '../../utils/dateKeys';

function formatStopClock(stop: FuturePlanStop): string {
  if (stop.plannedStartMs == null) return 'ohne Zeit';
  return new Date(stop.plannedStartMs).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function upcomingStops(dayKey: string, nowMs = Date.now()): FuturePlanStop[] {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  return plan.stops
    .filter((s) => {
      if (s.status === 'done') return false;
      if (s.kind === 'nav_leg' || s.kind === 'wish') return false;
      if (s.id.startsWith('choice_')) return false;
      const start = s.plannedStartMs;
      if (start == null) return true;
      const end = s.plannedEndMs ?? start + 60 * 60_000;
      return end >= nowMs - 15 * 60_000;
    })
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
}

/** Kompakte Zeile für Regelwerk (max. 5 Stops). */
export function formatCompactTimelineLine(dayKey = todayDateKey(), nowMs = Date.now()): string {
  const stops = upcomingStops(dayKey, nowMs).slice(0, 5);
  if (!stops.length) return '';
  const bits = stops.map((s) => {
    const clock = formatStopClock(s);
    return clock === 'ohne Zeit' ? s.title : `${clock} ${s.title}`;
  });
  return `Heute in Timeline: ${bits.join(' → ')}`;
}

/** Voller Block für Call 1 / Wetter / Plan-Ingest. */
export function formatTimelineSnapshotForPrompt(
  dayKey = todayDateKey(),
  nowMs = Date.now(),
): string {
  const stops = upcomingStops(dayKey, nowMs).slice(0, 40);
  if (!stops.length) {
    return `(Timeline ${dayKey}: noch leer)`;
  }
  const lines = stops.map((s) => {
    const t = formatStopClock(s);
    return `- ${t} | ${s.kind ?? 'stop'} | prio=${s.planPriority ?? '?'} | ${s.title}`;
  });
  return `BESTEHENDE TIMELINE ${dayKey} (SSOT — Wetter/Plan bezieht sich darauf):\n${lines.join('\n')}`;
}

export function timelineHasUpcomingStops(dayKey = todayDateKey(), nowMs = Date.now()): boolean {
  return upcomingStops(dayKey, nowMs).length > 0;
}
