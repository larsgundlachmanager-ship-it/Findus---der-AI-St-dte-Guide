#!/usr/bin/env node
/**
 * Review-Facetten für alle Stadt-Packs, dann upload:city.
 *   node scripts/cityPack/backfillReviewFacetsAll.mjs
 *   node scripts/cityPack/backfillReviewFacetsAll.mjs --skip prisdorf
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listCityPackIds, ROOT, arg, hasFlag } from './lib.mjs';

function run(scriptRel, args) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FINDUS_PACK_COST: 'full' },
  });
  return r.status === 0;
}

function main() {
  const skip = new Set(
    String(arg('skip') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const only = new Set(
    String(arg('only') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  let ids = listCityPackIds();
  if (only.size) ids = ids.filter((id) => only.has(id));
  ids = ids.filter((id) => !skip.has(id));
  const noUpload = hasFlag('no-upload');
  const force = hasFlag('force');
  console.log(
    `[backfill-facets] ${ids.length} Städte · full · force=${force} · upload=${!noUpload} · budget=${process.env.FINDUS_GOOGLE_BUDGET_EUR || '50'}EUR`,
  );

  const report = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    console.log(`\n[backfill-facets] ▶ ${i + 1}/${ids.length} ${id}`);
    const facetArgs = ['--city', id, '--full'];
    if (force) facetArgs.push('--force');
    const facets = run('enrichReviewFacets.mjs', facetArgs);
    if (!facets) {
      report.push({ id, ok: false, step: 'facets' });
      continue;
    }
    if (noUpload) {
      report.push({ id, ok: true, step: 'facets' });
      continue;
    }
    const up = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), path.join('data', 'staedte', `${id}.json`)],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    report.push({
      id,
      ok: up.status === 0,
      step: up.status === 0 ? 'upload' : 'upload_fail',
    });
  }

  const fail = report.filter((r) => !r.ok);
  console.log(
    `\n[backfill-facets] DONE ok=${report.filter((r) => r.ok).length} fail=${fail.length}` +
      (fail.length ? ` (${fail.map((f) => `${f.id}:${f.step}`).join(', ')})` : ''),
  );
  if (fail.length) process.exit(1);
}

main();
