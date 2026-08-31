#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR, loadEnvFile, slugify } from './lib.mjs';
import { geocode } from './google.mjs';

loadEnvFile();

const packPath = path.join(STAEDTE_DIR, 'amsterdam.json');
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const DROP =
  /centraal\s*viewpoint|amsterdam\s*central\s*railway|centraal\s*station$|sculpture\s*of\s*anne|vondelpark\s*openlucht|artisan\s*food|boerderij\s*westerpark|leeuwen\s*\(artis\)|huis\s*marseille\s*garden|westerpark\s*market|artis\s*-\s*groote|keizersgracht\s*canal\s*viewpoint|prinsengracht\s*[–-].*viewpoint|begijnhofkapel/i;

let demoted = 0;
for (const s of pack.spots) {
  if (s.pack_role === 'story' && DROP.test(s.name)) {
    s.pack_role = 'directory';
    s.place_tier = 4;
    demoted += 1;
  }
}
console.log('demoted weak', demoted);

const adds = [
  { q: 'Anne Frank House Amsterdam', name: 'Anne Frank Huis', tier: 1, cat: 'museum' },
  { q: 'Koninklijk Paleis Amsterdam', name: 'Koninklijk Paleis', tier: 1, cat: 'denkmal' },
  { q: 'Oude Kerk Amsterdam', name: 'Oude Kerk', tier: 1, cat: 'kirche' },
  { q: 'Het Scheepvaartmuseum Amsterdam', name: 'Het Scheepvaartmuseum', tier: 1, cat: 'museum' },
  { q: 'Museum Rembrandthuis Amsterdam', name: 'Museum Rembrandthuis', tier: 1, cat: 'museum' },
  { q: 'NEMO Science Museum Amsterdam', name: 'NEMO Science Museum', tier: 1, cat: 'museum' },
  { q: 'EYE Filmmuseum Amsterdam', name: 'EYE Filmmuseum', tier: 2, cat: 'museum' },
  { q: "A'DAM Lookout Amsterdam", name: "A'DAM Lookout", tier: 2, cat: 'aussicht' },
  { q: 'Concertgebouw Amsterdam', name: 'Concertgebouw', tier: 2, cat: 'theater' },
  { q: 'Museumplein Amsterdam', name: 'Museumplein', tier: 2, cat: 'altstadt' },
  { q: 'Portuguese Synagogue Amsterdam', name: 'Portugese Synagoge', tier: 2, cat: 'kirche' },
  { q: 'Joods Historisch Museum Amsterdam', name: 'Joods Historisch Museum', tier: 2, cat: 'museum' },
  { q: 'Bloemenmarkt Amsterdam', name: 'Bloemenmarkt', tier: 2, cat: 'markt' },
  { q: 'Begijnhof Amsterdam', name: 'Begijnhof', tier: 1, cat: 'altstadt' },
  { q: 'De Waag Nieuwmarkt Amsterdam', name: 'De Waag', tier: 2, cat: 'denkmal' },
  { q: 'Artis Zoo Amsterdam', name: 'Artis Royal Zoo', tier: 2, cat: 'freizeit' },
  { q: 'Schreierstoren Amsterdam', name: 'Schreierstoren', tier: 2, cat: 'denkmal' },
];

let added = 0;
for (const a of adds) {
  const id = `amsterdam_${slugify(a.name)}`;
  const already = pack.spots.some(
    (s) =>
      s.id === id ||
      (s.pack_role === 'story' &&
        s.name.toLowerCase().includes(a.name.toLowerCase().slice(0, 10))),
  );
  if (already) {
    console.log('skip', a.name);
    continue;
  }
  const r = await geocode(`${a.q}, Netherlands`);
  const loc = r?.geometry?.location || r?.results?.[0]?.geometry?.location;
  if (!loc) {
    console.log('geocode fail', a.q);
    continue;
  }
  const address =
    r?.formatted_address || r?.results?.[0]?.formatted_address || '';
  const placeId = r?.place_id || r?.results?.[0]?.place_id || '';
  pack.spots.push({
    id,
    name: a.name,
    district: 'Amsterdam',
    category: a.cat,
    tags: [a.cat, 'story', `tier${a.tier}`, 'curated_keep', 'needs_deep_research'],
    bullets: [
      `Adresse (Google): ${address}.`,
      placeId
        ? `Google Maps: https://www.google.com/maps/place/?q=place_id:${placeId}`
        : null,
    ].filter(Boolean),
    facts: { now: `Adresse: ${address}`, tags: [a.cat] },
    polygonCoordinates: [],
    approach_triggers: [],
    sub_pois: [],
    nav_waypoints: [],
    pack_role: 'story',
    place_tier: a.tier,
  });
  pack.trigger_points = pack.trigger_points || [];
  pack.trigger_points.push({
    id,
    name: a.name,
    lat: loc.lat,
    lng: loc.lng,
    radius_m: 35,
    general_info: '',
    deep_data_pool: [],
  });
  added += 1;
  console.log('added', id);
}

pack.data_version = (pack.data_version || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(pack, null, 2));
const stories = pack.spots.filter((s) => s.pack_role === 'story');
console.log(
  JSON.stringify(
    {
      v: pack.data_version,
      stories: stories.length,
      added,
      names: stories.map((s) => `${s.place_tier} ${s.name}`),
    },
    null,
    2,
  ),
);
