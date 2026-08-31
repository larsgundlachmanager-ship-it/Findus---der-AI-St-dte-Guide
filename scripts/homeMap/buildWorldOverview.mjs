/**
 * Kompaktes Offline-Weltpaket (Natural Earth, Public Domain) für die Homescreen-Karte.
 * Keine HTTP-Kacheln: Land, Seen, Ländergrenzen, grobe Stadtflächen.
 *
 * Run: node scripts/homeMap/buildWorldOverview.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'src/assets/homeMap/worldOverview.json');
const MUST_ISLANDS_FILE = join(ROOT, 'scripts/homeMap/deMustIslands.rings.json');
const DE_HYDRO = join(ROOT, 'scripts/homeMap/deHydro.geojson');

const BASES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
];

const FILES = {
  land: 'ne_50m_land.geojson',
  islandsFine: 'ne_10m_minor_islands.geojson',
  lakes: 'ne_50m_lakes.geojson',
  lakesFine: 'ne_10m_lakes.geojson',
  borders: 'ne_50m_admin_0_boundary_lines_land.geojson',
  bordersFine: 'ne_10m_admin_0_boundary_lines_land.geojson',
  urban: 'ne_50m_urban_areas.geojson',
  urbanFine: 'ne_10m_urban_areas.geojson',
  admin1Poly10: 'ne_10m_admin_1_states_provinces.geojson',
};

const EUROPE_ADM0 = new Set([
  'DEU',
  'AUT',
  'CHE',
  'NLD',
  'BEL',
  'LUX',
  'DNK',
  'POL',
  'CZE',
  'FRA',
  'ITA',
  'ESP',
  'PRT',
  'GBR',
  'IRL',
  'SWE',
  'NOR',
  'FIN',
  'GRC',
  'HUN',
  'ROU',
  'BGR',
  'HRV',
  'SVN',
  'SVK',
  'LTU',
  'LVA',
  'EST',
  'LIE',
]);

/** Fallback nur wenn Nominatim-Ringe fehlen — nie als Hauptquelle. */
const DE_MUST_ISLANDS_BOX_FALLBACK = [
  { n: 'Juist', ring: [[7.01, 53.66], [7.1, 53.66], [7.1, 53.7], [7.01, 53.7], [7.01, 53.66]] },
  { n: 'Norderney', ring: [[7.12, 53.69], [7.2, 53.69], [7.2, 53.73], [7.12, 53.73], [7.12, 53.69]] },
  { n: 'Langeoog', ring: [[7.46, 53.73], [7.52, 53.73], [7.52, 53.77], [7.46, 53.77], [7.46, 53.73]] },
  { n: 'Spiekeroog', ring: [[7.66, 53.75], [7.73, 53.75], [7.73, 53.79], [7.66, 53.79], [7.66, 53.75]] },
  { n: 'Wangerooge', ring: [[7.86, 53.77], [7.95, 53.77], [7.95, 53.81], [7.86, 53.81], [7.86, 53.77]] },
  { n: 'Helgoland', ring: [[7.87, 54.17], [7.92, 54.17], [7.92, 54.2], [7.87, 54.2], [7.87, 54.17]] },
];

function isAxisAlignedBoxRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 6) return false;
  const xs = new Set(ring.map((p) => p[0]));
  const ys = new Set(ring.map((p) => p[1]));
  return xs.size <= 2 && ys.size <= 2;
}

function loadMustIslandRings() {
  if (existsSync(MUST_ISLANDS_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(MUST_ISLANDS_FILE, 'utf8'));
      const list = Array.isArray(raw?.islands) ? raw.islands : [];
      const good = list.filter(
        (row) =>
          row?.n &&
          Array.isArray(row.ring) &&
          row.ring.length >= 8 &&
          !isAxisAlignedBoxRing(row.ring),
      );
      if (good.length >= 4) {
        console.log(
          '[world-overview] must-islands from rings file',
          good.map((g) => `${g.n}:${g.ring.length}`).join(', '),
        );
        return good;
      }
    } catch (err) {
      console.warn('[world-overview] rings file skip', err?.message || err);
    }
  }
  console.warn('[world-overview] using box fallback — run fetchDeMustIslands.mjs');
  return DE_MUST_ISLANDS_BOX_FALLBACK;
}

