#!/usr/bin/env node
/** Force-add Danzig/Gdańsk landmarks. */
import {
  boxPolygon,
  distM,
  loadPack,
  offset,
  savePack,
  slugify,
  suggestedPolygonHalfM,
} from './lib.mjs';
import { resolvePlace, requireGoogleKey } from './google.mjs';

requireGoogleKey();
const CITY_ID = 'danzig';
const CENTER = { lat: 54.352, lng: 18.6466 };

const LANDMARKS = [
  { q: 'Bazylika Mariacka Gdańsk', name: 'Marienkirche Danzig', category: 'kirche', tier: 1 },
  { q: 'Ratusz Głównego Miasta Gdańsk', name: 'Rechtstädtisches Rathaus', category: 'denkmal', tier: 1 },
  { q: 'Długi Targ Gdańsk', name: 'Langer Markt', category: 'altstadt', tier: 1 },
  { q: 'Ulica Długa Gdańsk', name: 'Lange Gasse', category: 'altstadt', tier: 1 },
  { q: 'Neptune Fountain Gdańsk', name: 'Neptunbrunnen', category: 'denkmal', tier: 1 },
  { q: 'Żuraw Crane Gdańsk', name: 'Krantor', category: 'denkmal', tier: 1 },
  { q: 'Złota Brama Gdańsk', name: 'Goldenes Tor', category: 'denkmal', tier: 1 },
  { q: 'Zielona Brama Gdańsk', name: 'Grünes Tor', category: 'denkmal', tier: 1 },
  { q: 'Brama Wyżynna Gdańsk', name: 'Hohes Tor', category: 'denkmal', tier: 1 },
  { q: 'Ulica Mariacka Gdańsk', name: 'Frauengasse', category: 'altstadt', tier: 1 },
  { q: 'Długie Pobrzeże Gdańsk', name: 'Lange Brücke / Motława-Kai', category: 'hafen', tier: 1 },
  { q: 'Dwór Artusa Gdańsk', name: 'Artushof', category: 'denkmal', tier: 1 },
  { q: 'European Solidarity Centre Gdańsk', name: 'Europäisches Solidarność-Zentrum', category: 'museum', tier: 1 },
  { q: 'Museum of the Second World War Gdańsk', name: 'Museum des Zweiten Weltkriegs', category: 'museum', tier: 1 },
  { q: 'Amber Museum Gdańsk', name: 'Bernsteinmuseum', category: 'museum', tier: 1 },
  { q: 'National Museum Gdańsk', name: 'Nationalmuseum Danzig', category: 'museum', tier: 1 },
  { q: 'Gdańsk Główny station', name: 'Danzig Hauptbahnhof', category: 'bahnhof', tier: 1 },
  { q: 'Gdańsk Shipyard Gate', name: 'Danziger Werft / Solidarność-Tor', category: 'denkmal', tier: 1 },
  { q: 'Oliwa Cathedral Gdańsk', name: 'Olivaer Dom', category: 'kirche', tier: 1 },
  { q: 'Westerplatte Gdańsk', name: 'Westerplatte', category: 'denkmal', tier: 1 },
  { q: 'Hevelianum Gdańsk', name: 'Hevelianum', category: 'museum', tier: 2 },
  { q: 'Shakespeare Theatre Gdańsk', name: 'Shakespeare-Theater', category: 'theater', tier: 2 },
  { q: 'Polish Baltic Philharmonic Gdańsk', name: 'Polnische Ostsee-Philharmonie', category: 'theater', tier: 2 },
  { q: 'St Catherine Church Gdańsk', name: 'Katharinenkirche', category: 'kirche', tier: 2 },
  { q: 'Great Mill Gdańsk', name: 'Große Mühle', category: 'denkmal', tier: 2 },
  { q: 'Prison Tower Gdańsk', name: 'Stockturm', category: 'denkmal', tier: 2 },
  { q: 'Foregate Complex Gdańsk', name: 'Vortor / Folterkammer', category: 'denkmal', tier: 2 },
  { q: 'Granary Island Gdańsk', name: 'Speicherinsel', category: 'altstadt', tier: 2 },
  { q: 'Oliwa Park Gdańsk', name: 'Park Oliwa', category: 'natur', tier: 2 },
  { q: 'Nowy Port Lighthouse Gdańsk', name: 'Leuchtturm Nowy Port', category: 'denkmal', tier: 2 },
  { q: 'Solidarity Square Gdańsk', name: 'Solidarność-Platz', category: 'denkmal', tier: 2 },
  { q: 'St Bridget Church Gdańsk', name: 'Brigittenkirche', category: 'kirche', tier: 2 },
  { q: 'Royal Chapel Gdańsk', name: 'Königliche Kapelle', category: 'kirche', tier: 2 },
  { q: 'Golden House Gdańsk', name: 'Goldenes Haus', category: 'denkmal', tier: 2 },
  { q: 'Uphagen House Gdańsk', name: 'Uphagen-Haus', category: 'museum', tier: 2 },
  { q: 'Historical Museum of Gdańsk Main Town Hall', name: 'Historisches Museum im Rathaus', category: 'museum', tier: 2 },
  { q: 'Motława River Gdańsk waterfront', name: 'Motława', category: 'hafen', tier: 1 },
  { q: 'Brama Świętojańska Gdańsk', name: 'Johannistor', category: 'denkmal', tier: 3 },
  { q: 'Brama Mariacka Gdańsk', name: 'Frauentor', category: 'denkmal', tier: 2 },
  { q: 'Brama Straganiarska Gdańsk', name: 'Häkertor', category: 'denkmal', tier: 3 },
  { q: 'Sołdek Museum Ship Gdańsk', name: 'Museumsschiff Sołdek', category: 'museum', tier: 2 },
  { q: 'Gdańsk Zoo Oliwa', name: 'Zoo Oliwa', category: 'freizeit', tier: 2 },
  { q: 'Brzeźno Beach Gdańsk', name: 'Strand Brzeźno', category: 'natur', tier: 2 },
  { q: 'St Dominic Fair Gdańsk', name: 'Dominikermarkt', category: 'markt', tier: 2 },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 40, east: 0, r: 34 },
    { id: 's', north: -36, east: 0, r: 22 },
  ].map((d) => {
    const pt = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: pt.lat,
      lng: pt.lng,
      radius_m: d.r,
      teaser_text: `${name} liegt kurz voraus — auf die typische Silhouette bzw. den Eingang achten.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

function nameSimilar(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ');
  const na = norm(a);
  const nb = norm(b);
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  let hit = 0;
  for (const w of nb.split(' ').filter((w) => w.length > 3)) if (wa.has(w)) hit += 1;
  return hit >= 2 || na.includes(nb.slice(0, 10)) || nb.includes(na.slice(0, 10));
}

async function main() {
  const pack = loadPack(CITY_ID);
  if (!pack) throw new Error('danzig pack missing');
  pack.name = 'Danzig';
  pack.symbol = pack.symbol || '⚓';
  pack._product = {
    family: 'international',
    tier: 'regional',
    paywall: false,
    notes: 'Danzig/Gdańsk Rechtstadt + Oliwa + Westerplatte',
  };

  let added = 0;
  let promoted = 0;
  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[dz] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, {
        near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 14000 },
      });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      continue;
    }
    if (distM(CENTER, hit) > 16000) {
      console.log('far', Math.round(distM(CENTER, hit)));
      continue;
    }
    const byName = pack.spots.find((s) => nameSimilar(s.name, lm.name));
    if (byName) {
      if (byName.pack_role === 'directory' || (byName.place_tier || 9) > lm.tier) {
        byName.pack_role = 'story';
        byName.place_tier = lm.tier;
        byName.category = lm.category;
        byName.tags = [
          ...new Set([
            ...(byName.tags || []).filter((t) => t !== 'directory' && t !== 'demoted_noise'),
            'story',
            lm.category,
            `tier${lm.tier}`,
            'curated_keep',
            'needs_deep_research',
          ]),
        ];
        promoted += 1;
        console.log('promote', byName.id);
      } else console.log('exists');
      continue;
    }
    const id = `${CITY_ID}_${slugify(lm.name)}`;
    if (pack.spots.some((s) => s.id === id)) {
      console.log('id-exists');
      continue;
    }
    const half = suggestedPolygonHalfM(lm.category, lm.name);
    pack.spots.push({
      id,
      name: lm.name,
      district: 'Danzig',
      category: lm.category,
      tags: [lm.category, 'story', `tier${lm.tier}`, 'curated_keep', 'needs_deep_research'],
      bullets: [
        hit.address ? `Adresse (Google): ${hit.address}.` : null,
        hit.placeId
          ? `Google Maps: https://www.google.com/maps/place/?q=place_id:${hit.placeId}`
          : null,
      ].filter(Boolean),
      facts: { now: hit.address ? `Adresse: ${hit.address}` : '', tags: [lm.category] },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, half),
      approach_triggers: approaches(hit.lat, hit.lng, lm.name, id),
      sub_pois: [],
      nav_waypoints: [],
      pack_role: 'story',
      place_tier: lm.tier,
    });
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push({
      id,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: Math.max(28, Math.round(half * 0.7)),
      general_info: '',
      deep_data_pool: [],
    });
    added += 1;
    console.log('added', id);
  }
  savePack(pack, { bumpVersion: true });
  console.log(
    JSON.stringify(
      {
        added,
        promoted,
        stories: pack.spots.filter((s) => s.pack_role === 'story').length,
        version: pack.data_version,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
