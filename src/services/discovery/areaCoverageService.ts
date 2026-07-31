/**
 * Flächenabdeckung der Stempelkarte — % der **aktuellen Stadt**-Fläche,
 * die per GPS-Trail freigeschaltet ist (nicht die gesamte Reise-BBox).
 */

import type { Poi } from '../../db/types';
import { haversineMeters } from '../../db/database';
import {
  getWalkTrackSnapshot,
  WALK_REVEAL_RADIUS_M,
  type WalkTrackPoint,
} from '../discovery/walkTrackService';
import { getCachedUserProfile } from '../userProfileService';
import {
  estimateBoundsFromCenter,
  pointInCityBounds,
  resolveCityCoverageBoundsSync,
  type CityCoverageBounds,
} from './cityCoverageBounds';

const GRID = 48;

export type AreaCoverageResult = {
  /** 0–100, gerundet */
  percent: number;
  explorableCells: number;
  revealedCells: number;
  method: 'city_bbox' | 'poi_grid' | 'walk_bbox';
  cityId: string | null;
  cityName: string | null;
};

function isAreaPoi(p: Poi): boolean {
  const k = p.kind ?? 'legacy';
  return k === 'area' || k === 'legacy';
}

function poiFootprintRadiusM(p: Poi): number {
  const r = p.special_radius_m ?? p.radius_meters;
  return Math.max(40, Number.isFinite(r) ? r : 80);
}

function isRevealedAt(
  lat: number,
  lng: number,
  revealPoints: Array<{ lat: number; lng: number }>,
  revealM: number,
): boolean {
  for (const p of revealPoints) {
    if (haversineMeters(lat, lng, p.lat, p.lng) <= revealM) return true;
  }
  return false;
}

function bboxFromPois(pois: Poi[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of pois) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const pad = poiFootprintRadiusM(p) / 111_320;
    minLat = Math.min(minLat, p.lat - pad);
    maxLat = Math.max(maxLat, p.lat + pad);
    minLng = Math.min(minLng, p.lng - pad);
    maxLng = Math.max(maxLng, p.lng + pad);
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

function sampleGridInBounds(
  bounds: CityCoverageBounds,
  revealPoints: Array<{ lat: number; lng: number }>,
  revealM: number,
): { explorable: number; revealed: number } {
  let explorable = 0;
  let revealed = 0;
  const latStep = (bounds.latMax - bounds.latMin) / GRID;
  const lngStep = (bounds.lngMax - bounds.lngMin) / GRID;
  if (latStep <= 0 || lngStep <= 0) return { explorable: 0, revealed: 0 };

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const lat = bounds.latMin + (i + 0.5) * latStep;
      const lng = bounds.lngMin + (j + 0.5) * lngStep;
      explorable += 1;
      if (isRevealedAt(lat, lng, revealPoints, revealM)) revealed += 1;
    }
  }
  return { explorable, revealed };
}

function resolveBoundsForCoverage(pois: Poi[]): CityCoverageBounds | null {
  const profile = getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').toLowerCase();
  const resolved = resolveCityCoverageBoundsSync(cityId || null);
  if (resolved) return resolved;

  // Schätzung aus POI-Cluster der aktuellen Stadt
  const areaPois = pois.filter(isAreaPoi);
  const poiBbox = bboxFromPois(areaPois);
  if (poiBbox && cityId && areaPois.length >= 3) {
    return {
      cityId,
      name: profile?.cityName ?? cityId,
      latMin: poiBbox.minLat,
      latMax: poiBbox.maxLat,
      lngMin: poiBbox.minLng,
      lngMax: poiBbox.maxLng,
      source: 'pack_estimate',
    };
  }

  // Pack-Zentrum aus erstem POI
  if (cityId && areaPois[0]) {
    return estimateBoundsFromCenter({
      cityId,
      name: profile?.cityName ?? cityId,
      lat: areaPois[0].lat,
      lng: areaPois[0].lng,
    });
  }
  return null;
}

export function computeAreaCoverage(opts: {
  pois: Poi[];
  walkTrack?: WalkTrackPoint[];
  userLoc?: { lat: number; lng: number } | null;
  revealRadiusM?: number;
}): AreaCoverageResult {
  const revealM = opts.revealRadiusM ?? WALK_REVEAL_RADIUS_M;
  const profile = getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').toLowerCase() || null;
  const bounds = resolveBoundsForCoverage(opts.pois);

  const track = opts.walkTrack ?? getWalkTrackSnapshot();
  // Nur Punkte INNERHALB der Stadt zählen — Fernreise verfälscht sonst %
  let revealPoints: Array<{ lat: number; lng: number }> = track.map((p) => ({
    lat: p.lat,
    lng: p.lng,
  }));
  if (opts.userLoc) revealPoints.push(opts.userLoc);

  if (bounds) {
    revealPoints = revealPoints.filter((p) =>
      pointInCityBounds(p.lat, p.lng, bounds),
    );
  }

  const empty = (method: AreaCoverageResult['method']): AreaCoverageResult => ({
    percent: 0,
    explorableCells: 0,
    revealedCells: 0,
    method,
    cityId,
    cityName: bounds?.name ?? profile?.cityName ?? null,
  });

  if (!bounds) {
    // Kein Stadt-Bezug → 0 % statt irreführende Reise-BBox
    return empty('walk_bbox');
  }

  if (revealPoints.length === 0) {
    return empty('city_bbox');
  }

  const { explorable, revealed } = sampleGridInBounds(
    bounds,
    revealPoints,
    revealM,
  );
  if (explorable <= 0) return empty('city_bbox');

  return {
    percent: Math.min(100, Math.round((revealed / explorable) * 100)),
    explorableCells: explorable,
    revealedCells: revealed,
    method: 'city_bbox',
    cityId: bounds.cityId,
    cityName: bounds.name,
  };
}

export function getActiveCityBoundsForMap(): CityCoverageBounds | null {
  return resolveBoundsForCoverage([]);
}