function mustIslandFeatures() {
  return loadMustIslandRings().map(({ n, ring }) =>
    feat(
      { type: 'Polygon', coordinates: [ring] },
      { n, manual: isAxisAlignedBoxRing(ring) ? 1 : 0 },
    ),
  );
}

/** Keine doppelten Rechtecke, wenn schon ein echter Küstenring da ist. */
function landCoversProbe(landFc, lng, lat) {
  for (const f of landFc.features ?? []) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring || isAxisAlignedBoxRing(ring)) continue;
    if (pointInRing(lng, lat, ring)) return true;
  }
  return false;
}

function filterMustIslandsAgainstLand(mustFc, landFc) {
  const probes = {
    Juist: [7.05, 53.68],
    Norderney: [7.15, 53.71],
    Langeoog: [7.49, 53.75],
    Spiekeroog: [7.695, 53.77],
    Wangerooge: [7.9, 53.79],
    Helgoland: [7.89, 54.18],
  };
  const features = [];
  for (const f of mustFc.features ?? []) {
    const n = String(f.properties?.n || '');
    const probe = probes[n];
    if (probe && landCoversProbe(landFc, probe[0], probe[1])) {
      console.log(`[world-overview] skip must-island ${n} (already in land)`);
      continue;
    }
    features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Radialer Abstand + Quantisierung — kein turf. */
function simplifyLine(pts, minDeg, places) {
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const min2 = minDeg * minDeg;
  const out = [];
  let last = null;
  for (const raw of pts) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const p = [round(Number(raw[0]), places), round(Number(raw[1]), places)];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (last && dist2(last, p) < min2) continue;
    out.push(p);
    last = p;
  }
  if (out.length >= 2) {
    const first = out[0];
    const end = pts[pts.length - 1];
    if (Array.isArray(end) && end.length >= 2) {
      const close = [round(Number(end[0]), places), round(Number(end[1]), places)];
      if (dist2(out[out.length - 1], close) >= min2) out.push(close);
    }
    if (first && out.length >= 3 && dist2(out[out.length - 1], first) === 0) {
      /* ring already closed */
    }
  }
  return out;
}

function closeRing(ring) {
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring.length >= 4 ? ring : null;
}

function ringSpan(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

function feat(geometry, properties = {}) {
  return { type: 'Feature', properties, geometry };
}

function polygonsFromGeometry(geom, minDeg, places, minSpan) {
  const out = [];
  if (!geom) return out;
  const pushRing = (ring) => {
    const simp = closeRing(simplifyLine(ring, minDeg, places));
    if (!simp) return;
    if (ringSpan(simp) < minSpan) return;
    out.push(feat({ type: 'Polygon', coordinates: [simp] }));
  };
  if (geom.type === 'Polygon') {
    const outer = geom.coordinates?.[0];
    if (outer) pushRing(outer);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates ?? []) {
      const outer = poly?.[0];
      if (outer) pushRing(outer);
    }
  }
  return out;
}

function linesFromGeometry(geom, minDeg, places) {
  const out = [];
  if (!geom) return out;
  const pushLine = (line) => {
    const simp = simplifyLine(line, minDeg, places);
    if (simp.length < 2) return;
    out.push(feat({ type: 'LineString', coordinates: simp }));
  };
  if (geom.type === 'LineString') pushLine(geom.coordinates);
  else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates ?? []) pushLine(line);
  }
  return out;
}

async function fetchJson(name) {
  let lastErr = null;
  for (const base of BASES) {
    const url = base + name;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`download failed: ${name}`);
}

function collectPolygons(fc, minDeg, places, minSpan) {
  const features = [];
  for (const f of fc?.features ?? []) {
    features.push(...polygonsFromGeometry(f.geometry, minDeg, places, minSpan));
  }
  return { type: 'FeatureCollection', features };
}

