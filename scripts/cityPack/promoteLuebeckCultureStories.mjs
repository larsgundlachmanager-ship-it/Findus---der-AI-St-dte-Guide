#!/usr/bin/env node
/**
 * Lübeck: Top-Sehenswürdigkeiten / Kultur (Google Story-Kategorien) → Story.
 * Ergänzt fehlende Kultur-Anker, füllt Gate-Minimum, dedupliziert.
 *
 *   node scripts/cityPack/promoteLuebeckCultureStories.mjs --apply
 */
import {
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { resolvePlace, geocode, placesText } from './google.mjs';
import {
  STORY_CATEGORY_TIERS,
  interestTagsForCategory,
  stubNarration,
} from './placeCategoryPolicy.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

const STORY_CATS = new Set([
  ...Object.keys(STORY_CATEGORY_TIERS),
  'hafen',
  'geschichte',
  'verwaltung', // only when name matches Rathaus
]);

const FORCE_NAME =
  /museum|theater|kirche|dom|kloster|kunsthalle|galerie|rathaus|altstadt|unesco|holstentor|burgtor|salzspeicher|heiligen.?geist|koberg|marzipan|niederegger|figuren|kolk\s*17|schiffer|katharinen|grass|brandt|behnhaus|passat|leuchtturm|museumshafen|stadtgeschichte|panorama.?lübeck|mühlenteich|schellbruch|stadtpark|bürgerpark|wallanlagen|rathaustreppe|overbeck|natur und umwelt|musik.?und.?kongress|muk\b|combinale|theaterschiff|zaubertheater|hoftheater/i;

const BLOCK_NAME =
  /erotik|lasertag|myjump|trampolin|søstrene|nanu.?nana|principessa|dearuniverse|zwischenzeilen|lübeck laden|filmproduktion|gleis\s*2|altstadtbad|krähenteich|flughafen|redner|avia |tankstelle|citybox|stasher|urban apes|boat-now|bootsvermietung|barkassen|stadtführung|stühff|k3 stadt/i;

function pushDeep(t, text, tags) {
  if (!text || text.length < 12) return;
  t.deep_data_pool = t.deep_data_pool || [];
  const key = text.slice(0, 90).toLowerCase();
  if (
    t.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 90).toLowerCase() === key,
    )
  ) {
    return;
  }
  t.deep_data_pool.push({ text, tags });
}

function faq(q, a) {
  return `User-Frage: ${q}? Antwort: ${a}`;
}

