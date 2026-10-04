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
        print(f"SKIP/MISS {rel}")
        print(repr(old[:80]))
        return
    force_write(path, t.replace(old, new, 1))


# Fix getNavPhase → lastNavPhase
patch(
    "src/services/navigation/navigationService.ts",
    """  if (
    !isTransitMode(transportMode) &&
    getNavPhase() !== 'in_transit' &&
    !routeHasTransitLegs
  ) {
    return null;
  }""",
    """  if (
    !isTransitMode(transportMode) &&
    lastNavPhase !== 'in_transit' &&
    !routeHasTransitLegs
  ) {
    return null;
  }""",
)

# Fog trail denser sampling (less overlap stack look)
patch(
    "src/services/discovery/fogCoverage.ts",
    """  const maxPoints = opts?.maxPoints ?? 400;
  const minStepM = opts?.minStepM ?? 5;""",
    """  const maxPoints = opts?.maxPoints ?? 320;
  // Größerer Min-Step → weniger Überlapp-/Stapel-Look bei Mehrfach-Lauf.
  const minStepM = opts?.minStepM ?? 12;""",
)

# Remove glow LineLayer from NativeHomeMapView
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """          <ShapeSource id="fog-trail" shape={trailFc}>
            <LineLayer
              id="fog-trail-glow"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                lineColor: HOME_MAP_FOG_REVEAL,
                lineWidth: HOME_MAP_FOG_TRAIL_GLOW_WIDTH,
                lineOpacity: HOME_MAP_FOG_TRAIL_GLOW_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="fog-trail-core"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                lineColor: HOME_MAP_FOG_REVEAL,
                lineWidth: HOME_MAP_FOG_TRAIL_CORE_WIDTH,
                lineOpacity: HOME_MAP_FOG_TRAIL_CORE_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>""",
    """          <ShapeSource id="fog-trail" shape={trailFc}>
            <LineLayer
              id="fog-trail-core"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                lineColor: HOME_MAP_FOG_REVEAL,
                lineWidth: HOME_MAP_FOG_TRAIL_CORE_WIDTH,
                lineOpacity: HOME_MAP_FOG_TRAIL_CORE_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>""",
)

print("batch3a done")
