#!/usr/bin/env node
/**
 * Enrich story spots from Wikipedia extracts (DE → EN fallback).
 * Fills general_info + deep_data_pool (Historie/Visuell/LIVE/Quer) without inventing.
 *
 *   node scripts/cityPack/enrichFromWikipedia.mjs --city laboe --apply
 *   node scripts/cityPack/enrichFromWikipedia.mjs --city laboe --limit 12
 */
import {
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  slugify,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

async function wikiSearch(query, lang = 'de') {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('list', 'search');
  u.searchParams.set('srsearch', query);
  u.searchParams.set('srlimit', '5');
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(u, {
      headers: { 'User-Agent': 'FindusCityPack/1.0 (city enrich; local research)' },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return [];
    const j = await res.json();
    return j?.query?.search || [];
  }
  return [];
}

async function wikiExtract(title, lang = 'de') {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('prop', 'extracts');
  u.searchParams.set('exintro', '1');
  u.searchParams.set('explaintext', '1');
  u.searchParams.set('titles', title);
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(u, {
      headers: { 'User-Agent': 'FindusCityPack/1.0 (city enrich; local research)' },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return null;
    const j = await res.json();
    const pages = j?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (!page || page.missing != null) return null;
    const extract = String(page.extract || '').trim();
    if (extract.length < 80) return null;
    return { title: page.title, extract };
  }
  return null;
}

function pushDeep(trigger, text, tags) {
  const clean = String(text || '').trim();
  if (clean.length < 40) return false;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 70);
  if (
    trigger.deep_data_pool.some((e) => {
      const t = typeof e === 'string' ? e : e?.text || '';
      return t.toLowerCase().slice(0, 70) === key;
    })
  ) {
    return false;
  }
  trigger.deep_data_pool.push({ text: clean, tags });
  return true;
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

function relevantHit(hits, spotName, cityName) {
  const key = spotName.toLowerCase().replace(/[^a-z0-9äöüß ]/gi, ' ').replace(/\s+/g, ' ').trim();
  const tokens = key.split(' ').filter((t) => t.length >= 3 && !['der', 'die', 'das', 'und', 'von', 'laboe', 'stadt'].includes(t));
  const city = cityName.toLowerCase();
  const scored = hits.map((h) => {
    const t = String(h.title || '').toLowerCase();
    let score = 0;
    if (t === key) score += 20;
    if (tokens.length && tokens.every((tok) => t.includes(tok))) score += 12;
    if (tokens.filter((tok) => t.includes(tok)).length >= Math.min(2, tokens.length)) score += 6;
    if (t.includes(city)) score += 1;
    if (/liste von|disambiguation|begriffsklärung/i.test(t)) score -= 20;
    // Reject pages that only share the city name
    if (tokens.length >= 2 && tokens.filter((tok) => t.includes(tok)).length === 0) score -= 10;
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 6 ? scored[0].h : null;
}

async function enrichCityHistory(pack, cityName) {
  if ((pack._city_history || '').length >= 400) return false;
  for (const lang of ['de', 'en']) {
    const hits = await wikiSearch(cityName, lang);
    const hit =
      hits.find((h) => String(h.title).toLowerCase() === cityName.toLowerCase()) ||
      hits.find((h) => String(h.title).toLowerCase().includes(cityName.toLowerCase())) ||
      hits[0];
    if (!hit) continue;
    const page = await wikiExtract(hit.title, lang);
    if (!page) continue;
    pack._city_history = page.extract.slice(0, 1200);
    return true;
  }
  return false;
}

async function enrichSpot(pack, spot, cityName) {
  const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
  if (!t) return { ok: false, reason: 'no_trigger' };
  const deep = t.deep_data_pool || [];
  if (deep.length >= 8 && (t.general_info || '').length >= 120) {
    return { ok: false, reason: 'already_rich' };
  }

  const queries = [
    `${spot.name} ${cityName}`,
    spot.name,
    `${spot.name} ${pack.name || cityName}`,
  ];
  let page = null;
  for (const q of queries) {
    for (const lang of ['de', 'en']) {
      const hits = await wikiSearch(q, lang);
      const hit = relevantHit(hits, spot.name, cityName);
      if (!hit) continue;
      page = await wikiExtract(hit.title, lang);
      if (page) break;
    }
    if (page) break;
  }
  if (!page) return { ok: false, reason: 'no_wiki' };

  const parts = sentences(page.extract);
  if (!(t.general_info || '').trim() || (t.general_info || '').length < 80) {
    t.general_info = page.extract.slice(0, 240).replace(/\s+\S*$/, '') + (page.extract.length > 240 ? '…' : '');
  }
  let added = 0;
  if (parts[0]) {
    if (pushDeep(t, `Historie: ${parts[0]}`, ['geschichte', 'wikipedia'])) added += 1;
  }
  if (parts[1]) {
    if (pushDeep(t, `Visuell / Kontext: ${parts[1]}`, ['visuell', 'wegweiser', 'wikipedia'])) added += 1;
  }
  if (parts[2]) {
    if (pushDeep(t, `Quer: ${parts[2]}`, ['quer', 'wikipedia'])) added += 1;
  }
  if (
    pushDeep(
      t,
      `LIVE: Öffnung, Tickets und tagesaktuelle Hinweise zu ${spot.name} vor Ort oder auf der offiziellen Seite prüfen — Pack enthält keine Preise.`,
      ['live_hint', 'ephemeral'],
    )
  ) {
    added += 1;
  }
  spot.tags = [...new Set([...(spot.tags || []), 'wikipedia_enriched'])];
  return { ok: added > 0, added, title: page.title };
}

async function main() {
  const cityId = arg('city') || arg('id');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/enrichFromWikipedia.mjs --city <id> [--apply] [--limit N]');
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const limit = Number(arg('limit') || 20);
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);
  const cityName = pack.name || cityId;

  const hist = await enrichCityHistory(pack, cityName);
  const stories = (pack.spots || [])
    .filter((s) => s.pack_role !== 'directory' && (s.place_tier ?? 9) <= 2)
    .map((s) => {
      const t = (pack.trigger_points || []).find((x) => x.id === s.id);
      const deep = (t?.deep_data_pool || []).length;
      const gi = (t?.general_info || '').length;
      return { s, deep, gi, tier: s.place_tier ?? 9 };
    })
    // Thin-first, then tier — otherwise rich T1 burns the limit.
    .sort((a, b) => a.deep - b.deep || a.gi - b.gi || a.tier - b.tier)
    .map((x) => x.s);

  const report = { city: cityId, history: hist, spots: [] };
  let n = 0;
  let attempts = 0;
  const maxAttempts = Math.max(limit * 8, 80);
  for (const s of stories) {
    if (n >= limit) break;
    if (attempts >= maxAttempts) break;
    attempts += 1;
    const r = await enrichSpot(pack, s, cityName);
    report.spots.push({ id: s.id, name: s.name, ...r });
    if (r.ok) n += 1;
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };

  if (apply) {
    savePack(pack, { bumpVersion: true });
  }
  const gate = runQualityGate(pack, { strict: false });
  console.log(
    JSON.stringify(
      {
        apply,
        v: pack.data_version,
        enriched: report.spots.filter((s) => s.ok).length,
        history: hist,
        gate: { ok: gate.ok, thin: gate.stats?.thinDeep, missingNarr: gate.stats?.missingNarration },
        sample: report.spots.filter((s) => s.ok).slice(0, 8),
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
