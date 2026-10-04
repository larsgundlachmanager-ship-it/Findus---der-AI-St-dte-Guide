/**
 * Danzig coverage: OSM-Admin (Relation) minus offene Ostsee/Bucht-Wasser.
 * Land + Hafen + kleine Küstenlinie bleiben; hart detailreich.
 *
 *   node .cursor/_clip_danzig_water.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import polygonClipping from 'polygon-clipping';

const ROOT = process.cwd();
const PACK = join(ROOT, 'data/staedte/danzig.json');
const UA = 'YorroDanzigClip/1.0 (overpass land clip)';
const REL = 1553098;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function overpass(query) {
  const body = `data=${encodeURIComponent(query)}`;
  const urls = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

/** OSM geom ways → [lng,lat] rings (closed). */
function ringsFromOverpassElements(elements) {
  const rings = [];
  for (const el of elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 4) {
      continue;
    }
    const ring = el.geometry.map((g) => [Number(g.lon), Number(g.lat)]);
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function latLngRingFromLngLat(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  if (out.length >= 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-12 && Math.abs(f[1] - l[1]) < 1e-12) {
      out.pop();
    }
  }
  return out;
}

function bboxOf(poly) {
  let latMin = 90,
    latMax = -90,
    lngMin = 180,
    lngMax = -180;
  for (const [lat, lng] of poly) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lng < lngMin) lngMin = lng;
    if (lng > lngMax) lngMax = lng;
  }
  return { latMin, latMax, lngMin, lngMax };
}

function areaAbs(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[(i + 1) % ring.length];
    a += lng1 * lat2 - lng2 * lat1;
  }
  return Math.abs(a) * 0.5;
}

/** Open-bay rectangle to subtract if Overpass water is thin (safety). */
function gulfWaterBox() {
  // Bay north of Brzeźno / Nowy Port beaches into open water — keep a ~300m fringe.
  // lat 54.412+ and lng 18.55–18.85 is mostly bay water in admin blob.
  return [
    [
      [18.55, 54.412],
      [18.88, 54.412],
      [18.95, 54.52],
      [18.55, 54.55],
      [18.55, 54.412],
    ],
  ];
}

function farEastWaterBox() {
  // NE spike past Sobieszewo into open gulf
  return [
    [
      [18.98, 54.40],
      [19.12, 54.40],
      [19.12, 54.58],
      [18.98, 54.58],
      [18.98, 54.40],
    ],
  ];
}

async function main() {
  console.log('[danzig] fetch admin relation', REL);
  const adminQ = `
[out:json][timeout:120];
relation(${REL});
out geom;
`;
  const adminData = await overpass(adminQ);
  // Build multipolygon from outer ways is hard from geom-only relation.
  // Fallback: Nominatim lookup already written — use pack polygon as base, subtract water.

  const pack = JSON.parse(readFileSync(PACK, 'utf8'));
  let base = pack._coverage?.polygon;
  if (!Array.isArray(base) || base.length < 6) {
    throw new Error('no coverage polygon');
  }

  // Prefer denser Nominatim admin already in pack after previous script (2026 pts).
  console.log('[danzig] base pts', base.length, bboxOf(base));

  // Water ways inside bbox
  const bb = bboxOf(base);
  const south = bb.latMin - 0.02;
  const north = bb.latMax + 0.05;
  const west = bb.lngMin - 0.02;
  const east = bb.lngMax + 0.05;
  console.log('[danzig] fetch water in bbox');
  await sleep(1200);
  const waterQ = `
[out:json][timeout:120];
(
  way["natural"="water"](${south},${west},${north},${east});
  way["water"="sea"](${south},${west},${north},${east});
  way["water"="bay"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
);
out geom;
`;
  let waterRings = [];
  try {
    const waterData = await overpass(waterQ);
    waterRings = ringsFromOverpassElements(waterData.elements);
    console.log('[danzig] water rings from ways', waterRings.length);
  } catch (e) {
    console.warn('[danzig] water fetch failed', e?.message || e);
  }

  // Admin as polygon-clipping geom [lng,lat]
  const adminGeom = [[base.map(([lat, lng]) => [lng, lat])]];
  // close
  {
    const r = adminGeom[0][0];
    const a = r[0];
    const b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  }

  const waterGeom = [];
  for (const ring of waterRings) {
    if (ring.length >= 4) waterGeom.push([ring]);
  }
  // Always subtract safety boxes for open bay / NE spike
  waterGeom.push(gulfWaterBox());
  waterGeom.push(farEastWaterBox());

  console.log('[danzig] difference water polys', waterGeom.length);
  let result;
  try {
    result = polygonClipping.difference(adminGeom, waterGeom);
  } catch (e) {
    console.warn('[danzig] difference failed, subtract boxes only', e?.message || e);
    result = polygonClipping.difference(adminGeom, [
      gulfWaterBox(),
      farEastWaterBox(),
    ]);
  }

  if (!result?.length) {
    throw new Error('clip produced empty geometry');
  }

  // Pick largest polygon (main city land)
  let best = null;
  let bestArea = -1;
  for (const poly of result) {
    const outer = poly[0];
    if (!outer || outer.length < 6) continue;
    const ring = latLngRingFromLngLat(outer);
    const a = areaAbs(ring);
    if (a > bestArea) {
      bestArea = a;
      best = { ring, holes: poly.slice(1).map((h) => latLngRingFromLngLat(h)) };
    }
  }
  if (!best) throw new Error('no outer ring');

  // Keep holes only if meaningful (enclaves) — MapLibre fill supports holes via exclusiveCityRings separately;
  // coverage polygon is single outer ring in pack schema.
  const finalRing = best.ring;
  const finalBbox = bboxOf(finalRing);
  pack._coverage = {
    ...(pack._coverage || {}),
    ...finalBbox,
    polygon: finalRing,
  };
  writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n', 'utf8');

  const gj = {
    type: 'Feature',
    properties: { name: 'danzig_land', pts: finalRing.length },
    geometry: {
      type: 'Polygon',
      coordinates: [
        finalRing.map(([lat, lng]) => [lng, lat]).concat([
          [finalRing[0][1], finalRing[0][0]],
        ]),
      ],
    },
  };
  writeFileSync(
    join(ROOT, '.cursor/_danzig_coverage_clipped.geojson'),
    JSON.stringify(gj),
    'utf8',
  );
  console.log(
    '[danzig] done pts=',
    finalRing.length,
    'bbox=',
    finalBbox,
    'holes_ignored=',
    best.holes.length,
  );
  console.log('[danzig] admin elements', adminData?.elements?.length ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
