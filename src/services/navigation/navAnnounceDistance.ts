/**
 * Speed-adaptive Abstand für Nav-Ansagen vor Knotenpunkten.
 * Fuß ~15 m · Rad ~30 m bei 20 km/h · ~60 m bei 35 km/h.
 */

export function navAnnounceLeadDistanceM(speedMs: number | null | undefined): number {
  const s = typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 1.2;
  const kmh = s * 3.6;
  if (kmh < 8) return 15; // Fuß / langsam
  if (kmh < 18) return 25;
  if (kmh < 28) return 30; // entspannt Rad ~20
  if (kmh < 40) return 60; // Rennrad ~35
  return 80;
}

/** Auto Fuß→Rad wenn auf Fußroute plötzlich >10 km/h. */
export const FOOT_TO_BIKE_SPEED_KMH = 10;

export function shouldAutoSwitchFootToBike(speedMs: number | null): boolean {
  if (speedMs == null || !Number.isFinite(speedMs)) return false;
  return speedMs * 3.6 >= FOOT_TO_BIKE_SPEED_KMH;
}

/** Wrong-way: Warnung nach ~10 m vorbei am Abbiegen. */
export const WRONG_WAY_WARN_PAST_M = 10;
/** Ab diesem Extra-Umweg zweite Warnung statt stiller Reroute. */
export const WRONG_WAY_DETOUR_WARN_M = 1500;
