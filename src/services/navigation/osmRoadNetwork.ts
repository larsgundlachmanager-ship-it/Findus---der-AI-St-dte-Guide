/**
 * OSM-Straßennetz für die Fog-Karte — goldene Wege auf App-Grün, ohne Raster-Tiles.
 */

export type MapRoadKind = 'major' | 'street' | 'path';

export type MapRoad = {
  latlngs: Array<[number, number]>;
  kind: MapRoadKind;
  name: string | null;
};

type OverpassWay = {
  type?: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

const FETCH_MS = 12_000;
const cache = new Map<string, MapRoad[]>();

const MAJOR_RE = /^(motorway|trunk|primary|secondary)$/;
const STREET_RE = /^(tertiary|unclassified|residential|living_street)$/;
const PATH_RE = /^(service|footway|path|cycleway|pedestrian|track)$/;

function kindOf(highway: string): MapRoadKind | null {
  if (MAJOR_RE.test(highway)) return 'major';
  if (STREET_RE.test(highway)) return 'street';
  if (PATH_RE.test(highway)) return 'path';
  return null;
}

function quantKey(
  south: number,
  west: number,
  north: number,
  east: number,
  zoom: number,
): string {
  const step = zoom >= 16 ? 0.006 : zoom >= 14 ? 0.012 : 0.03;
  const q = (n: number) => (Math.floor(n / step) * step).toFixed(3);
  return `${q(south)}:${q(west)}:${q(north)}:${q(east)}:z${zoom >= 15 ? 15 : 13}`;
}

function simplify(
  pts: Array<[number, number]>,
  minM: number,
): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const out: Array<[number, number]> = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    const dLat = (cur[0] - prev[0]) * 111_320;
    const dLng =
      (cur[1] - prev[1]) * 111_320 * Math.cos((cur[0] * Math.PI) / 180);
    if (Math.hypot(dLat, dLng) >= minM) out.push(cur);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

async function postOverpass(
  query: string,
  signal: AbortSignal,
): Promise<OverpassWay[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: OverpassWay[] };
      return data.elements ?? [];
    } catch {
      if (signal.aborted) break;
    }
  }
  return [];
}

function padBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  pad = 0.12,
): { s: number; w: number; n: number; e: number } {
  const dLat = (north - south) * pad;
  const dLng = (east - west) * pad;
  return {
    s: south - dLat,
    w: west - dLng,
    n: north + dLat,
    e: east + dLng,
  };
}

/**
 * Straßen im Ausschnitt. Zoom < 14: nur Haupt+Wohn; sonst inkl. Wege.
 */
export async function fetchOsmRoadsInBbox(opts: {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
}): Promise<MapRoad[]> {
  const zoom = Math.max(11, Math.min(19, Math.round(opts.zoom)));
  const key = quantKey(opts.south, opts.west, opts.north, opts.east, zoom);
  const hit = cache.get(key);
  if (hit) return hit;

  const box = padBbox(opts.south, opts.west, opts.north, opts.east);
  const hw =
    zoom >= 15
      ? 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|footway|path|cycleway|pedestrian'
      : 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street';
  const query = `[out:json][timeout:12];way["highway"~"^(${hw})$"](${box.s},${box.w},${box.n},${box.e});out geom;`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const els = await postOverpass(query, ctrl.signal);
    const minM = zoom >= 16 ? 6 : 12;
    const out: MapRoad[] = [];
    for (const el of els) {
      if (el.type !== 'way') continue;
      const hwTag = (el.tags?.highway ?? '').toLowerCase();
      const kind = kindOf(hwTag);
      if (!kind) continue;
      const geom = el.geometry;
      if (!Array.isArray(geom) || geom.length < 2) continue;
      const raw: Array<[number, number]> = [];
      for (const p of geom) {
        if (
          typeof p.lat === 'number' &&
          typeof p.lon === 'number' &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon)
        ) {
          raw.push([p.lat, p.lon]);
        }
      }
      const latlngs = simplify(raw, minM);
      if (latlngs.length < 2) continue;
      const name = (el.tags?.name ?? '').trim();
      out.push({
        latlngs,
        kind,
        name: name.length >= 3 ? name : null,
      });
    }
    cache.set(key, out);
    return out;
  } finally {
    clearTimeout(timer);
  }
}
