/**
 * Route-Buttons nur wenn User jetzt / in ≤10 Min los will.
 * Sonst Planung/Pitch: Maps/Speisekarte/Buchen — keine START_NAVIGATION.
 */

export const NAV_ACTION_SOON_MS = 10 * 60_000;
export const ALREADY_HERE_NAV_M = 45;

/** User steht schon am Ziel — keine Route-Buttons. */
export function isAlreadyAtCoords(
  lat?: number | null,
  lng?: number | null,
): boolean {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
      };
    };
    const s = useFinnusStore.getState();
    if (
      typeof s.lastGpsLat !== 'number' ||
      typeof s.lastGpsLng !== 'number'
    ) {
      return false;
    }
    const { haversineMeters } = require('../../db/database') as {
      haversineMeters: (
        aLat: number,
        aLng: number,
        bLat: number,
        bLng: number,
      ) => number;
    };
    return haversineMeters(s.lastGpsLat, s.lastGpsLng, lat, lng) <= ALREADY_HERE_NAV_M;
  } catch {
    return false;
  }
}

/** true = Route-Button unterdrücken */
export function shouldSuppressNavActions(opts?: {
  visitAtMs?: number | null;
  forceSoon?: boolean;
  timelineStack?: boolean;
  planningActive?: boolean;
  destLat?: number | null;
  destLng?: number | null;
}): boolean {
  if (isAlreadyAtCoords(opts?.destLat, opts?.destLng)) return true;
  if (opts?.forceSoon) return false;
  const visit = opts?.visitAtMs;
  if (visit != null && Number.isFinite(visit)) {
    const delta = visit - Date.now();
    // Jetzt bis +10 Min (leichtes Past-Fenster für „los“)
    if (delta <= NAV_ACTION_SOON_MS && delta >= -2 * 60_000) {
      return false;
    }
  }
  if (opts?.timelineStack || opts?.planningActive) return true;
  // Live-Pitch ohne baldigen Besuch: trotzdem keine Nav-Flut
  if (visit != null && visit - Date.now() > NAV_ACTION_SOON_MS) return true;
  return false;
}
