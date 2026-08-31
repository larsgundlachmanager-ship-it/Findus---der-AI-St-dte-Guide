/**
 * Timeline NOW guard — Vergangenheits-Schutz für Kalender/Timeline-UI.
 * Alles vor nowMs = Reality. Nie manuell mutieren oberhalb der NOW-Linie.
 */

import {
  useFuturePlanStore,
  type FuturePlanStop,
} from './futurePlanState';

/** Puffer: 30 s Toleranz gegen Clock-Skew. */
const PAST_SLACK_MS = 30_000;

export function isPastMs(
  ms: number | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (ms == null || !Number.isFinite(ms)) return false;
  return ms < nowMs - PAST_SLACK_MS;
}

/**
 * Unantastbar für Auto-Plan/Verschieben:
 * Visit/Hist-IDs, done, oder geplante Start/Ende bereits vor NOW.
 */
export function isRealityLockedStop(
  stop:
    | Pick<
        FuturePlanStop,
        'id' | 'kind' | 'status' | 'plannedStartMs' | 'plannedEndMs'
      >
    | null
    | undefined,
  nowMs = Date.now(),
): boolean {
  if (!stop) return false;
  if (stop.id.startsWith('visit_') || stop.id.startsWith('hist_')) return true;
  if (
    stop.id === 'nav_live_active' ||
    stop.id === 'nav_live_dest' ||
    stop.id.startsWith('nav_live_tour_')
  ) {
    return false;
  }
  if (stop.status === 'done') return true;
  if (stop.kind === 'wish' || stop.kind === 'nav_leg') return false;
  const t = stop.plannedEndMs ?? stop.plannedStartMs;
  return isPastMs(t, nowMs);
}

/** Zukunfts-Zeiten nie in die Vergangenheit ziehen — clamp auf now+minAhead. */
export function clampToFutureMs(
  ms: number | null | undefined,
  opts?: { nowMs?: number; minAheadMs?: number },
): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const now = opts?.nowMs ?? Date.now();
  const minAhead = opts?.minAheadMs ?? 60_000;
  const floor = now + minAhead;
  return ms < floor ? floor : ms;
}

/**
 * Guard vor Plan-Upsert: Reality-Stops (vor NOW) nicht überschreiben;
 * neue Zeiten immer ≥ NOW.
 */
export function assertFuturePlanWritable(
  stop: Pick<
    FuturePlanStop,
    'id' | 'plannedStartMs' | 'plannedEndMs' | 'kind' | 'status'
  >,
  nowMs = Date.now(),
): { ok: boolean; reason?: string } {
  if (stop.id.startsWith('visit_') || stop.kind === 'wish') {
    return { ok: true };
  }
  if (
    stop.id === 'nav_live_active' ||
    stop.id === 'nav_live_dest' ||
    stop.id.startsWith('nav_live_tour_')
  ) {
    return { ok: true };
  }
  const existing = useFuturePlanStore
    .getState()
    .plan.stops.find((s) => s.id === stop.id);
  if (existing && isRealityLockedStop(existing, nowMs)) {
    return { ok: false, reason: 'reality_locked' };
  }
  if (stop.plannedStartMs != null && isPastMs(stop.plannedStartMs, nowMs)) {
    return { ok: false, reason: 'would_write_past' };
  }
  return { ok: true };
}

/** Safe upsert: clamped times, skip if would write into past. */
export function upsertFutureStopSafe(
  stop: FuturePlanStop,
  nowMs = Date.now(),
): boolean {
  const start = clampToFutureMs(stop.plannedStartMs, { nowMs });
  const end =
    stop.plannedEndMs != null && start != null
      ? Math.max(stop.plannedEndMs, start + 5 * 60_000)
      : clampToFutureMs(stop.plannedEndMs, { nowMs });
  const next: FuturePlanStop = {
    ...stop,
    plannedStartMs: start,
    plannedEndMs: end,
  };
  const gate = assertFuturePlanWritable(next, nowMs);
  if (!gate.ok) {
    console.warn('[timeline-now] skip upsert', stop.id, gate.reason);
    return false;
  }
  useFuturePlanStore.getState().upsertStop(next);
  return true;
}
