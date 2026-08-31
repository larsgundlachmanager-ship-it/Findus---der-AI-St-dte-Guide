/**
 * Smooth city-boundary rings for map overlays (Chaikin-ish).
 * Keeps topology-ish shape, removes jagged Nominatim seams visually.
 */

export type LatLngPair = [number, number];

function dist2(a: LatLngPair, b: LatLngPair): number {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return dLat * dLat + dLng * dLng;
}

/** Drop near-duplicate consecutive vertices. */
export function dedupeRing(
  ring: LatLngPair[],
  epsDeg = 1e-5,
): LatLngPair[] {
  if (!ring.length) return [];
  const out: LatLngPair[] = [];
  const eps2 = epsDeg * epsDeg;
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || dist2(prev, p) > eps2) out.push([p[0], p[1]]);
  }
  if (out.length >= 2 && dist2(out[0]!, out[out.length - 1]!) <= eps2) {
    out.pop();
  }
  return out;
}

/**
 * One Chaikin pass: each edge → points at 25% / 75%.
 * Closed ring assumed (first≠last ok; we close after).
 */
export function chaikinOnce(ring: LatLngPair[]): LatLngPair[] {
  const pts = dedupeRing(ring);
  if (pts.length < 4) return pts;
  const n = pts.length;
  const out: LatLngPair[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
    out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}

/** Evenly keep ~n vertices (closed ring, first≠last). */
function evenDecimate(ring: LatLngPair[], maxPoints: number): LatLngPair[] {
  if (ring.length <= maxPoints) return ring;
  const slim: LatLngPair[] = [];
  const lastIdx = ring.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * lastIdx) / (maxPoints - 1));
    const p = ring[idx]!;
    const prev = slim[slim.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) slim.push(p);
  }
  return slim;
}

/**
 * Smooth admin boundary for map overlays.
 * iterations=3 roundet Nominatim-Zacken, ohne die Gemeindeform zu verlieren.
 */
export function smoothCityBoundaryRing(
  ring: LatLngPair[] | null | undefined,
  opts?: { iterations?: number; maxPoints?: number },
): LatLngPair[] | null {
  if (!ring || ring.length < 4) return ring ? [...ring] : null;
  const iterations = Math.max(0, Math.min(4, opts?.iterations ?? 3));
  const maxPoints = opts?.maxPoints ?? 420;
  let cur = dedupeRing(ring, 8e-6);
  for (let i = 0; i < iterations; i++) {
    if (cur.length >= maxPoints) break;
    cur = chaikinOnce(cur);
  }
  if (cur.length > maxPoints) cur = evenDecimate(cur, maxPoints);
  if (cur.length < 3) return dedupeRing(ring);
  const first = cur[0]!;
  const last = cur[cur.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cur = [...cur, [first[0], first[1]]];
  }
  return cur;
}
