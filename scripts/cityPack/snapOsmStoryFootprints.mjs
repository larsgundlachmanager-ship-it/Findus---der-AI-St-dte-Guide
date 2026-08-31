#!/usr/bin/env node
/**
 * Story-Orte: echte OSM-Gebäude-/Platz-Umrisse (wie Prisdorf), keine GPS-Box.
 *
 *   node scripts/cityPack/snapOsmStoryFootprints.mjs --city laboe
 *   node scripts/cityPack/snapOsmStoryFootprints.mjs --all
 *   node scripts/cityPack/snapOsmStoryFootprints.mjs --all --dry
 *   node scripts/cityPack/snapOsmStoryFootprints.mjs --city laboe --no-upload
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  arg,
  centroid,
  distM,
  hasFlag,
  loadPack,
  ROOT,
  savePack,
  STAEDTE_DIR,
} from './lib.mjs';
import { fetchJson, sleep, fetchNominatimPolygon } from '../geo/osm.mjs';

const SKIP_NAME_RE =
  /stadtgeschichte|strassenverzeichnis|strassen_gestern|gestern_heute|virtuell/i;

function listCityIds() {
  const indexPath = path.join(STAEDTE_DIR, 'index.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const ids = (index.available_cities || [])
      .map((c) => c.id)
      .filter(Boolean);
    if (ids.length) return ids;
  } catch {
    /* fall through */
  }
  return fs
    .readdirSync(STAEDTE_DIR)
    .filter((f) => /^[a-z0-9_-]+\.json$/i.test(f) && f !== 'index.json')
    .map((f) => f.replace(/\.json$/i, ''));
}

function toLatLng(p) {
  return {
    lat: p.lat ?? p.latitude,
    lng: p.lng ?? p.longitude,
  };
}

function toSpot(pts) {
  return pts.map((p) => ({
    latitude: p.lat ?? p.latitude,
    longitude: p.lng ?? p.longitude,
  }));
}

function toTrig(pts) {
  return pts.map((p) => ({
    lat: p.lat ?? p.latitude,
    lng: p.lng ?? p.longitude,
  }));
}

function isAxisBox(poly) {
  if (!poly || poly.length < 4 || poly.length > 6) return false;
  const lats = new Set();
  const lngs = new Set();
  for (const p of poly) {
    const { lat, lng } = toLatLng(p);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    lats.add(lat.toFixed(6));
    lngs.add(lng.toFixed(6));
  }
  return lats.size === 2 && lngs.size === 2;
}

function ringFingerprint(ring) {
  const pts = (ring || []).map(toLatLng).filter((p) => Number.isFinite(p.lat));
  if (pts.length < 3) return '';
  const a = pts[0];
  const b = pts[Math.floor(pts.length / 2)];
  return `${pts.length}:${a.lat.toFixed(5)},${a.lng.toFixed(5)}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
}

function countrycodesForPack(pack) {
  const id = String(pack.city_id || '').toLowerCase();
  const lat = Number(pack.lat);
  const lng = Number(pack.lng);
  if (id === 'london') return 'gb';
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat >= 51.2 && lat <= 55.5 && lng >= -10.7 && lng <= -5.9) return 'ie';
    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.85) return 'gb';
  }
  return 'de';
}

function uniqueCount(poly) {
  const s = new Set();
  for (const p of poly || []) {
    const { lat, lng } = toLatLng(p);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      s.add(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    }
  }
  return s.size;
}

function spotPin(pack, spot) {
  // Eingang/Trigger zuerst — nie Polygon-Zentroid (zieht Snap aufs Nachbarhaus).
  const subs = spot.sub_pois || spot.subPois || [];
  for (const s of subs) {
    const tags = (s.tags || []).map((t) => String(t).toLowerCase());
    const name = String(s.name || '').toLowerCase();
    const isEntrance =
      tags.includes('nav_target') ||
      tags.includes('gps_entrance') ||
      tags.includes('gps_manual_fix') ||
      /haupteingang|eingang/.test(name);
    if (!isEntrance) continue;
    const lat = s.latitude ?? s.lat;
    const lng = s.longitude ?? s.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng };
    }
  }
  const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
  if (t && typeof t.lat === 'number' && typeof t.lng === 'number') {
    return { lat: t.lat, lng: t.lng };
  }
  for (const s of subs) {
    const lat = s.latitude ?? s.lat;
    const lng = s.longitude ?? s.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng };
    }
  }
  const poly = spot.polygonCoordinates || spot.polygon;
  return centroid(poly);
}

function alreadyOsm(spot) {
  const blob = JSON.stringify(spot.sub_pois || spot.subPois || []).toLowerCase();
  if (blob.includes('sourced_osm') || blob.includes('osm way')) return true;
  const trigTags = JSON.stringify(spot.tags || []).toLowerCase();
  return trigTags.includes('sourced_osm');
}

function needsSnap(spot, pack) {
  if (spot.pack_role === 'directory' || Number(spot.place_tier) === 4) {
    return false;
  }
  const blob = `${spot.id || ''} ${spot.name || ''}`;
  if (SKIP_NAME_RE.test(blob)) return false;
  const poly = spot.polygonCoordinates || spot.polygon;
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  const hasReal =
    poly &&
    poly.length >= 4 &&
    !isAxisBox(poly) &&
    uniqueCount(poly) >= 6;
  // Manuelle GPS-Fixes mit echtem Umriss nicht ans Nachbarhaus snappen.
  // Fehlender/Box-Umriss: trotzdem OSM-Gebäude (sonst nur Punkt).
  if (tags.includes('gps_manual_fix') && hasReal) return false;
  if (sharedFootprint(pack, spot)) return true;
  if (alreadyOsm(spot) && hasReal) return false;
  if (!poly || poly.length < 4) return true;
  if (isAxisBox(poly)) return true;
  return uniqueCount(poly) < 6;
}

function sharedFootprint(pack, spot) {
  const poly = spot.polygonCoordinates || spot.polygon;
  if (!poly || poly.length < 3) return false;
  const a = toLatLng(poly[0]);
  if (!Number.isFinite(a.lat)) return false;
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}#${poly.length}`;
  let n = 0;
  for (const s of pack.spots || []) {
    if (s === spot || s.pack_role === 'directory') continue;
    const p = s.polygonCoordinates || s.polygon;
    if (!p || p.length !== poly.length) continue;
    const b = toLatLng(p[0]);
    if (!Number.isFinite(b.lat)) continue;
    const k = `${b.lat.toFixed(5)},${b.lng.toFixed(5)}#${p.length}`;
    if (k === key) {
      n += 1;
      if (n >= 2) return true;
    }
  }
  return false;
}

