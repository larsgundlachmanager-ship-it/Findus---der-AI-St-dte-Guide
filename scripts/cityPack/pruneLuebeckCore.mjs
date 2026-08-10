#!/usr/bin/env node
/**
 * Deduplicate Lübeck and ensure UNESCO / Hanse core story spots.
 *   node scripts/cityPack/pruneLuebeckCore.mjs --apply
 */
import {
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
} from './lib.mjs';
import { resolvePlace } from './google.mjs';

loadEnvFile();

async function main() {
  const apply = hasFlag('apply');
  const p = loadPack('luebeck');
  const near = { lat: p.lat, lng: p.lng };

  for (const s of p.spots) {
    const b = `${s.id} ${s.name}`;
    if (
      /zaubertheater|hoftheater|altstadtbad|krähenteich|kraehenteich|niendorf/i.test(
        b,
      )
    ) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'tier4', 'amenity_skip']),
      ];
    }
  }

  const hbounds = p.spots.filter(
    (s) =>
      /hauptbahnhof|bahnhof/i.test(s.name) &&
      !/travem|mogel|kücknitz|kucknitz/i.test(s.name),
  );
  let keptBh = false;
  for (const s of hbounds) {
    if (!keptBh && /hauptbahnhof/i.test(s.name)) {
      s.pack_role = 'story';
      s.place_tier = 1;
      s.name = 'Lübeck Hauptbahnhof';
      s.tags = [...new Set([...(s.tags || []), 'story', 'must_have', 'tier1'])];
      keptBh = true;
    } else {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'alias', 'tier4']),
      ];
    }
  }

  const alts = p.spots.filter(
    (s) => /altstadt/i.test(s.name) && !/bad|hotel|apotheke/i.test(s.name),
  );
  let keptAlt = false;
  for (const s of alts) {
    if (
      !keptAlt &&
      /historische altstadt|lübecker altstadt|lubecker altstadt|altstadt lübeck/i.test(
        s.name,
      )
    ) {
      s.pack_role = 'story';
      s.place_tier = 1;
      s.name = 'Lübecker Altstadt · UNESCO';
      keptAlt = true;
    } else if (s.pack_role === 'story') {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'alias', 'tier4']),
      ];
    }
  }

  for (const s of p.spots) {
    if (
      /theater/i.test(s.name) &&
      !/^theater lübeck$/i.test(String(s.name).trim()) &&
      s.pack_role === 'story'
    ) {
      s.pack_role = 'directory';
      s.place_tier = 4;
    }
  }

  async function ensureCore(id, name, query, category, tier) {
    let s =
      p.spots.find((x) => x.id === id) ||
      p.spots.find((x) => new RegExp(name.split(' ')[0], 'i').test(x.name));
    // prefer id match for holstentor etc.
    s = p.spots.find((x) => x.id === id) || s;
    let g = null;
    const tExisting = s && p.trigger_points.find((t) => t.id === s.id);
    if (!s || !tExisting) {
      g = await resolvePlace(query, { near });
      if (!g) {
        console.log('no gps', name);
        return;
      }
    }
    if (!s) {
      s = {
        id,
        name,
        category,
        district: category,
        pack_role: 'story',
        place_tier: tier,
        tags: [category, 'story', 'must_have', `tier${tier}`, 'module1'],
        bullets: [],
        facts: { now: `${name} — Deep Research folgt.` },
        polygonCoordinates: [],
        approach_triggers: [],
        sub_pois: [],
      };
      p.spots.push(s);
    }
    // if found by fuzzy name, normalize id if empty-ish match on holstentor museum
    if (s.id !== id && /holstentor|marien|buddenbrook|heiligen|petri|burgtor|salzspeicher|rathaus/i.test(s.name)) {
      // keep existing id, just upgrade
    } else if (!p.spots.find((x) => x.id === id) && s.id !== id) {
      // already handled
    }
    s.pack_role = 'story';
    s.place_tier = tier;
    s.name = name;
    s.category = category;
    s.tags = [
      ...new Set([
        ...(s.tags || []),
        'story',
        'must_have',
        `tier${tier}`,
        'module1',
      ]),
    ];
    let t = p.trigger_points.find((x) => x.id === s.id);
    if (!t && g) {
      t = {
        id: s.id,
        name,
        lat: g.lat,
        lng: g.lng,
        radius_m: tier === 1 ? 32 : 24,
        general_info: `${name} in Lübeck — LIVE Oeffnung pruefen. Vertiefung folgt Masterbericht.`,
        deep_data_pool: [
          {
            text: `User-Frage: Woran erkenne ich diesen Ort? Antwort: An Lage/Beschilderung von ${name} in der Luebecker Altstadt.`,
            tags: ['faq', 'user_question'],
          },
          {
            text: 'LIVE: Oeffnungszeiten und Tickets frisch pruefen.',
            tags: ['live_hint', 'ephemeral'],
          },
        ],
      };
      p.trigger_points.push(t);
      s.polygonCoordinates = boxPolygon(g.lat, g.lng, t.radius_m);
    }
    console.log('core', s.id, s.name, `T${s.place_tier}`);
  }

  // Upgrade existing Museum Holstentor etc. by name
  const rename = [
    [/holstentor/i, 'Holstentor', 1, 'museum'],
    [/marienkirche|st\.?\s*marien/i, 'Marienkirche Lübeck', 1, 'kirche'],
    [/buddenbrook/i, 'Buddenbrookhaus', 1, 'museum'],
    [/heiligen.?geist/i, 'Heiligen-Geist-Hospital', 1, 'denkmal'],
    [/petrikirche|st\.?\s*petri/i, 'Petrikirche Lübeck', 1, 'kirche'],
    [/burgtor/i, 'Burgtor Lübeck', 2, 'denkmal'],
    [/lübecker dom|dom zu lübeck|dom lübeck/i, 'Lübecker Dom', 1, 'kirche'],
    [/salzspeicher/i, 'Salzspeicher Lübeck', 2, 'denkmal'],
    [/rathaus/i, 'Rathaus Lübeck', 1, 'verwaltung'],
    [/hansemuseum/i, 'Europäisches Hansemuseum', 1, 'museum'],
  ];
  for (const [rx, name, tier, cat] of rename) {
    const s = p.spots.find((x) => rx.test(x.name) || rx.test(x.id));
    if (s) {
      s.pack_role = 'story';
      s.place_tier = tier;
      s.name = name;
      s.category = cat;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'story',
          'must_have',
          `tier${tier}`,
        ]),
      ];
      console.log('upgrade', s.id, name);
    }
  }

  await ensureCore(
    'luebeck_marienkirche',
    'Marienkirche Lübeck',
    'St. Marien zu Lübeck',
    'kirche',
    1,
  );
  await ensureCore(
    'luebeck_buddenbrookhaus',
    'Buddenbrookhaus',
    'Buddenbrookhaus Lübeck',
    'museum',
    1,
  );
  await ensureCore(
    'luebeck_heiligen_geist',
    'Heiligen-Geist-Hospital',
    'Heiligen-Geist-Hospital Lübeck',
    'denkmal',
    1,
  );
  await ensureCore(
    'luebeck_petrikirche',
    'Petrikirche Lübeck',
    'St. Petri Kirche Lübeck',
    'kirche',
    1,
  );
  await ensureCore(
    'luebeck_burgtor',
    'Burgtor Lübeck',
    'Burgtor Lübeck',
    'denkmal',
    2,
  );
  await ensureCore(
    'luebeck_rathaus',
    'Rathaus Lübeck',
    'Rathaus Lübeck Markt',
    'verwaltung',
    1,
  );
  await ensureCore(
    'luebeck_salzspeicher',
    'Salzspeicher Lübeck',
    'Salzspeicher Lübeck',
    'denkmal',
    2,
  );

  p._city_history =
    p._city_history ||
    'Lübeck, die Königin der Hanse, liegt an der Trave und ist als UNESCO-Welterbe (Altstadt) berühmt. Prägend: Holstentor, Kirchenkranz (Marien, Dom, Petri), Rathaus, Kaufmannshäuser und Buddenbrook-Literaturerbe. Vertiefende Meisterdaten folgen dem Gemini-Masterbericht.';

  p._pack_index = {
    total: p.spots.length,
    story: p.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: p.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (p._offline_qa || []).length,
  };

  console.log('final', p._pack_index);
  console.log(
    p.spots
      .filter((s) => s.pack_role !== 'directory')
      .map((s) => `T${s.place_tier} ${s.name}`)
      .join('\n'),
  );

  if (apply) {
    savePack(p, { bumpVersion: true });
    console.log('wrote luebeck');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
