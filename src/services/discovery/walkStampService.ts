/**
 * Soft-Stempel: GPS-Trail in ~20 m Nähe eines POIs → Stempelkarte.
 * Keine Narration nötig — nur „hier war ich schon“.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { shortPoiDisplayName } from '../../utils/poiDisplayName';
import { WALK_REVEAL_RADIUS_M } from './walkTrackService';

const THROTTLE_MS = 8_000;
let lastScanAt = 0;

export function stampNearbyPoisFromWalk(lat: number, lng: number): void {
  const now = Date.now();
  if (now - lastScanAt < THROTTLE_MS) return;
  lastScanAt = now;

  const store = useFinnusStore.getState();
  const pois = store.pois;
  if (!pois.length) return;

  const radius = Math.min(WALK_REVEAL_RADIUS_M + 5, 30);
  const visited = new Set(store.visitedHistory.map((v) => v.poiId));

  for (const poi of pois) {
    if (poi.kind === 'approach' || poi.kind === 'sub') continue;
    if (visited.has(poi.id)) continue;
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
    const d = haversineMeters(lat, lng, poi.lat, poi.lng);
    if (d > radius) continue;
    store.addVisitedPlace({
      poiId: poi.id,
      name: shortPoiDisplayName(poi.name),
      kind: 'generic',
      keyFacts: ['Per GPS entdeckt'],
      visitedAt: now,
    });
    try {
      const { noteModule1PlaceOnAxis } = require('../module5/unifiedDayAxis') as {
        noteModule1PlaceOnAxis: (o: {
          name: string;
          lat?: number;
          lng?: number;
          poiId?: number;
          atMs?: number;
          source?: 'stamp';
        }) => void;
      };
      noteModule1PlaceOnAxis({
        name: shortPoiDisplayName(poi.name),
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        atMs: now,
        source: 'stamp',
      });
    } catch {
      /* soft */
    }
    visited.add(poi.id);
  }
}
