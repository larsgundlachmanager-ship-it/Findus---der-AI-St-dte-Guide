/**
 * P5 Prisdorf pack: Tankstelle clean, Wartehäuschen Pin-in-Poly, Gütergleis-Spot.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), 'data/staedte/prisdorf.json');
const pack = JSON.parse(readFileSync(path, 'utf8'));

function centroid(poly) {
  if (!poly?.length) return null;
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const p of poly) {
    const la = p.latitude ?? p.lat;
    const ln = p.longitude ?? p.lng;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    lat += la;
    lng += ln;
    n += 1;
  }
  if (!n) return null;
  return { lat: lat / n, lng: lng / n };
}

function toLatLngPoly(poly) {
  return (poly || []).map((p) => ({
    lat: p.latitude ?? p.lat,
    lng: p.longitude ?? p.lng,
  }));
}

function toCoordPoly(poly) {
  return (poly || []).map((p) => ({
    latitude: p.latitude ?? p.lat,
    longitude: p.longitude ?? p.lng,
  }));
}

// --- P5.1 Tankstelle ---
const tank = pack.spots.find((s) => s.id === 'prisdorf_team_tankstelle');
if (!tank) throw new Error('tank spot missing');
tank.category = 'tankstelle';
tank.pack_role = 'directory';
tank.place_tier = 4;
tank.approach_triggers = [];
tank.approachTriggers = [];
tank.sub_pois = (tank.sub_pois || tank.subPois || []).filter((s) =>
  (s.tags || []).includes('gps_entrance'),
);
tank.subPois = tank.sub_pois;
tank.tags = [
  ...new Set([
    ...(tank.tags || []).filter(
      (t) =>
        !/^(story|story_enriched|must_have|landmark|module1|quiz|cta|faq)$/i.test(
          t,
        ),
    ),
    'directory',
    'tier4',
    'amenity_skip',
    'offline_lookup',
    'tankstelle',
    'fuel',
  ]),
];
if (tank.facts?.tags) {
  tank.facts.tags = tank.facts.tags.filter(
    (t) => !/^(story|story_enriched|must_have|landmark|module1)$/i.test(t),
  );
}
delete tank.quiz;
delete tank.cascade;
delete tank.general_info;
// Trigger approaches for tank — strip if present as separate approaches only on spot

// --- P5.2 Wartehäuschen Pin-in-Poly ---
const warte = pack.spots.find((s) => s.id === 'prisdorf_bahnwartehaeuschen');
if (!warte) throw new Error('warte spot missing');
const wartePoly =
  warte.polygonCoordinates || warte.polygon || [];
const c = centroid(wartePoly);
if (!c) throw new Error('warte poly missing');
warte.lat = c.lat;
warte.lng = c.lng;
warte.polygonCoordinates = toCoordPoly(wartePoly);
warte.polygon = toLatLngPoly(wartePoly);
const warteSub =
  (warte.sub_pois || warte.subPois || []).find((s) =>
    (s.tags || []).includes('gps_entrance'),
  ) || (warte.sub_pois || warte.subPois || [])[0];
if (warteSub) {
  warteSub.lat = c.lat;
  warteSub.lng = c.lng;
  warteSub.fact_details = `GPS-Eingang am Gebäudeumriss (Pin-in-Poly ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}).`;
}
warte.sub_pois = warte.sub_pois || warte.subPois || [];
warte.subPois = warte.sub_pois;

const warteTp = (pack.trigger_points || []).find(
  (t) => t.id === 'prisdorf_bahnwartehaeuschen',
);
if (warteTp) {
  warteTp.lat = c.lat;
  warteTp.lng = c.lng;
  warteTp.polygon = toLatLngPoly(wartePoly);
}

// --- P5.3 Historischer Güterbereich ---
const gueterId = 'prisdorf_historischer_gueterbereich';
let gueter = pack.spots.find((s) => s.id === gueterId);
// Östlich der Gleise, südlich Empfangs-/Wartebereich — schmaler Streifen.
const gueterRing = [
  { latitude: 53.67505, longitude: 9.76105 },
  { latitude: 53.67505, longitude: 9.76135 },
  { latitude: 53.67475, longitude: 9.76135 },
  { latitude: 53.67475, longitude: 9.76105 },
  { latitude: 53.67505, longitude: 9.76105 },
];
const gC = centroid(gueterRing);
if (!gueter) {
  gueter = {
    id: gueterId,
    name: 'Historischer Güterbereich Bahnhof Prisdorf',
    district: 'Bahnhofsviertel',
    category: 'geschichte',
    pack_role: 'story',
    place_tier: 2,
    lat: gC.lat,
    lng: gC.lng,
    bullets: [
      'Frühere Anschluss- und Gütergleise am Prisdorfer Bahnhof',
      'Empfangsgebäude längst weg — Spuren des Güterbereichs am Gleis',
    ],
    tags: [
      'geschichte',
      'gueterbahn',
      'transport',
      'historical_core',
      'story',
      'module1',
      'tier2',
      'map_outline',
      'sourced_osm',
    ],
    facts: {
      origin: 'Am Prisdorfer Bahnhof gab es früher Anschluss- und Gütergleise.',
      now: 'Übrig sind das Wartehäuschen von 1911 und Spuren des Güterbereichs.',
      tags: ['geschichte', 'gueterbahn', 'historical_core'],
    },
    polygonCoordinates: gueterRing,
    polygon: toLatLngPoly(gueterRing),
    approach_triggers: [
      {
        id: `${gueterId}_approach_1`,
        lat: 53.6752,
        lng: 9.7611,
        radius_m: 28,
        teaser_text:
          'Hier lagen früher die Gütergleise — heute nur noch Spuren am Bahnhof.',
        condition_rule: 'always',
      },
    ],
    sub_pois: [
      {
        id: `${gueterId}_sub_eingang`,
        name: 'Historischer Güterbereich · Blickpunkt',
        lat: gC.lat,
        lng: gC.lng,
        radius_m: 10,
        fact_details: 'Pin im Güterstreifen-Umriss.',
        tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target'],
      },
    ],
  };
  pack.spots.push(gueter);
} else {
  gueter.lat = gC.lat;
  gueter.lng = gC.lng;
  gueter.polygonCoordinates = gueterRing;
  gueter.polygon = toLatLngPoly(gueterRing);
}

let gueterTp = (pack.trigger_points || []).find((t) => t.id === gueterId);
if (!gueterTp) {
  gueterTp = {
    id: gueterId,
    name: gueter.name,
    trigger_type: 'polygon',
    radius_m: 40,
    special_radius_m: 12,
    lat: gC.lat,
    lng: gC.lng,
    trigger_kind: 'area',
    general_info:
      'Am Prisdorfer Bahnhof lagen früher Anschluss- und Gütergleise. Das Empfangsgebäude ist längst weg; übrig blieben das Wartehäuschen von 1911 und Spuren des Güterbereichs östlich der Strecke.',
    deep_data_pool: [
      {
        text: 'Geschichte Güterbahnhof: Anschluss- und Gütergleise bedienten früher den Ort — heute sind nur noch Geländespuren und das Fachwerk-Wartehäuschen von 1911 geblieben.',
        tags: ['geschichte', 'gueterbahn', 'historical_core'],
      },
    ],
    polygon: toLatLngPoly(gueterRing),
  };
  pack.trigger_points = pack.trigger_points || [];
  pack.trigger_points.push(gueterTp);
} else {
  gueterTp.lat = gC.lat;
  gueterTp.lng = gC.lng;
  gueterTp.polygon = toLatLngPoly(gueterRing);
}

pack.data_version = Number(pack.data_version || 0) + 1;
const out = `${JSON.stringify(pack, null, 2)}\n`;
const tmp = `${path}.p5tmp`;
writeFileSync(tmp, out, 'utf8');
try {
  copyFileSync(tmp, path);
  unlinkSync(tmp);
} catch {
  try {
    unlinkSync(path);
  } catch {
    /* soft */
  }
  renameSync(tmp, path);
}
console.log(
  JSON.stringify(
    {
      data_version: pack.data_version,
      tank_approaches: (tank.approach_triggers || []).length,
      tank_category: tank.category,
      warte_pin: { lat: warte.lat, lng: warte.lng },
      gueter: gueter.id,
    },
    null,
    2,
  ),
);
