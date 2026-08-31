/**
 * Stadt-Extract → GeoJSON für native ShapeSources (lng/lat).
 */

import type { CityMapExtract } from './cityMapExtract';

export type GeoJsonFc = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

export type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, string | number | boolean | null>;
  geometry:
    | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
    | { type: 'LineString'; coordinates: Array<[number, number]> }
    | { type: 'Point'; coordinates: [number, number] };
};

export type ExtractGeojsonBundle = {
  land: GeoJsonFc;
  woods: GeoJsonFc;
  parks: GeoJsonFc;
  water: GeoJsonFc;
  buildings: GeoJsonFc;
  rails: GeoJsonFc;
  roads: GeoJsonFc;
  housenumbers: GeoJsonFc;
  streets: GeoJsonFc;
  hasRoads: boolean;
};

const EMPTY: GeoJsonFc = {
  type: 'FeatureCollection',
  features: [],
};

function closeLngLat(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 3) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return ring.concat([a]);
}

/** Pack-Ring ist [lat, lng] → GeoJSON [lng, lat]. */
export function extractRingToLngLat(
  ring: Array<[number, number]> | undefined,
): Array<[number, number]> | null {
  if (!ring || ring.length < 3) return null;
  const coords = ring.map((p) => [p[1], p[0]] as [number, number]);
  return closeLngLat(coords);
}

