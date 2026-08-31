#!/usr/bin/env node
/** Force-add Kiel landmarks via Places resolve. */
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
const CITY_ID = 'kiel';
const CENTER = { lat: 54.3233, lng: 10.1228 };

const LANDMARKS = [
  { q: 'Kieler Rathaus', name: 'Kieler Rathaus', category: 'denkmal', tier: 1 },
  { q: 'Nikolaikirche Kiel', name: 'Nikolaikirche', category: 'kirche', tier: 1 },
  { q: 'Kieler Schloss', name: 'Kieler Schloss', category: 'denkmal', tier: 1 },
  { q: 'Kunsthalle zu Kiel', name: 'Kunsthalle zu Kiel', category: 'museum', tier: 1 },
  { q: 'Stadt- und Schifffahrtsmuseum Kiel Warleberger Hof', name: 'Stadt- und Schifffahrtsmuseum', category: 'museum', tier: 1 },
  { q: 'Aquarium GEOMAR Kiel', name: 'GEOMAR Aquarium', category: 'museum', tier: 1 },
  { q: 'Zoologisches Museum Kiel', name: 'Zoologisches Museum Kiel', category: 'museum', tier: 1 },
  { q: 'Kiel Hauptbahnhof', name: 'Kiel Hauptbahnhof', category: 'bahnhof', tier: 1 },
  { q: 'Holstenstraße Kiel', name: 'Holstenstraße', category: 'altstadt', tier: 1 },
  { q: 'Alter Markt Kiel', name: 'Alter Markt', category: 'altstadt', tier: 1 },
  { q: 'Bootshafen Kiel', name: 'Bootshafen', category: 'hafen', tier: 1 },
  { q: 'Kiellinie Kiel', name: 'Kiellinie', category: 'hafen', tier: 1 },
  { q: 'Düsternbrooker Weg Kiel Förde', name: 'Düsternbrook / Hindenburgufer', category: 'aussicht', tier: 1 },
  { q: 'Schwedenkai Kiel', name: 'Schwedenkai', category: 'hafen', tier: 1 },
  { q: 'Norwegenkai Kiel', name: 'Norwegenkai', category: 'hafen', tier: 1 },
  { q: 'Ostseekai Kiel', name: 'Ostseekai', category: 'hafen', tier: 1 },
  { q: 'Schrevenpark Kiel', name: 'Schrevenpark', category: 'natur', tier: 2 },
  { q: 'Theater Kiel Opernhaus', name: 'Theater Kiel', category: 'theater', tier: 1 },
  { q: 'Wunderino Arena Kiel', name: 'Wunderino Arena', category: 'theater', tier: 2 },
  { q: 'Christian-Albrechts-Universität Kiel', name: 'Christian-Albrechts-Universität', category: 'denkmal', tier: 2 },
  { q: 'Botanischer Garten Kiel', name: 'Botanischer Garten Kiel', category: 'natur', tier: 2 },
  { q: 'Holtenau Schleusen Kiel Canal', name: 'Schleusen Holtenau', category: 'hafen', tier: 1 },
  { q: 'Nord-Ostsee-Kanal Kiel Holtenau', name: 'Nord-Ostsee-Kanal Holtenau', category: 'hafen', tier: 1 },
  { q: 'Leuchtturm Friedrichsort Kiel', name: 'Leuchtturm Friedrichsort', category: 'denkmal', tier: 2 },
  { q: 'Schlossgarten Kiel', name: 'Schlossgarten', category: 'natur', tier: 2 },
  { q: 'Computermuseum Kiel', name: 'Computermuseum der Fachhochschule Kiel', category: 'museum', tier: 2 },
  { q: 'Asemus Kiel', name: 'Medizin- und Pharmaziehistorische Sammlung', category: 'museum', tier: 3 },
  { q: 'Seegartenbrücke Kiel', name: 'Seegartenbrücke', category: 'denkmal', tier: 2 },
  { q: 'Hörn Kiel', name: 'Hörn', category: 'hafen', tier: 2 },
  { q: 'Hörnbrücke Kiel', name: 'Hörnbrücke', category: 'denkmal', tier: 1 },
  { q: 'Sparkassen-Arena Kiel', name: 'Wunderino Arena (Handball)', category: 'sport', tier: 2, skip: true },
  { q: 'THW Kiel Arena', name: 'THW Kiel Heimspielstätte', category: 'sport', tier: 2 },
  { q: 'Falckenstein Strand Kiel', name: 'Strand Falckenstein', category: 'natur', tier: 2 },
  { q: 'Schilksee Olympiazentrum Kiel', name: 'Olympiazentrum Schilksee', category: 'sport', tier: 2 },
  { q: 'Laboe Marine-Ehrenmal', name: 'Marine-Ehrenmal Laboe', category: 'denkmal', tier: 1 },
  { q: 'U-995 Laboe', name: 'U-Boot U-995 Laboe', category: 'museum', tier: 1 },
  { q: 'Fischhalle Kiel', name: 'Fischhalle', category: 'markt', tier: 2 },
  { q: 'Rathausturm Kiel Aussicht', name: 'Rathausturm Kiel', category: 'aussicht', tier: 1 },
  { q: 'Heiligengeistkirche Kiel', name: 'Heiligengeistkirche', category: 'kirche', tier: 2 },
  { q: 'Anscharkirche Kiel', name: 'Anscharkirche', category: 'kirche', tier: 2 },
  { q: 'Forstbaumschule Kiel', name: 'Forstbaumschule', category: 'natur', tier: 2 },
  { q: 'Moorteichwiese Kiel', name: 'Moorteichwiese', category: 'natur', tier: 2 },
  { q: 'Kieler Woche Gelände', name: 'Kieler Woche / Kiellinie Festbereich', category: 'freizeit', tier: 1 },
  { q: 'German Naval Yards Kiel', name: 'German Naval Yards', category: 'hafen', tier: 3 },
  { q: 'Gablenzbrücke Kiel', name: 'Gablenzbrücke', category: 'denkmal', tier: 3 },
  { q: 'Exerzierplatz Kiel', name: 'Exerzierplatz', category: 'altstadt', tier: 2 },
  { q: 'Dreiecksplatz Kiel', name: 'Dreiecksplatz', category: 'altstadt', tier: 3 },
  { q: 'Blücherbrücke Kiel', name: 'Blücherbrücke', category: 'denkmal', tier: 2 },
  { q: 'Reventloubrücke Kiel', name: 'Reventloubrücke', category: 'denkmal', tier: 2 },
  { q: 'Bellevuebrücke Kiel', name: 'Bellevuebrücke', category: 'denkmal', tier: 3 },
  { q: 'Museum Warleberger Hof Kiel', name: 'Warleberger Hof', category: 'museum', tier: 2 },
  { q: 'Landesbibliothek Kiel Schloss', name: 'Schleswig-Holsteinische Landesbibliothek', category: 'museum', tier: 3 },
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
  if (!pack) throw new Error('kiel pack missing');
  pack.symbol = pack.symbol || '⚓';
  pack._product = {
    family: 'deutschland',
    tier: 'regional',
    paywall: false,
    notes: 'Kiel Förde + Holtenau + Laboe icons',
  };

  let added = 0;
  let promoted = 0;
  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[kiel] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, {
        near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 18000 },
      });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      continue;
    }
    if (distM(CENTER, hit) > 20000) {
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
      } else {
        console.log('exists');
      }
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
      district: 'Kiel',
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