function collectLines(fc, minDeg, places) {
  const features = [];
  for (const f of fc?.features ?? []) {
    features.push(...linesFromGeometry(f.geometry, minDeg, places));
  }
  return { type: 'FeatureCollection', features };
}

function bboxOf(geom) {
  const pts = [];
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'Polygon') {
      for (const r of g.coordinates ?? []) for (const p of r) pts.push(p);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates ?? []) {
        for (const r of poly) for (const p of r) pts.push(p);
      }
    } else if (g.type === 'LineString') {
      for (const p of g.coordinates ?? []) pts.push(p);
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates ?? []) for (const p of line) pts.push(p);
    }
  };
  walk(geom);
  if (!pts.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, maxX, minY, maxY, span: Math.hypot(maxX - minX, maxY - minY) };
}

/** Einzelne Polygon-Teile (MultiPolygon → viele Polygone). */
function polygonParts(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom];
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates ?? []).map((coordinates) => ({
      type: 'Polygon',
      coordinates,
    }));
  }
  return [];
}

function inEurope(b) {
  return b.minX >= -19 && b.maxX <= 45 && b.minY >= 27 && b.maxY <= 72;
}

/** Grobe Stadtflächen: Europa detaillierter, Rest nur große Metropolen. */
function collectUrbanFine(fc) {
  const europe = [];
  const rest = [];
  for (const f of fc?.features ?? []) {
    const b = bboxOf(f.geometry);
    if (!b) continue;
    const eu = inEurope(b);
    if (eu && b.span < 0.07) continue;
    if (!eu && b.span < 0.22) continue;
    const polys = polygonsFromGeometry(f.geometry, eu ? 0.014 : 0.03, 3, eu ? 0.07 : 0.22);
    if (!polys.length) continue;
    const row = { span: b.span, polys };
    if (eu) europe.push(row);
    else rest.push(row);
  }
  europe.sort((a, b) => b.span - a.span);
  rest.sort((a, b) => b.span - a.span);
  const features = [];
  for (const row of europe.slice(0, 420)) features.push(...row.polys);
  for (const row of rest.slice(0, 180)) features.push(...row.polys);
  return { type: 'FeatureCollection', features };
}

/**
 * Seen: weltweit nur große (50m), Europa/DE dichter (10m).
 * DE: auch kleinere Seen (~2 km); EU: ab ~4 km; Rest nur große.
 */
