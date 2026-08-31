/**
 * Path-Tour: geroutete Distanz/Dauer (Walk/Bike), Wegpunkte — kein Jog-Intent-Altpfad.
 */

import { haversineMeters } from '../../db/database';
import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from '../../services/navigation/googleMapsNav';
import type { TourCandidate, TourRequest, TourStopPlan } from './types';

function offsetMeters(
  lat: number,
  lng: number,
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  const dLat = northM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = eastM / (111_320 * Math.max(0.2, cos));
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Dauer → Distanz: gelerntes Tempo sobald Segmente da, sonst Profile-Default. */
function pathPaceMPerMin(mobility: TourRequest['mobility']): number {
  try {
    const pace = require('../../services/mobility/paceProfile') as {
      getPlanWalkMPerMin: () => number;
      getPlanBikeMPerMin: () => number;
    };
    if (mobility === 'bike') return pace.getPlanBikeMPerMin();
    return pace.getPlanWalkMPerMin();
  } catch {
    return mobility === 'bike' ? 250 : 80;
  }
}

function targetDistanceM(req: TourRequest): number {
  if (req.pathSpec?.distanceKm != null) {
    return Math.round(req.pathSpec.distanceKm * 1000);
  }
  const min = req.pathSpec?.durationMin ?? req.timeBudgetMin ?? 60;
  return Math.round(min * pathPaceMPerMin(req.mobility));
}

/** Idealpunkte auf einem Loop; optional nahe Sight snappen. */
export function buildPathWaypoints(
  req: TourRequest,
  ranked: TourCandidate[],
): TourStopPlan[] {
  const targetM = targetDistanceM(req);
  const nSeg = Math.max(4, Math.min(10, Math.round(targetM / 600)));
  const r = targetM / (2 * Math.PI);
  const origin = req.anchor;
  const stops: TourStopPlan[] = [];
  const used = new Set<number>();

  for (let i = 1; i <= nSeg; i++) {
    const angle = (2 * Math.PI * i) / nSeg - Math.PI / 2;
    const radiusFactor = i === nSeg && req.pathSpec?.loop !== false ? 0.35 : 1;
    const ideal = offsetMeters(
      origin.lat,
      origin.lng,
      Math.cos(angle) * r * radiusFactor,
      Math.sin(angle) * r * radiusFactor,
    );
    let snapped: TourCandidate | null = null;
    let best = 180;
    for (const c of ranked) {
      if (used.has(c.poiId)) continue;
      const d = haversineMeters(ideal.lat, ideal.lng, c.lat, c.lng);
      if (d < best) {
        best = d;
        snapped = c;
      }
    }
    if (snapped && best < 200) {
      used.add(snapped.poiId);
      stops.push({
        poiId: snapped.poiId,
        name: snapped.name,
        lat: snapped.lat,
        lng: snapped.lng,
        dwellMin: 2,
        priority: 'soft',
      });
    } else {
      stops.push({
        poiId: -4000 - i,
        name: `Wegpunkt ${i}`,
        lat: ideal.lat,
        lng: ideal.lng,
        dwellMin: 0,
        priority: 'soft',
        waypoint: true,
      });
    }
  }
  return stops;
}

export async function scalePathToRoutedDistance(opts: {
  req: TourRequest;
  stops: TourStopPlan[];
  signal?: AbortSignal;
}): Promise<TourStopPlan[]> {
  const mode = opts.req.mobility === 'bike' ? 'bicycling' : 'walking';
  const target = targetDistanceM(opts.req);
  let cur = opts.stops;
  for (let scaleTry = 0; scaleTry < 3; scaleTry++) {
    if (opts.signal?.aborted) break;
    let total = 0;
    let prev = opts.req.anchor;
    for (const s of cur) {
      try {
        const result = await fetchRouteDirectionsResult(
          { lat: prev.lat, lng: prev.lng },
          { lat: s.lat, lng: s.lng },
          mode,
        );
        if (result?.steps?.length) {
          total += walkingDistanceFromSteps(result.steps);
        } else {
          total += haversineMeters(prev.lat, prev.lng, s.lat, s.lng) * 1.25;
        }
      } catch {
        total += haversineMeters(prev.lat, prev.lng, s.lat, s.lng) * 1.25;
      }
      prev = s;
    }
    if (total <= 0) break;
    const ratio = target / total;
    if (ratio > 0.88 && ratio < 1.15) return cur;
    // Scale ideal offsets by regenerating with adjusted target via radius factor
    const adjReq: TourRequest = {
      ...opts.req,
      pathSpec: {
        ...(opts.req.pathSpec ?? { loop: true }),
        distanceKm: (target * Math.min(1.35, Math.max(0.7, ratio))) / 1000,
        durationMin: opts.req.pathSpec?.durationMin ?? null,
        loop: opts.req.pathSpec?.loop ?? true,
      },
    };
    cur = buildPathWaypoints(adjReq, []);
  }
  return cur;
}
