/**
 * Landmark polish — Pack / Overpass only (no Google Places on turn hot path).
 */

import { getAllPois } from '../../../db/database';
import { distanceMeters } from '../bearing';
import { isTurnManeuver } from '../navPredictiveCue';
import { fetchOsmVisualLandmark } from '../osmVisualLandmark';
import {
  buildLandmarkFirstCue,
  buildTurnWithoutLandmark,
  scrubRoboticNavSpeak,
} from '../spatialOrientation';
import type { NavWaypoint } from '../navigationTypes';
import {
  classifyTurnWaypoint,
  countNearbyRoads,
} from '../turnComplexityClassifier';
import { registerClassifiedTurns } from '../lookAheadBuffer';
import type { ClassifiedTurn } from '../turnComplexityClassifier';

function turnWord(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn')) return 'umdrehen';
  return 'geradeaus';
}

function facingConeOk(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  landmarkLat: number,
  landmarkLng: number,
): boolean {
  const pathB = Math.atan2(toLng - fromLng, toLat - fromLat);
  const landB = Math.atan2(landmarkLng - fromLng, landmarkLat - fromLat);
  let d = ((landB - pathB) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d) <= 70;
}

async function localPoiName(
  lat: number,
  lng: number,
  pois: Awaited<ReturnType<typeof getAllPois>>,
): Promise<string | null> {
  let best: string | null = null;
  let bestD = 55;
  for (const p of pois) {
    if (!p.name?.trim() || p.kind === 'approach') continue;
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d < bestD) {
      bestD = d;
      best = p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
    }
  }
  return best;
}

export async function resolveStartLandmark(opts: {
  lat: number;
  lng: number;
}): Promise<string | null> {
  try {
    const pois = await getAllPois();
    return localPoiName(opts.lat, opts.lng, pois);
  } catch {
    return null;
  }
}

/**
 * Classify all turns, register look-ahead, polish landmarks via Pack/Overpass.
 */
export async function polishAllTurnsOsmFirst(opts: {
  dense: NavWaypoint[];
  raw: NavWaypoint[];
  isCancelled?: () => boolean;
}): Promise<NavWaypoint[]> {
  const { dense, raw } = opts;
  const pois = await getAllPois().catch(() => []);
  const classified: ClassifiedTurn[] = [];

  for (let i = 0; i < raw.length; i++) {
    if (opts.isCancelled?.()) return dense;
    const wp = raw[i];
    if (!isTurnManeuver(wp.maneuver)) continue;
    const prev = i > 0 ? raw[i - 1] : null;
    const next = i + 1 < raw.length ? raw[i + 1] : null;
    const nearbyRoadCount = countNearbyRoads(raw, i, 2);
    const c = classifyTurnWaypoint(i, {
      wp,
      prev,
      next,
      landmark: null,
      roadName: wp.roadName ?? null,
      nearbyRoadCount,
      isUrban: true,
    });
    classified.push(c);

    // Attach complexity onto nearest dense WP
    let bestIdx = -1;
    let bestD = 40;
    for (let d = 0; d < dense.length; d++) {
      const dist = distanceMeters(dense[d].lat, dense[d].lng, wp.lat, wp.lng);
      if (dist < bestD) {
        bestD = dist;
        bestIdx = d;
      }
    }
    if (bestIdx >= 0) {
      dense[bestIdx] = {
        ...dense[bestIdx],
        turnComplexity: c.complexity,
        complexityScore: c.score,
        turnHeadingDeg: c.headingDeg,
        maneuver: wp.maneuver ?? dense[bestIdx].maneuver,
        roadName: wp.roadName ?? dense[bestIdx].roadName,
      };
    }
  }

  registerClassifiedTurns(classified);

  // Landmark polish — all turns, OSM/Pack only
  await Promise.all(
    classified.map(async (c) => {
      if (opts.isCancelled?.()) return;
      const wp = raw[c.waypointIndex];
      if (!wp) return;
      const prev =
        c.waypointIndex > 0
          ? raw[c.waypointIndex - 1]
          : { lat: wp.lat, lng: wp.lng };

      let landmark = await localPoiName(wp.lat, wp.lng, pois);
      if (!landmark) {
        try {
          const visual = await fetchOsmVisualLandmark({
            lat: wp.lat,
            lng: wp.lng,
            radiusM: 45,
            headingDeg: c.headingDeg,
          });
          if (visual?.labelDe) {
            // Prefer facing-cone when we have geometry
            if (
              facingConeOk(
                prev.lat,
                prev.lng,
                wp.lat,
                wp.lng,
                visual.lat,
                visual.lng,
              )
            ) {
              landmark = visual.labelDe;
            } else {
              landmark = visual.labelDe;
            }
          }
        } catch {
          /* soft */
        }
      }
      if (!landmark) return;

      let bestIdx = -1;
      let bestD = 40;
      for (let d = 0; d < dense.length; d++) {
        const dist = distanceMeters(dense[d].lat, dense[d].lng, wp.lat, wp.lng);
        if (dist < bestD) {
          bestD = dist;
          bestIdx = d;
        }
      }
      if (bestIdx < 0) return;
      const turn = turnWord(wp.maneuver);
      const cue =
        turn !== 'geradeaus'
          ? scrubRoboticNavSpeak(
              buildLandmarkFirstCue({
                landmark,
                relation: {
                  side: 'front',
                  bearingRelDeg: 0,
                  sidePhrase: 'voraus',
                  shortPhrase: 'vor dir',
                },
                turn,
                roadName: wp.roadName ?? null,
              }),
            )
          : buildTurnWithoutLandmark(turn, wp.roadName ?? null);
      dense[bestIdx] = {
        ...dense[bestIdx],
        landmark,
        visibleLandmark: landmark,
        cue,
      };
    }),
  );

  return dense;
}
