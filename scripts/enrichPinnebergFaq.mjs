#!/usr/bin/env node
/**
 * Merge curated user Q&A (10 per place) into Pinneberg deep_data_pool.
 * FAQs are keyed by base place id and copied onto all _t1/_t2/_t3 triggers.
 * Bumps data_version to 3.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FAQ from './_pinnebergFaq.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/pinneberg.json');
const INDEX = path.join(ROOT, 'data/staedte/index.json');
const REPORT = path.join(
  ROOT,
  'data/staedte/pinneberg_faq_enrichment_report.json',
);

const VERSION = 3;
const EXPECTED = [
  'pinneberg_bahnhof_pr',
  'pinneberg_hotel_cap_polonio',
  'pinneberg_die_drostei',
  'pinneberg_stadtmuseum',
  'pinneberg_rathauspassage',
  'pinneberg_kriegerdenkmal_bahnhofvorplatz',
  'pinneberg_deutsches_baumschulmuseum',
];

function toFact({ q, a }) {
  return {
    text: `User-Frage: ${String(q || '').trim()} Antwort: ${String(a || '').trim()}`,
    tags: ['faq', 'detail', 'user_question', 'rueckfrage', 'tiefenwissen'],
  };
}

function baseId(tpId) {
  return String(tpId || '').replace(/_t[123]$/, '');
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

const missing = EXPECTED.filter((id) => !FAQ[id]);
const badCounts = EXPECTED.filter(
  (id) => !Array.isArray(FAQ[id]) || FAQ[id].length !== 10,
).map((id) => ({ id, n: FAQ[id]?.length ?? 0 }));
if (missing.length || badCounts.length) {
  console.error(JSON.stringify({ missing, badCounts }, null, 2));
  process.exit(1);
}

let added = 0;
let removed = 0;
const perTrigger = {};

for (const tp of pack.trigger_points) {
  const base = baseId(tp.id);
  const list = FAQ[base];
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
  perTrigger[tp.id] = n;
}

// Ensure spots have stable ids for catalog mapping
for (const spot of pack.spots || []) {
  if (spot.id) continue;
  const match = (pack.trigger_points || []).find((t) => t.name === spot.name);
  if (match) spot.id = baseId(match.id);
}

pack.data_version = VERSION;
pack.updated_at = new Date().toISOString().slice(0, 10);

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const city = (index.available_cities || []).find((c) => c.id === 'pinneberg');
if (city) city.data_version = VERSION;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));

const report = {
  data_version: VERSION,
  places: EXPECTED.length,
  faqAdded: added,
  faqRemovedPrevious: removed,
  perTrigger,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
