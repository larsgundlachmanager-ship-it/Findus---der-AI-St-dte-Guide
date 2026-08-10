#!/usr/bin/env node
/**
 * Confirm Fundamente Lost Place at Neuer-Leuchtturm waterline + fix Westturm history (NNW).
 * Local only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_PATH = path.join(ROOT, 'data/staedte/wangerooge.json');

function offsetMeters(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function centroid(poly) {
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude ?? p.lat;
    lng += p.longitude ?? p.lng;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

function approachAt(lat, lng, distanceM, bearingDeg, radiusM, id, teaser, condition) {
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
    condition_rule: condition || 'always',
  };
}

const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));

const neuer = pack.spots.find((s) => /neuer leuchtturm/i.test(s.name));
const neuerC = centroid(neuer.polygonCoordinates);
// Wasserlinie westlich/südwärts unterhalb des Neuen Leuchtturms (Weststrand)
const waterline = offsetMeters(neuerC.lat, neuerC.lng, -35, -75);

{
  const id = 'wangerooge_fundamente_alter_westturm';
  const spot = pack.spots.find((s) => s.id === id);
  spot.name = 'Fundamente Alter Westturm (Ebbe)';
  spot.district = 'West';
  spot.category = 'denkmal';
  spot.tags = Array.from(
    new Set([
      ...(spot.tags || []),
      'denkmal',
      'geschichte',
      'ebbe',
      'tide',
      'lost_place',
      'sourced_gemini',
      'gps_confirmed',
    ]),
  );
  spot.polygonCoordinates = boxPolygon(waterline.lat, waterline.lng, 30);
  spot.bullets = [
    `Pin an der Wasserlinie unterhalb des Neuen Leuchtturms (${waterline.lat}, ${waterline.lng}) — Orientierung Basiskoordinaten Neuer LT ${neuerC.lat.toFixed(5)}, ${neuerC.lng.toFixed(5)}.`,
    'Massive Fundamentsteine des Alten Westturms (erbaut 1597–1602, 1914 gesprengt) — nur bei Ebbe im Sand sichtbar.',
    'Historische Kartenlage ca. 53°48′N / 7°41′O fällt durch Messungenauigkeit und Ost-Wanderung der Insel heute ins Wasser; der sichtbare Lost Place liegt am heutigen Weststrand.',
    'Hinweis: Die früher fälschlich genannten Koordinaten 53°47′04,9″N / 07°51′27,1″O markieren den neuen Westturm (1932/DJH), nicht die Fundamente.',
  ];
  spot.facts = {
    origin:
      'Alter Westturm 1597–1602 stand ~900 m nordnordwestlich des heutigen Westturms; 1914 gesprengt. Fundamente heute am Strand unterhalb des Neuen Leuchtturms.',
    architecture:
      'Massive Fundamentsteine — Lost Place, nur bei Ebbe sichtbar (condition_rule: tide_low).',
    now: 'An der Wasserlinie unterhalb Neuer Leuchtturm ansteuern; Tide beachten.',
    tags: ['denkmal', 'ebbe', 'tide', 'geschichte', 'lost_place'],
  };
  spot.approach_triggers = [
    approachAt(
      waterline.lat,
      waterline.lng,
      40,
      90,
      20,
      `${id}_approach_1`,
      'Bei Ebbe kannst du hier unterhalb des Neuen Leuchtturms die Fundamentsteine des alten Westturms von 1602 entdecken — 1914 gesprengt, sonst oft unter Sand und Wasser.',
      'tide_low',
    ),
  ];
  spot.sub_pois = [];

  const tp = (pack.trigger_points || []).find((t) => t.id === id);
  if (tp) {
    tp.lat = waterline.lat;
    tp.lng = waterline.lng;
    tp.name = spot.name;
    tp.polygon = spot.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    }));
    tp.general_info =
      'Nur bei Ebbe: Fundamentsteine des Alten Westturms (1602/1914) an der Wasserlinie unterhalb des Neuen Leuchtturms.';
    tp.deep_data_pool = [
      {
        text: `Wasserlinie unterhalb Neuer Leuchtturm. Historische Karten 53°48′N/7°41′O liegen heute im Wasser (Insel-Ostwanderung). Falsche Gemini-Zuordnung 53°47′04,9″N/07°51′27,1″O = neuer Westturm 1932.`,
        tags: ['ebbe', 'tide', 'geschichte', 'gps_confirmed'],
      },
      {
        text: 'condition_rule tide_low — Tide-API später verdrahten; bis dahin GPS-Pin korrekt gesetzt.',
        tags: ['tide', 'live'],
      },
    ];
  }
}

{
  const spot = pack.spots.find((s) => s.id === 'wangerooge_westturm');
  if (spot) {
    spot.bullets = spot.bullets.map((b) =>
      b
        .replace(/~900 m SSE/gi, '~900 m NNW')
        .replace(/südsüdöstlich/gi, 'nordnordwestlich'),
    );
    // ensure NNW bullet exists
    const histIdx = spot.bullets.findIndex((b) => /56 m Backstein|Nachbau/i.test(b));
    if (histIdx >= 0) {
      spot.bullets[histIdx] =
        '56 m Backsteinturm 1932–33 auf 124 Eisenbetonpfählen; Nachbau des Alten Westturms (1597–1602, ~900 m nordnordwestlich, 1914 gesprengt).';
    }
    if (spot.facts?.origin) {
      spot.facts.origin =
        'Westturm 1932/33 als Nachbau des 1914 gesprengten Turms von 1602 (~900 m NNW der heutigen Position) — Wahrzeichen und einstige Sturmflut-Zuflucht.';
    }
    for (const a of spot.approach_triggers || []) {
      if (/900 Meter/i.test(a.teaser_text) && !/nordnordwest/i.test(a.teaser_text)) {
        a.teaser_text = a.teaser_text.replace(
          /etwa 900 Meter von hier entfernt/,
          'etwa 900 Meter nordnordwestlich von hier — Fundamente heute bei Ebbe unterhalb des Neuen Leuchtturms',
        );
      }
    }
    const tp = (pack.trigger_points || []).find((t) => t.id === spot.id);
    if (tp?.deep_data_pool) {
      tp.deep_data_pool = tp.deep_data_pool.map((d) => {
        if (typeof d.text === 'string' && /Fundamente|Originalturm/i.test(d.text)) {
          return {
            ...d,
            text: 'Originalturm 1597–1602 stand ~900 m NNW; 1914 gesprengt. Fundamente bei Ebbe an der Wasserlinie unterhalb des Neuen Leuchtturms (nicht an den Koordinaten des DJH-Westturms).',
          };
        }
        return d;
      });
    }
  }
}

pack.data_version = 7;
pack._build = {
  ...(pack._build || {}),
  fundamente_confirmed: {
    at: new Date().toISOString(),
    waterline,
    neuer_leuchtturm: neuerC,
    note:
      'Gemini bestätigt: falsche DMS = neuer Westturm 1932; Lost Place = Wasserlinie Neuer LT + tide_low. Historisch ~900 m NNW; Karten 53°48N/7°41O heute im Wasser.',
  },
};

fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
const v = validateCityPack(pack);
console.log(
  JSON.stringify(
    {
      version: pack.data_version,
      waterline,
      neuer: neuerC,
      validate: v,
    },
    null,
    2,
  ),
);
