#!/usr/bin/env node
/**
 * Alle bestehenden Packs auf denselben Stand wie London:
 * Wiki-Tiefe → GPS/Wegweiser (Pins, OSM-Umrisse, Offline-Karte) → Upload.
 *
 *   npm run city:refresh-all
 *   npm run city:refresh-all -- --skip london
 *   npm run city:refresh-all -- --only prisdorf,wangerooge
 *   npm run city:refresh-all -- --reset
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

loadEnvFile();

const STATE_PATH = path.join(STAEDTE_DIR, '_refresh_all_state.json');

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
    console.warn(`[refresh-all] ${msg}`);
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
    const sa = (pa?.spots || []).filter((s) => s.pack_role !== 'directory').length;
    const sb = (pb?.spots || []).filter((s) => s.pack_role !== 'directory').length;
    return sa - sb;
  });
}

function main() {
  if (hasFlag('reset') && fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
    console.log('[refresh-all] state reset');
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
    `[refresh-all] ${ids.length} Städte · skip=${[...skip].join(',') || '—'} · resume=${Object.keys(state.done).length} done`,
  );

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (state.done[id]?.ok && !hasFlag('force')) {
      console.log(`[refresh-all] skip already done ${id}`);
      continue;
    }
    const started = Date.now();
    console.log(`\n[refresh-all] ▶ ${i + 1}/${ids.length} ${id}`);
    try {
      runNode('expandStoryWiki.mjs', ['--city', id], { fatal: false });
      runNode('enrichReviewFacets.mjs', ['--city', id], { fatal: false });
      const gpsArgs = ['--city', id];
      if (id === 'berlin-umland') gpsArgs.push('--skip-map');
      runNode('gpsWegweiserLoop.mjs', gpsArgs, { fatal: true });
      runNode('runQualityGate.mjs', ['--city', id], { fatal: false });
      uploadCity(id);
      const pack = loadPack(id);
      state.done[id] = {
        ok: true,
        at: new Date().toISOString(),
        ms: Date.now() - started,
        version: pack?.data_version,
      };
      delete state.failed[id];
      writeState(state);
      console.log(
        `[refresh-all] ✓ ${id} v${pack?.data_version} in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (e) {
      state.failed[id] = {
        at: new Date().toISOString(),
        error: String(e.message || e).slice(0, 240),
      };
      writeState(state);
      console.error(`[refresh-all] ✗ ${id}: ${e.message || e}`);
    }
  }

  const failed = Object.keys(state.failed);
  console.log(
    `\n[refresh-all] DONE ok=${Object.keys(state.done).length} fail=${failed.length}` +
      (failed.length ? ` (${failed.join(', ')})` : ''),
  );
  if (failed.length) process.exit(1);
}

main();
