#!/usr/bin/env node
/**
 * Merge curated user Q&A (10 per spot) into Wangerooge deep_data_pool.
 * Bumps data_version to 11.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';
import part1 from './_wangeroogeFaqPart1.mjs';
import part2 from './_wangeroogeFaqPart2.mjs';
import part3 from './_wangeroogeFaqPart3.mjs';
import part4 from './_wangeroogeFaqPart4.mjs';
import part5 from './_wangeroogeFaqPart5.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/wangerooge.json');
const INDEX = path.join(ROOT, 'data/staedte/index.json');
const REPORT = path.join(
  ROOT,
  'data/staedte/wangerooge_faq_enrichment_report.json',
);

const FAQ = { ...part1, ...part2, ...part3, ...part4, ...part5 };
const VERSION = 11;

function toFact({ q, a }) {
  return {
    text: `User-Frage: ${String(q || '').trim()} Antwort: ${String(a || '').trim()}`,
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
let removed = 0;
const perSpot = {};

for (const tp of pack.trigger_points) {
  const list = FAQ[tp.id];
  if (!list) continue;
  if (!Array.isArray(tp.deep_data_pool)) tp.deep_data_pool = [];

  const before = tp.deep_data_pool.length;
  tp.deep_data_pool = tp.deep_data_pool.filter(
    (e) =>
      !(
        Array.isArray(e?.tags) &&
        e.tags.map(String).map((t) => t.toLowerCase()).includes('faq')
      ),
  );
  removed += before - tp.deep_data_pool.length;

  let n = 0;
  for (const qa of list) {
    tp.deep_data_pool.push(toFact(qa));
    n += 1;
    added += 1;
  }
  perSpot[tp.id] = n;

  const spot = pack.spots.find((s) => s.id === tp.id);
  if (spot) {
    spot.tags = [
      ...new Set([...(spot.tags || []), 'faq', 'user_question']),
    ];
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
const city = (index.available_cities || []).find((c) => c.id === 'wangerooge');
if (city) city.data_version = VERSION;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));

const report = {
  data_version: VERSION,
  spots: Object.keys(FAQ).length,
  faqAdded: added,
  faqRemovedPrevious: removed,
  perSpot,
  validation,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
