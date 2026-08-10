/**
 * Dwell → VisitLog + HistoricalTimeline.
 * Kein Vibrieren. Dedup: gleicher Ort nicht doppelt hintereinander.
 */

import { dateKeyFromMs } from '../../utils/dateKeys';
import { useHistoricalTimelineStore } from '../../module2/timeline/historicalTimelineState';
import { upsertVisitFromStamp } from './visitLog';
import { shouldAppendDwellPlace } from './dwellPlaceDedupe';
import { simplifyPlaceName } from './placeLabelClean';
import type { DwellPlaceHit } from './resolveDwellPlace';

export function recordDwellVisit(opts: {
  hit: DwellPlaceHit;
  lat: number;
  lng: number;
  arrivedAtMs: number;
  dwellMin?: number;
}): boolean {
  const title = simplifyPlaceName(opts.hit.title) || opts.hit.title;
  const dayKey = dateKeyFromMs(opts.arrivedAtMs);
  const chain = useHistoricalTimelineStore
    .getState()
    .entriesForDay(dayKey)
    .map((e) => ({
      title: e.title,
      lat: e.lat,
      lng: e.lng,
      atMs: e.atMs,
    }));

  const next = {
    title,
    lat: opts.lat,
    lng: opts.lng,
    atMs: opts.arrivedAtMs,
  };
  if (!shouldAppendDwellPlace(chain, next)) {
    // Nur Verweildauer am letzten Visit aktualisieren — kein neuer Timeline-Punkt
    upsertVisitFromStamp({
      name: title,
      lat: opts.lat,
      lng: opts.lng,
      poiId: opts.hit.poiId ?? null,
      arrivedAtMs: opts.arrivedAtMs,
      dwellMin: opts.dwellMin ?? 2,
      source: 'dwell',
      onTimeline: true,
    });
    return false;
  }

  useHistoricalTimelineStore.getState().append({
    atMs: opts.arrivedAtMs,
    title,
    lat: opts.lat,
    lng: opts.lng,
    source: 'dwell',
    confidence: opts.hit.confidence,
  });

  upsertVisitFromStamp({
    name: title,
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.hit.poiId ?? null,
    arrivedAtMs: opts.arrivedAtMs,
    dwellMin: opts.dwellMin ?? 2,
    source: 'dwell',
    onTimeline: true,
  });

  return true;
}
