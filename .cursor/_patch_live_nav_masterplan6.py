# -*- coding: utf-8 -*-
"""Minimal Live-Nav masterplan remaining: 1.6, 1.5, 3.5, 3.6, 1.8 entgegen, 4.5."""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_ln6")
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
# 1.6 navRouteMapPayload — transit geom = stations/path, not foot OSRM / fake-reject
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """function geomFromStop(ts: {
  role?: string | null;
  path?: Array<{ lat: number; lng: number }> | null;
  stations?: Array<{ lat: number; lng: number }> | null;
}): NavRouteMapCoord[] {
  if (Array.isArray(ts.path) && ts.path.length >= 2) {
    const pts = ts.path
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3 && !isFakeRouteLine(pts)) return pts;
  }
  const transit = ts.role === 'alight' || ts.role === 'board';
  if (transit && Array.isArray(ts.stations) && ts.stations.length >= 2) {
    const pts = ts.stations
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3) return pts;
  }
  return [];
}""",
    """function geomFromStop(ts: {
  role?: string | null;
  path?: Array<{ lat: number; lng: number }> | null;
  stations?: Array<{ lat: number; lng: number }> | null;
}): NavRouteMapCoord[] {
  const transit = ts.role === 'alight' || ts.role === 'board';
  // ÖPNV: Stationskette / Journey-Leg — nie Fuß-OSRM; gerade Schiene ist OK.
  if (transit) {
    if (Array.isArray(ts.stations) && ts.stations.length >= 2) {
      const pts = ts.stations
        .map((p) => asCoord(p.lat, p.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
      if (pts.length >= 2) return pts;
    }
    if (Array.isArray(ts.path) && ts.path.length >= 2) {
      const pts = ts.path
        .map((p) => asCoord(p.lat, p.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
      if (pts.length >= 2) return pts;
    }
    return [];
  }
  if (Array.isArray(ts.path) && ts.path.length >= 2) {
    const pts = ts.path
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3 && !isFakeRouteLine(pts)) return pts;
  }
  return [];
}""",
    already="ÖPNV: Stationskette / Journey-Leg",
)

patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """  for (const ts of upcoming) {
    const geom = geomFromStop(ts);
    if (geom.length < 2 || isFakeRouteLine(geom)) continue;
    const kind =
      ts.role === 'alight' || ts.role === 'board' ? 'transit' : 'walk';
    if (
      transitTour &&
      kind === 'walk' &&
      geom.length >= 2 &&
      haversineMeters(
        geom[0]!.lat,
        geom[0]!.lng,
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
      ) > 2500 &&
      haversineMeters(
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
        dest.lat,
        dest.lng,
      ) < 120
    ) {
      continue;
    }
    pushAhead(geom, kind);
  }
  if (stopCoords.length >= 2) {
    for (let i = 0; i < stopCoords.length - 1; i += 1) {
      const a = stopCoords[i]!;
      const b = stopCoords[i + 1]!;
      const routed = peekTourAheadLeg(a, b);
      const fromStop = upcoming[i + 1] ? geomFromStop(upcoming[i + 1]!) : [];
      const line =
        routed && routed.length >= 3 && !isFakeRouteLine(routed)
          ? routed
          : fromStop.length >= 3 && !isFakeRouteLine(fromStop)
            ? fromStop
            : [];
      if (line.length < 2 || isFakeRouteLine(line)) continue;""",
    """  for (const ts of upcoming) {
    const geom = geomFromStop(ts);
    const kind =
      ts.role === 'alight' || ts.role === 'board' ? 'transit' : 'walk';
    if (geom.length < 2) continue;
    if (kind !== 'transit' && isFakeRouteLine(geom)) continue;
    if (
      transitTour &&
      kind === 'walk' &&
      geom.length >= 2 &&
      haversineMeters(
        geom[0]!.lat,
        geom[0]!.lng,
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
      ) > 2500 &&
      haversineMeters(
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
        dest.lat,
        dest.lng,
      ) < 120
    ) {
      continue;
    }
    pushAhead(geom, kind);
  }
  if (stopCoords.length >= 2) {
    for (let i = 0; i < stopCoords.length - 1; i += 1) {
      const a = stopCoords[i]!;
      const b = stopCoords[i + 1]!;
      const fromStop = upcoming[i + 1] ? geomFromStop(upcoming[i + 1]!) : [];
      const transitLeg =
        b.role === 'alight' ||
        b.role === 'board' ||
        ((b.vehicleMode || '').toUpperCase() === 'RAIL' ||
          (b.vehicleMode || '').toUpperCase() === 'SUBWAY' ||
          (b.vehicleMode || '').toUpperCase() === 'TRAM' ||
          (b.vehicleMode || '').toUpperCase() === 'TRANSIT');
      // Transit: Stationskette/Journey vor Fuß-OSRM-Cache.
      const routed = peekTourAheadLeg(a, b);
      const line = transitLeg
        ? fromStop.length >= 2
          ? fromStop
          : routed && routed.length >= 2
            ? routed
            : []
        : routed && routed.length >= 3 && !isFakeRouteLine(routed)
          ? routed
          : fromStop.length >= 3 && !isFakeRouteLine(fromStop)
            ? fromStop
            : [];
      if (line.length < 2) continue;
      if (!transitLeg && isFakeRouteLine(line)) continue;""",
    already="Transit: Stationskette/Journey vor Fuß-OSRM-Cache",
)

patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """      if (already) continue;
      const transit =
        b.role === 'alight' ||
        b.role === 'board' ||
        ((b.vehicleMode || '').toUpperCase() === 'RAIL' ||
          (b.vehicleMode || '').toUpperCase() === 'SUBWAY' ||
          (b.vehicleMode || '').toUpperCase() === 'TRAM' ||
          (b.vehicleMode || '').toUpperCase() === 'TRANSIT');
      pushAhead(line, transit ? 'transit' : 'walk');
    }
  }""",
    """      if (already) continue;
      pushAhead(line, transitLeg ? 'transit' : 'walk');
    }
  }""",
    already="pushAhead(line, transitLeg ? 'transit' : 'walk')",
)

patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """  let mapped: NavRouteMapCoord[];
  if (currentIsTransit) {
    const rail =
      Array.isArray(upcoming[0]?.path) && (upcoming[0]!.path?.length ?? 0) >= 3
        ? upcoming[0]!.path!.map((p) => ({ lat: p.lat, lng: p.lng }))
        : current;
    mapped = isFakeRouteLine(rail) ? [] : downsampleCoords(rail);
  } else if (""",
    """  let mapped: NavRouteMapCoord[];
  if (currentIsTransit) {
    const rail = geomFromStop(upcoming[0] ?? {});
    // Stationskette / Journey-Leg — gerade Schiene nicht als Fake verwerfen.
    mapped = rail.length >= 2 ? downsampleCoords(rail) : [];
  } else if (""",
    already="Stationskette / Journey-Leg — gerade Schiene",
)

# Attach stations onto stopCoords for ahead cache
patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """  for (let i = 0; i < Math.min(stopCoords.length, upcoming.length); i += 1) {
    const c = stopCoords[i];
    const ts = upcoming[i];
    if (c && ts) {
      c.role = c.role ?? ts.role ?? null;
      c.vehicleMode =
        c.vehicleMode ??
        (ts as { vehicleMode?: string | null }).vehicleMode ??
        null;
    }
  }""",
    """  for (let i = 0; i < Math.min(stopCoords.length, upcoming.length); i += 1) {
    const c = stopCoords[i];
    const ts = upcoming[i];
    if (c && ts) {
      c.role = c.role ?? ts.role ?? null;
      c.vehicleMode =
        c.vehicleMode ??
        (ts as { vehicleMode?: string | null }).vehicleMode ??
        null;
      const st = (ts as { stations?: Array<{ lat: number; lng: number }> | null })
        .stations;
      if (Array.isArray(st) && st.length >= 2) {
        (c as AheadCoord & { stations?: AheadCoord[] }).stations = st.map((p) => ({
          lat: p.lat,
          lng: p.lng,
        }));
      }
    }
  }""",
    already="(c as AheadCoord & { stations?: AheadCoord[] }).stations",
)

# ---------------------------------------------------------------------------
# 1.6 tourAheadRouteCache — seed stations; no foot OSRM for transit when seeded
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/tourAheadRouteCache.ts",
    """export type AheadCoord = {
  lat: number;
  lng: number;
  role?: string | null;
  path?: AheadCoord[] | null;
  vehicleMode?: string | null;
};""",
    """export type AheadCoord = {
  lat: number;
  lng: number;
  role?: string | null;
  path?: AheadCoord[] | null;
  stations?: AheadCoord[] | null;
  vehicleMode?: string | null;
};""",
    already="stations?: AheadCoord[] | null;",
)

