#!/usr/bin/env node
/**
 * Prisdorf: echte OSM-Ways als Polylinien/Polygone (keine GPS-Box, keine Hulls).
 *
 *   node scripts/cityPack/snapPrisdorfOsmFootprints.mjs
 *   node scripts/cityPack/snapPrisdorfOsmFootprints.mjs --dry
 */
import {
  boxPolygon,
  centroid,
  distM,
  hasFlag,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';
import { fetchJson, sleep } from '../geo/osm.mjs';

/** OSM way 359247832 SE-Bahnsteig (closed). */
const PLATFORM_SE = [
  { lat: 53.674075, lng: 9.7628088 },
  { lat: 53.6751272, lng: 9.7604325 },
  { lat: 53.6751343, lng: 9.7604415 },
  { lat: 53.67514, lng: 9.7604488 },
  { lat: 53.6740884, lng: 9.762824 },
  { lat: 53.6735361, lng: 9.7640909 },
  { lat: 53.6735188, lng: 9.7640654 },
  { lat: 53.674075, lng: 9.7628088 },
];

/** OSM way 359247833 NW-Bahnsteig (closed). */
const PLATFORM_NW = [
  { lat: 53.6754453, lng: 9.7600351 },
  { lat: 53.6754723, lng: 9.7599741 },
  { lat: 53.6766155, lng: 9.7573873 },
  { lat: 53.6765909, lng: 9.7573564 },
  { lat: 53.6754211, lng: 9.7600046 },
  { lat: 53.6754453, lng: 9.7600351 },
];

const HALT = { lat: 53.6752944, lng: 9.7602008 };

/** OSM way 428331045 building=cabin (Wartehäuschen). */
const HUT_CABIN = [
  { lat: 53.6751716, lng: 9.7602913 },
  { lat: 53.67514, lng: 9.7602556 },
  { lat: 53.6750992, lng: 9.7603585 },
  { lat: 53.6751308, lng: 9.7603942 },
  { lat: 53.6751716, lng: 9.7602913 },
];

/** Hudenbarg durch die Unterführung (OSM ways 25307040 + tunnel + 25307051). */
const UNDERPASS_LINE = [
  { lat: 53.6772115, lng: 9.7563108 },
  { lat: 53.6771104, lng: 9.7562846 },
  { lat: 53.6770189, lng: 9.7561279 },
  { lat: 53.6769792, lng: 9.7561047 },
  { lat: 53.6768402, lng: 9.7560926 },
];

const KITA = [
  { lat: 53.6774922, lng: 9.7575952 },
  { lat: 53.6775374, lng: 9.7576033 },
  { lat: 53.6775219, lng: 9.757804 },
  { lat: 53.6773932, lng: 9.7577798 },
  { lat: 53.6773662, lng: 9.7577879 },
  { lat: 53.6773201, lng: 9.7578067 },
  { lat: 53.6772868, lng: 9.7578871 },
  { lat: 53.6772931, lng: 9.757981 },
  { lat: 53.6773249, lng: 9.7580427 },
  { lat: 53.6774647, lng: 9.7580963 },
  { lat: 53.6774474, lng: 9.7582712 },
  { lat: 53.6773317, lng: 9.758244 },
  { lat: 53.6772558, lng: 9.75819 },
  { lat: 53.6772169, lng: 9.7581071 },
  { lat: 53.677174, lng: 9.7579971 },
  { lat: 53.6771692, lng: 9.7578603 },
  { lat: 53.6772042, lng: 9.7577342 },
  { lat: 53.6772884, lng: 9.7576001 },
  { lat: 53.6773757, lng: 9.7575706 },
  { lat: 53.6774922, lng: 9.7575952 },
];

const FEUERWEHR = [
  { lat: 53.6775556, lng: 9.7565995 },
  { lat: 53.6774922, lng: 9.7575952 },
  { lat: 53.6775374, lng: 9.7576033 },
  { lat: 53.6775219, lng: 9.757804 },
  { lat: 53.6775219, lng: 9.7578388 },
  { lat: 53.6776692, lng: 9.7578766 },
  { lat: 53.6776969, lng: 9.757442 },
  { lat: 53.6776653, lng: 9.7574363 },
  { lat: 53.6776894, lng: 9.7570582 },
  { lat: 53.6776379, lng: 9.7570489 },
  { lat: 53.677648, lng: 9.7568888 },
  { lat: 53.6776901, lng: 9.7568965 },
  { lat: 53.6777073, lng: 9.756627 },
  { lat: 53.6775556, lng: 9.7565995 },
];

const BILSBEEKRAUM = { lat: 53.67758, lng: 9.75725 };

/** OSM way 25307201 leisure=pitch sport=tennis — nicht das TSV-Gelände. */
const TCP_TENNIS = [
  { lat: 53.6838525, lng: 9.751064 },
  { lat: 53.683206, lng: 9.750842 },
  { lat: 53.6831217, lng: 9.7515417 },
  { lat: 53.6831057, lng: 9.7516748 },
  { lat: 53.6837522, lng: 9.7518968 },
  { lat: 53.6838525, lng: 9.751064 },
];

/** OSM way 120302495 leisure=sports_centre — TSV, wurde fälschlich TCP. */
const TSV_GROUNDS = [
  { lat: 53.6846842, lng: 9.7515008 },
  { lat: 53.6842185, lng: 9.7496562 },
  { lat: 53.6846339, lng: 9.7491831 },
  { lat: 53.6853844, lng: 9.7481088 },
  { lat: 53.6854699, lng: 9.7479646 },
  { lat: 53.6856714, lng: 9.7506103 },
  { lat: 53.6853147, lng: 9.7507352 },
  { lat: 53.6852045, lng: 9.7508308 },
  { lat: 53.6851229, lng: 9.7509017 },
  { lat: 53.6846842, lng: 9.7515008 },
];

const SKIP_NOMINATIM = new Set([
  'prisdorf_bahnhof_wartehäuschen',
  'prisdorf_bahnwartehaeuschen',
  'prisdorf_eisenbahnbrücke_hudenbarg',
  'prisdorf_alte_schule_lütte_prisdörper',
  'prisdorf_stadtgeschichte_gesamt',
  'prisdorf_strassen_gestern_heute',
  'prisdorf_strassenverzeichnis',
  'prisdorf_bilsbekraum',
  'prisdorf_gemeindezentrum_hudenbarg',
  'prisdorf_tcp_tennis',
  'prisdorf_tsv_sportgelände',
  'prisdorf_freiwillige_feuerwehr',
]);

function pinHex(lat, lng, rM = 9) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(offset(lat, lng, Math.cos(a) * rM, Math.sin(a) * rM));
  }
  pts.push({ ...pts[0] });
  return pts;
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

