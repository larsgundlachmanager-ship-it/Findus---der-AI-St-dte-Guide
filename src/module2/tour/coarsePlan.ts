/**
 * Grobplan: Nearest-Neighbor / Zeitbudget auf Luftlinie + Dwell.
 */

import { haversineMeters } from '../../db/database';
import { estimateDwellForCandidate } from './dwellEstimates';
import type {
  TourCandidate,
  TourRequest,
  TourStopPlan,
} from './types';

function walkMinAir(m: number, mPerMin: number): number {
  return Math.max(1, Math.round(m / Math.max(40, mPerMin)));
}

function paceMPerMin(req: TourRequest): number {
  try {
    const pace = require('../../services/mobility/paceProfile') as {
      getPlanWalkMPerMin: () => number;
      getPlanBikeMPerMin: () => number;
    };
    if (req.mobility === 'bike') return pace.getPlanBikeMPerMin();
    return pace.getPlanWalkMPerMin();
  } catch {
    return req.mobility === 'bike' ? 250 : 80;
  }
}

export function coarseStopTour(opts: {
  req: TourRequest;
  ranked: TourCandidate[];
  dropIds?: Set<number>;
}): { stops: TourStopPlan[]; rest: TourCandidate[] } {
  const { req, ranked } = opts;
  const drop = opts.dropIds ?? new Set<number>();
  const buffer = 10;
  const budget =
    req.timeBudgetMin ??
    req.softDurationMin ??
    (req.hardArriveByMs != null
      ? Math.max(
          15,
          Math.round((req.hardArriveByMs - Date.now()) / 60_000) - buffer,
        )
      : 60);
  const usable = Math.max(10, budget - buffer);
  const mPerMin = paceMPerMin(req);
  const denser = req.prefs.denserStops === true;
  const maxStops = denser ? 8 : 5;

  const remaining = ranked.filter((c) => !drop.has(c.poiId));
  const picked: TourStopPlan[] = [];
  let cur = { ...req.anchor };
  let usedMin = 0;
  const usedIds = new Set<number>();

  while (picked.length < maxStops && remaining.length) {
    remaining.sort(
      (a, b) =>
        haversineMeters(cur.lat, cur.lng, a.lat, a.lng) / Math.max(1, a.score) -
        haversineMeters(cur.lat, cur.lng, b.lat, b.lng) / Math.max(1, b.score),
    );
    // Prefer higher score among near candidates
    const near = remaining
      .slice()
      .sort((a, b) => {
        const da = haversineMeters(cur.lat, cur.lng, a.lat, a.lng);
        const db = haversineMeters(cur.lat, cur.lng, b.lat, b.lng);
        if (da < 600 && db < 600) return b.score - a.score;
        return da - db;
      });
    const next = near.find((c) => !usedIds.has(c.poiId));
    if (!next) break;
    const legM = haversineMeters(cur.lat, cur.lng, next.lat, next.lng);
    const legMin = walkMinAir(legM, mPerMin);
    const dwell = estimateDwellForCandidate(next);
    const endLeg =
      req.endAnchor != null
        ? walkMinAir(
            haversineMeters(
              next.lat,
              next.lng,
              req.endAnchor.lat,
              req.endAnchor.lng,
            ),
            mPerMin,
          )
        : 0;
    if (usedMin + legMin + dwell + endLeg > usable && picked.length >= 1) {
      // try skip low prio
      if (next.priority === 'soft') {
        usedIds.add(next.poiId);
        const idx = remaining.findIndex((r) => r.poiId === next.poiId);
        if (idx >= 0) remaining.splice(idx, 1);
        continue;
      }
      break;
    }
    picked.push({
      poiId: next.poiId,
      name: next.name,
      lat: next.lat,
      lng: next.lng,
      dwellMin: dwell,
      priority: next.priority,
    });
    usedIds.add(next.poiId);
    usedMin += legMin + dwell;
    cur = { lat: next.lat, lng: next.lng };
    const idx = remaining.findIndex((r) => r.poiId === next.poiId);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  if (req.endAnchor) {
    picked.push({
      poiId: req.endAnchor.poiId ?? -9001,
      name: req.endAnchor.name ?? 'Ziel',
      lat: req.endAnchor.lat,
      lng: req.endAnchor.lng,
      dwellMin: 0,
      priority: 'must',
    });
  }

  const rest = ranked.filter((c) => !usedIds.has(c.poiId) && !drop.has(c.poiId));
  return { stops: picked, rest };
}
