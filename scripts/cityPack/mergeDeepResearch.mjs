#!/usr/bin/env node
/**
 * Merge Google Deep Research (markdown/text/JSON) into a CityPack.
 *
 * Preferred structured JSON sidecar:
 * {
 *   "spots": [{
 *     "id": "optional_or_match_by_name",
 *     "name": "Café Pudding",
 *     "general_info": "...",
 *     "facts": { "origin": "...", "architecture": "...", "now": "..." },
 *     "bullets": ["..."],
 *     "deep_data_pool": [{ "text": "...", "tags": ["geschichte"] }],
 *     "faqs": [{ "q": "...", "a": "..." }]
 *   }],
 *   "city_history": "...",
 *   "links": [{ "id": "...", "title": "...", "url": "..." }],
 *   "new_places": [{ "name": "...", "category": "natur", "lat": 0, "lng": 0, ... }]
 * }
 *
 * Markdown fallback: sections headed by ## Place Name
 *
 * Usage:
 *   node scripts/cityPack/mergeDeepResearch.mjs --city wangerooge --file report.json
 *   node scripts/cityPack/mergeDeepResearch.mjs --city prisdorf --file research.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  STAEDTE_DIR,
  arg,
  boxPolygon,
  defaultLiveResearch,
  loadPack,
  savePack,
  slugify,
  writeJson,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

function stripPrices(text) {
  return String(text || '')
    .replace(/\b\d+[.,]\d{2}\s*€/g, '[Preis live recherchieren]')
    .replace(/\b(eintritt|zimmer|menü|menu)\s*:?\s*\d+([.,]\d+)?\s*€?/gi, '$1: [live]')
    .trim();
}

function findSpot(pack, id, name) {
  if (id) {
    const s = pack.spots.find((x) => x.id === id);
    if (s) return s;
  }
  if (!name) return null;
  const key = name.trim().toLowerCase();
  const exact = pack.spots.find((x) => (x.name || '').trim().toLowerCase() === key);
  if (exact) return exact;
  // Avoid false positives: "Fischküche Laboe" must NOT match placeholder "LABOE"
  // via key.includes(spotName) when the spot name is a short city token.
  const cityToken = String(pack.city_id || pack.name || '')
    .trim()
    .toLowerCase();
  return pack.spots.find((x) => {
    const n = (x.name || '').trim().toLowerCase();
    if (!n || n.length < 4) return false;
    if (cityToken && (n === cityToken || n === cityToken.replace(/oe/g, 'ö'))) return false;
    if (n.includes(key) || key.includes(n)) {
      // Require substantial overlap: shorter name must be ≥60% of longer
      const shorter = n.length <= key.length ? n : key;
      const longer = n.length <= key.length ? key : n;
      if (shorter.length < 8 && longer !== shorter && !longer.startsWith(shorter + ' ')) {
        return false;
      }
      return true;
    }
    return false;
  });
}

function ensureTrigger(pack, spot) {
  let t = (pack.trigger_points || []).find((x) => x.id === spot.id);
  if (!t) {
    t = {
      id: spot.id,
      name: spot.name,
      lat: pack.lat,
      lng: pack.lng,
      radius_m: 30,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push(t);
  }
  return t;
}

function pushDeep(trigger, text, tags) {
  const clean = stripPrices(text);
  if (!clean || clean.length < 20) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 80);
  if (
    trigger.deep_data_pool.some((e) => {
      const t = typeof e === 'string' ? e : e?.text || '';
      return t.toLowerCase().slice(0, 80) === key;
    })
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text: clean, tags: tags || ['master_report'] });
}

function applySpotPayload(pack, payload, stats) {
  let spot = findSpot(pack, payload.id, payload.name);
  if (!spot && payload.name && (payload.lat || payload.lng)) {
    const id =
      payload.id ||
      `${pack.city_id}_${slugify(payload.name)}`.slice(0, 80);
    spot = {
      id,
      name: payload.name,
      category: payload.category || 'ort',
      district: payload.district || payload.category || 'ort',
      tags: ['module1', 'from_deep_research'],
      bullets: [],
      facts: { tags: ['from_deep_research'] },
      polygonCoordinates: boxPolygon(payload.lat, payload.lng, 22),
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
    pack.trigger_points.push({
      id,
      name: payload.name,
      lat: payload.lat,
      lng: payload.lng,
      radius_m: 22,
      general_info: '',
      deep_data_pool: [],
    });
    stats.created += 1;
  }
  if (!spot) {
    stats.unmatched.push(payload.id || payload.name || '?');
    return;
  }

  const trigger = ensureTrigger(pack, spot);
  stats.updated.add(spot.id);

  if (typeof payload.lat === 'number' && typeof payload.lng === 'number') {
    trigger.lat = payload.lat;
    trigger.lng = payload.lng;
  }

  if (payload.general_info) {
    trigger.general_info = stripPrices(payload.general_info);
  }
  if (payload.facts) {
    spot.facts = { ...(spot.facts || {}), ...payload.facts };
    for (const k of ['origin', 'architecture', 'now', 'famousPersonConnected']) {
      if (spot.facts[k]) spot.facts[k] = stripPrices(spot.facts[k]);
    }
  }
  if (Array.isArray(payload.bullets)) {
    const bullets = payload.bullets.map(stripPrices).filter(Boolean);
    const set = new Set([...(spot.bullets || []), ...bullets]);
    spot.bullets = [...set];
  }
  if (Array.isArray(payload.deep_data_pool)) {
    for (const e of payload.deep_data_pool) {
      if (typeof e === 'string') pushDeep(trigger, e, ['master_report']);
      else pushDeep(trigger, e.text, e.tags || ['master_report']);
    }
  }
  if (Array.isArray(payload.faqs)) {
    for (const f of payload.faqs) {
      const q = f.q || f.question;
      const a = f.a || f.answer;
      if (!q || !a) continue;
      pushDeep(
        trigger,
        `User-Frage: ${stripPrices(q)} Antwort: ${stripPrices(a)}`,
        ['faq', 'user_question', 'tiefenwissen', 'master_report'],
      );
    }
  }
  if (payload.category) spot.category = payload.category;
  if (payload.place_tier != null) spot.place_tier = payload.place_tier;
  if (payload.pack_role) spot.pack_role = payload.pack_role;
  const extraTags = [
    'deep_research_merged',
    ...(Array.isArray(payload.tags) ? payload.tags : []),
  ]
    .map((t) => String(t || '').toLowerCase().trim())
    .filter(Boolean);
  spot.tags = [...new Set([...(spot.tags || []), ...extraTags])];
  if (extraTags.length) {
    spot.facts = spot.facts || {};
    spot.facts.tags = [...new Set([...(spot.facts.tags || []), ...extraTags])];
  }
}

function parseMarkdown(text) {
  const spots = [];
  const parts = String(text).split(/\n(?=##\s+)/);
  let city_history = '';
  for (const part of parts) {
    const m = part.match(/^##\s+(.+)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const body = m[2].trim();
    if (/stadtgeschichte|city history|historie der stadt/i.test(title)) {
      city_history = body;
      continue;
    }
    if (/master prompt|lücken|warnings|errors|pack-status|live-research|spot-übersicht/i.test(title)) {
      continue;
    }
    const faqs = [];
    const faqRe =
      /(?:User-Frage|Frage)\s*:\s*(.+?)\s*(?:Antwort)\s*:\s*(.+?)(?=(?:User-Frage|Frage)\s*:|$)/gis;
    let fm;
    while ((fm = faqRe.exec(body))) {
      faqs.push({ q: fm[1].trim(), a: fm[2].trim() });
    }
    // First paragraph as general_info if long enough
    const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const general_info = paras.find((p) => p.length >= 80 && !/^User-Frage/i.test(p)) || '';
    const deep = paras
      .filter((p) => p !== general_info && !/^User-Frage/i.test(p))
      .map((text) => ({ text, tags: ['master_report'] }));
    spots.push({
      name: title.replace(/^Ort:\s*/i, '').trim(),
      general_info,
      deep_data_pool: deep,
      faqs,
    });
  }
  return { spots, city_history };
}

