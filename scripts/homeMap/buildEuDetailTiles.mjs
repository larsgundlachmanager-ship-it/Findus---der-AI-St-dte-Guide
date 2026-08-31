/**
 * Build EU regional fallback tiles (~12 MB total, excluding DE bbox) into scripts output.
 * Run: node scripts/homeMap/buildEuDetailTiles.mjs
 * Upload: npm run upload:regional-map-tiles
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/homeMap/out/eu');

const BASES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
];

async function fetchJson(name) {
  for (const base of BASES) {
    const url = base + name;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* try next */
    }
  }
  throw new Error(`fetch failed: ${name}`);
}

function inDe(lng, lat) {
  return lng > 5.5 && lng < 15.4 && lat > 47.2 && lat < 55.2;
}

function inEu(lng, lat) {
  return lng > -12 && lng < 32 && lat > 35 && lat < 72;
}

function inEuOutsideDe(lng, lat) {
  return inEu(lng, lat) && !inDe(lng, lat);
}

function tileId(west, south) {
  return `tile_${Math.round(west * 10)}_${Math.round(south * 10)}`;
}

async function main() {
  const places = await fetchJson('ne_10m_populated_places.geojson');
  const roads = await fetchJson('ne_10m_roads.geojson');
  const urban = await fetchJson('ne_10m_urban_areas.geojson');
  const admin1 = await fetchJson('ne_10m_admin_1_states_provinces.geojson');
  const tiles = new Map();

  const push = (west, south, east, north, feature) => {
    const id = tileId(west, south);
    if (!tiles.has(id)) {
      tiles.set(id, {
        id,
        west,
        south,
        east,
        north,
        file: `${id}.json`,
        features: [],
      });
    }
    tiles.get(id).features.push(feature);
  };

  for (const f of places?.features ?? []) {
    const g = f.geometry;
    if (g?.type !== 'Point') continue;
    const lng = Number(g.coordinates?.[0]);
    const lat = Number(g.coordinates?.[1]);
    if (!inEuOutsideDe(lng, lat)) continue;
    const rank = Number(f.properties?.SCALERANK ?? 8);
    // Wie DE: bis Rank 8 — mehr Ortsnamen in FR/IT/ES/UK beim Rauszoomen
    if (rank > 8) continue;
    const tw = 1.4;
    push(lng - tw, lat - tw, lng + tw, lat + tw, f);
  }

  for (const f of roads?.features ?? []) {
    const g = f.geometry;
    const line =
      g?.type === 'LineString'
        ? g.coordinates
        : g?.type === 'MultiLineString'
          ? g.coordinates?.[0]
          : null;
    if (!line?.length) continue;
    const mid = line[line.length >> 1];
    const lng = Number(mid?.[0]);
    const lat = Number(mid?.[1]);
    if (!inEuOutsideDe(lng, lat)) continue;
    const scalerank = Number(f.properties?.SCALERANK ?? 10);
    // Etwas dichter als zuvor (≤6) — Hauptstraßen in EU besser erkennbar
    if (scalerank > 7) continue;
    const tw = 1.6;
    push(lng - tw, lat - tw, lng + tw, lat + tw, f);
  }

  for (const f of urban?.features ?? []) {
    const g = f.geometry;
    if (g?.type !== 'Polygon') continue;
    const ring = g.coordinates?.[0];
    if (!ring?.length) continue;
    let lng = 0;
    let lat = 0;
    for (const p of ring) {
      lng += Number(p[0]);
      lat += Number(p[1]);
    }
    lng /= ring.length;
    lat /= ring.length;
    if (!inEuOutsideDe(lng, lat)) continue;
    const tw = 2.0;
    push(lng - tw, lat - tw, lng + tw, lat + tw, f);
  }

  for (const f of admin1?.features ?? []) {
    const g = f.geometry;
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue;
    const ring =
      g.type === 'Polygon'
        ? g.coordinates?.[0]
        : g.coordinates?.[0]?.[0];
    if (!ring?.length) continue;
    let lng = 0;
    let lat = 0;
    let n = 0;
    for (const p of ring) {
      const plng = Number(p[0]);
      const plat = Number(p[1]);
      if (!inEuOutsideDe(plng, plat)) continue;
      lng += plng;
      lat += plat;
      n += 1;
    }
    if (n < 3) continue;
    lng /= n;
    lat /= n;
    const tw = 2.2;
    push(lng - tw, lat - tw, lng + tw, lat + tw, f);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const indexTiles = [];
  for (const tile of tiles.values()) {
    const fc = { type: 'FeatureCollection', features: tile.features };
    writeFileSync(join(OUT_DIR, tile.file), JSON.stringify(fc));
    indexTiles.push({
      id: tile.id,
      west: tile.west,
      south: tile.south,
      east: tile.east,
      north: tile.north,
      file: tile.file,
    });
  }
  writeFileSync(
    join(OUT_DIR, 'index.json'),
    JSON.stringify({ v: 1, tier: 'eu', tileDeg: 1.4, tiles: indexTiles }),
  );
  console.log('[eu-detail-tiles]', indexTiles.length, 'tiles →', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
