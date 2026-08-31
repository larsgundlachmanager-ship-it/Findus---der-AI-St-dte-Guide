/**
 * OSM-Gemeindegrenzen (Nominatim, volle Detailtiefe) in Pack-_coverage schreiben.
 *
 *   node scripts/homeMap/fetchCityAdminBoundaries.mjs --cities prisdorf,tornesch,pinneberg
 *   node scripts/homeMap/fetchCityAdminBoundaries.mjs --all
 *   node scripts/homeMap/fetchCityAdminBoundaries.mjs --all-de
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STAEDTE = join(ROOT, 'data', 'staedte');
const UA = 'YorroAdminBoundary/1.0 (city pack coverage)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ringFromGeojson(gj) {
  if (!gj?.type || !Array.isArray(gj.coordinates)) return null;
  let ring = null;
  if (gj.type === 'Polygon') ring = gj.coordinates[0];
  if (gj.type === 'MultiPolygon') {
    let best = null;
    for (const p of gj.coordinates) {
      const r = p?.[0];
      if (Array.isArray(r) && (!best || r.length > best.length)) best = r;
    }
    ring = best;
  }
  if (!ring || ring.length < 6) return null;
  const out = [];
  for (const c of ring) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  return out.length >= 6 ? out : null;
}

async function fetchAdmin(displayName, countrycodes = 'de') {
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(displayName)}` +
    `&format=json&limit=5&polygon_geojson=1&polygon_threshold=0` +
    `&addressdetails=0&countrycodes=${countrycodes}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = await res.json();
  let best = null;
  let bestPts = 0;
  for (const h of hits) {
    const osm = String(h.osm_type || '').toLowerCase();
    if (osm !== 'relation' && osm !== 'r') continue;
    if (h.class !== 'boundary') continue;
    const poly = ringFromGeojson(h.geojson);
    if (!poly) continue;
    if (poly.length > bestPts) {
      best = { poly, hit: h };
      bestPts = poly.length;
    }
  }
  return best;
}

function bboxFromPoly(poly) {
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

function listPackIds() {
  return readdirSync(STAEDTE)
    .filter((f) => /^[a-z0-9][a-z0-9_-]*\.json$/i.test(f))
    .map((f) => f.replace(/\.json$/i, ''))
    .filter((id) => {
      if (id.includes('umland') || id.endsWith('-region')) return false;
      if (id.startsWith('_')) return false;
      try {
        const p = JSON.parse(readFileSync(join(STAEDTE, `${id}.json`), 'utf8'));
        return !!(p.city_id || p.spots || p._coverage);
      } catch {
        return false;
      }
    });
}

function countryForPack(pack, id) {
  const raw = String(pack.country_code || pack.country || '')
    .toLowerCase()
    .trim();
  if (raw === 'de' || raw === 'deutschland' || raw === 'germany') return 'de';
  if (raw === 'nl' || raw === 'netherlands' || raw === 'nederland') return 'nl';
  if (raw === 'pt' || raw === 'portugal') return 'pt';
  if (raw === 'gb' || raw === 'uk' || raw === 'united kingdom' || raw === 'england')
    return 'gb';
  if (raw === 'at' || raw === 'austria' || raw === 'österreich') return 'at';
  if (raw === 'ch' || raw === 'switzerland' || raw === 'schweiz') return 'ch';
  if (raw === 'be' || raw === 'belgium') return 'be';
  if (raw === 'fr' || raw === 'france') return 'fr';
  if (raw === 'es' || raw === 'spain') return 'es';
  if (raw === 'it' || raw === 'italy') return 'it';
  // ID-Heuristik, falls Pack kein country_code hat
  if (/^(amsterdam|rotterdam|utrecht)/i.test(id)) return 'nl';
  if (/^(london|manchester|edinburgh)/i.test(id)) return 'gb';
  if (/^(lissabon|lisbon|porto)/i.test(id)) return 'pt';
  if (/^(wien|salzburg)/i.test(id)) return 'at';
  if (/^(zuerich|zurich|bern)/i.test(id)) return 'ch';
  if (/^(paris|lyon)/i.test(id)) return 'fr';
  return raw.slice(0, 2) || 'de';
}

function countryLabel(cc) {
  const map = {
    de: 'Germany',
    nl: 'Netherlands',
    pt: 'Portugal',
    gb: 'United Kingdom',
    at: 'Austria',
    ch: 'Switzerland',
    be: 'Belgium',
    fr: 'France',
    es: 'Spain',
    it: 'Italy',
  };
  return map[cc] || cc.toUpperCase();
}

async function applyCity(id) {
  const path = join(STAEDTE, `${id}.json`);
  if (!existsSync(path)) {
    console.warn('[skip]', id, 'no pack');
    return;
  }
  let pack;
  try {
    pack = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn('[fail]', id, 'read', e.message || e);
    return;
  }
  // Spezial-/Region-Packs: keine Gemeinde-Relation erzwingen
  if (id.includes('umland') || id === 'berlin-zentral' || id === 'spreewald') {
    console.log('[skip]', id, 'region/special');
    return;
  }
  const nameRaw = String(pack.city_name || pack.name || id);
  // „Zollernstadt Hechingen“ → Hechingen
  const name = nameRaw.replace(/^zollernstadt\s+/i, '').trim() || nameRaw;
  const country = countryForPack(pack, id);
  const countryName = countryLabel(country);
  const q =
    country === 'de' && pack.region
      ? `${name}, ${pack.region}, Germany`
      : `${name}, ${countryName}`;
  const got = await fetchAdmin(q, country);
  if (!got) {
    // Fallback: nur Stadtname + Land
    const got2 = await fetchAdmin(`${name}, ${countryName}`, country);
    if (!got2) {
      console.warn('[miss]', id, q);
      return;
    }
    return writeCoverage(path, pack, id, got2);
  }
  return writeCoverage(path, pack, id, got);
}

function writeCoverage(path, pack, id, got) {
  const box = bboxFromPoly(got.poly);
  const prev = pack._coverage?.polygon?.length ?? 0;
  pack._coverage = {
    ...(pack._coverage || {}),
    ...box,
    polygon: got.poly,
    source: 'nominatim_osm_admin',
    osm_id: got.hit.osm_id,
    osm_type: got.hit.osm_type,
    updated_at: new Date().toISOString(),
  };
  // country_code nachziehen, wenn fehlte
  if (!pack.country_code) {
    pack.country_code = countryForPack(pack, id);
  }
  try {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(pack, null, 2) + '\n', 'utf8');
    try {
      renameSync(tmp, path);
    } catch {
      writeFileSync(path, readFileSync(tmp));
      try {
        unlinkSync(tmp);
      } catch {
        /* soft */
      }
    }
  } catch (e) {
    console.warn('[fail]', id, 'write', e.message || e);
    return;
  }
  console.log(`[ok] ${id}: ${prev} → ${got.poly.length} pts`);
}

const args = process.argv.slice(2);
let ids = [];
if (args.includes('--all')) {
  ids = listPackIds();
} else if (args.includes('--all-de')) {
  ids = listPackIds().filter((id) => {
    try {
      const p = JSON.parse(readFileSync(join(STAEDTE, `${id}.json`), 'utf8'));
      const cc = String(p.country_code || p.country || 'de').toLowerCase();
      return cc === 'de' || cc === 'deutschland' || !p.country_code;
    } catch {
      return false;
    }
  });
} else {
  const ix = args.indexOf('--cities');
  const raw = ix >= 0 ? args[ix + 1] : 'prisdorf,tornesch,pinneberg';
  ids = String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

console.log('[boundaries] cities', ids.length);
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  try {
    await applyCity(id);
  } catch (e) {
    console.warn('[fail]', id, e.message || e);
  }
  if (i < ids.length - 1) await sleep(1100);
}
console.log('[boundaries] done');
