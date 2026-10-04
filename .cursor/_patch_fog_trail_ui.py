# -*- coding: utf-8 -*-
from pathlib import Path
import os
import tempfile
import time


def force_write(path: str, content: str) -> None:
    p = Path(path)
    tmp = Path(tempfile.gettempdir()) / (p.name + ".patched")
    tmp.write_text(content, encoding="utf-8")
    for i in range(12):
        try:
            if p.exists():
                try:
                    os.chmod(p, 0o666)
                except Exception:
                    pass
                p.unlink()
            break
        except Exception as e:
            print("unlink", i, e)
            time.sleep(0.25)
    else:
        dead = p.with_suffix(p.suffix + ".locked")
        try:
            if dead.exists():
                dead.unlink()
        except Exception:
            pass
        p.rename(dead)
    p.write_bytes(tmp.read_bytes())
    print("wrote", p)


# Fix smoke import
smoke = Path("src/services/discovery/fogCoverage.smoke.test.ts")
sm = smoke.read_text(encoding="utf-8")
if "fogTrailGeoJSON," not in sm.split("} from")[0]:
    sm = sm.replace(
        "  fogTrackCacheKey,\n  pointInFogPolygons,",
        "  fogTrackCacheKey,\n  fogTrailGeoJSON,\n  pointInFogPolygons,",
    )
    force_write(str(smoke), sm)
else:
    print("smoke import ok")

# NativeHomeMapView patches
view = Path("src/components/homeMap/NativeHomeMapView.tsx")
vs = view.read_text(encoding="utf-8")

# imports style
if "HOME_MAP_FOG_TRAIL_CORE_WIDTH" not in vs:
    vs = vs.replace(
        "  HOME_MAP_FOG_REVEAL_OPACITY,\n  HOME_MAP_FOG_ZOOM,\n",
        "  HOME_MAP_FOG_REVEAL_OPACITY,\n"
        "  HOME_MAP_FOG_TRAIL_CORE_OPACITY,\n"
        "  HOME_MAP_FOG_TRAIL_CORE_WIDTH,\n"
        "  HOME_MAP_FOG_TRAIL_GLOW_OPACITY,\n"
        "  HOME_MAP_FOG_TRAIL_GLOW_WIDTH,\n"
        "  HOME_MAP_FOG_ZOOM,\n",
    )

if "fogTrailGeoJSON" not in vs:
    vs = vs.replace(
        "  fogMaskFromExplored,\n  fogPolygonsToGeoJSON,\n  fogTrackCacheKey,\n  fogBoundsCacheKey,\n",
        "  fogMaskFromExplored,\n"
        "  fogPolygonsToGeoJSON,\n"
        "  fogTrailGeoJSON,\n"
        "  fogTrackCacheKey,\n"
        "  fogBoundsCacheKey,\n",
    )

if "useFinnusStore" not in vs.split("from '../../store/useFogStore'")[0][-500:]:
    # add near useFogStore import
    if "from '../../store/useFinnusStore'" not in vs:
        vs = vs.replace(
            "import { useFogStore } from '../../store/useFogStore';",
            "import { useFogStore } from '../../store/useFogStore';\n"
            "import { useFinnusStore } from '../../store/useFinnusStore';",
        )

# After exploredFromStore / fogStoreTrackKey declarations
needle = (
    "    const exploredFromStore = useFogStore((s) => s.exploredPolygons);\n"
    "    const fogStoreTrackKey = useFogStore((s) => s.trackKey);\n"
)
if "navFogTrailActive" not in vs:
    if needle not in vs:
        raise SystemExit("explored needle missing")
    vs = vs.replace(
        needle,
        needle
        + """    const navFogTrailActive = useFinnusStore((s) => s.navActive === true);
    const fogTrailSig = useFogStore((s) => {
      const t = s.walkTrack;
      if (!t.length) return '';
      const last = t[t.length - 1]!;
      return `${t.length}:${last.lat.toFixed(4)},${last.lng.toFixed(4)}`;
    });

""",
    )

# revealFc: hide fill during nav
old_reveal = """    const revealFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady) return EMPTY_FC;
      // Nur Store (idle forceFogRecompute). Sync-Fallback aus walkTrack =
      // Doppel-Fog + Sekunden Freeze + Kamera-Snap auf Boot-GPS.
      if (exploredFromStore.length === 0) return EMPTY_FC;"""

