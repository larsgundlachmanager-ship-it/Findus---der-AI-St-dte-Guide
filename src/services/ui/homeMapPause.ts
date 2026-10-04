/**
 * Soft-Pause für Sensor-/Fog-/Ambient-Last — nicht GL einfrieren.
 *
 * Overlays/Mic: Heading drosseln, Fog/Ambient aus — Karte pannt weiter, Puck bleibt.
 * Explore-Idle: Fog-Engine nach Ruhe ohne GPS-Follow einfrieren (View zeigt eh Freeze).
 * Historisch `true` stoppte Dead-Reckoning in der WebView → tot. Deshalb nur Soft.
 */

import { chromeHoldsLoad, isMicActive } from '../boot/interactiveBootGate';

let locationFollowActive = false;
let headingFollowActive = false;

/** Nach so langer Ruhe ohne Follow: kein Fog-Full-Merge / ShapeSource-Push. */
export const FOG_EXPLORE_IDLE_FREEZE_MS = 45_000;
let lastMapExploreActivityAt = Date.now();

export function noteHomeMapFollowState(opts: {
  locationFollow?: boolean;
  headingFollow?: boolean;
}): void {
  if (opts.locationFollow !== undefined) {
    const next = !!opts.locationFollow;
    if (next && !locationFollowActive) {
      // Follow an → Fog wieder live.
      lastMapExploreActivityAt = Date.now();
    }
    locationFollowActive = next;
  }
  if (opts.headingFollow !== undefined) {
    headingFollowActive = !!opts.headingFollow;
  }
}

/** Pan/Zoom/Recenter — Idle-Timer zurücksetzen. */
export function noteHomeMapExploreActivity(): void {
  lastMapExploreActivityAt = Date.now();
}

/**
 * Freie Erkundung + länger keine Geste/kein GPS-Follow → Fog-Engine ruhen lassen.
 * Track darf weiter wachsen; Polygon-Publish stoppt.
 */
export function homeMapFogExploreIdleFrozen(): boolean {
  if (locationFollowActive) return false;
  return Date.now() - lastMapExploreActivityAt >= FOG_EXPLORE_IDLE_FREEZE_MS;
}

export function homeMapLocationFollowActive(): boolean {
  return locationFollowActive;
}

export function homeMapHeadingFollowActive(): boolean {
  return headingFollowActive;
}

/**
 * Soft-Pause: Mic, Zurück, Timeline, Einstellungen → Fog/Ambient drosseln.
 * Verpflichtend die ganze Zeit, solange sie den Faden haben.
 * Nie MapView-Gesten oder GPS-Puck einfrieren.
 */
export function homeMapShouldPause(): boolean {
  try {
    if (isMicActive()) return true;
    if (chromeHoldsLoad()) return true;
  } catch {
    /* soft */
  }
  return false;
}