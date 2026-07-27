/**
 * Kompass-Nav-Fortschritt: Meter oder „Noch X Stationen“ (ÖPNV).
 * Genutzt von Header / AudioWave — kein eigenes Overlay-Layout.
 */

import type { TransportMode } from '../services/navigation/navigationTypes';
import {
  formatRemainingStations,
  isTransitMode,
} from '../services/navigation/transportMode';

export function formatCompassNavLabel(opts: {
  distanceM: number | null;
  transportMode: TransportMode | null;
  remainingStations: number | null;
}): string {
  if (opts.transportMode && isTransitMode(opts.transportMode)) {
    return formatRemainingStations(opts.remainingStations);
  }
  const m = opts.distanceM;
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
