/**
 * Build DE regional fallback tiles (~6 MB total) into scripts output.
 * Run: node scripts/homeMap/buildDeDetailTiles.mjs
 * Copy resulting maps/de/ to device documentDirectory/maps/de/ on first online sync.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/homeMap/out/de');

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

function tileId(west, south) {
  return `tile_${Math.round(west * 10)}_${Math.round(south * 10)}`;
}

async function main() {
  const places = await fetchJson('ne_10m_populated_places.geojson');
  const roads = await fetchJson('ne_10m_roads.geojson');
  const urban = await fetchJson('ne_10m_urban_areas.geojson');
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
    if (!inDe(lng, lat)) continue;
    const rank = Number(f.properties?.SCALERANK ?? 8);
    if (rank > 8) continue;
    const tw = 1.2;
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
    if (!inDe(lng, lat)) continue;
    const tw = 1.5;
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
    if (!inDe(lng, lat)) continue;
    const tw = 1.8;
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
    JSON.stringify({ v: 1, tier: 'de', tileDeg: 1.2, tiles: indexTiles }),
  );
  console.log('[de-detail-tiles]', indexTiles.length, 'tiles →', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
