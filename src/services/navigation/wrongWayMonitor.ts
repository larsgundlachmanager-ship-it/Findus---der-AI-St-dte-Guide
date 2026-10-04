/**
 * Wrong-way monitor — GPS path distance ONLY.
 * NEVER uses compass heading / device rotation.
 *
 * Regeln:
 * - Stehenbleiben → Stille (keine Warnung, kein Reroute)
 * - Weit von der Route + aktiv unterwegs → genau eine Warnung (Route bleibt)
 * - Noch ~10 m weiter weg → ein Recalc (kein Dauer-Spam)
 * - Klar verlaufen (sehr weit ab) → sofort Recalc ohne Warn-Delay
 */

import { distanceMeters } from './bearing';

const ON_ROUTE_M = 22;
/** Default Off-Path (Fuß). Caller kann bike ~90 m via offPathMinM setzen. */
const OFF_PATH_MIN_M = 48;
/** Vor der Warnung: so weit aktiv weg von der Route. */
const ACTIVE_WRONG_WALK_M = 28;
/** Nach Warnung: noch so weit weiter → dann Recalc. */
const AFTER_WARN_BEFORE_REROUTE_M = 10;
/** Klar verlaufen: sofort neu rechnen (zurückbringen via neue Linie). */
const FAR_OFF_IMMEDIATE_REROUTE_M = 110;
/** Unter dieser Speed = stehen → nichts sagen. ~1,4 km/h */
const STANDING_MAX_MS = 0.4;
/** Mindesthalt nach Warnung (auch wenn schon 10 m), gegen Sofort-Doppeltrigger. */
const HOLD_AFTER_WARN_BEFORE_REROUTE_MS = 1_200;
export const REROUTE_COOLDOWN_MS = 35_000;
/** Nach fehlgeschlagenem Reroute erneut versuchen. */
const REROUTE_RETRY_MS = 10_000;

export type WrongWayAction = 'none' | 'warn' | 'reroute';

type WrongWayState = {
  warnedAtMs: number | null;
  rerouteFired: boolean;
  lastRerouteAtMs: number | null;
  lastRerouteAttemptAtMs: number | null;
  /** Meter, die der User seit Off-Route aktiv gelaufen ist. */
  walkedOffPathM: number;
  /** Meter nach der Warnung weiter weg. */
  walkedAfterWarnM: number;
  lastLat: number | null;
  lastLng: number | null;
  lastSampleAtMs: number | null;
};

let state: WrongWayState = {
  warnedAtMs: null,
  rerouteFired: false,
  lastRerouteAtMs: null,
  lastRerouteAttemptAtMs: null,
  walkedOffPathM: 0,
  walkedAfterWarnM: 0,
  lastLat: null,
  lastLng: null,
  lastSampleAtMs: null,
};

export function resetWrongWayMonitor(): void {
  state = {
    warnedAtMs: null,
    rerouteFired: false,
    lastRerouteAtMs: null,
    lastRerouteAttemptAtMs: null,
    walkedOffPathM: 0,
    walkedAfterWarnM: 0,
    lastLat: null,
    lastLng: null,
    lastSampleAtMs: null,
  };
}

export function canSilentReroute(nowMs = Date.now()): boolean {
  if (state.lastRerouteAtMs == null) return true;
  return nowMs - state.lastRerouteAtMs >= REROUTE_COOLDOWN_MS;
}

/** Erfolgreicher Reroute — Episode zu, Cooldown starten. */
export function markRerouteFired(nowMs = Date.now()): void {
  state.lastRerouteAtMs = nowMs;
  state.lastRerouteAttemptAtMs = nowMs;
  state.warnedAtMs = null;
  state.rerouteFired = false;
  state.walkedOffPathM = 0;
  state.walkedAfterWarnM = 0;
  state.lastLat = null;
  state.lastLng = null;
  state.lastSampleAtMs = null;
}

/** Reroute gestartet (nach Warnung) — kein zweites Audio, kein Parallel-Trigger. */
export function markRerouteAttemptStarted(nowMs = Date.now()): void {
  state.rerouteFired = true;
  state.lastRerouteAttemptAtMs = nowMs;
}

