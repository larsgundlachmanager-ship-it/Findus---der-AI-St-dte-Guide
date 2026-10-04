/**
 * Regen-Push Lead-Zeiten (ohne RN) — nur 30 Min und 5 Min vor Start.
 */

export const RAIN_PUSH_LEAD_MS = {
  thirty: 30 * 60_000,
  five: 5 * 60_000,
} as const;

/** OS braucht etwas Zukunft; kein Catch-up-Sofortpush. */
export const RAIN_PUSH_MIN_FUTURE_MS = 2_000;

/**
 * Fire-Zeiten nur bei noch kommenden Lead-Fenstern — kein Nachholen.
 */
export function rainPushFireTimes(
  rainAtMs: number,
  nowMs: number,
): { t30: number | null; t5: number | null } {
  const t30 = rainAtMs - RAIN_PUSH_LEAD_MS.thirty;
  const t5 = rainAtMs - RAIN_PUSH_LEAD_MS.five;
  return {
    t30: t30 > nowMs + RAIN_PUSH_MIN_FUTURE_MS ? t30 : null,
    t5: t5 > nowMs + RAIN_PUSH_MIN_FUTURE_MS ? t5 : null,
  };
}
