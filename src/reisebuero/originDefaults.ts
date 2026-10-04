import { nearestCommercialAirport } from '../services/flights/airportIata';
import { getCachedUserProfile } from '../services/userProfileService';
import { useGpsStore } from '../store/useGpsStore';
import type { ReiseLedger, ReiseTrip } from './types';
import { entry, isAirportVisible } from './slotLedger';
import { applyTimelineMustHavePrefs } from './timelineMustHavePrefs';
import { applyShelfPrefsToLedger, hydrateShelfAsked } from './shelfAskedPrefs';

export function applyOriginDefaults(
  ledger: ReiseLedger,
  opts?: { savedTrips?: ReiseTrip[]; skipTimelinePrefs?: boolean },
): ReiseLedger {
  let next = { ...ledger };
  try {
    const profile = getCachedUserProfile();
    if (!next.originCity && profile?.cityName) {
      next.originCity = entry(profile.cityName, 'profile');
    }
    const vegan =
      (profile?.dietaryTags ?? []).some((t) => /vegan/i.test(t)) ||
      profile?.experiencePrefs?.vegan === 'yes';
    if (vegan) {
      const cur = next.mustHaves?.value ?? [];
      if (!cur.includes('vegan')) {
        next.mustHaves = entry([...cur, 'vegan'], 'profile', 'wish');
      }
    }
  } catch {
    /* soft */
  }

  try {
    const gps = useGpsStore.getState();
    if (gps.lat != null && gps.lng != null) {
      if (!next.originLat) next.originLat = entry(gps.lat, 'default');
      if (!next.originLng) next.originLng = entry(gps.lng, 'default');
    }
  } catch {
    /* soft */
  }

  if (isAirportVisible(next) && !next.airportIata) {
    const lat = next.originLat?.value;
    const lng = next.originLng?.value;
    if (lat != null && lng != null) {
      const ap = nearestCommercialAirport(lat, lng);
      if (ap) next.airportIata = entry(ap.iata, 'default');
    } else if (/hamburg/i.test(next.originCity?.value ?? '')) {
      next.airportIata = entry('HAM', 'default');
    } else if (/prisdorf|pinneberg|elmshorn|uetersen|tornesch/i.test(next.originCity?.value ?? '')) {
      // Dorf ohne Flughafen → nächster Hub für Suche, Chip bleibt „Start …“
      next.airportIata = entry('HAM', 'default');
    }
  }
  if (!isAirportVisible(next)) {
    next = { ...next, airportIata: null };
  }
  if (!opts?.skipTimelinePrefs) {
    try {
      next = applyTimelineMustHavePrefs(next, { savedTrips: opts?.savedTrips });
    } catch {
      /* soft */
    }
  }
  try {
    void hydrateShelfAsked();
    next = applyShelfPrefsToLedger(next).ledger;
  } catch {
    /* soft */
  }
  return next;
}
