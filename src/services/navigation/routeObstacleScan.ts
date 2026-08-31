/**
 * OSM/Overpass: Bahnübergänge, Brücken, Treppen entlang der Fuß-/Rad-Route.
 */

import { distanceMeters } from './bearing';
import {
  summarizeRouteObstacles,
  type RouteObstacleHit,
  type RouteObstacleSummary,
} from './routeObstaclePolicy';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

const FETCH_MS = 12_000;
/** Feature gilt als „auf der Route“, wenn ≤ so nah an der Polyline. */
const NEAR_ROUTE_M = 42;
/** Polyline-Samples für Distanz-Check. */
const SAMPLE_EVERY_M = 45;

export type RoutePoint = { lat: number; lng: number };

function bboxOf(points: RoutePoint[], padDeg = 0.004): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    west = Math.min(west, p.lng);
    north = Math.max(north, p.lat);
    east = Math.max(east, p.lng);
  }
  return {
    south: south - padDeg,
    west: west - padDeg,
    north: north + padDeg,
    east: east + padDeg,
  };
}

function densify(points: RoutePoint[], everyM: number): RoutePoint[] {
  if (points.length < 2) return points.slice();
  const out: RoutePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = distanceMeters(a.lat, a.lng, b.lat, b.lng);
    const steps = Math.max(1, Math.ceil(d / everyM));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  return out;
}

function minDistToPolylineM(
  lat: number,
  lng: number,
  samples: RoutePoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of samples) {
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d < best) best = d;
  }
  return best;
}

function alongRouteM(
  lat: number,
  lng: number,
  samples: RoutePoint[],
): number {
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const d = distanceMeters(lat, lng, samples[i]!.lat, samples[i]!.lng);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  let along = 0;
  for (let i = 1; i <= bestI; i++) {
    along += distanceMeters(
      samples[i - 1]!.lat,
      samples[i - 1]!.lng,
      samples[i]!.lat,
      samples[i]!.lng,
    );
  }
  return along;
}

type OsmEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function overpassQuery(ql: string): Promise<OsmEl[]> {
  let lastErr: unknown;
  for (const ep of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(ql)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const data = (await res.json()) as { elements?: OsmEl[] };
      return data.elements ?? [];
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  if (__DEV__) console.warn('[routeObstacles] overpass failed', lastErr);
  return [];
}

function elPoint(el: OsmEl): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function isBridgeTag(t: Record<string, string>): boolean {
  const b = (t.bridge || '').toLowerCase();
  if (
    b === 'yes' ||
    b === 'viaduct' ||
    b === 'boardwalk' ||
    b === 'cantilever' ||
    b === 'movable' ||
    b === 'lifting' ||
    b === 'bascule' ||
    b === 'swing' ||
    b === 'covered'
  ) {
    return true;
  }
  return t.man_made === 'bridge';
}

/**
 * OSM-Heuristik: Fuß-/Radsteg vs. Straßenbrücke.
 * highway=footway|path|pedestrian|steps (+ ggf. cycleway mit Fuß) → Fußgängerbrücke.
 */
export function isPedestrianBridgeTags(t: Record<string, string>): boolean {
  if (!isBridgeTag(t)) return false;
  const hw = (t.highway || '').toLowerCase();
  if (
    hw === 'footway' ||
    hw === 'path' ||
    hw === 'pedestrian' ||
    hw === 'steps' ||
    hw === 'bridleway'
  ) {
    return true;
  }
  if (hw === 'cycleway') {
    const foot = (t.foot || '').toLowerCase();
    if (foot === 'no' || foot === 'private') return false;
    return true;
  }
  const foot = (t.foot || '').toLowerCase();
  const bicycle = (t.bicycle || '').toLowerCase();
  if (
    (foot === 'designated' || foot === 'yes') &&
    (!hw ||
      hw === 'service' ||
      hw === 'track' ||
      hw === 'unclassified' ||
      t.man_made === 'bridge')
  ) {
    // Keine echte Autobahn-/Hauptstraßenbrücke nur wegen Gehweg
    if (
      hw === 'motorway' ||
      hw === 'trunk' ||
      hw === 'primary' ||
      hw === 'secondary' ||
      hw === 'tertiary' ||
      hw === 'residential'
    ) {
      return false;
    }
    return true;
  }
  if (
    t.man_made === 'bridge' &&
    (foot === 'designated' || foot === 'yes' || bicycle === 'designated')
  ) {
    return true;
  }
  return false;
}

export function bridgeLabelFromTags(t: Record<string, string>): string {
  const name = (t.name || t['name:de'] || '').trim();
  if (name) return name;
  if (isPedestrianBridgeTags(t)) return 'Fußgängerbrücke';
  return 'Brücke';
}

function classify(el: OsmEl): RouteObstacleHit['kind'] | null {
  const t = el.tags ?? {};
  if (
    t.railway === 'level_crossing' ||
    t.railway === 'crossing' ||
    (t.crossing === 'railway' && t.highway)
  ) {
    return 'crossing';
  }
  if (t.highway === 'steps' && !isBridgeTag(t)) return 'stairs';
  if (isBridgeTag(t)) return 'bridge';
  return null;
}

/** Heuristik aus Directions-HTML/Instruction (ohne OSM). */
export function obstaclesFromInstructions(
  instructions: Array<string | null | undefined>,
): RouteObstacleHit[] {
  const hits: RouteObstacleHit[] = [];
  for (const raw of instructions) {
    const t = (raw ?? '').toLowerCase();
    if (!t) continue;
    if (/bahnübergang|bahnuebergang|level crossing|railroad crossing|schranke/.test(t)) {
      hits.push({ kind: 'crossing', lat: 0, lng: 0, label: 'Bahnübergang' });
    } else if (
      /fu[ßss]?g[äa]nger\s*br[uü]cke|fussgaengerbruecke|footbridge|pedestrian bridge|foot bridge/.test(
        t,
      )
    ) {
      hits.push({
        kind: 'bridge',
        lat: 0,
        lng: 0,
        label: 'Fußgängerbrücke',
      });
    } else if (/\bbrücke\b|\bbruecke\b|\bbridge\b/.test(t)) {
      hits.push({ kind: 'bridge', lat: 0, lng: 0, label: 'Brücke' });
    } else if (/\btreppe|\bstufen|\bstairs|\bsteps\b/.test(t)) {
      hits.push({ kind: 'stairs', lat: 0, lng: 0, label: 'Treppen' });
    }
  }
  return hits;
}

/**
 * Scannt die Route per Overpass (BBox) und filtert Features nah an der Polyline.
 */
export async function scanRouteObstacles(
  points: RoutePoint[],
): Promise<RouteObstacleSummary> {
  if (points.length < 2) {
    return summarizeRouteObstacles([]);
  }

  const samples = densify(points, SAMPLE_EVERY_M);
  const box = bboxOf(points);
  const ql = `
[out:json][timeout:12];
(
  node["railway"="level_crossing"](${box.south},${box.west},${box.north},${box.east});
  node["railway"="crossing"](${box.south},${box.west},${box.north},${box.east});
  node["crossing"="railway"](${box.south},${box.west},${box.north},${box.east});
  way["highway"="steps"](${box.south},${box.west},${box.north},${box.east});
  way["bridge"](${box.south},${box.west},${box.north},${box.east});
  way["man_made"="bridge"](${box.south},${box.west},${box.north},${box.east});
);
out center tags;
`.trim();

  const elements = await overpassQuery(ql);
  const hits: RouteObstacleHit[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const kind = classify(el);
    if (!kind) continue;
    const pt = elPoint(el);
    if (!pt) continue;
    if (minDistToPolylineM(pt.lat, pt.lng, samples) > (kind === 'bridge' ? 60 : NEAR_ROUTE_M)) continue;
    const key = `${kind}:${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = el.tags ?? {};
    const label =
      kind === 'crossing'
        ? 'Bahnübergang'
        : kind === 'bridge'
          ? bridgeLabelFromTags(tags)
          : 'Treppen';
    hits.push({
      kind,
      lat: pt.lat,
      lng: pt.lng,
      alongM: alongRouteM(pt.lat, pt.lng, samples),
      label,
    });
  }

  hits.sort((a, b) => (a.alongM ?? 0) - (b.alongM ?? 0));
  return summarizeRouteObstacles(hits);
}

/** Kombi: OSM + Instruction-Heuristik (Instruction nur zählen wenn OSM leer). */
export async function scanRouteObstaclesWithFallback(opts: {
  points: RoutePoint[];
  instructions?: Array<string | null | undefined>;
}): Promise<RouteObstacleSummary> {
  const osm = await scanRouteObstacles(opts.points);
  if (osm.hits.length > 0) return osm;
  const soft = obstaclesFromInstructions(opts.instructions ?? []);
  // Instruction-Hits ohne GPS — nur für Puffer zählen, kein Audio-Punkt
  return summarizeRouteObstacles(soft);
}
