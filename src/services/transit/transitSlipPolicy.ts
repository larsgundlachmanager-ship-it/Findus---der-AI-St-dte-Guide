/**
 * Fahrplan ≠ Gummi: eine spätere Abfahrt derselben Linie ist die nächste
 * Fahrt, keine 5-Minuten-Verschiebung der verpassten.
 */

export type TransitSlipKind = 'unchanged' | 'live_delay' | 'missed_next';

const SAME_TRIP_MS = 90_000;
const MISSED_GRACE_MS = 20_000;
const DELAY_MIN_SEC = 180;

export function classifyTransitSlip(opts: {
  nowMs: number;
  armedDepMs: number;
  nextDepMs: number;
  scheduledStartMs?: number | null;
  delaySec?: number | null;
}): TransitSlipKind {
  const now = opts.nowMs;
  const armed = opts.armedDepMs;
  const next = opts.nextDepMs;
  if (!Number.isFinite(armed) || !Number.isFinite(next)) return 'unchanged';
  if (Math.abs(next - armed) < SAME_TRIP_MS) return 'unchanged';

  const delaySec =
    opts.delaySec != null && Number.isFinite(opts.delaySec)
      ? opts.delaySec
      : null;
  const scheduled =
    opts.scheduledStartMs != null && Number.isFinite(opts.scheduledStartMs)
      ? opts.scheduledStartMs
      : delaySec != null
        ? next - delaySec * 1000
        : null;
  const sameTrip =
    scheduled != null && Math.abs(scheduled - armed) < SAME_TRIP_MS;
  if (sameTrip && delaySec != null && delaySec >= DELAY_MIN_SEC) {
    return 'live_delay';
  }

  // Erst nach echter Abfahrt umbuchen — nicht wenn der Planer schon die
  // Folgefahrt liefert, die geplante aber noch nicht weg ist.
  if (now <= armed + MISSED_GRACE_MS) return 'unchanged';
  if (next > armed + SAME_TRIP_MS) return 'missed_next';
  if (now > armed + MISSED_GRACE_MS) return 'missed_next';
  return 'unchanged';
}
