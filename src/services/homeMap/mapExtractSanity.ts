/**
 * Display-Extract-Validierung — verhindert „Gebäude ja, Straßen nein“
 * durch korrupte/alte .map.display.json Snaps auf dem Gerät.
 */

import type { CityMapExtract } from './cityMapExtract';

/** Mindestens ein brauchbares Straßennetz wenn Gebäude da sind. */
export function isMapExtractRoadsSane(
  extract: CityMapExtract | null | undefined,
): boolean {
  if (!extract) return false;
  const roads = extract.roads?.length ?? 0;
  const buildings = extract.buildings?.length ?? 0;
  if (roads === 0 && buildings === 0) return false;
  if (buildings >= 80 && roads < 12) return false;
  if (buildings >= 20 && roads < 4) return false;
  return roads > 0;
}
