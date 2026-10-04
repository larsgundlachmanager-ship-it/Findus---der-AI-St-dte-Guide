# -*- coding: utf-8 -*-
"""Video-feedback patches — OneDrive-safe via temp+os.replace."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def patch_once(rel: str, old: str, new: str, label: str, already: str | None = None) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"{label}: already")
        return
    if old not in t:
        raise SystemExit(f"{label}: old block not found ({rel})")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


# --- 1) Never restore GPS/heading lock on boot ---
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """  // Gespeicherter GPS-Lock nach Boot wieder anlegen (sonst nur AsyncStorage, nie Kamera).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void hydrateHomeMapHudFollowPrefs().then((prefs) => {
      if (cancelled) return;
      if (!prefs.locationFollow && !prefs.headingFollow) return;
      timer = setTimeout(() => {
        if (!cancelled) applyHudFollowPrefs(prefs);
      }, 700);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyHudFollowPrefs]);
""",
    """  // Cold start: Karte immer frei. Gespeicherte HUD-Locks nicht auto-reaktivieren
  // (sonst GPS mittig + Follow, obwohl User panzen will). Prefs nur nach Tap.
  useEffect(() => {
    void hydrateHomeMapHudFollowPrefs().then(() => {
      noteHomeMapHudFollowPrefs({ locationFollow: false, headingFollow: false });
    });
  }, []);
""",
    "boot_no_hud_lock",
    already="Cold start: Karte immer frei",
)

# --- 2) Pan unlocks location AND heading ---
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """  const onNativeUserPan = useCallback(() => {
    // Echte User-Bewegung: immer sofort Unlock — ignoreUserPanUntil gilt nur
    // gegen programmierte Jump-Echoes (die noteUserGesture gar nicht feuern).
    mapUserExploredRef.current = true;
    userMapGestureRef.current = true;
    // Watchdog auch bei Pan-only (ohne sauberes GestureEnd).
    if (gestureWatchdogTimer.current) clearTimeout(gestureWatchdogTimer.current);
    gestureWatchdogTimer.current = setTimeout(() => {
      gestureWatchdogTimer.current = null;
      if (!userMapGestureRef.current) return;
      userMapGestureRef.current = false;
      if (placesPaintPendingRef.current) {
        placesPaintPendingRef.current = false;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    }, 2_800);
    pendingRingDone.current?.();
    followRef.current = false;
    locationFollowRef.current = false;
    lastGpsTapAt.current = 0;
    gpsTapStageRef.current = undefined;
    setLocationFollow(false);
    // Prefs bewusst nicht speichern — Pan ist Session-Unlock.
    mapRef.current?.releaseFollow();
  }, []);
""",
    """  const onNativeUserPan = useCallback(() => {
    // Echte User-Bewegung: immer sofort Unlock — ignoreUserPanUntil gilt nur
    // gegen programmierte Jump-Echoes (die noteUserGesture gar nicht feuern).
    mapUserExploredRef.current = true;
    userMapGestureRef.current = true;
    // Watchdog auch bei Pan-only (ohne sauberes GestureEnd).
    if (gestureWatchdogTimer.current) clearTimeout(gestureWatchdogTimer.current);
    gestureWatchdogTimer.current = setTimeout(() => {
      gestureWatchdogTimer.current = null;
      if (!userMapGestureRef.current) return;
      userMapGestureRef.current = false;
      if (placesPaintPendingRef.current) {
        placesPaintPendingRef.current = false;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    }, 2_800);
    pendingRingDone.current?.();
    followRef.current = false;
    locationFollowRef.current = false;
    headingFollowRef.current = false;
    lastGpsTapAt.current = 0;
    gpsTapStageRef.current = undefined;
    lastCompassTapAt.current = 0;
    setLocationFollow(false);
    setHeadingFollow(false);
    // Prefs speichern: Fixierung raus, freie Ansicht bleibt.
    noteHomeMapHudFollowPrefs({ locationFollow: false, headingFollow: false });
    mapRef.current?.releaseFollow();
    mapRef.current?.setHeadingFollow(false);
  }, []);
""",
    "pan_unlock_both",
    already="headingFollowRef.current = false;\n    lastGpsTapAt.current = 0;\n    gpsTapStageRef.current = undefined;\n    lastCompassTapAt",
)

# --- 3) Compass needle follows map rotate during gesture ---
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """      currentMapZoomRef.current = Number.isFinite(v.zoom) ? v.zoom : currentMapZoomRef.current;
      if (!userMapGestureRef.current) {
        useHomeMapUiStore.getState().setMapBearing(v.bearing);
      }
""",
    """      currentMapZoomRef.current = Number.isFinite(v.zoom) ? v.zoom : currentMapZoomRef.current;
      // Auch während Drehen/Pan — sonst bleibt die Kompass-Nadel oben tot.
      if (Number.isFinite(v.bearing)) {
        useHomeMapUiStore.getState().setMapBearing(v.bearing);
      }
""",
    "bearing_during_gesture",
    already="Auch während Drehen/Pan",
)

# --- 4) noteUserGesture: position also clears heading when both were locked ---
patch_once(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """      if (kind === 'position') {
        userDetached.current = true;
        locationFollowRef.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
      } else {
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
      }
""",
    """      if (kind === 'position') {
        userDetached.current = true;
        locationFollowRef.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
        // Wegziehen = volle freie Ansicht: auch Blickrichtungs-Follow sofort raus.
        if (headingFollowRef.current) {
          stopHeadingFollowLoop();
          headingFollowRef.current = false;
        }
      } else {
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
      }
""",
    "gesture_position_clears_heading",
    already="Wegziehen = volle freie Ansicht",
)

# --- 5) Fog mask back on ---
patch_once(
    "src/services/homeMap/homeMapStyle.ts",
    """/**
 * Viewport-Schleier aus — erzeugt den „dunklen Kasten“ über Unerkundetem.
 * Reveal (Eis-Cyan-Pfad) bleibt an.
 */
export const HOME_MAP_FOG_MASK_ENABLED = false;
""",
    """/**
 * Viewport-Schleier über Unerkundetem (Fog of War).
 * Reveal (Eis-Cyan-Pfad) bleibt zusätzlich an.
 */
export const HOME_MAP_FOG_MASK_ENABLED = true;
""",
    "fog_mask_on",
    already="HOME_MAP_FOG_MASK_ENABLED = true",
)

patch_once(
    "src/services/homeMap/homeMapPlaceTone.smoke.test.ts",
    """assert(
  style.includes('HOME_MAP_FOG_MASK_ENABLED = false'),
  'Fog: kein dunkler Viewport-Kasten',
);
""",
    """assert(
  style.includes('HOME_MAP_FOG_MASK_ENABLED = true'),
  'Fog: Viewport-Schleier an',
);
""",
    "fog_smoke",
    already="Fog: Viewport-Schleier an",
)

print("batch1 done")