function setEntrance(spot, lat, lng, source) {
  const subs = spot.sub_pois || spot.subPois || [];
  const entrance = {
    id: `${spot.id}_sub_eingang`,
    name: `${spot.name} · Haupteingang`,
    lat,
    lng,
    radius_m: 10,
    fact_details: `GPS-Eingang (${source}).`,
    tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
  };
  spot.sub_pois = [
    entrance,
    ...subs.filter((s) => !String(s.id || '').includes('eingang')),
  ];
}

function applyRing(pack, spot, ring, pin, source) {
  const clean = ring.map(toLatLng).filter((p) => Number.isFinite(p.lat));
  if (clean.length < 3) return null;
  if (
    Math.abs(clean[0].lat - clean[clean.length - 1].lat) > 1e-6 ||
    Math.abs(clean[0].lng - clean[clean.length - 1].lng) > 1e-6
  ) {
    clean.push({ ...clean[0] });
  }
  const ringC = centroid(toSpot(clean));
  const keepPin =
    pin &&
    Number.isFinite(pin.lat) &&
    ringC &&
    distM(pin, ringC) > 80;
  const c = keepPin ? pin : pin || ringC;
  if (!c) return null;
  spot.polygonCoordinates = toSpot(clean);
  delete spot.polygonRings;
  setEntrance(spot, c.lat, c.lng, source);
  const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
  if (trigger) {
    trigger.lat = c.lat;
    trigger.lng = c.lng;
    trigger.polygon = toTrig(clean);
    const pool = trigger.deep_data_pool || [];
    const gpsLine = {
      text: `GPS-Eingang (OSM): ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} — ${source}.`,
      tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
    };
    trigger.deep_data_pool = [
      gpsLine,
      ...pool.filter(
        (x) => !/GPS-Eingang|Koordinaten\s*~/i.test(String(x.text || '')),
      ),
    ];
  }
  return {
    id: spot.id,
    name: spot.name,
    status: 'OSM',
    n: clean.length,
    lat: c.lat,
    lng: c.lng,
    source,
  };
}

function ringFromEl(el) {
  const geom = el.geometry;
  if (!Array.isArray(geom) || geom.length < 3) return null;
  const pts = [];
  for (const p of geom) {
    if (typeof p?.lat === 'number' && typeof p?.lon === 'number') {
      pts.push({ lat: p.lat, lng: p.lon });
    }
  }
  return pts.length >= 3 ? pts : null;
}