/**
 * Reroute-Versuch fehlgeschlagen — darf nach kurzer Pause erneut feuern,
 * ohne nochmal zu warnen.
 */
export function markRerouteAttemptFailed(nowMs = Date.now()): void {
  state.lastRerouteAttemptAtMs = nowMs;
  state.rerouteFired = false;
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
  /** Mode-aware Off-Path (z. B. Bike 90 m). */
  offPathMinM?: number | null;
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

  const offPathMin =
    typeof opts.offPathMinM === 'number' &&
    Number.isFinite(opts.offPathMinM) &&
    opts.offPathMinM > 0
      ? opts.offPathMinM
      : OFF_PATH_MIN_M;

  // Wieder auf Route → Episode zu (auch nach Warnung, wenn User selbst korrigiert)
  if (dist <= ON_ROUTE_M) {
    state.warnedAtMs = null;
    state.rerouteFired = false;
    state.lastRerouteAttemptAtMs = null;
    state.walkedOffPathM = 0;
    state.walkedAfterWarnM = 0;
    state.lastLat = null;
    state.lastLng = null;
    state.lastSampleAtMs = null;
    return 'none';
  }

  // Noch zu nah an der Linie — GPS-Rauschen, nicht „falsche Richtung“
  if (dist < offPathMin && !opts.missedTurn) {
    return 'none';
  }

  // Klar verlaufen → sofort neu berechnen (kein Warn-Wait)
  if (
    dist >= FAR_OFF_IMMEDIATE_REROUTE_M &&
    canSilentReroute(now) &&
    !state.rerouteFired
  ) {
    state.warnedAtMs = state.warnedAtMs ?? now;
    state.rerouteFired = true;
    state.lastRerouteAttemptAtMs = now;
    return 'reroute';
  }

  const lat = opts.lat;
  const lng = opts.lng;
  const maxStepM = Math.max(25, speed * 4 + 8);
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
      if (step > 0.5 && step < maxStepM) {
        state.walkedOffPathM += step;
        if (state.warnedAtMs != null) {
          state.walkedAfterWarnM += step;
        }
      }
    }
    state.lastLat = lat;
    state.lastLng = lng;
    state.lastSampleAtMs = now;
  } else {
    // Fallback ohne GPS-Punkt: grob aus Speed integrieren
    if (state.lastSampleAtMs != null) {
      const dt = Math.min(3, (now - state.lastSampleAtMs) / 1000);
      if (dt > 0.2) {
        const add = speed * dt;
        state.walkedOffPathM += add;
        if (state.warnedAtMs != null) {
          state.walkedAfterWarnM += add;
        }
      }
    }
    state.lastSampleAtMs = now;
  }

  // Noch nicht weit genug aktiv falsch → schweigen
  if (state.walkedOffPathM < ACTIVE_WRONG_WALK_M && state.warnedAtMs == null) {
    return 'none';
  }

  // Genau eine klare Warnung pro Off-Route-Episode — Route bleibt auf der Karte
  if (state.warnedAtMs == null) {
    if (!canSilentReroute(now)) {
      return 'none';
    }
    state.warnedAtMs = now;
    state.walkedAfterWarnM = 0;
    return 'warn';
  }

  // Recalc erst nach ~10 m weiter weg (+ kurze Hold)
  if (!state.rerouteFired) {
    const waited =
      now - state.warnedAtMs >= HOLD_AFTER_WARN_BEFORE_REROUTE_MS;
    const walkedEnough =
      state.walkedAfterWarnM >= AFTER_WARN_BEFORE_REROUTE_M;
    const retryOk =
      state.lastRerouteAttemptAtMs == null ||
      now - state.lastRerouteAttemptAtMs >= REROUTE_RETRY_MS;
    if (waited && walkedEnough && retryOk && canSilentReroute(now)) {
      state.rerouteFired = true;
      state.lastRerouteAttemptAtMs = now;
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
export const WRONG_WAY_AFTER_WARN_REROUTE_M = AFTER_WARN_BEFORE_REROUTE_M;

export function wasMicroDeviation(): boolean {
  return false;
}

export function getWrongWayWalkedM(): number {
  return state.walkedOffPathM;
}
