#!/usr/bin/env node
/**
 * Re-upload all available city covers (full frame, no bottom crop).
 *   node scripts/cityPack/reuploadAllCovers.mjs
 *   node scripts/cityPack/reuploadAllCovers.mjs --ids hamburg,luebeck
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arg } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function coverCandidates(id) {
  const pendingDirs = {
    'berlin-umland': ['berlin-umland', 'berlin_umland', 'berlin'],
    berlin_umland: ['berlin-umland', 'berlin_umland', 'berlin'],
    'berlin-zentral': ['berlin-zentral', 'berlin_zentral', 'berlin'],
    frankfurt_am_main: ['frankfurt_am_main', 'frankfurt'],
    hochheim_am_main: ['hochheim_am_main', 'hochheim'],
  }[id] || [id];
  const pending = [];
  for (const dir of pendingDirs) {
    pending.push(
      path.join(ROOT, 'data', 'staedte', 'pending-covers', dir, 'stylized.png'),
      path.join(ROOT, 'data', 'staedte', 'pending-covers', dir, 'source.png'),
    );
  }
  return [
    ...pending,
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}-src.jpg`),
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}-src.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-soft.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-3.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-2.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}.png`),
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}.png`),
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}.jpg`),
  ];
}

function discoverIds() {
  const forced = String(arg('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (forced.length) return forced;

  const ids = new Set();
  const dir = path.join(ROOT, 'data', 'staedte');
  for (const f of fs.readdirSync(dir)) {
    const m = /^([a-z0-9_-]+)\.json$/i.exec(f);
    if (!m) continue;
    const id = m[1];
    if (id === 'index') continue;
    if (coverCandidates(id).some((p) => fs.existsSync(p))) ids.add(id);
  }
  // remote-covers may use slightly different names
  const remote = path.join(ROOT, 'assets', 'onboarding', 'remote-covers');
  if (fs.existsSync(remote)) {
    for (const f of fs.readdirSync(remote)) {
      const m = /^([a-z0-9_-]+)\.(jpg|png)$/i.exec(f);
      if (!m || m[1].endsWith('-src')) continue;
      ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

const ids = discoverIds();
if (!ids.length) {
  console.error('No cover ids found');
  process.exit(1);
}

console.log(`[reupload] ${ids.length} covers: ${ids.join(',')}`);
const up = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'scripts', 'cityPack', 'uploadCityCovers.mjs'),
    '--ids',
    ids.join(','),
  ],
  { cwd: ROOT, stdio: 'inherit', env: process.env },
);
process.exit(up.status || 0);