function scoreWay(el, pin, spotName) {
  const pts = ringFromEl(el);
  if (!pts) return null;
  const t = el.tags || {};
  const cc = centroid(toSpot(pts));
  if (!cc) return null;
  const dist = distM(pin, cc);
  const lats = pts.map((p) => p.lat);
  const spanN = (Math.max(...lats) - Math.min(...lats)) * 111320;
  const namedPlaza =
    t.place === 'square' ||
    t.leisure === 'park' ||
    t.leisure === 'garden' ||
    (t.highway === 'pedestrian' && Boolean(t.name)) ||
    t.tourism === 'attraction';
  if (
    spanN > (namedPlaza ? 900 : 420) &&
    !t.natural &&
    !t.landuse &&
    !namedPlaza &&
    t.railway !== 'platform'
  ) {
    return null;
  }
  const blob = String(spotName || '').toLowerCase();
  const name = String(t.name || '').toLowerCase();
  let score = 40 - Math.min(dist, 140) * 0.35;
  if (name && blob.includes(name)) score += 80;
  if (name && name.split(/\s+/).some((w) => w.length >= 4 && blob.includes(w))) {
    score += 36;
  }
  if (t.historic) score += 50;
  if (t.leisure) score += 44;
  if (t.place === 'square') score += 70;
  if (t.building && t.building !== 'yes') score += 38;
  if (t.building) score += 28;
  if (t.tourism) score += 22;
  if (t.amenity === 'place_of_worship' || t.building === 'church') score += 40;
  if (t.railway === 'platform') score += 30;
  if (t.highway && !t.tunnel && !namedPlaza) score -= 24;
  if (t.railway === 'rail') score -= 40;
  if (dist > 95 && score < 70) return null;
  if (score < 8) return null;
  return { ring: pts, score, dist, source: `OSM way ${el.id} ${t.name || t.building || t.leisure || t.historic || ''}`.trim() };
}

function pickBest(elements, pin, spotName) {
  let best = null;
  for (const el of elements) {
    if (el.type !== 'way') continue;
    const got = scoreWay(el, pin, spotName);
    if (!got) continue;
    if (!best || got.score > best.score) best = got;
  }
  return best;
}

