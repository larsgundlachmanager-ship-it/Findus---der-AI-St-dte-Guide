/**
 * Fog-of-War als vereinigte Erkundungsfläche — nicht GPS-Stempel.
 *
 * 1. Track als Band mit Reveal-Radius (~50 m)
 * 2. Morphological Close: Lücken bis ~20 m zwischen Bändern schließen
 * 3. Eine (oder wenige) einfache Fog-Polygone, ohne überlappende Löcher
 * 4. Chaikin-Glättung, damit der Rand rund ist (kein 5-m-Pixelraster)
 * 5. Geometrie in Weltkoordinaten (Track-BBox / Kreis) — nicht am Viewport-Raster,
 *    sonst zittert der Rand beim Verschieben und verschwindet im Nahzoom.
 *
 * SSOT für Tests. Die Homescreen-WebView trägt denselben Algorithmus in
 * `NativeHomeMapView` Fog-Fill (kein fill-rule — MapLibre Native).
 */

export const FOG_MERGE_GAP_M = 20;
/** Mindest-Zellgröße in m — am Street-Zoom feiner, damit der Rand nicht treppig wird. */
export const FOG_CELL_M = 0.45;
export const FOG_SMOOTH_ITERS = 10;
/**
 * Stehende GPS-Blase / kompakter Cluster: echter Kreis statt Viewport-Raster.
 * Größerer Span → Kapsel-Raster im Track-BBox (weltfest, nicht am Kartenausschnitt).
 */
export const FOG_COMPACT_SPAN_M = 12;
export const FOG_MAX_GRID = 640;
/** Raster nie gröber — sonst wird eine 50-m-Blase zu wenigen Riesenpixeln. */
export const FOG_CELL_CAP_M = 1.15;
/** Max. Rasterkantenlänge (Zellen), wenn die Kappe greift. */
const FOG_GRID_CAP = 1600;
/**
 * Große erkundete Flächen (Tage zu Fuß) in Kacheln rastern —
 * sonst wird die halbe Stadt ein grobes Pixelgitter.
 */
export const FOG_TILE_SPAN_M = 240;
const METERS_PER_DEG_LAT = 111_320;

export type FogTrackPt = { lat: number; lng: number; at?: number };
/** GeoJSON-Ring: [lng, lat][], geschlossen. */
export type FogRing = [number, number][];
/** Polygon: outer + optionale Löcher. */
export type FogPolygon = FogRing[];

export type FogBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function signedArea(ring: FogRing): number {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return a;
}

