# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ww = ROOT / "src/services/navigation/wrongWayMonitor.ts"
ww.write_text(
    r'''/**
 * Wrong-way monitor — GPS path distance ONLY.
 * NEVER uses compass heading / device rotation.
 *
 * Regeln:
 * - Stehenbleiben → Stille (keine Warnung, kein Reroute)
 * - Weit von der Route + aktiv unterwegs → genau eine Warnung (Route bleibt)
 * - Noch ~10 m weiter weg → ein Recalc (kein Dauer-Spam)
 */

import { distanceMeters } from './bearing';

const ON_ROUTE_M = 18;
/** Default Off-Path (Fuß). Caller kann bike ~90 m via offPathMinM setzen. */
const OFF_PATH_MIN_M = 32;
/** Vor der Warnung: so weit aktiv weg von der Route. */
const ACTIVE_WRONG_WALK_M = 18;
/** Nach Warnung: noch so weit weiter → dann Recalc. */
const AFTER_WARN_BEFORE_REROUTE_M = 10;
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
''',
    encoding="utf-8",
)
print("wrote wrongWayMonitor")

# --- navigationService patches ---
nav = ROOT / "src/services/navigation/navigationService.ts"
t = nav.read_text(encoding="utf-8")

# Pass offPathMinM into wrongWay
old_ww = """  const wrongWayAction = tickWrongWayMonitor({
    distanceToPathM: tick.distanceToPathM ?? null,
    suppress:
      isTransitMode(tick.transportMode) || tick.navPhase === 'in_transit',
    speedMs: tick.speedMs,
    missedTurn: missed.missed,
    lat: lastLat,
    lng: lastLng,
  });"""
new_ww = """  const wrongWayAction = tickWrongWayMonitor({
    distanceToPathM: tick.distanceToPathM ?? null,
    suppress:
      isTransitMode(tick.transportMode) || tick.navPhase === 'in_transit',
    speedMs: tick.speedMs,
    missedTurn: missed.missed,
    lat: lastLat,
    lng: lastLng,
    offPathMinM: offRouteThresholdM(tick.transportMode),
  });"""
if "offPathMinM: offRouteThresholdM" not in t:
    if old_ww not in t:
        raise SystemExit("wrongWay call not found")
    t = t.replace(old_ww, new_ww, 1)
    print("wrongWay call patched")
else:
    print("wrongWay call already")

# Ensure offRouteThresholdM is imported
if "offRouteThresholdM" not in t.split("tickWrongWayMonitor")[0]:
    # find transportMode import
    import re
    m = re.search(r"from ['\"]\\./transportMode['\"];", t)
    if not m:
        # maybe named import already
        if "from './transportMode'" in t or 'from "./transportMode"' in t:
            pass
    # Check if already imported in import list
    if "offRouteThresholdM" not in t[:8000]:
        # try common import pattern
        for pat in [
            "classifyMotionTransportMode,",
            "directionsModeForNav,",
            "isTransitMode,",
        ]:
            if pat in t and "offRouteThresholdM" not in t[:12000]:
                t = t.replace(pat, pat + "\n  offRouteThresholdM,", 1)
                print("added offRouteThresholdM import near", pat)
                break
        else:
            print("WARN: could not add offRouteThresholdM import automatically")

# Remove shortcut + near-pin + implausible detour blocks — replace with comment lock
# Find from "else if (active &&" shortcut through end of implausible block
marker_start = """  } else if (
    active &&
    !isTransitMode(tick.transportMode) &&
    tick.navPhase !== 'in_transit' &&
    (tick.speedMs ?? 0) >= 0.45 &&
    (tick.distanceToPathM ?? 0) > 45 &&
    tick.distanceToDestinationM + 30 <
      Math.max(60, (navTotalDistanceM ?? tick.distanceToDestinationM) * 0.85)
  ) {"""

if "Route-Lock: kein Shortcut" in t:
    print("route lock already")
elif marker_start in t:
    # Find the mode switch block that follows — keep mode switch
    mode_marker = "  // Fuß ↔ Rad (≥ ~10 km/h): automatisch Radmodus + Route neu auf Radwegen"
    i0 = t.find(marker_start)
    i1 = t.find(mode_marker)
    if i0 < 0 or i1 < 0 or i1 <= i0:
        raise SystemExit(f"lock slice markers fail {i0} {i1}")
    # Keep the closing of wrong-way reroute branch: we start at "} else if" which replaces
    # the shortcut after wrong-way. Need to close the wrong-way if/else properly.
    # Currently structure:
    # if warn ...
    # else if reroute ...
    # else if shortcut ...
    # // near pin
    # // implausible
    # // Fuß ↔ Rad
    # So replace from "} else if (shortcut" through just before Fuß↔Rad with just "}" ending the if-chain
    # Actually after reroute we have "} else if (shortcut..." — we want just "}" after reroute block.
    # Find end of reroute block first
    reroute_end = """  } else if (wrongWayAction === 'reroute' && active) {
    markRerouteAttemptStarted();
    void silentRecalculateRoute({ announce: true });
  }"""
    if reroute_end not in t:
        raise SystemExit("reroute_end not found")
    # Replace from after reroute_end through mode_marker with just newline + mode_marker
    after = t.find(reroute_end) + len(reroute_end)
    before_mode = t.find(mode_marker)
    t = (
        t[:after]
        + "\n  // Route-Lock: kein Shortcut-/Detour-Dauer-Recalc — nur Wrong-Way-Flow.\n\n  "
        + t[before_mode:]
    )
    print("removed shortcut/detour recalcs")
else:
    print("shortcut marker missing — check manually")

# Remove bike speak
old_speak = """    if (modeSwitchTo && appliedProfile === modeSwitchTo) {
      setPreferredTravelMode(modeSwitchTo);
      try {
        void speakAssistantText(
          modeSwitchTo === 'bike'
            ? 'Du bist unterwegs mit dem Rad — ich nehme die Radwege.'
            : 'Wieder zu Fuß — ich rechne die Fußroute neu.',
        );
      } catch {
        /* soft */
      }
    }"""
new_speak = """    if (modeSwitchTo && appliedProfile === modeSwitchTo) {
      setPreferredTravelMode(modeSwitchTo);
      // Still: Profil-Swap ohne Ansage (User: kein „nehme die Radwege“).
    }"""
if "Still: Profil-Swap ohne Ansage" in t:
    print("bike speak already removed")
elif old_speak not in t:
    raise SystemExit("bike speak block not found")
else:
    t = t.replace(old_speak, new_speak, 1)
    print("bike speak removed")

nav.write_text(t, encoding="utf-8")
print("wrote navigationService")

# Verify offRouteThresholdM import
t2 = nav.read_text(encoding="utf-8")
if "offPathMinM: offRouteThresholdM" in t2 and "offRouteThresholdM" not in t2.split("function")[0] and "offRouteThresholdM," not in t2[:15000]:
    # search imports more carefully
    if "offRouteThresholdM" not in t2:
        print("ERROR: offRouteThresholdM used but not imported")
    else:
        print("offRouteThresholdM present somewhere, ok")
else:
    print("import check done")
print("done")
