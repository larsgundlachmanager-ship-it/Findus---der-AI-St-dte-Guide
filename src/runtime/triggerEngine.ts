/**
 * Modul 1 TriggerEngine (Phase 3).
 * GPS → candidate → LOCK / direction / speed gates → fire | skip | none.
 * Narration (Flows A/B/C) stays outside — Phase 4.
 */

import {
  getPoiById,
  haversineMeters,
  matchGeoTriggerCluster,
  type GeoMatch,
} from '../db/database';
import type { Poi, PoiKind } from '../db/types';
import { isPoiTeaserLocked } from '../services/poi/poiTeaserLocks';
import {
  bearingDegrees,
  relativeBearingDeg,
} from '../services/navigation/bearing';
import { shouldSkipTriggerForSpeed } from './gpsPolicy';
import { effectiveTriggerRadiusM } from '../services/geo/triggerRadius';
import type { GpsSample } from './types';
import {
  selectApproachBundle,
  WEGWEISER_BUNDLE_M,
} from '../services/navigation/wegweiserBundlePolicy';
import { getCachedUserProfile } from '../services/userProfileService';

/** UI clear after leaving geofence (ms). */
export const TRIGGER_UI_CLEAR_AFTER_MS = 4_000;

/** Min distance increase to Hauptort to count as "moving away" (m). */
const AWAY_DIST_DELTA_M = 4;
/** Heading vs bearing to Hauptort beyond this → moving away (deg). */
const AWAY_HEADING_CONE_DEG = 120;

export type TriggerSessionSnapshot = {
  spokenAreaIds: Set<number>;
  spokenApproachIds: Set<number>;
  spokenSubIds: Set<number>;
  visitedSpotKeys: Set<string>;
  lastLat: number | null;
  lastLng: number | null;
};

export type TriggerEngineResult =
  | {
      action: 'fire';
      match: GeoMatch;
      kind: PoiKind;
      /** Max 2 Partner für Audio-Bundle (ohne Primary). */
      bundlePeerPois?: Poi[];
      /** Extra UI-only Treffer (nicht gesprochen). */
      silentBundlePois?: Poi[];
    }
  | { action: 'skip'; reason: string; poiId: number; persistSpoken: boolean }
  | { action: 'none'; outsideSinceMs: number | null };

type Session = {
  spokenAreaIds: Set<number>;
  spokenApproachIds: Set<number>;
  spokenSubIds: Set<number>;
  visitedSpotKeys: Set<string>;
  lastLat: number | null;
  lastLng: number | null;
  outsideSinceMs: number | null;
};

let session: Session = createEmptySession();

function createEmptySession(): Session {
  return {
    spokenAreaIds: new Set(),
    spokenApproachIds: new Set(),
    spokenSubIds: new Set(),
    visitedSpotKeys: new Set(),
    lastLat: null,
    lastLng: null,
    outsideSinceMs: null,
  };
}

export function getTriggerSession(): TriggerSessionSnapshot {
  return {
    spokenAreaIds: session.spokenAreaIds,
    spokenApproachIds: session.spokenApproachIds,
    spokenSubIds: session.spokenSubIds,
    visitedSpotKeys: session.visitedSpotKeys,
    lastLat: session.lastLat,
    lastLng: session.lastLng,
  };
}

export function clearTriggerSession(poiId?: number): void {
  if (poiId == null) {
    session = createEmptySession();
    return;
  }
  session.spokenAreaIds.delete(poiId);
  session.spokenApproachIds.delete(poiId);
  session.spokenSubIds.delete(poiId);
}

export function allSpokenTriggerIds(): Set<number> {
  return new Set([
    ...session.spokenAreaIds,
    ...session.spokenApproachIds,
    ...session.spokenSubIds,
  ]);
}

export function sessionSetForKind(kind: string | null | undefined): Set<number> {
  if (kind === 'approach') return session.spokenApproachIds;
  if (kind === 'sub') return session.spokenSubIds;
  return session.spokenAreaIds;
}

