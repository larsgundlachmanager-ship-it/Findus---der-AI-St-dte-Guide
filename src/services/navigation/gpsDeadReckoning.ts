/**
 * Dead Reckoning für den Karten-Puck / Follow-Kamera.
 *
 * Roh-GPS (Geofence, Fog, Nav) bleibt unberührt.
 * Zwischen Fixes: Position aus Tempo + Kurs/Heading weiterschätzen (~12 Hz).
 * Neuer Fix: kurzer Blend statt Teleport.
 */

import { shortestAngleDelta } from './bearing';

export type DeadReckonFix = {
  lat: number;
  lng: number;
  speedMs?: number | null;
  /** Bewegungskurs bevorzugt; sonst Geräte-Heading. */
  courseDeg?: number | null;
  atMs?: number;
};

export type DeadReckonSample = {
  lat: number;
  lng: number;
  atMs: number;
  /** true = extrapoliert / blendend, false = frischer Fix. */
  coasting: boolean;
};

type Listener = (s: DeadReckonSample) => void;

const TICK_MS = 80;
/** Ohne Fix nicht ewig fliegen (Zug-Tunnel / GPS-Lücke). */
const MAX_COAST_MS = 2_800;
/** Fuß-Nav: etwas länger coasten — Cadence war oft 2–4 s, sonst friert der Puck. */
const MAX_COAST_WALK_NAV_MS = 4_200;
const MIN_SPEED_MS = 0.4;
/** Fallback-Gehgeschwindigkeit wenn GPS speed=0 während aktiver Fuß-Nav. */
const WALK_NAV_FALLBACK_MS = 1.25;
/** Kleiner Sprung → hart snappen. */
const SNAP_M = 2.2;
/** Max. Blend-Länge bei großem GPS-Sprung. */
const MAX_BLEND_MS = 420;

const listeners = new Set<Listener>();

let anchorLat = 0;
let anchorLng = 0;
let anchorAtMs = 0;
let speedMs = 0;
let courseDeg = 0;
let hasAnchor = false;

let displayLat = 0;
let displayLng = 0;
let displayAtMs = 0;
let coasting = false;

let blendFromLat = 0;
let blendFromLng = 0;
let blendToLat = 0;
let blendToLng = 0;
let blendStartMs = 0;
let blendDurMs = 0;
let blending = false;

let tickTimer: ReturnType<typeof setInterval> | null = null;

function metersBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * 111_320;
  const cos = Math.cos((lat1 * Math.PI) / 180);
  const dLng = (lng2 - lng1) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function offsetMeters(
  lat: number,
  lng: number,
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + northM / 111_320,
    lng: lng + eastM / (111_320 * cos),
  };
}

function courseToNe(speed: number, course: number): { n: number; e: number } {
  const rad = (course * Math.PI) / 180;
  return {
    n: speed * Math.cos(rad),
    e: speed * Math.sin(rad),
  };
}

function resolveCourseDeg(fix: DeadReckonFix): number | null {
  if (
    typeof fix.courseDeg === 'number' &&
    Number.isFinite(fix.courseDeg) &&
    fix.courseDeg >= 0
  ) {
    return ((fix.courseDeg % 360) + 360) % 360;
  }
  try {
    const { getMapDisplayHeadingDegSticky } = require('./liveDeviceHeading') as {
      getMapDisplayHeadingDegSticky: () => number | null;
    };
    return getMapDisplayHeadingDegSticky();
  } catch {
    return null;
  }
}

function softPaused(): boolean {
  try {
    const { homeMapShouldPause } = require('../ui/homeMapPause') as {
      homeMapShouldPause: () => boolean;
    };
    return homeMapShouldPause();
  } catch {
    return false;
  }
}

function emit(): void {
  if (!hasAnchor) return;
  const sample: DeadReckonSample = {
    lat: displayLat,
    lng: displayLng,
    atMs: displayAtMs,
    coasting,
  };
  for (const cb of listeners) cb(sample);
}