function asOuter(ring: FogRing): FogRing {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

function asHole(ring: FogRing): FogRing {
  return signedArea(ring) > 0 ? ring.slice().reverse() : ring;
}

function pointInRing(lng: number, lat: number, ring: FogRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function ringContains(outer: FogRing, inner: FogRing): boolean {
  const p = inner[0];
  if (!p) return false;
  return pointInRing(p[0], p[1], outer);
}

function closeRing(ring: FogRing): FogRing {
  if (ring.length < 3) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a[0] !== b[0] || a[1] !== b[1]) return ring.concat([a]);
  return ring;
}

function dist2(a: FogRing[0], b: FogRing[0]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function perpDist(p: FogRing[0], a: FogRing[0], b: FogRing[0]): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-24) return Math.sqrt(dist2(p, a));
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

function simplifyOpen(pts: FogRing, eps: number): FogRing {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = simplifyOpen(pts.slice(0, idx + 1), eps);
  const right = simplifyOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function simplifyClosed(ring: FogRing, epsDeg: number): FogRing {
  const closed = closeRing(ring);
  if (closed.length <= 5) return closed;
  const open = closed.slice(0, -1);
  const simple = simplifyOpen(open, epsDeg);
  return closeRing(simple.length >= 3 ? simple : open.slice(0, 4));
}

/** Chaikin-Corner-Cutting — Rastertreppen → runde Kante. Ring [lng,lat], geschlossen. */
function chaikinOnce(ring: FogRing): FogRing {
  const closed = closeRing(ring);
  const pts = closed.length >= 2 ? closed.slice(0, -1) : closed;
  if (pts.length < 4) return closed;
  const out: FogRing = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
    out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return closeRing(out);
}

function smoothClosed(ring: FogRing, iters: number = FOG_SMOOTH_ITERS): FogRing {
  let cur = closeRing(ring);
  for (let k = 0; k < iters; k++) cur = chaikinOnce(cur);
  return closeRing(cur);
}

function circleRing(lng: number, lat: number, radiusM: number, steps = 72): FogRing {
  const mLng = Math.max(1, metersPerDegLng(lat));
  const ring: FogRing = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([
      lng + (Math.sin(a) * radiusM) / mLng,
      lat + (Math.cos(a) * radiusM) / METERS_PER_DEG_LAT,
    ]);
  }
  return ring;
}

/** GPS-Blase / rundes Reveal → echter Kreis statt Raster-Rechteck.
 *  Nur stehende ~50-m-Blasen — Schleifen durchs Viertel nie zum Riesenkreis. */
function roundIfCompact(ring: FogRing, revealM: number): FogRing {
  const pts = closeRing(ring).slice(0, -1);
  if (pts.length < 6) return ring;
  let cx = 0;
  let cy = 0;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
    if (p[0] < west) west = p[0];
    if (p[0] > east) east = p[0];
    if (p[1] < south) south = p[1];
    if (p[1] > north) north = p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  const mLng = Math.max(1, metersPerDegLng(cy));
  const widthM = (east - west) * mLng;
  const heightM = (north - south) * METERS_PER_DEG_LAT;
  const span = Math.max(widthM, heightM);
  const short = Math.max(1, Math.min(widthM, heightM));
  if (span > revealM * 2.2) return ring;
  // Längliche Laufspur nicht zum Kreis quetschen
  if (span / short > 1.28) return ring;
  const radii: number[] = [];
  for (const p of pts) {
    radii.push(Math.hypot((p[1] - cy) * METERS_PER_DEG_LAT, (p[0] - cx) * mLng));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const min = Math.min(...radii);
  const max = Math.max(...radii);
  if (!(mean > 8) || min < 4) return ring;
  if (mean > revealM * 1.15 || max > revealM * 1.35) return ring;
  return circleRing(cx, cy, Math.min(mean, revealM), 72);
}

function distMeters(a: FogTrackPt, b: FogTrackPt): number {
  return Math.hypot(
    (b.lat - a.lat) * METERS_PER_DEG_LAT,
    (b.lng - a.lng) * metersPerDegLng((a.lat + b.lat) / 2),
  );
}

function quantizedCellM(widthM: number, heightM: number): number {
  const span = Math.max(widthM, heightM);
  const need = span / FOG_MAX_GRID;
  let cell = Math.max(FOG_CELL_M, need);
  if (cell > FOG_CELL_CAP_M && span / FOG_CELL_CAP_M <= FOG_GRID_CAP) {
    cell = FOG_CELL_CAP_M;
  }
  let q = FOG_CELL_M;
  while (q + 1e-9 < cell) q *= 2;
  return q;
}

function minDistBetweenSegs(a: FogTrackPt[], b: FogTrackPt[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = distMeters(p, q);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Getrennte GPS-Inseln (Haus vs. Teleport/altes Last-Known) einzeln rastern.
 * Ein globales Gitter über 20 km macht die lokale Blase zu groben Quadraten.
 */
export function clusterFogSegments(
  segments: FogTrackPt[][],
  joinM: number,
): FogTrackPt[][][] {
  const items = segments.filter((s) => s.length > 0);
  if (!items.length) return [];
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]! ]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (minDistBetweenSegs(items[i]!, items[j]!) <= joinM) union(i, j);
    }
  }
  const groups = new Map<number, FogTrackPt[][]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(items[i]!);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function compactRevealCenter(segments: FogTrackPt[][]): FogTrackPt | null {
  const pts: FogTrackPt[] = [];
  for (const seg of segments) {
    for (const p of seg) pts.push(p);
  }
  if (!pts.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pts) {
    lat += p.lat;
    lng += p.lng;
  }
  lat /= pts.length;
  lng /= pts.length;
  const c = { lat, lng };
  for (const p of pts) {
    if (distMeters(p, c) > FOG_COMPACT_SPAN_M) return null;
  }
  return c;
}

function boundsFromSegments(segments: FogTrackPt[][], padM: number): FogBounds | null {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  let any = false;
  for (const seg of segments) {
    for (const p of seg) {
      any = true;
      if (p.lng < west) west = p.lng;
      if (p.lng > east) east = p.lng;
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
    }
  }
  if (!any) return null;
  const midLat = (south + north) / 2;
  const mLng = Math.max(1, metersPerDegLng(midLat));
  return {
    west: west - padM / mLng,
    east: east + padM / mLng,
    south: south - padM / METERS_PER_DEG_LAT,
    north: north + padM / METERS_PER_DEG_LAT,
  };
}

function padFogBounds(bounds: FogBounds, padM: number): FogBounds {
  const midLat = (bounds.south + bounds.north) / 2;
  const mLng = Math.max(1, metersPerDegLng(midLat));
  return {
    west: bounds.west - padM / mLng,
    east: bounds.east + padM / mLng,
    south: bounds.south - padM / METERS_PER_DEG_LAT,
    north: bounds.north + padM / METERS_PER_DEG_LAT,
  };
}

function boundsSizeM(bounds: FogBounds): { widthM: number; heightM: number } {
  const mLng = Math.max(1, metersPerDegLng((bounds.south + bounds.north) / 2));
  return {
    widthM: Math.max(0, (bounds.east - bounds.west) * mLng),
    heightM: Math.max(0, (bounds.north - bounds.south) * METERS_PER_DEG_LAT),
  };
}

function pointInBounds(pt: FogTrackPt, b: FogBounds): boolean {
  return pt.lng >= b.west && pt.lng <= b.east && pt.lat >= b.south && pt.lat <= b.north;
}

function segsOverlappingBounds(
  segments: FogTrackPt[][],
  bounds: FogBounds,
): FogTrackPt[][] {
  const out: FogTrackPt[][] = [];
  for (const seg of segments) {
    if (seg.some((p) => pointInBounds(p, bounds))) out.push(seg);
  }
  return out;
}

function splitBoundsToTiles(bounds: FogBounds, tileM: number): FogBounds[] {
  const { widthM, heightM } = boundsSizeM(bounds);
  if (widthM <= tileM && heightM <= tileM) return [bounds];
  const cols = Math.max(1, Math.ceil(widthM / tileM));
  const rows = Math.max(1, Math.ceil(heightM / tileM));
  const dLng = (bounds.east - bounds.west) / cols;
  const dLat = (bounds.north - bounds.south) / rows;
  const tiles: FogBounds[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        west: bounds.west + c * dLng,
        east: c === cols - 1 ? bounds.east : bounds.west + (c + 1) * dLng,
        south: bounds.south + r * dLat,
        north: r === rows - 1 ? bounds.north : bounds.south + (r + 1) * dLat,
      });
    }
  }
  return tiles;
}