function bufferPolyline(pts, halfM) {
  if (pts.length < 2) return pts;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const north = (next.lat - prev.lat) * 111320;
    const east =
      (next.lng - prev.lng) * 111320 * Math.cos((pts[i].lat * Math.PI) / 180);
    const len = Math.hypot(north, east) || 1;
    const uN = north / len;
    const uE = east / len;
    left.push(offset(pts[i].lat, pts[i].lng, -uE * halfM, uN * halfM));
    right.push(offset(pts[i].lat, pts[i].lng, uE * halfM, -uN * halfM));
  }
  const ring = [...left, ...right.reverse()];
  ring.push({ ...ring[0] });
  return ring;
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

function applyRings(pack, id, rings, pin, source, { radiusM } = {}) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) return { id, status: 'MISSING' };
  const clean = rings.filter((r) => r.length >= 2);
  const first = clean[0];
  const c = pin || centroid(toSpot(first));
  spot.polygonCoordinates = toSpot(first);
  if (clean.length > 1) {
    spot.polygonRings = clean.map(toSpot);
  } else {
    delete spot.polygonRings;
  }
  setEntrance(spot, c.lat, c.lng, source);
  if (trigger) {
    trigger.lat = c.lat;
    trigger.lng = c.lng;
    if (radiusM) trigger.radius_m = radiusM;
    trigger.polygon = toTrig(first);
    const pool = trigger.deep_data_pool || [];
    const gpsLine = {
      text: `GPS-Eingang (OSM): ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} — ${source}.`,
      tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
    };
    trigger.deep_data_pool = [
      gpsLine,
      ...pool.filter((x) => !/GPS-Eingang|Koordinaten\s*~/i.test(String(x.text || ''))),
    ];
  }
  const span = (() => {
    const lats = first.map((p) => p.lat ?? p.latitude);
    const lngs = first.map((p) => p.lng ?? p.longitude);
    return {
      n: first.length,
      rings: clean.length,
      spanN: Math.round((Math.max(...lats) - Math.min(...lats)) * 111320),
    };
  })();
  return { id, name: spot.name, status: 'OSM', ...span, lat: c.lat, lng: c.lng, source };
}

