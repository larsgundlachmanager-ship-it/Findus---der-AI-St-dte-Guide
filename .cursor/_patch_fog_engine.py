from pathlib import Path
import os, tempfile

def replace(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"FAIL {label}: needle not found")
    if text.count(old) != 1:
        raise SystemExit(f"FAIL {label}: expected 1 hit, got {text.count(old)}")
    text = text.replace(old, new)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
    os.close(fd)
    Path(tmp).write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    print("OK", label)

# Header comment + imports
replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """ * Tempo-Lanes (App darf bei Bus/Rad nicht einfrieren):
 * - walk: volle Qualität, Debounce ~1,2 s
 * - bike: größeres Connect, Debounce eher länger
 * - transit (≥ ~30 km/h): kein Full-Raster jedes Tick — Basis einfrieren +
 *   billige GPS-Blase; Full-Merge erst wenn Tempo wieder runter ist
 * - schwere Merge nicht während Mic / Pan
 * - Explore-Idle ohne GPS-Follow: Full-Merge einfrieren (Restlast)
 */

import {
  buildExploredPolygons,
  fogTrackCacheKey,
  FOG_MERGE_GAP_M,
  type FogPolygon,
  type FogRing,
} from '../discovery/fogCoverage';
import {
  FOG_SEGMENT_BREAK_MS,
  WALK_REVEAL_RADIUS_M,
  type WalkTrackPoint,
} from '../discovery/walkTrackService';
import { useFogStore } from '../../store/useFogStore';
import { isMapUserGesturing } from './mapGestureLane';
import { isMicActive } from '../boot/interactiveBootGate';
import {
  homeMapFogExploreIdleFrozen,
  homeMapLocationFollowActive,
  homeMapShouldPause,
} from '../ui/homeMapPause';
""",
    """ * Tempo-Lanes (App darf bei Bus/Rad nicht einfrieren):
 * - walk: billiger Tip-Blob oft (live), Full-Merge nur mapIdle (hinter Mic/Chrome)
 * - bike: größeres Connect, Debounce eher länger
 * - transit (≥ ~30 km/h): kein Full-Raster jedes Tick — Basis einfrieren +
 *   billige GPS-Blase; Full-Merge erst wenn Tempo wieder runter ist
 * - schwere Merge nie vor Mic / Voice / Overlay / Pan — immer mapIdle
 * - Explore-Idle ohne GPS-Follow: Full-Merge einfrieren (Restlast)
 */

import {
  buildExploredPolygons,
  fogTrackCacheKey,
  FOG_MERGE_GAP_M,
  type FogPolygon,
  type FogRing,
} from '../discovery/fogCoverage';
import {
  FOG_SEGMENT_BREAK_MS,
  WALK_REVEAL_RADIUS_M,
  type WalkTrackPoint,
} from '../discovery/walkTrackService';
import { useFogStore } from '../../store/useFogStore';
import { isMapUserGesturing } from './mapGestureLane';
import {
  isMicActive,
  isVoiceLaneBusy,
  runMapIdleWhenFree,
} from '../boot/interactiveBootGate';
import {
  homeMapFogExploreIdleFrozen,
  homeMapLocationFollowActive,
  homeMapShouldPause,
} from '../ui/homeMapPause';
""",
    "fog header imports",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """const FOG_DEBOUNCE_WALK_MS = 1_200;
/** Bike: deutlich länger — Full-Polygon nicht bei jedem Rad-Tick. */
const FOG_DEBOUNCE_BIKE_MS = 3_200;
/** Transit: selten Full-Pfad; Tip-Updates trotzdem gedrosselt. */
const FOG_DEBOUNCE_TRANSIT_MS = 2_800;
/** Nach Tempo-Drop: kurz warten, dann einmal Full-Merge. */
const FOG_TRANSIT_EXIT_MS = 2_200;
/** Bike Full-Merge höchstens so oft (dazwischen Tip-Blob). */
const FOG_BIKE_FULL_EVERY_MS = 8_000;
let lastBikeFullAtMs = 0;
""",
    """const FOG_DEBOUNCE_WALK_MS = 1_200;
/** Walk Tip-Blob: live um GPS, ohne Full-Raster. */
const FOG_DEBOUNCE_WALK_TIP_MS = 700;
/** Walk Full-Merge höchstens so oft — Rest über Tip, Full nur mapIdle. */
const FOG_WALK_FULL_EVERY_MS = 4_500;
/** Bike: deutlich länger — Full-Polygon nicht bei jedem Rad-Tick. */
const FOG_DEBOUNCE_BIKE_MS = 3_200;
/** Transit: selten Full-Pfad; Tip-Updates trotzdem gedrosselt. */
const FOG_DEBOUNCE_TRANSIT_MS = 2_800;
/** Nach Tempo-Drop: kurz warten, dann einmal Full-Merge. */
const FOG_TRANSIT_EXIT_MS = 2_200;
/** Bike Full-Merge höchstens so oft (dazwischen Tip-Blob). */
const FOG_BIKE_FULL_EVERY_MS = 8_000;
let lastBikeFullAtMs = 0;
let lastWalkFullAtMs = 0;
""",
    "fog debounce constants",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """function activeDebounceMs(): number {
  const tier = fogSpeedTier();
  if (tier === 'transit') return FOG_DEBOUNCE_TRANSIT_MS;
  if (tier === 'bike') return FOG_DEBOUNCE_BIKE_MS;
  return FOG_DEBOUNCE_WALK_MS;
}
""",
    """function activeDebounceMs(): number {
  const tier = fogSpeedTier();
  if (tier === 'transit') return FOG_DEBOUNCE_TRANSIT_MS;
  if (tier === 'bike') return FOG_DEBOUNCE_BIKE_MS;
  return FOG_DEBOUNCE_WALK_MS;
}

/** Mic / Modul-2 Speech / Overlay — Fog stellt sich hinten an. */
function fogShouldYield(): boolean {
  try {
    if (isMicActive()) return true;
    if (isVoiceLaneBusy()) return true;
  } catch {
    /* soft */
  }
  return false;
}

function publishWalkTip(
  track: WalkTrackPoint[],
  gps: { lat: number; lng: number },
): void {
  const tip = computeTransitTip(track, gps);
  const base = useFogStore.getState().exploredPolygons;
  publishExplored(
    [...base.slice(0, Math.max(0, base.length - 1)), ...tip],
    `walk:${gps.lat.toFixed(4)},${gps.lng.toFixed(4)}`,
  );
}
""",
    "fog yield + walk tip helper",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """function runDeferredFullCompute(track: WalkTrackPoint[], key: string): void {
  // Zwei Yields: aktueller Frame + Mic/Pan atmen.
  setTimeout(() => {
    if (isMapUserGesturing() || isMicActive()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, null);
      return;
    }
    setTimeout(() => {
      if (isMapUserGesturing() || isMicActive()) {
        scheduleFogRecompute(useFogStore.getState().walkTrack, null);
        return;
      }
      if (fogSpeedTier() === 'transit') {
        // Zwischenzeitlich wieder Transit — Tip-Pfad, kein Full.
        return;
      }
      try {
        const polygons = computeExplored(track);
        publishExplored(polygons, key);
      } catch {
        scheduleFogRecompute(useFogStore.getState().walkTrack, null);
      }
    }, 0);
  }, 0);
}
""",
    """function runDeferredFullCompute(track: WalkTrackPoint[], key: string): void {
  // Full-Merge immer mapIdle — hinter Mic/Chrome/Polish, nie Hot-Path.
  runMapIdleWhenFree(() => {
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, null);
      return;
    }
    if (fogSpeedTier() === 'transit') {
      // Zwischenzeitlich wieder Transit — Tip-Pfad, kein Full.
      return;
    }
    try {
      const polygons = computeExplored(track);
      publishExplored(polygons, key);
    } catch {
      scheduleFogRecompute(useFogStore.getState().walkTrack, null);
    }
  });
}
""",
    "fog full via mapIdle",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """    if (!isMicActive()) {
      try {
        pushInstantGpsBlob(gps);
      } catch {
        /* soft */
      }
    }
""",
    """    if (!fogShouldYield()) {
      try {
        pushInstantGpsBlob(gps);
      } catch {
        /* soft */
      }
    }
""",
    "instant blob yield",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """    const wait = isMicActive()
      ? Math.max(activeDebounceMs(), 1800)
      : Math.min(activeDebounceMs(), 900);
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      if (isMicActive() || isMapUserGesturing()) {
        scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
        return;
      }
""",
    """    const wait = fogShouldYield()
      ? Math.max(activeDebounceMs(), 1800)
      : Math.min(activeDebounceMs(), 900);
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      if (fogShouldYield() || isMapUserGesturing()) {
        scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
        return;
      }
""",
    "transit yield",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """    const waitBike = isMicActive()
      ? Math.max(activeDebounceMs(), 1800)
      : activeDebounceMs();
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      if (isMicActive() || isMapUserGesturing()) {
        scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
        return;
      }
""",
    """    const waitBike = fogShouldYield()
      ? Math.max(activeDebounceMs(), 1800)
      : activeDebounceMs();
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      if (fogShouldYield() || isMapUserGesturing()) {
        scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
        return;
      }
""",
    "bike yield",
)

