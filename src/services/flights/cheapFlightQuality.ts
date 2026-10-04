/**
 * Flug-Qualitätsfilter — rein, ohne Gemini/RN.
 * Horror-Dauer und 3+ Stops nicht als Hauptpitch.
 */

/** EU/Nahost: darüber gilt eine Verbindung als zu schlecht für den Pitch. */
export const MAX_GOOD_FLIGHT_DURATION_MIN = 14 * 60;

/** Ob eine Verbindung als „nicht kacke“ gilt (kein 50-Std-/Overnight-Horror). */
export function isSaneFlightOption(opts: {
  durationMin?: number | null;
  stops?: number | null;
}): boolean {
  if (opts.durationMin != null && opts.durationMin > MAX_GOOD_FLIGHT_DURATION_MIN) {
    return false;
  }
  if (opts.stops != null && opts.stops > 2) return false;
  return true;
}
