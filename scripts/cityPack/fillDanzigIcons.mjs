#!/usr/bin/env node
import fs from 'node:fs';
import {
  loadEnvFile,
  slugify,
  boxPolygon,
  offset,
  suggestedPolygonHalfM,
  distM,
} from './lib.mjs';
import { resolvePlace, placesText } from './google.mjs';

loadEnvFile();
const p = JSON.parse(fs.readFileSync('data/staedte/danzig.json', 'utf8'));
const CENTER = { lat: 54.352, lng: 18.6466 };

const BAD = /hauptbahnhof_11|bahnhof_westerplatte|skwer_torunska|apartment|apartament/i;
for (const s of p.spots) {
  if (s.pack_role === 'story' && (BAD.test(s.id) || BAD.test(s.name))) {
    s.pack_role = 'directory';
    console.log('demote', s.id);
  }
}

const adds = [
  { q: 'Gdańsk Główny railway station', name: 'Danzig Hauptbahnhof', tier: 1, cat: 'bahnhof' },
  { q: 'Westerplatte Monument Gdańsk', name: 'Westerplatte', tier: 1, cat: 'denkmal' },
  { q: 'Bazylika Mariacka Gdańsk', name: 'Marienkirche Danzig', tier: 1, cat: 'kirche' },
  { q: 'Fontanna Neptuna Gdańsk', name: 'Neptunbrunnen', tier: 1, cat: 'denkmal' },
  { q: 'Żuraw Gdańsk', name: 'Krantor', tier: 1, cat: 'denkmal' },
  { q: 'ECS European Solidarity Centre', name: 'Europäisches Solidarność-Zentrum', tier: 1, cat: 'museum' },
  { q: 'Museum of the Second World War Gdańsk', name: 'Museum des Zweiten Weltkriegs', tier: 1, cat: 'museum' },
  { q: 'Amber Museum Gdańsk', name: 'Bernsteinmuseum', tier: 1, cat: 'museum' },
  { q: 'Długi Targ Gdańsk', name: 'Langer Markt', tier: 1, cat: 'altstadt' },
  { q: 'Ulica Długa Gdańsk', name: 'Lange Gasse', tier: 1, cat: 'altstadt' },
  { q: 'Ulica Mariacka Gdańsk', name: 'Frauengasse', tier: 1, cat: 'altstadt' },
  { q: 'Oliwa Cathedral', name: 'Olivaer Dom', tier: 1, cat: 'kirche' },
  { q: 'Gdańsk Shipyard historic gate', name: 'Danziger Werft', tier: 1, cat: 'denkmal' },
  { q: 'Długie Pobrzeże Gdańsk', name: 'Lange Brücke', tier: 1, cat: 'hafen' },
  { q: 'Złota Brama Gdańsk', name: 'Goldenes Tor', tier: 1, cat: 'denkmal' },
  { q: 'Zielona Brama Gdańsk', name: 'Grünes Tor', tier: 1, cat: 'denkmal' },
  { q: 'Brama Wyżynna Gdańsk', name: 'Hohes Tor', tier: 1, cat: 'denkmal' },
  { q: 'Dwór Artusa Gdańsk', name: 'Artushof', tier: 1, cat: 'denkmal' },
  { q: 'Ratusz Głównego Miasta Gdańsk', name: 'Rechtstädtisches Rathaus', tier: 1, cat: 'denkmal' },
  { q: 'Granary Island Gdańsk', name: 'Speicherinsel', tier: 2, cat: 'altstadt' },
  { q: 'Sołdek ship museum', name: 'Museumsschiff Sołdek', tier: 2, cat: 'museum' },
  { q: 'Shakespeare Theatre Gdańsk', name: 'Shakespeare-Theater', tier: 2, cat: 'theater' },
  { q: 'Polish Baltic Philharmonic', name: 'Ostsee-Philharmonie', tier: 2, cat: 'theater' },
  { q: 'Hevelianum Gdańsk', name: 'Hevelianum', tier: 2, cat: 'museum' },
  { q: 'National Museum Gdańsk', name: 'Nationalmuseum Danzig', tier: 1, cat: 'museum' },
  { q: 'St Bridget Church Gdańsk', name: 'Brigittenkirche', tier: 2, cat: 'kirche' },
  { q: 'Great Mill Gdańsk', name: 'Große Mühle', tier: 2, cat: 'denkmal' },
  { q: 'Oliwa Park Gdańsk', name: 'Park Oliwa', tier: 2, cat: 'natur' },
  { q: 'Nowy Port Lighthouse', name: 'Leuchtturm Nowy Port', tier: 2, cat: 'denkmal' },
  { q: 'Brzeźno Beach', name: 'Strand Brzeźno', tier: 2, cat: 'natur' },
  { q: 'Gdańsk Zoo', name: 'Zoo Oliwa', tier: 2, cat: 'freizeit' },
  {
    q: 'Monument to the Fallen Shipyard Workers Gdańsk',
    name: 'Denkmal der gefallenen Werftarbeiter',
    tier: 1,
    cat: 'denkmal',
  },
  { q: 'Golden House Gdańsk', name: 'Goldenes Haus', tier: 2, cat: 'denkmal' },
  { q: 'Uphagen House Museum', name: 'Uphagen-Haus', tier: 2, cat: 'museum' },
  { q: 'Prison Tower Gdańsk', name: 'Stockturm', tier: 2, cat: 'denkmal' },
  { q: 'St Catherine Church Gdańsk', name: 'Katharinenkirche', tier: 2, cat: 'kirche' },
  { q: 'Royal Chapel Gdańsk', name: 'Königliche Kapelle', tier: 2, cat: 'kirche' },
  { q: 'Motława River Gdańsk', name: 'Motława', tier: 1, cat: 'hafen' },
  { q: 'Solidarity Square Gdańsk', name: 'Solidarność-Platz', tier: 2, cat: 'denkmal' },
  { q: 'Opera Bałtycka Gdańsk', name: 'Ostseeoper', tier: 2, cat: 'theater' },
  { q: 'St Marys Gate Gdańsk', name: 'Frauentor', tier: 2, cat: 'denkmal' },
  { q: 'John Gate Gdańsk', name: 'Johannistor', tier: 3, cat: 'denkmal' },
  { q: 'Forum Gdańsk', name: 'Forum Gdańsk', tier: 2, cat: 'einkaufen' },
  { q: 'Olivia Star Gdańsk', name: 'Olivia Star', tier: 2, cat: 'aussicht' },
  { q: 'Wisłoujście Fortress Gdańsk', name: 'Festung Weichselmünde', tier: 2, cat: 'denkmal' },
  { q: 'Polish Post Office Museum Gdańsk', name: 'Museum der Polnischen Post', tier: 1, cat: 'museum' },
  { q: 'Gdańsk Crane Żuraw museum', name: 'Krantor-Museum', tier: 2, cat: 'museum' },
  { q: 'St Johns Church Gdańsk', name: 'Johanneskirche', tier: 2, cat: 'kirche' },
  { q: 'Altstädtisches Rathaus Gdańsk', name: 'Altstädtisches Rathaus', tier: 2, cat: 'denkmal' },
  { q: 'Ferris wheel AmberSky Gdańsk', name: 'AmberSky Riesenrad', tier: 2, cat: 'freizeit' },
];

