#!/usr/bin/env node
import { boxPolygon, distM, loadPack, offset, savePack, slugify, suggestedPolygonHalfM } from './lib.mjs';
import { resolvePlace, requireGoogleKey } from './google.mjs';

requireGoogleKey();
const CITY_ID = 'bremen';
const CENTER = { lat: 53.0793, lng: 8.8017 };

const LANDMARKS = [
  { q: 'Bremer Roland', name: 'Bremer Roland', category: 'denkmal', tier: 1 },
  { q: 'Bremer Rathaus', name: 'Bremer Rathaus', category: 'denkmal', tier: 1 },
  { q: 'Bremer Dom St Petri', name: 'Bremer Dom', category: 'kirche', tier: 1 },
  { q: 'Marktplatz Bremen', name: 'Marktplatz Bremen', category: 'altstadt', tier: 1 },
  { q: 'Bremer Stadtmusikanten', name: 'Bremer Stadtmusikanten', category: 'denkmal', tier: 1 },
  { q: 'Böttcherstraße Bremen', name: 'Böttcherstraße', category: 'altstadt', tier: 1 },
  { q: 'Schnoor Bremen', name: 'Schnoor', category: 'altstadt', tier: 1 },
  { q: 'Kunsthalle Bremen', name: 'Kunsthalle Bremen', category: 'museum', tier: 1 },
  { q: 'Überseemuseum Bremen', name: 'Übersee-Museum', category: 'museum', tier: 1 },
  { q: 'Focke-Museum Bremen', name: 'Focke-Museum', category: 'museum', tier: 1 },
  { q: 'Universum Bremen', name: 'Universum Bremen', category: 'museum', tier: 1 },
  { q: 'Weserburg Museum Bremen', name: 'Weserburg', category: 'museum', tier: 2 },
  { q: 'Bremen Hauptbahnhof', name: 'Bremen Hauptbahnhof', category: 'bahnhof', tier: 1 },
  { q: 'Schlachte Bremen', name: 'Schlachte', category: 'hafen', tier: 1 },
  { q: 'Bürgerpark Bremen', name: 'Bürgerpark', category: 'natur', tier: 1 },
  { q: 'Rhododendronpark Bremen', name: 'Rhododendronpark', category: 'natur', tier: 2 },
  { q: 'Wallanlagen Bremen', name: 'Wallanlagen', category: 'natur', tier: 2 },
  { q: 'Theater Bremen', name: 'Theater Bremen', category: 'theater', tier: 2 },
  { q: 'Die Glocke Bremen', name: 'Die Glocke', category: 'theater', tier: 2 },
  { q: 'Liebfrauenkirche Bremen', name: 'Liebfrauenkirche', category: 'kirche', tier: 2 },
  { q: 'St Stephani Bremen', name: 'St. Stephani', category: 'kirche', tier: 2 },
  { q: 'Schütting Bremen', name: 'Schütting', category: 'denkmal', tier: 2 },
  { q: 'Weserstadion Bremen', name: 'Weserstadion', category: 'sport', tier: 1 },
  { q: 'Universität Bremen', name: 'Universität Bremen', category: 'denkmal', tier: 2 },
  { q: 'Botanika Bremen', name: 'Botanika', category: 'natur', tier: 2 },
  { q: 'Bleikeller Bremen Dom', name: 'Bleikeller', category: 'museum', tier: 2 },
  { q: 'Paula Modersohn Becker Museum Bremen', name: 'Paula Modersohn-Becker Museum', category: 'museum', tier: 2 },
  { q: 'Ludwig Roselius Museum Bremen', name: 'Ludwig Roselius Museum', category: 'museum', tier: 2 },
  { q: 'Haus Atlantis Bremen', name: 'Haus Atlantis', category: 'denkmal', tier: 2 },
  { q: 'Bremen Viertel Ostertor', name: 'Das Viertel', category: 'altstadt', tier: 2 },
  { q: 'Weserpromenade Bremen', name: 'Weserpromenade', category: 'natur', tier: 2 },
  { q: 'Überseestadt Bremen', name: 'Überseestadt', category: 'hafen', tier: 2 },
  { q: 'Hafenmuseum Speicher XI Bremen', name: 'Hafenmuseum Speicher XI', category: 'museum', tier: 2 },
  { q: 'Bremerhaven skip', name: 'SKIP', skip: true },
  { q: 'Stadtwaage Bremen', name: 'Stadtwaage', category: 'denkmal', tier: 3 },
  { q: 'Bankhaus Martens und Weyhausen Bremen', name: 'SKIP2', skip: true },
  { q: 'Kirche Unser Lieben Frauen Bremen', name: 'Unser Lieben Frauen Kirche', category: 'kirche', tier: 2 },
  { q: 'Gerichtsgebäude Bremen Landgericht', name: 'Landgericht Bremen', category: 'denkmal', tier: 3 },
  { q: 'Bremen Mühle am Wall', name: 'Mühle am Wall', category: 'denkmal', tier: 2 },
  { q: 'Kaffee HAG Bremen', name: 'Böttcherstraße / HAG', category: 'denkmal', tier: 3, skip: true },
  { q: 'Schnoorviertel Bremen', name: 'Schnoorviertel', category: 'altstadt', tier: 1 },
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
  if (!pack) throw new Error('bremen pack missing');
  pack.symbol = pack.symbol || '🎹';
  pack._product = { family: 'deutschland', tier: 'regional', paywall: false, notes: 'Bremen core + Bürgerpark/Weser' };

  let added = 0;
  let promoted = 0;
  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[hb] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, { near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 12000 } });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      continue;
    }
    if (distM(CENTER, hit) > 14000) {
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
      district: 'Bremen',
      category: lm.category,
      tags: [lm.category, 'story', `tier${lm.tier}`, 'curated_keep', 'needs_deep_research'],
      bullets: [
        hit.address ? `Adresse (Google): ${hit.address}.` : null,
        hit.placeId ? `Google Maps: https://www.google.com/maps/place/?q=place_id:${hit.placeId}` : null,
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
  console.log(JSON.stringify({ added, promoted, stories: pack.spots.filter((s) => s.pack_role === 'story').length, version: pack.data_version }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
