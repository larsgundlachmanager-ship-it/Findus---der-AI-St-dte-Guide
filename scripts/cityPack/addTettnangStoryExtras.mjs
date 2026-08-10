#!/usr/bin/env node
/**
 * Tettnang story extras from user list.
 *   node scripts/cityPack/addTettnangStoryExtras.mjs --apply
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
import { requireGoogleKey, resolvePlace, placesText } from './google.mjs';
import { interestTagsForCategory } from './placeCategoryPolicy.mjs';
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

function ensure(pack, id, cfg) {
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    spot = {
      id,
      name: cfg.name,
      category: cfg.category,
      district: cfg.category,
      tags: [],
      bullets: [],
      facts: {},
      polygonCoordinates: [],
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
  }
  if (!trigger) {
    trigger = {
      id,
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 24,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  spot.name = cfg.name;
  spot.category = cfg.category;
  spot.pack_role = 'story';
  spot.place_tier = cfg.tier;
  spot.relevance = cfg.relevance || [];
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      ...interestTagsForCategory(cfg.category),
      'module1',
      'story',
      `tier${cfg.tier}`,
      'master_report',
    ]),
  ];
  trigger.lat = cfg.lat;
  trigger.lng = cfg.lng;
  trigger.radius_m = cfg.halfM || 24;
  spot.polygonCoordinates = boxPolygon(cfg.lat, cfg.lng, cfg.halfM || 24);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  trigger.general_info = cfg.general;
  spot.facts = cfg.facts || spot.facts;
  spot.bullets = cfg.bullets || spot.bullets;
  spot.approach_triggers = (cfg.teasers || []).map((text, i) => {
    const p = offset(cfg.lat, cfg.lng, -(40 - i * 12), i * 3);
    return {
      id: `${id}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: 26,
      teaser_text: text,
      condition_rule: 'always',
    };
  });
  for (const [q, a] of cfg.faqs || []) {
    pushDeep(
      trigger,
      `User-Frage: ${q}? Antwort: ${a}`,
      ['faq', 'user_question'],
    );
  }
  pushDeep(
    trigger,
    'LIVE: Öffnungszeiten und aktuelle Angebote frisch prüfen.',
    ['live_hint', 'ephemeral'],
  );
  pushDeep(
    trigger,
    `GPS: ${cfg.lat.toFixed(6)}, ${cfg.lng.toFixed(6)}.`,
    ['gps_confirmed'],
  );
  return { spot, trigger };
}

async function resolveBest(query, near, nameHint) {
  const g = await resolvePlace(query, { near });
  if (g && (!nameHint || new RegExp(nameHint, 'i').test(g.name))) return g;
  const data = await placesText(query, {
    lat: near.lat,
    lng: near.lng,
    radiusM: 6000,
  });
  const hit = (data.results || []).find((r) =>
    nameHint ? new RegExp(nameHint, 'i').test(r.name) : true,
  );
  if (!hit?.geometry?.location) return g;
  return {
    name: hit.name,
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    address: hit.formatted_address,
  };
}

async function main() {
  requireGoogleKey();
  const pack = loadPack('tettnang');
  if (!pack) throw new Error('tettnang missing');
  const near = { lat: pack.lat, lng: pack.lng };

  const extras = [
    {
      id: 'tettnang_altstadt',
      query: 'Tettnang Altstadt',
      hint: 'altstadt|tettnang',
      name: 'Tettnang Altstadt',
      category: 'altstadt',
      tier: 1,
      general:
        'Die Tettnanger Altstadt bündelt Montfort-Erbe auf kurzem Radius: Torschloss, Gassen, St. Gallus und der Weg zum Neuen Schloss. Kopfstein, Staffelgiebel und Platzfolgen machen den historischen Stadtkern greifbar — Orientierung zu Fuß, nicht ein einzelner Pin.',
      teasers: [
        'Engere Gassen und Staffelgiebel — du bist im historischen Stadtkern von Tettnang.',
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An der verdichteten Altstadt um Torschloss, Kirchstraße und Montfortstraße — nicht am Hopfengut draußen',
        ],
        [
          'Was kann man hier machen',
          'Schlösser, Kirche, Bärenplatz und Gassen zu Fuß verbinden — klassische Stadterkundung',
        ],
      ],
    },
    {
      id: 'tettnang_ehemaliges_schiesshaus',
      query: 'Ehemaliges Schießhaus Tettnang',
      hint: 'schieß|schiess',
      name: 'Ehemaliges Schießhaus',
      category: 'denkmal',
      tier: 2,
      general:
        'Das ehemalige Schießhaus ist ein historisches Gebäude mit Bezug zu Vereins- und Stadtgeschichte — ein Detour für Architektur- und Lokalgeschichte neben den großen Montfort-Adressen. LIVE: heutige Nutzung prüfen.',
      teasers: [
        'Ein historisches Gebäude mit Schießhaus-Vergangenheit zeichnet sich ab.',
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Gebäude, das als ehemaliges Schießhaus ausgewiesen ist — oft abseits der Schlossfassade',
        ],
      ],
    },
    {
      id: 'tettnang_hopfenpfad',
      query: 'Tettnanger Hopfenpfad',
      hint: 'hopfenpfad',
      name: 'Tettnanger Hopfenpfad',
      category: 'wanderung',
      tier: 2,
      halfM: 45,
      general:
        'Der Tettnanger Hopfenpfad ist der Themenweg „vom Brauer zum Bauer“: rund acht Kilometer zwischen Bärenplatz/Kronen-Bezug und Hopfengut N°20 durch Obst- und Hopfenlagen, mit Infotafeln und Panoramen. LIVE: Wegezustand prüfen.',
      teasers: [
        'Wegweisung und Infotafeln des Hopfenpfads — hier startet oder führt der Lehrpfad durch die Hopfenlandschaft.',
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An Hopfenpfad-Beschilderung/Infotafeln und dem Weg in die Hopfenfelder — nicht am Schlossplatz allein',
        ],
        [
          'Wohin führt der Pfad',
          'Zwischen Innenstadt/Bärenplatz und Hopfengut N°20 in Siggenweiler',
        ],
      ],
    },
    {
      id: 'tettnang_dorfweiher_siggenweiler',
      query: 'Dorfweiher Siggenweiler Tettnang',
      hint: 'weiher|siggenweiler',
      name: 'Dorfweiher Siggenweiler',
      category: 'natur',
      tier: 2,
      general:
        'Der Dorfweiher in Siggenweiler ist ein ruhiger Naturpunkt oberhalb der Altstadt — Wasser, Grün und Nähe zu Hopfengärten und Hopfengut. Gut für Pause und Spaziergang statt Schloss-Trubel.',
      teasers: [
        'Ein Weiher mit Grün drumherum — der Dorfweiher Siggenweiler liegt voraus.',
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Wasserbecken/Weiher in Siggenweiler mit Dorf- und Naturumgebung',
        ],
      ],
    },
    {
      id: 'tettnang_paintball_action',
      query: 'Paintball Action Tettnang',
      hint: 'paintball',
      name: 'Paintball Action Tettnang',
      category: 'activity',
      tier: 2,
      general:
        'Paintball Action Tettnang ist ein Action-/Freizeitangebot für Gruppen — kein historisches Must-See, aber ein klarer Detour, wenn der User Action und Outdoor-Spiele sucht. LIVE: Buchung und Öffnung prüfen.',
      teasers: [
        'Ein Paintball-/Action-Gelände zeichnet sich ab — Freizeit statt Schlossbesichtigung.',
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Paintball-/Freizeitgelände mit entsprechender Beschilderung außerhalb der Altstadt',
        ],
      ],
    },
  ];

  // Upgrade Kronenbrunnen to Tier 2 (user asked)
  {
    const br = pack.spots.find((s) => s.id === 'tettnang_kronenbrunnen');
    if (br) {
      br.place_tier = 2;
      br.pack_role = 'story';
      br.tags = [...new Set([...(br.tags || []), 'tier2', 'story', 'wasser'])];
    }
  }
  // Ensure Aussichtspunkt name stays clear
  {
    const a = pack.spots.find((s) => /hopfenpfad/i.test(s.id) && /aussicht/i.test(s.name + s.id));
    if (a) {
      a.place_tier = 2;
      a.pack_role = 'story';
      a.category = 'aussicht';
    }
  }

  for (const ex of extras) {
    const g = await resolveBest(ex.query, near, ex.hint);
    if (!g) {
      console.warn('[extra] not found', ex.name);
      continue;
    }
    ensure(pack, ex.id, {
      name: ex.name,
      category: ex.category,
      lat: g.lat,
      lng: g.lng,
      tier: ex.tier,
      halfM: ex.halfM,
      general: ex.general,
      teasers: ex.teasers,
      faqs: ex.faqs,
      bullets: [g.address ? `Lage: ${g.address}.` : null].filter(Boolean),
      facts: {
        now: g.address || ex.name,
        tags: [ex.category],
      },
      relevance: interestTagsForCategory(ex.category),
    });
    console.log('[extra]', ex.name, g.lat, g.lng);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };
  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[extras] stories=${pack._pack_index.story} dir=${pack._pack_index.directory} ok=${gate.ok} warn=${gate.warnings.length}`,
  );
  if (hasFlag('apply') || !hasFlag('dry')) {
    console.log('[extras] wrote', savePack(pack, { bumpVersion: true }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