function similar(a, b) {
  const n = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ');
  const na = n(a);
  const nb = n(b);
  return na.includes(nb.slice(0, 8)) || nb.includes(na.slice(0, 8));
}

let added = 0;
let promoted = 0;
for (const a of adds) {
  const existing = p.spots.find(
    (s) => similar(s.name, a.name) || s.id === `danzig_${slugify(a.name)}`,
  );
  if (existing) {
    if (existing.pack_role !== 'story' || (existing.place_tier || 9) > a.tier) {
      existing.pack_role = 'story';
      existing.place_tier = a.tier;
      existing.category = a.cat;
      existing.tags = [
        ...new Set([
          ...(existing.tags || []).filter((t) => t !== 'directory'),
          'story',
          'curated_keep',
          'needs_deep_research',
        ]),
      ];
      promoted += 1;
      console.log('promote', existing.id);
    } else console.log('exists', a.name);
    continue;
  }
  const hit = await resolvePlace(a.q, { near: { ...CENTER, radiusM: 14000 } });
  if (!hit?.lat) {
    console.log('miss', a.name);
    continue;
  }
  if (distM(CENTER, hit) > 16000) {
    console.log('far', a.name);
    continue;
  }
  const id = `danzig_${slugify(a.name)}`;
  const half = suggestedPolygonHalfM(a.cat, a.name);
  p.spots.push({
    id,
    name: a.name,
    district: 'Danzig',
    category: a.cat,
    tags: [a.cat, 'story', `tier${a.tier}`, 'curated_keep', 'needs_deep_research'],
    bullets: [],
    facts: { tags: [a.cat] },
    polygonCoordinates: boxPolygon(hit.lat, hit.lng, half),
    approach_triggers: [
      {
        id: `${id}_approach_n`,
        lat: offset(hit.lat, hit.lng, 40, 0).lat,
        lng: offset(hit.lat, hit.lng, 40, 0).lng,
        radius_m: 34,
        teaser_text: `${a.name} liegt kurz voraus.`,
        condition_rule: 'always',
        needs_visual_review: true,
      },
    ],
    sub_pois: [],
    nav_waypoints: [],
    pack_role: 'story',
    place_tier: a.tier,
  });
  p.trigger_points = p.trigger_points || [];
  p.trigger_points.push({
    id,
    name: a.name,
    lat: hit.lat,
    lng: hit.lng,
    radius_m: 35,
    general_info: '',
    deep_data_pool: [],
  });
  added += 1;
  console.log('added', id);
}

