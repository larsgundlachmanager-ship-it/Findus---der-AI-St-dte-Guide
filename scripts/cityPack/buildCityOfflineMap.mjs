#!/usr/bin/env node
/**
 * OSM → Pack: Alltagsorte, Gebäude-Umrisse oder Punkt, Karten-Extract + Routing-Graph.
 *
 *   node scripts/cityPack/buildCityOfflineMap.mjs --city prisdorf
 *   node scripts/cityPack/buildCityOfflineMap.mjs --all [--no-upload]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT,
  STAEDTE_DIR,
  arg,
  distM,
  hasFlag,
  listCityPackIds,
  loadEnvFile,
  loadPack,
  packCoverageBbox,
  savePack,
  slugify,
} from './lib.mjs';
import { fetchOverpass, sleep } from '../geo/osm.mjs';

loadEnvFile();

const POINT_HINT_RE =
  /\b(briefkasten|post_box|mailbox|denkmal|memorial|skulptur|statue|gedenk|haltepunkt|bus.?halt|tram.?halt|toilette|aussicht|viewpoint|trinkwasser|tourist.?info)\b/i;

/** Unter diesem Span: voller Prisdorf-Extract (alle Gebäude + Hausnummern). */
const FULL_EXTRACT_MAX_M = 14000;
const TILE_SPAN_M = 8000;
/** Dichter Kern (London-Zentrum): kleinere Kacheln, sonst Overpass-504. */
const DENSE_TILE_SPAN_M = 3800;
const LARGE_BUILDING_AROUND_M = 160;
/** Großstadt: Gebäude/Hausnummern nur im Kern ums Pack-Zentrum. */
const CORE_EXTRACT_RADIUS_M = 4500;
/**
 * Umland ~10 km mit derselben Detailtiefe wie die Stadt (Gebäude + Straßen +
 * Wasser + Parks). Überlappende Nachbarstädte sind ok: Laufzeit zeigt immer
 * nur ein Extract (Viewport-Switch) — keine Doppelzeichnung.
 */
const UMLAND_DETAIL_PAD_M = 10_000;
const UMLAND_ROADS_PAD_M = 10_000;
/** Großstadt: Extrakt-Radius um Pack-Zentrum (Gebäude im Kern separat). */
const UMLAND_DETAIL_RADIUS_M = 10_000;
const NOMINATIM = 'https://nominatim.openstreetmap.org';

function bboxSpanM(b) {
  const dLat = (b.north - b.south) * 111_320;
  const dLng =
    (b.east - b.west) *
    111_320 *
    Math.cos((((b.north + b.south) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function coreBboxFromCenter(lat, lng, radiusM = CORE_EXTRACT_RADIUS_M) {
  const dLat = radiusM / 111_320;
  const dLng =
    radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

/** Admin-/Kern-Bbox um padM in alle Richtungen erweitern (Umland-Straßen). */
function expandBbox(b, padM) {
  const midLat = (b.north + b.south) / 2;
  const dLat = padM / 111_320;
  const dLng =
    padM / (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return {
    south: b.south - dLat,
    north: b.north + dLat,
    west: b.west - dLng,
    east: b.east + dLng,
  };
}

function nominatimCountryForPack(pack) {
  const id = String(pack.city_id || '').toLowerCase();
  const lat = Number(pack.lat);
  const lng = Number(pack.lng);
  if (id === 'london') {
    return { countrycodes: 'gb', query: `${pack.name || 'London'}, United Kingdom` };
  }
  if (id === 'amsterdam') {
    return {
      countrycodes: 'nl',
      query: `${pack.name || 'Amsterdam'}, Netherlands`,
    };
  }
  if (id === 'lissabon' || id === 'lisbon') {
    return {
      countrycodes: 'pt',
      query: `${pack.name || 'Lisbon'}, Portugal`,
    };
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat >= 51.2 && lat <= 55.5 && lng >= -10.7 && lng <= -5.9) {
      return { countrycodes: 'ie', query: `${pack.name || id}, Ireland` };
    }
    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.85) {
      return {
        countrycodes: 'gb',
        query: `${pack.name || id}, United Kingdom`,
      };
    }
    // NL / Benelux (Amsterdam sonst fälschlich als DE)
    if (lat >= 50.5 && lat <= 53.7 && lng >= 3.2 && lng <= 7.4) {
      return {
        countrycodes: 'nl',
        query: `${pack.name || id}, Netherlands`,
      };
    }
    if (lat >= 36.8 && lat <= 42.3 && lng >= -9.6 && lng <= -6.0) {
      return {
        countrycodes: 'pt',
        query: `${pack.name || id}, Portugal`,
      };
    }
  }
  return { countrycodes: 'de', query: `${pack.name || id}, Germany` };
}

function ringLngLatToLatLng(ring) {
  if (!Array.isArray(ring) || ring.length < 6) return null;
  const out = [];
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  return out.length >= 6 ? out : null;
}

function extractNominatimRing(gj) {
  if (!gj?.type || !Array.isArray(gj.coordinates)) return null;
  if (gj.type === 'Polygon') return ringLngLatToLatLng(gj.coordinates[0]);
  if (gj.type === 'MultiPolygon') {
    let best = null;
    for (const poly of gj.coordinates) {
      const ring = ringLngLatToLatLng(Array.isArray(poly) ? poly[0] : null);
      if (!ring) continue;
      if (!best || ring.length > best.length) best = ring;
    }
    return best;
  }
  return null;
}

async function ensureCoveragePolygon(pack) {
  const poly = pack._coverage?.polygon;
  let changed = false;
  if (!(Array.isArray(poly) && poly.length >= 6)) {
    const { countrycodes, query } = nominatimCountryForPack(pack);
    const url =
      `${NOMINATIM}/search?q=${encodeURIComponent(query)}` +
      `&format=json&limit=5&polygon_geojson=1&polygon_threshold=0.0025` +
      `&addressdetails=0&countrycodes=${countrycodes}`;
    try {
      await sleep(1100);
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FindusTravelCompanion/1.0 (city offline-map)',
        },
      });
      if (!res.ok) {
        console.warn(`[offline-map] nominatim HTTP ${res.status} for ${pack.city_id}`);
        return false;
      }
      const rows = await res.json();
      let best = null;
      for (const hit of Array.isArray(rows) ? rows : []) {
        const ring = extractNominatimRing(hit.geojson);
        if (!ring) continue;
        if (!best || ring.length > best.length) best = ring;
      }
      if (!best) {
        console.warn(`[offline-map] ${pack.city_id} no nominatim polygon`);
        return false;
      }
      pack._coverage = {
        ...(pack._coverage || {}),
        polygon: best,
      };
      console.log(
        `[offline-map] ${pack.city_id} coverage polygon ${best.length} pts (${countrycodes})`,
      );
      changed = true;
    } catch (e) {
      console.warn(`[offline-map] ${pack.city_id} nominatim: ${e.message || e}`);
      return false;
    }
  }
  // BBox immer an Polygon koppeln (Stempelkarte / Kartenfit)
  const ring = pack._coverage?.polygon;
  if (Array.isArray(ring) && ring.length >= 6) {
    const lats = ring.map((p) => Number(p[0])).filter(Number.isFinite);
    const lngs = ring.map((p) => Number(p[1])).filter(Number.isFinite);
    if (lats.length >= 6 && lngs.length >= 6) {
      const latMin = Math.min(...lats);
      const latMax = Math.max(...lats);
      const lngMin = Math.min(...lngs);
      const lngMax = Math.max(...lngs);
      const cur = pack._coverage;
      if (
        cur.latMin !== latMin ||
        cur.latMax !== latMax ||
        cur.lngMin !== lngMin ||
        cur.lngMax !== lngMax
      ) {
        pack._coverage = { ...cur, latMin, latMax, lngMin, lngMax };
        changed = true;
      }
    }
  }
  return changed;
}

function tileBbox(bbox, maxSpanM = TILE_SPAN_M) {
  const latM = (bbox.north - bbox.south) * 111_320;
  const midLat = (bbox.north + bbox.south) / 2;
  const lngM =
    (bbox.east - bbox.west) *
    111_320 *
    Math.cos((midLat * Math.PI) / 180);
  const nLat = Math.max(1, Math.ceil(latM / maxSpanM));
  const nLng = Math.max(1, Math.ceil(lngM / maxSpanM));
  if (nLat === 1 && nLng === 1) return [bbox];
  const dLat = (bbox.north - bbox.south) / nLat;
  const dLng = (bbox.east - bbox.west) / nLng;
  const tiles = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLng; j++) {
      tiles.push({
        south: bbox.south + i * dLat,
        north: bbox.south + (i + 1) * dLat,
        west: bbox.west + j * dLng,
        east: bbox.west + (j + 1) * dLng,
      });
    }
  }
  return tiles;
}

