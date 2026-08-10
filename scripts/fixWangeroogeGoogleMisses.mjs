#!/usr/bin/env node
/**
 * Post-fix after Google refine:
 * - Keep Google current Fähranleger (harbour SW) — that delta was OLD vs NEW pier
 * - Restore Weststrand near Westturm (Google maps Weststrand → Hauptstrand wrongly)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'data/staedte/wangerooge.json');
const pack = JSON.parse(fs.readFileSync(file, 'utf8'));

function setPlace(id, { lat, lng, half, name, bullets, teaser, general, tags }) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) throw new Error(`missing ${id}`);
  const polygon = boxPolygon(lat, lng, half);
  if (name) spot.name = name;
  if (bullets) spot.bullets = bullets;
  if (tags) {
    spot.tags = tags;
    if (spot.facts) spot.facts.tags = tags;
  }
  spot.polygonCoordinates = polygon;
  const aLat = +(lat - 38 / 111320).toFixed(7);
  spot.approach_triggers = [
    {
      id: `${id}_approach_1`,
      lat: aLat,
      lng: lng,
      radius_m: 30,
      teaser_text: teaser || spot.approach_triggers?.[0]?.teaser_text,
      condition_rule: 'always',
    },
  ];
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.name = spot.name;
  trigger.polygon = polygon.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  if (general) trigger.general_info = general;
  if (bullets) {
    trigger.deep_data_pool = bullets.map((t) => ({
      text: t,
      tags: ['sourced_google'],
    }));
  }
}

// Current ferry harbour (Google Places) — correct for today's arrival
setPlace('wangerooge_anleger', {
  lat: 53.774711,
  lng: 7.867185,
  half: 50,
  name: 'Fähranleger Wangerooge (Hafen)',
  tags: ['transport', 'faehre', 'hafen'],
  bullets: [
    'Der heutige Fähranleger liegt am Hafen im Südwesten der Insel (Google Places).',
    'Von hier aus geht es weiter mit der Inselbahn oder zu Fuß Richtung Dorf.',
  ],
  teaser:
    'Du bist am aktuellen Fähranleger im Hafen — hier kommt die Fähre an. Die Inselbahn oder der Fußweg bringen dich weiter ins Dorf.',
  general:
    'Am Hafen-Anleger merkst du sofort: Autos bleiben draußen, der Takt der Insel beginnt.',
});

// Weststrand: keep near Westturm — Google has no dedicated Weststrand POI
setPlace('wangerooge_weststrand', {
  lat: 53.7862,
  lng: 7.8558,
  half: 70,
  name: 'Weststrand / Westen Wangerooge',
  tags: ['strand', 'natur', 'needs_field_check'],
  bullets: [
    'Westlich vom Westturm öffnet sich der ruhigere Westbereich der Insel.',
    'Google Places liefert keinen eigenen „Weststrand“-Eintrag — Position relativ zum Westturm gesetzt.',
  ],
  teaser:
    'Weiter westlich beim Westturm: offenerer Strand- und Dünenbereich — weniger Trubel, mehr Weite.',
  general: 'Am Weststrand zieht der Wind anders — hier ist die Insel rauer und weiter.',
});

pack.data_version = Math.max(Number(pack.data_version || 0), 3);
fs.writeFileSync(file, JSON.stringify(pack, null, 2));

const indexPath = path.join(ROOT, 'data/staedte/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
for (const c of index.available_cities) {
  if (c.id === 'wangerooge') c.data_version = pack.data_version;
  if (c.id === 'prisdorf') {
    const p = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data/staedte/prisdorf.json'), 'utf8'),
    );
    c.data_version = p.data_version;
  }
}
index.last_global_update = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log('wangerooge anleger+weststrand fixed, v', pack.data_version);