function boundsRect(bounds: FogBounds): FogRing {
  return [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ];
}

function paintDisk(
  grid: Uint8Array,
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  r: number,
): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(nx - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(ny - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) grid[y * nx + x] = 1;
    }
  }
}

function paintCapsule(
  grid: Uint8Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintDisk(grid, nx, ny, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
  }
}

function morphClose(
  src: Uint8Array,
  nx: number,
  ny: number,
  radiusCells: number,
): Uint8Array {
  if (radiusCells < 1) return src;
  const r2 = radiusCells * radiusCells;
  const dilate = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!src[y * nx + x]) continue;
      const x0 = Math.max(0, x - radiusCells);
      const x1 = Math.min(nx - 1, x + radiusCells);
      const y0 = Math.max(0, y - radiusCells);
      const y1 = Math.min(ny - 1, y + radiusCells);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          if (dx * dx + dy * dy <= r2) dilate[yy * nx + xx] = 1;
        }
      }
    }
  }
  const out = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let keep = 1;
      const x0 = Math.max(0, x - radiusCells);
      const x1 = Math.min(nx - 1, x + radiusCells);
      const y0 = Math.max(0, y - radiusCells);
      const y1 = Math.min(ny - 1, y + radiusCells);
      outer: for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          if (dx * dx + dy * dy > r2) continue;
          if (!dilate[yy * nx + xx]) {
            keep = 0;
            break outer;
          }
        }
      }
      out[y * nx + x] = keep;
    }
  }
  return out;
}

