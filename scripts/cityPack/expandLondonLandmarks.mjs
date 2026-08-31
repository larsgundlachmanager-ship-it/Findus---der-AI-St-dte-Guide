#!/usr/bin/env node
/**
 * Force-add London metro landmarks (Places API New) as story candidates.
 *   node scripts/cityPack/expandLondonLandmarks.mjs
 */
import {
  boxPolygon,
  distM,
  loadPack,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { resolvePlace, requireGoogleKey } from './google.mjs';

requireGoogleKey();
const CITY_ID = 'london';
const CENTER = { lat: 51.5072, lng: -0.1276 };

const LANDMARKS = [
  { q: 'Tower of London', name: 'Tower of London', category: 'denkmal', tier: 1 },
  { q: 'Tower Bridge London', name: 'Tower Bridge', category: 'denkmal', tier: 1 },
  { q: 'British Museum London', name: 'British Museum', category: 'museum', tier: 1 },
  { q: 'Buckingham Palace London', name: 'Buckingham Palace', category: 'denkmal', tier: 1 },
  { q: 'Westminster Abbey London', name: 'Westminster Abbey', category: 'kirche', tier: 1 },
  { q: 'Houses of Parliament Big Ben London', name: 'Palace of Westminster', category: 'denkmal', tier: 1 },
  { q: 'Elizabeth Tower Big Ben London', name: 'Big Ben / Elizabeth Tower', category: 'denkmal', tier: 1 },
  { q: 'St Paul\'s Cathedral London', name: 'St Paul\'s Cathedral', category: 'kirche', tier: 1 },
  { q: 'Trafalgar Square London', name: 'Trafalgar Square', category: 'altstadt', tier: 1 },
  { q: 'National Gallery London Trafalgar', name: 'National Gallery', category: 'museum', tier: 1 },
  { q: 'London Eye', name: 'London Eye', category: 'aussicht', tier: 1 },
  { q: 'Tate Modern London', name: 'Tate Modern', category: 'museum', tier: 1 },
  { q: 'Shakespeare\'s Globe London', name: 'Shakespeare\'s Globe', category: 'theater', tier: 1 },
  { q: 'Natural History Museum London', name: 'Natural History Museum', category: 'museum', tier: 1 },
  { q: 'Science Museum London', name: 'Science Museum', category: 'museum', tier: 1 },
  { q: 'Victoria and Albert Museum London', name: 'Victoria and Albert Museum', category: 'museum', tier: 1 },
  { q: 'Hyde Park London', name: 'Hyde Park', category: 'natur', tier: 1 },
  { q: 'Kensington Palace London', name: 'Kensington Palace', category: 'denkmal', tier: 1 },
  { q: 'Covent Garden London', name: 'Covent Garden', category: 'altstadt', tier: 1 },
  { q: 'Borough Market London', name: 'Borough Market', category: 'markt', tier: 1 },
  { q: 'Camden Market London', name: 'Camden Market', category: 'markt', tier: 2 },
  { q: 'British Library London', name: 'British Library', category: 'museum', tier: 2 },
  { q: 'Changing of the Guard Buckingham Palace', name: 'Horse Guards Parade', category: 'denkmal', tier: 2 },
  { q: 'Horse Guards Parade London', name: 'Horse Guards', category: 'denkmal', tier: 2 },
  { q: 'Downing Street London', name: 'Downing Street', category: 'denkmal', tier: 2 },
  { q: 'Churchill War Rooms London', name: 'Churchill War Rooms', category: 'museum', tier: 1 },
  { q: 'Imperial War Museum London', name: 'Imperial War Museum', category: 'museum', tier: 2 },
  { q: 'Cutty Sark Greenwich', name: 'Cutty Sark', category: 'denkmal', tier: 1 },
  { q: 'Royal Observatory Greenwich', name: 'Royal Observatory Greenwich', category: 'museum', tier: 1 },
  { q: 'Greenwich Park London', name: 'Greenwich Park', category: 'natur', tier: 2 },
  { q: 'Queen\'s House Greenwich', name: 'Queen\'s House', category: 'museum', tier: 2 },
  { q: 'National Maritime Museum Greenwich', name: 'National Maritime Museum', category: 'museum', tier: 2 },
  { q: 'St Katharine Docks London', name: 'St Katharine Docks', category: 'hafen', tier: 2 },
  { q: 'Millennium Bridge London', name: 'Millennium Bridge', category: 'denkmal', tier: 2 },
  { q: 'The Shard London', name: 'The Shard', category: 'aussicht', tier: 1 },
  { q: 'Sky Garden London', name: 'Sky Garden', category: 'aussicht', tier: 2 },
  { q: 'Monument to the Great Fire of London', name: 'The Monument', category: 'denkmal', tier: 2 },
  { q: 'Bank of England Museum London', name: 'Bank of England Museum', category: 'museum', tier: 3 },
  { q: 'Guildhall London', name: 'Guildhall', category: 'denkmal', tier: 2 },
  { q: 'Leadenhall Market London', name: 'Leadenhall Market', category: 'markt', tier: 2 },
  { q: 'Spitalfields Market London', name: 'Spitalfields Market', category: 'markt', tier: 2 },
  { q: 'Brick Lane London', name: 'Brick Lane', category: 'altstadt', tier: 2 },
  { q: 'Columbia Road Flower Market London', name: 'Columbia Road Flower Market', category: 'markt', tier: 3 },
  { q: 'Regent\'s Park London', name: 'Regent\'s Park', category: 'natur', tier: 2 },
  { q: 'London Zoo', name: 'ZSL London Zoo', category: 'freizeitpark', tier: 1 },
  { q: 'Madame Tussauds London', name: 'Madame Tussauds', category: 'freizeit', tier: 2 },
  { q: 'Warner Bros Studio Tour London', name: 'SKIP_leavesden', category: 'freizeit', tier: 9, skip: true },
  { q: 'Hampton Court Palace', name: 'Hampton Court Palace', category: 'denkmal', tier: 1 },
  { q: 'Kew Gardens London', name: 'Kew Gardens', category: 'natur', tier: 1 },
  { q: 'Notting Hill London', name: 'Notting Hill', category: 'altstadt', tier: 2 },
  { q: 'Portobello Road Market London', name: 'Portobello Road Market', category: 'markt', tier: 2 },
  { q: 'Abbey Road Studios crossing London', name: 'Abbey Road Crossing', category: 'denkmal', tier: 2 },
  { q: 'Piccadilly Circus London', name: 'Piccadilly Circus', category: 'altstadt', tier: 2 },
  { q: 'Leicester Square London', name: 'Leicester Square', category: 'altstadt', tier: 2 },
  { q: 'Soho London', name: 'Soho', category: 'altstadt', tier: 2 },
  { q: 'Chinatown London Gerrard Street', name: 'Chinatown London', category: 'altstadt', tier: 2 },
  { q: 'Royal Albert Hall London', name: 'Royal Albert Hall', category: 'theater', tier: 2 },
  { q: 'Albert Memorial London', name: 'Albert Memorial', category: 'denkmal', tier: 2 },
  { q: 'Harrods London', name: 'Harrods', category: 'einkaufen', tier: 2 },
  { q: 'Fortnum and Mason London', name: 'Fortnum & Mason', category: 'einkaufen', tier: 2 },
  { q: 'St James\'s Park London', name: 'St James\'s Park', category: 'natur', tier: 2 },
  { q: 'Green Park London', name: 'Green Park', category: 'natur', tier: 2 },
  { q: 'Serpentine Gallery London', name: 'Serpentine Gallery', category: 'museum', tier: 3 },
  { q: 'Wallace Collection London', name: 'Wallace Collection', category: 'museum', tier: 2 },
  { q: 'Sir John Soane\'s Museum London', name: 'Sir John Soane\'s Museum', category: 'museum', tier: 2 },
  { q: 'Charles Dickens Museum London', name: 'Charles Dickens Museum', category: 'museum', tier: 3 },
  { q: 'Museum of London Docklands', name: 'Museum of London Docklands', category: 'museum', tier: 2 },
  { q: 'Canary Wharf London', name: 'Canary Wharf', category: 'altstadt', tier: 2 },
  { q: 'O2 Arena London Greenwich', name: 'The O2', category: 'theater', tier: 2 },
  { q: 'Emirates Air Line cable car London', name: 'IFS Cloud Cable Car', category: 'aussicht', tier: 3 },
  { q: 'Wembley Stadium London', name: 'Wembley Stadium', category: 'sport', tier: 2 },
  { q: 'Emirates Stadium Arsenal', name: 'Emirates Stadium', category: 'sport', tier: 2 },
  { q: 'Stamford Bridge Chelsea', name: 'Stamford Bridge', category: 'sport', tier: 2 },
  { q: 'Lord\'s Cricket Ground London', name: 'Lord\'s', category: 'sport', tier: 3 },
  { q: 'Southbank Centre London', name: 'Southbank Centre', category: 'theater', tier: 2 },
  { q: 'Tate Britain London', name: 'Tate Britain', category: 'museum', tier: 2 },
  { q: 'Cleopatra\'s Needle London', name: 'Cleopatra\'s Needle', category: 'denkmal', tier: 3 },
  { q: 'Cleopatra Needle Embankment', name: 'Cleopatra\'s Needle Embankment', category: 'denkmal', tier: 3, skip: true },
  { q: 'Temple Church London', name: 'Temple Church', category: 'kirche', tier: 2 },
  { q: 'Inns of Court Middle Temple London', name: 'Middle Temple', category: 'denkmal', tier: 3 },
  { q: 'Old Bailey London', name: 'Old Bailey', category: 'denkmal', tier: 3 },
  { q: 'Smithfield Market London', name: 'Smithfield Market', category: 'markt', tier: 3 },
  { q: 'St Bartholomew the Great London', name: 'St Bartholomew the Great', category: 'kirche', tier: 2 },
  { q: 'Barbican Centre London', name: 'Barbican Centre', category: 'theater', tier: 2 },
  { q: 'Museum of the Home London', name: 'Museum of the Home', category: 'museum', tier: 3 },
  { q: 'Columbia Road', name: 'SKIP_dup', skip: true },
  { q: 'Hampstead Heath London', name: 'Hampstead Heath', category: 'natur', tier: 2 },
  { q: 'Parliament Hill London viewpoint', name: 'Parliament Hill', category: 'aussicht', tier: 2 },
  { q: 'Primrose Hill London', name: 'Primrose Hill', category: 'aussicht', tier: 2 },
  { q: 'King\'s Cross Station London', name: 'King\'s Cross Station', category: 'bahnhof', tier: 2 },
  { q: 'St Pancras International London', name: 'St Pancras International', category: 'bahnhof', tier: 2 },
  { q: 'Platform 9 3/4 King\'s Cross', name: 'Platform 9¾', category: 'denkmal', tier: 2 },
  { q: 'Paddington Station London', name: 'Paddington Station', category: 'bahnhof', tier: 3 },
  { q: 'London Bridge Station', name: 'London Bridge Station', category: 'bahnhof', tier: 3 },
  { q: 'Borough Market', name: 'SKIP_dup', skip: true },
  { q: 'Southwark Cathedral London', name: 'Southwark Cathedral', category: 'kirche', tier: 2 },
  { q: 'Golden Hinde London', name: 'Golden Hinde', category: 'denkmal', tier: 3 },
  { q: 'HMS Belfast London', name: 'HMS Belfast', category: 'museum', tier: 1 },
  { q: 'City Hall London Southwark', name: 'City Hall London', category: 'verwaltung', tier: 3 },
  { q: 'Banqueting House Whitehall', name: 'Banqueting House', category: 'denkmal', tier: 2 },
  { q: 'Westminster Cathedral London', name: 'Westminster Cathedral', category: 'kirche', tier: 2 },
  { q: 'Somerset House London', name: 'Somerset House', category: 'museum', tier: 2 },
  { q: 'Courtauld Gallery London', name: 'Courtauld Gallery', category: 'museum', tier: 2 },
  { q: 'Royal Opera House Covent Garden', name: 'Royal Opera House', category: 'theater', tier: 2 },
  { q: 'Neal\'s Yard London', name: 'Neal\'s Yard', category: 'altstadt', tier: 3 },
  { q: 'Seven Dials London', name: 'Seven Dials', category: 'altstadt', tier: 3 },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 45, east: 0, r: 36 },
    { id: 's', north: -40, east: 0, r: 24 },
  ].map((d) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
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
  if (!pack) throw new Error('london pack missing — run city:auto first');
  pack.symbol = pack.symbol || '🇬🇧';
  pack._product = {
    family: 'international',
    tier: 'metro',
    paywall: false,
    notes: 'London / Greater London core + Greenwich/Kew/Hampton Court icons',
  };

  let added = 0;
  let promoted = 0;
  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[lon] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, {
        near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 22000 },
      });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      continue;
    }
    if (distM(CENTER, hit) > 28000) {
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
            ...(byName.tags || []).filter((x) => x !== 'directory' && x !== 'tier4'),
            'story',
            `tier${lm.tier}`,
            'london_expand',
            'needs_deep_research',
          ]),
        ];
        if (!(byName.approach_triggers || []).length) {
          const t = pack.trigger_points.find((x) => x.id === byName.id);
          byName.approach_triggers = approaches(
            t?.lat ?? hit.lat,
            t?.lng ?? hit.lng,
            lm.name,
            byName.id,
          );
        }
        promoted += 1;
        console.log('promote', byName.id);
      } else {
        console.log('exists', byName.id);
      }
      continue;
    }

    const near = pack.spots.find((s) => {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      return t && distM(t, hit) < 55 && nameSimilar(s.name, lm.name);
    });
    if (near) {
      console.log('near', near.id);
      continue;
    }

    const spotId = `${CITY_ID}_${slugify(lm.name)}`.slice(0, 80);
    if (pack.spots.some((s) => s.id === spotId)) {
      console.log('id-dup');
      continue;
    }

    pack.spots.push({
      id: spotId,
      name: lm.name,
      district: lm.category,
      category: lm.category,
      place_tier: lm.tier,
      pack_role: 'story',
      tags: [lm.category, 'story', `tier${lm.tier}`, 'london_expand', 'needs_deep_research'],
      bullets: hit.address ? [`Adresse (Maps): ${hit.address}.`] : [],
      facts: { tags: [lm.category, 'needs_deep_research'] },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, lm.tier === 1 ? 28 : 22),
      approach_triggers: approaches(hit.lat, hit.lng, lm.name, spotId),
      sub_pois: [
        {
          id: `${spotId}_sub_eingang`,
          name: `${lm.name} · Entrance`,
          lat: hit.lat,
          lng: hit.lng,
          radius_m: 10,
          fact_details: 'Navigation pin / entrance — visual check.',
          tags: ['sub_poi', 'eingang'],
        },
      ],
      nav_waypoints: [],
      _google: { place_id: hit.place_id, rating: hit.rating },
    });
    pack.trigger_points.push({
      id: spotId,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: lm.tier === 1 ? 42 : 30,
      general_info: '',
      deep_data_pool: [],
    });
    added += 1;
    console.log(`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
  }

  pack._coverage = {
    latMin: 51.45,
    latMax: 51.56,
    lngMin: -0.32,
    lngMax: 0.02,
  };
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'London metro expand — deep research pending',
  };
  const file = savePack(pack, { bumpVersion: true });
  console.log(
    `[lon] ${file} v${pack.data_version} story=${pack._pack_index.story} added=${added} promoted=${promoted}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
