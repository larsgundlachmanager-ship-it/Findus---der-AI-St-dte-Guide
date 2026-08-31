#!/usr/bin/env node
/**
 * OSM-Pins für Prisdorf: Haltepunkt = lange Bahnsteige, Wartehäuschen extra,
 * Eisenbahnbrücke = Unterführung Hudenbarg, Bilsbekraum + Gemeindezentrum = Hudenbarg 5.
 *
 *   node scripts/cityPack/fixPrisdorfOsmPins.mjs
 *   node scripts/cityPack/fixPrisdorfOsmPins.mjs --dry
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

/** OSM API 2026-08-15: way 359247832 (SE-Bahnsteig, closed). */
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

/** OSM API: way 359247833 (NW-Bahnsteig, closed). */
const PLATFORM_NW = [
  { lat: 53.6754453, lng: 9.7600351 },
  { lat: 53.6754723, lng: 9.7599741 },
  { lat: 53.6766155, lng: 9.7573873 },
  { lat: 53.6765909, lng: 9.7573564 },
  { lat: 53.6754211, lng: 9.7600046 },
  { lat: 53.6754453, lng: 9.7600351 },
];

/** OSM node 3640048207 railway=halt Prisdorf — Pin User-Fix 2026-08-28. */
const HALT = { lat: 53.675269, lng: 9.76026 };

/** User GPS 2026-08-28: Gebäude Wartehäuschen (nicht Bahnsteig-Mitte). */
const HUT = { lat: 53.675147, lng: 9.760333 };
/** OSM way 428331045 building=cabin. */
const HUT_CABIN = [
  { lat: 53.6751716, lng: 9.7602913 },
  { lat: 53.67514, lng: 9.7602556 },
  { lat: 53.6750992, lng: 9.7603585 },
  { lat: 53.6751308, lng: 9.7603942 },
  { lat: 53.6751716, lng: 9.7602913 },
];

/** OSM way 79560130 Hudenbarg tunnel=yes — Pin User-Fix 2026-08-28. */
const TUNNEL = [
  { lat: 53.6771104, lng: 9.7562846 },
  { lat: 53.6770189, lng: 9.7561279 },
];
/** User GPS: Unterführung Hudenbarg. */
const BRIDGE_PIN = { lat: 53.677073, lng: 9.75617 };

/** OSM way 80253965 Freiwillige Feuerwehr Prisdorf. */
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

/** OSM way 80253967 Kindergarten Lütte Prisdörper. */
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

/** Google Place Kita Lütte Prisdörper — maps.app.goo.gl/LoC6cG3g2LZuK2X29 */
const KITA_PIN = { lat: 53.6771732, lng: 9.7577021 };

const BILSBEEKRAUM = { lat: 53.67758, lng: 9.75725 };