function polygonsFromRings(
  rings: Array<Array<[number, number]>> | undefined,
): GeoJsonFc {
  if (!rings?.length) return EMPTY;
  const features: GeoJsonFeature[] = [];
  for (const ring of rings) {
    const coords = extractRingToLngLat(ring);
    if (!coords) continue;
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coords] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function linesFromExtract(
  lines:
    | Array<Array<[number, number]> | { k?: number; n?: string; c?: Array<[number, number]> }>
    | undefined,
  kindProp = false,
): GeoJsonFc {
  if (!lines?.length) return EMPTY;
  const features: GeoJsonFeature[] = [];
  for (const line of lines) {
    const pts = Array.isArray(line) ? line : line.c;
    const k = Array.isArray(line) ? 1 : (line.k ?? 1);
    const n = Array.isArray(line) ? '' : String(line.n || '');
    if (!pts || pts.length < 2) continue;
    const coords = pts.map((p) => [p[1], p[0]] as [number, number]);
    features.push({
      type: 'Feature',
      properties: kindProp ? { k, n } : n ? { n } : {},
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return {
    type: 'FeatureCollection',
    features: kindProp ? mergeNamedRoadFeatures(features) : features,
  };
}

/** ~12 m — OSM-Segmente mit gleichem Namen zu einer Linie für Label-Fit. */
const ROAD_JOIN_DEG = 0.00011;

function ptsClose(
  a: [number, number],
  b: [number, number],
  eps = ROAD_JOIN_DEG,
): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

/**
 * Benannte Straßensegmente verbinden — sonst sitzt der Name auf einem
 * 20-m-Stück und wirkt neben der Straße / abgeschnitten.
 */
export function mergeNamedRoadFeatures(
  features: GeoJsonFeature[],
): GeoJsonFeature[] {
  const unnamed: GeoJsonFeature[] = [];
  const byKey = new Map<string, Array<{ coords: Array<[number, number]>; props: GeoJsonFeature['properties'] }>>();
  for (const f of features) {
    if (f.geometry.type !== 'LineString') {
      unnamed.push(f);
      continue;
    }
    const n = String(f.properties?.n || '').trim();
    if (n.length < 2) {
      unnamed.push(f);
      continue;
    }
    const k = Number(f.properties?.k ?? 1);
    const key = `${k}|${n.toLowerCase()}`;
    const row = byKey.get(key) ?? [];
    row.push({ coords: f.geometry.coordinates.slice(), props: f.properties });
    byKey.set(key, row);
  }
  const out: GeoJsonFeature[] = [...unnamed];
  for (const rows of byKey.values()) {
    const segs = rows;
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const a = segs[i]!;
          const b = segs[j]!;
          const a0 = a.coords[0]!;
          const a1 = a.coords[a.coords.length - 1]!;
          const b0 = b.coords[0]!;
          const b1 = b.coords[b.coords.length - 1]!;
          let next: Array<[number, number]> | null = null;
          if (ptsClose(a1, b0)) next = a.coords.concat(b.coords.slice(1));
          else if (ptsClose(a1, b1)) {
            next = a.coords.concat(b.coords.slice().reverse().slice(1));
          } else if (ptsClose(a0, b1)) next = b.coords.concat(a.coords.slice(1));
          else if (ptsClose(a0, b0)) {
            next = b.coords.slice().reverse().concat(a.coords.slice(1));
          }
          if (!next) continue;
          a.coords = next;
          segs.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
    for (const s of segs) {
      out.push({
        type: 'Feature',
        properties: s.props,
        geometry: { type: 'LineString', coordinates: s.coords },
      });
    }
  }
  return out;
}

function streetLabelsFromHousenumbers(
  housenumbers: CityMapExtract['housenumbers'] | undefined,
): GeoJsonFc {
  if (!housenumbers?.length) return EMPTY;
  const buckets = new Map<string, { lat: number; lng: number; n: number }>();
  for (const h of housenumbers) {
    const name = String(h.s || '').trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { lat: h.lat, lng: h.lng, n: 1 });
      continue;
    }
    cur.lat += h.lat;
    cur.lng += h.lng;
    cur.n += 1;
  }
  const features: GeoJsonFeature[] = [];
  for (const [key, b] of buckets) {
    if (b.n < 1) continue;
    const name = housenumbers.find((h) => String(h.s || '').toLowerCase() === key)?.s || key;
    features.push({
      type: 'Feature',
      properties: { n: name },
      geometry: {
        type: 'Point',
        coordinates: [b.lng / b.n, b.lat / b.n],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** core = Straßen/Wasser/Parks (erster Paint); full = +Gebäude/Hausnummern. */
export type ExtractGeojsonPhase = 'core' | 'full';

export function cityMapExtractToGeojson(
  extract: CityMapExtract | null | undefined,
  phase: ExtractGeojsonPhase = 'full',
): ExtractGeojsonBundle {
  if (!extract) {
    return {
      land: EMPTY,
      woods: EMPTY,
      parks: EMPTY,
      water: EMPTY,
      buildings: EMPTY,
      rails: EMPTY,
      roads: EMPTY,
      housenumbers: EMPTY,
      streets: EMPTY,
      hasRoads: false,
    };
  }
  const roads = linesFromExtract(extract.roads, true);
  const core: ExtractGeojsonBundle = {
    land: polygonsFromRings(extract.land),
    woods: polygonsFromRings(extract.woods),
    parks: polygonsFromRings(extract.parks),
    water: polygonsFromRings(extract.water),
    buildings: EMPTY,
    rails: linesFromExtract(extract.rails),
    roads,
    housenumbers: EMPTY,
    streets: EMPTY,
    hasRoads: (extract.roads?.length ?? 0) > 0,
  };
  if (phase === 'core') return core;

  const hnFeatures: GeoJsonFeature[] = [];
  for (const n of extract.housenumbers || []) {
    if (typeof n.lat !== 'number' || typeof n.lng !== 'number') continue;
    hnFeatures.push({
      type: 'Feature',
      properties: { n: String(n.n || ''), s: String(n.s || '') },
      geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
    });
  }
  // Straßennamen aus Road-Geometrie (für Line-Labels) — HN nur Fallback wenn Straße ohne Name.
  const namedRoadKeys = new Set(
    (roads.features || [])
      .map((f) => String(f.properties?.n || '').trim().toLowerCase())
      .filter((n) => n.length >= 2),
  );
  const streetFallback = streetLabelsFromHousenumbers(extract.housenumbers);
  const streetFallbackFiltered: GeoJsonFc = {
    type: 'FeatureCollection',
    features: (streetFallback.features || []).filter((f) => {
      const key = String(f.properties?.n || '').trim().toLowerCase();
      return key.length >= 2 && !namedRoadKeys.has(key);
    }),
  };
  return {
    ...core,
    buildings: polygonsFromRings(extract.buildings),
    housenumbers: { type: 'FeatureCollection', features: hnFeatures },
    streets: streetFallbackFiltered,
  };
}

export function emptyExtractGeojson(): ExtractGeojsonBundle {
  return cityMapExtractToGeojson(null);
}