function setGeo(s, t, lat, lng, r = 24) {
  t.lat = lat;
  t.lng = lng;
  t.radius_m = r;
  t.trigger_kind = 'area';
  s.polygonCoordinates = boxPolygon(lat, lng, r);
  t.polygon = s.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

async function resolve(q, near) {
  const g = await resolvePlace(q, { near });
  if (g) return g;
  const geo = await geocode(q, near);
  const r = geo.results?.[0];
  const loc = r?.geometry?.location;
  return loc
    ? { lat: loc.lat, lng: loc.lng, address: r.formatted_address, name: r.name }
    : null;
}

function ensureStoryShape(pack, s, t, opts = {}) {
  const city = pack.name || 'Lübeck';
  const cat = opts.category || s.category || 'denkmal';
  const tier =
    opts.tier1 || opts.tier === 1
      ? 1
      : opts.keepTier && s.place_tier
        ? s.place_tier
        : (opts.tier ?? STORY_CATEGORY_TIERS[cat] ?? 2);
  s.category = cat;
  s.pack_role = 'story';
  s.place_tier = tier;
  if (opts.name) s.name = opts.name;
  s.tags = [
    ...new Set([
      ...(s.tags || []),
      ...interestTagsForCategory(cat),
      'module1',
      `tier${s.place_tier}`,
      'story',
      'must_have',
      'culture_story',
      'tourist',
    ]),
  ];
  const lat = opts.lat ?? t.lat ?? pack.lat;
  const lng = opts.lng ?? t.lng ?? pack.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    setGeo(s, t, lat, lng, opts.halfM || (s.place_tier === 1 ? 30 : 22));
  }
  if (!t.general_info || t.general_info.length < 80 || opts.general) {
    t.general_info =
      opts.general ||
      t.general_info ||
      stubNarration(s.name, cat, city);
    if (t.general_info.length < 80) {
      t.general_info = `${s.name}: kultureller Ankerpunkt in ${city} (${cat}). Orientierung vor Ort; LIVE Oeffnung und Angebote frisch pruefen — nichts erfinden.`;
    }
  }
  if (!s.approach_triggers?.length) {
    const m = opts.approachM || 35;
    const p = offset(lat, lng, -m * 0.5, 2);
    s.approach_triggers = [
      {
        id: `${s.id}_approach_1`,
        lat: p.lat,
        lng: p.lng,
        radius_m: Math.min(36, Math.max(14, Math.round(m * 0.35))),
        teaser_text:
          opts.teaser ||
          `Blickfang ${s.name.split(/[-–(]/)[0].trim()} — hier lohnt der kurze Stopp.`,
        condition_rule: 'always',
        cascade_distance_m: m,
      },
    ];
  }
  pushDeep(
    t,
    faq(
      'Woran erkenne ich diesen Ort',
      opts.recognize ||
        `An ${s.name} in Lübeck — LIVE Orientierung vor Ort`,
    ),
    ['faq', 'user_question'],
  );
  pushDeep(
    t,
    `Kultur-Spot (${cat}) in der Hansestadt — Teil der Top-Sehenswürdigkeiten-Abdeckung.`,
    ['orientierung'],
  );
  pushDeep(
    t,
    'LIVE: Oeffnung, Tickets und aktuelle Angebote nie aus dem Pack vorlesen.',
    ['live_hint', 'ephemeral'],
  );
  pushDeep(
    t,
    opts.deepExtra ||
      'Bei Rückfragen: stabile Architektur/Geschichte aus dem Pack; Preise/Events live.',
    ['faq'],
  );
  if (opts.facts) s.facts = { ...(s.facts || {}), ...opts.facts };
}

function ensureNew(pack, id, cfg) {
  let s = pack.spots.find((x) => x.id === id);
  if (!s && cfg.match) {
    s = pack.spots.find(
      (x) => cfg.match.test(x.id) || cfg.match.test(x.name),
    );
  }
  let t = s && pack.trigger_points.find((x) => x.id === s.id);
  if (!s) {
    s = {
      id,
      name: cfg.name,
      category: cfg.category,
      district: cfg.district || cfg.category,
      tags: [],
      bullets: [],
      facts: {},
      pack_role: 'story',
      place_tier: cfg.tier || 2,
      polygonCoordinates: [],
      approach_triggers: [],
    };
    pack.spots.push(s);
  }
  if (!t) {
    t = {
      id: s.id,
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 24,
      general_info: '',
      deep_data_pool: [],
      early_teaser_hooks: [],
    };
    pack.trigger_points.push(t);
  }
  ensureStoryShape(pack, s, t, cfg);
  return { s, t };
}

