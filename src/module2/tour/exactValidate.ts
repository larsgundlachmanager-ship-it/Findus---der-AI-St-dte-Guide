/**
 * Exact Validate: echte Legs (Walk/Bike) + optional ÖPNV; max 3 Rebuilds.
 */

import { haversineMeters } from '../../db/database';
import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from '../../services/navigation/googleMapsNav';
import { coarseStopTour } from './coarsePlan';
import { buildPathWaypoints, scalePathToRoutedDistance } from './pathPlan';
import type {
  TourCandidate,
  TourLegPlan,
  TourRequest,
  TourStopPlan,
} from './types';

export const TOUR_BUFFER_MIN = 10;
export const TOUR_MAX_ATTEMPTS = 3;

function dirMode(req: TourRequest): 'walking' | 'bicycling' {
  return req.mobility === 'bike' ? 'bicycling' : 'walking';
}

async function legWalkOrBike(
  from: { lat: number; lng: number; name: string },
  to: { lat: number; lng: number; name: string },
  req: TourRequest,
): Promise<TourLegPlan> {
  const air = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  if (req.mobility === 'transit_ok' && air > 1200) {
    try {
      const transit = await tryTransitLeg(from, to);
      if (transit) return transit;
    } catch {
      /* fall through */
    }
  }
  try {
    const result = await fetchRouteDirectionsResult(
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
      dirMode(req),
    );
    if (result?.steps?.length) {
      const distanceM = walkingDistanceFromSteps(result.steps);
      const durationSec = Math.round(
        (distanceM / (req.mobility === 'bike' ? 250 : 80)) * 60,
      );
      return {
        fromName: from.name,
        toName: to.name,
        durationSec,
        distanceM,
        transport: req.mobility === 'bike' ? 'bike' : 'walk',
      };
    }
  } catch {
    /* soft */
  }
  const distanceM = Math.round(air * 1.3);
  const durationSec = Math.round(
    (distanceM / (req.mobility === 'bike' ? 250 : 80)) * 60,
  );
  return {
    fromName: from.name,
    toName: to.name,
    durationSec,
    distanceM,
    transport: req.mobility === 'bike' ? 'bike' : 'walk',
  };
}

async function tryTransitLeg(
  from: { lat: number; lng: number; name: string },
  to: { lat: number; lng: number; name: string },
): Promise<TourLegPlan | null> {
  // Heuristik + optional Live-Abfahrt vom nächsten Halt
  const air = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const journeyMin = Math.max(12, Math.round(air / 400) + 8);
  let line: string | null = null;
  let departAt: number | null = null;
  try {
    const { buildTransitAdvice } = require('../../services/transit/transitAdvisor') as {
      buildTransitAdvice: (t: string) => Promise<{
        departures?: Array<{ line: string; when: Date }>;
        journeyMinutes?: number | null;
      } | null>;
    };
    const advice = await buildTransitAdvice(
      `Verbindung nach ${to.name} mit Bus oder Bahn`,
    );
    const dep = advice?.departures?.find((d) => d.when.getTime() > Date.now());
    if (dep) {
      line = dep.line;
      departAt = dep.when.getTime();
    }
    if (advice?.journeyMinutes && advice.journeyMinutes > 0) {
      return {
        fromName: from.name,
        toName: to.name,
        durationSec: Math.round(advice.journeyMinutes * 60),
        distanceM: Math.round(air),
        transport: 'transit',
        transitLine: line,
        transitDepartAtMs: departAt,
      };
    }
  } catch {
    /* soft */
  }
  return {
    fromName: from.name,
    toName: to.name,
    durationSec: journeyMin * 60,
    distanceM: Math.round(air),
    transport: 'transit',
    transitLine: line,
    transitDepartAtMs: departAt,
  };
}

export async function measureTour(opts: {
  req: TourRequest;
  stops: TourStopPlan[];
}): Promise<{ legs: TourLegPlan[]; totalMin: number }> {
  const legs: TourLegPlan[] = [];
  let prev = {
    lat: opts.req.anchor.lat,
    lng: opts.req.anchor.lng,
    name: 'Start',
  };
  let totalSec = 0;
  for (const s of opts.stops) {
    const leg = await legWalkOrBike(prev, s, opts.req);
    legs.push(leg);
    totalSec += leg.durationSec + s.dwellMin * 60;
    prev = { lat: s.lat, lng: s.lng, name: s.name };
  }
  return { legs, totalMin: Math.round(totalSec / 60) };
}