try {
  const data = await placesText('boat rental Gdańsk', {
    lat: CENTER.lat,
    lng: CENTER.lng,
    radiusM: 8000,
  });
  for (const r of (data.results || []).slice(0, 12)) {
    const loc = r.geometry?.location;
    if (!loc) continue;
    const name = r.name || 'Bootsverleih';
    const id = `danzig_${slugify(name)}`;
    if (p.spots.some((s) => s.id === id)) continue;
    p.spots.push({
      id,
      name,
      district: 'Danzig',
      category: 'bootsverleih',
      tags: ['bootsverleih', 'directory'],
      bullets: [],
      facts: { tags: ['bootsverleih'] },
      polygonCoordinates: [],
      approach_triggers: [],
      sub_pois: [],
      nav_waypoints: [],
      pack_role: 'directory',
      place_tier: 3,
    });
    p.trigger_points.push({
      id,
      name,
      lat: loc.lat,
      lng: loc.lng,
      radius_m: 25,
      general_info: '',
      deep_data_pool: [],
    });
    console.log('boat dir', name);
  }
} catch (e) {
  console.log('boat fail', e.message);
}

p.name = 'Danzig';
p.data_version = (p.data_version || 0) + 1;
fs.writeFileSync('data/staedte/danzig.json', JSON.stringify(p, null, 2));
console.log(
  JSON.stringify(
    {
      stories: p.spots.filter((s) => s.pack_role === 'story').length,
      dir: p.spots.filter((s) => s.pack_role === 'directory').length,
      boats: p.spots.filter((s) => s.category === 'bootsverleih').length,
      toilets: p.spots.filter((s) => s.category === 'toilette').length,
      hotels: p.spots.filter((s) => s.category === 'hotel').length,
      added,
      promoted,
      v: p.data_version,
    },
    null,
    2,
  ),
);