function simplifyRing(pts, minM) {
  if (!pts || pts.length <= 3) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    if (distM(prev, cur) >= minM) out.push(cur);
  }
  out.push(pts[pts.length - 1]);
  if (out.length < 2) return pts;
  return out;
}

function ringFromGeom(el) {
  const g = el.geometry;
  if (!Array.isArray(g) || g.length < 2) return null;
  const pts = [];
  for (const p of g) {
    if (typeof p?.lat === 'number' && typeof p?.lon === 'number') {
      pts.push({ lat: p.lat, lng: p.lon });
    }
  }
  return pts.length >= 2 ? pts : null;
}

function closedRing(pts) {
  if (!pts || pts.length < 3) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ring = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (Math.abs(a.lat - b.lat) > 1e-7 || Math.abs(a.lng - b.lng) > 1e-7) {
    ring.push({ ...a });
  }
  return ring.length >= 4 ? ring : null;
}

function centroidOf(pts) {
  if (!pts?.length) return null;
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

function pointInRing(lat, lng, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat;
    const xi = ring[i].lng;
    const yj = ring[j].lat;
    const xj = ring[j].lng;
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function toLatLngPt(p) {
  return { lat: p.lat ?? p.latitude, lng: p.lng ?? p.longitude };
}

function uniqueRingCount(poly) {
  const s = new Set();
  for (const p of poly || []) {
    const { lat, lng } = toLatLngPt(p);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      s.add(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    }
  }
  return s.size;
}

/** GPS-Kasten (2 Breiten × 2 Längen) — kein OSM-Gebäude. */
function isAxisBox(poly) {
  if (!poly || poly.length < 4 || poly.length > 6) return false;
  const lats = new Set();
  const lngs = new Set();
  for (const p of poly) {
    const { lat, lng } = toLatLngPt(p);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    lats.add(lat.toFixed(6));
    lngs.add(lng.toFixed(6));
  }
  return lats.size === 2 && lngs.size === 2;
}

function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area +=
      ring[j].lng * mLng * (ring[i].lat * mLat) -
      ring[i].lng * mLng * (ring[j].lat * mLat);
  }
  return Math.abs(area) / 2;
}

