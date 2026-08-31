#!/usr/bin/env node
/**
 * Re-classify spots + discover story/directory categories for a city.
 *
 *   node scripts/cityPack/classifyPackCategories.mjs --city tettnang --apply
 *   node scripts/cityPack/classifyPackCategories.mjs --all --apply
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
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { placesTextAll, requireGoogleKey } from './google.mjs';
import {
  STORY_DISCOVERY_QUERIES,
  defaultRoleAndTier,
  interestTagsForCategory,
  stubNarration,
  suggestedDiscoveryRadius,
  suggestedMinStory,
} from './placeCategoryPolicy.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(trigger, text, tags) {
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = text.slice(0, 70).toLowerCase();
  if (
    trigger.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 70).toLowerCase() === key,
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text, tags });
}

function alreadyNear(pack, lat, lng, meters = 60) {
  for (const spot of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
    if (!t || typeof t.lat !== 'number') continue;
    if (distM({ lat: t.lat, lng: t.lng }, { lat, lng }) < meters) return spot;
  }
  return null;
}

function reclassifyExisting(pack) {
  let promoted = 0;
  let demoted = 0;
  for (const s of pack.spots || []) {
    // Keep explicit master/high tiers
    if (
      s.place_tier === 1 ||
      (s.tags || []).includes('master_report') ||
      (s.tags || []).includes('must_have')
    ) {
      if (!s.pack_role) s.pack_role = 'story';
      continue;
    }
    // Never-trigger noise / practical-only
    if (
      /tourist.?info|touristen.?info|kurverwaltung|parkplatz|parking|wanderparkplatz|weihnachtsbaum|tankstelle/i.test(
        s.name,
      )
    ) {
      const cat = /tourist/i.test(s.name)
        ? 'tourist_info'
        : /parkplatz|parking|wanderparkplatz/i.test(s.name)
          ? 'service'
          : s.category || 'directory';
      s.category = cat;
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'directory',
          'tier4',
          'amenity_skip',
          cat,
        ]),
      ];
      demoted += 1;
      continue;
    }
    // Heuristic category fixes
    if (/aussicht|viewpoint|panorama/i.test(s.name)) s.category = 'aussicht';
    if (/souvenir|andenken/i.test(s.name)) s.category = 'souvenir';
    if (/theater|konzert|oper/i.test(s.name)) s.category = 'theater';
    if (/wander|lehrpfad|hopfenpfad/i.test(s.name)) s.category = 'wanderung';
    if (/radweg|fahrradweg|radroute|fernradweg|veloroute/i.test(s.name)) {
      s.category = 'radweg';
    }
    if (/altstadt|stadtkern/i.test(s.name)) s.category = 'altstadt';
    if (/schießhaus|schiesshaus/i.test(s.name)) s.category = 'denkmal';

    // Name→category for clear amenities (even if old category was wrong)
    if (
      /restaurant|ristorante|pizzeria|gaststätte|gasthof|bistro|imbiss|strandbar/i.test(
        s.name,
      )
    ) {
      s.category = 'restaurant';
    } else if (/café|cafe|eiscafé|eiscafé|eiscafe|bäckerei|baeckerei|bakery/i.test(s.name)) {
      s.category = /bäck|baeck|bakery/i.test(s.name) ? 'bakerei' : 'cafe';
    } else if (/hotel|pension|strandhotel|ferienwohnung/i.test(s.name)) {
      s.category = 'hotel';
    } else if (/apotheke|praxis|zahnarzt|klinik|krankenhaus/i.test(s.name)) {
      s.category = /apotheke/i.test(s.name) ? 'apotheke' : 'gesundheit';
    } else if (/marktkauf|edeka|rewe|aldi|lidl|penny|supermarket/i.test(s.name)) {
      s.category = 'supermarket';
    } else if (/parkhaus|parkplatz|p\+r|taxi /i.test(s.name)) {
      s.category = 'service';
    } else if (/golf|tennis|sportgelände|stadion|vereinsheim/i.test(s.name)) {
      s.category = /golf/i.test(s.name) ? 'golf' : 'sport';
    }

    const forceStory = /altstadt|rathaus|schloss|museum|kirche|aussicht|park|denkmal|schieß|schiess/i.test(
      `${s.name} ${s.category}`,
    );
    const next = defaultRoleAndTier(s.category, { forceStory });
    const t = pack.trigger_points.find((x) => x.id === s.id);
    const protectedStory =
      (s.tags || []).includes('master_report') ||
      (s.tags || []).includes('must_have') ||
      (s.tags || []).includes('deep_research_merged') ||
      (s.tags || []).includes('city_welcome') ||
      s.place_tier === 1;
    // Stub-/Gastro-Narration darf Directory-Kategorien nicht als Story festhalten
    const rich =
      (t?.general_info || '').length >= 80 &&
      next.pack_role === 'story' &&
      !/restaurant|cafe|bakerei|bakery|hotel|supermarket|apotheke|gesundheit|sport|golf|service|toilette|transit|bahnhof|spielplatz|verwaltung/i.test(
        String(s.category || ''),
      );
    if (rich && s.pack_role === 'story' && protectedStory) {
      s.place_tier = Math.min(s.place_tier || next.place_tier, next.place_tier);
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          ...interestTagsForCategory(s.category),
          `tier${s.place_tier}`,
        ]),
      ];
      continue;
    }
    if (next.pack_role === 'story' && s.pack_role === 'directory') promoted += 1;
    if (next.pack_role === 'directory' && s.pack_role === 'story') {
      demoted += 1;
    }
    s.pack_role = next.pack_role;
    s.place_tier = next.place_tier;
    s.tags = [
      ...new Set([
        ...(s.tags || []),
        ...interestTagsForCategory(s.category),
        `tier${s.place_tier}`,
        next.pack_role,
        ...(next.pack_role === 'directory'
          ? ['directory', 'offline_lookup', 'amenity_skip']
          : ['story']),
      ]),
    ];
    if (next.pack_role === 'story' && t && (t.general_info || '').length < 40) {
      t.general_info = stubNarration(s.name, s.category, pack.name);
      pushDeep(
        t,
        `User-Frage: Woran erkenne ich diesen Ort? Antwort: An Beschilderung/Lage von ${s.name} (${s.category}) in ${pack.name}.`,
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        'LIVE: Öffnungszeiten und aktuelle Angebote frisch prüfen.',
        ['live_hint', 'ephemeral'],
      );
      pushDeep(t, `Kategorie ${s.category} — Offline-Pack + optionaler Trigger.`, [
        'meta',
      ]);
      if (!(s.approach_triggers || []).length && typeof t.lat === 'number') {
        const p = offset(t.lat, t.lng, -35, 0);
        s.approach_triggers = [
          {
            id: `${s.id}_approach_1`,
            lat: p.lat,
            lng: p.lng,
            radius_m: 28,
            teaser_text: `${s.name} liegt voraus.`,
            condition_rule: 'always',
          },
        ];
      }
    }
  }
  return { promoted, demoted };
}

async function discoverStoryCategories(pack, radiusM) {
  const center = { lat: pack.lat, lng: pack.lng };
  const stats = { added: 0, near: 0 };
  const perQuery = 20; // lieber zu viele als zu wenige
  for (const dq of STORY_DISCOVERY_QUERIES) {
    const query = `${dq.q} ${pack.name || pack.city_id}`;
    let results = [];
    try {
      const data = await placesTextAll(
        query,
        { lat: center.lat, lng: center.lng, radiusM },
        { maxPages: 1 },
      );
      results = data.results || [];
    } catch (e) {
      console.warn('[classify] fail', query, e.message);
      continue;
    }
    for (const r of results.slice(0, perQuery)) {
      const loc = r.geometry?.location;
      if (!loc) continue;
      if (distM(center, loc) > radiusM + 1500) continue;
      if (alreadyNear(pack, loc.lat, loc.lng, 55)) {
        stats.near += 1;
        continue;
      }
      const category = dq.categoryHint;
      const { pack_role, place_tier } = defaultRoleAndTier(category);
      const id = `${pack.city_id}_${slugify(r.name)}`.slice(0, 80);
      if (pack.spots.some((s) => s.id === id)) continue;
      const half = place_tier === 1 ? 30 : place_tier === 4 ? 14 : 20;
      const spot = {
        id,
        name: r.name,
        category,
        district: category,
        pack_role,
        place_tier,
        relevance: interestTagsForCategory(category),
        tags: [
          ...interestTagsForCategory(category),
          `tier${place_tier}`,
          pack_role,
          'classified',
          ...(pack_role === 'directory'
            ? ['directory', 'offline_lookup', 'amenity_skip']
            : ['story', 'module1']),
        ],
        bullets: [
          r.formatted_address
            ? `Adresse: ${r.formatted_address}.`
            : 'Standort laut Google Maps.',
        ],
        facts: {
          now: r.formatted_address || undefined,
          tags: [category],
        },
        polygonCoordinates: boxPolygon(loc.lat, loc.lng, half),
        approach_triggers:
          pack_role === 'story'
            ? [
                {
                  id: `${id}_a1`,
                  lat: offset(loc.lat, loc.lng, -36, 0).lat,
                  lng: offset(loc.lat, loc.lng, -36, 0).lng,
                  radius_m: 28,
                  teaser_text: `${r.name} liegt voraus.`,
                  condition_rule: 'always',
                },
              ]
            : [],
        sub_pois: [],
      };
      const trigger = {
        id,
        name: r.name,
        lat: loc.lat,
        lng: loc.lng,
        radius_m: half,
        trigger_kind: pack_role === 'story' ? 'area' : 'point',
        general_info:
          pack_role === 'story'
            ? stubNarration(r.name, category, pack.name)
            : `${r.name} — Offline-Katalog (${category}).`,
        deep_data_pool: [
          {
            text: `GPS: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}.`,
            tags: ['gps_confirmed', 'sourced_google'],
          },
          {
            text: `User-Frage: Woran erkenne ich diesen Ort? Antwort: An Lage/Beschilderung von ${r.name}.`,
            tags: ['faq', 'user_question'],
          },
          {
            text: 'LIVE: Öffnungszeiten und aktuelle Angebote frisch prüfen.',
            tags: ['live_hint', 'ephemeral'],
          },
          {
            text: `Kategorie ${category} für Offline-Fragen und optionale Trigger.`,
            tags: ['meta', category],
          },
        ],
      };
      pack.spots.push(spot);
      pack.trigger_points.push(trigger);
      stats.added += 1;
    }
  }
  return stats;
}

function refreshIndex(pack) {
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse Tier 2/3).',
  };
}

async function processCity(cityId, radiusM) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn('[classify] missing', cityId);
    return null;
  }
  const radius = radiusM || suggestedDiscoveryRadius(pack);
  const minStory = suggestedMinStory(pack);
  console.log(`[classify] ${cityId} radius=${radius}m minStory≈${minStory}`);
  const recl = reclassifyExisting(pack);
  refreshIndex(pack);
  const skipDiscover =
    hasFlag('skip-discover') ||
    (!hasFlag('force-discover') && (pack._pack_index?.story || 0) >= minStory);
  let disc = { added: 0, near: 0 };
  if (skipDiscover) {
    console.log(
      `[classify] skip Places discovery (story=${pack._pack_index.story} ≥ ${minStory}; --force-discover zum Erzwingen)`,
    );
  } else {
    disc = await discoverStoryCategories(pack, radius);
    refreshIndex(pack);
  }
  const gate = runQualityGate(pack, { strict: false });
  if (pack._pack_index.story < minStory) {
    console.warn(
      `[classify] WARN story=${pack._pack_index.story} < guidance ${minStory} — Discovery verbreitern / Research-Rückfragen`,
    );
  }
  console.log(
    `[classify] ${cityId} promoted=${recl.promoted} demoted=${recl.demoted} added=${disc.added} near=${disc.near} → ${pack._pack_index.story} stories / ${pack._pack_index.directory} dir ok=${gate.ok}`,
  );
  if (hasFlag('apply') || !hasFlag('dry')) {
    savePack(pack, { bumpVersion: true });
  }
  return pack._pack_index;
}

async function main() {
  requireGoogleKey();
  const radiusM = arg('radius') ? Number(arg('radius')) : 0;
  const cities = [];
  if (hasFlag('all')) {
    for (const f of fs.readdirSync(STAEDTE_DIR)) {
      if (!/^[a-z0-9_]+\.json$/.test(f) || f === 'index.json') continue;
      cities.push(f.replace(/\.json$/, ''));
    }
  } else {
    const id = slugify(arg('city') || '');
    if (!id) {
      console.error(
        'Usage: node scripts/cityPack/classifyPackCategories.mjs --city <id>|--all --apply',
      );
      process.exit(1);
    }
    cities.push(id);
  }
  for (const id of cities) {
    await processCity(id, radiusM);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
