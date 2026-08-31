/**
 * OSM-Bahnsteige + Gleisgeometrie für ÖPNV-Pins/Routen.
 * Feed-Koordinaten bleiben Quelle; OSM nur snap/füllen.
 */

export type PathCoord = { lat: number; lng: number };

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;
const FETCH_MS = 12_000;

function haversineM(a: PathCoord, b: PathCoord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function normalizePlatformRef(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/^(gleis|gl\.?|track|platform|steig)\s*/iu, '')
    .replace(/^0+/, '')
    .trim();
}

export function platformTagsMatch(
  tags: Record<string, string> | null | undefined,
  platform: string,
): boolean {
  const want = normalizePlatformRef(platform);
  if (!want) return false;
  const t = tags ?? {};
  const blob = [t.ref, t.local_ref, t.track, t['gtfs:track'], t['railway:track_ref']]
    .filter(Boolean)
    .join(';');
  return blob
    .split(/[;,/]/)
    .map((s) => normalizePlatformRef(s))
    .some((s) => s === want);
}

export function centroidOf(pts: PathCoord[]): PathCoord | null {
  if (!pts.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pts) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

type OsmEl = {
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  geometry?: Array<{ lat?: number; lon?: number }>;
  tags?: Record<string, string>;
};

function elCoord(el: OsmEl): PathCoord | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (typeof el.center?.lat === 'number' && typeof el.center?.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  const geom = (el.geometry ?? [])
    .map((g) =>
      typeof g.lat === 'number' && typeof g.lon === 'number'
        ? { lat: g.lat, lng: g.lon }
        : null,
    )
    .filter((p): p is PathCoord => p != null);
  return centroidOf(geom);
}

async function overpass(ql: string): Promise<OsmEl[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    for (const ep of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(ql)}`,
          signal: ctrl.signal,
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { elements?: OsmEl[] };
        return Array.isArray(data.elements) ? data.elements : [];
      } catch {
        if (ctrl.signal.aborted) break;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return [];
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function haltNameQuery(name: string): string {
  return tidyStationNeedle(name).slice(0, 40);
}

export function tidyStationNeedle(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(bahnhof|hbf|haltepunkt|haltestelle|station|bhf)\b/giu, '')
    .replace(/[(),]/g, ' ')
    .trim();
}

export type SnapHaltOpts = {
  name: string;
  lat: number;
  lng: number;
  platform?: string | null;
  /** bus = Bushaltestelle / SEV, sonst Bahn. */
  kind: 'rail' | 'bus';
};

/**
 * Pin auf Bahnsteig / Halt / Bussteig. Ohne Gleis → Bahnhofsmitte, nicht ein Gleisende.
 */
export async function snapTransitHalt(
  opts: SnapHaltOpts,
): Promise<PathCoord | null> {
  const here = { lat: opts.lat, lng: opts.lng };
  if (opts.kind === 'bus') {
    const ql = `[out:json][timeout:12];
(
  node(around:160,${opts.lat},${opts.lng})["highway"="bus_stop"];
  node(around:160,${opts.lat},${opts.lng})["public_transport"="platform"];
  way(around:160,${opts.lat},${opts.lng})["public_transport"="platform"];
  node(around:160,${opts.lat},${opts.lng})["amenity"="bus_station"];
);
out center;`;
    const els = await overpass(ql);
    let best: PathCoord | null = null;
    let bestD = 160;
    for (const el of els) {
      const c = elCoord(el);
      if (!c) continue;
      const d = haversineM(here, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  const nearby = `[out:json][timeout:12];
(
  node(around:220,${opts.lat},${opts.lng})["railway"~"^(station|halt)$"];
  node(around:220,${opts.lat},${opts.lng})["public_transport"="stop_position"];
  way(around:220,${opts.lat},${opts.lng})["railway"="platform"];
  node(around:220,${opts.lat},${opts.lng})["railway"="stop"];
);
out center geom;`;
  let els = await overpass(nearby);
  const needle = haltNameQuery(opts.name);
  if (!els.length && needle.length >= 3) {
    const named = `[out:json][timeout:12];
(
  node["railway"~"^(station|halt)$"]["name"~"${escapeReg(needle)}",i](around:4000,${opts.lat},${opts.lng});
  way["railway"~"^(station|halt)$"]["name"~"${escapeReg(needle)}",i](around:4000,${opts.lat},${opts.lng});
);
out center;`;
    els = await overpass(named);
  }

  const platforms: PathCoord[] = [];
  const matchedPlatforms: PathCoord[] = [];
  const stations: PathCoord[] = [];
  const stopPositions: PathCoord[] = [];
  for (const el of els) {
    const c = elCoord(el);
    if (!c) continue;
    const rw = (el.tags?.railway || '').toLowerCase();
    const pt = (el.tags?.public_transport || '').toLowerCase();
    if (rw === 'platform' || pt === 'platform') {
      platforms.push(c);
      if (opts.platform && platformTagsMatch(el.tags, opts.platform)) {
        matchedPlatforms.push(c);
      }
    } else if (rw === 'station' || rw === 'halt') {
      stations.push(c);
    } else if (pt === 'stop_position' || rw === 'stop') {
      if (opts.platform && platformTagsMatch(el.tags, opts.platform)) {
        matchedPlatforms.push(c);
      } else {
        stopPositions.push(c);
      }
    }
  }
  if (matchedPlatforms.length) return centroidOf(matchedPlatforms);
  if (stations.length) return centroidOf(stations);
  if (platforms.length) return centroidOf(platforms);
  if (stopPositions.length) return centroidOf(stopPositions);
  return null;
}

type NodeKey = string;
function keyOf(p: PathCoord): NodeKey {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/**
 * Kürzester Weg entlang OSM-Gleis-Ketten (keine Luftlinie).
 */
export function shortestRailPath(
  ways: PathCoord[][],
  from: PathCoord,
  to: PathCoord,
): PathCoord[] {
  const nodes = new Map<NodeKey, PathCoord>();
  const edges = new Map<NodeKey, Array<{ to: NodeKey; w: number }>>();
  const addNode = (p: PathCoord): NodeKey => {
    const k = keyOf(p);
    if (!nodes.has(k)) nodes.set(k, p);
    return k;
  };
  const addEdge = (a: PathCoord, b: PathCoord, maxM: number) => {
    const ka = addNode(a);
    const kb = addNode(b);
    if (ka === kb) return;
    const w = haversineM(a, b);
    if (w < 0.4 || w > maxM) return;
    const la = edges.get(ka) ?? [];
    la.push({ to: kb, w });
    edges.set(ka, la);
    const lb = edges.get(kb) ?? [];
    lb.push({ to: ka, w });
    edges.set(kb, lb);
  };
  for (const way of ways) {
    for (let i = 1; i < way.length; i += 1) addEdge(way[i - 1]!, way[i]!, 4500);
  }
  const ends: PathCoord[] = [];
  for (const way of ways) {
    if (way[0]) ends.push(way[0]);
    if (way.length > 1) ends.push(way[way.length - 1]!);
  }
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      if (haversineM(ends[i]!, ends[j]!) < 18) addEdge(ends[i]!, ends[j]!, 20);
    }
  }
  if (nodes.size < 4) return [];

  const nearest = (p: PathCoord): NodeKey | null => {
    let best: NodeKey | null = null;
    let bestD = 120;
    for (const [k, n] of nodes) {
      const d = haversineM(p, n);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const start = nearest(from);
  const goal = nearest(to);
  if (!start || !goal) return [];

  const dist = new Map<NodeKey, number>();
  const prev = new Map<NodeKey, NodeKey>();
  const open = new Set<NodeKey>([start]);
  dist.set(start, 0);
  while (open.size) {
    let u: NodeKey | null = null;
    let uD = Infinity;
    for (const k of open) {
      const d = dist.get(k) ?? Infinity;
      if (d < uD) {
        uD = d;
        u = k;
      }
    }
    if (u == null) break;
    open.delete(u);
    if (u === goal) break;
    for (const e of edges.get(u) ?? []) {
      const nd = uD + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
        open.add(e.to);
      }
    }
  }
  if (!prev.has(goal) && start !== goal) return [];
  const chain: PathCoord[] = [];
  let cur: NodeKey | undefined = goal;
  const guard = nodes.size + 4;
  let n = 0;
  while (cur && n < guard) {
    const p = nodes.get(cur);
    if (p) chain.push(p);
    if (cur === start) break;
    cur = prev.get(cur);
    n += 1;
  }
  chain.reverse();
  if (chain.length < 3) return [];
  const air = haversineM(from, to);
  const len = dist.get(goal) ?? 0;
  if (air > 80 && (len < air * 0.7 || len > air * 4.5)) return [];
  const out = [...chain];
  if (haversineM(from, out[0]!) > 8) out.unshift(from);
  if (haversineM(to, out[out.length - 1]!) > 8) out.push(to);
  return out;
}

const railCache = new Map<string, PathCoord[]>();

function railKey(a: PathCoord, b: PathCoord): string {
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
}

/** OSM railway=rail zwischen zwei Halten. */
export async function fetchOsmRailPath(
  from: PathCoord,
  to: PathCoord,
): Promise<PathCoord[]> {
  const key = railKey(from, to);
  const hit = railCache.get(key);
  if (hit) return hit;
  const air = haversineM(from, to);
  if (air < 40 || air > 80_000) {
    railCache.set(key, []);
    return [];
  }
  const pad = Math.min(0.02, Math.max(0.004, air / 111_320 / 4));
  const south = Math.min(from.lat, to.lat) - pad;
  const north = Math.max(from.lat, to.lat) + pad;
  const west = Math.min(from.lng, to.lng) - pad;
  const east = Math.max(from.lng, to.lng) + pad;
  const ql = `[out:json][timeout:20];
way["railway"="rail"](${south},${west},${north},${east});
out geom;`;
  const els = await overpass(ql);
  const ways: PathCoord[][] = [];
  for (const el of els) {
    const geom = (el.geometry ?? [])
      .map((g) =>
        typeof g.lat === 'number' && typeof g.lon === 'number'
          ? { lat: g.lat, lng: g.lon }
          : null,
      )
      .filter((p): p is PathCoord => p != null);
    if (geom.length >= 2) ways.push(geom);
  }
  const path = shortestRailPath(ways, from, to);
  railCache.set(key, path);
  return path;
}
