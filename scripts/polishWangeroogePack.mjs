#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'data/staedte/wangerooge.json');
const pack = JSON.parse(fs.readFileSync(file, 'utf8'));

function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

for (const s of pack.spots) {
  const n = s.name.toLowerCase();
  if (/fähranleger|anleger/.test(n)) {
    s.category = 'transport';
    s.tags = Array.from(new Set(['transport', 'faehre', 'hafen', ...(s.tags || [])]));
  }
  if (/inselmarkt|frischemarkt|supermarkt/.test(n)) {
    s.category = 'einkaufen';
    s.tags = Array.from(new Set(['einkaufen', ...(s.tags || [])]));
  }
  if (/strandbar|digger/.test(n)) {
    s.category = 'cafe';
    s.tags = Array.from(new Set(['cafe', 'kaffee', ...(s.tags || [])]));
  }
  if (/erlebnisbad|oase|jugendbad/.test(n)) {
    s.category = 'freizeit';
    s.tags = Array.from(new Set(['freizeit', ...(s.tags || [])]));
  }
  if (/kurverwaltung|erholung ist eine insel/.test(n)) {
    s.category = 'verwaltung';
    s.tags = Array.from(new Set(['verwaltung', ...(s.tags || [])]));
  }
}

// Add Hauptstrand if missing
if (!pack.spots.some((s) => /hauptstrand/i.test(s.name))) {
  const lat = 53.793936;
  const lng = 7.90022;
  const id = 'wangerooge_hauptstrand';
  const polygon = boxPolygon(lat, lng, 70);
  const ap1 = offset(lat, lng, -40, 0);
  pack.spots.push({
    id,
    name: 'Hauptstrand Wangerooge',
    district: 'Nord',
    category: 'natur',
    tags: ['natur', 'strand', 'must_have', 'google_places'],
    bullets: [
      'Hauptstrand Wangerooge an der Nordseite der Insel (Google Places).',
      'Zugang über die Obere Strandpromenade und Dünenübergänge.',
    ],
    facts: {
      origin: 'Hauptstrand an der Nordseite.',
      now: 'Klassisches Bade- und Spazierziel.',
      tags: ['natur', 'strand', 'must_have'],
    },
    polygonCoordinates: polygon,
    approach_triggers: [
      {
        id: `${id}_approach_1`,
        lat: ap1.lat,
        lng: ap1.lng,
        radius_m: 32,
        teaser_text:
          'Richtung Meer: Hinter den Dünen öffnet sich der Hauptstrand — du hörst oft das Meer bevor du es siehst.',
        condition_rule: 'always',
      },
    ],
    sub_pois: [],
  });
  pack.trigger_points.push({
    id,
    name: 'Hauptstrand Wangerooge',
    lat,
    lng,
    radius_m: 50,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    polygon: polygon.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    general_info: 'Am Hauptstrand wird Inselurlaub greifbar — Sand, Wind, Horizont.',
    deep_data_pool: [
      {
        text: 'Hauptstrand Wangerooge an der Nordseite (Google Places).',
        tags: ['sourced_google'],
      },
    ],
  });
}

pack.data_version = 4;
fs.writeFileSync(file, JSON.stringify(pack, null, 2));
console.log('spots', pack.spots.length, 'approaches', pack.spots.reduce((n,s)=>n+(s.approach_triggers||[]).length,0));