patch(
    "src/services/navigation/tourAheadRouteCache.ts",
    """function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  const fromB = Array.isArray(b.path) && b.path.length >= 3 ? b.path : null;
  if (fromB && pathConnects(a, b, fromB)) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 3 ? a.path : null;
  if (fromA && pathConnects(a, b, fromA)) return fromA;
  return null;
}""",
    """function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  // Transit: Stationskette schlägt Fuß-OSRM.
  if (isTransitRole(b.role) || isTransitRole(a.role)) {
    const stB = Array.isArray(b.stations) && b.stations.length >= 2 ? b.stations : null;
    if (stB) return stB;
    const stA = Array.isArray(a.stations) && a.stations.length >= 2 ? a.stations : null;
    if (stA) return stA;
  }
  const fromB = Array.isArray(b.path) && b.path.length >= 3 ? b.path : null;
  if (fromB && pathConnects(a, b, fromB)) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 3 ? a.path : null;
  if (fromA && pathConnects(a, b, fromA)) return fromA;
  return null;
}""",
    already="Transit: Stationskette schlägt Fuß-OSRM",
)

patch(
    "src/services/navigation/tourAheadRouteCache.ts",
    """    const destWalk =
      b.role === 'dest' || b.role === 'walk' || b.role === 'transfer';
    if (destWalk) {
      void fetchLeg(a, b);
      continue;
    }
    const mode = b.vehicleMode || a.vehicleMode;
    if (isBusMode(mode)) {
      void fetchLeg(a, b);
      continue;
    }
    if (isTransitRole(b.role) || isRailMode(mode)) {
      void fetchRailLeg(a, b);
      continue;
    }
    void fetchLeg(a, b);""",
    """    const destWalk =
      b.role === 'dest' || b.role === 'walk' || b.role === 'transfer';
    if (destWalk) {
      void fetchLeg(a, b);
      continue;
    }
    const mode = b.vehicleMode || a.vehicleMode;
    // Transit ohne Seed: Rail-OSM / Stations-Fallback — kein Fuß-OSRM entlang Linie.
    if (isTransitRole(b.role) || isRailMode(mode) || isBusMode(mode)) {
      if (isBusMode(mode) && !seeded) {
        // Bus ohne Stationskette: Straßen-Directions ok (kein Fuß-Label).
        void fetchLeg(a, b);
      } else if (!isBusMode(mode)) {
        void fetchRailLeg(a, b);
      }
      continue;
    }
    void fetchLeg(a, b);""",
    already="Transit ohne Seed: Rail-OSM",
)

# multiStopTour: seed stations/path for transitRide
patch(
    "src/services/navigation/multiStopTour.ts",
    """  // Fuß-Bein: Journey-Path sofort auf die Karte, bis FOSSGIS enrich nachzieht.
  if (ok && !ride && Array.isArray(stop.path) && stop.path.length >= 3) {
    try {
      const { seedActiveNavRoute } = require('./navigationService') as {
        seedActiveNavRoute: (o: {
          waypoints: Array<{
            lat: number;
            lng: number;
            maneuver: null;
            roadName: null;
            landmark: null;
            cue: null;
            instruction: null;
          }>;
        }) => boolean;
      };
      seedActiveNavRoute({
        waypoints: stop.path.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          maneuver: null,
          roadName: null,
          landmark: null,
          cue: null,
          instruction: null,
        })),
      });
    } catch {
      /* soft */
    }
  }
  if (ok) await applyTourStopRuntime(stop);
  return ok;
}""",
    """  // Fuß-Bein: Journey-Path sofort auf die Karte, bis FOSSGIS enrich nachzieht.
  // Transit-Ride: Stationskette / Journey-Pfad — nie Fuß-OSRM als Kartenlinie.
  if (ok) {
    const seedPts =
      ride && Array.isArray(stop.stations) && stop.stations.length >= 2
        ? stop.stations
        : Array.isArray(stop.path) && stop.path.length >= 3
          ? stop.path
          : null;
    if (seedPts && (ride || !ride)) {
      try {
        const { seedActiveNavRoute } = require('./navigationService') as {
          seedActiveNavRoute: (o: {
            waypoints: Array<{
              lat: number;
              lng: number;
              maneuver: null;
              roadName: null;
              landmark: null;
              cue: null;
              instruction: null;
            }>;
          }) => boolean;
        };
        seedActiveNavRoute({
          waypoints: seedPts.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            maneuver: null,
            roadName: null,
            landmark: null,
            cue: null,
            instruction: null,
          })),
        });
      } catch {
        /* soft */
      }
    }
  }
  if (ok) await applyTourStopRuntime(stop);
  return ok;
}""",
    already="Transit-Ride: Stationskette / Journey-Pfad",
)

print("part1 done")
