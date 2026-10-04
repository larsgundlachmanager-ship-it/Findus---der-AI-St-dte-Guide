#!/usr/bin/env node
/**
 * Alle Städte: Directory nachziehen (Restaurants/Cafés/Museen via OSM+Google)
 * → OSM-Gebäudeumrisse force-snap → Upload.
 *
 *   npm run city:densify-all
 *   npm run city:densify-all -- --only hamburg,tornesch
 *   npm run city:densify-all -- --reset
 *   npm run city:densify-all -- --full   # Google Places full directory
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
import { suggestedDiscoveryRadius } from './placeCategoryPolicy.mjs';

loadEnvFile();

const STATE_PATH = path.join(STAEDTE_DIR, '_densify_all_state.json');

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
    return { startedAt: new Date().toISOString(), done: {}, failed: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function runNode(scriptRel, args, { fatal = true, passFull = false } = {}) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  const extra = passFull && hasFlag('full') ? ['--full'] : [];
  const r = spawnSync(process.execPath, [script, ...args, ...extra], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      FINDUS_PACK_COST: hasFlag('full')
        ? 'full'
        : process.env.FINDUS_PACK_COST || 'cheap',
    },
  });
  if (r.status !== 0) {
    const msg = `${scriptRel} failed (exit ${r.status})`;
    if (fatal) throw new Error(msg);
    console.warn(`[densify-all] ${msg}`);
    return false;
  }
  return true;
}

function uploadCity(cityId) {
  const file = path.join(STAEDTE_DIR, `${cityId}.json`);
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), file],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (r.status !== 0) throw new Error(`upload:city ${cityId} exit ${r.status}`);
}

function sortSmallFirst(ids) {
  return [...ids].sort((a, b) => {
    const pa = loadPack(a);
    const pb = loadPack(b);
    const sa = (pa?.spots || []).length;
    const sb = (pb?.spots || []).length;
    return sa - sb;
  });
}

function main() {
  if (hasFlag('reset') && fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
    console.log('[densify-all] state reset');
  }
  const only = csvSet(arg('only'));
  const skip = csvSet(arg('skip'));
  let ids = listCityPackIds();
  if (only.size) ids = ids.filter((id) => only.has(id));
  ids = ids.filter((id) => !skip.has(id));
  ids = sortSmallFirst(ids);

  const state = readState();
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.done = state.done || {};
  state.failed = state.failed || {};

  console.log(
    `[densify-all] ${ids.length} Städte · full=${hasFlag('full')} · resume=${Object.keys(state.done).length} done`,
  );

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (state.done[id]?.ok && !hasFlag('force')) {
      console.log(`[densify-all] skip already done ${id}`);
      continue;
    }
    const started = Date.now();
    console.log(`\n[densify-all] ▶ ${i + 1}/${ids.length} ${id}`);
    try {
      const pack = loadPack(id);
      const radius = suggestedDiscoveryRadius(pack || id);
      runNode(
        'expandCityDirectory.mjs',
        ['--city', id, '--radius', String(radius), '--apply'],
        { fatal: true, passFull: true },
      );
      const footArgs = ['--city', id, '--no-upload'];
      if (hasFlag('force-footprints') || hasFlag('force')) {
        footArgs.push('--force');
      }
      runNode('snapOsmStoryFootprints.mjs', footArgs, { fatal: false });
      runNode('runQualityGate.mjs', ['--city', id], { fatal: false });
      uploadCity(id);
      const after = loadPack(id);
      const rest = (after?.spots || []).filter((s) =>
        /restaurant/i.test(s.category || ''),
      ).length;
      const cafe = (after?.spots || []).filter((s) =>
        /cafe|café|bakery|bäck/i.test(s.category || ''),
      ).length;
      const mus = (after?.spots || []).filter((s) =>
        /museum/i.test(s.category || ''),
      ).length;
      state.done[id] = {
        ok: true,
        at: new Date().toISOString(),
        ms: Date.now() - started,
        version: after?.data_version,
        restaurants: rest,
        cafes: cafe,
        museums: mus,
        total: after?.spots?.length,
      };
      delete state.failed[id];
      writeState(state);
      console.log(
        `[densify-all] ✓ ${id} v${after?.data_version} rest=${rest} cafe=${cafe} mus=${mus} total=${after?.spots?.length} in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (e) {
      state.failed[id] = {
        at: new Date().toISOString(),
        error: String(e.message || e).slice(0, 240),
      };
      writeState(state);
      console.error(`[densify-all] ✗ ${id}: ${e.message || e}`);
    }
  }

  const failed = Object.keys(state.failed);
  console.log(
    `\n[densify-all] DONE ok=${Object.keys(state.done).length} fail=${failed.length}` +
      (failed.length ? ` (${failed.join(', ')})` : ''),
  );
  if (failed.length) process.exit(1);
}

main();