function stopTicker(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function ensureTicker(): void {
  if (tickTimer) return;
  if (speedMs < MIN_SPEED_MS && !blending) return;
  tickTimer = setInterval(tick, TICK_MS);
}

function tick(): void {
  if (!hasAnchor) {
    stopTicker();
    return;
  }
  if (softPaused()) {
    // Soft-Pause: kein Extrapolieren unter Mic/Overlay — Puck-Fixes laufen weiter.
    coasting = false;
    emit();
    return;
  }
  const now = Date.now();

  if (blending) {
    const t = Math.min(1, (now - blendStartMs) / Math.max(1, blendDurMs));
    // Ease-out: schneller Start, weiches Einrasten.
    const u = 1 - (1 - t) * (1 - t);
    displayLat = blendFromLat + (blendToLat - blendFromLat) * u;
    displayLng = blendFromLng + (blendToLng - blendFromLng) * u;
    displayAtMs = now;
    coasting = true;
    if (t >= 1) {
      blending = false;
      displayLat = blendToLat;
      displayLng = blendToLng;
      coasting = speedMs >= MIN_SPEED_MS;
      if (speedMs < MIN_SPEED_MS) stopTicker();
    }
    emit();
    return;
  }

  let coastSpeed = speedMs;
  if (coastSpeed < MIN_SPEED_MS) {
    // Fuß-Nav + Heading: GPS meldet oft speed=0 — trotzdem leicht coasten.
    let navWalk = false;
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => { navActive?: boolean; transportMode?: string | null };
        };
      };
      const st = useFinnusStore.getState();
      const mode = (st.transportMode || '').toLowerCase();
      navWalk =
        st.navActive === true &&
        (mode === '' ||
          mode === 'walking' ||
          mode === 'walk' ||
          mode === 'foot' ||
          mode === 'jog');
    } catch {
      navWalk = false;
    }
    if (navWalk && Number.isFinite(courseDeg)) {
      coastSpeed = WALK_NAV_FALLBACK_MS;
    } else {
      coasting = false;
      stopTicker();
      emit();
      return;
    }
  }

  const age = now - anchorAtMs;
  // Bus/Zug: längerer Coast bei GPS-Lücken — Puck soll bei ~60 km/h nicht einfrieren.
  // Geofence/Fog bleiben auf Roh-Fixes (nur Display-Puck).
  let navActive = false;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    navActive = useFinnusStore.getState().navActive === true;
  } catch {
    navActive = false;
  }
  const coastCap =
    coastSpeed >= 8.3 // Transit-Tempo: längerer Coast
      ? 6_000
      : coastSpeed >= 2.8
        ? 4_000
        : navActive
          ? MAX_COAST_WALK_NAV_MS
          : MAX_COAST_MS;
  if (age > coastCap) {
    // Letzte Schätzung halten — kein Geisterflug.
    coasting = false;
    stopTicker();
    emit();
    return;
  }

  const { n, e } = courseToNe(coastSpeed, courseDeg);
  const moved = offsetMeters(anchorLat, anchorLng, n * (age / 1000), e * (age / 1000));
  displayLat = moved.lat;
  displayLng = moved.lng;
  displayAtMs = now;
  coasting = true;
  emit();
}

/**
 * Echter GPS-Fix: Anker setzen, Display weich anbinden, Ticker bei Tempo.
 */
