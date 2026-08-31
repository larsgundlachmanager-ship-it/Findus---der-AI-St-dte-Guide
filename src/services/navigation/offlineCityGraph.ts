/**
 * Stadt-Graph Routing — ohne React Native (Smoke-Tests / Offline-Nav).
 */

export type OfflineCityRoute = {
  pathPoints: Array<{ lat: number; lng: number }>;
  distanceM: number;
  durationSec: number;
};

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestId(
  nodes: Array<{ i: string; a: number; o: number }>,
  lat: number,
  lng: number,
): string | null {
  let best: string | null = null;
  let bestD = 90;
  for (const n of nodes) {
    const d = haversine(lat, lng, n.a, n.o);
    if (d < bestD) {
      bestD = d;
      best = n.i;
    }
  }
  return best;
}

function dijkstra(
  nodes: Array<{ i: string; a: number; o: number }>,
  edges: Array<{ a: string; b: string; w: number }>,
  startId: string,
  endId: string,
): { ids: string[]; dist: number } | null {
  const adj = new Map<string, Array<{ to: string; w: number }>>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ to: e.b, w: e.w });
    adj.get(e.b)!.push({ to: e.a, w: e.w });
  }
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const pq: Array<[number, string]> = [[0, startId]];
  while (pq.length) {
    let minI = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i]![0] < pq[minI]![0]) minI = i;
    }
    const [d, u] = pq.splice(minI, 1)[0]!;
    if (d !== dist.get(u)) continue;
    if (u === endId) break;
    for (const { to, w } of adj.get(u) || []) {
      const nd = d + w;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, u);
        pq.push([nd, to]);
      }
    }
  }
  if (!dist.has(endId)) return null;
  const ids: string[] = [];
  let cur: string | undefined = endId;
  while (cur) {
    ids.push(cur);
    cur = prev.get(cur);
  }
  ids.reverse();
  return { ids, dist: dist.get(endId) ?? 0 };
}

function inBbox(
  lat: number,
  lng: number,
  b: { south: number; west: number; north: number; east: number },
  pad = 0.002,
): boolean {
  return (
    lat >= b.south - pad &&
    lat <= b.north + pad &&
    lng >= b.west - pad &&
    lng <= b.east + pad
  );
}

export function routeOnExtractGraph(
  extract: {
    bbox: { south: number; west: number; north: number; east: number };
    graph: {
      nodes: Array<{ i: string; a: number; o: number }>;
      edges: Array<{ a: string; b: string; w: number }>;
    };
  },
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  travelMode?: 'walking' | 'bicycling' | 'transit' | string,
): OfflineCityRoute | null {
  if (travelMode === 'transit') return null;
  if (!extract?.graph?.nodes?.length || !extract.graph.edges?.length) {
    return null;
  }
  if (
    !inBbox(origin.lat, origin.lng, extract.bbox) ||
    !inBbox(dest.lat, dest.lng, extract.bbox)
  ) {
    return null;
  }
  const start = nearestId(extract.graph.nodes, origin.lat, origin.lng);
  const end = nearestId(extract.graph.nodes, dest.lat, dest.lng);
  if (!start || !end) return null;
  const path = dijkstra(extract.graph.nodes, extract.graph.edges, start, end);
  if (!path || path.ids.length < 2) return null;
  const byId = new Map(extract.graph.nodes.map((n) => [n.i, n]));
  const pts = path.ids
    .map((id) => byId.get(id))
    .filter((n): n is { i: string; a: number; o: number } => !!n)
    .map((n) => ({ lat: n.a, lng: n.o }));
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (haversine(origin.lat, origin.lng, first.lat, first.lng) > 8) {
    pts.unshift({ lat: origin.lat, lng: origin.lng });
  }
  if (haversine(dest.lat, dest.lng, last.lat, last.lng) > 8) {
    pts.push({ lat: dest.lat, lng: dest.lng });
  }
  const isBike = travelMode === 'bicycling';
  const mPerMin = isBike ? 220 : 80;
  return {
    pathPoints: pts,
    distanceM: path.dist,
    durationSec: Math.max(30, Math.round((path.dist / mPerMin) * 60)),
  };
}
