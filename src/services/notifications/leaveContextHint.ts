/**
 * Kontext-Hinweise für Leave-by (bezahlt / Checkout / Taschen).
 * Nur wenn der User wirklich gerade an einem passenden Ort ist.
 */

import { haversineMeters } from '../../db/database';
import { useGpsStore } from '../../store/useGpsStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getVisitLogSnapshot } from '../timeline/visitLog';

const NEAR_M = 120;

function looksRestaurant(name: string): boolean {
  return /\b(restaurant|gaststätte|gaststaette|café|cafe|bistro|imbiss|kneipe|bar|wirtshaus|pizzeria|trattoria|brauhaus|biergarten|diner|steakhouse|ramen|sushi|curry|döner|doener|mcdonald|burger|kfc|essen)\b/i.test(
    name,
  );
}

function looksHotel(name: string): boolean {
  return /\b(hotel|hostel|pension|gasthof|apartment|airbnb|unterkunft|ferienwohnung)\b/i.test(
    name,
  );
}

function looksBagsPlace(name: string): boolean {
  return /\b(museum|galerie|ausstellung|theater|kino|bibliothek|bad|therme|spa|fitness|gym|laden|shop|markt|mall|einkauf)\b/i.test(
    name,
  );
}

/**
 * Live-Kontext am Aufbruch-Moment.
 * Für geplante OS-Pushes nicht einbacken (wird sonst schnell falsch).
 */
export function resolveLeaveContextHint(opts?: {
  nowMs?: number;
}): string | null {
  const now = opts?.nowMs ?? Date.now();

  const open = getVisitLogSnapshot()
    .filter((e) => e.leftAtMs == null && now - e.arrivedAtMs >= 4 * 60_000)
    .sort((a, b) => b.arrivedAtMs - a.arrivedAtMs)[0];

  if (open?.name) {
    if (looksRestaurant(open.name)) return 'Hast du schon bezahlt?';
    if (looksHotel(open.name)) {
      return 'Hast du ausgecheckt — und alle Taschen dabei?';
    }
    if (looksBagsPlace(open.name)) return 'Hast du alle Taschen dabei?';
  }

  try {
    const hotel = useUserMemoryStore.getState().getConfirmedHotel();
    const gps = useGpsStore.getState();
    if (
      hotel?.name &&
      hotel.lat != null &&
      hotel.lng != null &&
      gps.lat != null &&
      gps.lng != null &&
      Number.isFinite(hotel.lat) &&
      Number.isFinite(hotel.lng) &&
      Number.isFinite(gps.lat) &&
      Number.isFinite(gps.lng)
    ) {
      const d = haversineMeters(gps.lat, gps.lng, hotel.lat, hotel.lng);
      if (d <= NEAR_M) {
        return 'Hast du ausgecheckt — und alle Taschen dabei?';
      }
    }
  } catch {
    /* soft */
  }

  return null;
}