# Replace walk path (final else branch)
replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """  if (recomputeTimer) clearTimeout(recomputeTimer);
  const wait = isMicActive()
    ? Math.max(activeDebounceMs(), 1800)
    : activeDebounceMs();
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (isMicActive()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
      return;
    }
    if (isMapUserGesturing()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
      return;
    }
    const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
    if (key === lastTrackKey) return;
    runDeferredFullCompute(useFogStore.getState().walkTrack, key);
  }, wait);
}
""",
    """  // Walk: Tip-Blob oft (live), Full-Merge gedrosselt + mapIdle.
  if (recomputeTimer) clearTimeout(recomputeTimer);
  const waitWalk = fogShouldYield()
    ? Math.max(FOG_DEBOUNCE_WALK_TIP_MS, 1800)
    : FOG_DEBOUNCE_WALK_TIP_MS;
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (fogShouldYield() || isMapUserGesturing()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
      return;
    }
    const now = Date.now();
    const dueFull = now - lastWalkFullAtMs >= FOG_WALK_FULL_EVERY_MS;
    const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
    if (dueFull && key !== lastTrackKey) {
      lastWalkFullAtMs = now;
      runDeferredFullCompute(useFogStore.getState().walkTrack, key);
      return;
    }
    if (!gps) return;
    try {
      publishWalkTip(useFogStore.getState().walkTrack, gps);
    } catch {
      /* soft */
    }
  }, waitWalk);
}
""",
    "walk tip + idle full",
)

replace(
    r"src/services/homeMap/fogTrackEngine.ts",
    """  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (isMapUserGesturing() || isMicActive() || homeMapShouldPause()) {
      scheduleFogRecompute(track, null);
      return;
    }
    // Boot / Exit-Transit: Full, aber deferred.
    runDeferredFullCompute(track, key);
  }, 400);
}
""",
    """  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      scheduleFogRecompute(track, null);
      return;
    }
    // Boot / Exit-Transit: Full nur mapIdle.
    runDeferredFullCompute(track, key);
  }, 400);
}
""",
    "forceFog yield",
)

print("fogTrackEngine patched")
