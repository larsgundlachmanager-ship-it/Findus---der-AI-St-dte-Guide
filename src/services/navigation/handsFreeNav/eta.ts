/**
 * Route-only ETA: never air-line for user-visible minutes.
 * Pace: profile average until 1 km active distance, then user cruise.
 */

import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../../mobility/paceProfile';
import type { PaceSample } from './types';

export const PACE_SWITCH_ACTIVE_M = 1000;
const WALK_MOVING_MPS = 0.6;
const BIKE_MOVING_MPS = 2.0;
const DWELL_STILL_MS = 12_000;
const CRUISE_WINDOW = 24;

let activeDistanceM = 0;
let lastSampleAtMs: number | null = null;
let lastLat: number | null = null;
let lastLng: number | null = null;
let dwellStartedAtMs: number | null = null;
const cruiseSamples: number[] = [];
let mode: 'walk' | 'bike' = 'walk';

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function resetHandsFreeEta(transport: 'walk' | 'bike' = 'walk'): void {
  activeDistanceM = 0;
  lastSampleAtMs = null;
  lastLat = null;
  lastLng = null;
  dwellStartedAtMs = null;
  cruiseSamples.length = 0;
  mode = transport;
}

export function noteHandsFreeEtaGps(opts: {
  lat: number;
  lng: number;
  speedMps: number | null;
  atMs?: number;
  isBike?: boolean;
}): PaceSample {
  if (opts.isBike) mode = 'bike';
  const now = opts.atMs ?? Date.now();
  const minMps = mode === 'bike' ? BIKE_MOVING_MPS : WALK_MOVING_MPS;
  const speed =
    typeof opts.speedMps === 'number' && Number.isFinite(opts.speedMps)
      ? Math.max(0, opts.speedMps)
      : 0;

  if (lastLat != null && lastLng != null && lastSampleAtMs != null) {
    const dt = Math.max(0, (now - lastSampleAtMs) / 1000);
    const moved = haversineM(lastLat, lastLng, opts.lat, opts.lng);
    if (speed >= minMps && moved < 80) {
      activeDistanceM += moved;
      dwellStartedAtMs = null;
      if (dt > 0.4 && dt < 8) {
        const sample = moved / dt;
        if (sample >= minMps && sample < (mode === 'bike' ? 18 : 3.5)) {
          cruiseSamples.push(sample);
          if (cruiseSamples.length > CRUISE_WINDOW) cruiseSamples.shift();
        }
      }
    } else if (speed < minMps * 0.5) {
      if (dwellStartedAtMs == null) dwellStartedAtMs = now;
    }
  }

  lastLat = opts.lat;
  lastLng = opts.lng;
  lastSampleAtMs = now;

  const moving = speed >= minMps;
  return { atMs: now, speedMps: speed, moving };
}

export function getActiveDistanceM(): number {
  return activeDistanceM;
}

export function isInDwell(nowMs = Date.now()): boolean {
  return dwellStartedAtMs != null && nowMs - dwellStartedAtMs >= DWELL_STILL_MS;
}

/** m/min used for ETA. */
export function resolveCruisePaceMPerMin(): {
  mPerMin: number;
  source: 'profile' | 'user_cruise';
} {
  const profile =
    mode === 'bike' ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
  if (activeDistanceM < PACE_SWITCH_ACTIVE_M || cruiseSamples.length < 5) {
    return { mPerMin: Math.max(20, profile), source: 'profile' };
  }
  const avgMps =
    cruiseSamples.reduce((a, b) => a + b, 0) / cruiseSamples.length;
  const mPerMin = Math.round(avgMps * 60);
  return { mPerMin: Math.max(20, mPerMin), source: 'user_cruise' };
}

/**
 * User-visible ETA from remaining route meters + light buffer.
 * Never use air-line distance here.
 */
export function etaMinutesFromRoute(opts: {
  remainingRouteM: number;
  lightBufferMin?: number;
  weatherMultiplier?: number;
}): {
  etaMin: number;
  paceSource: 'profile' | 'user_cruise';
  mPerMin: number;
} {
  const { mPerMin, source } = resolveCruisePaceMPerMin();
  const rem = Math.max(0, opts.remainingRouteM);
  const weather = opts.weatherMultiplier ?? 1;
  const lights = Math.max(0, opts.lightBufferMin ?? 0);
  const base = rem > 0 ? rem / Math.max(20, mPerMin) : 0;
  const etaMin = Math.max(1, Math.ceil(base * weather + lights));
  return { etaMin, paceSource: source, mPerMin };
}

/** Initial ETA right after OSRM/Google (provider duration preferred). */
export function initialEtaFromRoutedDistanceM(
  distanceM: number,
  opts?: {
    isBike?: boolean;
    lightBufferMin?: number;
    /** Google/OSRM duration — Maps-Baseline bevor Pace greift */
    providerDurationSec?: number | null;
  },
): number {
  const lights = Math.max(0, opts?.lightBufferMin ?? 0);
  const providerSec =
    typeof opts?.providerDurationSec === 'number' &&
    Number.isFinite(opts.providerDurationSec) &&
    opts.providerDurationSec > 0
      ? opts.providerDurationSec
      : null;

  if (providerSec != null && !opts?.isBike) {
    let baseMin = Math.max(1, Math.ceil(providerSec / 60));
    try {
      const {
        hasLearnedPace,
        getPlanWalkKmhForSpeech,
      } = require('../../mobility/paceProfile') as {
        hasLearnedPace: (m?: 'walk' | 'bike') => boolean;
        getPlanWalkKmhForSpeech: () => number;
      };
      if (hasLearnedPace('walk') && distanceM > 40) {
        const impliedKmh = distanceM / 1000 / (providerSec / 3600);
        const userKmh = getPlanWalkKmhForSpeech();
        if (impliedKmh > 0.8 && userKmh > 0.8) {
          const ratio = impliedKmh / userKmh;
          // Nur langsamer als Maps — nie unter Provider-Minuten drücken
          if (ratio > 1.08) {
            baseMin = Math.max(1, Math.ceil(baseMin * ratio));
          }
        }
      }
    } catch {
      /* soft */
    }
    return Math.max(1, baseMin + lights);
  }

  const mPerMin = opts?.isBike ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
  return Math.max(1, Math.ceil(distanceM / Math.max(20, mPerMin) + lights));
}