function budgetMin(req: TourRequest): number {
  if (req.hardArriveByMs != null) {
    return Math.max(
      15,
      Math.round((req.hardArriveByMs - Date.now()) / 60_000) - TOUR_BUFFER_MIN,
    );
  }
  return req.timeBudgetMin ?? req.softDurationMin ?? 60;
}

function withinBudget(totalMin: number, budget: number, soft: boolean): boolean {
  if (soft) return totalMin <= budget + TOUR_BUFFER_MIN && totalMin >= budget - TOUR_BUFFER_MIN * 1.5;
  return totalMin <= budget;
}

export async function planWithRetries(opts: {
  req: TourRequest;
  ranked: TourCandidate[];
}): Promise<{
  stops: TourStopPlan[];
  legs: TourLegPlan[];
  totalMin: number;
  attempts: number;
  rest: TourCandidate[];
  softFail: boolean;
}> {
  const { req, ranked } = opts;
  const budget = budgetMin(req);
  const soft = req.hardArriveByMs == null;
  const drop = new Set<number>();
  let lastStops: TourStopPlan[] = [];
  let lastLegs: TourLegPlan[] = [];
  let lastTotal = 0;
  let rest: TourCandidate[] = ranked;
  let attempts = 0;

  for (let i = 0; i < TOUR_MAX_ATTEMPTS; i++) {
    attempts = i + 1;
    if (req.mode === 'path_tour') {
      let stops = buildPathWaypoints(req, ranked);
      stops = await scalePathToRoutedDistance({
        req,
        stops,
        signal: req.signal,
      });
      lastStops = stops;
      const measured = await measureTour({ req, stops });
      lastLegs = measured.legs;
      lastTotal = measured.totalMin;
      if (withinBudget(lastTotal, budget, soft) || i === TOUR_MAX_ATTEMPTS - 1) {
        return {
          stops: lastStops,
          legs: lastLegs,
          totalMin: lastTotal,
          attempts,
          rest: ranked,
          softFail: lastStops.length < 2,
        };
      }
      // shrink path
      req.pathSpec = {
        ...(req.pathSpec ?? { loop: true }),
        distanceKm:
          (req.pathSpec?.distanceKm ?? budget / 12) *
          (lastTotal > budget ? 0.85 : 1.1),
        durationMin: req.pathSpec?.durationMin ?? null,
        loop: req.pathSpec?.loop ?? true,
      };
      continue;
    }

    const coarse = coarseStopTour({ req, ranked, dropIds: drop });
    lastStops = coarse.stops;
    rest = coarse.rest;
    if (!lastStops.length) {
      return {
        stops: [],
        legs: [],
        totalMin: 0,
        attempts,
        rest,
        softFail: true,
      };
    }
    const measured = await measureTour({ req, stops: lastStops });
    lastLegs = measured.legs;
    lastTotal = measured.totalMin;
    if (withinBudget(lastTotal, budget, soft)) {
      return {
        stops: lastStops,
        legs: lastLegs,
        totalMin: lastTotal,
        attempts,
        rest,
        softFail: false,
      };
    }
    if (lastTotal > budget) {
      // drop lowest soft stop (not end anchor)
      const softIdx = [...lastStops]
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.priority === 'soft' && !s.waypoint)
        .sort((a, b) => a.s.dwellMin - b.s.dwellMin);
      const victim = softIdx[0];
      if (victim && victim.s.poiId > 0) {
        drop.add(victim.s.poiId);
      } else {
        // drop last non-must before end
        for (let j = lastStops.length - 1; j >= 0; j--) {
          const s = lastStops[j]!;
          if (s.priority !== 'must' && s.poiId > 0) {
            drop.add(s.poiId);
            break;
          }
        }
      }
    } else {
      // too short — allow denser by not dropping; insert from rest later in supervisor
      break;
    }
  }

  return {
    stops: lastStops,
    legs: lastLegs,
    totalMin: lastTotal,
    attempts,
    rest,
    softFail: lastStops.length < 1,
  };
}
