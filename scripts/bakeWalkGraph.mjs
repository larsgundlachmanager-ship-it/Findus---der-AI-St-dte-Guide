/**
 * Bake OSM footways into a city pack for Smart Compass Phase 2.
 *
 * Usage:
 *   node scripts/bakeWalkGraph.mjs wangerooge
 *   node scripts/bakeWalkGraph.mjs prisdorf --no-overpass
 *
 * Writes:
 *   data/staedte/<city>.walk.json  — full walk_graph (nodes/edges)
 *   Patches nav_waypoints onto spots in data/staedte/<city>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchOverpass, sleep } from './geo/osm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAEDTE = path.join(ROOT, 'data', 'staedte');

const HIGHWAYS = [
  'footway',
  'path',
  'pedestrian',
  'steps',
  'living_street',
  'residential',
  'service',
  'track',
  'cycleway',
  'unclassified',
  'tertiary',
  'secondary',
];

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function spotCentroid(spot, triggerById) {
  const poly = spot.polygonCoordinates ?? spot.polygon;
  if (Array.isArray(poly) && poly.length) {
    let lat = 0;
    let lng = 0;
    for (const p of poly) {
      lat += p.latitude ?? p.lat;
      lng += p.longitude ?? p.lng;
    }
    return { lat: lat / poly.length, lng: lng / poly.length };
  }
  if (spot.id && triggerById.has(spot.id)) {
    const t = triggerById.get(spot.id);
    if (typeof t.lat === 'number' && typeof t.lng === 'number') {
      return { lat: t.lat, lng: t.lng };
    }
  }
  return null;
}

function packBBox(pack) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  const triggerById = new Map(
    (pack.trigger_points ?? []).map((t) => [t.id, t]),
  );

  const consider = (lat, lng) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  };

  for (const spot of pack.spots ?? []) {
    const c = spotCentroid(spot, triggerById);
    if (c) consider(c.lat, c.lng);
    for (const a of spot.approach_triggers ?? spot.approachTriggers ?? []) {
      consider(a.lat ?? a.latitude, a.lng ?? a.longitude);
    }
  }
  for (const t of pack.trigger_points ?? []) {
    consider(t.lat, t.lng);
  }

  if (!Number.isFinite(minLat)) {
    consider(pack.lat, pack.lng);
  }

  // Prefer compact island/city bbox around pack center when outliers exist
  if (typeof pack.lat === 'number' && typeof pack.lng === 'number') {
    const maxSpanM = 3500;
    const dLat = maxSpanM / 111_320;
    const dLng =
      maxSpanM / (111_320 * Math.cos((pack.lat * Math.PI) / 180));
    minLat = Math.max(minLat, pack.lat - dLat);
    maxLat = Math.min(maxLat, pack.lat + dLat);
    minLng = Math.max(minLng, pack.lng - dLng);
    maxLng = Math.min(maxLng, pack.lng + dLng);
  }

  // ~250 m padding
  const padLat = 250 / 111_320;
  const midLat = (minLat + maxLat) / 2;
  const padLng = 250 / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: minLat - padLat,
    north: maxLat + padLat,
    west: minLng - padLng,
    east: maxLng + padLng,
  };
}

function buildGraphFromOverpass(data) {
  const nodesById = new Map();
  for (const el of data.elements || []) {
    if (el.type === 'node') {
      nodesById.set(String(el.id), { id: String(el.id), lat: el.lat, lng: el.lon });
    }
  }

  const edges = [];
  const usedNodes = new Set();

  for (const el of data.elements || []) {
    if (el.type !== 'way' || !el.nodes?.length) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = String(el.nodes[i]);
      const b = String(el.nodes[i + 1]);
      const na = nodesById.get(a);
      const nb = nodesById.get(b);
      if (!na || !nb) continue;
      const w = haversine(na.lat, na.lng, nb.lat, nb.lng);
      if (w <= 0 || w > 400) continue;
      edges.push({ a, b, w });
      usedNodes.add(a);
      usedNodes.add(b);
    }
  }

  const nodes = [...usedNodes].map((id) => nodesById.get(id)).filter(Boolean);
  return { nodes, edges };
}

function nearestNodeId(graph, lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = haversine(lat, lng, n.lat, n.lng);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/** Dijkstra shortest path → list of {lat,lng}. */
function shortestPath(graph, startId, endId) {
  if (!startId || !endId) return [];
  if (startId === endId) {
    const n = graph.nodes.find((x) => x.id === startId);
    return n ? [{ lat: n.lat, lng: n.lng }] : [];
  }

  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ to: e.b, w: e.w });
    adj.get(e.b).push({ to: e.a, w: e.w });
  }

  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const pq = [[0, startId]];

  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
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

  if (!dist.has(endId)) return [];

  const chain = [];
  let cur = endId;
  while (cur) {
    chain.push(cur);
    cur = prev.get(cur);
  }
  chain.reverse();

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return chain
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((n) => ({ lat: n.lat, lng: n.lng }));
}

