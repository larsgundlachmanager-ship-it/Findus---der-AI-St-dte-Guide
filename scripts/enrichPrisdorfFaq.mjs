#!/usr/bin/env node
/**
 * Merge curated user Q&A (10 per spot) into Prisdorf deep_data_pool.
 * Bumps data_version to 15.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';
import part1 from './_prisdorfFaqPart1.mjs';
import part2 from './_prisdorfFaqPart2.mjs';
import part3 from './_prisdorfFaqPart3.mjs';
import part4 from './_prisdorfFaqPart4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/prisdorf.json');
const INDEX = path.join(ROOT, 'data/staedte/index.json');
const REPORT = path.join(ROOT, 'data/staedte/prisdorf_faq_enrichment_report.json');

const FAQ = { ...part1, ...part2, ...part3, ...part4 };
const VERSION = 15;

function faqKey(q) {
  return `User-Frage: ${String(q || '').trim()}`.toLowerCase();
}

function toFact({ q, a }) {
  const question = String(q || '').trim();
  const answer = String(a || '').trim();
  return {
    text: `User-Frage: ${question} Antwort: ${answer}`,
    tags: ['faq', 'detail', 'user_question', 'rueckfrage', 'tiefenwissen'],
  };
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const spotIds = new Set(pack.spots.map((s) => s.id));
const missingInFaq = [...spotIds].filter((id) => !FAQ[id]);
const extraInFaq = Object.keys(FAQ).filter((id) => !spotIds.has(id));
const badCounts = Object.entries(FAQ)
  .filter(([, arr]) => !Array.isArray(arr) || arr.length !== 10)
  .map(([id, arr]) => ({ id, n: Array.isArray(arr) ? arr.length : 0 }));

if (missingInFaq.length || extraInFaq.length || badCounts.length) {
  console.error(
    JSON.stringify({ missingInFaq, extraInFaq, badCounts }, null, 2),
  );
  process.exit(1);
}

let added = 0;
let skipped = 0;
const perSpot = {};

for (const tp of pack.trigger_points) {
  const list = FAQ[tp.id];
  if (!list) continue;
  if (!Array.isArray(tp.deep_data_pool)) tp.deep_data_pool = [];

  // drop previous FAQ batch (idempotent re-run)
  const before = tp.deep_data_pool.length;
  tp.deep_data_pool = tp.deep_data_pool.filter(
    (e) =>
      !(
        Array.isArray(e?.tags) &&
        e.tags.map(String).map((t) => t.toLowerCase()).includes('faq')
      ),
  );
  skipped += before - tp.deep_data_pool.length;

  let n = 0;
  for (const qa of list) {
    const fact = toFact(qa);
    const key = faqKey(qa.q);
    const exists = tp.deep_data_pool.some((e) =>
      String(e?.text || '')
        .toLowerCase()
        .startsWith(key),
    );
    if (exists) continue;
    tp.deep_data_pool.push(fact);
    n += 1;
    added += 1;
  }
  perSpot[tp.id] = n;

  const spot = pack.spots.find((s) => s.id === tp.id);
  if (spot) {
    const tags = new Set([...(spot.tags || []), 'faq', 'user_question']);
    spot.tags = [...tags];
    if (spot.facts && typeof spot.facts === 'object' && !Array.isArray(spot.facts)) {
      const ft = new Set([...(spot.facts.tags || []), 'faq', 'user_question']);
      spot.facts.tags = [...ft];
    }
  }
}

pack.data_version = VERSION;
pack.updated_at = new Date().toISOString().slice(0, 10);

const validation = validateCityPack(pack);
if (!validation.ok) {
  console.error('Validation failed', validation);
  process.exit(1);
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const pd = (index.available_cities || []).find((c) => c.id === 'prisdorf');
if (pd) pd.data_version = VERSION;
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));

const report = {
  data_version: VERSION,
  spots: Object.keys(FAQ).length,
  faqAdded: added,
  faqRemovedPrevious: skipped,
  perSpot,
  validation,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
