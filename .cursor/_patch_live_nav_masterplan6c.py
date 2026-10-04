# -*- coding: utf-8 -*-
"""Live-Nav part3: heading-up, puck geo-fix, timeline order."""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_ln6c")
    tmp.write_text(content, encoding="utf-8")
    for i in range(12):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str, *, already: str | None = None) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"SKIP {rel} (already)")
        return
    if old not in t:
        print(f"MISS {rel}")
        print("--- expected snippet start ---")
        print(old[:240])
        print("---")
        return
    force_write(path, t.replace(old, new, 1))


# ---------------------------------------------------------------------------
# 3.5 Heading-up: pin GPS center in applyMapBearing / enableHeadingFollow
# ---------------------------------------------------------------------------
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """      markProgrammaticBearing();
      // Android: Heading-only setCamera fällt oft auf defaultStop-Zentrum (Boot-GPS)
      // zurück — immer Live-Center+Zoom mitschicken (Google: drehen ≠ springen).
      const live = camLiveRef.current;
      // Follow: kein gestapeltes easeTo (sonst Ruckeln gegen Sensor). Sonst kurz weich.
      const follow = headingFollowRef.current;
      cameraRef.current?.setCamera({
        centerCoordinate: [live.lng, live.lat],
        zoomLevel: live.zoom,
        heading: b,
        animationDuration: follow ? 0 : 90,
        animationMode: follow ? 'moveTo' : 'easeTo',
      });
      postBearingUi(b);
    };""",
    """      markProgrammaticBearing();
      // Android: Heading-only setCamera fällt oft auf defaultStop-Zentrum (Boot-GPS)
      // zurück — immer Live-Center+Zoom mitschicken (Google: drehen ≠ springen).
      const live = camLiveRef.current;
      // Heading-Follow: um GPS drehen (nicht Kamera-Mitte) — sonst wirkt Lock tot in Nav.
      let cLat = live.lat;
      let cLng = live.lng;
      if (headingFollowRef.current) {
        const gps = gpsPosRef.current;
        if (
          gps.lat != null &&
          gps.lng != null &&
          Number.isFinite(gps.lat) &&
          Number.isFinite(gps.lng)
        ) {
          cLat = gps.lat;
          cLng = gps.lng;
        }
      }
      // Follow: kein gestapeltes easeTo (sonst Ruckeln gegen Sensor). Sonst kurz weich.
      const follow = headingFollowRef.current;
      camLiveRef.current = { ...live, lat: cLat, lng: cLng, heading: b };
      cameraRef.current?.setCamera({
        centerCoordinate: [cLng, cLat],
        zoomLevel: live.zoom,
        heading: b,
        animationDuration: follow ? 0 : 90,
        animationMode: follow ? 'moveTo' : 'easeTo',
      });
      postBearingUi(b);
    };""",
    already="Heading-Follow: um GPS drehen",
)

patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """    const enableHeadingFollowInternal = (fromUserTap: boolean) => {
      headingFollowRef.current = true;
      // Nur Blickrichtung — userDetached bleibt true, sonst öffnet Kompass
      // wieder Host-Jumps und der GPS-Anker kann die freie Erkundung fressen.
      userGesturing.current = false;
      fingerDown.current = false;
      liveMapTurnRef.current = false;
      displayBearingRef.current = camLiveRef.current.heading;
      targetBearingRef.current = null;
      retargetHeadingFollow(headingRef.current);""",
    """    const enableHeadingFollowInternal = (fromUserTap: boolean) => {
      headingFollowRef.current = true;
      // Nur Blickrichtung — userDetached bleibt true, sonst öffnet Kompass
      // wieder Host-Jumps und der GPS-Anker kann die freie Erkundung fressen.
      userGesturing.current = false;
      fingerDown.current = false;
      liveMapTurnRef.current = false;
      // Sofort GPS als Drehzentrum (Nav Heading-up), nicht alter Kamera-Anker.
      {
        const gps = gpsPosRef.current;
        if (
          gps.lat != null &&
          gps.lng != null &&
          Number.isFinite(gps.lat) &&
          Number.isFinite(gps.lng)
        ) {
          camLiveRef.current = {
            ...camLiveRef.current,
            lat: gps.lat,
            lng: gps.lng,
          };
        }
      }
      displayBearingRef.current = camLiveRef.current.heading;
      targetBearingRef.current = null;
      retargetHeadingFollow(headingRef.current);""",
    already="Sofort GPS als Drehzentrum",
)

# ---------------------------------------------------------------------------
# 3.6 Pan: puck stays geo-fixed (GPS coords); lock overlay only while locked
# ---------------------------------------------------------------------------
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """    const pushArrowNative = (
      lat: number | null,
      lng: number | null,
      heading: number,
    ) => {
      gpsArrowRef.current?.setNativeProps({
        shape: gpsArrowFc(lat, lng, heading),
      });
    };

    const pushPuckPosition = (
      lat: number | null,
      lng: number | null,
      _acc: number | null,
    ) => {
      // Ein Puck auf GPS — Lock gleitet über Kamera, kein zweites Overlay.
      pushArrowNative(lat, lng, headingRef.current);
    };""",
    """    const pushArrowNative = (
      lat: number | null,
      lng: number | null,
      heading: number,
    ) => {
      // Immer echte GPS-Koordinaten — nie Kamera-Center (sonst wandert Puck beim Pan).
      const g = gpsPosRef.current;
      const useLat =
        lat != null && Number.isFinite(lat)
          ? lat
          : g.lat != null && Number.isFinite(g.lat)
            ? g.lat
            : null;
      const useLng =
        lng != null && Number.isFinite(lng)
          ? lng
          : g.lng != null && Number.isFinite(g.lng)
            ? g.lng
            : null;
      gpsArrowRef.current?.setNativeProps({
        shape: gpsArrowFc(useLat, useLng, heading),
      });
    };

    const pushPuckPosition = (
      lat: number | null,
      lng: number | null,
      _acc: number | null,
    ) => {
      // Ein Puck auf GPS — Lock gleitet über Kamera, kein zweites Overlay.
      if (lat != null && lng != null) {
        gpsPosRef.current = {
          lat,
          lng,
          acc: gpsPosRef.current.acc,
        };
      }
      pushArrowNative(lat, lng, headingRef.current);
    };""",
    already="nie Kamera-Center (sonst wandert Puck beim Pan)",
)

patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
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
      const pos = gpsPosRef.current;
      pushArrowNative(pos.lat, pos.lng, headingRef.current);""",
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
      // Geo-fix: Puck sofort auf GPS neu setzen (Screen-Lock-Overlay ist aus).
      const pos = gpsPosRef.current;
      pushArrowNative(pos.lat, pos.lng, headingRef.current);""",
    already="Geo-fix: Puck sofort auf GPS neu setzen",
)

patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """        <GpsLockCenterPuck
          active={gpsLockCenter}
          freezeScreenUp={props.headingFollow === true}
        />""",
    """        <GpsLockCenterPuck
          active={gpsLockCenter && props.locationFollow === true}
          freezeScreenUp={props.headingFollow === true}
        />""",
    already="gpsLockCenter && props.locationFollow",
)

# ---------------------------------------------------------------------------
# 4.5 Timeline order — monotonic times + live sequence tie-break
# ---------------------------------------------------------------------------
patch(
    "src/module2/timeline/liveTourSchedule.ts",
    """    let leaveMs = t;
    let arriveMs = t + etaMin * 60_000;
    if (
      s.startMs != null &&
      Number.isFinite(s.startMs) &&
      s.endMs != null &&
      Number.isFinite(s.endMs) &&
      s.endMs > s.startMs
    ) {
      leaveMs = s.startMs;
      arriveMs = s.endMs;
      if (!(typeof s.durationSec === 'number' && s.durationSec > 0)) {
        etaMin = Math.max(1, Math.round((arriveMs - leaveMs) / 60_000));
      }
    }""",
    """    let leaveMs = t;
    let arriveMs = t + etaMin * 60_000;
    if (
      s.startMs != null &&
      Number.isFinite(s.startMs) &&
      s.endMs != null &&
      Number.isFinite(s.endMs) &&
      s.endMs > s.startMs
    ) {
      // Nie vor dem vorherigen Tour-Schritt (sonst Ziel vor Ausstieg in der Timeline).
      leaveMs = Math.max(t, s.startMs);
      arriveMs = Math.max(leaveMs + 30_000, s.endMs);
      if (!(typeof s.durationSec === 'number' && s.durationSec > 0)) {
        etaMin = Math.max(1, Math.round((arriveMs - leaveMs) / 60_000));
      }
    }""",
    already="Nie vor dem vorherigen Tour-Schritt",
)

patch(
    "src/module2/timeline/futurePlanState.ts",
    """    if (aT !== bT) return aT - bT;
    // Bei gleicher Startzeit: kürzerer Stop zuerst, sonst Titel
    const aEnd = a.plannedEndMs ?? aT;
    const bEnd = b.plannedEndMs ?? bT;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.title.localeCompare(b.title, 'de');
  });
}""",
    """    if (aT !== bT) return aT - bT;
    // Live-Tour: Reihenfolge aus ID (tour_live_N_…) schlägt Titel — Ausstieg vor Ziel.
    const liveIdx = (id: string | undefined) => {
      const m = /^tour_live_(\\d+)_/.exec(String(id || ''));
      if (m) return Number(m[1]);
      const leg = /^tour_live_leg_(\\d+)$/.exec(String(id || ''));
      if (leg) return Number(leg[1]) - 0.5;
      if (id === 'nav_live_active') return -1;
      if (id === 'nav_live_dest') return 999;
      return null;
    };
    const ai = liveIdx(a.id);
    const bi = liveIdx(b.id);
    if (ai != null && bi != null && ai !== bi) return ai - bi;
    // Bei gleicher Startzeit: kürzerer Stop zuerst, sonst Titel
    const aEnd = a.plannedEndMs ?? aT;
    const bEnd = b.plannedEndMs ?? bT;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.title.localeCompare(b.title, 'de');
  });
}""",
    already="Live-Tour: Reihenfolge aus ID",
)

# gapFill: don't add ÖPNV while live journey exists
patch(
    "src/module2/timeline/gapFillTravel.ts",
    """function sortedRealStops(): FuturePlanStop[] {""",
    """function hasLiveJourneyOnPlan(): boolean {
  try {
    const plan = useFuturePlanStore.getState().plan;
    return plan.stops.some(
      (s) =>
        s.groupId === 'live_journey' ||
        s.id === 'nav_live_active' ||
        s.id.startsWith('tour_live_'),
    );
  } catch {
    return false;
  }
}

function sortedRealStops(): FuturePlanStop[] {""",
    already="hasLiveJourneyOnPlan",
)

# Find applyGapFillTravelLegs entry and early-return
patch(
    "src/module2/timeline/gapFillTravel.ts",
    """  if (destAlreadyHasTravel(first.id, planStopsNow)) return;""",
    """  if (hasLiveJourneyOnPlan()) return;
  if (destAlreadyHasTravel(first.id, planStopsNow)) return;""",
    already="if (hasLiveJourneyOnPlan()) return;",
)

print("part3 done")
