/**
 * Seamless walking ↔ ÖPNV transition:
 * walk_to_stop → in_transit → post_transit_walk
 */

import type { NavPhase, TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';
import { distanceMeters } from './bearing';

export type { NavPhase };

type BoardingState = {
  phase: NavPhase;
  /** Nearest upcoming station for walk-to-stop. */
  nextStation: { lat: number; lng: number; name: string } | null;
  boardedAtMs: number | null;
  alightedAtMs: number | null;
};

let state: BoardingState = {
  phase: 'idle',
  nextStation: null,
  boardedAtMs: null,
  alightedAtMs: null,
};

export function resetBoardingDetector(): void {
  state = {
    phase: 'idle',
    nextStation: null,
    boardedAtMs: null,
    alightedAtMs: null,
  };
}

export function getNavPhase(): NavPhase {
  return state.phase;
}

/**
 * Update phase from GPS + transport mode + station chain.
 * - Near departure station + walking → walk_to_stop
 * - Speed jumps to transit OR leave station while transit mode → in_transit
 * - Arrival station proximity + walk speed → post_transit_walk
 */
export function tickBoardingDetector(opts: {
  lat: number;
  lng: number;
  transportMode: TransportMode;
  speedMs: number;
  stations: Array<{ lat: number; lng: number; name?: string | null }>;
  /** Remaining stations including destination. */
  remainingStations: number | null;
  hasTransitLegs: boolean;
}): NavPhase {
  if (!opts.hasTransitLegs) {
    state.phase = 'walk';
    state.nextStation = null;
    return state.phase;
  }

  const stations = opts.stations;
  if (!stations.length) {
    state.phase = isTransitMode(opts.transportMode) ? 'in_transit' : 'walk';
    return state.phase;
  }

  // Find nearest not-yet-passed station
  let nearest: { lat: number; lng: number; name: string; d: number } | null =
    null;
  for (const s of stations) {
    const d = distanceMeters(opts.lat, opts.lng, s.lat, s.lng);
    if (!nearest || d < nearest.d) {
      nearest = {
        lat: s.lat,
        lng: s.lng,
        name: (s.name ?? 'Haltestelle').trim(),
        d,
      };
    }
  }
  state.nextStation = nearest
    ? { lat: nearest.lat, lng: nearest.lng, name: nearest.name }
    : null;

  const nearStation = nearest != null && nearest.d <= 55;
  /** Boarding nur bei klarer Transit-Geschwindigkeit UND nicht mehr am Bahnhof. */
  const clearlyMovingOnTransit =
    isTransitMode(opts.transportMode) && opts.speedMs >= 5.5;
  const leftStationOnTransit =
    isTransitMode(opts.transportMode) &&
    !nearStation &&
    opts.speedMs >= 4.0 &&
    nearest != null &&
    nearest.d > 80;
  const walkingPace = opts.speedMs < 2.2;

  if (state.phase === 'idle' || state.phase === 'walk') {
    state.phase = 'walk_to_stop';
  }

  if (state.phase === 'walk_to_stop') {
    // Boarded: erst wenn wirklich unterwegs auf der Linie — nie am Gleis/Bahnhof
    if (clearlyMovingOnTransit || leftStationOnTransit) {
      state.phase = 'in_transit';
      state.boardedAtMs = Date.now();
    }
  } else if (state.phase === 'in_transit') {
    // Alighted: last station / walking again near a stop
    const lastStops =
      opts.remainingStations != null && opts.remainingStations <= 1;
    if (walkingPace && nearStation && (lastStops || opts.speedMs < 1.5)) {
      state.phase = 'post_transit_walk';
      state.alightedAtMs = Date.now();
    } else if (walkingPace && !isTransitMode(opts.transportMode) && nearStation) {
      state.phase = 'post_transit_walk';
      state.alightedAtMs = Date.now();
    }
  } else if (state.phase === 'post_transit_walk') {
    // Stay in walk guidance; if they board again, re-enter transit
    if (clearlyMovingOnTransit || leftStationOnTransit) {
      state.phase = 'in_transit';
      state.boardedAtMs = Date.now();
    }
  }

  return state.phase;
}

/** Pause turn-by-turn voice while in_transit (station countdown still allowed). */
export function shouldPauseTurnByTurn(phase: NavPhase): boolean {
  return phase === 'in_transit';
}

export function getBoardingNextStation(): {
  lat: number;
  lng: number;
  name: string;
} | null {
  return state.nextStation;
}