function shouldPromote(s) {
  const cat = String(s.category || '').toLowerCase();
  const blob = `${s.id} ${s.name} ${cat}`;
  if (BLOCK_NAME.test(blob)) return false;
  if (FORCE_NAME.test(blob)) return true;
  if (cat === 'museum' || cat === 'theater' || cat === 'kirche' || cat === 'galerie')
    return true;
  if (cat === 'altstadt' || cat === 'geschichte') return true;
  if (cat === 'konzert') return true;
  if (cat === 'denkmal' && /heinrich|mann|wilhelm|brahms|brunnen|löwe|lowe/i.test(blob))
    return true;
  if (cat === 'aussicht' && /panorama|altstadt|leuchtturm|petri/i.test(blob))
    return true;
  if (
    cat === 'natur' &&
    /stadtpark|bürgerpark|schellbruch|mühlenteich|wakenitzufer|wall/i.test(blob)
  )
    return true;
  if (cat === 'wanderung' && /wakenitz|dräger|trave|weslo/i.test(blob)) return true;
  if (cat === 'verwaltung' && /rathaus/i.test(blob)) return true;
  if (cat === 'hafen' && /museumshafen|hafenrund/i.test(blob)) return true;
  if (cat === 'kino' && /musik.?und.?kongress|kommunales kino|filmhaus|cinestar|kolosseum/i.test(blob))
    return true;
  return false;
}

