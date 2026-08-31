#!/usr/bin/env node
/**
 * Expand a city pack with offline Directory spots + _offline_qa.
 *
 *   node scripts/cityPack/expandCityDirectory.mjs --city hechingen --apply
 *   node scripts/cityPack/expandCityDirectory.mjs --city hechingen --radius 7000 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  boxPolygon,
  distM,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  slugify,
  writeJson,
  packCostIsCheap,
} from './lib.mjs';
import {
  DIRECTORY_QUERIES,
  requireGoogleKey,
  resolvePlace,
  placesText,
} from './google.mjs';
import { fetchOsmDirectory } from '../geo/osm.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function mapCategory(hint, types = []) {
  const t = types.join(' ');
  if (hint) return hint;
  if (/supermarket|grocery/i.test(t)) return 'supermarket';
  if (/pharmacy/i.test(t)) return 'apotheke';
  if (/hospital|doctor/i.test(t)) return 'gesundheit';
  if (/lodging/i.test(t)) return 'hotel';
  if (/restaurant|meal/i.test(t)) return 'restaurant';
  if (/cafe|bakery/i.test(t)) return 'cafe';
  if (/movie_theater/i.test(t)) return 'kino';
  if (/golf/i.test(t)) return 'golf';
  if (/gym|stadium/i.test(t)) return 'sport';
  if (/park|natural/i.test(t)) return 'natur';
  if (/gas_station/i.test(t)) return 'tankstelle';
  return 'ort';
}

function alreadyNear(pack, lat, lng, meters = 55) {
  for (const spot of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
    if (!t || typeof t.lat !== 'number') continue;
    if (distM({ lat: t.lat, lng: t.lng }, { lat, lng }) < meters) return spot;
  }
  return null;
}

function addDirectorySpot(pack, place, stats) {
  const near = alreadyNear(pack, place.lat, place.lng);
  if (near) {
    stats.skippedNear += 1;
    return;
  }
  const id = `${pack.city_id}_${slugify(place.name)}`.slice(0, 80);
  if (pack.spots.some((s) => s.id === id)) {
    stats.skippedDup += 1;
    return;
  }
  const category = mapCategory(place.category, place.types);
  const spot = {
    id,
    name: place.name,
    category,
    district: category,
    pack_role: 'directory',
    place_tier: 4,
    relevance: ['offline_lookup', category],
    tags: [category, 'directory', 'tier4', 'offline_lookup', 'optional_live'],
    bullets: [
      place.address ? `Adresse: ${place.address}.` : null,
      'Offline-Katalog: Standort für Fragen/Suche — kein proaktiver Story-Trigger.',
    ].filter(Boolean),
    facts: {
      now: place.address ? `Adresse: ${place.address}` : undefined,
      tags: [category, 'directory'],
    },
    polygonCoordinates: boxPolygon(place.lat, place.lng, 16),
    approach_triggers: [],
    sub_pois: [],
  };
  if (place.place_id) {
    spot._google = { place_id: place.place_id };
  }
  const trigger = {
    id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    radius_m: 16,
    trigger_kind: 'point',
    general_info: `${place.name} — Offline-Directory (${category}).`,
    deep_data_pool: [
      {
        text: `GPS: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}${place.address ? ` — ${place.address}` : ''}.`,
        tags: ['gps_confirmed', place.source === 'osm' ? 'sourced_osm' : 'sourced_google', 'directory'],
      },
      {
        text: `Kategorie: ${category}. Für Offline-Fragen und Modul-2-Lookup; keine Wegweiser-Story.`,
        tags: ['directory', 'meta'],
      },
      {
        text: 'LIVE: Öffnungszeiten, Speisekarte/Preise oder aktuelle Angebote frisch prüfen — nie aus dem Pack vorlesen.',
        tags: ['live_hint', 'ephemeral', 'directory'],
      },
      {
        text: `User-Frage: Wo ist ${place.name}? Antwort: ${place.address || 'Koordinaten im Pack'} — im Offline-Katalog unter ${category}.`,
        tags: ['faq', 'user_question', 'directory'],
      },
    ],
  };
  pack.spots.push(spot);
  pack.trigger_points.push(trigger);
  stats.added += 1;
}

function hechingenExtras(pack, stats) {
  const extras = [
    {
      name: 'Naturschutzgebiet Mittleres Starzeltal',
      query: 'Naturschutzgebiet Mittleres Starzeltal Hechingen',
      category: 'natur',
      tier: 2,
      role: 'story',
      general:
        'Das Naturschutzgebiet Mittleres Starzeltal ist ein Wander- und Naturziel entlang der Starzel — ruhige Wege statt Altstadt-Trubel.',
    },
    {
      name: 'Feldkreuz Hechingen',
      query: 'Feldkreuz Hechingen',
      category: 'denkmal',
      tier: 3,
      role: 'directory',
    },
    {
      name: 'Weiherstadion Hechingen',
      query: 'Weiherstadion Hechingen',
      category: 'sport',
      tier: 3,
      role: 'directory',
    },
    {
      name: 'Golfclub Hechingen-Hohenzollern',
      query: 'Golfclub Hechingen-Hohenzollern',
      category: 'golf',
      tier: 3,
      role: 'directory',
    },
    {
      name: 'Rewe Hechingen',
      query: 'Rewe Holger-Crafoord-Straße Hechingen',
      category: 'supermarket',
      tier: 4,
      role: 'directory',
    },
    {
      name: 'Lidl Hechingen',
      query: 'Lidl Hechingen',
      category: 'supermarket',
      tier: 4,
      role: 'directory',
    },
    {
      name: 'dm Hechingen City-Center',
      query: 'dm Haigerlocher Straße Hechingen',
      category: 'einkaufen',
      tier: 4,
      role: 'directory',
    },
  ];
  return extras;
}

function parseUserFaq(text) {
  const m = String(text || '').match(
    /^\s*User-Frage:\s*(.+?)\?\s*Antwort:\s*(.+)\s*$/is,
  );
  if (!m) return null;
  return { q: m[1].trim().replace(/\?+$/, '') + '?', a: m[2].trim() };
}

function hechingenSeedQa(push) {
  push(
    'Wo ist die Tourist-Info?',
    'Bürger- und Tourismusbüro am Kirchplatz 12 bzw. Marktplatz 1 — nicht im Bahnhof.',
    ['service', 'orientierung'],
  );
  push(
    'Welcher Nahverkehr gilt hier?',
    'NALDO-Verbund, eigene Stadtwabe; Bahnhof mit Zollern-Alb-Bahn 1/2 (SWEG/HzL) und ZOB.',
    ['transport'],
  );
  push(
    'Gibt es die Nette Toilette?',
    'Ja — teilnehmende Cafés (u.a. Refugio, Eiscafe La Palma, Cafe Blixen, Backbey) mit rotem Aufkleber; plus öffentliche WCs u.a. Bahnhofstraße.',
    ['service'],
  );
  push(
    'Wo ist die Polizei?',
    'Polizeirevier Hechingen, Heiligkreuzstraße 6; Notruf 110.',
    ['notfall'],
  );
  push(
    'Wo ist die Notaufnahme / Klinik?',
    'Zentrale Notfallversorgung über Zollernalb-Klinikum (Balingen/Albstadt); Rettung 112. LIVE: aktuellen Standort/Öffnung prüfen.',
    ['notfall', 'live'],
  );
  push(
    'Wo bekomme ich Trinkwasser / Abkühlung?',
    'Wassertisch und Wasserachsen am Obertorplatz; Kneippanlage im Stadtgarten saisonal; Starzelpark zum Füße kühlen. LIVE: Winter/Frost beachten.',
    ['wasser', 'komfort'],
  );
  push(
    'Wann ist Wochenmarkt?',
    'Typisch samstags vormittags an der Johannesbrücke — LIVE aktuelle Zeiten prüfen.',
    ['einkaufen', 'live'],
  );
  push(
    'Was kann ich bei Schlechtwetter machen?',
    'Panoramabad (Halle), Oldtimermuseum/Kalendermuseum, Landesmuseum, Burgtheater/Kino, Villa Eugenia/Kultur — Öffnungen LIVE prüfen.',
    ['freizeit'],
  );
  push(
    'Welche großen Feste gibt es?',
    'Irma-West-Kinder- und Heimatfest (meist Sommer); auf der Burg u.a. Sternschnuppen-Nächte und Königlicher Weihnachtsmarkt — immer LIVE Termine prüfen.',
    ['events', 'live'],
  );
  push(
    'Wo ist der beste Fotopunkt der Burg?',
    'Zeller Horn (Postkartenmotiv); alternativ Himmelsschaukel am Obertorplatz und Maria Zell.',
    ['panorama'],
  );
  push(
    'Was kann ich hier draußen machen?',
    'Wandern/Natur (Mittleres Starzeltal, Starzelpark, Fürstengarten), Aussichten (Zeller Horn, Dreifürstenstein), Golf, Baden/Panoramabad, Burg & Museen — Orte stehen im Offline-Katalog.',
    ['aktivitaeten', 'freizeit'],
  );
}

function buildOfflineQa(pack, research) {
  const qa = [];
  const seen = new Set();
  const push = (q, a, tags = []) => {
    if (!q || !a || a === '-') return;
    const key = `${String(q).toLowerCase()}|${String(a).slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    qa.push({ q, a, tags: ['offline_qa', ...tags] });
  };

  // City-specific seeds only — never copy one city's answers into another pack
  if (pack.city_id === 'hechingen') hechingenSeedQa(push);

  // Generic emergency / orientation (stadt-agnostisch)
  push(
    'Was ist der Notruf?',
    'Europaweit: Polizei 110, Feuerwehr/Rettung 112. LIVE: nächste Wache/Klinik im Offline-Katalog oder frisch prüfen.',
    ['notfall'],
  );
  push(
    'Was kann ich hier machen / wo finde ich Orte offline?',
    'Im Stadt-Pack: Story-Orte plus Offline-Katalog (Supermarkt, Apotheke, Gastro, Hotel, Freizeit, Natur). Frag nach Kategorie oder Namen — LIVE nur für Zeiten/Preise.',
    ['orientierung', 'directory'],
  );

  // Category directory summaries (impress + offline answers)
  const byCat = new Map();
  for (const s of pack.spots || []) {
    const c = (s.category || 'ort').toLowerCase();
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(s.name);
  }
  const catQuestions = [
    ['supermarket', 'Wo sind Supermärkte?', 'einkaufen'],
    ['apotheke', 'Wo ist eine Apotheke?', 'notfall'],
    ['restaurant', 'Welche Restaurants sind im Pack?', 'gastro'],
    ['cafe', 'Welche Cafés / Bäckereien sind im Pack?', 'gastro'],
    ['hotel', 'Welche Hotels / Pensionen sind im Pack?', 'hotel'],
    ['spielplatz', 'Wo gibt es Spielplätze?', 'familie'],
    ['golf', 'Gibt es einen Golfplatz?', 'sport'],
    ['kino', 'Gibt es ein Kino / Theater?', 'freizeit'],
    ['sport', 'Welche Sport-/Freizeitstätten sind im Pack?', 'sport'],
    ['natur', 'Welche Parks / Naturziele sind im Pack?', 'natur'],
    ['tankstelle', 'Wo sind Tankstellen?', 'service'],
    ['gesundheit', 'Wo ist medizinische Hilfe / Klinik?', 'notfall'],
  ];
  for (const [cat, q, tag] of catQuestions) {
    const names = byCat.get(cat) || [];
    if (!names.length) continue;
    push(
      q,
      `${names.slice(0, 8).join('; ')}${names.length > 8 ? ` — u. a. ${names.length} Einträge im Offline-Katalog.` : '.'}`,
      [tag, cat, 'directory'],
    );
  }

  // Harvest spot FAQs (User-Frage … Antwort …)
  for (const tp of pack.trigger_points || []) {
    for (const raw of tp.deep_data_pool || []) {
      const text = typeof raw === 'string' ? raw : raw?.text;
      const parsed = parseUserFaq(text);
      if (!parsed) continue;
      push(parsed.q, parsed.a, ['spot_faq', tp.name || tp.id].filter(Boolean));
    }
  }

  for (const line of research?.infra?.service || []) {
    push(`Infrastruktur: ${String(line).slice(0, 72)}?`, line, ['service']);
  }
  for (const line of research?.infra?.transit || []) {
    push(`Mobilität: ${String(line).slice(0, 72)}?`, line, ['transport']);
  }
  for (const f of research?.nicht_ortsspezifische_fakten || []) {
    push(`Stadtinfo: ${String(f).slice(0, 56)}?`, f, ['geschichte']);
  }

  pack._offline_qa = qa;
  return qa.length;
}

async function main() {
  requireGoogleKey();
  const cityId = slugify(arg('city') || '');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/expandCityDirectory.mjs --city <id> [--radius 7000] --apply',
    );
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack missing: ${cityId}`);
  const radiusM = Number(arg('radius') || 7000);
  const center = { lat: pack.lat, lng: pack.lng };
  const stats = { added: 0, skippedNear: 0, skippedDup: 0, extras: 0 };

  const cheap = packCostIsCheap();
  console.log(
    `[dir] discover directory around ${cityId} mode=${cheap ? 'cheap/OSM' : 'full/Places'}`,
  );
  if (cheap) {
    try {
      const osmHits = await fetchOsmDirectory(center.lat, center.lng, radiusM);
      console.log(`[dir] OSM hits ${osmHits.length}`);
      for (const hit of osmHits) {
        if (distM(center, { lat: hit.lat, lng: hit.lng }) > radiusM + 1200) continue;
        addDirectorySpot(pack, hit, stats);
      }
    } catch (e) {
      console.warn(`[dir] OSM directory failed — skip Places in cheap mode: ${e.message}`);
    }
  } else
  for (const dq of DIRECTORY_QUERIES) {
    const query = `${dq.q} ${pack.name || cityId}`;
    console.log(`[dir] ${query}`);
    let results = [];
    try {
      const data = await placesText(query, {
        lat: center.lat,
        lng: center.lng,
        radiusM,
      });
      results = data.results || [];
    } catch (e) {
      console.warn(`[dir] fail ${query}: ${e.message}`);
      continue;
    }
    for (const r of results.slice(0, 10)) {
      const loc = r.geometry?.location;
      if (!loc) continue;
      if (distM(center, loc) > radiusM + 1200) continue;
      addDirectorySpot(
        pack,
        {
          name: r.name,
          lat: loc.lat,
          lng: loc.lng,
          address: r.formatted_address || r.vicinity || null,
          types: r.types || [],
          category: dq.categoryHint,
          place_id: r.place_id || null,
        },
        stats,
      );
    }
  }

  // Targeted extras (Hechingen-specific list is harmless for others if resolve fails)
  if (cityId === 'hechingen') {
    for (const ex of hechingenExtras(pack, stats)) {
      try {
        const g = await resolvePlace(ex.query, {
          near: center,
        });
        if (!g) continue;
        if (ex.role === 'story' && !alreadyNear(pack, g.lat, g.lng, 80)) {
          const id = `${cityId}_${slugify(ex.name)}`.slice(0, 80);
          if (!pack.spots.some((s) => s.id === id)) {
            pack.spots.push({
              id,
              name: ex.name,
              category: ex.category,
              district: ex.category,
              pack_role: 'story',
              place_tier: ex.tier,
              relevance: ['natur', 'wanderung'],
              tags: [ex.category, 'module1', `tier${ex.tier}`, 'master_report'],
              bullets: [g.address ? `Adresse/Lage: ${g.address}.` : 'Naturschutz-/Wanderziel.'],
              facts: {
                origin: ex.general || ex.name,
                tags: [ex.category],
              },
              polygonCoordinates: boxPolygon(g.lat, g.lng, 60),
              approach_triggers: [
                {
                  id: `${id}_a1`,
                  lat: g.lat + 0.00035,
                  lng: g.lng,
                  radius_m: 32,
                  teaser_text: `${ex.name} liegt voraus — Natur statt Altstadt.`,
                  condition_rule: 'always',
                },
              ],
              sub_pois: [],
            });
            pack.trigger_points.push({
              id,
              name: ex.name,
              lat: g.lat,
              lng: g.lng,
              radius_m: 40,
              general_info:
                ex.general ||
                `${ex.name} — Wander-/Naturziel im Hechinger Umfeld.`,
              deep_data_pool: [
                {
                  text: `GPS: ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}.`,
                  tags: ['gps_confirmed', 'sourced_google'],
                },
                {
                  text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: An der Starzel / ausgeschilderten Naturschutz- und Wanderwegen — kein städtischer Platz.',
                  tags: ['faq', 'user_question', 'visual_anchor'],
                },
                {
                  text: 'LIVE: Wegezustand und Sperrungen frisch prüfen.',
                  tags: ['live_hint', 'ephemeral'],
                },
                {
                  text: 'Querverbindung Starzelpark: städtisches Grün vs. Naturschutz entlang der Starzel.',
                  tags: ['querverbindung'],
                },
              ],
            });
            stats.extras += 1;
          }
        } else {
          addDirectorySpot(
            pack,
            {
              name: ex.name,
              lat: g.lat,
              lng: g.lng,
              address: g.address,
              types: g.types || [],
              category: ex.category,
            },
            stats,
          );
        }
      } catch (e) {
        console.warn('[extra]', ex.name, e.message);
      }
    }
  }

  // Also re-add classic optional dining/hotels if thin
  for (const dq of [
    { q: 'Restaurant', categoryHint: 'restaurant' },
    { q: 'Café OR Cafe', categoryHint: 'cafe' },
    { q: 'Hotel OR Pension', categoryHint: 'hotel' },
  ]) {
    try {
      const data = await placesText(`${dq.q} ${pack.name || cityId}`, {
        lat: center.lat,
        lng: center.lng,
        radiusM: Math.min(radiusM, 5000),
      });
      for (const r of (data.results || []).slice(0, 12)) {
        const loc = r.geometry?.location;
        if (!loc) continue;
        addDirectorySpot(
          pack,
          {
            name: r.name,
            lat: loc.lat,
            lng: loc.lng,
            address: r.formatted_address || r.vicinity,
            types: r.types || [],
            category: dq.categoryHint,
          },
          stats,
        );
      }
    } catch {
      /* ignore */
    }
  }

  let research = null;
  const researchPath = path.join(STAEDTE_DIR, `${cityId}.research.json`);
  if (fs.existsSync(researchPath)) {
    research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  }
  const qaN = buildOfflineQa(pack, research);

  // Normalize roles: thin amenities → directory; alles andere → story
  for (const s of pack.spots) {
    if (s.pack_role === 'directory' || Number(s.place_tier) === 4) {
      s.pack_role = 'directory';
      s.place_tier = s.place_tier || 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'directory',
          'tier4',
          'offline_lookup',
          'amenity_skip',
        ]),
      ];
      continue;
    }
    if (
      !s.pack_role &&
      /^(restaurant|cafe|hotel|supermarket|apotheke|gesundheit|tankstelle)$/i.test(
        s.category || '',
      )
    ) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      if ((t?.general_info || '').length < 80) {
        s.pack_role = 'directory';
        s.place_tier = s.place_tier || 4;
        s.tags = [
          ...new Set([
            ...(s.tags || []),
            'directory',
            'tier4',
            'offline_lookup',
            'amenity_skip',
          ]),
        ];
        continue;
      }
    }
    if (!s.pack_role) s.pack_role = 'story';
    if (s.place_tier == null) s.place_tier = 2;
    s.tags = [
      ...new Set([...(s.tags || []), 'module1', `tier${s.place_tier}`]),
    ];
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: qaN,
    note: 'UI: Gesamtzahl zeigen; Trigger nur Story Tier 1–2 (+ selektiv 3).',
  };

  const gate = runQualityGate(pack, { strict: false });
  writeJson(path.join(STAEDTE_DIR, `${cityId}.directory_report.json`), {
    stats,
    pack_index: pack._pack_index,
    gate,
  });
  console.log(
    `[dir] added=${stats.added} extras=${stats.extras} near=${stats.skippedNear} dup=${stats.skippedDup} total=${pack.spots.length} story=${pack._pack_index.story} directory=${pack._pack_index.directory} qa=${qaN}`,
  );
  console.log(
    `[dir] gate ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[dir] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
