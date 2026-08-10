#!/usr/bin/env node
/**
 * Merge Hechingen hyper-local research into CityPack.
 *
 *   node scripts/cityPack/enrichHechingenFromResearch.mjs --apply
 *
 * Expects data/staedte/hechingen.research.json (orte[] + city_history + infra).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  boxPolygon,
  defaultLiveResearch,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  slugify,
  writeJson,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function stripPrices(text) {
  return String(text || '')
    .replace(/\b\d+[.,]\d{2}\s*€/g, '[Preis live recherchieren]')
    .replace(/\b\d+\s*Euro\b/gi, '[Preis live]')
    .replace(
      /\b(eintritt|zimmer|menü|menu|einzel|tagesticket)\s*:?\s*\d+([.,]\d+)?\s*€?/gi,
      '$1: [live]',
    )
    .trim();
}

function isLiveText(t) {
  return /LIVE:|live_infos|Öffnungszeit|Eintritt|€|Euro|ab \d|Di-Do|Di,|Mo-Sa|Ticket/i.test(
    t,
  );
}

function pushDeep(trigger, text, tags) {
  const clean = stripPrices(text);
  if (!clean || clean.length < 18) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 90);
  if (
    trigger.deep_data_pool.some((e) => {
      const t = typeof e === 'string' ? e : e?.text || '';
      return t.toLowerCase().slice(0, 90) === key;
    })
  ) {
    return;
  }
  const live = isLiveText(clean) || (tags || []).includes('live_hint');
  const finalTags = live
    ? [...new Set([...(tags || []), 'live_hint', 'ephemeral'])]
    : tags || ['master_report'];
  const finalText = live && !/^LIVE:/i.test(clean) ? `LIVE: ${clean}` : clean;
  trigger.deep_data_pool.push({ text: finalText, tags: finalTags });
}

function parseCoords(s) {
  if (!s) return null;
  const m = String(s)
    .replace(/\s+/g, '')
    .match(/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

function categoryFor(name, ortsteil) {
  const n = `${name} ${ortsteil || ''}`.toLowerCase();
  if (/friedhof|jüdisch/.test(n)) return 'denkmal';
  if (/kirche|kloster|kapelle|st\.\s|stifts/.test(n)) return 'kirche';
  if (/museum|villa rustica|römisch|freilicht/.test(n)) return 'museum';
  if (/turm|denkmal|schloss|burg/.test(n)) return 'denkmal';
  if (/park|garten|pfad|schaukel|barfuß|wiese/.test(n)) return 'natur';
  if (/bahnhof/.test(n)) return 'bahnhof';
  if (/rathaus|platz|obertor/.test(n)) return 'verwaltung';
  if (/hofgut|restaurant|domäne/.test(n)) return 'freizeit';
  return 'ort';
}

function matchExisting(pack, name) {
  const key = name.toLowerCase();
  const aliases = [
    [/unterer turm/, /unterer_turm|unterer turm/],
    [/jüdischer friedhof/, /jüdischer|judischer|friedhof/],
    [/st\.\s*luzen|klosterkirche/, /luzen/],
    [/freilichtmuseum|villa rustica|römisch/, /freilicht|villa_rust|romisch|römisch/],
    [/obertorplatz|häppy|schaukelweg/, /obertor|happ|schaukel/],
    [/dominikaner|stetten|johannes der täufer/, /stetten|dominikaner|johannes/],
    [/hofgut|domäne|brielho/, /domane|domäne|hofgut|streichel/],
    [/landesmuseum|altes schloss/, /landesmuseum|altes_schloss/],
    [/stiftskirche|jakobus/, /stiftskirche|jakobus/],
    [/fürstengarten|eugenia/, /furstengarten|fürstengarten|eugenia/],
    [/bahnhof hechingen/, /bahnhof_hechingen$/],
    [/burg hohenzollern/, /burg_hohenzollern$/],
  ];
  for (const [rxName, rxId] of aliases) {
    if (rxName.test(key)) {
      const hit = pack.spots.find(
        (s) => rxId.test(s.id) || rxId.test((s.name || '').toLowerCase()),
      );
      if (hit) return hit;
    }
  }
  return (
    pack.spots.find((s) => (s.name || '').toLowerCase() === key) ||
    pack.spots.find(
      (s) =>
        (s.name || '').toLowerCase().includes(key.slice(0, 18)) ||
        key.includes((s.name || '').toLowerCase().slice(0, 18)),
    )
  );
}

function ensureSpot(pack, name, category, geo) {
  let spot = matchExisting(pack, name);
  const id =
    spot?.id || `${pack.city_id}_${slugify(name)}`.slice(0, 80);
  if (!spot) {
    spot = {
      id,
      name,
      category,
      district: category,
      tags: [category, 'module1', 'master_report'],
      bullets: [],
      facts: { tags: [category] },
      polygonCoordinates: boxPolygon(geo.lat, geo.lng, 26),
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
  }
  let trigger = pack.trigger_points.find((t) => t.id === spot.id);
  if (!trigger) {
    trigger = {
      id: spot.id,
      name,
      lat: geo.lat,
      lng: geo.lng,
      radius_m: 26,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  return { spot, trigger };
}

function applyOrt(pack, ort, stats) {
  const geo = parseCoords(ort.koordinaten);
  if (!geo) {
    stats.skipped.push(ort.spot_name);
    return;
  }
  const category = categoryFor(ort.spot_name, ort.ortsteil);
  const { spot, trigger } = ensureSpot(pack, ort.spot_name, category, geo);
  stats.updated.add(spot.id);

  spot.name = ort.spot_name;
  spot.category = category;
  spot.district = ort.ortsteil || category;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      category,
      'module1',
      'master_report',
      'deep_research_merged',
      'visual_anchor',
    ]),
  ];

  const facts = ort.historische_fakten || [];
  spot.facts = {
    ...(spot.facts || {}),
    origin: facts[0] || spot.facts?.origin,
    architecture: facts[1] || spot.facts?.architecture,
    now: ort.adresse
      ? `Adresse: ${ort.adresse}.`
      : spot.facts?.now,
    tags: spot.tags,
  };
  spot.bullets = [
    ...new Set([
      ...(spot.bullets || []),
      ort.adresse ? `Adresse: ${ort.adresse}.` : null,
      ...(facts.slice(0, 3) || []),
    ].filter(Boolean)),
  ];

  // Prefer research GPS for new/curated pins; keep existing Google pin if close (<90m)
  const hadGeo =
    typeof trigger.lat === 'number' &&
    typeof trigger.lng === 'number' &&
    !(spot.tags || []).includes('skeleton');
  const distExisting =
    typeof trigger.lat === 'number'
      ? Math.hypot(
          (trigger.lat - geo.lat) * 111320,
          (trigger.lng - geo.lng) * 70000,
        )
      : Infinity;
  const useLat =
    Number.isFinite(distExisting) && distExisting < 90 && typeof trigger.lat === 'number'
      ? trigger.lat
      : geo.lat;
  const useLng =
    Number.isFinite(distExisting) && distExisting < 90 && typeof trigger.lng === 'number'
      ? trigger.lng
      : geo.lng;
  trigger.lat = useLat;
  trigger.lng = useLng;
  geo.lat = useLat;
  geo.lng = useLng;
  spot.polygonCoordinates = boxPolygon(geo.lat, geo.lng, category === 'natur' ? 45 : 26);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';

  const weg = ort.wegweiser_logik || '';
  const storyBits = [...facts, ...(ort.fun_fakts || [])].filter(Boolean);
  trigger.general_info = stripPrices(
    [weg, storyBits[0], storyBits[1]].filter(Boolean).join(' ').slice(0, 900),
  );

  pushDeep(
    trigger,
    `GPS-Eingang / Research-Pin: ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}${ort.adresse ? ` — ${ort.adresse}` : ''}.`,
    ['gps_confirmed', 'orientierung', 'master_report'],
  );
  if (weg) {
    pushDeep(trigger, `Orientierung: ${weg}`, [
      'orientierung',
      'wegweiser',
      'master_report',
    ]);
  }
  for (const f of facts) pushDeep(trigger, f, ['geschichte', 'master_report']);
  for (const f of ort.fun_fakts || []) {
    pushDeep(trigger, f, ['fun', 'geschichte', 'master_report']);
  }
  for (const live of ort.live_infos || []) {
    pushDeep(trigger, live, ['live_hint', 'ephemeral']);
  }
  for (const q of ort.quer_verbindungen || []) {
    pushDeep(trigger, q, ['querverbindung', 'orientierung', 'master_report']);
  }

  // Visual recognition FAQ (required)
  const visualHint =
    (ort.triggerpunkte || []).find((t) => t.distanz_m <= 25)?.text ||
    weg ||
    facts[0];
  if (visualHint) {
    pushDeep(
      trigger,
      `User-Frage: Woran erkenne ich diesen Ort? Antwort: ${stripPrices(visualHint)}`,
      ['faq', 'user_question', 'orientierung', 'visual_anchor', 'master_report'],
    );
  }
  if (facts[0]) {
    pushDeep(
      trigger,
      `User-Frage: Was ist hier historisch besonders? Antwort: ${stripPrices(facts[0])}`,
      ['faq', 'user_question', 'geschichte', 'master_report'],
    );
  }
  if (ort.adresse) {
    pushDeep(
      trigger,
      `User-Frage: Wo genau ist der Eingang / die Adresse? Antwort: ${ort.adresse}.`,
      ['faq', 'user_question', 'orientierung'],
    );
  }

  // Approaches from triggerpunkte
  const tps = ort.triggerpunkte || [];
  if (tps.length) {
    spot.approach_triggers = tps.map((tp, i) => {
      const m = Number(tp.distanz_m) || 40;
      const p = offset(geo.lat, geo.lng, -m * 0.7, i * 6);
      return {
        id: `${spot.id}_approach_${i + 1}`,
        lat: p.lat,
        lng: p.lng,
        radius_m: Math.min(40, Math.max(10, Math.round(m * 0.4))),
        teaser_text: stripPrices(tp.text || ''),
        condition_rule: 'always',
        view_context: tp.view_context || null,
        research_distance_m: m,
      };
    });
  } else {
    const a = offset(geo.lat, geo.lng, 40, 0);
    const b = offset(geo.lat, geo.lng, -22, 12);
    spot.approach_triggers = [
      {
        id: `${spot.id}_approach_far`,
        lat: a.lat,
        lng: a.lng,
        radius_m: 34,
        teaser_text: `Du näherst dich ${spot.name} — schau nach dem markanten Bau / Eingang.`,
        condition_rule: 'always',
      },
      {
        id: `${spot.id}_approach_near`,
        lat: b.lat,
        lng: b.lng,
        radius_m: 16,
        teaser_text: `Gleich da: ${spot.name}.`,
        condition_rule: 'always',
      },
    ];
  }

  spot.sub_pois = [
    {
      id: `${spot.id}_sub_eingang`,
      name: `${spot.name} · Zugang`,
      lat: geo.lat,
      lng: geo.lng,
      radius_m: 10,
      fact_details: ort.adresse || 'Haupteingang / Research-Pin',
      tags: ['eingang', 'gps_entrance'],
    },
  ];
}

function applyCityHistory(pack, text, facts, stats) {
  const clean = stripPrices(text);
  if (!clean || clean.length < 40) return;
  const id = `${pack.city_id}_stadtgeschichte`;
  let spot = pack.spots.find((s) => s.id === id);
  if (!spot) {
    spot = {
      id,
      name: `Geschichte von ${pack.name || 'Hechingen'}`,
      category: 'geschichte',
      district: 'meta',
      tags: ['geschichte', 'city_welcome', 'module1', 'master_report'],
      bullets: (facts || []).slice(0, 5),
      facts: {
        origin: clean.slice(0, 280),
        tags: ['geschichte', 'city_welcome'],
      },
      polygonCoordinates: boxPolygon(pack.lat, pack.lng, 40),
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
    pack.trigger_points.push({
      id,
      name: spot.name,
      lat: pack.lat,
      lng: pack.lng,
      radius_m: 50,
      general_info: clean.slice(0, 900),
      deep_data_pool: [],
    });
    stats.created += 1;
  }
  const trigger = pack.trigger_points.find((t) => t.id === id);
  trigger.general_info = clean.slice(0, 900);
  pushDeep(trigger, clean, ['geschichte', 'heute', 'master_report']);
  for (const f of facts || []) {
    pushDeep(trigger, f, ['geschichte', 'master_report']);
  }
  pushDeep(
    trigger,
    'User-Frage: Woran erkenne ich Hechingen als Zollernstadt? Antwort: Die Burg Hohenzollern thront als Wahrzeichen über der Stadt; innen markiert der Untere Turm an der Staig das historische Gefälle der Altstadt.',
    ['faq', 'user_question', 'visual_anchor', 'orientierung'],
  );
  stats.updated.add(id);
}

function applyInfra(pack, infra, stats) {
  // Soft infra facts attached to bahnhof / rathaus / city history
  const bahnhof =
    pack.spots.find((s) => s.id === 'hechingen_bahnhof_hechingen') ||
    pack.spots.find((s) => /bahnhof/i.test(s.name) && s.category === 'bahnhof');
  const rathaus =
    pack.spots.find((s) => /rathaus/i.test(s.name)) ||
    pack.spots.find((s) => s.id.includes('obertor'));

  const attach = (spot, items, tags) => {
    if (!spot) return;
    const t = pack.trigger_points.find((x) => x.id === spot.id);
    if (!t) return;
    for (const item of items) pushDeep(t, item, tags);
    stats.updated.add(spot.id);
  };

  if (infra.transit?.length) {
    pack._transit = pack._transit || { notes: [], lines: [] };
    pack._transit.notes = [
      ...new Set([...(pack._transit.notes || []), ...infra.transit]),
    ];
    attach(bahnhof, infra.transit, ['transport', 'master_report']);
  }
  if (infra.bahnhof?.length) {
    attach(bahnhof, infra.bahnhof, ['transport', 'orientierung', 'master_report']);
  }
  if (infra.service?.length) {
    attach(
      rathaus || bahnhof,
      infra.service,
      ['service', 'orientierung', 'master_report'],
    );
  }
  if (infra.live?.length) {
    for (const item of infra.live) {
      attach(bahnhof || rathaus, [item], ['live_hint', 'ephemeral']);
    }
  }
}

async function main() {
  const researchPath = path.join(STAEDTE_DIR, 'hechingen.research.json');
  if (!fs.existsSync(researchPath)) {
    throw new Error(`Missing ${researchPath}`);
  }
  const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  const pack = loadPack('hechingen');
  if (!pack) throw new Error('hechingen pack missing — run city:skeleton first');

  pack.name = 'Zollernstadt Hechingen';
  pack.symbol = pack.symbol || '🏰';
  if (!pack._live_research?.length) {
    pack._live_research = defaultLiveResearch(pack.name);
  }
  // Extra live prompts from report themes
  const extraLive = [
    {
      id: 'hechingen_live_museum_hours',
      label: 'Museum/Öffnungszeiten',
      prompt: `LIVE: Aktuelle Öffnungszeiten Hohenzollerisches Landesmuseum und Römisches Freilichtmuseum Hechingen-Stein recherchieren (keine Pack-Zeiten vorlesen).`,
      tags: ['live', 'museum', 'hours'],
    },
    {
      id: 'hechingen_live_tickets',
      label: 'Tickets/Führungen',
      prompt: `LIVE: Stadtführungen (z. B. „Blaues Blut“), Burg Hohenzollern Tickets und Domäne-Events aktuell suchen.`,
      tags: ['live', 'tickets', 'events'],
    },
    {
      id: 'hechingen_live_naldo',
      label: 'NALDO/ÖPNV',
      prompt: `LIVE: Aktuelle NALDO-Tarife und Abfahrten Bahnhof Hechingen / Zollern-Alb-Bahn — nie Pack-Preise.`,
      tags: ['live', 'transit'],
    },
  ];
  const liveIds = new Set(pack._live_research.map((x) => x.id));
  for (const e of extraLive) {
    if (!liveIds.has(e.id)) pack._live_research.push(e);
  }

  const stats = { updated: new Set(), created: 0, skipped: [] };

  applyCityHistory(
    pack,
    research.city_history || '',
    research.nicht_ortsspezifische_fakten || [],
    stats,
  );

  for (const ort of research.orte || []) {
    applyOrt(pack, ort, stats);
  }

  applyInfra(pack, research.infra || {}, stats);

  // Ensure Burg Hohenzollern category
  const burg = pack.spots.find((s) => s.id === 'hechingen_burg_hohenzollern');
  if (burg) {
    burg.category = 'denkmal';
    burg.tags = [
      ...new Set([...(burg.tags || []), 'denkmal', 'must_have', 'schloss']),
    ];
  }

  const gate = runQualityGate(pack, { strict: false });
  writeJson(path.join(STAEDTE_DIR, 'hechingen.enrich_report.json'), {
    updated: [...stats.updated],
    created: stats.created,
    skipped: stats.skipped,
    gate,
  });

  console.log(
    `[hechingen] updated=${stats.updated.size} created=${stats.created} skipped=${stats.skipped.length} spots=${pack.spots.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.gaps?.needsNarration?.length) {
    console.log(
      '[hechingen] still needs narration:',
      gate.gaps.needsNarration.slice(0, 15).join(', '),
    );
  }

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[hechingen] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