/** Sample air-line every ~40 m. */
function airLineSamples(from, to, stepM = 40) {
  const total = haversine(from.lat, from.lng, to.lat, to.lng);
  if (total < 15) return [];
  const n = Math.max(1, Math.floor(total / stepM));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    out.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    });
  }
  // include a mid approach if far
  if (out.length === 0 && total >= 30) {
    out.push({
      lat: (from.lat + to.lat) / 2,
      lng: (from.lng + to.lng) / 2,
    });
  }
  return out;
}

/** Decimate path to ~40 m spacing, drop start, keep points approaching end. */
function decimatePath(points, stepM = 40) {
  if (points.length <= 2) return points.slice(1, -1);
  const out = [];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (haversine(last.lat, last.lng, p.lat, p.lng) >= stepM) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

function waypointsForSpot(spot, dest, graph) {
  const approaches = spot.approach_triggers ?? spot.approachTriggers ?? [];
  // Prefer farthest approach as start
  let start = null;
  let bestD = -1;
  for (const a of approaches) {
    const lat = a.lat ?? a.latitude;
    const lng = a.lng ?? a.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const d = haversine(lat, lng, dest.lat, dest.lng);
    if (d > bestD) {
      bestD = d;
      start = { lat, lng };
    }
  }
  if (!start) {
    // ~80 m south synthetic start
    start = { lat: dest.lat - 80 / 111_320, lng: dest.lng };
  }

  if (graph?.nodes?.length) {
    const aId = nearestNodeId(graph, start.lat, start.lng);
    const bId = nearestNodeId(graph, dest.lat, dest.lng);
    const path = shortestPath(graph, aId, bId);
    if (path.length >= 2) {
      const dec = decimatePath(path, 40);
      if (dec.length) return dec;
    }
  }

  return airLineSamples(start, dest, 40);
}

async function fetchWalkGraph(bbox) {
  const hwFilter = HIGHWAYS.map((h) => `way["highway"="${h}"]`).join('');
  const query = `
    [out:json][timeout:90];
    (
      ${HIGHWAYS.map(
        (h) =>
          `way(${bbox.south},${bbox.west},${bbox.north},${bbox.east})["highway"="${h}"];`,
      ).join('\n')}
      way(${bbox.south},${bbox.west},${bbox.north},${bbox.east})["highway"]["foot"="yes"];
    );
    (._;>;);
    out body;
  `;
  void hwFilter;
  const data = await fetchOverpass(query);
  return buildGraphFromOverpass(data);
}

async function main() {
  const cityId = (process.argv[2] || 'wangerooge').toLowerCase();
  const noOverpass = process.argv.includes('--no-overpass');
  const packPath = path.join(STAEDTE, `${cityId}.json`);
  if (!fs.existsSync(packPath)) {
    console.error(`Pack not found: ${packPath}`);
    process.exit(1);
  }

  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const triggerById = new Map(
    (pack.trigger_points ?? []).map((t) => [t.id, t]),
  );
  const bbox = packBBox(pack);
  console.log(`[bake:walk] ${cityId} bbox`, bbox);

  let graph = { nodes: [], edges: [] };
  if (!noOverpass) {
    try {
      console.log('[bake:walk] fetching Overpass footways…');
      graph = await fetchWalkGraph(bbox);
      console.log(
        `[bake:walk] graph nodes=${graph.nodes.length} edges=${graph.edges.length}`,
      );
    } catch (err) {
      console.warn('[bake:walk] Overpass failed, air-line waypoints only:', err.message);
    }
  } else {
    console.log('[bake:walk] --no-overpass → air-line waypoints only');
  }

  const spotWaypoints = {};
  let patched = 0;
  for (const spot of pack.spots ?? []) {
    const dest = spotCentroid(spot, triggerById);
    if (!dest) continue;
    const wps = waypointsForSpot(spot, dest, graph);
    if (!wps.length) continue;
    spot.nav_waypoints = wps;
    spotWaypoints[spot.id || spot.name] = wps;
    patched += 1;
  }

  const walkOut = {
    city_id: cityId,
    baked_at: new Date().toISOString(),
    bbox,
    walk_graph: {
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges,
    },
    spot_waypoints: spotWaypoints,
  };

  const walkPath = path.join(STAEDTE, `${cityId}.walk.json`);
  fs.writeFileSync(walkPath, JSON.stringify(walkOut, null, 2), 'utf8');
  console.log(`[bake:walk] wrote ${walkPath}`);

  fs.writeFileSync(packPath, JSON.stringify(pack, null, 2), 'utf8');
  console.log(`[bake:walk] patched nav_waypoints on ${patched} spots → ${packPath}`);
  await sleep(100);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
