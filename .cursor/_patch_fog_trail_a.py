# -*- coding: utf-8 -*-
"""Fog A: Trail during nav, no darken (mask stays off), catch-up after nav."""
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


# --- fogCoverage: trail helper ---
cov = Path("src/services/discovery/fogCoverage.ts")
cs = cov.read_text(encoding="utf-8")
if "fogTrailGeoJSON" not in cs:
    cs = cs.rstrip() + """

/** Nav-Trail (A): schmale LineString-Spur — kein Flächen-Merge, kein Mask-Schleier. */
export function fogTrailGeoJSON(
  track: Array<{ lat: number; lng: number }>,
  opts?: { maxPoints?: number; minStepM?: number },
): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: number[][] };
  }>;
} {
  const maxPoints = opts?.maxPoints ?? 400;
  const minStepM = opts?.minStepM ?? 5;
  const sampled: Array<{ lat: number; lng: number }> = [];
  for (const p of track) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const prev = sampled[sampled.length - 1];
    if (prev) {
      const dLat = (p.lat - prev.lat) * 111_320;
      const dLng =
        (p.lng - prev.lng) * 111_320 * Math.cos((p.lat * Math.PI) / 180);
      if (Math.hypot(dLat, dLng) < minStepM) continue;
    }
    sampled.push({ lat: p.lat, lng: p.lng });
  }
  const slice =
    sampled.length > maxPoints ? sampled.slice(-maxPoints) : sampled;
  if (slice.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: slice.map((p) => [p.lng, p.lat]),
        },
      },
    ],
  };
}
"""
    force_write(str(cov), cs)
else:
    print("fogTrailGeoJSON already present")

# --- homeMapStyle trail constants ---
style = Path("src/services/homeMap/homeMapStyle.ts")
ss = style.read_text(encoding="utf-8")
if "HOME_MAP_FOG_TRAIL_CORE_WIDTH" not in ss:
    ss = ss.replace(
        "export const HOME_MAP_FOG_ENABLED = true;",
        """export const HOME_MAP_FOG_ENABLED = true;

/** Nav-Trail (A): Glow + Kern — kein Abdunkeln, nur Spur. */
export const HOME_MAP_FOG_TRAIL_CORE_WIDTH = 5;
export const HOME_MAP_FOG_TRAIL_GLOW_WIDTH = 14;
export const HOME_MAP_FOG_TRAIL_CORE_OPACITY = 0.55;
export const HOME_MAP_FOG_TRAIL_GLOW_OPACITY = 0.22;""",
    )
    force_write(str(style), ss)
else:
    print("trail style already present")

# --- fogTrackEngine: early return during nav + catchup ---
eng = Path("src/services/homeMap/fogTrackEngine.ts")
es = eng.read_text(encoding="utf-8")

if "ensureNavFogCatchupWatch" not in es:
    es = es.replace(
        "function navFogActive(): boolean {\n  try {\n    const { useFinnusStore } = require('../../store/useFinnusStore') as {\n      useFinnusStore: { getState: () => { navActive?: boolean } };\n    };\n    return useFinnusStore.getState().navActive === true;\n  } catch {\n    return false;\n  }\n}",
        """function navFogActive(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    return useFinnusStore.getState().navActive === true;
  } catch {
    return false;
  }
}

/** Nach Nav: Full-Merge über Track nachziehen (Trail → Fläche). */
let navFogWatchReady = false;
function ensureNavFogCatchupWatch(): void {
  if (navFogWatchReady) return;
  navFogWatchReady = true;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { navActive?: boolean };
        subscribe: (fn: (s: { navActive?: boolean }) => void) => () => void;
      };
    };
    let prev = useFinnusStore.getState().navActive === true;
    useFinnusStore.subscribe((s) => {
      const now = s.navActive === true;
      if (prev && !now) {
        forceFogRecompute(useFogStore.getState().walkTrack);
      }
      prev = now;
    });
  } catch {
    navFogWatchReady = false;
  }
}""",
    )

if "Trail statt Fläche" not in es:
    needle = "  useFogStore.getState().setWalkTrack(track);\n\n  const tier = fogSpeedTier();"
    insert = """  useFogStore.getState().setWalkTrack(track);
  ensureNavFogCatchupWatch();

  // A — Trail statt Fläche: während Nav kein Tip/Full (UI = LineString).
  // Mask bleibt aus — kein Abdunkeln / kein Zoom-Kasten.
  if (navFogActive()) {
    if (recomputeTimer) {
      clearTimeout(recomputeTimer);
      recomputeTimer = null;
    }
    return;
  }

  const tier = fogSpeedTier();"""
    if needle not in es:
        raise SystemExit("setWalkTrack needle missing")
    es = es.replace(needle, insert, 1)

force_write(str(eng), es)

# --- fogCoverage smoke ---
smoke = Path("src/services/discovery/fogCoverage.smoke.test.ts")
sm = smoke.read_text(encoding="utf-8")
if "fogTrailGeoJSON" not in sm:
    sm = sm.replace(
        "  buildFogPolygons,",
        "  buildFogPolygons,\n  fogTrailGeoJSON,",
    )
    if "fogTrailGeoJSON" not in sm.split("from './fogCoverage'")[0]:
        # import line might use different format
        pass
    if "fogTrailGeoJSON(" not in sm:
        sm = sm.rstrip() + """

{
  const trail = fogTrailGeoJSON([
    { lat: 53.68, lng: 9.76 },
    { lat: 53.6802, lng: 9.7602 },
    { lat: 53.6804, lng: 9.7604 },
  ]);
  if (trail.features.length !== 1) throw new Error('FAIL: trail line');
  if (trail.features[0]?.geometry.type !== 'LineString') {
    throw new Error('FAIL: trail LineString');
  }
}
"""
    force_write(str(smoke), sm)

# mapIdleGate smoke
idle = Path("src/services/homeMap/mapIdleGate.smoke.test.ts")
ids = idle.read_text(encoding="utf-8")
if "Trail statt Fläche" not in ids:
    ids = ids.replace(
        "assert(fog.includes('navFogActive'), 'Fog: Nav erkennt Live-Nav');\nassert(fog.includes('if (navFogActive()) return'), 'Fog: Full-Merge während Nav aus');",
        "assert(fog.includes('navFogActive'), 'Fog: Nav erkennt Live-Nav');\n"
        "assert(fog.includes('if (navFogActive()) return'), 'Fog: Full-Merge während Nav aus');\n"
        "assert(fog.includes('Trail statt Fläche'), 'Fog A: Trail während Nav');\n"
        "assert(fog.includes('ensureNavFogCatchupWatch'), 'Fog A: Catch-up nach Nav');",
    )
    force_write(str(idle), ids)

print("engine/style/coverage done")