function collectLakes(lakes50, lakes10) {
  const world = collectPolygons(lakes50, 0.04, 2, 0.35);
  const de = [];
  const eu = [];
  for (const f of lakes10?.features ?? []) {
    const b = bboxOf(f.geometry);
    if (!b || !inEurope(b)) continue;
    const midLng = (b.minX + b.maxX) / 2;
    const midLat = (b.minY + b.maxY) / 2;
    const inDe =
      midLng >= 5.5 && midLng <= 15.4 && midLat >= 47.2 && midLat <= 55.2;
    const minSpan = inDe ? 0.01 : 0.022;
    if (b.span < minSpan) continue;
    const minDeg = inDe ? 0.003 : 0.008;
    const polys = polygonsFromGeometry(f.geometry, minDeg, 4, minSpan);
    for (const poly of polys) {
      const row = { span: b.span, poly };
      if (inDe) de.push(row);
      else eu.push(row);
    }
  }
  de.sort((a, b) => b.span - a.span);
  eu.sort((a, b) => b.span - a.span);
  const osmLakes = [];
  if (existsSync(DE_HYDRO)) {
    try {
      const raw = JSON.parse(readFileSync(DE_HYDRO, 'utf8'));
      for (const f of raw?.lakes?.features ?? []) {
        const ring = f.geometry?.coordinates?.[0];
        if (!ring || ring.length < 5) continue;
        osmLakes.push(f);
      }
      if (osmLakes.length) {
        console.log('[world-overview] DE OSM lakes', osmLakes.length);
      }
    } catch (err) {
      console.warn('[world-overview] deHydro lakes skip', err?.message || err);
    }
  }
  const features = [
    ...(world.features || []),
    ...de.slice(0, 1_400).map((r) => r.poly),
    ...eu.slice(0, 1_000).map((r) => r.poly),
    ...osmLakes.slice(0, 1_200),
  ];
  return { type: 'FeatureCollection', features };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function urbanCovers(urban, lng, lat) {
  for (const f of urban.features) {
    const ring = f.geometry?.coordinates?.[0];
    if (ring && pointInRing(lng, lat, ring)) return true;
  }
  return false;
}

function adm0Code(f) {
  const p = f?.properties || {};
  return String(p.ADM0_A3 || p.adm0_a3 || p.ISO_A3 || p.iso_a3 || '').toUpperCase();
}

function adminName(f) {
  const p = f?.properties || {};
  return String(p.name_de || p.NAME_DE || p.name || p.NAME || p.gn_name || '');
}

function collectEuropeAdmin1FromPolys(fc) {
  const byCountry = new Map();
  for (const f of fc?.features ?? []) {
    const code = adm0Code(f);
    if (!EUROPE_ADM0.has(code)) continue;
    const b = bboxOf(f.geometry);
    if (!b || !inEurope(b)) continue;
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code).push({ f, span: b.span, code, name: adminName(f) });
  }
  const lines = [];
  const deuPolys = [];
  for (const [code, rows] of byCountry) {
    rows.sort((a, b) => b.span - a.span);
    const cap = code === 'DEU' ? 20 : 16;
    const minDeg = code === 'DEU' ? 0.0008 : 0.018;
    for (const row of rows.slice(0, cap)) {
      let polys = polygonsFromGeometry(
        row.f.geometry,
        minDeg,
        code === 'DEU' ? 4 : 3,
        0,
      );
      if (!polys.length) {
        polys = polygonsFromGeometry(row.f.geometry, 0.0008, 4, 0);
      }
      polys.sort(
        (a, b) =>
          ringSpan(b.geometry?.coordinates?.[0] ?? []) -
          ringSpan(a.geometry?.coordinates?.[0] ?? []),
      );
      const keep = polys.slice(0, 1);
      for (const poly of keep) {
        poly.properties = { n: row.name };
        if (code === 'DEU') deuPolys.push(poly);
        const ring = poly.geometry?.coordinates?.[0];
        if (ring && ring.length >= 4) {
          lines.push(feat({ type: 'LineString', coordinates: ring }, { n: row.name }));
        }
      }
    }
  }
  return {
    admin1: { type: 'FeatureCollection', features: lines },
    admin1De: { type: 'FeatureCollection', features: deuPolys },
  };
}

