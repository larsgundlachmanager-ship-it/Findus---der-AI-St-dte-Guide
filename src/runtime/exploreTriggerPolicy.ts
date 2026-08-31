/**
 * Modul 1 Trigger-Tiefe: volle Story vs. Wegweiser-Teaser vs. skip.
 * Nav: ≤50 m Abbiege → skip · POI-Cluster ≤20 m → nur Teaser · sonst voller Plan.
 * Tempo: Full unter 10 km/h (kein Stillstand nötig).
 */

import { getAllPois, haversineMeters } from '../db/database';
import type { PoiKind } from '../db/types';
import type { NavExploreMode } from '../types/userProfile';
import { shouldPauseExploreStoryForNavTurn } from '../services/navigation';
import { allSpokenTriggerIds } from './triggerEngine';

/** Nur Haupt-Anker — keine Sub-POIs (Spam-Schutz). */
function isAnchorKnotenpunkt(kind: PoiKind): boolean {
  return kind === 'area' || kind === 'approach' || kind === 'legacy';
}

/** Kein anderer ungesprochener Knotenpunkt in diesem Radius (m). */
export const EXPLORE_CLUSTER_CLEAR_M = 20;

/** Nav-Modus: in diesem Radius nur Teaser statt Vollerzählung. */
export const EXPLORE_NAV_TEASER_M = 50;

/** ≥ 10 km/h → eher Teaser statt Sofort-Story. */
const FAST_MS = 10 / 3.6;

export type ExploreDepth = 'full' | 'teaser' | 'skip';

export type ExploreDepthResult = {
  depth: ExploreDepth;
  reason: string;
  nearbyOtherCount: number;
  distToPoiM: number;
};

/**
 * Zählt andere Trigger-Knotenpunkte im Radius (ohne current + schon gesprochene).
 */
export async function countNearbyUnspokenTriggers(
  lat: number,
  lng: number,
  excludePoiId: number,
  withinM: number,
  excludeSpotKey?: string | null,
): Promise<number> {
  const spoken = allSpokenTriggerIds();
  const pois = await getAllPois();
  const skipSpot = (excludeSpotKey || '').trim();
  let count = 0;
  for (const poi of pois) {
    if (poi.id === excludePoiId) continue;
    if (spoken.has(poi.id)) continue;
    if (skipSpot && poi.spot_key === skipSpot) continue;
    const kind = (poi.kind ?? 'legacy') as PoiKind;
    if (!isAnchorKnotenpunkt(kind)) continue;
    const blob = `${poi.tags_json ?? ''}`.toLowerCase();
    if (/amenity_skip|"directory"|"tier4"|prune_/.test(blob)) continue;
    const d = haversineMeters(lat, lng, poi.lat, poi.lng);
    // Nur der 20-m-Cluster — nicht den großen Story-Floor (80 m) als Nachbar zählen.
    if (d <= withinM) count += 1;
  }
  return count;
}

export async function resolveExploreDepth(input: {
  navActive: boolean;
  lat: number;
  lng: number;
  poiId: number;
  poiLat: number;
  poiLng: number;
  planAction: string;
  speedMs?: number | null;
  radiusScale?: number;
  force?: boolean;
  interestDeepDive?: boolean;
  /** quiet | mute_until_dest | full — Default quiet */
  navExploreMode?: NavExploreMode | null;
  /** Aktives Nav-Ziel ist genau dieser POI */
  isNavDestination?: boolean;
  /** Gleicher Spot darf den Arrival nicht zum Teaser degradieren */
  spotKey?: string | null;
}): Promise<ExploreDepthResult> {
  const distToPoiM = haversineMeters(
    input.lat,
    input.lng,
    input.poiLat,
    input.poiLng,
  );
  const navMode: NavExploreMode = input.navExploreMode ?? 'quiet';

  if (input.force || input.interestDeepDive) {
    return {
      depth: 'full',
      reason: 'forced',
      nearbyOtherCount: 0,
      distToPoiM,
    };
  }

  if (shouldPauseExploreStoryForNavTurn()) {
    return {
      depth: 'skip',
      reason: 'nav_turn_within_50m',
      nearbyOtherCount: 0,
      distToPoiM,
    };
  }

  const nearby20 = await countNearbyUnspokenTriggers(
    input.lat,
    input.lng,
    input.poiId,
    EXPLORE_CLUSTER_CLEAR_M,
    input.spotKey,
  );

  const speed = Math.max(0, input.speedMs ?? 0);
  const under10 = speed < FAST_MS;

  // Nav Mode B: stumm bis Ziel (außer Ziel-POI selbst)
  if (input.navActive && navMode === 'mute_until_dest') {
    if (input.isNavDestination) {
      return {
        depth: under10 ? 'full' : 'teaser',
        reason: 'nav_mute_dest_poi',
        nearbyOtherCount: nearby20,
        distToPoiM,
      };
    }
    return {
      depth: 'skip',
      reason: 'nav_mute_until_dest',
      nearbyOtherCount: nearby20,
      distToPoiM,
    };
  }

  // Nav Mode C: wie Free-Roam (keine Nav-Kürzung)
  const treatAsFreeRoam = !input.navActive || navMode === 'full';

  if (!treatAsFreeRoam && input.navActive) {
    // Mode A quiet: Teaser unterwegs; Full nur unter 10 km/h
    if (nearby20 > 0 && distToPoiM > 40) {
      return {
        depth: 'teaser',
        reason: 'nav_cluster_20m',
        nearbyOtherCount: nearby20,
        distToPoiM,
      };
    }
    if (
      input.planAction === 'full_story' &&
      distToPoiM <= EXPLORE_NAV_TEASER_M &&
      !under10
    ) {
      return {
        depth: 'teaser',
        reason: 'nav_poi_within_50m_moving',
        nearbyOtherCount: 0,
        distToPoiM,
      };
    }
    if (input.planAction === 'full_story' && under10) {
      return {
        depth: 'full',
        reason: 'nav_quiet_under_10kmh',
        nearbyOtherCount: 0,
        distToPoiM,
      };
    }
    if (input.planAction === 'approach_hook') {
      return {
        depth: 'teaser',
        reason: 'nav_wegweiser',
        nearbyOtherCount: nearby20,
        distToPoiM,
      };
    }
    return {
      depth: under10 ? 'full' : 'teaser',
      reason: under10 ? 'nav_quiet_full' : 'nav_quiet_teaser',
      nearbyOtherCount: nearby20,
      distToPoiM,
    };
  }

  // Free roam / full mode
  if (
    nearby20 > 0 &&
    input.planAction === 'full_story' &&
    distToPoiM > 40
  ) {
    return {
      depth: 'teaser',
      reason: 'free_roam_cluster_20m',
      nearbyOtherCount: nearby20,
      distToPoiM,
    };
  }

  if (input.planAction === 'full_story' && !under10) {
    return {
      depth: 'teaser',
      reason: 'free_roam_over_10kmh',
      nearbyOtherCount: nearby20,
      distToPoiM,
    };
  }

  if (input.planAction === 'approach_hook') {
    return {
      depth: 'teaser',
      reason: 'wegweiser',
      nearbyOtherCount: nearby20,
      distToPoiM,
    };
  }

  return {
    depth: 'full',
    reason: 'free_roam_full',
    nearbyOtherCount: nearby20,
    distToPoiM,
  };
}
