/**
 * Karten-Prefetch ohne Kamerasprung: sichtbare Kacheln zuerst,
 * Nachbarn + Eltern-Zooms im HTTP-Cache (OpenFreeMap maxzoom 14).
 */

export const HOME_MAP_TILE_MAX_Z = 14;
export const HOME_MAP_PREFETCH_TILE_CAP = 80;

export function clampTileZoom(z: number, maxZ = HOME_MAP_TILE_MAX_Z): number {
  const n = Math.floor(Number(z) || 0);
  if (n < 0) return 0;
  if (n > maxZ) return maxZ;
  return n;
}

export function lngLatToTileXY(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const zInt = clampTileZoom(z);
  const n = 2 ** zInt;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

export function tilesCoveringRadius(
  lat: number,
  lng: number,
  radiusM: number,
  z: number,
): Array<{ z: number; x: number; y: number }> {
  const zInt = clampTileZoom(z);
  const dLat = radiusM / 111_320;
  const dLng =
    radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const nw = lngLatToTileXY(lng - dLng, lat + dLat, zInt);
  const se = lngLatToTileXY(lng + dLng, lat - dLat, zInt);
  const x0 = Math.min(nw.x, se.x);
  const x1 = Math.max(nw.x, se.x);
  const y0 = Math.min(nw.y, se.y);
  const y1 = Math.max(nw.y, se.y);
  const n = 2 ** zInt;
  const out: Array<{ z: number; x: number; y: number }> = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ z: zInt, x: ((x % n) + n) % n, y });
    }
  }
  return out;
}

/** Wenige Eltern-Kacheln decken große Fläche — beim Schwenken sofort da (Overzoom). */
export function parentZoomsForRing(radiusM: number, viewZoom: number): number[] {
  const view = clampTileZoom(viewZoom);
  const zooms = new Set<number>([view]);
  if (radiusM >= 500) zooms.add(Math.max(0, view - 2));
  if (radiusM >= 2_000) zooms.add(Math.max(0, view - 3));
  if (radiusM >= 10_000) zooms.add(Math.max(0, view - 4));
  return [...zooms].sort((a, b) => b - a);
}

export function tilesForWarmupRing(
  lat: number,
  lng: number,
  radiusM: number,
  viewZoom: number,
): Array<{ z: number; x: number; y: number }> {
  const seen = new Set<string>();
  const out: Array<{ z: number; x: number; y: number }> = [];
  for (const z of parentZoomsForRing(radiusM, viewZoom)) {
    let tiles = tilesCoveringRadius(lat, lng, radiusM, z);
    let zoom = z;
    while (tiles.length > 64 && zoom > 8) {
      zoom -= 1;
      tiles = tilesCoveringRadius(lat, lng, radiusM, zoom);
    }
    for (const t of tiles) {
      const key = `${t.z}/${t.x}/${t.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= HOME_MAP_PREFETCH_TILE_CAP) return out;
    }
  }
  return out;
}