async function osmMapRing(pin, spotName) {
  const dLat = 90 / 111320;
  const dLng = 90 / (111320 * Math.cos((pin.lat * Math.PI) / 180));
  const bbox = [
    (pin.lng - dLng).toFixed(6),
    (pin.lat - dLat).toFixed(6),
    (pin.lng + dLng).toFixed(6),
    (pin.lat + dLat).toFixed(6),
  ].join(',');
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const j = await fetchJson(
        `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,
      );
      await sleep(1200);
      const els = j.elements || [];
      const nodes = new Map(
        els.filter((e) => e.type === 'node').map((n) => [n.id, n]),
      );
      const fakeWays = [];
      for (const e of els) {
        if (e.type !== 'way' || !e.nodes?.length) continue;
        const pts = e.nodes
          .map((id) => nodes.get(id))
          .filter(Boolean)
          .map((n) => ({ lat: n.lat, lng: n.lon }));
        if (pts.length < 3) continue;
        fakeWays.push({
          type: 'way',
          id: e.id,
          tags: e.tags || {},
          geometry: pts.map((p) => ({ lat: p.lat, lon: p.lng })),
        });
      }
      return pickBest(fakeWays, pin, spotName);
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      const wait = /429|503|509|rate/i.test(msg) ? 8000 + attempt * 4000 : 1800;
      console.warn(`[osm-foot] map.json retry ${attempt + 1}: ${msg.slice(0, 120)}`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error('osm map.json failed');
}

function ringTooFar(ring, pin, spotName) {
  const cc = centroid(toSpot(ring));
  if (!cc || !pin) return false;
  const namedPlaza = /park|platz|square|garten|garden|heath|see|hafen|insel|common/i.test(
    String(spotName || ''),
  );
  return distM(pin, cc) > (namedPlaza ? 900 : 280);
}

function acceptRing(best, pin, spotName, used) {
  if (!best?.ring) return null;
  if (ringTooFar(best.ring, pin, spotName)) return null;
  const fp = ringFingerprint(best.ring);
  if (fp && used.has(fp)) return null;
  return best;
}

async function nominatimNamedRing(pack, spot, pin, used) {
  const city = pack.name || pack.city_id || '';
  const q = `${spot.name}, ${city}`;
  try {
    const got = await fetchNominatimPolygon(q, {
      countrycodes: countrycodesForPack(pack),
    });
    if (!got?.polygon?.length) return null;
    const ring = got.polygon.map((p) => ({
      lat: p.latitude ?? p.lat,
      lng: p.longitude ?? p.lng,
    }));
    if (ring.length < 4) return null;
    const cc = centroid(toSpot(ring));
    if (cc && pin && distM(pin, cc) > 1200) return null;
    const fp = ringFingerprint(ring);
    if (fp && used.has(fp)) return null;
    return {
      ring,
      source: `nominatim ${got.osmId || ''} ${got.name || spot.name}`.trim(),
    };
  } catch {
    return null;
  }
}

function persistPack(pack, { dry, bumped }) {
  if (dry) return true;
  savePack(pack, { bumpVersion: !bumped.value });
  bumped.value = true;
  return true;
}

async function uploadCityPack(cityId) {
  const file = path.join(STAEDTE_DIR, `${cityId}.json`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), file],
      { cwd: ROOT, stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`upload:city ${cityId} exit ${code}`));
    });
    child.on('error', reject);
  });
}

async function processCity(cityId, { dry, skipUpload }) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn(`[osm-foot] skip missing ${cityId}`);
    return { cityId, saved: false, rows: [] };
  }
  const stories = (pack.spots || []).filter(
    (s) => s.pack_role !== 'directory' && Number(s.place_tier) !== 4,
  );
  const used = new Set();
  for (const s of stories) {
    if (sharedFootprint(pack, s)) continue;
    const fp = ringFingerprint(s.polygonCoordinates || s.polygon);
    if (fp) used.add(fp);
  }
  const targets = [];
  for (const spot of stories) {
    if (!needsSnap(spot, pack)) continue;
    const pin = spotPin(pack, spot);
    if (!pin) continue;
    targets.push({ spot, pin });
  }
  if (!targets.length) {
    console.log(`[osm-foot] ${cityId}: alle Story-Umrisse schon da`);
    return { cityId, saved: false, rows: [] };
  }

  const rows = [];
  const bumped = { value: false };
  let osmSinceSave = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      let best = acceptRing(
        await osmMapRing(t.pin, t.spot.name),
        t.pin,
        t.spot.name,
        used,
      );
      if (!best) {
        best = await nominatimNamedRing(pack, t.spot, t.pin, used);
      }
      if (!best) {
        rows.push({ id: t.spot.id, name: t.spot.name, status: 'KEEP' });
        continue;
      }
      const applied = applyRing(pack, t.spot, best.ring, t.pin, best.source);
      const row = applied || { id: t.spot.id, name: t.spot.name, status: 'KEEP' };
      rows.push(row);
      if (row.status === 'OSM') {
        const fp = ringFingerprint(best.ring);
        if (fp) used.add(fp);
        osmSinceSave += 1;
        console.log(
          `[osm-foot] ${cityId} ${i + 1}/${targets.length} ${t.spot.name} OSM n=${row.n}`,
        );
        if (osmSinceSave >= 12) {
          persistPack(pack, { dry, bumped });
          osmSinceSave = 0;
        }
      }
    } catch (e) {
      rows.push({
        id: t.spot.id,
        name: t.spot.name,
        status: 'ERR',
        source: String(e.message || e),
      });
      await sleep(1500);
    }
  }

  const osmN = rows.filter((r) => r.status === 'OSM').length;
  console.log(`[osm-foot] ${cityId}: ${osmN}/${targets.length} OSM · ${rows.filter((r) => r.status === 'KEEP').length} keep`);
  if (!dry && osmN > 0) {
    persistPack(pack, { dry, bumped });
    console.log(`[osm-foot] saved ${cityId} v${pack.data_version}`);
    if (!skipUpload) {
      try {
        await uploadCityPack(cityId);
      } catch (e) {
        console.warn(`[osm-foot] upload ${cityId}: ${e.message || e}`);
      }
    }
    return { cityId, saved: true, rows };
  }
  return { cityId, saved: false, rows };
}

async function main() {
  const dry = hasFlag('dry');
  const skipUpload = hasFlag('no-upload') || hasFlag('skip-upload');
  let cities = [];
  if (hasFlag('all')) {
    cities = listCityIds();
    cities.sort((a, b) => {
      const na = loadPack(a)?.spots?.length || 0;
      const nb = loadPack(b)?.spots?.length || 0;
      return na - nb;
    });
  } else {
    const id = arg('city');
    if (!id) {
      console.error(
        'Usage: node scripts/cityPack/snapOsmStoryFootprints.mjs --city <id> | --all [--dry] [--no-upload]',
      );
      process.exit(1);
    }
    cities = [id];
  }

  const saved = [];
  for (const id of cities) {
    const r = await processCity(id, { dry, skipUpload });
    if (r.saved) saved.push(id);
  }
  console.log(`[osm-foot] done · saved ${saved.length}: ${saved.join(', ') || '—'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
