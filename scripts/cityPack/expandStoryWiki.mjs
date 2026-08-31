#!/usr/bin/env node
/**
 * Story-Tiefe aus Wikipedia (nur belegte Sätze, nichts erfinden).
 * Stadt-agnostisch — Nachzug für alle Packs und für city:auto.
 *
 *   node scripts/cityPack/expandStoryWiki.mjs --city prisdorf
 */
import { arg, loadPack, savePack } from './lib.mjs';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function poolChars(t) {
  const gi = String(t?.general_info || '');
  const deep = (t?.deep_data_pool || []).reduce(
    (n, e) => n + String(e?.text || e || '').length,
    0,
  );
  return gi.length + deep;
}

function pushDeep(trigger, text, tags) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 80) return false;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 90);
  if (
    trigger.deep_data_pool.some((e) => {
      const x = String(typeof e === 'string' ? e : e?.text || '')
        .toLowerCase()
        .slice(0, 90);
      return x === key;
    })
  ) {
    return false;
  }
  trigger.deep_data_pool.push({ text: clean, tags });
  return true;
}

async function wikiFetch(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FindusCityPack/1.0 (story depth)' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        await sleep(15000 * (attempt + 1));
        lastErr = new Error('rate_limit');
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`http ${res.status}`);
        await sleep(1200 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function wikiExtract(title, lang) {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('prop', 'extracts');
  u.searchParams.set('explaintext', '1');
  u.searchParams.set('exchars', '4200');
  u.searchParams.set('redirects', '1');
  u.searchParams.set('titles', title);
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  const res = await wikiFetch(u);
  const j = await res.json();
  const page = Object.values(j?.query?.pages || {})[0];
  if (!page || page.missing != null) return null;
  const extract = String(page.extract || '').trim();
  return extract.length >= 120 ? { title: page.title, extract } : null;
}

async function wikiSearch(query, lang) {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('list', 'search');
  u.searchParams.set('srsearch', query);
  u.searchParams.set('srlimit', '5');
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  const res = await wikiFetch(u);
  const j = await res.json();
  return j?.query?.search || [];
}

const TYPE_STOP = new Set([
  'museum',
  'park',
  'street',
  'square',
  'platz',
  'house',
  'haus',
  'palace',
  'schloss',
  'bridge',
  'brücke',
  'brucke',
  'market',
  'markt',
  'cathedral',
  'dom',
  'kirche',
  'church',
  'collection',
  'station',
  'bahnhof',
  'road',
  'straße',
  'strasse',
  'hill',
  'berg',
  'garden',
  'garten',
  'centre',
  'center',
  'zentrum',
  'tower',
  'turm',
  'hall',
  'rathaus',
  'the',
  'and',
  'of',
  'der',
  'die',
  'das',
  'und',
  'von',
  'stadt',
  'city',
]);

function pickHit(hits, spotName, cityName) {
  const key = spotName
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cityTok = String(cityName || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/gi, ' ')
    .split(' ')
    .filter((t) => t.length >= 3);
  const STOP = new Set([...TYPE_STOP, ...cityTok]);
  const tokens = key.split(' ').filter((t) => t.length >= 3);
  const unique = tokens.filter((t) => !STOP.has(t));
  let best = null;
  for (const h of hits) {
    const t = String(h.title || '')
      .toLowerCase()
      .replace(/['’]/g, '');
    if (/liste von|disambiguation|begriffsklärung|film\b|album\b/i.test(t)) continue;
    let score = 0;
    if (t === key || t.startsWith(`${key} `) || t.includes(`(${key})`)) score += 40;
    if (t.includes(key)) score += 24;
    const hitTok = unique.filter((tok) => t.includes(tok)).length;
    if (unique.length && hitTok < unique.length) continue;
    score += hitTok * 8;
    if (unique[0] && t.startsWith(unique[0])) score += 12;
    if (cityTok.some((c) => t.includes(c))) score += 1;
    if (!best || score > best.score) best = { h, score };
  }
  return best?.score >= 16 ? best.h : null;
}

function chunksFromExtract(extract) {
  const parts = extract
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 70 && !/^==/.test(s));
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + ' ' + p).trim().length > 520 && buf.length >= 120) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf} ${p}` : p;
    }
  }
  if (buf.length >= 120) out.push(buf.trim());
  return out.slice(0, 8);
}

function langsForPack(pack) {
  const id = String(pack.city_id || '').toLowerCase();
  if (id === 'london') return ['en', 'de'];
  if (id === 'lissabon') return ['pt', 'en', 'de'];
  return ['de', 'en'];
}

async function pageForSpot(name, cityName, langs) {
  for (const lang of langs) {
    const hits = await wikiSearch(`"${name}" ${cityName}`, lang);
    const hit =
      pickHit(hits, name, cityName) ||
      pickHit(await wikiSearch(name, lang), name, cityName);
    if (!hit) continue;
    const page = await wikiExtract(hit.title, lang);
    if (page) return { ...page, lang };
    await sleep(500);
  }
  return null;
}

export async function expandStoryWiki(cityId, opts = {}) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`${cityId} pack missing`);
  const cityName = pack.name || cityId;
  const langs = langsForPack(pack);
  const spotFilter = String(opts.spot || '').trim().toLowerCase();
  const stories = (pack.spots || []).filter((s) => {
    if (s.pack_role === 'directory' && !spotFilter) return false;
    if (!spotFilter) return s.pack_role !== 'directory';
    return String(s.name || '').toLowerCase().includes(spotFilter);
  });
  let padded = 0;
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < stories.length; i++) {
    const spot = stories[i];
    const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
    if (!t) continue;
    const target = Number(spot.place_tier) === 1 ? 3000 : 1200;
    if (poolChars(t) >= target) {
      skipped += 1;
      continue;
    }
    const before = poolChars(t);
    process.stdout.write(
      `[wiki-depth] ${cityId} ${i + 1}/${stories.length} ${spot.name} (${before})… `,
    );
    try {
      const page = await pageForSpot(spot.name, cityName, langs);
      await sleep(700);
      if (!page) {
        console.log('no page');
        continue;
      }
      if (!(t.general_info || '').trim() || (t.general_info || '').length < 80) {
        t.general_info = page.extract.slice(0, 240).replace(/\s+\S*$/, '') + '…';
      }
      let n = 0;
      for (const chunk of chunksFromExtract(page.extract)) {
        if (poolChars(t) >= target && n >= 2) break;
        if (
          pushDeep(t, chunk, [
            'wikipedia',
            `quelle_${page.lang}`,
            'geschichte',
          ])
        ) {
          n += 1;
          added += 1;
        }
      }
      if (n > 0) {
        spot.tags = [...new Set([...(spot.tags || []), 'wikipedia_enriched'])];
        padded += 1;
      }
      console.log(n ? `+${n} → ${poolChars(t)} (${page.title})` : `skip ${page.title}`);
    } catch (err) {
      console.log(String(err.message || err).slice(0, 80));
      if (/rate_limit/i.test(String(err.message || err))) {
        await sleep(20000);
      }
    }
  }
  if (padded > 0) savePack(pack, { bumpVersion: true });
  const out = { cityId, padded, added, skipped, version: pack.data_version };
  console.log(JSON.stringify(out));
  return out;
}

async function main() {
  const cityId = (arg('city') || arg('id') || '').toLowerCase();
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/expandStoryWiki.mjs --city <id> [--spot Name]');
    process.exit(1);
  }
  await expandStoryWiki(cityId, { spot: arg('spot') || '' });
}

const isDirect = process.argv[1]?.replace(/\\/g, '/').endsWith(
  'expandStoryWiki.mjs',
);
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
