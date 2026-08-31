#!/usr/bin/env node
/**
 * GPS confidence batch — OSM (free) → Google (budget-capped) → Address (free) → optional upload.
 *
 * SAFETY: Nothing runs without --go. Upload only with --upload.
 *
 *   npm run city:gps-confidence -- --plan
 *   npm run city:gps-confidence -- --go
 *   npm run city:gps-confidence -- --go --upload
 *   npm run city:gps-confidence -- --go --only prisdorf,wangerooge --budget-usd 25
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  arg,
  hasFlag,
  listCityPackIds,
  loadEnvFile,
  loadPack,
  ROOT,
  STAEDTE_DIR,
  writeJson,
} from './lib.mjs';

loadEnvFile();

const STATE_PATH = path.join(STAEDTE_DIR, '_gps_confidence_state.json');
const GOOGLE_COST_EST_USD = 0.006;

function csvSet(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isStory(spot) {
  const role = String(spot.pack_role || '').toLowerCase();
  if (role === 'directory') return false;
  if (role === 'story') return true;
  const tier = Number(spot.place_tier);
  if (Number.isFinite(tier) && tier <= 2) return true;
  const tags = (spot.tags || []).map(String);
  return tags.some((t) => /must_have|landmark|tier1|story/i.test(t));
}

function hasOsmPoly(spot) {
  const raw = spot.polygonCoordinates || spot.polygon || [];
  const pts = raw
    .map((x) =>
      Array.isArray(x)
        ? { lat: x[0], lng: x[1] }
        : { lat: x.lat, lng: x.lng },
    )
    .filter((p) => Number.isFinite(p.lat));
  if (pts.length < 4) return false;
  const lats = new Set(pts.map((p) => p.lat.toFixed(5)));
  const lngs = new Set(pts.map((p) => p.lng.toFixed(5)));
  return !(lats.size === 2 && lngs.size === 2);
}

function hasGooglePlace(spot) {
  return Boolean(spot._google?.place_id || spot.google_place_id);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { startedAt: new Date().toISOString(), done: {}, failed: {}, googleCalls: 0 };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function runNode(scriptRel, args, { fatal = true } = {}) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    const msg = `${scriptRel} failed (exit ${r.status})`;
    if (fatal) throw new Error(msg);
    console.warn(`[gps-confidence] ${msg}`);
    return false;
  }
  return true;
}

function planSummary(cityIds) {
  let stories = 0;
  let osmPoly = 0;
  let needGoogle = 0;
  const rows = [];
  for (const id of cityIds) {
    const pack = loadPack(id);
    if (!pack) continue;
    let st = 0;
    let op = 0;
    let ng = 0;
    for (const s of pack.spots || []) {
      if (!isStory(s)) continue;
      st += 1;
      if (hasOsmPoly(s)) op += 1;
      else if (!hasGooglePlace(s)) ng += 1;
    }
    stories += st;
    osmPoly += op;
    needGoogle += ng;
    rows.push({ id, stories: st, osmPoly: op, needGoogle: ng });
  }
  rows.sort((a, b) => b.stories - a.stories);
  const estUsd = Math.min(
    Number(arg('budget-usd') || 25),
    needGoogle * GOOGLE_COST_EST_USD,
  );
  return { stories, osmPoly, needGoogle, estUsd, rows };
}

function pickCities() {
  const only = csvSet(arg('only'));
  const skip = csvSet(arg('skip'));
  let ids = listCityPackIds();
  if (only.size) ids = ids.filter((id) => only.has(id.toLowerCase()));
  ids = ids.filter((id) => !skip.has(id.toLowerCase()));
  return ids;
}

async function main() {
  const planOnly = hasFlag('plan') || !hasFlag('go');
  const doUpload = hasFlag('upload');
  const budgetUsd = Number(arg('budget-usd') || 25);
  const cityIds = pickCities();
  const summary = planSummary(cityIds);

  console.log('\n=== GPS Confidence Pass ===');
  console.log(`Städte: ${cityIds.length}`);
  console.log(`Story-Spots: ${summary.stories}`);
  console.log(`OSM-Polygon (Tier A Kandidaten): ${summary.osmPoly}`);
  console.log(`Google-Audit Rest: ~${summary.needGoogle}`);
  console.log(`Geschätzte Google-Kosten: ~$${summary.estUsd.toFixed(2)} (Cap $${budgetUsd})`);
  console.log(`Upload: ${doUpload ? 'JA (--upload)' : 'NEIN (nur mit --upload)'}`);
  console.log(`Modus: ${planOnly ? 'PLAN (kein --go)' : 'RUN (--go)'}\n`);

  if (planOnly) {
    console.log('Top-Städte:', summary.rows.slice(0, 10));
    console.log('\nStarten mit: npm run city:gps-confidence -- --go');
    console.log('Mit Upload:  npm run city:gps-confidence -- --go --upload\n');
    return;
  }

  const state = readState();
  let googleCalls = state.googleCalls || 0;
  const googleBudgetCalls = Math.floor(budgetUsd / GOOGLE_COST_EST_USD);

  for (const cityId of cityIds) {
    if (state.done?.[cityId]) {
      console.log(`[skip] ${cityId} (done)`);
      continue;
    }
    console.log(`\n--- ${cityId} ---`);
    try {
      // Phase 1 — OSM snap (free)
      runNode('snapOsmStoryFootprints.mjs', ['--city', cityId, '--no-upload']);

      // Phase 2 — Google audit (budget-capped, story-only)
      if (googleCalls < googleBudgetCalls) {
        const remaining = googleBudgetCalls - googleCalls;
        console.log(`[google] budget left ~${remaining} calls`);
        runNode(
          'auditEntrances.mjs',
          ['--city', cityId, '--apply', '--story-only', '--max-delta', '80'],
          { fatal: false },
        );
        googleCalls += Math.min(
          remaining,
          (loadPack(cityId)?.spots || []).filter(isStory).filter((s) => !hasOsmPoly(s)).length,
        );
      } else {
        console.warn(`[google] budget exhausted ($${budgetUsd}) — skip ${cityId}`);
      }

      // Phase 3 — Address QA report (free, no auto-apply)
      runNode(
        'auditGpsQa.mjs',
        ['--city', cityId, '--story-only', '--max-delta', '180'],
        { fatal: false },
      );

      if (doUpload) {
        const packPath = path.join(STAEDTE_DIR, `${cityId}.json`);
        runNode('../uploadCityPack.mjs', [packPath], { fatal: false });
      }

      state.done = state.done || {};
      state.done[cityId] = new Date().toISOString();
      state.googleCalls = googleCalls;
      writeState(state);
    } catch (e) {
      state.failed = state.failed || {};
      state.failed[cityId] = String(e?.message || e);
      writeState(state);
      console.error(`[fail] ${cityId}:`, e);
    }
  }

  writeJson(path.join(STAEDTE_DIR, '_gps_confidence_summary.json'), {
    finishedAt: new Date().toISOString(),
    cities: cityIds.length,
    googleCalls,
    budgetUsd,
    uploaded: doUpload,
    done: Object.keys(state.done || {}),
    failed: state.failed || {},
  });
  console.log('\n=== Fertig ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