function distPointToSegM(lat, lng, a, b) {
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ax = a.lng * mLng;
  const ay = a.lat * mLat;
  const bx = b.lng * mLng;
  const by = b.lat * mLat;
  const px = lng * mLng;
  const py = lat * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToRingM(lat, lng, ring) {
  if (pointInRing(lat, lng, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = distPointToSegM(lat, lng, ring[i], ring[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function nameTokens(s, skip = []) {
  const skipSet = new Set(
    skip
      .flatMap((x) => String(x || '').toLowerCase().split(/[^a-z0-9äöü]+/i))
      .filter((t) => t.length >= 4),
  );
  return String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .split(/[^a-z0-9äöü]+/i)
    .filter((t) => t.length >= 5 && !skipSet.has(t));
}

function tokenHits(a, b) {
  if (!a.length || !b.length) return 0;
  let n = 0;
  for (const t of a) {
    if (b.includes(t) || b.some((x) => x.includes(t) || t.includes(x))) n += 1;
  }
  return n;
}

function hasRealOutline(spot) {
  const poly = spot.polygonCoordinates || spot.polygon;
  if (!Array.isArray(poly) || uniqueRingCount(poly) < 4) return false;
  if (isAxisBox(poly)) return false;
  const tags = spot.tags || [];
  return tags.includes('map_outline') || uniqueRingCount(poly) >= 5;
}

function kindOfHighway(h) {
  if (!h) return null;
  if (/^(motorway|trunk|primary|secondary)$/.test(h)) return 'major';
  if (/^(tertiary|unclassified|residential|living_street)$/.test(h)) {
    return 'street';
  }
  if (
    /^(service|footway|path|cycleway|pedestrian|track|steps)$/.test(h)
  ) {
    return 'path';
  }
  return null;
}

function isServiceRail(t) {
  const service = String(t.service || '').toLowerCase();
  if (service && /^(siding|yard|crossover|spur|pad)$/.test(service)) return true;
  if (t.abandoned === 'yes' || t.disused === 'yes') return true;
  const usage = String(t.usage || '').toLowerCase();
  return usage === 'military' || usage === 'tourism';
}

function railLengthM(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += distM(pts[i - 1], pts[i]);
  return n;
}

function minDistPointToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = distM(p, line[i]);
    if (d < best) best = d;
  }
  return best;
}

/** OSM mappt oft dasselbe Gleis mehrfach — fast deckungsgleiche Ways raus. */
function collapseDuplicateRails(rails, dupM = 2.4) {
  const ranked = rails
    .map((pts) => ({ pts, len: railLengthM(pts) }))
    .filter((r) => r.pts.length >= 2 && r.len >= 40)
    .sort((a, b) => b.len - a.len);
  const kept = [];
  for (const cand of ranked) {
    const sample = cand.pts.filter((_, i) => i % 4 === 0 || i === cand.pts.length - 1);
    const dup = kept.some((k) => {
      let hit = 0;
      for (const p of sample) {
        if (minDistPointToPolyline(p, k) <= dupM) hit += 1;
      }
      return hit >= Math.max(3, sample.length * 0.65);
    });
    if (!dup) kept.push(cand.pts);
  }
  return kept;
}

function elPoint(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  const ring = ringFromGeom(el);
  return ring ? centroidOf(ring) : null;
}

function classifyAmenity(el) {
  const t = el.tags || {};
  const a = String(t.amenity || '').toLowerCase();
  const rw = String(t.railway || '').toLowerCase();
  const hw = String(t.highway || '').toLowerCase();
  const pt = String(t.public_transport || '').toLowerCase();
  if (a === 'post_box' || a === 'mailbox') return 'post_box';
  if (a === 'parcel_locker') return 'parcel_locker';
  if (a === 'post_office') return 'post_office';
  if (a === 'toilets') return 'toilets';
  if (a === 'drinking_water') return 'drinking_water';
  if (a === 'bicycle_rental') return 'bicycle_rental';
  if (a === 'ferry_terminal' || t.amenity === 'ferry_terminal') return 'ferry';
  if (String(t.tourism || '').toLowerCase() === 'information') return 'tourist_info';
  if (String(t.tourism || '').toLowerCase() === 'viewpoint') return 'viewpoint';
  if (String(t.route || '').toLowerCase() === 'ferry' || rw === 'ferry') return 'ferry';
  if (rw === 'halt' || rw === 'station' || rw === 'tram_stop') return 'transit';
  if (hw === 'bus_stop' || pt === 'stop_position' || pt === 'station') {
    return 'transit';
  }
  return null;
}

function amenityName(kind, t, cityName) {
  const brand = (t.brand || '').trim();
  const name = (t.name || '').trim();
  const ref = (t.ref || '').trim();
  const op = (t.operator || '').trim();
  if (kind === 'parcel_locker') {
    const base = brand || (op ? `${op} Packstation` : 'Packstation');
    return ref ? `${base} ${ref}` : base;
  }
  if (kind === 'post_box') {
    if (name) return name;
    if (op) return `Briefkasten ${op}`;
    return 'Briefkasten';
  }
  if (kind === 'post_office') {
    return name || brand || op || 'Postfiliale';
  }
  if (kind === 'toilets') return name || 'Toilette';
  if (kind === 'tourist_info') return name || 'Tourist-Info';
  if (kind === 'viewpoint') return name || 'Aussichtspunkt';
  if (kind === 'drinking_water') return name || 'Trinkwasser';
  if (kind === 'bicycle_rental') {
    return name || brand || 'Fahrradverleih';
  }
  if (kind === 'ferry') return name || 'Fähre';
  if (name) return name;
  if (t.railway === 'halt') {
    return `Haltepunkt ${cityName || ''}`.trim();
  }
  return t.railway === 'station' ? `Bahnhof ${cityName || ''}`.trim() : 'Haltestelle';
}

function amenityBullets(kind, t) {
  const out = [];
  if (kind === 'post_box') {
    out.push('Öffentlicher Briefkasten zum Einwerfen');
    if (t.collection_times) out.push(`Leerung: ${String(t.collection_times).slice(0, 48)}`);
    else if (t.operator) out.push(`Betreiber: ${t.operator}`);
  } else if (kind === 'parcel_locker') {
    const bits = [];
    if (t.parcel_pickup === 'yes') bits.push('Abholen');
    if (t.parcel_mail_in === 'yes') bits.push('Einliefern');
    out.push(bits.length ? `Paketautomat · ${bits.join(' & ')}` : 'Paketautomat (Packstation)');
    if (t.ref) out.push(`Stationsnummer ${t.ref}`);
    else if (t.opening_hours === '24/7') out.push('Meist rund um die Uhr');
  } else if (kind === 'post_office') {
    out.push('Postfiliale / Annahme');
    if (t.opening_hours) out.push(`Öffnung: ${String(t.opening_hours).slice(0, 48)}`);
  } else if (kind === 'toilets') {
    out.push('Öffentliche Toilette');
    if (t.fee === 'yes') out.push('Kostenpflichtig');
    else if (t.fee === 'no') out.push('Kostenlos');
    if (t.wheelchair === 'yes') out.push('Rollstuhlzugang');
  } else if (kind === 'tourist_info') {
    out.push('Touristeninformation');
    if (t.opening_hours) out.push(`Öffnung: ${String(t.opening_hours).slice(0, 48)}`);
  } else if (kind === 'viewpoint') {
    out.push('Aussichtspunkt');
  } else if (kind === 'drinking_water') {
    out.push('Trinkwasser');
  } else if (kind === 'bicycle_rental') {
    out.push('Fahrradverleih');
    if (t.brand) out.push(String(t.brand));
  } else if (kind === 'ferry') {
    out.push('Fähranleger');
    if (t.operator) out.push(`Betreiber: ${t.operator}`);
  } else {
    const rw = t.railway || t.highway || t.public_transport || 'ÖPNV';
    out.push(`Haltepunkt / ${rw}`);
    if (t.network) out.push(`Netz: ${t.network}`);
    else if (t.operator) out.push(`Betreiber: ${t.operator}`);
  }
  return out.slice(0, 2);
}

function alreadyNear(pack, lat, lng, meters, name) {
  const n = (name || '').toLowerCase();
  for (const spot of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
    const slat = t?.lat ?? spot.lat;
    const slng = t?.lng ?? spot.lng;
    if (typeof slat !== 'number' || typeof slng !== 'number') continue;
    if (distM({ lat: slat, lng: slng }, { lat, lng }) > meters) continue;
    const sn = String(spot.name || '').toLowerCase();
    if (!n || !sn) return spot;
    if (sn === n) return spot;
    if (n.includes(sn) || sn.includes(n)) return spot;
  }
  return null;
}

function addAmenitySpot(pack, kind, el, cityName) {
  const t = el.tags || {};
  const pt = elPoint(el);
  if (!pt) return false;
  const name = amenityName(kind, t, cityName);
  const near = alreadyNear(pack, pt.lat, pt.lng, kind === 'transit' ? 55 : 28, name);
  if (near) return false;
  const osmKey = `${el.type || 'node'}_${el.id}`;
  const id = `${pack.city_id}_osm_${kind}_${el.id}`.slice(0, 80);
  if ((pack.spots || []).some((s) => s.id === id)) return false;
  const cat =
    kind === 'transit'
      ? 'bahnhof'
      : kind === 'parcel_locker'
        ? 'packstation'
        : kind === 'post_office'
          ? 'post'
          : kind === 'toilets'
            ? 'toilette'
            : kind === 'tourist_info'
              ? 'tourist_info'
              : kind === 'viewpoint'
                ? 'aussicht'
                : kind === 'drinking_water'
                  ? 'trinkwasser'
                  : kind === 'bicycle_rental'
                    ? 'fahrradverleih'
                    : kind === 'ferry'
                      ? 'fähre'
                      : 'briefkasten';
  const ring = closedRing(ringFromGeom(el));
  const mapPoint = !ring;
  const bullets = amenityBullets(kind, t);
  const tags = [
    cat,
    'directory',
    'tier4',
    'offline_lookup',
    'osm_map',
    kind,
    mapPoint ? 'map_point' : 'map_outline',
    `osm:${osmKey}`,
  ];
  const spot = {
    id,
    name,
    category: cat,
    district: cat,
    pack_role: 'directory',
    place_tier: 4,
    relevance: ['offline_lookup', cat],
    tags,
    bullets,
    facts: { now: bullets[0], tags: [cat, 'directory', 'osm_map'] },
    polygonCoordinates: ring
      ? ring.map((p) => ({ latitude: p.lat, longitude: p.lng }))
      : undefined,
    approach_triggers: [],
    sub_pois: [],
  };
  const trigger = {
    id,
    name,
    lat: pt.lat,
    lng: pt.lng,
    radius_m: mapPoint ? 12 : 18,
    trigger_kind: 'point',
    general_info: `${name} — OSM ${kind}.`,
    deep_data_pool: [
      {
        text: bullets[0] || name,
        tags: ['kurzfakt', 'osm_map', cat],
      },
      bullets[1]
        ? { text: bullets[1], tags: ['kurzfakt', 'osm_map'] }
        : {
            text: `Offline-Katalog: ${name} auf der Karte, Navigation starten.`,
            tags: ['directory', 'osm_map'],
          },
    ],
    polygon: ring || undefined,
  };
  pack.spots.push(spot);
  pack.trigger_points = pack.trigger_points || [];
  pack.trigger_points.push(trigger);
  return true;
}

function nodeKey(lat, lng) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function buildGraph(roadWays) {
  const nodes = new Map();
  const edges = [];
  const ensure = (lat, lng) => {
    const k = nodeKey(lat, lng);
    if (!nodes.has(k)) nodes.set(k, { id: k, lat, lng });
    return k;
  };
  for (const way of roadWays) {
    const pts = way.pts;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const w = distM(a, b);
      if (w <= 0 || w > 420) continue;
      const ia = ensure(a.lat, a.lng);
      const ib = ensure(b.lat, b.lng);
      if (ia === ib) continue;
      edges.push({ a: ia, b: ib, w: Math.round(w * 10) / 10, k: way.kind });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

function compactRing(pts) {
  return simplifyRing(pts, 2.4).map((p) => [
    +p.lat.toFixed(6),
    +p.lng.toFixed(6),
  ]);
}

function compactBuildingRing(pts) {
  return simplifyRing(pts, 0.7).map((p) => [
    +p.lat.toFixed(6),
    +p.lng.toFixed(6),
  ]);
}

const SLIM_MAX_ROADS = 14000;
const SLIM_PATH_NEAR_PIN_M = 90;

/**
 * Bei Cap (8000/14000): Gebäude räumlich streuen, sonst bleibt nur der Kern
 * und das 10-km-Umland wäre leer.
 */
function spreadSampleBuildings(buildings, maxN, bbox) {
  if (!Array.isArray(buildings) || buildings.length <= maxN) return buildings;
  if (!bbox) return buildings.slice(0, maxN);
  const cols = 8;
  const rows = 8;
  const buckets = Array.from({ length: cols * rows }, () => []);
  const dLat = Math.max(1e-9, bbox.north - bbox.south);
  const dLng = Math.max(1e-9, bbox.east - bbox.west);
  for (const b of buildings) {
    const lat = b?.c?.lat;
    const lng = b?.c?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      buckets[0].push(b);
      continue;
    }
    const r = Math.min(
      rows - 1,
      Math.max(0, Math.floor(((lat - bbox.south) / dLat) * rows)),
    );
    const c = Math.min(
      cols - 1,
      Math.max(0, Math.floor(((lng - bbox.west) / dLng) * cols)),
    );
    buckets[r * cols + c].push(b);
  }
  const per = Math.max(1, Math.ceil(maxN / (cols * rows)));
  const out = [];
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const take = Math.min(bucket.length, per);
    // gleichmäßig aus dem Bucket (nicht nur die ersten OSM-IDs)
    const step = bucket.length / take;
    for (let i = 0; i < take && out.length < maxN; i++) {
      out.push(bucket[Math.min(bucket.length - 1, Math.floor(i * step))]);
    }
  }
  if (out.length < maxN) {
    const seen = new Set(out);
    for (const b of buildings) {
      if (seen.has(b)) continue;
      out.push(b);
      if (out.length >= maxN) break;
    }
  }
  return out.slice(0, maxN);
}

function slimLargeCityExtract(extract, pins) {
  const roads = Array.isArray(extract.roads) ? extract.roads : [];
  const majors = [];
  const streets = [];
  const paths = [];
  for (const r of roads) {
    if (r.k === 0) majors.push(r);
    else if (r.k === 1) streets.push(r);
    else paths.push(r);
  }
  const pinNear = new Set();
  if (pins.length) {
    for (const r of paths) {
      const coords = r.c || [];
      for (const p of pins) {
        for (const c of coords) {
          if (distM({ lat: c[0], lng: c[1] }, p) <= SLIM_PATH_NEAR_PIN_M) {
            pinNear.add(r);
            break;
          }
        }
        if (pinNear.has(r)) break;
      }
    }
  }
  const nearPaths = paths.filter((r) => pinNear.has(r));
  const restPaths = paths.filter((r) => !pinNear.has(r));
  let kept = [...majors, ...streets, ...nearPaths];
  if (kept.length > SLIM_MAX_ROADS) {
    kept = [...majors, ...streets].slice(0, SLIM_MAX_ROADS);
    if (kept.length < SLIM_MAX_ROADS) {
      kept.push(...nearPaths.slice(0, SLIM_MAX_ROADS - kept.length));
    }
  } else {
    kept.push(...restPaths.slice(0, SLIM_MAX_ROADS - kept.length));
  }
  const ways = kept.map((r) => ({
    kind: r.k === 0 ? 'major' : r.k === 1 ? 'street' : 'path',
    pts: (r.c || []).map(([lat, lng]) => ({ lat, lng })),
  }));
  const graph = buildGraph(ways);
  extract.roads = kept;
  extract.graph = {
    nodes: graph.nodes.map((n) => ({
      i: n.id,
      a: +n.lat.toFixed(6),
      o: +n.lng.toFixed(6),
    })),
    edges: graph.edges,
  };
  return extract;
}

async function overpass(query) {
  return fetchOverpass(query);
}

async function withOverpassRetries(label, fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const wait = 4000 * (i + 1);
      console.warn(
        `[offline-map] ${label} fail (${i + 1}/${attempts}): ${e.message || e}`,
      );
      if (i < attempts - 1) await sleep(wait);
    }
  }
  throw last;
}

function amenityQueryForBbox(bbox, { skipBus = false } = {}) {
  const bus = skipBus
    ? ''
    : `node["highway"="bus_stop"]["name"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["public_transport"="platform"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`;
  return `
[out:json][timeout:75];
(
  node["amenity"="post_box"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  nwr["amenity"="parcel_locker"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  nwr["amenity"="post_office"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["amenity"="toilets"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["amenity"="drinking_water"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  nwr["amenity"="bicycle_rental"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  nwr["amenity"="ferry_terminal"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["tourism"="information"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["tourism"="viewpoint"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["railway"="halt"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["railway"="station"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["railway"="tram_stop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["public_transport"="station"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  ${bus}
);
out geom center;
`;
}

async function fetchAmenities(bbox, { large = false, pins = [] } = {}) {
  if (!large) {
    const data = await overpass(amenityQueryForBbox(bbox));
    return data.elements || [];
  }
  const around = [];
  const seen = new Set();
  for (const s of pins) {
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    around.push(s);
  }
  const els = [];
  const batchSize = 16;
  for (let i = 0; i < around.length; i += batchSize) {
    const chunk = around.slice(i, i + batchSize);
    const parts = chunk
      .map((p) => {
        const a = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
        return `node(around:${LARGE_BUILDING_AROUND_M},${a})["amenity"="post_box"];
  nwr(around:${LARGE_BUILDING_AROUND_M},${a})["amenity"="parcel_locker"];
  nwr(around:${LARGE_BUILDING_AROUND_M},${a})["amenity"="post_office"];
  node(around:${LARGE_BUILDING_AROUND_M},${a})["amenity"="toilets"];
  node(around:${LARGE_BUILDING_AROUND_M},${a})["tourism"="information"];
  node(around:${LARGE_BUILDING_AROUND_M},${a})["tourism"="viewpoint"];
  node(around:${LARGE_BUILDING_AROUND_M},${a})["railway"="station"];
  node(around:${LARGE_BUILDING_AROUND_M},${a})["railway"="halt"];`;
      })
      .join('\n');
    try {
      const data = await overpass(`
[out:json][timeout:60];
(
${parts}
);
out geom center;
`);
      els.push(...(data.elements || []));
    } catch (e) {
      console.warn(`[offline-map] amenities batch fail: ${e.message || e}`);
    }
    await sleep(350);
  }
  return els;
}

async function fetchMapLayersOne(bbox, large) {
  const extraLand = large
    ? ''
    : `way["landuse"="residential"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`;
  const highways = large
    ? `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`
    : `way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`;
  const q = `
[out:json][timeout:${large ? 120 : 90}];
(
  ${highways}
  way["natural"="water"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["waterway"="riverbank"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["landuse"="forest"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["leisure"="park"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["leisure"="garden"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["railway"="rail"]["service"!~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  ${extraLand}
);
out geom;
`;
  const data = await overpass(q);
  return data.elements || [];
}

async function fetchMapLayers(bbox, large) {
  const tileM = large ? TILE_SPAN_M : DENSE_TILE_SPAN_M;
  const tiles = bboxSpanM(bbox) > tileM ? tileBbox(bbox, tileM) : [bbox];
  if (tiles.length === 1) return fetchMapLayersOne(bbox, large);
  const els = [];
  console.log(`[offline-map] map layers in ${tiles.length} tiles`);
  for (let i = 0; i < tiles.length; i++) {
    try {
      els.push(
        ...(await withOverpassRetries(`tile ${i + 1}/${tiles.length}`, () =>
          fetchMapLayersOne(tiles[i], large),
        )),
      );
      console.log(`[offline-map] tile ${i + 1}/${tiles.length} ok (n=${els.length})`);
    } catch (e) {
      console.warn(
        `[offline-map] tile ${i + 1}/${tiles.length} fail: ${e.message || e}`,
      );
    }
    await sleep(400);
  }
  return els;
}

async function fetchBuildingsFull(bbox) {
  const q = `
[out:json][timeout:90];
(
  way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  relation["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out geom;
`;
  const data = await overpass(q);
  return data.elements || [];
}

async function fetchBuildings(bbox, large, spots) {
  // large=true → nur Pins (Story-Outlines außerhalb). Sonst immer Flächen-Tiles
  // für das 10-km-Umland — auch wenn die BBox „groß“ ist.
  if (!large) {
    const span = bboxSpanM(bbox);
    const tileM =
      span > FULL_EXTRACT_MAX_M ? TILE_SPAN_M : DENSE_TILE_SPAN_M;
    const tiles = span > tileM ? tileBbox(bbox, tileM) : [bbox];
    if (tiles.length === 1) {
      try {
        return await withOverpassRetries('full buildings', () =>
          fetchBuildingsFull(bbox),
        );
      } catch (e) {
        console.warn(`[offline-map] full buildings fail: ${e.message || e}`);
        return [];
      }
    }
    const els = [];
    console.log(`[offline-map] buildings in ${tiles.length} tiles (${tileM}m)`);
    for (let i = 0; i < tiles.length; i++) {
      try {
        els.push(
          ...(await withOverpassRetries(`bld tile ${i + 1}/${tiles.length}`, () =>
            fetchBuildingsFull(tiles[i]),
          )),
        );
        console.log(
          `[offline-map] bld tile ${i + 1}/${tiles.length} ok (n=${els.length})`,
        );
      } catch (err) {
        console.warn(`[offline-map] building tile fail: ${err.message || err}`);
      }
      await sleep(400);
    }
    return els;
  }
  const around = [];
  const seen = new Set();
  for (const s of spots) {
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    around.push(s);
  }
  const batchSize = 18;
  const els = [];
  for (let i = 0; i < around.length; i += batchSize) {
    const chunk = around.slice(i, i + batchSize);
    const parts = chunk
      .map(
        (p) =>
          `way(around:${LARGE_BUILDING_AROUND_M},${p.lat.toFixed(6)},${p.lng.toFixed(6)})["building"];`,
      )
      .join('\n');
    try {
      const data = await overpass(`
[out:json][timeout:60];
(
${parts}
);
out geom;
`);
      els.push(...(data.elements || []));
    } catch (e) {
      console.warn(`[offline-map] buildings batch fail: ${e.message || e}`);
    }
    await sleep(400);
  }
  return els;
}

async function fetchHousenumbers(bbox, large) {
  if (large) return [];
  try {
    const data = await overpass(`
[out:json][timeout:50];
(
  node["addr:housenumber"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["addr:housenumber"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out center;
`);
    const out = [];
    for (const e of data.elements || []) {
      const lat = typeof e.lat === 'number' ? e.lat : e.center?.lat;
      const lng = typeof e.lon === 'number' ? e.lon : e.center?.lon;
      const n = e.tags?.['addr:housenumber'];
      if (typeof lat !== 'number' || typeof lng !== 'number' || !n) continue;
      const s = String(e.tags['addr:street'] || '').trim().slice(0, 80);
      out.push({
        lat: +lat.toFixed(6),
        lng: +lng.toFixed(6),
        n: String(n).slice(0, 8),
        ...(s ? { s } : {}),
      });
    }
    return out.slice(0, 8000);
  } catch {
    return [];
  }
}

function spotPins(pack) {
  const out = [];
  for (const spot of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
    const lat = t?.lat ?? spot.lat;
    const lng = t?.lng ?? spot.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      out.push({ spot, lat, lng });
    }
  }
  return out;
}

function matchBuilding(lat, lng, buildings, name, extra = {}) {
  const blob = String(name || '').toLowerCase();
  const wantWide =
    /\b(golf|tennis|sport|stadion|hotel|lager|tankstelle|fairway|clubhaus|halle|restaurant|self.?storage)\b/i.test(
      blob,
    );
  const nearMax = wantWide ? 48 : 28;
  const namedMax = wantWide ? 130 : 70;
  const tokens = nameTokens(name, extra.skipTokens || []);
  let best = null;
  let bestScore = -Infinity;
  for (const b of buildings) {
    if (!b?.ring || b.ring.length < 3) continue;
    const area = ringAreaM2(b.ring);
    if (area > 18_000) continue;
    const inside = pointInRing(lat, lng, b.ring);
    const edge = distToRingM(lat, lng, b.ring);
    const nm = String(b.name || '').toLowerCase();
    const named =
      (nm && (blob.includes(nm) || nm.includes(blob.slice(0, 12)))) ||
      tokenHits(tokens, nameTokens(nm)) > 0;
    const maxD = named ? namedMax : nearMax;
    if (!inside && edge > maxD) continue;
    if (!inside && !named && area > 6_000 && edge > 18) continue;
    let score =
      (inside ? 240 : 0) -
      edge * 2.1 -
      Math.min(area, 5_000) * 0.003;
    if (named) score += 90;
    if (edge < 10) score += 35;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

function matchSiblingOutline(pack, spot, pin, skipTokens) {
  const tokens = nameTokens(spot.name, skipTokens);
  if (!tokens.length || !pin) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const other of pack.spots || []) {
    if (other === spot || !hasRealOutline(other)) continue;
    const hits = tokenHits(tokens, nameTokens(other.name, skipTokens));
    if (!hits) continue;
    const t = (pack.trigger_points || []).find((x) => x.id === other.id);
    const olat = t?.lat;
    const olng = t?.lng;
    if (!Number.isFinite(olat) || !Number.isFinite(olng)) continue;
    const d = distM(pin, { lat: olat, lng: olng });
    if (d > 170) continue;
    const score = hits * 50 - d * 0.35;
    if (score > bestScore) {
      bestScore = score;
      const poly = other.polygonCoordinates || other.polygon;
      best = {
        ring: poly.map((p) => toLatLngPt(p)),
        c: { lat: olat, lng: olng },
        name: other.name,
      };
    }
  }
  return best;
}

function applyOutline(pack, spot, ring, pin) {
  const clean = ring.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  spot.polygonCoordinates = clean;
  delete spot.polygonRings;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []).filter((x) => x !== 'map_point'),
      'map_outline',
      'sourced_osm',
    ]),
  ];
  const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
  if (trigger) {
    trigger.polygon = ring.map((p) => ({ lat: p.lat, lng: p.lng }));
    if (pin) {
      trigger.lat = pin.lat;
      trigger.lng = pin.lng;
    }
  }
}