export function markTriggerSpoken(poiId: number, kind: string | null | undefined): void {
  sessionSetForKind(kind).add(poiId);
}

export function unmarkTriggerSpoken(
  poiId: number,
  kind: string | null | undefined,
): void {
  sessionSetForKind(kind).delete(poiId);
}

export function markSpotVisited(spotKey: string): void {
  session.visitedSpotKeys.add(spotKey);
}

export function hasVisitedSpot(spotKey: string): boolean {
  return session.visitedSpotKeys.has(spotKey);
}

export function noteUserPosition(lat: number, lng: number): void {
  session.lastLat = lat;
  session.lastLng = lng;
}

export function getLastUserPosition(): {
  lat: number | null;
  lng: number | null;
} {
  return { lat: session.lastLat, lng: session.lastLng };
}

/**
 * Resolve Hauptort coords for direction gate (approach → parent, else self).
 */
async function resolveHauptortTarget(poi: Poi): Promise<{
  lat: number;
  lng: number;
} | null> {
  const kind = poi.kind ?? 'legacy';
  if (kind !== 'approach' || poi.parent_poi_id == null) {
    return { lat: poi.lat, lng: poi.lng };
  }
  const parent = await getPoiById(poi.parent_poi_id);
  if (!parent) return { lat: poi.lat, lng: poi.lng };
  return { lat: parent.lat, lng: parent.lng };
}

/**
 * Moving away from Hauptort → skip and do NOT persist spoken.
 * Uses distance delta (prev→now) + optional heading cone.
 */
export function isMovingAwayFromTarget(opts: {
  prevLat: number | null;
  prevLng: number | null;
  lat: number;
  lng: number;
  targetLat: number;
  targetLng: number;
  headingDeg?: number | null;
}): boolean {
  const { prevLat, prevLng, lat, lng, targetLat, targetLng } = opts;

  let distDelta: number | null = null;
  if (prevLat != null && prevLng != null) {
    const dPrev = haversineMeters(prevLat, prevLng, targetLat, targetLng);
    const dNow = haversineMeters(lat, lng, targetLat, targetLng);
    distDelta = dNow - dPrev;
    if (distDelta >= AWAY_DIST_DELTA_M) return true;
    // Clearly approaching — ignore noisy compass
    if (distDelta <= -AWAY_DIST_DELTA_M) return false;
  }

  // Heading only when distance is flat / first sample
  const heading = opts.headingDeg;
  if (
    typeof heading === 'number' &&
    Number.isFinite(heading) &&
    (distDelta == null || Math.abs(distDelta) < AWAY_DIST_DELTA_M)
  ) {
    const toTarget = bearingDegrees(lat, lng, targetLat, targetLng);
    const rel = Math.abs(relativeBearingDeg(heading, toTarget));
    if (rel > AWAY_HEADING_CONE_DEG) return true;
  }

  return false;
}

function lockBlocks(poi: Poi): boolean {
  const kind = poi.kind ?? 'legacy';
  if (kind !== 'approach') return false;
  if (isPoiTeaserLocked({ spotKey: poi.spot_key, poiId: poi.id })) return true;
  if (
    poi.parent_poi_id != null &&
    isPoiTeaserLocked({ poiId: poi.parent_poi_id })
  ) {
    return true;
  }
  return false;
}

export type EvaluateGpsTriggerInput = GpsSample & {
  radiusScale?: number;
  transportMode?: 'walk' | 'bicycle' | 'transit' | 'unknown';
};

/**
 * Core GPS evaluation: match → LOCK / direction / speed → fire | skip | none.
 */
