#!/usr/bin/env node
/**
 * Pack-Spot Inbox: User-entdeckte Orte → merge + wiki-depth + upload:city.
 *
 *   npm run city:spot:process
 *   npm run city:spot:process -- --dry
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL + ANON oder SERVICE_ROLE
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReviewFacetTags } from './reviewFacetTags.mjs';

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
  console.error('[spot-inbox] Missing Supabase URL/key');
  process.exit(1);
}

async function restGet(pathAndQuery) {
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${pathAndQuery} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
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

function runNpm(script, args) {
  const r = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', script, '--', ...args],
    { cwd: ROOT, stdio: 'inherit', env: process.env, shell: true },
  );
  return r.status === 0;
}

function packExists(cityId) {
  return fs.existsSync(path.join(ROOT, 'data', 'staedte', `${cityId}.json`));
}

function toResearchPayload(spots) {
  return {
    new_places: spots.map((s) => {
      const facts = Array.isArray(s.facts_json) ? s.facts_json : [];
      const bullets = facts
        .map((f) => (typeof f === 'string' ? f : f?.text || ''))
        .map((t) => String(t).trim())
        .filter((t) => t.length >= 12)
        .slice(0, 8);
      const wiki = String(s.wiki_extract || '').trim();
      const facetTags = extractReviewFacetTags(`${s.name} ${bullets.join(' ')}`);
      return {
        name: s.name,
        category: s.category || 'ort',
        lat: Number(s.lat),
        lng: Number(s.lng),
        pack_role: s.pack_role === 'story' ? 'story' : 'directory',
        place_tier: s.place_tier ?? (s.pack_role === 'story' ? 2 : 4),
        tags: [
          'from_live_research',
          s.pack_role === 'story' ? 'story' : 'directory',
          s.category || 'ort',
          ...facetTags,
        ],
        bullets,
        general_info: wiki ? wiki.slice(0, 500) : bullets[0] || '',
        deep_data_pool: wiki
          ? [{ text: wiki.slice(0, 1800), tags: ['wikipedia', 'user_discovered'] }]
          : bullets.map((text) => ({
              text,
              tags: facetTags.length
                ? ['review_facet', 'from_live_research', ...facetTags]
                : ['user_discovered', 'from_live_research'],
            })),
      };
    }),
  };
}

async function main() {
  console.log('[spot-inbox] load queued spots…');
  const queued = await restGet(
    'pack_spot_inbox?status=eq.queued&order=created_at.asc&limit=24',
  );
  if (!Array.isArray(queued) || queued.length === 0) {
    console.log('[spot-inbox] queue empty');
    return;
  }

  const withPack = queued.filter((s) => packExists(String(s.city_id || '')));
  if (!withPack.length) {
    console.log(
      `[spot-inbox] ${queued.length} queued but no local pack file — wait for city:auto`,
    );
    return;
  }

  const ids = withPack.map((s) => s.id);
  if (dry) {
    console.log(`[spot-inbox] --dry: would claim ${ids.length} spots`);
    return;
  }

  const claim = await rpc('claim_pack_spot_ids', { p_ids: ids });
  const claimed = new Set((claim?.ids || ids).map(String));
  const rows = withPack.filter((s) => claimed.has(String(s.id)));
  if (!rows.length) {
    console.log('[spot-inbox] claim returned empty');
    return;
  }

  const byCity = new Map();
  for (const s of rows) {
    const cityId = String(s.city_id);
    const list = byCity.get(cityId) || [];
    list.push(s);
    byCity.set(cityId, list);
  }

  for (const [cityId, spots] of byCity) {
    const tmp = path.join(os.tmpdir(), `findus-spot-inbox-${cityId}.json`);
    fs.writeFileSync(tmp, JSON.stringify(toResearchPayload(spots), null, 2));
    console.log(`[spot-inbox] merge ${spots.length} spots → ${cityId}`);
    const merged = runNpm('city:merge-research', ['--city', cityId, '--file', tmp]);
    const uploaded = merged
      ? runNpm('upload:city', [path.join('data', 'staedte', `${cityId}.json`)])
      : false;
    for (const s of spots) {
      await rpc('finish_pack_spot', {
        p_id: s.id,
        p_ok: merged && uploaded,
        p_fail_reason: merged
          ? uploaded
            ? null
            : 'upload_failed'
          : 'merge_failed',
      });
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('[spot-inbox]', e);
  process.exit(1);
});
