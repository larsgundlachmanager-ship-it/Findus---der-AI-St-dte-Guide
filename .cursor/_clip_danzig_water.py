"""Clip Danzig coverage: OSM admin boundary, water overhang trimmed.

Keeps detailed coastal/land outline; removes Baltic sea spike (e.g. 19.07E).
"""
from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
PACK = ROOT / "data" / "staedte" / "danzig.json"
UA = "YorroDanzigClip/1.0 (coverage land clip)"

# Gulf of Gdansk: anything east of this and north of the port spit is open water.
# Real city/port east coast tops out ~18.72–18.85; allow a small port buffer.
MAX_SEA_LNG = 18.88
# Open Baltic north of the Nowy Port / Westerplatte shoreline
MAX_SEA_LAT = 54.435


def fetch(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def ring_from_geojson(gj: dict) -> list[list[float]] | None:
    if not gj or not isinstance(gj.get("coordinates"), list):
        return None
    ring = None
    if gj.get("type") == "Polygon":
        ring = gj["coordinates"][0]
    elif gj.get("type") == "MultiPolygon":
        best = None
        for poly in gj["coordinates"]:
            r = poly[0] if poly else None
            if r and (best is None or len(r) > len(best)):
                best = r
        ring = best
    if not ring or len(ring) < 6:
        return None
    out: list[list[float]] = []
    for c in ring:
        lng, lat = float(c[0]), float(c[1])
        if math.isfinite(lat) and math.isfinite(lng):
            out.append([lat, lng])
    return out if len(out) >= 6 else None


def bbox(poly: list[list[float]]) -> dict:
    lats = [p[0] for p in poly]
    lngs = [p[1] for p in poly]
    return {
        "latMin": min(lats),
        "latMax": max(lats),
        "lngMin": min(lngs),
        "lngMax": max(lngs),
    }


def area_abs(ring: list[list[float]]) -> float:
    if len(ring) < 3:
        return 0.0
    a = 0.0
    n = len(ring)
    for i in range(n):
        lat1, lng1 = ring[i]
        lat2, lng2 = ring[(i + 1) % n]
        a += lng1 * lat2 - lng2 * lat1
    return abs(a) * 0.5


def close_ring(ring: list[list[float]]) -> list[list[float]]:
    if not ring:
        return ring
    if ring[0][0] != ring[-1][0] or ring[0][1] != ring[-1][1]:
        return ring + [ring[0][:]]
    return ring


def is_open_water(lat: float, lng: float) -> bool:
    """Heuristic: far NE spike into Gulf of Gdansk / open Baltic."""
    if lng > MAX_SEA_LNG and lat > 54.30:
        return True
    if lat > MAX_SEA_LAT and lng > 18.70:
        return True
    # Known outlier from current pack
    if lat > 54.48 and lng > 18.95:
        return True
    return False


def clip_sea_vertices(ring: list[list[float]]) -> list[list[float]]:
    """Drop open-water vertices; pull neighbors onto the sea threshold."""
    if len(ring) < 6:
        return ring
    # Drop closing duplicate for processing
    pts = ring[:-1] if (
        abs(ring[0][0] - ring[-1][0]) < 1e-12 and abs(ring[0][1] - ring[-1][1]) < 1e-12
    ) else ring[:]

    out: list[list[float]] = []
    for lat, lng in pts:
        if is_open_water(lat, lng):
            # Project onto near-coast box edge instead of deleting every point
            # (keeps a thin coastal fringe if admin includes pier/harbor).
            nlat = min(lat, MAX_SEA_LAT)
            nlng = min(lng, MAX_SEA_LNG)
            # If still absurd NE, skip
            if nlat > 54.45 and nlng > 18.85:
                continue
            out.append([nlat, nlng])
        else:
            out.append([lat, lng])

    # Dedupe consecutive
    dedup: list[list[float]] = []
    for p in out:
        if not dedup or abs(dedup[-1][0] - p[0]) > 1e-7 or abs(dedup[-1][1] - p[1]) > 1e-7:
            dedup.append(p)
    if len(dedup) < 6:
        return ring
    return dedup


def try_polygon_clipping_land(
    admin: list[list[float]], land_ring: list[list[float]] | None
) -> list[list[float]] | None:
    if not land_ring or len(land_ring) < 6:
        return None
    try:
        import polygon_clipping  # type: ignore
    except ImportError:
        try:
            import polygonClipping as polygon_clipping  # type: ignore
        except ImportError:
            return None
    # polygon-clipping expects [lng,lat]
    a = [[(lng, lat) for lat, lng in close_ring(admin)]]
    b = [[(lng, lat) for lat, lng in close_ring(land_ring)]]
    try:
        inter = polygon_clipping.intersection(a, b)
    except Exception:
        return None
    if not inter:
        return None
    best = None
    best_a = -1.0
    for poly in inter:
        outer = poly[0]
        if not outer or len(outer) < 6:
            continue
        ring = [[lat, lng] for lng, lat in outer]
        # drop closing
        if abs(ring[0][0] - ring[-1][0]) < 1e-12 and abs(ring[0][1] - ring[-1][1]) < 1e-12:
            ring = ring[:-1]
        ar = area_abs(ring)
        if ar > best_a:
            best_a = ar
            best = ring
    return best


def main() -> None:
    pack = json.loads(PACK.read_text(encoding="utf-8"))
    old = pack.get("_coverage", {}).get("polygon") or []
    print(f"old pts={len(old)} bbox={bbox(old) if old else None}")

    # 1) Fresh Nominatim admin for Gdańsk (relation)
    time.sleep(1.1)
    url = (
        "https://nominatim.openstreetmap.org/lookup"
        "?osm_ids=R1553098&format=json&polygon_geojson=1&polygon_threshold=0"
    )
    hits = fetch(url)
    admin = None
    if isinstance(hits, list) and hits:
        admin = ring_from_geojson(hits[0].get("geojson") or {})
    if not admin:
        time.sleep(1.1)
        search = fetch(
            "https://nominatim.openstreetmap.org/search"
            "?q=Gda%C5%84sk&countrycodes=pl&format=json&limit=5"
            "&polygon_geojson=1&polygon_threshold=0&featuretype=city"
        )
        best_pts = 0
        for h in search if isinstance(search, list) else []:
            if str(h.get("osm_type", "")).lower() not in ("relation", "r"):
                continue
            if h.get("class") != "boundary":
                continue
            ring = ring_from_geojson(h.get("geojson") or {})
            if ring and len(ring) > best_pts:
                best_pts = len(ring)
                admin = ring
    if not admin:
        print("Nominatim failed — clipping existing polygon only")
        admin = old

    print(f"admin pts={len(admin)} bbox={bbox(admin)}")

    # 2) Soft sea clip (always) — kill NE water spike
    clipped = clip_sea_vertices(admin)
    print(f"sea-clipped pts={len(clipped)} bbox={bbox(clipped)}")

    # Prefer denser outline if Nominatim returned coarser than pack but without sea spike
    # Keep max detail: if old has more pts and after clip looks sane, merge strategy:
    # use clipped admin if it removes the spike; otherwise clip old.
    old_clipped = clip_sea_vertices(old) if old else clipped
    print(f"old-clipped pts={len(old_clipped)} bbox={bbox(old_clipped)}")

    # Choose denser land-safe ring
    candidates = [clipped, old_clipped]
    chosen = max(candidates, key=lambda r: (len(r), area_abs(r)))
    # Reject if still has NE water outlier
    if any(is_open_water(lat, lng) for lat, lng in chosen):
        chosen = [p for p in chosen if not is_open_water(p[0], p[1])]
        # ensure closed-ish count
        if len(chosen) < 6:
            chosen = clipped

    bb = bbox(chosen)
    pack["_coverage"] = {
        **(pack.get("_coverage") or {}),
        **bb,
        "polygon": chosen,
    }
    PACK.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Debug geojson
    gj = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "danzig_coverage_clipped"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[lng, lat] for lat, lng in close_ring(chosen)]
                    ],
                },
            }
        ],
    }
    out = ROOT / ".cursor" / "_danzig_coverage_clipped.geojson"
    out.write_text(json.dumps(gj), encoding="utf-8")
    print(f"wrote {PACK.name} coverage pts={len(chosen)} bbox={bb}")
    print(f"debug {out}")


if __name__ == "__main__":
    main()