function isFogCell(grid: Uint8Array, nx: number, ny: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= nx || y >= ny) return false;
  return grid[y * nx + x] === 1;
}

function traceFogRings(grid: Uint8Array, nx: number, ny: number): [number, number][][] {
  type Pt = [number, number];
  const adj = new Map<string, Pt[]>();
  const k = (x: number, y: number) => x + ',' + y;
  const add = (a: Pt, b: Pt) => {
    const key = k(a[0], a[1]);
    const list = adj.get(key);
    if (list) list.push(b);
    else adj.set(key, [b]);
  };

  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!isFogCell(grid, nx, ny, x, y)) continue;
      if (!isFogCell(grid, nx, ny, x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!isFogCell(grid, nx, ny, x, y - 1)) add([x, y], [x + 1, y]);
      if (!isFogCell(grid, nx, ny, x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!isFogCell(grid, nx, ny, x - 1, y)) add([x, y + 1], [x, y]);
    }
  }

  const used = new Set<string>();
  const ek = (a: Pt, b: Pt) => a[0] + ',' + a[1] + '>' + b[0] + ',' + b[1];
  const rings: Pt[][] = [];

  for (const [fromKey, tos] of adj) {
    for (const to of tos) {
      const [sx, sy] = fromKey.split(',').map(Number) as [number, number];
      const start: Pt = [sx, sy];
      if (used.has(ek(start, to))) continue;
      const ring: Pt[] = [start];
      let cur = start;
      let nxt = to;
      for (let guard = 0; guard < nx * ny * 4; guard++) {
        used.add(ek(cur, nxt));
        ring.push(nxt);
        const options = adj.get(k(nxt[0], nxt[1])) ?? [];
        let found: Pt | null = null;
        for (const cand of options) {
          if (!used.has(ek(nxt, cand))) {
            found = cand;
            break;
          }
        }
        if (!found) break;
        cur = nxt;
        nxt = found;
        if (nxt[0] === start[0] && nxt[1] === start[1]) {
          ring.push(start);
          break;
        }
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

function nestPolygons(rings: FogRing[]): FogPolygon[] {
  const n = rings.length;
  if (!n) return [];
  const parent = new Array<number>(n).fill(-1);
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (!ringContains(rings[j]!, rings[i]!)) continue;
      if (parent[i] < 0 || areas[j]! < areas[parent[i]!]!) parent[i] = j;
    }
  }
  const depth = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let d = 0;
    let p = parent[i]!;
    const seen = new Set<number>();
    while (p >= 0 && !seen.has(p) && d < n) {
      seen.add(p);
      d++;
      p = parent[p]!;
    }
    depth[i] = d;
  }
  const holesOf = new Map<number, number[]>();
  const polygons: FogPolygon[] = [];
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 !== 0) {
      const p = parent[i]!;
      if (p < 0) continue;
      const list = holesOf.get(p);
      if (list) list.push(i);
      else holesOf.set(p, [i]);
    }
  }
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 !== 0) continue;
    const poly: FogPolygon = [asOuter(rings[i]!)];
    for (const h of holesOf.get(i) ?? []) {
      poly.push(asHole(rings[h]!));
    }
    polygons.push(poly);
  }
  return polygons;
}

