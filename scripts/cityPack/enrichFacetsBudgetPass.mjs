#!/usr/bin/env node
/**
 * Budgetierter Facet-/Bullet-Pass über alle Packs (€25 Cap, Persistenz in _google_spend.json).
 *
 *   FINDUS_GOOGLE_BUDGET_EUR=25 node scripts/cityPack/enrichFacetsBudgetPass.mjs --reset
 *   FINDUS_GOOGLE_BUDGET_EUR=25 node scripts/cityPack/enrichFacetsBudgetPass.mjs --only prisdorf
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
} from './lib.mjs';
import { resetGoogleSpendLedger, googleBudgetCapEur } from './google.mjs';

loadEnvFile();
if (!process.env.FINDUS_GOOGLE_BUDGET_EUR) {
  process.env.FINDUS_GOOGLE_BUDGET_EUR = '25';
}

const STATE_PATH = path.join(STAEDTE_DIR, '_enrich_facets_budget_state.json');
const SPEND_PATH = path.join(STAEDTE_DIR, '_google_spend.json');

function csvSet(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {
      startedAt: new Date().toISOString(),
      done: {},
      failed: {},
      budgetStop: false,
    };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function readSpendUsd() {
  try {
    const j = JSON.parse(fs.readFileSync(SPEND_PATH, 'utf8'));
    const v = Number(j?.estUsd);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function runNode(scriptRel, args) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

function uploadCity(cityId) {
  const file = path.join(STAEDTE_DIR, `${cityId}.json`);
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), file],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
}

function main() {
  if (hasFlag('reset')) {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
    resetGoogleSpendLedger();
    console.log('[enrich-budget] state + spend ledger reset');
  }
  const only = csvSet(arg('only'));
  let ids = listCityPackIds();
  if (only.size) ids = ids.filter((id) => only.has(id));
  ids = [...ids].sort((a, b) => {
    const sa = (loadPack(a)?.spots || []).length;
    const sb = (loadPack(b)?.spots || []).length;
    return sa - sb;
  });

  const state = readState();
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.done = state.done || {};
  state.failed = state.failed || {};
  const cap = googleBudgetCapEur();

  console.log(
    `[enrich-budget] cities=${ids.length} cap=€${cap} spend≈$${readSpendUsd().toFixed(2)} resume=${Object.keys(state.done).length}`,
  );

  for (let i = 0; i < ids.length; i++) {
    if (readSpendUsd() >= cap) {
      state.budgetStop = true;
      writeState(state);
      console.warn(
        `[enrich-budget] budget exhausted (≈$${readSpendUsd().toFixed(2)} ≥ €${cap}) — stop`,
      );
      process.exit(0);
    }
    const id = ids[i];
    if (state.done[id]?.ok && !hasFlag('force')) {
      console.log(`[enrich-budget] skip done ${id}`);
      continue;
    }
    console.log(`\n[enrich-budget] ▶ ${i + 1}/${ids.length} ${id}`);
    const started = Date.now();
    try {
      const facets = runNode('enrichReviewFacets.mjs', ['--city', id]);
      if (facets.status !== 0) throw new Error(`facets exit ${facets.status}`);
      runNode('polishMapBullets.mjs', ['--city', id]);
      const up = uploadCity(id);
      if (up.status !== 0) throw new Error(`upload exit ${up.status}`);
      const pack = loadPack(id);
      state.done[id] = {
        ok: true,
        at: new Date().toISOString(),
        ms: Date.now() - started,
        version: pack?.data_version,
        spendUsd: readSpendUsd(),
      };
      delete state.failed[id];
      writeState(state);
      console.log(
        `[enrich-budget] ✓ ${id} v${pack?.data_version} spend≈$${readSpendUsd().toFixed(2)}`,
      );
    } catch (e) {
      const msg = String(e.message || e);
      state.failed[id] = {
        at: new Date().toISOString(),
        error: msg.slice(0, 240),
      };
      writeState(state);
      console.error(`[enrich-budget] ✗ ${id}: ${msg}`);
    }
  }
  console.log(
    `[enrich-budget] DONE ok=${Object.keys(state.done).length} fail=${Object.keys(state.failed).length} spend≈$${readSpendUsd().toFixed(2)}`,
  );
}

main();