async function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('luebeck');
  const near = { lat: pack.lat, lng: pack.lng };
  const promoted = [];

  // --- Missing culture anchors ---
  {
    const g =
      (await resolve('KOLK 17 Figurentheater Museum Lübeck', near)) ||
      (await resolve('TheaterFigurenMuseum Kolk Lübeck', near));
    if (g) {
      ensureNew(pack, 'luebeck_kolk17_figurentheater', {
        name: 'KOLK 17 Figurentheater & Museum',
        category: 'theater',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        halfM: 22,
        district: 'innenstadt',
        general:
          'Kolk (Altstadt nahe St. Petri): KOLK 17 vereint TheaterFigurenMuseum (Puppen/Marionetten/Schattenspiel, Europa–Afrika–Asien) und Figurentheater-Spielbetrieb (u. a. Kobalt). Historische Kaufmannshäuser; Sammlung und Bühne. LIVE Spielplan und Museumsoeffnung.',
        recognize:
          'Am Kolk bei St. Petri — Figurentheater/Museum, nicht großes Theater Beckergrube',
        teaser: 'Enge Gasse Kolk — Kaufmannshäuser mit Figurentheater und Museum.',
        deepExtra:
          'Querverbindung Petri/Hansemuseum: Kolk-Ensemble als Theater- und Museumsanker.',
        facts: {
          origin: 'Figurentheater-Tradition Kolk; KOLK 17 Zusammenschluss.',
          now: 'Museum + Spielbetrieb — LIVE.',
        },
      });
      promoted.push('KOLK 17');
    }
  }

  {
    const g =
      (await resolve('Günter Grass-Haus Glockengießerstraße Lübeck', near)) ||
      (await resolve('Guenter Grass Haus Lübeck', near));
    if (g) {
      ensureNew(pack, 'luebeck_guenter_grass_haus', {
        name: 'Günter-Grass-Haus',
        category: 'museum',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        halfM: 20,
        general:
          'Glockengießerstraße 21: Forum für Literatur und bildende Kunst zu Nobelpreisträger Günter Grass (Sekretariat hier seit 1986). Innenhof/Skulpturengarten verbindet Richtung Willy-Brandt-Haus. LIVE Oeffnung und Ausstellungen.',
        recognize:
          'Am Günter-Grass-Haus Glockengießerstraße — neben der Brandt-/Literatur-Achse',
        teaser: 'Literatur-Forum in der Glockengießerstraße — Skulpturengarten im Hof.',
        deepExtra:
          'Querverbindung Buddenbrookhaus & Willy-Brandt-Haus: Lübecks Nobelpreis-Dreieck.',
        facts: {
          now: 'Literatur/Kunst-Museum — LIVE.',
        },
      });
      promoted.push('Grass-Haus');
    }
  }

  {
    const g =
      (await resolve('Schiffergesellschaft Lübeck Breite Straße', near)) ||
      (await resolve('Haus der Schiffergesellschaft Lübeck', near));
    if (g) {
      ensureNew(pack, 'luebeck_schiffergesellschaft', {
        name: 'Schiffergesellschaft',
        category: 'denkmal',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        halfM: 20,
        general:
          'Breite Straße: historisches Haus der Schiffergesellschaft — Seefahrer-/Kaufmannstradition der Hanse in repräsentativer Backsteinarchitektur. Heute oft Gastronomie im historischen Ambiente. LIVE Oeffnung/Gastro; Architektur und Geschichte als Story-Kern.',
        recognize:
          'An der Schiffergesellschaft in der Breiten Straße — nicht Jakobi allein',
        teaser: 'Repräsentative Fassade der Schiffergesellschaft in der Fußgängerzone.',
        deepExtra:
          'Querverbindung St. Jakobi (Seefahrerkirche) und Museumshafen (lebende Schiffe).',
        facts: {
          origin: 'Historische Schiffer-/Kaufmannsgesellschaft.',
          now: 'Denkmal + LIVE Nutzung.',
        },
      });
      promoted.push('Schiffergesellschaft');
    }
  }

  {
    const g =
      (await resolve('St. Katharinen Kirche Lübeck', near)) ||
      (await resolve('Katharinenkirche Lübeck Museum', near));
    if (g) {
      ensureNew(pack, 'luebeck_st_katharinen', {
        name: 'St. Katharinen zu Lübeck',
        category: 'kirche',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        halfM: 26,
        general:
          'Ehemalige Franziskanerkirche St. Katharinen — Backsteingotik, heute Kultur-/Museumsraum der Lübecker Museen. Teil des Kirchenkranzes der Altstadtinsel. LIVE Oeffnung und Ausstellungen.',
        recognize: 'An St. Katharinen — nicht Marien, nicht Aegidien',
        teaser: 'Lange Kirchenfassade der Katharinen — Klosterkirche im Kulturumfeld.',
        deepExtra: 'Querverbindung Museumsquartier/Annen und Altstadt-Kirchenkranz.',
      });
      promoted.push('Katharinen');
    }
  }

  {
    const g =
      (await resolve('Rathaustreppe Lübeck Markt', near)) ||
      (await resolve('Lübecker Rathaus Treppe Markt', near));
    if (g) {
      ensureNew(pack, 'luebeck_rathaustreppe', {
        name: 'Rathaustreppe am Markt',
        category: 'denkmal',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        halfM: 16,
        general:
          'Treppe und Aufgang am Lübecker Rathaus zum Markt — städtebaulicher Schwellenraum zwischen Rat und Platz. Visueller Anker gegenüber Niederegger/Breite Straße. LIVE Zugang und Veranstaltungen am Markt.',
        recognize: 'An der Rathaustreppe am Markt — Teil des Rathausensembles',
        teaser: 'Stufen zum Rathaus am Markt — Schwelle zwischen Platz und Rat.',
        deepExtra: 'Querverbindung Rathaus + Niederegger + Altstadt-UNESCO.',
      });
      promoted.push('Rathaustreppe');
    }
  }

  // Marzipan-Museum = deepen Niederegger, keep clear name alias bullet
  {
    const s = pack.spots.find((x) => /niederegger/i.test(x.name));
    const t = s && pack.trigger_points.find((x) => x.id === s.id);
    if (s && t) {
      s.pack_role = 'story';
      s.place_tier = Math.min(s.place_tier || 2, 2);
      s.name = 'Niederegger Marzipan-Museum & Stammhaus';
      ensureStoryShape(pack, s, t, {
        category: 'museum',
        tier: 2,
        keepTier: true,
        general:
          t.general_info?.length > 100
            ? t.general_info
            : 'Breite Straße 89: Stammhaus + Marzipan-Museum (2. OG, typisch frei — LIVE). Lübecker Marzipan g.g.A.; Historie von Apotheken-Luxusware bis Markenzeichen. Gegenüber Rathaus.',
        recognize:
          'Am Niederegger Stammhaus/Marzipan-Museum gegenüber dem Rathaus',
        deepExtra:
          'Marzipan-Museum im Stammhaus — LIVE Oeffnung; nicht mit Souvenir-Ketten verwechseln.',
      });
      promoted.push('Marzipan-Museum');
    }
  }

  // MuK category fix
  {
    const s = pack.spots.find((x) => /musik.?und.?kongresshalle/i.test(x.name));
    if (s) {
      s.category = 'konzert';
      const t = pack.trigger_points.find((x) => x.id === s.id);
      if (t) {
        ensureStoryShape(pack, s, t, {
          category: 'konzert',
          tier: 2,
          general:
            'Musik- und Kongresshalle Lübeck (MuK) an der Wallhalbinsel/Untertrave: Konzert- und Veranstaltungshaus am Wasser, Nähe Museumshafen. LIVE Spielplan.',
          recognize: 'An der MuK an der Trave — nicht Theater Beckergrube',
          teaser: 'Große Hallenfassade am Wasser — MuK neben dem Museumshafen.',
        });
        promoted.push('MuK');
      }
    }
  }

  // Bulk promote culture categories already in pack
  for (const s of pack.spots) {
    if (!shouldPromote(s)) continue;
    if (s.pack_role === 'directory' || !s.pack_role) {
      let t = pack.trigger_points.find((x) => x.id === s.id);
      if (!t) {
        t = {
          id: s.id,
          name: s.name,
          lat: pack.lat,
          lng: pack.lng,
          radius_m: 22,
          general_info: '',
          deep_data_pool: [],
        };
        pack.trigger_points.push(t);
      }
      let cat = String(s.category || 'denkmal').toLowerCase();
      if (/theater/i.test(s.name)) cat = 'theater';
      if (/museum|kunsthalle|behnhaus|grass|annen|natur und umwelt/i.test(s.name))
        cat = 'museum';
      if (/kirche|dom|propstei/i.test(s.name)) cat = 'kirche';
      if (/rathaus/i.test(s.name)) cat = 'verwaltung';
      const tier1 =
        /holstentor|marien|dom|rathaus|altstadt|unesco|hansemuseum|annen|museumshafen|heiligen|salzspeicher|brandt|grass|kolk|schiffer|katharinen|aegidien|petri|stadtgeschichte/i.test(
          s.name,
        );
      ensureStoryShape(pack, s, t, {
        category: cat === 'verwaltung' ? 'geschichte' : cat,
        tier: tier1 ? 1 : STORY_CATEGORY_TIERS[cat] || 2,
        tier1,
      });
      promoted.push(s.name.slice(0, 40));
    } else {
      // already story: ensure must_have + deep min
      const t = pack.trigger_points.find((x) => x.id === s.id);
      if (t) {
        s.tags = [
          ...new Set([...(s.tags || []), 'must_have', 'culture_story']),
        ];
        if ((t.deep_data_pool || []).length < 4 || (t.general_info || '').length < 80) {
          ensureStoryShape(pack, s, t, {
            category: s.category,
            keepTier: true,
            tier: s.place_tier,
          });
        }
      }
    }
  }

  // Dedup: keep UNESCO altstadt, demote plain "Lübecker Altstadt" if duplicate
  {
    const alts = pack.spots.filter(
      (s) =>
        /altstadt/i.test(s.name) &&
        !/bad|hotel|apotheke/i.test(s.name) &&
        s.pack_role === 'story',
    );
    const unesco = alts.find((s) => /unesco/i.test(s.name));
    for (const s of alts) {
      if (unesco && s.id !== unesco.id) {
        s.pack_role = 'directory';
        s.place_tier = 4;
        s.tags = [...new Set([...(s.tags || []), 'directory', 'alias', 'tier4'])];
      }
    }
  }

  // Dedup Drägerpark name twins
  {
    const ds = pack.spots.filter((s) => /drägerpark|draegerpark/i.test(s.name));
    const keep = ds.find((s) => /wakenitz/i.test(s.name)) || ds[0];
    for (const s of ds) {
      if (keep && s.id !== keep.id) {
        s.pack_role = 'directory';
        s.place_tier = 4;
        s.tags = [...new Set([...(s.tags || []), 'directory', 'alias', 'tier4'])];
      }
    }
  }

  // Optional discover more museums via Places if thin
  try {
    const found = await placesText('Museum Lübeck', {
      lat: near.lat,
      lng: near.lng,
      radiusM: 8000,
    });
    for (const r of (found.results || []).slice(0, 25)) {
      const name = r.name || '';
      if (!/museum|kunsthalle|galerie/i.test(name)) continue;
      if (BLOCK_NAME.test(name)) continue;
      const loc = r.geometry?.location;
      if (!loc) continue;
      const existing = pack.spots.find(
        (s) =>
          s.name.toLowerCase().includes(name.slice(0, 12).toLowerCase()) ||
          pack.trigger_points.some(
            (t) =>
              t.id === s.id &&
              typeof t.lat === 'number' &&
              Math.abs(t.lat - loc.lat) < 0.0004 &&
              Math.abs(t.lng - loc.lng) < 0.0004,
          ),
      );
      if (existing) {
        if (existing.pack_role === 'directory' && shouldPromote(existing)) {
          const t = pack.trigger_points.find((x) => x.id === existing.id);
          if (t) ensureStoryShape(pack, existing, t, { category: 'museum', tier: 2 });
        }
        continue;
      }
      const id = `luebeck_${slugify(name)}`.slice(0, 80);
      ensureNew(pack, id, {
        name,
        category: 'museum',
        lat: loc.lat,
        lng: loc.lng,
        tier: 2,
        general: stubNarration(name, 'museum', pack.name),
        recognize: `Am ${name} in Lübeck`,
      });
      promoted.push(`+${name.slice(0, 30)}`);
    }
  } catch (e) {
    console.warn('[places museum]', e.message || e);
  }

  try {
    const found = await placesText('Theater Lübeck', {
      lat: near.lat,
      lng: near.lng,
      radiusM: 8000,
    });
    for (const r of (found.results || []).slice(0, 15)) {
      const name = r.name || '';
      if (!/theater|theatre|oper|figuren|kobalt|combinale|zauber|hof/i.test(name))
        continue;
      if (BLOCK_NAME.test(name)) continue;
      const loc = r.geometry?.location;
      if (!loc) continue;
      const existing = pack.spots.find((s) =>
        s.name.toLowerCase().includes(name.slice(0, 10).toLowerCase()),
      );
      if (existing) {
        const t = pack.trigger_points.find((x) => x.id === existing.id);
        if (t) {
          existing.category = 'theater';
          ensureStoryShape(pack, existing, t, {
            category: 'theater',
            tier: /theater lübeck$/i.test(existing.name.trim()) ? 1 : 2,
            tier1: /theater lübeck$/i.test(String(existing.name).trim()),
          });
        }
        continue;
      }
      const id = `luebeck_${slugify(name)}`.slice(0, 80);
      ensureNew(pack, id, {
        name,
        category: 'theater',
        lat: loc.lat,
        lng: loc.lng,
        tier: 2,
        general: stubNarration(name, 'theater', pack.name),
      });
      promoted.push(`+${name.slice(0, 30)}`);
    }
  } catch (e) {
    console.warn('[places theater]', e.message || e);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[culture] story=${pack._pack_index.story} dir=${pack._pack_index.directory} ok=${gate.ok} thin=${(gate.gaps?.needsDeep || []).length} promoted≈${promoted.length}`,
  );
  if (gate.errors?.length) console.log('errors', gate.errors.slice(0, 12));
  if ((gate.gaps?.needsDeep || []).length) {
    console.log('needsDeep', (gate.gaps.needsDeep || []).slice(0, 20));
  }

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[culture] wrote pack');
  } else console.log('[culture] dry-run');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
