/**
 * Proaktive Regenwarnung nur draußen — nicht im Hotel/Restaurant/Museum/Gebäude.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getCachedUserProfile } from '../userProfileService';
import { findExtractBuildingUnderPin } from '../homeMap/extractBuildingUnderPin';
import { distanceMeters } from '../navigation/bearing';

/** Accuracy schlechter → oft Indoor / Drift. */
export const RAIN_WARN_POOR_ACCURACY_M = 45;
/** Hotel-Nähe → Indoor. */
export const RAIN_WARN_HOTEL_RADIUS_M = 55;

const INDOOR_PLACE_RE =
  /\b(hotel|pension|hostel|apartment|ferienwohnung|restaurant|gasthaus|gasthof|wirtshaus|café|cafe|bistro|bar\b|museum|galerie|kino|theater|oper|praxis|arzt|zahnarzt|klinik|krankenhaus|bibliothek|bücherei|buecherei|mall|einkaufszentrum|shopping|bahnhofshalle|flughafen|terminal|indoor|therme|spa|fitness|studio|supermarkt|bäckerei|baeckerei|kirche|dom|kapelle|rathaus|schule|uni\b|universität|universitaet|büro|buero|cowork)\b/iu;

function metersToHotel(
  lat: number,
  lng: number,
): number | null {
  try {
    const cityId = getCachedUserProfile()?.cityId;
    const hotel =
      useUserMemoryStore.getState().getConfirmedHotel(cityId) ??
      useUserMemoryStore.getState().getConfirmedHotel();
    if (
      !hotel ||
      typeof hotel.lat !== 'number' ||
      typeof hotel.lng !== 'number' ||
      !Number.isFinite(hotel.lat) ||
      !Number.isFinite(hotel.lng)
    ) {
      return null;
    }
    return distanceMeters(lat, lng, hotel.lat, hotel.lng);
  } catch {
    return null;
  }
}

/**
 * true = User wirkt draußen → Regenwarnung ok.
 * false = drinnen / unsicher Indoor → stumm.
 */
export function isUserOutdoorsForRainWarn(opts?: {
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  placeName?: string | null;
}): boolean {
  const store = useFinnusStore.getState();
  const lat = opts?.lat ?? store.lastGpsLat;
  const lng = opts?.lng ?? store.lastGpsLng;
  const accuracyM = opts?.accuracyM ?? store.gpsAccuracyM;
  const place = String(opts?.placeName ?? store.currentLocationName ?? '').trim();

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM >= RAIN_WARN_POOR_ACCURACY_M) {
    return false;
  }

  if (place && INDOOR_PLACE_RE.test(place)) {
    return false;
  }

  const hotelM = metersToHotel(lat, lng);
  if (hotelM != null && hotelM <= RAIN_WARN_HOTEL_RADIUS_M) {
    return false;
  }

  try {
    const buildings = useMapExtractStore.getState().extract?.buildings;
    const ring = findExtractBuildingUnderPin(lat, lng, buildings, {
      requireContain: true,
      maxAreaM2: 10_000,
    });
    if (ring) return false;
  } catch {
    /* soft — ohne Extract weiter nach Outdoor-Signalen */
  }

  return true;
}