/** Küstenlinie aus Land-Polygonen — nur Fallback, wenn NE-Admin-0 fehlt. */
function bordersFromLand(landFc, minDeg = 0.04, places = 3) {
  const features = [];
  for (const f of landFc?.features ?? []) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) continue;
    const simp = simplifyLine(ring, minDeg, places);
    if (simp.length >= 2) {
      features.push(feat({ type: 'LineString', coordinates: simp }));
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Echte Ländergrenzen (Natural Earth admin_0).
 * Europa: 10m-Linien, wenig vereinfacht — sonst „lineale“ Kanten.
 * Rest der Welt: 50m reicht.
 */
function collectCountryBorders(borders50, borders10) {
  const eu = [];
  const rest = [];
  const push = (fc, minDeg, places, europeOnly) => {
    for (const f of fc?.features ?? []) {
      const b = bboxOf(f.geometry);
      if (!b) continue;
      const isEu = inEurope(b);
      if (europeOnly && !isEu) continue;
      if (!europeOnly && isEu) continue;
      for (const line of linesFromGeometry(f.geometry, minDeg, places)) {
        if (isEu) eu.push(line);
        else rest.push(line);
      }
    }
  };
  if (borders10) push(borders10, 0.008, 4, true);
  push(borders50, 0.028, 3, false);
  if (!borders10) push(borders50, 0.018, 3, true);
  return {
    type: 'FeatureCollection',
    features: [...eu.slice(0, 2_800), ...rest.slice(0, 900)],
  };
}

/** Europa: feinere Küste aus 50m-Land (niedrigeres minSpan). */
function collectEuropeLandFrom50m(fc) {
  const features = [];
  for (const f of fc?.features ?? []) {
    // Pro Ring/Teilfläche filtern — ne_50m_land ist oft EIN MultiPolygon der ganzen Welt.
    // Sonst: inEurope(Welt-BBox)=false → UK/Irland nie in landEuFine, werden aber im
    // Merge als „Europa-grob“ verworfen → England ohne grünen Hintergrund (wie Wasser).
    for (const part of polygonParts(f.geometry)) {
      const b = bboxOf(part);
      if (!b || !inEurope(b)) continue;
      const minSpan = b.span < 0.2 ? 0.01 : 0.035;
      const minDeg = b.span < 0.2 ? 0.006 : 0.022;
      features.push(...polygonsFromGeometry(part, minDeg, 3, minSpan));
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Kleine Inseln (Juist, Helgoland, …) aus NE 10m minor islands. */
function collectEuropeMinorIslands(fc) {
  const features = [];
  for (const f of fc?.features ?? []) {
    for (const part of polygonParts(f.geometry)) {
      const b = bboxOf(part);
      if (!b || !inEurope(b)) continue;
      if (b.span < 0.003) continue;
      const minDeg = b.span < 0.06 ? 0.0015 : 0.006;
      features.push(...polygonsFromGeometry(part, minDeg, 4, 0.003));
    }
  }
  return { type: 'FeatureCollection', features };
}

function mergeLandCoarseFine(coarse, ...extras) {
  const features = [];
  for (const f of coarse.features ?? []) {
    const b = bboxOf(f.geometry);
    if (b && inEurope(b)) continue;
    features.push(f);
  }
  for (const extra of extras) {
    for (const f of extra.features ?? []) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

/** Nur anhängen — kein erneutes Europa-Strip (sonst fallen UK/IE wieder raus). */
function appendLandFeatures(base, ...extras) {
  const features = [...(base.features ?? [])];
  for (const extra of extras) {
    for (const f of extra.features ?? []) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

async function loadAdmin1() {
  const raw = await fetchJson(FILES.admin1Poly10);
  const out = collectEuropeAdmin1FromPolys(raw);
  if (out.admin1De.features.length < 14) {
    throw new Error(`DE Bundesländer fehlen (${out.admin1De.features.length})`);
  }
  console.log(
    '[world-overview] DE',
    out.admin1De.features.map((f) => f.properties?.n).join(', '),
  );
  return out;
}

async function main() {
  console.log('[world-overview] download Natural Earth …');
  const landRaw = await fetchJson(FILES.land);
  const lakesRaw = await fetchJson(FILES.lakes);
  let lakesFine = null;
  try {
    lakesFine = await fetchJson(FILES.lakesFine);
    console.log('[world-overview] lakes 10m ok');
  } catch (err) {
    console.warn('[world-overview] lakes 10m skip', err?.message || err);
  }
  const lakes = collectLakes(lakesRaw, lakesFine);
  let urban;
  try {
    const urbanFine = await fetchJson(FILES.urbanFine);
    urban = collectUrbanFine(urbanFine);
    console.log('[world-overview] urban 10m →', urban.features.length, 'flächen');
  } catch (err) {
    console.warn('[world-overview] 10m urban fallback 50m', err?.message || err);
    urban = collectPolygons(await fetchJson(FILES.urban), 0.02, 3, 0.12);
  }

  const { admin1, admin1De } = await loadAdmin1();
  console.log(
    '[world-overview] admin1 lines',
    admin1.features.length,
    'DE Bundesländer',
    admin1De.features.length,
  );

  let landEuFine = { type: 'FeatureCollection', features: [] };
  let landIslands = { type: 'FeatureCollection', features: [] };
  try {
    landEuFine = collectEuropeLandFrom50m(landRaw);
    console.log('[world-overview] land 50m EU →', landEuFine.features.length, 'flächen');
  } catch (err) {
    console.warn('[world-overview] land EU skip', err?.message || err);
  }
  try {
    const islandsRaw = await fetchJson(FILES.islandsFine);
    landIslands = collectEuropeMinorIslands(islandsRaw);
    console.log('[world-overview] minor islands EU →', landIslands.features.length);
  } catch (err) {
    console.warn('[world-overview] minor islands skip', err?.message || err);
  }

  const landCoarse = collectPolygons(landRaw, 0.05, 2, 0.7);
  const landBase = mergeLandCoarseFine(landCoarse, landEuFine, landIslands);
  const mustFiltered = filterMustIslandsAgainstLand(
    { type: 'FeatureCollection', features: mustIslandFeatures() },
    landBase,
  );
  const land = appendLandFeatures(landBase, mustFiltered);

  let borders;
  try {
    const bordersRaw = await fetchJson(FILES.borders);
    let bordersFine = null;
    try {
      bordersFine = await fetchJson(FILES.bordersFine);
      console.log('[world-overview] borders 10m ok');
    } catch (err) {
      console.warn('[world-overview] borders 10m skip', err?.message || err);
    }
    borders = collectCountryBorders(bordersRaw, bordersFine);
    console.log('[world-overview] country borders →', borders.features.length);
    if (borders.features.length < 80) {
      throw new Error(`too few borders (${borders.features.length})`);
    }
  } catch (err) {
    console.warn(
      '[world-overview] admin_0 borders fallback land-coast',
      err?.message || err,
    );
    borders = bordersFromLand(land, 0.028, 3);
  }

  const bundle = {
    v: 5,
    land,
    lakes,
    borders,
    urban,
    admin1,
    admin1De,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(bundle);
  writeFileSync(OUT, json);
  const kb = Math.round(Buffer.byteLength(json) / 1024);
  console.log(
    `[world-overview] wrote ${OUT} (${kb} KB)`,
    'land',
    bundle.land.features.length,
    'lakes',
    bundle.lakes.features.length,
    'borders',
    bundle.borders.features.length,
    'urban',
    bundle.urban.features.length,
    'admin1',
    bundle.admin1.features.length,
    'admin1De',
    bundle.admin1De.features.length,
  );
  const probes = [
    ['Halle', 11.97, 51.48],
    ['Berlin', 13.4, 52.52],
    ['Prisdorf', 9.76, 53.68],
  ];
  for (const [name, lng, lat] of probes) {
    console.log(
      `[world-overview] ${name} urban`,
      urbanCovers(bundle.urban, lng, lat) ? 'ja' : 'nein',
    );
  }
  const sh = bundle.admin1De.features.some((f) =>
    /schleswig/i.test(String(f.properties?.n || '')),
  );
  const kiel = bundle.admin1De.features.some((f) => {
    const ring = f.geometry?.coordinates?.[0];
    return ring && pointInRing(10.14, 54.32, ring);
  });
  console.log('[world-overview] Schleswig-Holstein Fläche', sh && kiel ? 'ja' : 'nein');
  const islandProbes = [
    ['Juist', 7.05, 53.68],
    ['Helgoland', 7.89, 54.18],
    ['Norderney', 7.15, 53.71],
  ];
  for (const [name, lng, lat] of islandProbes) {
    let hit = false;
    for (const f of bundle.land.features) {
      const ring = f.geometry?.coordinates?.[0];
      if (ring && pointInRing(lng, lat, ring)) {
        hit = true;
        break;
      }
    }
    console.log(`[world-overview] Insel ${name}`, hit ? 'ja' : 'NEIN');
  }
  const ukLandProbes = [
    ['London', -0.12, 51.5],
    ['Manchester', -2.24, 53.48],
    ['Edinburgh', -3.19, 55.95],
    ['Dublin', -6.26, 53.35],
  ];
  for (const [name, lng, lat] of ukLandProbes) {
    let hit = false;
    for (const f of bundle.land.features) {
      const ring = f.geometry?.coordinates?.[0];
      if (ring && pointInRing(lng, lat, ring)) {
        hit = true;
        break;
      }
    }
    console.log(`[world-overview] Land ${name}`, hit ? 'ja' : 'NEIN');
    if (!hit) throw new Error(`UK/IE land missing: ${name}`);
  }
  if (kb > 2200) {
    console.warn('[world-overview] größer als 1.4 MB — ggf. stärker vereinfachen');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
