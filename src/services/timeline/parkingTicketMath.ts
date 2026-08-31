/**
 * Parkticket-Rechnung — rein, ohne RN/Store (HUD + Care + Tests).
 */

export function parkingTicketAtArrival(opts: {
  nowMs: number;
  parkedAtMs: number;
  maxDurationMin: number | null;
  travelMin: number;
}): {
  elapsedMin: number;
  remNowMin: number | null;
  remAtArrivalMin: number | null;
} {
  const elapsedMin = Math.max(
    0,
    Math.round((opts.nowMs - opts.parkedAtMs) / 60_000),
  );
  if (opts.maxDurationMin == null || opts.maxDurationMin <= 0) {
    return { elapsedMin, remNowMin: null, remAtArrivalMin: null };
  }
  const remNowMin = opts.maxDurationMin - elapsedMin;
  const remAtArrivalMin =
    opts.maxDurationMin -
    (elapsedMin + Math.max(0, Math.round(opts.travelMin)));
  return { elapsedMin, remNowMin, remAtArrivalMin };
}