export function pointInFogPolygons(lng: number, lat: number, polygons: FogPolygon[]): boolean {
  for (const poly of polygons) {
    const outer = poly[0];
    if (!outer || !pointInRing(lng, lat, outer)) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(lng, lat, poly[i]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function clipGridToKeep(
  grid: Uint8Array,
  nx: number,
  ny: number,
  west: number,
  south: number,
  cellLng: number,
  cellLat: number,
  keep: FogBounds | null | undefined,
): void {
  if (!keep) return;
  for (let y = 0; y < ny; y++) {
    const lat = south + (y + 0.5) * cellLat;
    const rowOff = y * nx;
    if (lat < keep.south || lat >= keep.north) {
      grid.fill(0, rowOff, rowOff + nx);
      continue;
    }
    for (let x = 0; x < nx; x++) {
      const lng = west + (x + 0.5) * cellLng;
      if (lng < keep.west || lng >= keep.east) grid[rowOff + x] = 0;
    }
  }
}

function rasterExploredPolygons(
  bounds: FogBounds,
  segments: FogTrackPt[][],
  revealM: number,
  mergeGapM: number,
  keepBounds?: FogBounds | null,
): FogPolygon[] {
  const midLat = (bounds.south + bounds.north) / 2;
  const mLng = Math.max(1, metersPerDegLng(midLat));
  const widthM0 = Math.max(FOG_CELL_M * 4, (bounds.east - bounds.west) * mLng);
  const heightM0 = Math.max(FOG_CELL_M * 4, (bounds.north - bounds.south) * METERS_PER_DEG_LAT);
  const cell = quantizedCellM(widthM0, heightM0);
  const cellLng = cell / mLng;
  const cellLat = cell / METERS_PER_DEG_LAT;
  const west = Math.floor(bounds.west / cellLng) * cellLng;
  const south = Math.floor(bounds.south / cellLat) * cellLat;
  const east = Math.ceil(bounds.east / cellLng) * cellLng;
  const north = Math.ceil(bounds.north / cellLat) * cellLat;
  const widthM = Math.max(FOG_CELL_M * 4, (east - west) * mLng);
  const heightM = Math.max(FOG_CELL_M * 4, (north - south) * METERS_PER_DEG_LAT);
  const nx = Math.max(4, Math.ceil(widthM / cell));
  const ny = Math.max(4, Math.ceil(heightM / cell));
  const explored = new Uint8Array(nx * ny);
  const rCells = revealM / cell;

  const toCell = (pt: FogTrackPt): [number, number] => [
    ((pt.lng - west) * mLng) / cell,
    ((pt.lat - south) * METERS_PER_DEG_LAT) / cell,
  ];

  for (const seg of segments) {
    if (!seg.length) continue;
    const first = toCell(seg[0]!);
    paintDisk(explored, nx, ny, first[0], first[1], rCells);
    for (let i = 1; i < seg.length; i++) {
      const a = toCell(seg[i - 1]!);
      const b = toCell(seg[i]!);
      paintCapsule(explored, nx, ny, a[0], a[1], b[0], b[1], rCells);
    }
  }

  const closed = morphClose(
    explored,
    nx,
    ny,
    Math.max(1, Math.round(mergeGapM / 2 / cell)),
  );
  clipGridToKeep(closed, nx, ny, west, south, cellLng, cellLat, keepBounds);

  const raw = traceFogRings(closed, nx, ny);
  const epsDeg = (cell * 0.1) / METERS_PER_DEG_LAT;
  const rings: FogRing[] = [];
  for (const g of raw) {
    const geo: FogRing = g.map(([x, y]) => [
      west + (x * cell) / mLng,
      south + (y * cell) / METERS_PER_DEG_LAT,
    ]);
    const simple = roundIfCompact(simplifyClosed(smoothClosed(geo), epsDeg), revealM);
    if (simple.length >= 4 && Math.abs(signedArea(simple)) > (cell / METERS_PER_DEG_LAT) ** 2) {
      rings.push(simple);
    }
  }
  return nestPolygons(rings);
}

/**
 * Erkundete Fläche in Weltkoordinaten — unabhängig vom aktuellen Kartenausschnitt.
 * Stehende GPS-Blase = echter Kreis, damit Zoom 17 das Mint nicht verschluckt
 * und Rauszoomen nicht pixelig wird.
 */
function exploredForCluster(
  segments: FogTrackPt[][],
  revealM: number,
  mergeGapM: number,
): FogPolygon[] {
  const compact = compactRevealCenter(segments);
  if (compact) {
    return [[asOuter(circleRing(compact.lng, compact.lat, revealM, 72))]];
  }
  const padM = revealM + mergeGapM / 2 + Math.max(8, FOG_CELL_M * 4);
  const bounds = boundsFromSegments(segments, padM);
  if (!bounds) return [];
  // Eine Rasterung fürs ganze Cluster — Kachelschnitte erzeugen sonst
  // Achsen-Kreuze (X) und überlappende Löcher (Dreiecke).
  return rasterExploredPolygons(bounds, segments, revealM, mergeGapM);
}

export function buildExploredPolygons(
  segments: FogTrackPt[][],
  revealM: number,
  mergeGapM: number = FOG_MERGE_GAP_M,
): FogPolygon[] {
  const joinM = revealM * 2 + mergeGapM;
  const clusters = clusterFogSegments(segments, joinM);
  if (!clusters.length) return [];
  if (clusters.length === 1) {
    return exploredForCluster(clusters[0]!, revealM, mergeGapM);
  }
  const out: FogPolygon[] = [];
  for (const c of clusters) {
    out.push(...exploredForCluster(c, revealM, mergeGapM));
  }
  return out;
}

/** Viewport-/Masken-Rechteck minus erkundete Löcher. */
export function fogMaskFromExplored(bounds: FogBounds, explored: FogPolygon[]): FogPolygon[] {
  const outer = asOuter(boundsRect(bounds));
  if (!explored.length) return [[outer]];
  const poly: FogPolygon = [outer];
  const islands: FogPolygon[] = [];
  for (const blob of explored) {
    if (!blob[0]) continue;
    poly.push(asHole(blob[0]));
    for (let i = 1; i < blob.length; i++) {
      islands.push([asOuter(blob[i]!)]);
    }
  }
  return [poly, ...islands];
}

/**
 * Fog-Polygone für einen Ausschnitt.
 * Erkundet = nicht in einem zurückgegebenen Polygon.
 */
export function buildFogPolygons(
  bounds: FogBounds,
  segments: FogTrackPt[][],
  revealM: number,
  mergeGapM: number = FOG_MERGE_GAP_M,
): FogPolygon[] {
  return fogMaskFromExplored(bounds, buildExploredPolygons(segments, revealM, mergeGapM));
}

/** Fog-Track nur neu rastern, wenn der User ~3 m weiter ist (nicht jeder GPS-Jitter). */
export const FOG_TRACK_STEP_M = 3;
/** Viewport-Maske nur neu schneiden, wenn die Kamera ~40 m gewandert ist. */
export const FOG_VIEW_STEP_M = 40;

function quantizeMeters(lat: number, lng: number, stepM: number): string {
  const qLat = Math.round((lat * 111_320) / stepM);
  const qLng = Math.round(
    (lng * 111_320 * Math.cos((lat * Math.PI) / 180)) / stepM,
  );
  return `${qLat}:${qLng}`;
}

/** Stabiler Cache-Key: Länge + letzter Punkt auf 3-m-Raster. */
export function fogTrackCacheKey(
  track: Array<{ lat: number; lng: number }>,
  stepM: number = FOG_TRACK_STEP_M,
): string {
  const last = track[track.length - 1];
  if (!last) return '0';
  return `${track.length}:${quantizeMeters(last.lat, last.lng, stepM)}`;
}

/** Viewport-Key: Mitte auf 40-m-Raster + grobe Spannweite. */
export function fogBoundsCacheKey(
  bounds: FogBounds,
  stepM: number = FOG_VIEW_STEP_M,
): string {
  const midLat = (bounds.south + bounds.north) / 2;
  const midLng = (bounds.west + bounds.east) / 2;
  const spanM = Math.round(
    Math.hypot(
      (bounds.north - bounds.south) * 111_320,
      (bounds.east - bounds.west) * 111_320 * 0.6,
    ) / stepM,
  );
  return `${quantizeMeters(midLat, midLng, stepM)}:${spanM}`;
}

export function fogPolygonsToGeoJSON(polygons: FogPolygon[]): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: FogPolygon };
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: polygons.map((coordinates) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates },
    })),
  };
}
