#!/usr/bin/env node
/**
 * Surgical London cleanup: demote bad promotes, force-add icons by exact id.
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
const CENTER = { lat: 51.5072, lng: -0.1276 };

const BAD =
  /apartment|blueground|hotel|hostel|2br|bedroom|bike.?tour|food.?hall|pier\\b|stn_|stop_|office|shop\\b|gift|sightseeing|waterbus|statue|church(?!ill)|victoria(?! and albert)|open_waterloo|notting_hill_bike|upmarket_brick|westminster_millennium|westminster_stn|sir_winston_churchill_statue|st_paul_s_church$|kensington_gardens$|regent_s_park_office|portobello_road_market$|greenwich_pier|covent_garden_market_relief|museum_superstore|paradox|moco|twist|clink|albert.?schloss/i;

const MUST = [
  { id: 'london_tower_of_london', q: 'Tower of London', name: 'Tower of London', category: 'denkmal', tier: 1 },
  { id: 'london_tower_bridge', q: 'Tower Bridge London', name: 'Tower Bridge', category: 'denkmal', tier: 1 },
  { id: 'london_british_museum', q: 'British Museum London', name: 'British Museum', category: 'museum', tier: 1 },
  { id: 'london_buckingham_palace', q: 'Buckingham Palace London', name: 'Buckingham Palace', category: 'denkmal', tier: 1 },
  { id: 'london_westminster_abbey', q: 'Westminster Abbey London', name: 'Westminster Abbey', category: 'kirche', tier: 1 },
  { id: 'london_palace_of_westminster', q: 'Palace of Westminster London', name: 'Palace of Westminster', category: 'denkmal', tier: 1 },
  { id: 'london_big_ben', q: 'Elizabeth Tower Big Ben London', name: 'Big Ben / Elizabeth Tower', category: 'denkmal', tier: 1 },
  { id: 'london_st_pauls_cathedral', q: "St Paul's Cathedral London", name: "St Paul's Cathedral", category: 'kirche', tier: 1 },
  { id: 'london_trafalgar_square', q: 'Trafalgar Square London', name: 'Trafalgar Square', category: 'altstadt', tier: 1 },
  { id: 'london_national_gallery', q: 'National Gallery London Trafalgar Square', name: 'National Gallery', category: 'museum', tier: 1 },
  { id: 'london_london_eye', q: 'London Eye', name: 'London Eye', category: 'aussicht', tier: 1 },
  { id: 'london_tate_modern', q: 'Tate Modern London', name: 'Tate Modern', category: 'museum', tier: 1 },
  { id: 'london_shakespeares_globe', q: "Shakespeare's Globe London", name: "Shakespeare's Globe", category: 'theater', tier: 1 },
  { id: 'london_natural_history_museum', q: 'Natural History Museum London', name: 'Natural History Museum', category: 'museum', tier: 1 },
  { id: 'london_science_museum', q: 'Science Museum London Exhibition Road', name: 'Science Museum', category: 'museum', tier: 1 },
  { id: 'london_victoria_and_albert_museum', q: 'Victoria and Albert Museum London', name: 'Victoria and Albert Museum', category: 'museum', tier: 1 },
  { id: 'london_hyde_park', q: 'Hyde Park London', name: 'Hyde Park', category: 'natur', tier: 1 },
  { id: 'london_kensington_palace', q: 'Kensington Palace London', name: 'Kensington Palace', category: 'denkmal', tier: 1 },
  { id: 'london_covent_garden', q: 'Covent Garden Piazza London', name: 'Covent Garden', category: 'altstadt', tier: 1 },
  { id: 'london_borough_market', q: 'Borough Market London', name: 'Borough Market', category: 'markt', tier: 1 },
  { id: 'london_camden_market', q: 'Camden Market London', name: 'Camden Market', category: 'markt', tier: 2 },
  { id: 'london_british_library', q: 'British Library London', name: 'British Library', category: 'museum', tier: 2 },
  { id: 'london_horse_guards', q: 'Horse Guards Parade London', name: 'Horse Guards Parade', category: 'denkmal', tier: 2 },
  { id: 'london_downing_street', q: '10 Downing Street London', name: 'Downing Street', category: 'denkmal', tier: 2 },
  { id: 'london_churchill_war_rooms', q: 'Churchill War Rooms London', name: 'Churchill War Rooms', category: 'museum', tier: 1 },
  { id: 'london_imperial_war_museum', q: 'Imperial War Museum London Lambeth', name: 'Imperial War Museum', category: 'museum', tier: 2 },
  { id: 'london_cutty_sark', q: 'Cutty Sark Greenwich', name: 'Cutty Sark', category: 'denkmal', tier: 1 },
  { id: 'london_royal_observatory_greenwich', q: 'Royal Observatory Greenwich', name: 'Royal Observatory Greenwich', category: 'museum', tier: 1 },
  { id: 'london_greenwich_park', q: 'Greenwich Park London', name: 'Greenwich Park', category: 'natur', tier: 2 },
  { id: 'london_queens_house', q: "Queen's House Greenwich", name: "Queen's House", category: 'museum', tier: 2 },
  { id: 'london_national_maritime_museum', q: 'National Maritime Museum Greenwich', name: 'National Maritime Museum', category: 'museum', tier: 2 },
  { id: 'london_st_katharine_docks', q: 'St Katharine Docks London', name: 'St Katharine Docks', category: 'hafen', tier: 2 },
  { id: 'london_millennium_bridge', q: 'Millennium Bridge London', name: 'Millennium Bridge', category: 'denkmal', tier: 2 },
  { id: 'london_the_shard', q: 'The Shard London', name: 'The Shard', category: 'aussicht', tier: 1 },
  { id: 'london_sky_garden', q: 'Sky Garden London', name: 'Sky Garden', category: 'aussicht', tier: 2 },
  { id: 'london_the_monument', q: 'Monument to the Great Fire of London', name: 'The Monument', category: 'denkmal', tier: 2 },
  { id: 'london_guildhall', q: 'Guildhall London City', name: 'Guildhall', category: 'denkmal', tier: 2 },
  { id: 'london_leadenhall_market', q: 'Leadenhall Market London', name: 'Leadenhall Market', category: 'markt', tier: 2 },
  { id: 'london_spitalfields_market', q: 'Old Spitalfields Market London', name: 'Spitalfields Market', category: 'markt', tier: 2 },
  { id: 'london_brick_lane', q: 'Brick Lane London', name: 'Brick Lane', category: 'altstadt', tier: 2 },
  { id: 'london_regents_park', q: "Regent's Park London", name: "Regent's Park", category: 'natur', tier: 2 },
  { id: 'london_zsl_london_zoo', q: 'ZSL London Zoo', name: 'ZSL London Zoo', category: 'freizeitpark', tier: 1 },
  { id: 'london_madame_tussauds', q: 'Madame Tussauds London', name: 'Madame Tussauds', category: 'freizeit', tier: 2 },
  { id: 'london_hampton_court_palace', q: 'Hampton Court Palace', name: 'Hampton Court Palace', category: 'denkmal', tier: 1 },
  { id: 'london_kew_gardens', q: 'Kew Gardens London', name: 'Kew Gardens', category: 'natur', tier: 1 },
  { id: 'london_notting_hill', q: 'Notting Hill London', name: 'Notting Hill', category: 'altstadt', tier: 2 },
  { id: 'london_portobello_road_market', q: 'Portobello Road Market London', name: 'Portobello Road Market', category: 'markt', tier: 2 },
  { id: 'london_abbey_road_crossing', q: 'Abbey Road Crossing London', name: 'Abbey Road Crossing', category: 'denkmal', tier: 2 },
  { id: 'london_piccadilly_circus', q: 'Piccadilly Circus London', name: 'Piccadilly Circus', category: 'altstadt', tier: 2 },
  { id: 'london_leicester_square', q: 'Leicester Square London', name: 'Leicester Square', category: 'altstadt', tier: 2 },
  { id: 'london_soho', q: 'Soho London', name: 'Soho', category: 'altstadt', tier: 2 },
  { id: 'london_royal_albert_hall', q: 'Royal Albert Hall London', name: 'Royal Albert Hall', category: 'theater', tier: 2 },
  { id: 'london_harrods', q: 'Harrods London', name: 'Harrods', category: 'einkaufen', tier: 2 },
  { id: 'london_st_james_park', q: "St James's Park London", name: "St James's Park", category: 'natur', tier: 2 },
  { id: 'london_hms_belfast', q: 'HMS Belfast London', name: 'HMS Belfast', category: 'museum', tier: 1 },
  { id: 'london_hampstead_heath', q: 'Hampstead Heath London', name: 'Hampstead Heath', category: 'natur', tier: 2 },
  { id: 'london_primrose_hill', q: 'Primrose Hill London', name: 'Primrose Hill', category: 'aussicht', tier: 2 },
  { id: 'london_kings_cross_station', q: "King's Cross Station London", name: "King's Cross Station", category: 'bahnhof', tier: 2 },
  { id: 'london_st_pancras_international', q: 'St Pancras International London', name: 'St Pancras International', category: 'bahnhof', tier: 2 },
  { id: 'london_platform_nine_three_quarters', q: "Platform 9 3/4 King's Cross", name: 'Platform 9¾', category: 'denkmal', tier: 2 },
  { id: 'london_southwark_cathedral', q: 'Southwark Cathedral London', name: 'Southwark Cathedral', category: 'kirche', tier: 2 },
  { id: 'london_tate_britain', q: 'Tate Britain London', name: 'Tate Britain', category: 'museum', tier: 2 },
  { id: 'london_somerset_house', q: 'Somerset House London', name: 'Somerset House', category: 'museum', tier: 2 },
  { id: 'london_wallace_collection', q: 'Wallace Collection London', name: 'Wallace Collection', category: 'museum', tier: 2 },
  { id: 'london_canary_wharf', q: 'Canary Wharf London', name: 'Canary Wharf', category: 'altstadt', tier: 2 },
  { id: 'london_wembley_stadium', q: 'Wembley Stadium London', name: 'Wembley Stadium', category: 'sport', tier: 2 },
  { id: 'london_barbican_centre', q: 'Barbican Centre London', name: 'Barbican Centre', category: 'theater', tier: 2 },
  { id: 'london_temple_church', q: 'Temple Church London', name: 'Temple Church', category: 'kirche', tier: 2 },
  { id: 'london_westminster_cathedral', q: 'Westminster Cathedral London', name: 'Westminster Cathedral', category: 'kirche', tier: 2 },
  { id: 'london_southbank_centre', q: 'Southbank Centre London', name: 'Southbank Centre', category: 'theater', tier: 2 },
];

function approaches(lat, lng, name, id) {
  return [
    { id: `${id}_approach_n`, ...(() => { const o = offset(lat, lng, 45, 0); return { lat: o.lat, lng: o.lng }; })(), radius_m: 36, teaser_text: `${name} liegt kurz voraus — auf Fassade bzw. Silhouette achten.`, condition_rule: 'always', needs_visual_review: true },
    { id: `${id}_approach_s`, ...(() => { const o = offset(lat, lng, -40, 0); return { lat: o.lat, lng: o.lng }; })(), radius_m: 24, teaser_text: `${name} — Eingang / markante Seite im Blick behalten.`, condition_rule: 'always', needs_visual_review: true },
  ];
}

async function main() {
  const pack = loadPack('london');
  let demoted = 0;
  for (const s of pack.spots) {
    if (s.pack_role === 'directory') continue;
    if (BAD.test(s.id) || BAD.test(s.name)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      demoted += 1;
    }
  }
  // Also demote thin stories not in MUST
  const mustIds = new Set(MUST.map((m) => m.id));
  for (const s of pack.spots) {
    if (s.pack_role === 'directory') continue;
    if (mustIds.has(s.id)) continue;
    const t = pack.trigger_points.find((x) => x.id === s.id);
    const chars = (t?.deep_data_pool || []).reduce((n, e) => n + String(e.text || '').length, 0);
    if (chars < 1200) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      demoted += 1;
    }
  }
  console.log('[surg] demoted', demoted);

  let ok = 0;
  for (const m of MUST) {
    process.stdout.write(`[must] ${m.name}… `);
    const hit = await resolvePlace(m.q, {
      near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 25000 },
    });
    if (!hit?.lat || distM(CENTER, hit) > 30000) {
      console.log('miss');
      continue;
    }
    let s = pack.spots.find((x) => x.id === m.id);
    let t = pack.trigger_points.find((x) => x.id === m.id);
    if (!s) {
      s = {
        id: m.id,
        name: m.name,
        district: m.category,
        category: m.category,
        place_tier: m.tier,
        pack_role: 'story',
        tags: [m.category, 'story', `tier${m.tier}`, 'london_must', 'needs_deep_research'],
        bullets: hit.address ? [`Adresse (Maps): ${hit.address}.`] : [],
        facts: { tags: [m.category] },
        polygonCoordinates: boxPolygon(hit.lat, hit.lng, m.tier === 1 ? 28 : 22),
        approach_triggers: approaches(hit.lat, hit.lng, m.name, m.id),
        sub_pois: [
          {
            id: `${m.id}_sub_eingang`,
            name: `${m.name} · Entrance`,
            lat: hit.lat,
            lng: hit.lng,
            radius_m: 10,
            fact_details: 'Navigation pin.',
            tags: ['sub_poi', 'eingang'],
          },
        ],
        nav_waypoints: [],
        _google: { place_id: hit.place_id, rating: hit.rating },
      };
      pack.spots.push(s);
    } else {
      s.name = m.name;
      s.category = m.category;
      s.place_tier = m.tier;
      s.pack_role = 'story';
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((x) => x !== 'directory' && x !== 'tier4' && x !== 'auto_noise_demote'),
          'story',
          `tier${m.tier}`,
          'london_must',
          'needs_deep_research',
        ]),
      ];
      if (!(s.approach_triggers || []).length) {
        s.approach_triggers = approaches(hit.lat, hit.lng, m.name, m.id);
      }
    }
    if (!t) {
      t = {
        id: m.id,
        name: m.name,
        lat: hit.lat,
        lng: hit.lng,
        radius_m: m.tier === 1 ? 42 : 30,
        general_info: '',
        deep_data_pool: [],
      };
      pack.trigger_points.push(t);
    } else {
      t.name = m.name;
      t.lat = hit.lat;
      t.lng = hit.lng;
    }
    ok += 1;
    console.log(hit.lat.toFixed(5), hit.lng.toFixed(5));
  }

  pack.symbol = '🇬🇧';
  pack._coverage = { latMin: 51.45, latMax: 51.56, lngMin: -0.32, lngMax: 0.02 };
  pack._product = {
    family: 'international',
    tier: 'metro',
    paywall: false,
    notes: 'London metro icons; Sintra-style day trips Kew/Hampton Court included',
  };
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };
  savePack(pack, { bumpVersion: true });
  console.log(`[surg] v${pack.data_version} story=${pack._pack_index.story} mustOk=${ok}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