function applyPoint(pack, spot) {
  if (hasRealOutline(spot)) return;
  const poly = spot.polygonCoordinates || spot.polygon;
  if (isAxisBox(poly)) {
    delete spot.polygonCoordinates;
    delete spot.polygon;
  }
  const left = spot.polygonCoordinates || spot.polygon;
  if (Array.isArray(left) && uniqueRingCount(left) >= 4 && !isAxisBox(left)) {
    spot.tags = [
      ...new Set([
        ...(spot.tags || []).filter((x) => x !== 'map_point'),
        'map_outline',
        'sourced_osm',
      ]),
    ];
    return;
  }
  spot.tags = [
    ...new Set([
      ...(spot.tags || []).filter((x) => x !== 'map_outline'),
      'map_point',
    ]),
  ];
  const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
  if (trigger) delete trigger.polygon;
}

async function uploadSidecar(cityId) {
  const packFile = path.join(STAEDTE_DIR, `${cityId}.json`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), packFile],
      { cwd: ROOT, stdio: 'inherit' },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`upload ${cityId} exit ${code}`)),
    );
    child.on('error', reject);
  });
}

export async function buildCityOfflineMap(cityId, { skipUpload = false } = {}) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn(`[offline-map] missing ${cityId}`);
    return { cityId, ok: false };
  }
  pack.spots = pack.spots || [];
  pack.trigger_points = pack.trigger_points || [];
  const polyAdded = await ensureCoveragePolygon(pack);
  if (polyAdded) savePack(pack, { bumpVersion: true });

  const fullBbox = packCoverageBbox(pack);
  const cityIsLarge = bboxSpanM(fullBbox) > FULL_EXTRACT_MAX_M;
  const lat = Number(pack.lat);
  const lng = Number(pack.lng);
  /**
   * Gebäude/Hausnummern:
   * - Klein/mittel: Admin + 10 km Umland (gleiche Detailtiefe wie in der Stadt).
   * - Großstadt: 10 km Radius um Pack-Zentrum (nicht nur 4,5 km Kern).
   */
  const buildingBbox =
    cityIsLarge && Number.isFinite(lat) && Number.isFinite(lng)
      ? coreBboxFromCenter(lat, lng, UMLAND_DETAIL_RADIUS_M)
      : expandBbox(fullBbox, UMLAND_DETAIL_PAD_M);
  /**
   * Straßen/Wasser/Parks: ebenfalls ~10 km Umland — kein harter Karten-Abbruch
   * am Gemeinderand.
   */
  const extractBbox =
    cityIsLarge && Number.isFinite(lat) && Number.isFinite(lng)
      ? coreBboxFromCenter(lat, lng, UMLAND_DETAIL_RADIUS_M)
      : expandBbox(fullBbox, UMLAND_ROADS_PAD_M);
  const extractLarge = bboxSpanM(extractBbox) > FULL_EXTRACT_MAX_M;
  const buildingLarge = bboxSpanM(buildingBbox) > FULL_EXTRACT_MAX_M;
  console.log(
    `[offline-map] ▶ ${cityId} span≈${Math.round(bboxSpanM(fullBbox))}m large=${cityIsLarge}` +
      ` map≈${Math.round(bboxSpanM(extractBbox))}m extractLarge=${extractLarge}` +
      ` buildings≈${Math.round(bboxSpanM(buildingBbox))}m` +
      ` umland=${UMLAND_DETAIL_PAD_M}m`,
  );

  const pins = spotPins(pack);
  let amenEls = [];
  const skipAmenities = cityIsLarge && pins.length > 80;
  try {
    if (skipAmenities) {
      console.log(
        `[offline-map] ${cityId} skip amenity harvest (large + ${pins.length} pins)`,
      );
    } else {
      amenEls = await fetchAmenities(fullBbox, { large: cityIsLarge, pins });
    }
  } catch (e) {
    console.warn(`[offline-map] ${cityId} amenities: ${e.message || e}`);
  }
  await sleep(350);
  let added = 0;
  for (const el of amenEls) {
    const kind = classifyAmenity(el);
    if (!kind) continue;
    if (addAmenitySpot(pack, kind, el, pack.name)) added += 1;
  }
  console.log(`[offline-map] ${cityId} amenities +${added} (osm ${amenEls.length})`);
  if (added > 0) {
    savePack(pack, { bumpVersion: true });
  }
  const pinsAfter = spotPins(pack);
  let mapEls = [];
  let bEls = [];
  let housenumbers = [];
  try {
    mapEls = await fetchMapLayers(extractBbox, extractLarge);
  } catch (e) {
    console.warn(`[offline-map] ${cityId} map layers: ${e.message || e}`);
  }
  await sleep(400);
  try {
    if (cityIsLarge) {
      const coreB = await fetchBuildings(buildingBbox, false, pinsAfter);
      await sleep(400);
      const storyOutside = pinsAfter
        .filter((p) => p.spot?.pack_role !== 'directory')
        .filter(
          (p) =>
            p.lat < buildingBbox.south ||
            p.lat > buildingBbox.north ||
            p.lng < buildingBbox.west ||
            p.lng > buildingBbox.east,
        )
        .slice(0, 80);
      const pinB = storyOutside.length
        ? await fetchBuildings(fullBbox, true, storyOutside)
        : [];
      bEls = [...coreB, ...pinB];
    } else {
      // Immer Flächen-Tiles fürs Umland — nie pin-around nur weil BBox groß ist.
      bEls = await fetchBuildings(buildingBbox, false, pinsAfter);
    }
  } catch (e) {
    console.warn(`[offline-map] ${cityId} buildings: ${e.message || e}`);
  }
  await sleep(300);
  try {
    housenumbers = cityIsLarge
      ? []
      : await fetchHousenumbers(buildingBbox, buildingLarge);
    if (cityIsLarge) {
      console.log(`[offline-map] ${cityId} skip housenumbers (dense core)`);
    }
  } catch (e) {
    console.warn(`[offline-map] ${cityId} housenumbers: ${e.message || e}`);
  }

  const roads = [];
  const water = [];
  const parks = [];
  const woods = [];
  const rails = [];
  const land = [];
  const buildings = [];
  const seenWay = new Set();

  for (const el of [...mapEls, ...bEls]) {
    if (el.type !== 'way' || seenWay.has(el.id)) continue;
    seenWay.add(el.id);
    const t = el.tags || {};
    const pts = ringFromGeom(el);
    if (!pts) continue;
    if (t.building) {
      const ring = closedRing(pts);
      if (!ring) continue;
      const c = centroidOf(ring);
      if (!c) continue;
      buildings.push({
        ring: simplifyRing(ring, 0.7),
        c,
        name: t.name || '',
      });
      continue;
    }
    const hw = kindOfHighway(t.highway);
    if (hw) {
      const roadName = String(t.name || t['name:de'] || '').trim().slice(0, 48);
      roads.push({
        kind: hw,
        name: roadName,
        pts: simplifyRing(pts, hw === 'path' ? 3.5 : 6),
      });
      continue;
    }
    if (t.railway === 'rail') {
      if (isServiceRail(t)) continue;
      rails.push(simplifyRing(pts, 2.4));
      continue;
    }
    const area = closedRing(pts);
    if (!area) continue;
    if (t.natural === 'water' || t.waterway === 'riverbank') water.push(area);
    else if (t.leisure === 'park' || t.leisure === 'garden') parks.push(area);
    else if (t.landuse === 'forest') woods.push(area);
    else if (t.landuse === 'residential') land.push(area);
  }

  const skipTokens = [pack.city_id, pack.name, pack.display_name];
  let outlined = 0;
  let pointed = 0;
  for (const { spot, lat, lng } of pinsAfter) {
    const hit =
      matchBuilding(lat, lng, buildings, spot.name, { skipTokens }) ||
      matchSiblingOutline(pack, spot, { lat, lng }, skipTokens);
    if (hit) {
      applyOutline(pack, spot, hit.ring, hit.c);
      outlined += 1;
    } else if (hasRealOutline(spot)) {
      outlined += 1;
    } else {
      applyPoint(pack, spot);
      pointed += 1;
    }
  }

  const buildingCap = extractLarge ? 8000 : 14000;
  const buildingsKept = spreadSampleBuildings(
    buildings,
    buildingCap,
    extractBbox,
  );
  const graph = cityIsLarge ? { nodes: [], edges: [] } : buildGraph(roads);
  const extract = {
    v: 1,
    cityId,
    bbox: extractBbox,
    roads: roads.map((r) => ({
      k: r.kind === 'major' ? 0 : r.kind === 'street' ? 1 : 2,
      ...(r.name ? { n: r.name } : {}),
      c: compactRing(r.pts),
    })),
    buildings: buildingsKept.map((b) => compactBuildingRing(b.ring)),
    water: water.map(compactRing),
    parks: parks.map(compactRing),
    woods: woods.map(compactRing),
    land: land.slice(0, 400).map(compactRing),
    rails: collapseDuplicateRails(rails).map((p) => compactRing(p)),
    housenumbers,
    graph: {
      nodes: graph.nodes.map((n) => ({
        i: n.id,
        a: +n.lat.toFixed(6),
        o: +n.lng.toFixed(6),
      })),
      edges: graph.edges,
    },
  };
  if (cityIsLarge) {
    slimLargeCityExtract(extract, pinsAfter);
  }

  const extractPath = path.join(STAEDTE_DIR, `${cityId}.map.json`);
  fs.writeFileSync(extractPath, JSON.stringify(extract));
  const kb = Math.round(fs.statSync(extractPath).size / 1024);
  pack._map_extract = { file: `${cityId}.map.json`, kb, at: new Date().toISOString() };
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    map_extract_kb: kb,
  };
  savePack(pack, { bumpVersion: true });
  console.log(
    `[offline-map] ${cityId} roads=${roads.length} bld=${buildings.length} graph=${graph.nodes.length}n outline=${outlined} point=${pointed} extract=${kb}kb`,
  );

  if (!skipUpload) {
    try {
      await uploadSidecar(cityId);
    } catch (e) {
      console.warn(`[offline-map] upload ${cityId}: ${e.message || e}`);
    }
  }
  return { cityId, ok: true, kb, added, outlined, pointed };
}

