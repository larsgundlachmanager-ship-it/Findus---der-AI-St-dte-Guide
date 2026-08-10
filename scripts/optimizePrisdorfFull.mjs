#!/usr/bin/env node
/**
 * Full Prisdorf optimization: every spot gets Google-resolved coords,
 * area polygon, approach waypoint(s), and optional nearby sub-POIs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACK_PATH = path.join(ROOT, 'data/staedte/prisdorf.json');
const REPORT_PATH = path.join(ROOT, 'data/staedte/prisdorf_google_full_report.json');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

loadEnv();
const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
if (!KEY || KEY.includes('your-')) {
  console.error('Missing GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function boxPolygon(lat, lng, halfM) {
  const nw = offset(lat, lng, halfM, -halfM);
  const ne = offset(lat, lng, halfM, halfM);
  const se = offset(lat, lng, -halfM, halfM);
  const sw = offset(lat, lng, -halfM, -halfM);
  return [
    { latitude: sw.lat, longitude: sw.lng },
    { latitude: se.lat, longitude: se.lng },
    { latitude: ne.lat, longitude: ne.lng },
    { latitude: nw.lat, longitude: nw.lng },
    { latitude: sw.lat, longitude: sw.lng },
  ];
}

function elongateEW(lat, lng, halfLenM, halfWM) {
  const a = offset(lat, lng, -halfWM, -halfLenM);
  const b = offset(lat, lng, -halfWM, halfLenM);
  const c = offset(lat, lng, halfWM, halfLenM);
  const d = offset(lat, lng, halfWM, -halfLenM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

async function gjson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
    throw new Error(`${data.status}: ${data.error_message || ''}`);
  }
  return data;
}

async function placesText(query, near) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  u.searchParams.set('query', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  if (near) {
    u.searchParams.set('location', `${near.lat},${near.lng}`);
    u.searchParams.set('radius', '3500');
  }
  await sleep(150);
  return gjson(u.toString());
}

async function geocode(query, near) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('address', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  if (near) {
    u.searchParams.set(
      'bounds',
      `${near.lat - 0.04},${near.lng - 0.04}|${near.lat + 0.04},${near.lng + 0.04}`,
    );
  }
  await sleep(150);
  return gjson(u.toString());
}

async function nearbySearch(lat, lng, type, radius = 45) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', String(radius));
  u.searchParams.set('type', type);
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', KEY);
  await sleep(120);
  return gjson(u.toString());
}

async function streetViewMeta(lat, lng) {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', '50');
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('key', KEY);
  await sleep(80);
  return gjson(u.toString());
}

function scoreResult(r, preferTypes, near) {
  let score = 0;
  const types = r.types || [];
  for (const t of preferTypes) if (types.includes(t)) score += 12;
  if (types.includes('point_of_interest')) score += 2;
  if (types.includes('establishment')) score += 1;
  if (near && r.geometry?.location) {
    const d = distM(near, {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
    });
    if (d < 80) score += 8;
    else if (d < 250) score += 4;
    else if (d > 2000) score -= 20;
  }
  // Prefer Prisdorf in address
  const addr = `${r.formatted_address || ''} ${r.name || ''}`.toLowerCase();
  if (addr.includes('prisdorf')) score += 6;
  if (addr.includes('pinneberg') && !addr.includes('prisdorf')) score -= 8;
  return score;
}

function locOf(r) {
  if (!r?.geometry?.location) return null;
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    name: r.name || r.formatted_address,
    address: r.formatted_address || r.vicinity || null,
    types: r.types || [],
    place_id: r.place_id,
  };
}

function inferCategory(spot, trigger) {
  const blob = `${spot.id} ${spot.name} ${spot.district || ''} ${spot.category || ''}`.toLowerCase();
  if (/bahnhof|haltepunkt|wartehäuschen/.test(blob)) return 'bahnhof';
  if (/kirche|kapelle/.test(blob)) return 'kirche';
  if (/museum|heimat/.test(blob)) return 'museum';
  if (/restaurant|gasthof|sushi|gastro|goldschätzchen/.test(blob)) return 'restaurant';
  if (/café|cafe|bäckerei|baecker|imbiss/.test(blob)) return 'cafe';
  if (/schule|kindergarten|kita/.test(blob)) return 'bildung';
  if (/sport|tennis|golf|reit|turnhalle/.test(blob)) return 'sport';
  if (/park|teich|wald|feld|pinnau|bilsbek|natur/.test(blob)) return 'natur';
  if (/arzt|zahn|praxis|apotheke/.test(blob)) return 'gesundheit';
  if (/friseur|coiffeur|reinigung|kiosk|post|service|gewerbe|markt/.test(blob))
    return 'service';
  if (/ehrenmal|denkmal/.test(blob)) return 'denkmal';
  if (/gemeinde|feuerwehr|rathaus/.test(blob)) return 'verwaltung';
  return spot.category || spot.district || 'ort';
}

function preferTypesFor(category) {
  switch (category) {
    case 'bahnhof':
      return ['train_station', 'transit_station'];
    case 'kirche':
      return ['church', 'place_of_worship'];
    case 'museum':
      return ['museum', 'tourist_attraction'];
    case 'restaurant':
      return ['restaurant', 'food', 'meal_takeaway'];
    case 'cafe':
      return ['cafe', 'bakery', 'food'];
    case 'sport':
      return ['gym', 'stadium', 'point_of_interest'];
    case 'gesundheit':
      return ['doctor', 'dentist', 'pharmacy', 'hospital'];
    case 'natur':
      return ['park', 'natural_feature'];
    case 'denkmal':
      return ['cemetery', 'tourist_attraction', 'point_of_interest'];
    case 'verwaltung':
      return ['city_hall', 'local_government_office', 'fire_station'];
    default:
      return ['point_of_interest', 'establishment', 'premise'];
  }
}

function footprintFor(category, name) {
  const n = name.toLowerCase();
  if (category === 'bahnhof' || /bahnsteig|unterführung/.test(n))
    return { mode: 'elongate', halfLen: 90, halfW: 18 };
  if (category === 'natur' || /feld|wald|pinnau|teich/.test(n))
    return { mode: 'box', half: 55 };
  if (category === 'sport' || /golf|peiner hof/.test(n))
    return { mode: 'box', half: 45 };
  if (category === 'gewerbe' || /peiner hag|gewerbe/.test(n))
    return { mode: 'box', half: 50 };
  if (category === 'restaurant' || category === 'cafe' || category === 'service')
    return { mode: 'box', half: 16 };
  if (category === 'kirche' || category === 'denkmal')
    return { mode: 'box', half: 22 };
  return { mode: 'box', half: 28 };
}

function buildQuery(spot) {
  // Clean slash titles / overly long names
  let name = spot.name
    .replace(/\s+mit\s+.*$/i, '')
    .replace(/\s+und\s+historisches.*$/i, '')
    .replace(/\s*\/.*$/, '')
    .trim();
  // Prefer shorter searchable forms for known ids
  const map = {
    prisdorf_bahnhof_wartehäuschen: 'Bahnhof Prisdorf',
    prisdorf_gemeindezentrum_hudenbarg: 'Gemeindezentrum Hudenbarg Prisdorf',
    prisdorf_kriegerehrenmal_bilsbek: 'Kriegerehrenmal Prisdorf Bilsbek',
    prisdorf_peiner_hof: 'Peiner Hof Prisdorf Golf',
    prisdorf_peiner_hag_gewerbe: 'Peiner Hag Prisdorf',
    prisdorf_pinnau_ufer: 'Pinnau Prisdorf',
    prisdorf_feuerloeschteich: 'Feuerlöschteich Prisdorf',
  };
  if (map[spot.id]) return `${map[spot.id]}`;
  return `${name}, Prisdorf`;
}

async function resolveSpot(spot, trigger, village) {
  const category = inferCategory(spot, trigger);
  const prefer = preferTypesFor(category);
  const query = buildQuery(spot);
  const near = trigger?.lat
    ? { lat: trigger.lat, lng: trigger.lng }
    : village;

  const places = await placesText(query, near);
  let ranked = (places.results || [])
    .map((r) => ({ r, score: scoreResult(r, prefer, near) }))
    .sort((a, b) => b.score - a.score);

  let best = ranked[0]?.r;
  // Reject if far from Prisdorf core and no prisdorf in address
  if (best) {
    const loc = locOf(best);
    const d = distM(village, loc);
    const addr = `${loc.address || ''}`.toLowerCase();
    if (d > 4500 && !addr.includes('prisdorf')) best = null;
  }

  if (!best) {
    const geo = await geocode(query, village);
    ranked = (geo.results || [])
      .map((r) => ({ r, score: scoreResult(r, prefer, near) }))
      .sort((a, b) => b.score - a.score);
    best = ranked[0]?.r;
  }

  // Last resort: keep existing trigger coords
  if (!best && trigger?.lat != null) {
    return {
      hit: {
        lat: trigger.lat,
        lng: trigger.lng,
        name: spot.name,
        address: null,
        types: ['legacy_kept'],
        place_id: null,
      },
      category,
      query,
      source: 'legacy_trigger',
    };
  }
  if (!best) {
    return { hit: null, category, query, source: 'none' };
  }
  return { hit: locOf(best), category, query, source: 'google' };
}

async function findSubPois(center, category, spotId) {
  const subs = [];
  // Preserve carefully crafted bahnhof subs if already present — caller handles
  const typesByCat = {
    bahnhof: ['premise'],
    restaurant: [],
    cafe: [],
    natur: ['park'],
    sport: [],
    denkmal: [],
    verwaltung: ['premise'],
  };
  const types = typesByCat[category] || [];
  for (const type of types) {
    try {
      const data = await nearbySearch(center.lat, center.lng, type, 40);
      for (const r of (data.results || []).slice(0, 2)) {
        const loc = locOf(r);
        if (!loc || !loc.name) continue;
        if (distM(center, loc) < 6) continue;
        if (distM(center, loc) > 45) continue;
        subs.push({
          id: `${spotId}__sub_${subs.length + 1}`,
          name: loc.name.slice(0, 60),
          lat: +loc.lat.toFixed(7),
          lng: +loc.lng.toFixed(7),
          radius_m: 10,
          fact_details: `Kleiner Detailpunkt bei ${loc.name}${loc.address ? ` (${loc.address})` : ''}.`,
          tags: ['sub_poi', type],
        });
      }
    } catch {
      // ignore nearby failures
    }
  }
  return subs.slice(0, 2);
}

async function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));
  const village = { lat: pack.lat || 53.68, lng: pack.lng || 9.761 };
  const report = [];
  const triggerById = new Map((pack.trigger_points || []).map((t) => [t.id, t]));

  console.log(`[prisdorf] optimizing ${pack.spots.length} spots…`);

  for (let i = 0; i < pack.spots.length; i++) {
    const spot = pack.spots[i];
    const trigger = triggerById.get(spot.id);
    process.stdout.write(`  (${i + 1}/${pack.spots.length}) ${spot.id} … `);

    try {
      const resolved = await resolveSpot(spot, trigger, village);
      if (!resolved.hit) {
        console.log('NO_HIT');
        report.push({ id: spot.id, status: 'NO_HIT', query: resolved.query });
        continue;
      }

      const { hit, category, query, source } = resolved;
      const old = trigger?.lat
        ? { lat: trigger.lat, lng: trigger.lng }
        : null;
      const delta = old ? Math.round(distM(old, hit)) : null;

      const fp = footprintFor(category, spot.name);
      const polygon =
        fp.mode === 'elongate'
          ? elongateEW(hit.lat, hit.lng, fp.halfLen, fp.halfW)
          : boxPolygon(hit.lat, hit.lng, fp.half);

      // Approaches: prefer street-side south + north of place
      const ap1 = offset(hit.lat, hit.lng, -36, 0);
      const ap2 = offset(hit.lat, hit.lng, 32, 8);
      const sv1 = await streetViewMeta(ap1.lat, ap1.lng);
      const sv2 = await streetViewMeta(ap2.lat, ap2.lng);

      const approaches = [
        {
          id: `${spot.id}_approach_1`,
          lat: ap1.lat,
          lng: ap1.lng,
          radius_m: 28,
          teaser_text: `Gleich voraus liegt ${spot.name.split(' mit ')[0].split(' und ')[0]}. Geh die letzten Meter näher ran.`,
          condition_rule: 'always',
        },
      ];
      // second approach only if Street View exists or place is large
      if (sv2.status === 'OK' || fp.half >= 40 || fp.mode === 'elongate') {
        approaches.push({
          id: `${spot.id}_approach_2`,
          lat: ap2.lat,
          lng: ap2.lng,
          radius_m: 26,
          teaser_text: `Von hier aus siehst du schon ${spot.name.split(' mit ')[0].split(' und ')[0]} — ein paar Schritte weiter bist du mittendrin.`,
          condition_rule: 'always',
        });
      }

      let subs = [];
      // Keep hand-tuned bahnhof subs, just re-anchor lightly
      if (spot.id === 'prisdorf_bahnhof_wartehäuschen' && spot.sub_pois?.length) {
        subs = spot.sub_pois.map((s, idx) => ({
          ...s,
          lat: offset(hit.lat, hit.lng, idx === 0 ? 8 : 0, idx === 0 ? 12 : -25).lat,
          lng: offset(hit.lat, hit.lng, idx === 0 ? 8 : 0, idx === 0 ? 12 : -25).lng,
        }));
      } else if (['verwaltung', 'natur', 'denkmal', 'bahnhof'].includes(category)) {
        subs = await findSubPois(hit, category, spot.id);
      }

      const tags = Array.from(
        new Set([
          category,
          ...(spot.tags || []),
          ...(spot.facts?.tags || []),
          'google_refined',
        ]),
      );

      spot.category = category;
      spot.tags = tags;
      spot.polygonCoordinates = polygon;
      spot.approach_triggers = approaches;
      spot.sub_pois = subs;
      if (!spot.facts) {
        spot.facts = {
          origin: spot.bullets?.[0]?.replace(/^[➔➤►]\s*/u, ''),
          now: spot.bullets?.[1]?.replace(/^[➔➤►]\s*/u, ''),
          tags,
        };
      } else {
        spot.facts.tags = Array.from(
          new Set([...(spot.facts.tags || []), ...tags]),
        );
      }

      if (trigger) {
        trigger.lat = hit.lat;
        trigger.lng = hit.lng;
        trigger.radius_m = Math.max(
          20,
          Math.min(55, fp.mode === 'elongate' ? 40 : (fp.half || 28) * 0.9),
        );
        trigger.trigger_kind = 'area';
        trigger.trigger_type = 'polygon';
        trigger.polygon = polygon.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        }));
        if (typeof trigger.general_info === 'string') {
          trigger.general_info = trigger.general_info.replace(/,\s*Thorsten/gi, '');
        }
      }

      console.log(
        `${source} Δ${delta ?? '-'}m cat=${category} ap=${approaches.length} sub=${subs.length} sv=${sv1.status}`,
      );
      report.push({
        id: spot.id,
        status: source === 'legacy_trigger' ? 'KEPT' : delta != null && delta > 120 ? 'MOVED_FAR' : 'OK',
        query,
        category,
        delta_m: delta,
        google: {
          lat: +hit.lat.toFixed(6),
          lng: +hit.lng.toFixed(6),
          name: hit.name,
          address: hit.address,
          types: hit.types.slice(0, 5),
        },
        approaches: approaches.length,
        subs: subs.length,
        streetview: [sv1.status, approaches[1] ? sv2.status : null],
      });
    } catch (e) {
      console.log('ERR', e.message);
      report.push({ id: spot.id, status: 'ERROR', error: e.message });
    }
  }

  pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 11);
  pack._google_full_optimize = {
    at: new Date().toISOString(),
    spots: pack.spots.length,
  };

  const v = validateCityPack(pack);
  if (!v.ok) {
    console.error('validation errors', v.errors);
    process.exit(1);
  }

  fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ version: pack.data_version, report }, null, 2));

  const indexPath = path.join(ROOT, 'data/staedte/index.json');
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const c of index.available_cities || []) {
      if (c.id === 'prisdorf') c.data_version = pack.data_version;
    }
    index.last_global_update = new Date().toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }

  const summary = {
    version: pack.data_version,
    total: report.length,
    ok: report.filter((r) => r.status === 'OK').length,
    kept: report.filter((r) => r.status === 'KEPT').length,
    movedFar: report.filter((r) => r.status === 'MOVED_FAR').length,
    noHit: report.filter((r) => r.status === 'NO_HIT').length,
    errors: report.filter((r) => r.status === 'ERROR').length,
  };
  console.log('[prisdorf] done', summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