new_reveal = """    const revealFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady) return EMPTY_FC;
      // A — während Nav nur Trail-Linie (kein Flächen-Reveal / kein Mask-Dunkel).
      if (navFogTrailActive) return EMPTY_FC;
      // Nur Store (idle forceFogRecompute). Sync-Fallback aus walkTrack =
      // Doppel-Fog + Sekunden Freeze + Kamera-Snap auf Boot-GPS.
      if (exploredFromStore.length === 0) return EMPTY_FC;"""

if "navFogTrailActive) return EMPTY_FC" not in vs:
    if old_reveal not in vs:
        raise SystemExit("revealFc block missing")
    vs = vs.replace(old_reveal, new_reveal, 1)

# deps for revealFc
if "navFogTrailActive,\n      mapCoreReady," not in vs and "navFogTrailActive,\n      mapCoreReady" not in vs:
    vs = vs.replace(
        """    }, [
      mapCoreReady,
      fogStoreTrackKey,
      exploredFromStore.length,
      props.locationFollow,
    ]);

    /** Nach ShapeSource-Update: User-View halten (Android MapLibre → defaultStop). */""",
        """    }, [
      mapCoreReady,
      fogStoreTrackKey,
      exploredFromStore.length,
      props.locationFollow,
      navFogTrailActive,
    ]);

    const trailFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady || !navFogTrailActive) return EMPTY_FC;
      const track = useFogStore.getState().walkTrack;
      return sanitizePolygonFc(fogTrailGeoJSON(track));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapCoreReady, navFogTrailActive, fogTrailSig, fogLayersWanted]);

    /** Nach ShapeSource-Update: User-View halten (Android MapLibre → defaultStop). */""",
        1,
    )

# JSX: add trail layers after fog-reveal ShapeSource
old_jsx = """          <MapLayerGate group="fog">
          <ShapeSource id="fog-reveal" shape={revealFc}>
            <FillLayer
              id="fog-reveal-fill"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                fillColor: HOME_MAP_FOG_REVEAL,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_FOG_ZOOM.goneAt,
                  0,
                  HOME_MAP_FOG_ZOOM.fullAt,
                  HOME_MAP_FOG_REVEAL_OPACITY,
                ],
                fillOutlineColor: HOME_MAP_FOG_REVEAL_EDGE,
              }}
            />
          </ShapeSource>
          </MapLayerGate>"""

new_jsx = """          <MapLayerGate group="fog">
          <ShapeSource id="fog-reveal" shape={revealFc}>
            <FillLayer
              id="fog-reveal-fill"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                fillColor: HOME_MAP_FOG_REVEAL,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_FOG_ZOOM.goneAt,
                  0,
                  HOME_MAP_FOG_ZOOM.fullAt,
                  HOME_MAP_FOG_REVEAL_OPACITY,
                ],
                fillOutlineColor: HOME_MAP_FOG_REVEAL_EDGE,
              }}
            />
          </ShapeSource>
          <ShapeSource id="fog-trail" shape={trailFc}>
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
          </ShapeSource>
          </MapLayerGate>"""

if 'id="fog-trail"' not in vs:
    if old_jsx not in vs:
        raise SystemExit("fog-reveal jsx missing")
    vs = vs.replace(old_jsx, new_jsx, 1)

force_write(str(view), vs)

# native smoke
ns = Path("src/components/homeMap/nativeHomeMap.smoke.test.ts")
nt = ns.read_text(encoding="utf-8")
if "fog-trail" not in nt:
    nt = nt.replace(
        "assert(view.includes('HOME_MAP_FOG_MASK_ENABLED'), 'Fog-Maske abschaltbar');",
        "assert(view.includes('HOME_MAP_FOG_MASK_ENABLED'), 'Fog-Maske abschaltbar');\n"
        "assert(view.includes('fog-trail'), 'Fog A: Nav-Trail Layer');\n"
        "assert(view.includes('navFogTrailActive'), 'Fog A: Trail nur während Nav');",
    )
    force_write(str(ns), nt)

print("native done")
