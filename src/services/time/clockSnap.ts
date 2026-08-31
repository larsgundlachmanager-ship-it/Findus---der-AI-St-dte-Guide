/**
 * Flug/Zug: Abweichung bis 45 Min ok. Bei mehreren Treffern immer die nächste Zeit
 * (gleich oder danach). Nur wenn nichts danach im Fenster: die nächste davor.
 */

export const CLOCK_SNAP_MIN = 45;
export const CLOCK_SNAP_MS = CLOCK_SNAP_MIN * 60_000;

/** Minuten-Diff über Mitternacht, −720…720. */
export function signedClockDiffMin(actualMin: number, targetMin: number): number {
  let d = actualMin - targetMin;
  if (d > 12 * 60) d -= 24 * 60;
  if (d < -12 * 60) d += 24 * 60;
  return d;
}

/** Nächster Zeitpunkt ≥ target im Fenster, sonst der späteste davor. */
export function nextMsWithinWindow<T>(
  items: T[],
  getMs: (item: T) => number | null | undefined,
  targetMs: number,
  windowMs = CLOCK_SNAP_MS,
): T | null {
  const scored: Array<{ item: T; diff: number }> = [];
  for (const item of items) {
    const ms = getMs(item);
    if (ms == null || !Number.isFinite(ms)) continue;
    const diff = ms - targetMs;
    if (Math.abs(diff) > windowMs) continue;
    scored.push({ item, diff });
  }
  if (!scored.length) return null;
  const after = scored
    .filter((s) => s.diff >= 0)
    .sort((a, b) => a.diff - b.diff);
  if (after[0]) return after[0].item;
  scored.sort((a, b) => b.diff - a.diff);
  return scored[0]?.item ?? null;
}
