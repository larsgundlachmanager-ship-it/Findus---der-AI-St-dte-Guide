#!/usr/bin/env node
/**
 * City-Pack Demand Queue: ab 10 Unique-Usern → city:auto + upload:city.
 *
 *   npm run city:demand:process
 *   npm run city:demand:process -- --dry
 *   npm run city:demand:process -- --city wedel
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL + ANON oder SERVICE_ROLE
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const dry = process.argv.includes('--dry');
const cityArgIdx = process.argv.indexOf('--city');
const cityArg =
  cityArgIdx >= 0 ? String(process.argv[cityArgIdx + 1] || '').trim() : '';

const url = (
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key || url.includes('your-project')) {
  console.error('[demand] Missing Supabase URL/key');
  process.exit(1);
}

async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${name} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

function runCityAuto(cityName, cityId) {
  console.log(`\n[demand] city:auto --city "${cityName}" --id ${cityId} --upload`);
  const r = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'run',
      'city:auto',
      '--',
      '--city',
      cityName,
      '--id',
      cityId,
      '--upload',
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env, shell: true },
  );
  return r.status === 0;
}

async function main() {
  console.log('[demand] claim next queued city…');
  const claim = await rpc('claim_city_pack_demand', {
    p_city_id: cityArg || null,
  });

  if (!claim?.ok) {
    console.log('[demand] queue empty — nothing to build');
    return;
  }

  const cityId = String(claim.cityId || '').trim();
  const cityName = String(claim.cityName || cityId).trim();
  console.log(
    `[demand] building ${cityName} (${cityId}) users=${claim.uniqueUsers ?? '?'}`,
  );

  if (dry) {
    console.log('[demand] --dry: would run city:auto + upload, marking failed rollback not applied');
    await rpc('finish_city_pack_demand', {
      p_city_id: cityId,
      p_ok: false,
      p_fail_reason: 'dry_run',
    });
    // Re-queue manually for dry? leave failed — operator can reset
    return;
  }

  let ok = false;
  let err = '';
  try {
    ok = runCityAuto(cityName, cityId);
    if (!ok) err = 'city_auto_exit_nonzero';
  } catch (e) {
    ok = false;
    err = e instanceof Error ? e.message : String(e);
  }

  const packPath = path.join(ROOT, 'data', 'staedte', `${cityId}.json`);
  if (ok && !fs.existsSync(packPath)) {
    ok = false;
    err = 'pack_file_missing';
  }

  await rpc('finish_city_pack_demand', {
    p_city_id: cityId,
    p_ok: ok,
    p_pack_id: ok ? cityId : null,
    p_fail_reason: ok ? null : err || 'build_failed',
  });

  console.log(ok ? `[demand] published ${cityId}` : `[demand] failed ${cityId}: ${err}`);
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error('[demand]', e);
  process.exit(1);
});
