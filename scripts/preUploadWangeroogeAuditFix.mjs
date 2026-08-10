#!/usr/bin/env node
/** Pre-upload fixes: Diggers Außenposten ~50m from HQ; Pudding nudge; Westturm note. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/wangerooge.json');

function offsetMeters(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function centroid(poly) {
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

function approachAt(lat, lng, distanceM, bearingDeg, radiusM, id, teaser) {
  const rad = (bearingDeg * Math.PI) / 180;
  const p = offsetMeters(
    lat,
    lng,
    distanceM * Math.cos(rad),
    distanceM * Math.sin(rad),
  );
  return {
    id,
    lat: p.lat,
    lng: p.lng,
    radius_m: radiusM,
    teaser_text: teaser,
    condition_rule: 'always',
  };
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

// Diggers HQ (Places) → Außenposten ~50 m ost entlang Promenade
const dig = pack.spots.find((s) => s.id === 'wangerooge_digger_s_strandbar');
const digC = centroid(dig.polygonCoordinates);
const ausPos = offsetMeters(digC.lat, digC.lng, 8, 50);
{
  const s = pack.spots.find((s) => s.id === 'wangerooge_diggers_aussenposten');
  s.polygonCoordinates = boxPolygon(ausPos.lat, ausPos.lng, 16);
  s.approach_triggers = [
    approachAt(
      ausPos.lat,
      ausPos.lng,
      25,
      180,
      14,
      `${s.id}_approach_1`,
      'Gleich voraus: Digger’s Außenposten — Schirmbar und Happy Hour mit Meerblick (~50 m vom Hauptquartier).',
    ),
  ];
  const tp = pack.trigger_points.find((t) => t.id === s.id);
  if (tp) {
    tp.lat = ausPos.lat;
    tp.lng = ausPos.lng;
    tp.polygon = s.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    }));
  }
}

// Café Pudding: leicht Richtung Geocode/Düne (Places war 44 m westlich)
{
  const s = pack.spots.find((s) => s.id === 'wangerooge_cafe_pudding');
  const target = { lat: 53.79335, lng: 7.90012 };
  const old = centroid(s.polygonCoordinates);
  // rebuild polygon around blend (70% new)
  const lat = old.lat * 0.3 + target.lat * 0.7;
  const lng = old.lng * 0.3 + target.lng * 0.7;
  s.polygonCoordinates = boxPolygon(lat, lng, 22);
  // keep relative approach bearings from new center
  s.approach_triggers = [
    approachAt(
      lat,
      lng,
      100,
      180,
      36,
      `${s.id}_approach_far`,
      'Am Ende der Fußgängerzone, dort wo die Insel scheinbar ins Meer abbricht, siehst du einen markanten, runden Bau auf der Düne thronen. Das ist das legendäre Café Pudding.',
    ),
    approachAt(
      lat,
      lng,
      20,
      190,
      14,
      `${s.id}_approach_mid`,
      'Kaum zu glauben, aber dieses helle, einladende Stück Inselarchitektur verbirgt in seinem Kern einen massiven Weltkriegsbunker der Wehrmacht. 1949 machte die Gründerfamilie Folkerts aus diesem unschönen militärischen Beton-Relikt ein süßes Symbol der zivilen Erholung.',
    ),
    approachAt(
      lat,
      lng,
      5,
      200,
      8,
      `${s.id}_approach_near`,
      "Hier beginnt der 'Pudding'. Ob für hausgemachtes Eis oder ostfriesischen Tee – die Aussicht von dieser Düne auf die rollenden Wellen des Wattenmeers ist unvergleichlich. Beachte, dass montags Ruhetag herrscht.",
    ),
  ];
  if (s.sub_pois?.[0]) {
    s.sub_pois[0].lat = s.approach_triggers[2].lat;
    s.sub_pois[0].lng = s.approach_triggers[2].lng;
  }
  const tp = pack.trigger_points.find((t) => t.id === s.id);
  if (tp) {
    tp.lat = lat;
    tp.lng = lng;
    tp.polygon = s.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    }));
  }
}

// Westturm: keep Places landmark (~53.7847/7.8575); note address geocode drift
{
  const s = pack.spots.find((s) => s.id === 'wangerooge_westturm');
  const note =
    'Koordinaten = Places-Landmarke Westturm/DJH (~Str. Zum Westen 27 in Maps). Offizielle Postadresse bleibt Im Westen 38 — Geocode der Postadresse driftet ~300 m und ist nicht der Turm.';
  if (!s.bullets.some((b) => /Places-Landmarke/i.test(b))) {
    s.bullets.push(note);
  }
}

pack.data_version = 9;
pack._build = {
  ...(pack._build || {}),
  pre_upload_audit: {
    at: new Date().toISOString(),
    fixes: [
      'diggers_aussenposten → ~50m east of HQ',
      'cafe_pudding nudge toward dune/geocode',
      'westturm coords confirmed Places landmark (not postal geocode)',
    ],
  },
};

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const indexPath = path.join(ROOT, 'data/staedte/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const wg = index.available_cities.find((c) => c.id === 'wangerooge');
if (wg) wg.data_version = 9;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

const v = validateCityPack(pack);
const dig2 = pack.spots.find((s) => s.id === 'wangerooge_digger_s_strandbar');
const aus2 = pack.spots.find((s) => s.id === 'wangerooge_diggers_aussenposten');
const dC = centroid(dig2.polygonCoordinates);
const aC = centroid(aus2.polygonCoordinates);
const gap = Math.hypot(
  (dC.lat - aC.lat) * 111320,
  (dC.lng - aC.lng) * 70000,
);
console.log(JSON.stringify({ version: 9, validate: v, diggersGapM: Math.round(gap) }, null, 2));