function copyMeinLagerIntoPrisdorf(pack) {
  if (String(pack.city_id || '').toLowerCase() !== 'prisdorf') return 0;
  const has = (pack.spots || []).some(
    (s) => /meinlager|mein.?lager/i.test(`${s.id} ${s.name}`),
  );
  if (has) return 0;
  const src = loadPack('pinneberg');
  const spot = (src?.spots || []).find(
    (s) => s.id === 'pinneberg_meinlager_de_selfstorage_bei_hamburg',
  );
  if (!spot || !hasRealOutline(spot)) return 0;
  const trigger = (src.trigger_points || []).find((t) => t.id === spot.id);
  const clone = JSON.parse(JSON.stringify(spot));
  clone.id = 'prisdorf_meinlager_de_selfstorage';
  pack.spots = pack.spots || [];
  pack.spots.push(clone);
  if (trigger) {
    const t = JSON.parse(JSON.stringify(trigger));
    t.id = clone.id;
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push(t);
  }
  return 1;
}

function buildingsFromElements(els) {
  const out = [];
  const seen = new Set();
  for (const el of els || []) {
    if ((el.type !== 'way' && el.type !== 'relation') || seen.has(el.id)) {
      continue;
    }
    const t = el.tags || {};
    if (
      t.leisure === 'pitch' ||
      t.leisure === 'golf_course' ||
      t.leisure === 'park' ||
      t.natural
    ) {
      continue;
    }
    const pts = closedRing(ringFromGeom(el));
    if (!pts) continue;
    if (ringAreaM2(pts) > 18_000) continue;
    const c = centroidOf(pts);
    if (!c) continue;
    seen.add(el.id);
    out.push({ ring: simplifyRing(pts, 1.8), c, name: t.name || '' });
  }
  return out;
}

