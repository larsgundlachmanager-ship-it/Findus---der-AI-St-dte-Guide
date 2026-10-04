# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_mp")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
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


def patch(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        print(f"MISS {rel}")
        return
    force_write(path, t.replace(old, new, 1))


patch(
    "src/services/research/venueWalkByPitch.ts",
    """  const s = useFinnusStore.getState();
  const card = s.activeConciergeCard;""",
    """  const s = useFinnusStore.getState();
  // Live-Nav: kein Arena/Stadion-Places-Poll (Lag + Log-Spam).
  if (s.navActive) return false;
  const card = s.activeConciergeCard;""",
)

# ambient: gate before venue walk
patch(
    "src/services/research/ambientEventPitch.ts",
    """    // Nähe-Arena/Theater zuerst (enger Radius) — teilt 8h-Quota
    try {
      const { tryVenueWalkByPitch } = await import('./venueWalkByPitch');
      const walked = await tryVenueWalkByPitch({ lat, lng, now });
      if (walked) return;
    } catch {
      /* soft — Stadt-Ambient weiter */
    }""",
    """    // Nähe-Arena/Theater zuerst (enger Radius) — teilt 8h-Quota
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      if (useFinnusStore.getState().navActive) return;
      const { tryVenueWalkByPitch } = await import('./venueWalkByPitch');
      const walked = await tryVenueWalkByPitch({ lat, lng, now });
      if (walked) return;
    } catch {
      /* soft — Stadt-Ambient weiter */
    }""",
)

# Recenter during nav: one tap lock
patch(
    "src/components/homeMap/HomePresenceMap.tsx",
    """  const onRecenter = useCallback(() => {
    const next = nextGpsRecenterTap(
      {
        locked: locationFollowRef.current,
        lastTapAt: lastGpsTapAt.current,
        stage: gpsTapStageRef.current,
      },
      Date.now(),
      currentMapZoomRef.current,
    );""",
    """  const onRecenter = useCallback(() => {
    // Live-Nav: ein Tap = sofort zentrieren + Follow (kein Multi-Stage-Lag).
    if (useFinnusStore.getState().navActive) {
      locationFollowRef.current = true;
      lastGpsTapAt.current = Date.now();
      gpsTapStageRef.current = undefined;
      setLocationFollow(true);
      noteHomeMapHudFollowPrefs({
        locationFollow: true,
        headingFollow: headingFollowRef.current,
      });
      ignoreUserPanUntil.current = Date.now() + 700;
      mapRef.current?.reattachFollow();
      mapRef.current?.setHeadingFollow(headingFollowRef.current);
      snapGps('lock');
      return;
    }
    const next = nextGpsRecenterTap(
      {
        locked: locationFollowRef.current,
        lastTapAt: lastGpsTapAt.current,
        stage: gpsTapStageRef.current,
      },
      Date.now(),
      currentMapZoomRef.current,
    );""",
)

# stationCountdown: don't mute on mode dip
patch(
    "src/services/navigation/stationCountdown.ts",
    """  if (!isTransitMode(opts.transportMode)) return;
  if (!riding(opts.navPhase ?? null)) return;

  if (lastRemaining != null && remaining > lastRemaining) {""",
    """  // Mode-Dip walk in Bahn: Phase in_transit reicht für HUD/Speech.
  if (!isTransitMode(opts.transportMode) && !riding(opts.navPhase ?? null)) {
    return;
  }
  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;

  if (lastRemaining != null && remaining > lastRemaining) {""",
)

# Simplify stationCountdown gate - my patch above is redundant. Fix properly:
# Actually let me replace with cleaner version in a follow-up if needed.

patch(
    "src/services/navigation/stationCountdown.ts",
    """  if (!isTransitMode(opts.transportMode)) return;
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;""",
    """  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;""",
)

print("batch4 done")
