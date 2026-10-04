/**
 * Live-HUD Ort-Pin: nur echte Karten-Orte, keine Adresse / „Gegend“.
 */

import { looksLikeStreetAddress } from '../navigation/streetAddressQuery';
import { isVaguePlaceLabel } from '../timeline/placeLabelClean';

/**
 * Live-Ort nur bei echtem Karten-Pin (POI/Hotel/Shop/Bahnhof …).
 * Keine reine Adresse, kein „Hier in der Gegend“.
 */
export function isMappedHudPlaceLabel(raw: string | null | undefined): boolean {
  const t = (raw ?? '').replace(/^📍\s*/, '').trim();
  if (!t || t === 'der Gegend') return false;
  if (isVaguePlaceLabel(t)) return false;
  if (looksLikeStreetAddress(t)) return false;
  return true;
}