async function fetchPinBuildings(pins) {
  const els = [];
  const batch = 8;
  for (let i = 0; i < pins.length; i += batch) {
    const chunk = pins.slice(i, i + batch);
    const parts = chunk
      .map(
        (p) => `
  way(around:95,${p.lat.toFixed(6)},${p.lng.toFixed(6)})["building"];
  way(around:95,${p.lat.toFixed(6)},${p.lng.toFixed(6)})["amenity"~"^(restaurant|fuel|pub|bar|cafe|fast_food)$"];
  way(around:95,${p.lat.toFixed(6)},${p.lng.toFixed(6)})["leisure"="sports_centre"];
  way(around:95,${p.lat.toFixed(6)},${p.lng.toFixed(6)})["shop"="storage_rental"];`,
      )
      .join('\n');
    try {
      const data = await overpass(`
[out:json][timeout:50];
(
${parts}
);
out geom;
`);
      els.push(...(data.elements || []));
    } catch (e) {
      console.warn(`[offline-map] pin buildings fail: ${e.message || e}`);
    }
    await sleep(450);
  }
  return els;
}

function buildingsFromExtractFile(cityId) {
  const extractPath = path.join(STAEDTE_DIR, `${cityId}.map.json`);
  if (!fs.existsSync(extractPath)) return [];
  try {
    const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
    const out = [];
    for (const ring of extract.buildings || []) {
      const pts = (ring || []).map(([lat, lng]) => ({ lat, lng }));
      const closed = closedRing(pts);
      if (!closed) continue;
      const c = centroidOf(closed);
      if (c) out.push({ ring: closed, c, name: '' });
    }
    return out;
  } catch (e) {
    console.warn(`[offline-map] extract ${cityId}: ${e.message || e}`);
    return [];
  }
}