function clipRingToPin(ring, pin, maxM) {
  const pts = ring.map((p) => ({
    lat: p.latitude ?? p.lat,
    lng: p.longitude ?? p.lng,
  }));
  const near = pts.filter((p) => distM(p, pin) <= maxM);
  if (near.length >= 4) {
    const closed =
      Math.abs(near[0].lat - near[near.length - 1].lat) < 1e-6 &&
      Math.abs(near[0].lng - near[near.length - 1].lng) < 1e-6;
    if (!closed) near.push({ ...near[0] });
    return near;
  }
  return pts;
}

async function osmMapRing(spot) {
  const c = centroid(spot.polygonCoordinates);
  if (!c) return null;
  const dLat = 90 / 111320;
  const dLng = 90 / (111320 * Math.cos((c.lat * Math.PI) / 180));
  const bbox = [
    (c.lng - dLng).toFixed(6),
    (c.lat - dLat).toFixed(6),
    (c.lng + dLng).toFixed(6),
    (c.lat + dLat).toFixed(6),
  ].join(',');
  const j = await fetchJson(
    `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,
  );
  await sleep(900);
  const els = j.elements || [];
  const nodes = new Map(
    els.filter((e) => e.type === 'node').map((n) => [n.id, n]),
  );
  const blob = String(spot.name || '').toLowerCase();
  let best = null;
  let bestScore = -Infinity;
  for (const e of els) {
    if (e.type !== 'way' || !e.nodes?.length) continue;
    const t = e.tags || {};
    const pts = e.nodes
      .map((id) => nodes.get(id))
      .filter(Boolean)
      .map((n) => ({ lat: n.lat, lng: n.lon }));
    if (pts.length < 2) continue;
    const closed =
      pts.length >= 4 &&
      Math.abs(pts[0].lat - pts[pts.length - 1].lat) < 1e-6 &&
      Math.abs(pts[0].lng - pts[pts.length - 1].lng) < 1e-6;
    const cc = centroid(toSpot(pts));
    const dist = distM(c, cc);
    const lats = pts.map((p) => p.lat);
    const spanN = (Math.max(...lats) - Math.min(...lats)) * 111320;
    if (spanN > 280 && !t.natural && !t.landuse && t.railway !== 'platform') {
      continue;
    }
    let score = 40 - Math.min(dist, 120) * 0.4;
    const name = String(t.name || '').toLowerCase();
    if (name && blob.includes(name)) score += 80;
    if (name && name.split(/\s+/).some((w) => w.length >= 4 && blob.includes(w)))
      score += 36;
    if (t.historic) score += 50;
    if (t.leisure) score += 44;
    if (t.building && t.building !== 'yes') score += 38;
    if (t.building) score += 28;
    if (t.natural === 'water' || t.water) score += 48;
    if (t.landuse === 'forest' || t.natural === 'wood') score += 30;
    if (t.amenity === 'place_of_worship' || t.building === 'church') score += 40;
    if (t.waterway && /bilsbek|pinnau|teich|bach/i.test(blob)) score += 42;
    if (t.highway && !t.tunnel) score -= 20;
    if (t.railway === 'rail') score -= 40;
    if (closed) score += 12;
    if (dist > 85 && score < 70) continue;
    if (score > bestScore) {
      bestScore = score;
      best = {
        ring: pts,
        source: `OSM way ${e.id} ${t.name || t.leisure || t.building || t.natural || t.historic || ''}`.trim(),
        pin: cc,
      };
    }
  }
  if (!best || bestScore < 8) return null;
  return best;
}

async function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');
  const rows = [];

  rows.push(
    applyRings(
      pack,
      'prisdorf_bahnhof_wartehäuschen',
      [PLATFORM_SE, PLATFORM_NW],
      HALT,
      'OSM Bahnsteige 359247832 + 359247833',
      { radiusM: 28 },
    ),
  );
  const hutC = centroid(toSpot(HUT_CABIN));
  rows.push(
    applyRings(
      pack,
      'prisdorf_bahnwartehaeuschen',
      [HUT_CABIN],
      hutC,
      'OSM way 428331045 building=cabin',
      { radiusM: 12 },
    ),
  );
  const hutSub = (pack.spots.find((s) => s.id === 'prisdorf_bahnhof_wartehäuschen')
    ?.sub_pois || []).find((s) => String(s.id || '').includes('wartehaeuschen_sub'));
  if (hutSub) {
    hutSub.lat = hutC.lat;
    hutSub.lng = hutC.lng;
  }

  const under = bufferPolyline(UNDERPASS_LINE, 6.5);
  const underC = centroid(toSpot(under));
  rows.push(
    applyRings(
      pack,
      'prisdorf_eisenbahnbrücke_hudenbarg',
      [under],
      underC,
      'OSM Hudenbarg Unterführung (Straße durch die Gleise)',
      { radiusM: 16 },
    ),
  );

  const kitaC = centroid(toSpot(KITA));
  rows.push(
    applyRings(
      pack,
      'prisdorf_alte_schule_lütte_prisdörper',
      [KITA],
      kitaC,
      'OSM way 80253967 Lütte Prisdörper',
      { radiusM: 22 },
    ),
  );

  rows.push(
    applyRings(
      pack,
      'prisdorf_gemeindezentrum_hudenbarg',
      [FEUERWEHR, KITA],
      centroid(toSpot(FEUERWEHR)),
      'OSM Feuerwehr 80253965 + Kita 80253967',
      { radiusM: 28 },
    ),
  );
  rows.push(
    applyRings(
      pack,
      'prisdorf_tcp_tennis',
      [TCP_TENNIS],
      centroid(toSpot(TCP_TENNIS)),
      'OSM way 25307201 pitch sport=tennis',
      { radiusM: 18 },
    ),
  );
  rows.push(
    applyRings(
      pack,
      'prisdorf_tsv_sportgelände',
      [TSV_GROUNDS],
      centroid(toSpot(TSV_GROUNDS)),
      'OSM way 120302495 sports_centre TSV',
      { radiusM: 28 },
    ),
  );
  rows.push(
    applyRings(
      pack,
      'prisdorf_freiwillige_feuerwehr',
      [FEUERWEHR],
      centroid(toSpot(FEUERWEHR)),
      'OSM way 80253965 Feuerwache',
      { radiusM: 22 },
    ),
  );

  const bilsPoly = boxPolygon(BILSBEEKRAUM.lat, BILSBEEKRAUM.lng, 12).map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  rows.push(
    applyRings(
      pack,
      'prisdorf_bilsbekraum',
      [bilsPoly],
      BILSBEEKRAUM,
      'Hudenbarg 5 Bilsbekraum im Gemeindezentrum',
      { radiusM: 14 },
    ),
  );

  for (const id of [
    'prisdorf_stadtgeschichte_gesamt',
    'prisdorf_strassen_gestern_heute',
    'prisdorf_strassenverzeichnis',
  ]) {
    const spot = pack.spots.find((s) => s.id === id);
    if (!spot) continue;
    const c = centroid(spot.polygonCoordinates) || { lat: 53.6775, lng: 9.7574 };
    rows.push(
      applyRings(pack, id, [pinHex(c.lat, c.lng, 8)], c, 'virtueller Orts-Pin (kein Gebäude)', {
        radiusM: 16,
      }),
    );
  }

  const stories = (pack.spots || []).filter((s) => s.pack_role === 'story');
  for (const spot of stories) {
    if (SKIP_NOMINATIM.has(spot.id)) continue;
    try {
      const got = await osmMapRing(spot);
      if (!got) {
        rows.push({ id: spot.id, name: spot.name, status: 'KEEP' });
        continue;
      }
      rows.push(
        applyRings(pack, spot.id, [got.ring], got.pin, got.source, {
          radiusM: 22,
        }),
      );
    } catch (e) {
      rows.push({
        id: spot.id,
        name: spot.name,
        status: 'ERR',
        source: String(e.message || e),
      });
    }
  }

  for (const r of rows) {
    console.log(
      `${r.status || '?'} ${r.id}` +
        (r.spanN != null ? ` n=${r.n} rings=${r.rings} ~${r.spanN}mN` : '') +
        (r.lat ? ` @${Number(r.lat).toFixed(6)},${Number(r.lng).toFixed(6)}` : '') +
        (r.source ? `  ${r.source}` : ''),
    );
  }

  if (!dry) {
    savePack(pack);
    console.log('saved', pack.city_id, 'v' + pack.data_version);
  } else {
    console.log('dry-run, not saved');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
