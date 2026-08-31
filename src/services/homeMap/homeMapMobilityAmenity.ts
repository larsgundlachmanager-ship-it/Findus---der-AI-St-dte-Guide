/**
 * Auto/Mietwagen vs. ÖPNV: Parkplätze & Tankstellen nur bei Car-Mobilität.
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { userDeclaredCar } from '../../module2/router/placeGoQuery';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { placeMapIcon } from './homeMapPlaceType';

const CAR_MODE_RE = /^(auto|car|mietwagen|rental|miet-auto)$/i;
const TRANSIT_MODE_RE = /^(transit|bus|bahn|train|public|öpnv|oeffis|ubahn|sbahn|tram)$/i;

export function userHasCarMobility(profile?: UserProfile | null): boolean {
  if (userDeclaredCar()) return true;
  const p = profile ?? getCachedUserProfile();
  if (!p) return false;
  if (p.mobilityMode === 'car') return true;
  const modes = p.travelModes ?? [];
  if (modes.some((m) => CAR_MODE_RE.test(String(m)))) return true;
  const car = String(p.mobilityPrefs?.car ?? '').toLowerCase();
  return car === 'yes' || car === 'own' || car === 'have' || car === 'rental';
}

export function userUsesTransitOnly(profile?: UserProfile | null): boolean {
  if (userHasCarMobility(profile)) return false;
  const p = profile ?? getCachedUserProfile();
  if (!p) return false;
  if (p.mobilityMode === 'public_transit') return true;
  try {
    if (useFinnusStore.getState().preferredTravelMode === 'transit') return true;
  } catch {
    /* soft */
  }
  const modes = p.travelModes ?? [];
  if (
    modes.length >= 1 &&
    modes.every((m) => TRANSIT_MODE_RE.test(String(m)))
  ) {
    return true;
  }
  return false;
}

export function isCarMobilityMapAmenity(poi: Poi): boolean {
  const icon = placeMapIcon(poi);
  return icon === 'parking' || icon === 'fuel';
}

/** Parkplatz/Tankstelle auf der Karte — nur wenn Auto/Mietwagen im Profil. */
export function shouldShowCarMobilityAmenityOnMap(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  if (!isCarMobilityMapAmenity(poi)) return true;
  if (userHasCarMobility(profile)) return true;
  if (userUsesTransitOnly(profile)) return false;
  return false;
}

/** Kurzer Park-Hinweis für Popup (nur belegte Fakten). */
export function parkingCostHintFromPoi(poi: Poi): string | null {
  const blob = `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  if (!/\b(parkplatz|parkhaus|parking|p\+\s*r)\b/i.test(blob)) return null;
  if (/\bkostenlos|gratis|free parking|ohne gebühr|ohne parkgebühr\b/i.test(blob)) {
    return 'Kostenlos parken';
  }
  const hourly = blob.match(/(\d+[,.]?\d*)\s*€\s*(?:\/|pro)\s*stunde/i);
  if (hourly) {
    return `ca. ${hourly[1]!.replace('.', ',')} €/Std.`;
  }
  if (/\bgebührenpflichtig|parkticket|parkgebühr|münze|automat\b/i.test(blob)) {
    return 'Gebührenpflichtig';
  }
  if (/\bp\+r\b|park\s+and\s+ride/i.test(blob)) {
    return 'P+R — oft günstiger fürs Pendeln';
  }
  return null;
}