async function rematchOutlines(cityId, { skipUpload = false } = {}) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn(`[offline-map] rematch missing ${cityId}`);
    return { cityId, ok: false };
  }
  if (copyMeinLagerIntoPrisdorf(pack)) {
    console.log(`[offline-map] ${cityId} +meinLAGER (Peiner Hag)`);
  }
  const skipTokens = [pack.city_id, pack.name, pack.display_name];
  const buildings = buildingsFromExtractFile(cityId);
  const pins = spotPins(pack);
  const unmatched = [];
  let outlined = 0;
  let kept = 0;
  let pointed = 0;
  for (const item of pins) {
    const { spot, lat, lng } = item;
    const hint = POINT_HINT_RE.test(
      `${spot.name || ''} ${(spot.tags || []).join(' ')}`,
    );
    if (hint && !hasRealOutline(spot)) {
      applyPoint(pack, spot);
      pointed += 1;
      continue;
    }
    const hit =
      matchBuilding(lat, lng, buildings, spot.name, { skipTokens }) ||
      matchSiblingOutline(pack, spot, { lat, lng }, skipTokens);
    if (hit) {
      applyOutline(pack, spot, hit.ring, hit.c);
      outlined += 1;
    } else if (hasRealOutline(spot)) {
      kept += 1;
    } else {
      unmatched.push(item);
    }
  }
  const tryOverpass = hasFlag('overpass') && unmatched.length > 0 && unmatched.length <= 24;
  if (tryOverpass) {
    console.log(
      `[offline-map] ${cityId} Overpass ${unmatched.length} fehlende Gebäude`,
    );
    const extra = buildingsFromElements(await fetchPinBuildings(unmatched));
    buildings.push(...extra);
    for (const item of unmatched) {
      const hit =
        matchBuilding(item.lat, item.lng, buildings, item.spot.name, {
          skipTokens,
        }) ||
        matchSiblingOutline(
          pack,
          item.spot,
          { lat: item.lat, lng: item.lng },
          skipTokens,
        );
      if (hit) {
        applyOutline(pack, item.spot, hit.ring, hit.c);
        outlined += 1;
      } else if (hasRealOutline(item.spot)) {
        kept += 1;
      } else {
        applyPoint(pack, item.spot);
        pointed += 1;
      }
    }
  } else if (unmatched.length) {
    console.log(
      `[offline-map] ${cityId} skip Overpass (${unmatched.length} unmatched)`,
    );
    for (const item of unmatched) {
      if (hasRealOutline(item.spot)) kept += 1;
      else {
        applyPoint(pack, item.spot);
        pointed += 1;
      }
    }
  }
  savePack(pack, { bumpVersion: true });
  console.log(
    `[offline-map] rematch ${cityId} +outline ${outlined} keep ${kept} point ${pointed}`,
  );
  if (!skipUpload) {
    try {
      await uploadSidecar(cityId);
    } catch (e) {
      console.warn(`[offline-map] upload ${cityId}: ${e.message || e}`);
    }
  }
  return { cityId, ok: true, outlined, kept, pointed };
}