function uniquePts(pts) {
  const out = [];
  const seen = new Set();
  for (const p of pts) {
    const k = `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out;
}

function convexHull(points) {
  const pts = uniquePts(points).sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  if (!hull.length) return pts;
  hull.push({ ...hull[0] });
  return hull;
}

function lineBuffer(a, b, halfM, extraM = 0) {
  const north = (b.lat - a.lat) * 111320;
  const east =
    (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  const lenM = Math.hypot(north, east) || 1;
  const uN = north / lenM;
  const uE = east / lenM;
  const a2 = offset(a.lat, a.lng, -uN * extraM, -uE * extraM);
  const b2 = offset(b.lat, b.lng, uN * extraM, uE * extraM);
  const leftN = -uE;
  const leftE = uN;
  const aL = offset(a2.lat, a2.lng, leftN * halfM, leftE * halfM);
  const aR = offset(a2.lat, a2.lng, -leftN * halfM, -leftE * halfM);
  const bL = offset(b2.lat, b2.lng, leftN * halfM, leftE * halfM);
  const bR = offset(b2.lat, b2.lng, -leftN * halfM, -leftE * halfM);
  return [aL, bL, bR, aR, aL];
}

function toSpotPoly(pts) {
  return pts.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}

function toTriggerPoly(pts) {
  return pts.map((p) => ({ lat: p.lat, lng: p.lng }));
}

function packCenter(spot) {
  const poly = spot.polygonCoordinates || spot.polygon;
  if (poly?.length) return centroid(poly);
  return null;
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

function rebuildApproaches(spot, lat, lng, oldCenter) {
  const existing = spot.approach_triggers || spot.approachTriggers || [];
  if (existing.length >= 1 && oldCenter) {
    return existing.map((a) => {
      const dNorth = ((a.lat ?? a.latitude) - oldCenter.lat) * 111320;
      const dEast =
        ((a.lng ?? a.longitude) - oldCenter.lng) *
        (111320 * Math.cos((oldCenter.lat * Math.PI) / 180));
      const p = offset(lat, lng, dNorth, dEast);
      return { ...a, lat: p.lat, lng: p.lng };
    });
  }
  return existing;
}

function syncTrigger(pack, id, { lat, lng, polygon, radiusM, gpsSource, name }) {
  const trigger = (pack.trigger_points || []).find((t) => t.id === id);
  if (!trigger) return;
  if (name) trigger.name = name;
  trigger.lat = lat;
  trigger.lng = lng;
  if (radiusM) trigger.radius_m = radiusM;
  trigger.polygon = toTriggerPoly(polygon);
  const pool = trigger.deep_data_pool || [];
  const gpsLine = {
    text: `GPS-Eingang (OSM): ${lat.toFixed(6)}, ${lng.toFixed(6)} — ${gpsSource}.`,
    tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
  };
  trigger.deep_data_pool = [
    gpsLine,
    ...pool.filter((x) => !/GPS-Eingang|Koordinaten\s*~/i.test(String(x.text || ''))),
  ];
}

function applySpotPoly(spot, polygon, pin, source, { rebuild = false } = {}) {
  const before = packCenter(spot);
  spot.polygonCoordinates = toSpotPoly(polygon);
  if (rebuild) {
    spot.approach_triggers = rebuildApproaches(spot, pin.lat, pin.lng, before);
  }
  setEntrance(spot, pin.lat, pin.lng, source);
  return before;
}

function hutSpot() {
  const poly = boxPolygon(HUT.lat, HUT.lng, 8);
  const n = offset(HUT.lat, HUT.lng, 18, -8);
  return {
    id: 'prisdorf_bahnwartehaeuschen',
    name: 'Historisches Bahnwartehäuschen',
    district: 'Bahnhofsviertel',
    bullets: [
      '➔ Denkmalgeschütztes Fachwerk mit Walmdach von 1911 — letztes Stück der alten Bahnhofsanlage.',
      '➔ 1911 von Bürgerinnen und Bürgern mitfinanziert; später vom Verein Wartehäuschen Prisdorf gerettet und saniert.',
      '➔ Von außen gut zu sehen am Bahnsteig; Innenzugang hängt vom Sanierungsstand und Vereinsprogramm ab.',
    ],
    category: 'denkmal',
    tags: [
      'denkmal',
      'architecture',
      'wartehaeuschen',
      'historical_core',
      'bahn',
      'module1',
      'tier2',
      'story',
    ],
    facts: {
      origin:
        '1911 errichtetes Fachwerk-Wartehäuschen am Haltepunkt Prisdorf, von Bürgerinnen und Bürgern mitfinanziert.',
      architecture:
        'Offene Fachwerkkonstruktion mit Walmdach; Sanierung mit Lärchenholz, Stampfbeton und Stahlrahmen-Fenstern gegen Vandalismus.',
      now: 'Kulturdenkmal, gepflegt vom Verein Wartehäuschen Prisdorf. Treffpunkt am Gleis — kein klassisches Wartezimmer mehr.',
      tags: ['denkmal', 'architecture', 'wartehaeuschen', 'historical_core'],
    },
    polygonCoordinates: poly,
    approach_triggers: [
      {
        id: 'prisdorf_bahnwartehaeuschen_approach_1',
        lat: n.lat,
        lng: n.lng,
        radius_m: 22,
        teaser_text:
          'Das kleine Fachwerk mit Walmdach am Gleis — das ist das alte Bahnwartehäuschen, ein eigenes Denkmal.',
        condition_rule: 'always',
      },
    ],
    sub_pois: [
      {
        id: 'prisdorf_bahnwartehaeuschen_sub_eingang',
        name: 'Historisches Bahnwartehäuschen · Haupteingang',
        lat: HUT.lat,
        lng: HUT.lng,
        radius_m: 8,
        fact_details: 'GPS-Eingang (Kulturdenkmalliste 53°40′31″N 9°45′37″E).',
        tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
      },
    ],
    pack_role: 'story',
    place_tier: 2,
  };
}

function hutTrigger(haltepunktTrigger) {
  const poly = boxPolygon(HUT.lat, HUT.lng, 8);
  const pool = (haltepunktTrigger?.deep_data_pool || []).filter((x) =>
    /wartehäuschen|wartehaeuschen|fachwerk/i.test(String(x.text || '')),
  );
  return {
    id: 'prisdorf_bahnwartehaeuschen',
    name: 'Historisches Bahnwartehäuschen',
    trigger_type: 'polygon',
    radius_m: 14,
    special_radius_m: 5,
    lat: HUT.lat,
    lng: HUT.lng,
    trigger_kind: 'area',
    general_info:
      'Das denkmalgeschützte Fachwerk-Wartehäuschen von 1911 steht direkt am Bahnsteig. Bürgerinnen und Bürger finanzierten es mit, der Verein Wartehäuschen Prisdorf rettete es später — das letzte erhaltene Stück der alten Bahnhofsanlage.',
    deep_data_pool: [
      {
        text: `GPS-Eingang (Kulturdenkmalliste): ${HUT.lat.toFixed(6)}, ${HUT.lng.toFixed(6)} — 53°40′31″N, 9°45′37″E.`,
        tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
      },
      ...pool,
    ],
    polygon: poly.map((p) => ({ lat: p.latitude, lng: p.longitude })),
  };
}

function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');

  const haltepunkt = pack.spots.find((s) => s.id === 'prisdorf_bahnhof_wartehäuschen');
  const bruecke = pack.spots.find((s) => s.id === 'prisdorf_eisenbahnbrücke_hudenbarg');
  const gemeinde = pack.spots.find((s) => s.id === 'prisdorf_gemeindezentrum_hudenbarg');
  const bilsbek = pack.spots.find((s) => s.id === 'prisdorf_bilsbekraum');
  if (!haltepunkt || !bruecke || !gemeinde || !bilsbek) {
    throw new Error('expected Prisdorf spots missing');
  }

  const platformHull = convexHull([...PLATFORM_SE, ...PLATFORM_NW]);
  const beforeHp = applySpotPoly(haltepunkt, platformHull, HALT, 'OSM halt+platforms');
  haltepunkt.name = 'Bahnhof Prisdorf';
  // Wartehäuschen is its own story pin — never duplicate as Bahnhof sub.
  // Güterbahnsteig was a confusing extra railway pin — drop it.
  haltepunkt.sub_pois = (haltepunkt.sub_pois || []).filter((s) => {
    const id = String(s.id || '');
    return !/wartehaeuschen_sub$|gueterbahnsteig_sub$/i.test(id);
  });
  haltepunkt.approach_triggers = (haltepunkt.approach_triggers || []).filter(
    (a) => !/gueter_approach/i.test(String(a.id || '')),
  );
  const entrance = (haltepunkt.sub_pois || []).find((s) =>
    /eingang|entrance/i.test(`${s.id || ''} ${s.name || ''}`),
  );
  if (entrance) {
    entrance.name = 'Bahnhof Prisdorf · Haupteingang';
    entrance.lat = HALT.lat;
    entrance.lng = HALT.lng;
  }
  syncTrigger(pack, haltepunkt.id, {
    lat: HALT.lat,
    lng: HALT.lng,
    polygon: platformHull,
    radiusM: 40,
    gpsSource: 'OSM railway=halt node 3640048207 + Bahnsteige 359247832/833',
    name: 'Bahnhof Prisdorf',
  });

  const tunnelPoly = lineBuffer(TUNNEL[0], TUNNEL[1], 9, 10);
  const tunnelPin = BRIDGE_PIN;
  const beforeBr = applySpotPoly(
    bruecke,
    tunnelPoly,
    tunnelPin,
    'user:53.677073,9.756170 Hudenbarg-Unterführung',
  );
  syncTrigger(pack, bruecke.id, {
    lat: tunnelPin.lat,
    lng: tunnelPin.lng,
    polygon: tunnelPoly,
    radiusM: 18,
    gpsSource: 'user:53.677073,9.756170 Hudenbarg-Unterführung',
  });

  const campusHull = convexHull([...FEUERWEHR, ...KITA]);
  const campusPin = centroid(campusHull);
  applySpotPoly(
    gemeinde,
    campusHull,
    campusPin,
    'OSM Feuerwehr 80253965 + Kita 80253967',
  );
  syncTrigger(pack, gemeinde.id, {
    lat: campusPin.lat,
    lng: campusPin.lng,
    polygon: campusHull,
    radiusM: 55,
    gpsSource: 'OSM Hudenbarg 5 Feuerwehr+Kita',
  });

  const kita = pack.spots.find((s) => s.id === 'prisdorf_alte_schule_lütte_prisdörper');
  let beforeKita = null;
  if (kita) {
    beforeKita = packCenter(kita);
    applySpotPoly(
      kita,
      KITA,
      KITA_PIN,
      'google_maps:Kita Lütte Prisdörper (LoC6cG3g2LZuK2X29) + OSM way 80253967',
      { rebuild: true },
    );
    if (kita.facts && typeof kita.facts === 'object') {
      kita.facts.origin =
        'Volksschule 1912; Kindergarten ab 1974; Google-Pin Hudenbarg 5 / Kita Lütte Prisdörper.';
    }
    syncTrigger(pack, kita.id, {
      lat: KITA_PIN.lat,
      lng: KITA_PIN.lng,
      polygon: KITA,
      radiusM: 28,
      gpsSource: 'google_maps:Kita Lütte Prisdörper + OSM way 80253967',
      name: 'Alte Schule – heute Kindergarten Lütte Prisdörper',
    });
  }

  const bilsPoly = boxPolygon(BILSBEEKRAUM.lat, BILSBEEKRAUM.lng, 14);
  const beforeBils = packCenter(bilsbek);
  applySpotPoly(bilsbek, bilsPoly.map((p) => ({ lat: p.latitude, lng: p.longitude })), BILSBEEKRAUM, 'Hudenbarg 5 Gemeindezentrum / Feuerwehr', {
    rebuild: true,
  });
  syncTrigger(pack, bilsbek.id, {
    lat: BILSBEEKRAUM.lat,
    lng: BILSBEEKRAUM.lng,
    polygon: bilsPoly.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    radiusM: 16,
    gpsSource: 'Hudenbarg 5 Bilsbekraum im Gemeindezentrum (nicht Bahnhof)',
  });

  const existingHut = pack.spots.find((s) => s.id === 'prisdorf_bahnwartehaeuschen');
  let beforeHut = null;
  if (!existingHut) {
    const hpIdx = pack.spots.findIndex((s) => s.id === haltepunkt.id);
    pack.spots.splice(hpIdx + 1, 0, hutSpot());
    const hpTrig = pack.trigger_points.find((t) => t.id === haltepunkt.id);
    const trigIdx = pack.trigger_points.findIndex((t) => t.id === haltepunkt.id);
    pack.trigger_points.splice(trigIdx + 1, 0, hutTrigger(hpTrig));
  } else {
    beforeHut = packCenter(existingHut);
    const hutPoly = HUT_CABIN;
    applySpotPoly(
      existingHut,
      hutPoly,
      HUT,
      'user:53.675147,9.760333 Wartehäuschen-Gebäude + OSM cabin',
      { rebuild: true },
    );
    syncTrigger(pack, existingHut.id, {
      lat: HUT.lat,
      lng: HUT.lng,
      polygon: hutPoly,
      radiusM: 14,
      gpsSource: 'user:53.675147,9.760333 Wartehäuschen-Gebäude',
      name: 'Historisches Bahnwartehäuschen',
    });
  }

  const log = (id, before, after, note) => {
    const d = before && after ? Math.round(distM(before, after)) : '?';
    console.log(
      `${id} Δ=${d}m` +
        (before ? ` ${before.lat.toFixed(6)},${before.lng.toFixed(6)}` : '') +
        (after ? ` → ${after.lat.toFixed(6)},${after.lng.toFixed(6)}` : ''),
    );
    if (note) console.log(`  ${note}`);
  };
  log(haltepunkt.id, beforeHp, HALT, 'OSM-Bahnsteige (lang) + Halt-Node');
  log(bruecke.id, beforeBr, tunnelPin, 'OSM-Unterführung Hudenbarg');
  log(bilsbek.id, beforeBils, BILSBEEKRAUM, 'Hudenbarg 5 statt Bahnhof');
  log('prisdorf_bahnwartehaeuschen', beforeHut || HUT, HUT, 'User: Gebäude Wartehäuschen');
  log('prisdorf_gemeindezentrum_hudenbarg', campusPin, campusPin, 'Kita+Feuerwehr-Hülle, nicht über die Brücke');
  if (kita) {
    log(kita.id, beforeKita, KITA_PIN, 'Google Place-Pin + OSM-Gebäudeumriss');
  }

  if (!dry) {
    savePack(pack);
    console.log('saved', pack.city_id, 'v' + pack.data_version);
  } else {
    console.log('dry-run, not saved');
  }
}

main();