export function noteGpsDeadReckonFix(fix: DeadReckonFix): void {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return;
  const at = typeof fix.atMs === 'number' && Number.isFinite(fix.atMs)
    ? fix.atMs
    : Date.now();

  let nextSpeed =
    typeof fix.speedMs === 'number' && Number.isFinite(fix.speedMs) && fix.speedMs >= 0
      ? fix.speedMs
      : 0;
  try {
    const { getSmoothedSpeedMs } = require('./transportMode') as {
      getSmoothedSpeedMs: () => number;
    };
    const smoothed = getSmoothedSpeedMs();
    if (typeof smoothed === 'number' && smoothed > nextSpeed) {
      nextSpeed = smoothed;
    }
  } catch {
    /* soft */
  }

  const course = resolveCourseDeg(fix);
  if (course != null) {
    if (hasAnchor && speedMs >= MIN_SPEED_MS) {
      // Kurs nicht hart umschlagen — sonst Zickzack.
      const d = shortestAngleDelta(courseDeg, course);
      courseDeg = ((courseDeg + d * 0.55) % 360 + 360) % 360;
    } else {
      courseDeg = course;
    }
  }

  const prevHad = hasAnchor;
  const prevDisplayLat = displayLat;
  const prevDisplayLng = displayLng;

  anchorLat = fix.lat;
  anchorLng = fix.lng;
  anchorAtMs = at;
  speedMs = nextSpeed;
  hasAnchor = true;

  if (!prevHad) {
    displayLat = fix.lat;
    displayLng = fix.lng;
    displayAtMs = at;
    coasting = false;
    blending = false;
    emit();
    if (speedMs >= MIN_SPEED_MS) ensureTicker();
    return;
  }

  const jump = metersBetween(prevDisplayLat, prevDisplayLng, fix.lat, fix.lng);
  if (jump <= SNAP_M) {
    displayLat = fix.lat;
    displayLng = fix.lng;
    displayAtMs = at;
    coasting = false;
    blending = false;
    emit();
  } else {
    blendFromLat = prevDisplayLat;
    blendFromLng = prevDisplayLng;
    blendToLat = fix.lat;
    blendToLng = fix.lng;
    blendStartMs = Date.now();
    blendDurMs = Math.min(MAX_BLEND_MS, 120 + jump * 12);
    blending = true;
    coasting = true;
  }

  if (speedMs >= MIN_SPEED_MS || blending) ensureTicker();
  else {
    // Fuß-Nav: GPS speed oft 0 — Ticker trotzdem für Walk-Coast.
    let keep = false;
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => { navActive?: boolean; transportMode?: string | null };
        };
      };
      const st = useFinnusStore.getState();
      const mode = (st.transportMode || '').toLowerCase();
      keep =
        st.navActive === true &&
        (mode === '' ||
          mode === 'walking' ||
          mode === 'walk' ||
          mode === 'foot' ||
          mode === 'jog');
    } catch {
      keep = false;
    }
    if (keep) ensureTicker();
    else stopTicker();
  }
}

/** Heading-Update während Coast — Kurs leicht nachziehen. */
export function noteDeadReckonHeading(deg: number): void {
  if (!Number.isFinite(deg) || !hasAnchor) return;
  if (speedMs < MIN_SPEED_MS) return;
  // Bei klarem GPS-Kurs (> ~1.5 m/s) Heading nur leicht mischen.
  const k = speedMs >= 1.5 ? 0.12 : 0.35;
  const d = shortestAngleDelta(courseDeg, ((deg % 360) + 360) % 360);
  courseDeg = ((courseDeg + d * k) % 360 + 360) % 360;
}

export function getDeadReckonSample(): DeadReckonSample | null {
  if (!hasAnchor) return null;
  return {
    lat: displayLat,
    lng: displayLng,
    atMs: displayAtMs,
    coasting,
  };
}

export function subscribeDeadReckonPosition(cb: Listener): () => void {
  listeners.add(cb);
  const now = getDeadReckonSample();
  if (now) cb(now);
  return () => {
    listeners.delete(cb);
  };
}

export function clearGpsDeadReckoning(): void {
  stopTicker();
  hasAnchor = false;
  blending = false;
  speedMs = 0;
  coasting = false;
}

/** Test/Smoke: Offset-Hilfe. */
export function deadReckonOffsetMeters(
  lat: number,
  lng: number,
  speedMsIn: number,
  courseDegIn: number,
  dtSec: number,
): { lat: number; lng: number } {
  const { n, e } = courseToNe(speedMsIn, courseDegIn);
  return offsetMeters(lat, lng, n * dtSec, e * dtSec);
}