async function slimExistingExtract(cityId, { skipUpload = false } = {}) {
  const pack = loadPack(cityId);
  const extractPath = path.join(STAEDTE_DIR, `${cityId}.map.json`);
  if (!pack || !fs.existsSync(extractPath)) {
    console.warn(`[offline-map] slim missing ${cityId}`);
    return { cityId, ok: false };
  }
  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  const beforeKb = Math.round(fs.statSync(extractPath).size / 1024);
  slimLargeCityExtract(extract, spotPins(pack));
  fs.writeFileSync(extractPath, JSON.stringify(extract));
  const kb = Math.round(fs.statSync(extractPath).size / 1024);
  pack._map_extract = {
    ...(pack._map_extract || {}),
    file: `${cityId}.map.json`,
    kb,
    at: new Date().toISOString(),
  };
  pack._pack_index = {
    ...(pack._pack_index || {}),
    map_extract_kb: kb,
  };
  savePack(pack, { bumpVersion: true });
  console.log(
    `[offline-map] slim ${cityId} ${beforeKb}kb → ${kb}kb roads=${extract.roads.length} graph=${extract.graph.nodes.length}n`,
  );
  if (!skipUpload) {
    try {
      await uploadSidecar(cityId);
    } catch (e) {
      console.warn(`[offline-map] upload ${cityId}: ${e.message || e}`);
    }
  }
  return { cityId, ok: true, kb };
}

async function cleanRailsExtract(cityId, { skipUpload = false } = {}) {
  const pack = loadPack(cityId);
  const extractPath = path.join(STAEDTE_DIR, `${cityId}.map.json`);
  if (!pack || !fs.existsSync(extractPath)) {
    console.warn(`[offline-map] clean-rails missing ${cityId}`);
    return { cityId, ok: false };
  }
  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  const before = (extract.rails || []).length;
  const asPts = (extract.rails || []).map((ring) =>
    ring.map(([lat, lng]) => ({ lat, lng })),
  );
  extract.rails = collapseDuplicateRails(asPts).map((p) => compactRing(p));
  fs.writeFileSync(extractPath, JSON.stringify(extract));
  const kb = Math.round(fs.statSync(extractPath).size / 1024);
  console.log(
    `[offline-map] clean-rails ${cityId} ${before} → ${extract.rails.length} ways (${kb}kb)`,
  );
  if (!skipUpload) {
    try {
      await uploadSidecar(cityId);
    } catch (e) {
      console.warn(`[offline-map] upload ${cityId}: ${e.message || e}`);
    }
  }
  return { cityId, ok: true, rails: extract.rails.length };
}

async function main() {
  const skipUpload = hasFlag('no-upload') || hasFlag('skip-upload');
  const skipDone = hasFlag('skip-done');
  const slimOnly = hasFlag('slim-only');
  const rematchOnly = hasFlag('rematch-only');
  const cleanRails = hasFlag('clean-rails');
  const cities = hasFlag('all')
    ? listCityPackIds()
    : arg('city')
      ? [arg('city')]
      : [];
  if (!cities.length) {
    console.error(
      'Usage: node scripts/cityPack/buildCityOfflineMap.mjs --city <id> | --all [--no-upload] [--skip-done] [--slim-only] [--rematch-only]',
    );
    process.exit(1);
  }
  const ok = [];
  for (const id of cities) {
    try {
      if (cleanRails) {
        const r = await cleanRailsExtract(id, { skipUpload });
        if (r.ok) ok.push(id);
        continue;
      }
      if (slimOnly) {
        const r = await slimExistingExtract(id, { skipUpload });
        if (r.ok) ok.push(id);
        continue;
      }
      if (rematchOnly) {
        const r = await rematchOutlines(id, { skipUpload });
        if (r.ok) ok.push(id);
        continue;
      }
      if (skipDone) {
        const pack = loadPack(id);
        if (pack?._map_extract?.file) {
          console.log(`[offline-map] skip ${id} (extract exists)`);
          ok.push(id);
          continue;
        }
      }
      const r = await buildCityOfflineMap(id, { skipUpload });
      if (r.ok) ok.push(id);
    } catch (e) {
      console.warn(`[offline-map] FAIL ${id}: ${e.message || e}`);
    }
    await sleep(rematchOnly ? 400 : 1200);
  }
  console.log(`[offline-map] done ${ok.length}/${cities.length}: ${ok.join(', ')}`);
}

const isDirect = process.argv[1]?.replace(/\\/g, '/').endsWith(
  'buildCityOfflineMap.mjs',
);
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
