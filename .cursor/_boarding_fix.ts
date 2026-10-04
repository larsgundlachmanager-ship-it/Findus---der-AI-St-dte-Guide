/**
 * Seamless walking ↔ ÖPNV transition:
 * walk_to_stop → in_transit → post_transit_walk
 *
 * Ausstieg: Stillstand/Dwell am Zielhalt (nicht nur Ankunftsradius),
 * dünne Stationenkette → Alight-Koordinaten als Fallback.
 */

import type { NavPhase, TransportMode } from './navigationTypes';
import { distanceMeters } from './bearing';

export type { NavPhase };

function isTransitModeLocal(mode: TransportMode): boolean {
  return mode === 'transit_bus' || mode === 'transit_train';
}

/** Stillstand vor Ausstieg-Phase (Türen/Verlassen). */
export const ALIGHT_DWELL_MS = 6_000;
/** Fuß-Tempo klar unter Transit. */
export const ALIGHT_WALK_MPS = 2.2;
/** Fast Stillstand (Bahn hält / ausgestiegen). */
export const ALIGHT_STILL_MPS = 1.0;
/** Nähe Haltestelle bei guter Stationenkette. */
export const NEAR_STATION_M = 55;
/** Nähe Ausstiegsziel bei dünner Kette / GPS-Wackeln. */
export const NEAR_ALIGHT_DEST_M = 95;

type BoardingState = {
  phase: NavPhase;
  nextStation: { lat: number; lng: number; name: string } | null;
  boardedAtMs: number | null;
  alightedAtMs: number | null;
  dwellStillStartedAtMs: number | null;
  /** Nach Ausstieg: einmal Auto-Advance zum Fuß-Umstieg anfordern. */
  alightAdvancePending: boolean;
};

let state: BoardingState = {
  phase: 'idle',
  nextStation: null,
  boardedAtMs: null,
  alightedAtMs: null,
  dwellStillStartedAtMs: null,
  alightAdvancePending: false,
};

export function resetBoardingDetector(): void {
  state = {
    phase: 'idle',
    nextStation: null,
    boardedAtMs: null,
    alightedAtMs: null,
    dwellStillStartedAtMs: null,
    alightAdvancePending: false,
  };
}

export function getNavPhase(): NavPhase {
  return state.phase;
}

export function getAlightedAtMs(): number | null {
  return state.alightedAtMs;
}

/** Einmal abholen: true wenn gerade Ausstieg→Fuß-Advance fällig. */
export function takeAlightAdvancePending(): boolean {
  if (!state.alightAdvancePending) return false;
  state.alightAdvancePending = false;
  return true;
}

export type AlightReadyReason =
  | 'dwell_near_alight'
  | 'walk_near_last'
  | 'walk_mode_near'
  | 'none';

/**
 * Pure: bin ich bereit für post_transit_walk?
 * Stillstand ≥ ALIGHT_DWELL_MS am Ausstieg ODER klar zu Fuß am letzten Halt.
 */
export function assessAlightReady(opts: {
  speedMs: number;
  remainingStations: number | null;
  nearStation: boolean;
  nearAlightDest: boolean;
  dwellStillMs: number;
  transportIsTransit: boolean;
}): { ready: boolean; reason: AlightReadyReason } {
  const lastStops =
    opts.remainingStations == null || opts.remainingStations <= 1;
  const near = opts.nearStation || opts.nearAlightDest;
  if (!near || !lastStops) {
    return { ready: false, reason: 'none' };
  }

  // Fast Stillstand: erst nach Dwell — sonst warten (Bahn hält / Türen).
  if (opts.speedMs < ALIGHT_STILL_MPS) {
    if (opts.dwellStillMs >= ALIGHT_DWELL_MS) {
      return { ready: true, reason: 'dwell_near_alight' };
    }
    return { ready: false, reason: 'none' };
  }

  const walking = opts.speedMs < ALIGHT_WALK_MPS;
  if (walking && opts.nearStation && lastStops) {
    return { ready: true, reason: 'walk_near_last' };
  }
  if (walking && !opts.transportIsTransit && near) {
    return { ready: true, reason: 'walk_mode_near' };
  }
  return { ready: false, reason: 'none' };
}

