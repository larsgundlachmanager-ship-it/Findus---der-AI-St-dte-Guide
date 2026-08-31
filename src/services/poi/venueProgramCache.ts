/**
 * Cache: letztes Live-Programm/Ticket pro POI (Modul 1).
 * Ohne RN — nur In-Memory für denselben App-Lauf.
 */

import type { VenueProgramHit } from '../research/venueProgramResearch';

const byPoiId = new Map<number, VenueProgramHit>();

export function rememberVenueProgramHit(
  poiId: number,
  hit: VenueProgramHit,
): void {
  if (!Number.isFinite(poiId) || poiId < 0) return;
  byPoiId.set(poiId, hit);
}

export function getRememberedVenueProgramHit(
  poiId: number,
): VenueProgramHit | null {
  return byPoiId.get(poiId) ?? null;
}

export function clearVenueProgramHit(poiId?: number): void {
  if (poiId == null) {
    byPoiId.clear();
    return;
  }
  byPoiId.delete(poiId);
}
