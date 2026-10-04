#!/usr/bin/env node
/**
 * Nacht-Batch Map-Perfect in Prio-Reihenfolge.
 *
 *   node scripts/cityPack/mapPerfectNightBatch.mjs
 *   node scripts/cityPack/mapPerfectNightBatch.mjs --from danzig
 *   node scripts/cityPack/mapPerfectNightBatch.mjs --only pinneberg,tornesch
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, arg, hasFlag } from './lib.mjs';

const ORDER = [
  'kiel',
  'danzig',
  'bornholm', // city:auto wenn fehlend
  'pinneberg',
  'tornesch',
  'hamburg',
  'laboe',
  'prisdorf',
  'flensburg',
  'luebeck',
  'wangerooge',
  'chorin',
  'rheinsberg',
  'finsterwalde',
  'wandlitz',
  'beelitz',
  'spreewald',
  'bad_saarow',
  'hechingen',
  'korbach',
  'tettnang',
  'oranienburg',
  'brandenburg_havel',
  'werder',
  'bremen',
  'halle_saale',
  'hochheim_am_main',
  'dresden',
  'amsterdam',
  'lissabon',
  'stuttgart',
  'duesseldorf',
  'frankfurt_am_main',
  'koeln',
  'london',
  'potsdam',
  'muenchen',
  'berlin-zentral',
  'berlin-umland',
];

const STATE = path.join(ROOT, 'data', 'staedte', '_map_perfect_night_state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { done: {}, failed: {} };
  }
}

function saveState(st) {
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
}

function packExists(id) {
  return fs.existsSync(path.join(ROOT, 'data', 'staedte', `${id}.json`));
}

function runNode(args, label) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return r.status === 0;
}

function ensureBornholm() {
  if (packExists('bornholm')) return true;
  console.log('[night] Bornholm fehlt → city:auto');
  return runNode(
    [
      path.join(ROOT, 'scripts', 'cityPack', 'createCityAuto.mjs'),
      '--city',
      'Bornholm',
      '--id',
      'bornholm',
    ],
    'city:auto bornholm',
  );
}

function mapPerfect(id) {
  return runNode(
    [
      path.join(ROOT, 'scripts', 'cityPack', 'mapPerfectCity.mjs'),
      '--city',
      id,
    ],
    `map-perfect ${id}`,
  );
}

function main() {
  const only = (arg('only') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const from = arg('from');
  let list = only.length ? only : ORDER.slice();
  if (from) {
    const i = list.indexOf(from);
    if (i >= 0) list = list.slice(i);
  }
  const st = loadState();
  console.log(`[night] cities=${list.length} resume done=${Object.keys(st.done).length}`);

  for (const id of list) {
    if (st.done[id] && !hasFlag('force')) {
      console.log(`[night] skip done ${id}`);
      continue;
    }
    try {
      if (id === 'bornholm' && !packExists('bornholm')) {
        const okAuto = ensureBornholm();
        if (!okAuto) {
          st.failed[id] = 'city:auto failed';
          saveState(st);
          continue;
        }
      }
      if (!packExists(id)) {
        console.warn(`[night] missing pack ${id} — skip`);
        st.failed[id] = 'missing pack';
        saveState(st);
        continue;
      }
      const ok = mapPerfect(id);
      if (ok) {
        st.done[id] = new Date().toISOString();
        delete st.failed[id];
      } else {
        st.failed[id] = 'map-perfect non-zero';
        // trotzdem als done markieren wenn Pack uploaded — mapPerfect exits 0 soft
        st.done[id] = new Date().toISOString();
      }
      saveState(st);
    } catch (e) {
      st.failed[id] = String(e.message || e);
      saveState(st);
      console.error(`[night] FAIL ${id}`, e);
    }
  }

  console.log('\n[night] DONE');
  console.log('done:', Object.keys(st.done).join(', ') || '—');
  console.log('failed:', Object.keys(st.failed).join(', ') || '—');
}

main();