/**
 * Update phase from GPS + transport mode + station chain + optional alight dest.
 */
export function tickBoardingDetector(opts: {
  lat: number;
  lng: number;
  transportMode: TransportMode;
  speedMs: number;
  stations: Array<{ lat: number; lng: number; name?: string | null }>;
  remainingStations: number | null;
  hasTransitLegs: boolean;
  /** Ausstiegs-Koordinaten (Tour-Alight / Nav-Ziel) — Fallback bei dünner Kette. */
  alightLat?: number | null;
  alightLng?: number | null;
  nowMs?: number;
}): NavPhase {
  const now = opts.nowMs ?? Date.now();

  if (!opts.hasTransitLegs) {
    state.phase = 'walk';
    state.nextStation = null;
    state.dwellStillStartedAtMs = null;
    return state.phase;
  }

  const stations = opts.stations;
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

  // Dünne Kette: Alight-Ziel als „Station“ mitzählen.
  const thinChain = stations.length <= 1;
  let alightDist: number | null = null;
  if (
    opts.alightLat != null &&
    opts.alightLng != null &&
    Number.isFinite(opts.alightLat) &&
    Number.isFinite(opts.alightLng)
  ) {
    alightDist = distanceMeters(
      opts.lat,
      opts.lng,
      opts.alightLat,
      opts.alightLng,
    );
    if (!nearest || (thinChain && alightDist < nearest.d)) {
      nearest = {
        lat: opts.alightLat,
        lng: opts.alightLng,
        name: nearest?.name ?? 'Ausstieg',
        d: alightDist,
      };
    }
  }

  if (!stations.length && alightDist == null) {
    state.phase = isTransitModeLocal(opts.transportMode) ? 'in_transit' : 'walk';
    state.nextStation = null;
    return state.phase;
  }

  state.nextStation = nearest
    ? { lat: nearest.lat, lng: nearest.lng, name: nearest.name }
    : null;

  const nearStation = nearest != null && nearest.d <= NEAR_STATION_M;
  const nearAlightDest =
    alightDist != null &&
    alightDist <= (thinChain ? NEAR_ALIGHT_DEST_M : NEAR_STATION_M + 25);

  const clearlyMovingOnTransit =
    isTransitModeLocal(opts.transportMode) && opts.speedMs >= 5.5;
  const leftStationOnTransit =
    isTransitModeLocal(opts.transportMode) &&
    !nearStation &&
    !nearAlightDest &&
    opts.speedMs >= 4.0 &&
    nearest != null &&
    nearest.d > 80;

  // Dwell-Uhr: Stillstand zählen, sonst reset.
  if (opts.speedMs < ALIGHT_STILL_MPS) {
    if (state.dwellStillStartedAtMs == null) {
      state.dwellStillStartedAtMs = now;
    }
  } else {
    state.dwellStillStartedAtMs = null;
  }
  const dwellStillMs =
    state.dwellStillStartedAtMs != null
      ? now - state.dwellStillStartedAtMs
      : 0;

  if (state.phase === 'idle' || state.phase === 'walk') {
    state.phase = 'walk_to_stop';
  }

  if (state.phase === 'walk_to_stop') {
    if (clearlyMovingOnTransit || leftStationOnTransit) {
      state.phase = 'in_transit';
      state.boardedAtMs = now;
      state.dwellStillStartedAtMs = null;
    }
  } else if (state.phase === 'in_transit') {
    const alight = assessAlightReady({
      speedMs: opts.speedMs,
      remainingStations: opts.remainingStations,
      nearStation,
      nearAlightDest,
      dwellStillMs,
      transportIsTransit: isTransitModeLocal(opts.transportMode),
    });
    if (alight.ready) {
      state.phase = 'post_transit_walk';
      state.alightedAtMs = now;
      state.alightAdvancePending = true;
      state.dwellStillStartedAtMs = null;
    }
  } else if (state.phase === 'post_transit_walk') {
    if (clearlyMovingOnTransit || leftStationOnTransit) {
      state.phase = 'in_transit';
      state.boardedAtMs = now;
      state.alightAdvancePending = false;
    }
  }

  return state.phase;
}

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
