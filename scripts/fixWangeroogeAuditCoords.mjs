#!/usr/bin/env node
/**
 * Fix Wangerooge spots that failed Google coord audit.
 */
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

function syncTrigger(pack, spot, generalInfo) {
  const poly = spot.polygonCoordinates;
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude;
    lng += p.longitude;
  }
  lat /= poly.length;
  lng /= poly.length;
  const i = pack.trigger_points.findIndex((t) => t.id === spot.id);
  const tp = {
    id: spot.id,
    name: spot.name,
    lat,
    lng,
    radius_m: pack.trigger_points[i]?.radius_m ?? 45,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    condition_rule: spot.condition_rule,
    polygon: poly.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    general_info: generalInfo ?? pack.trigger_points[i]?.general_info,
    deep_data_pool: pack.trigger_points[i]?.deep_data_pool ?? [],
  };
  if (i >= 0) pack.trigger_points[i] = { ...pack.trigger_points[i], ...tp };
  else pack.trigger_points.push(tp);
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

const FIXES = [
  {
    id: 'harlesiel_faehrhafen',
    lat: 53.7083088,
    lng: 7.8105019,
    halfM: 55,
    note: 'Google Places: Harlesiel Anleger',
    rebuildApproaches: true,
  },
  {
    id: 'wangerooge_golfclub',
    lat: 53.789021,
    lng: 7.912902,
    halfM: 45,
    note: 'Google Places: Golfclub Insel Wangerooge e.V.',
    rebuildApproaches: true,
  },
  {
    id: 'wangerooge_fundamente_alter_westturm',
    lat: 53.7906286,
    lng: 7.8503608,
    halfM: 30,
    note: 'Google Places: Fundament alter Westturm',
    rebuildApproaches: true,
    condition: 'tide_low',
  },
];

for (const fix of FIXES) {
  const spot = pack.spots.find((s) => s.id === fix.id);
  if (!spot) {
    console.warn('missing', fix.id);
    continue;
  }
  spot.polygonCoordinates = boxPolygon(fix.lat, fix.lng, fix.halfM);
  if (fix.condition) spot.condition_rule = fix.condition;

  if (fix.rebuildApproaches) {
    const old = spot.approach_triggers || [];
    if (fix.id === 'harlesiel_faehrhafen') {
      spot.approach_triggers = [
        approachAt(
          fix.lat,
          fix.lng,
          200,
          0,
          55,
          `${fix.id}_approach_far`,
          old[0]?.teaser_text ||
            'Willkommen in Harlesiel. Hier endet deine Autoreise.',
        ),
        approachAt(
          fix.lat,
          fix.lng,
          50,
          20,
          22,
          `${fix.id}_approach_mid`,
          old[1]?.teaser_text ||
            'Achtung, Gepäckaufgabepflicht an den roten Containern.',
        ),
        approachAt(
          fix.lat,
          fix.lng,
          10,
          30,
          10,
          `${fix.id}_approach_near`,
          old[2]?.teaser_text || 'Fähr-Gate — Ticket bereithalten.',
        ),
      ];
      spot.sub_pois = (spot.sub_pois || []).map((sub, idx) => {
        const ap = spot.approach_triggers[Math.min(idx + 1, 2)];
        return { ...sub, lat: ap.lat, lng: ap.lng };
      });
    } else if (fix.id === 'wangerooge_golfclub') {
      spot.approach_triggers = [
        approachAt(
          fix.lat,
          fix.lng,
          60,
          270,
          28,
          `${fix.id}_approach_1`,
          old[0]?.teaser_text ||
            'Hier überlagern sich Golfgrün und Flugplatz — Golfclub Insel Wangerooge.',
        ),
      ];
    } else if (fix.id === 'wangerooge_fundamente_alter_westturm') {
      spot.approach_triggers = [
        approachAt(
          fix.lat,
          fix.lng,
          40,
          90,
          20,
          `${fix.id}_approach_1`,
          old[0]?.teaser_text ||
            'Bei Ebbe: Fundamentsteine des alten Westturms.',
          'tide_low',
        ),
      ];
      // update bullet GPS line
      spot.bullets = (spot.bullets || []).map((b) =>
        /Pin an der Wasserlinie|GPS:/i.test(b)
          ? `Pin (Google Places „Fundament alter Westturm“): ${fix.lat}, ${fix.lng} — nur bei Ebbe sichtbar.`
          : b,
      );
    }
  }

  const noteBullet = `Koordinaten geprüft/korrigiert: ${fix.note} (${fix.lat}, ${fix.lng}).`;
  spot.bullets = [
    noteBullet,
    ...(spot.bullets || []).filter((b) => !/Koordinaten geprüft/i.test(b)),
  ];
  syncTrigger(pack, spot);
  console.log('fixed', fix.id, fix.lat, fix.lng);
}

// Cafe Neudeich is legitimately east (Zum Osten 1) — tag district Ost
{
  const n = pack.spots.find((s) => /neudeich/i.test(s.id));
  if (n) {
    n.district = 'Ost';
    n.tags = Array.from(new Set([...(n.tags || []), 'ost', 'verified_google']));
  }
}

pack.data_version = 10;
pack._build = {
  ...(pack._build || {}),
  coord_audit_fix: {
    at: new Date().toISOString(),
    fixes: FIXES.map((f) => f.id),
    note: 'Harlesiel Anleger, Golfclub Places, Fundament alter Westturm Places; Neudeich OK (Ost).',
  },
};

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const indexPath = path.join(ROOT, 'data/staedte/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const wg = (index.available_cities || []).find((c) => c.id === 'wangerooge');
if (wg) wg.data_version = 10;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

console.log(JSON.stringify(validateCityPack(pack), null, 2));
