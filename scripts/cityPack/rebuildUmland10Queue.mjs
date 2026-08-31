/**
 * Queue: 10-km-Umland Offline-Karten nachbauen + uploaden.
 *
 *   node scripts/cityPack/rebuildUmland10Queue.mjs
 *   node scripts/cityPack/rebuildUmland10Queue.mjs --no-upload
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, STAEDTE_DIR, hasFlag, sleep } from './lib.mjs';

const QUEUE_PATH = path.join(STAEDTE_DIR, '_offline_umland10_queue.json');
const skipUpload = hasFlag('no-upload') || hasFlag('skip-upload');

function loadQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
}

function saveQueue(q) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2) + '\n');
}

function runCity(cityId) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(ROOT, 'scripts/cityPack/buildCityOfflineMap.mjs'),
      '--city',
      cityId,
    ];
    if (skipUpload) args.push('--no-upload');
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
    );
    child.on('error', reject);
  });
}

function uploadCity(cityId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts/uploadCityPack.mjs'), path.join(STAEDTE_DIR, `${cityId}.json`)],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`upload exit ${code}`)),
    );
    child.on('error', reject);
  });
}

const q = loadQueue();
const pending = (q.queued || []).filter(
  (id) => !(q.done || []).includes(id) && !(q.failed || []).includes(id),
);
console.log(
  `[umland10] pending ${pending.length} (done=${(q.done || []).length} failed=${(q.failed || []).length}) upload=${!skipUpload}`,
);

for (const id of pending) {
  console.log(`\n[umland10] ▶ ${id}`);
  try {
    await runCity(id);
    if (!skipUpload) {
      try {
        await uploadCity(id);
      } catch (e) {
        console.warn(`[umland10] upload ${id}: ${e.message || e}`);
      }
    }
    q.done = [...new Set([...(q.done || []), id])];
    q.failed = (q.failed || []).filter((x) => x !== id);
    q.updatedAt = new Date().toISOString();
    saveQueue(q);
    console.log(`[umland10] ✓ ${id}`);
  } catch (e) {
    console.warn(`[umland10] ✗ ${id}: ${e.message || e}`);
    q.failed = [...new Set([...(q.failed || []), id])];
    q.updatedAt = new Date().toISOString();
    saveQueue(q);
  }
  await sleep(1500);
}

console.log(
  `[umland10] finished done=${(q.done || []).length} failed=${(q.failed || []).length}`,
);
