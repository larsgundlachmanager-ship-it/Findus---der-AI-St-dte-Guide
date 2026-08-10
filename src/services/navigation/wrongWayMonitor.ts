/**
 * Wrong-way monitor — GPS path distance ONLY.
 * NEVER uses compass heading / device rotation.
 *
 * Regeln:
 * - Stehenbleiben → Stille (keine Warnung, kein Reroute)
 * - Erst nach ~10 m aktivem Laufen weg von der Route → eine klare Warnung
 * - Danach stiller Reroute (kein Nachtreten)
 */

import { distanceMeters } from './bearing';

const ON_ROUTE_M = 12;
/** Mindestens so weit von der Polyline weg. */
const OFF_PATH_MIN_M = 12;
/** User muss aktiv so weit in die falsche Richtung gelaufen sein. */
const ACTIVE_WRONG_WALK_M = 10;
/** Unter dieser Speed = stehen → nichts sagen. ~1,4 km/h */
const STANDING_MAX_MS = 0.4;
const HOLD_AFTER_WARN_BEFORE_REROUTE_MS = 8_000;
/** Extra Meter nach Warnung, bevor still neu geroutet wird. */
const EXTRA_WALK_AFTER_WARN_M = 8;
export const REROUTE_COOLDOWN_MS = 30_000;

export type WrongWayAction = 'none' | 'warn' | 'reroute';

type WrongWayState = {
  warnedAtMs: number | null;
  rerouteFired: boolean;
  lastRerouteAtMs: number | null;
  /** Meter, die der User seit Off-Route aktiv gelaufen ist. */
  walkedOffPathM: number;
  lastLat: number | null;
  lastLng: number | null;
  lastSampleAtMs: number | null;
};

let state: WrongWayState = {
  warnedAtMs: null,
  rerouteFired: false,
  lastRerouteAtMs: null,
  walkedOffPathM: 0,
  lastLat: null,
  lastLng: null,
  lastSampleAtMs: null,
};

export function resetWrongWayMonitor(): void {
  state = {
    warnedAtMs: null,
    rerouteFired: false,
    lastRerouteAtMs: null,
    walkedOffPathM: 0,
    lastLat: null,
    lastLng: null,
    lastSampleAtMs: null,
  };
}

export function canSilentReroute(nowMs = Date.now()): boolean {
  if (state.lastRerouteAtMs == null) return true;
  return nowMs - state.lastRerouteAtMs >= REROUTE_COOLDOWN_MS;
}

export function markRerouteFired(nowMs = Date.now()): void {
  state.lastRerouteAtMs = nowMs;
  state.warnedAtMs = null;
  state.rerouteFired = false;
  state.walkedOffPathM = 0;
  state.lastLat = null;
  state.lastLng = null;
  state.lastSampleAtMs = null;
}

/**
 * @returns what the nav loop should do this tick.
 */
export function tickWrongWayMonitor(opts: {
  distanceToPathM?: number | null;
  suppress?: boolean;
  nowMs?: number;
  speedMs?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Missed junction — nur relevant wenn User auch wirklich läuft. */
  missedTurn?: boolean;
  /** @deprecated Ignored */
  movementBearingDeg?: number | null;
  /** @deprecated Ignored */
  pathBearingDeg?: number | null;
}): WrongWayAction {
  const now = opts.nowMs ?? Date.now();
  if (opts.suppress) {
    resetWrongWayMonitor();
    return 'none';
  }

  if (!canSilentReroute(now)) {
    return 'none';
  }

  const speed =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? opts.speedMs
      : 0;

  // Stehenbleiben → komplett still (kein Reroute, keine Korrektur)
  if (speed < STANDING_MAX_MS) {
    state.lastLat = null;
    state.lastLng = null;
    state.lastSampleAtMs = null;
    return 'none';
  }

  const dist =
    typeof opts.distanceToPathM === 'number' &&
    Number.isFinite(opts.distanceToPathM)
      ? opts.distanceToPathM
      : null;
  if (dist == null) {
    return 'none';
  }

  // Wieder auf Route → Zähler zurück
  if (dist <= ON_ROUTE_M) {
    state.warnedAtMs = null;
    state.rerouteFired = false;
    state.walkedOffPathM = 0;
    state.lastLat = null;
    state.lastLng = null;
    state.lastSampleAtMs = null;
    return 'none';
  }

  // Noch zu nah an der Linie — GPS-Rauschen, nicht „falsche Richtung“
  if (dist < OFF_PATH_MIN_M && !opts.missedTurn) {
    return 'none';
  }

  const lat = opts.lat;
  const lng = opts.lng;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    if (
      state.lastLat != null &&
      state.lastLng != null &&
      state.lastSampleAtMs != null &&
      now - state.lastSampleAtMs < 8_000
    ) {
      const step = distanceMeters(state.lastLat, state.lastLng, lat, lng);
      // Nur sinnvolle Schritte (kein Teleport / GPS-Sprung)
      if (step > 0.5 && step < 25) {
        state.walkedOffPathM += step;
      }
    }
    state.lastLat = lat;
    state.lastLng = lng;
    state.lastSampleAtMs = now;
  } else {
    // Fallback ohne GPS-Punkt: grob aus Speed integrieren
    if (state.lastSampleAtMs != null) {
      const dt = Math.min(3, (now - state.lastSampleAtMs) / 1000);
      if (dt > 0.2) state.walkedOffPathM += speed * dt;
    }
    state.lastSampleAtMs = now;
  }

  // Noch keine 10 m aktiv falsch gelaufen → schweigen
  if (state.walkedOffPathM < ACTIVE_WRONG_WALK_M) {
    return 'none';
  }

  // Eine klare Warnung
  if (state.warnedAtMs == null) {
    state.warnedAtMs = now;
    return 'warn';
  }

  // Stiller Reroute: nach weiterer Bewegung oder kurzer Gnadenfrist
  if (!state.rerouteFired) {
    const walkedMore =
      state.walkedOffPathM >= ACTIVE_WRONG_WALK_M + EXTRA_WALK_AFTER_WARN_M;
    const waited =
      now - state.warnedAtMs >= HOLD_AFTER_WARN_BEFORE_REROUTE_MS;
    if (walkedMore || waited) {
      state.rerouteFired = true;
      return 'reroute';
    }
  }

  return 'none';
}

export const WRONG_WAY_OFF_ROUTE_M = OFF_PATH_MIN_M;
export const WRONG_WAY_MICRO_M = OFF_PATH_MIN_M;
export const WRONG_WAY_HOLD_MS = 0;
export const WRONG_WAY_REROUTE_AFTER_WARN_MS =
  HOLD_AFTER_WARN_BEFORE_REROUTE_MS;
export const WRONG_WAY_ACTIVE_WALK_M = ACTIVE_WRONG_WALK_M;

export function wasMicroDeviation(): boolean {
  return false;
}

export function getWrongWayWalkedM(): number {
  return state.walkedOffPathM;
}
