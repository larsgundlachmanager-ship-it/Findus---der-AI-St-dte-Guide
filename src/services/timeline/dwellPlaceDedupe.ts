/**
 * Dwell-Dedup: gleicher Ort nicht doppelt hintereinander.
 * Erneuter Besuch ok, wenn klar anderer Ort dazwischen lag.
 */

import { haversineMeters } from '../../db/database';
import { placeNameKey } from './placeLabelClean';

export type DwellPlaceRef = {
  title: string;
  lat: number;
  lng: number;
  atMs?: number;
};

const SAME_PLACE_M = 45;

export function isSameDwellPlace(a: DwellPlaceRef, b: DwellPlaceRef): boolean {
  const d = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  if (d <= SAME_PLACE_M) return true;
  const ka = placeNameKey(a.title);
  const kb = placeNameKey(b.title);
  if (ka.length >= 3 && ka === kb && d <= 120) return true;
  return false;
}

/**
 * true = eintragen; false = skip (gleicher Ort wie letzter Eintrag).
 */
export function shouldAppendDwellPlace(
  previous: DwellPlaceRef[],
  next: DwellPlaceRef,
): boolean {
  if (previous.length === 0) return true;
  const last = previous[previous.length - 1]!;
  // Nur der letzte zählt — Hotel → Ausflug → Hotel ist erlaubt
  if (isSameDwellPlace(last, next)) return false;
  return true;
}