export async function evaluateGpsTrigger(
  input: EvaluateGpsTriggerInput,
): Promise<TriggerEngineResult> {
  const prevLat = session.lastLat;
  const prevLng = session.lastLng;
  const { lat, lng } = input;

  const cluster = await matchGeoTriggerCluster(lat, lng, {
    excludePoiIds: allSpokenTriggerIds(),
    visitedSpotKeys: session.visitedSpotKeys,
    radiusScale: input.radiusScale ?? 1,
    bundleRadiusM: WEGWEISER_BUNDLE_M,
  });
  const match = cluster?.primary ?? null;

  // Always refresh last position after using prev for direction
  session.lastLat = lat;
  session.lastLng = lng;

  if (!match) {
    if (session.outsideSinceMs == null) session.outsideSinceMs = Date.now();
    return { action: 'none', outsideSinceMs: session.outsideSinceMs };
  }

  session.outsideSinceMs = null;

  const poi = match.poi;
  const kind = (poi.kind ?? 'legacy') as PoiKind;
  const poiId = poi.id;

  if (lockBlocks(poi)) {
    return {
      action: 'skip',
      reason: 'teaser_locked',
      poiId,
      persistSpoken: true,
    };
  }

  // Stempelkarte / schon erlebt → skip
  const spot = (poi.spot_key ?? '').trim();
  if (spot && hasVisitedSpot(spot)) {
    return {
      action: 'skip',
      reason: 'already_stamped',
      poiId,
      persistSpoken: true,
    };
  }
  if (session.spokenAreaIds.has(poiId) || session.spokenSubIds.has(poiId)) {
    return {
      action: 'skip',
      reason: 'already_reported',
      poiId,
      persistSpoken: true,
    };
  }
  // Passport / Session-History
  try {
    const { useFinnusStore } = await import('../store/useFinnusStore');
    const visited = useFinnusStore.getState().visitedHistory;
    if (visited.some((v) => v.poiId === poiId)) {
      return {
        action: 'skip',
        reason: 'passport_visited',
        poiId,
        persistSpoken: true,
      };
    }
  } catch {
    /* soft */
  }

  const target = await resolveHauptortTarget(poi);
  if (target) {
    const away = isMovingAwayFromTarget({
      prevLat,
      prevLng,
      lat,
      lng,
      targetLat: target.lat,
      targetLng: target.lng,
      headingDeg: input.headingDeg,
    });
    if (away) {
      return {
        action: 'skip',
        reason: 'moving_away',
        poiId,
        persistSpoken: false,
      };
    }
  }

  const speedMs =
    typeof input.speedMs === 'number' && Number.isFinite(input.speedMs)
      ? Math.max(0, input.speedMs)
      : 0;
  if (
    shouldSkipTriggerForSpeed({
      speedMs,
      triggerRadiusM: effectiveTriggerRadiusM(poi, input.radiusScale ?? 1),
      transportMode: input.transportMode ?? 'unknown',
    })
  ) {
    return {
      action: 'skip',
      reason: 'too_fast_to_stop',
      poiId,
      persistSpoken: false,
    };
  }

  return {
    action: 'fire',
    match,
    kind,
    ...buildBundleExtras(match, cluster?.nearby ?? [match], kind),
  };
}

function buildBundleExtras(
  primary: GeoMatch,
  nearby: GeoMatch[],
  kind: PoiKind,
): { bundlePeerPois?: Poi[]; silentBundlePois?: Poi[] } {
  if (kind !== 'approach' && kind !== 'area' && kind !== 'legacy') {
    return {};
  }
  const profile = getCachedUserProfile();
  const selection = selectApproachBundle(
    nearby.map((n) => ({ poi: n.poi, distanceM: n.distanceM })),
    {
      profile,
      bundleRadiusM: WEGWEISER_BUNDLE_M,
      primaryPoiId: primary.poi.id,
    },
  );
  const peers = selection.spoken
    .filter((s) => s.poi.id !== primary.poi.id)
    .map((s) => s.poi);
  const silent = selection.silentUi.map((s) => s.poi);
  return {
    bundlePeerPois: peers.length ? peers : undefined,
    silentBundlePois: silent.length ? silent : undefined,
  };
}