function applyCityHistory(pack, text, stats) {
  const clean = stripPrices(text);
  if (!clean || clean.length < 40) return;
  // Attach to a synthetic city history spot or first transport/meta
  let spot = pack.spots.find((s) => /city_history|stadtgeschichte/i.test(s.id || ''));
  if (!spot) {
    const id = `${pack.city_id}_stadtgeschichte`;
    spot = {
      id,
      name: `Geschichte von ${pack.name || pack.city_id}`,
      category: 'geschichte',
      district: 'meta',
      tags: ['geschichte', 'city_welcome', 'module1'],
      bullets: [],
      facts: {
        origin: clean.slice(0, 280),
        tags: ['geschichte', 'city_welcome'],
      },
      polygonCoordinates: boxPolygon(pack.lat, pack.lng, 30),
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
    pack.trigger_points.push({
      id,
      name: spot.name,
      lat: pack.lat,
      lng: pack.lng,
      radius_m: 40,
      general_info: clean.slice(0, 900),
      deep_data_pool: [
        { text: clean, tags: ['geschichte', 'heute', 'master_report'] },
      ],
    });
    stats.created += 1;
  } else {
    const t = ensureTrigger(pack, spot);
    t.general_info = clean.slice(0, 900);
    pushDeep(t, clean, ['geschichte', 'heute', 'master_report']);
    stats.updated.add(spot.id);
  }
}

function main() {
  const cityId = arg('city');
  const file = arg('file');
  if (!cityId || !file) {
    console.error(
      'Usage: node scripts/cityPack/mergeDeepResearch.mjs --city <id> --file <report.json|md>',
    );
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Missing file: ${abs}`);

  const raw = fs.readFileSync(abs, 'utf8');
  let payload;
  if (abs.endsWith('.json')) {
    payload = JSON.parse(raw);
  } else {
    payload = parseMarkdown(raw);
  }

  const stats = { updated: new Set(), created: 0, unmatched: [], links: 0 };

  if (!pack._live_research?.length) {
    pack._live_research = defaultLiveResearch(pack.name || cityId);
  }

  if (payload.city_history) {
    applyCityHistory(pack, payload.city_history, stats);
  }

  for (const s of payload.spots || []) {
    applySpotPayload(pack, s, stats);
  }
  for (const s of payload.new_places || []) {
    applySpotPayload(pack, s, stats);
  }

  if (Array.isArray(payload.links)) {
    pack._links = pack._links || [];
    for (const link of payload.links) {
      if (!link?.url) continue;
      pack._links = pack._links.filter((l) => l.url !== link.url && l.id !== link.id);
      pack._links.push(link);
      stats.links += 1;
    }
  }

  if (Array.isArray(payload.live_research)) {
    pack._live_research = payload.live_research;
  }

  const out = savePack(pack, { bumpVersion: true });
  const wiki = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'cityPack', 'expandStoryWiki.mjs'),
      '--city',
      cityId,
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (wiki.status !== 0) {
    console.warn(
      `[merge] wiki-depth failed (exit ${wiki.status}) — Pack bleibt gemerged`,
    );
  }
  const loop = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'cityPack', 'gpsWegweiserLoop.mjs'),
      '--city',
      cityId,
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (loop.status !== 0) {
    console.warn(
      `[merge] gps-wegweiser loop failed (exit ${loop.status}) — Pack bleibt gemerged`,
    );
  }
  const facets = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'cityPack', 'enrichReviewFacets.mjs'),
      '--city',
      cityId,
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (facets.status !== 0) {
    console.warn(
      `[merge] review-facets failed (exit ${facets.status}) — Pack bleibt gemerged`,
    );
  }
  const gate = runQualityGate(loadPack(cityId) || pack, { strict: false });
  const report = {
    city_id: cityId,
    source: abs,
    updated: [...stats.updated],
    created: stats.created,
    unmatched: stats.unmatched,
    links: stats.links,
    gate,
  };
  writeJson(path.join(STAEDTE_DIR, `${cityId}.merge_report.json`), report);
  console.log(`[merge] ${out}`);
  console.log(
    `[merge] updated=${stats.updated.size} created=${stats.created} unmatched=${stats.unmatched.length}`,
  );
  if (stats.unmatched.length) {
    console.log('[merge] unmatched:', stats.unmatched.slice(0, 20));
  }
  console.log(
    `[merge] gate errors=${gate.errors.length} warnings=${gate.warnings.length}`,
  );
}

main();
