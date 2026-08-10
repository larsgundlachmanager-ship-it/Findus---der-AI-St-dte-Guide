#!/usr/bin/env node
/**
 * Beta Situation Blueprints — Review & Promote
 *
 * Usage:
 *   npm run beta:situations:review
 *   npm run beta:situations:promote -- --ids 1,3,27
 *   npm run beta:situations:promote -- --keys "events::prices+times_hours::vague_filler"
 *   npm run beta:situations:reject -- --ids 2
 *   npm run beta:situations:sync   (force refresh candidates from events + list)
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL + ANON or SERVICE_ROLE key
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

const url =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key || url.includes('your-project')) {
  console.error('Missing Supabase URL/key in .env');
  process.exit(1);
}

const base = url.replace(/\/$/, '');

function headers(prefer) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function fetchCandidates() {
  const res = await fetch(
    `${base}/rest/v1/situation_blueprint_candidates?select=*&order=unique_contributors.desc,updated_at.desc`,
    { headers: headers() },
  );
  if (!res.ok) {
    throw new Error(`candidates ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchActive() {
  const res = await fetch(
    `${base}/rest/v1/situation_blueprints_active?select=situation_key,summary,source,version,updated_at&order=updated_at.desc`,
    { headers: headers() },
  );
  if (!res.ok) return [];
  return res.json();
}

async function rpc(name, body) {
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${name} ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseArgs(argv) {
  const out = { ids: [], keys: [], cmd: 'review' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'review' || a === 'promote' || a === 'reject' || a === 'sync') {
      out.cmd = a;
    } else if (a === '--ids' && argv[i + 1]) {
      out.ids = String(argv[++i])
        .split(/[,;\s]+/)
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (a === '--keys' && argv[i + 1]) {
      out.keys = String(argv[++i])
        .split(/[,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  // npm run … -- promote → sometimes lands as first arg after node script
  const scriptArgs = argv.filter((a) => !a.includes('betaSituations'));
  if (scriptArgs.includes('promote')) out.cmd = 'promote';
  if (scriptArgs.includes('reject')) out.cmd = 'reject';
  if (scriptArgs.includes('sync')) out.cmd = 'sync';
  if (scriptArgs.includes('review')) out.cmd = 'review';
  return out;
}

function printReview(rows) {
  console.log('\n=== Beta Situation Candidates (Review) ===\n');
  if (!rows.length) {
    console.log('Keine Kandidaten. Warte auf Korrekturen aus der App (Abend-Upload).');
    return;
  }
  rows.forEach((r, idx) => {
    const n = idx + 1;
    const status = r.status;
    const users = r.unique_contributors;
    const autoHint =
      users >= 3 && status !== 'promoted' && status !== 'rejected'
        ? ' → AUTO-READY (≥3 User)'
        : status === 'promoted'
          ? ' ✓ live'
          : '';
    console.log(
      `#${n}  [${status}]  users=${users}  events=${r.event_count}${autoHint}`,
    );
    console.log(`     family: ${r.intent_family}`);
    console.log(`     key:    ${r.situation_key}`);
    console.log(`     summary:${r.summary || '—'}`);
    console.log(
      `     expect: ${(r.expect || []).join(', ') || '—'} | avoid: ${(r.avoid || []).join(', ') || '—'}`,
    );
    if ((r.sample_digests || []).length) {
      console.log(`     samples:`);
      for (const s of r.sample_digests.slice(0, 3)) {
        console.log(`       - ${String(s).slice(0, 120)}`);
      }
    }
    console.log('');
  });
  console.log('Promote:  npm run beta:situations:promote -- --ids 1,3');
  console.log('Reject:   npm run beta:situations:reject -- --ids 2');
  console.log('Auto ≥3:  läuft serverseitig beim Event-Insert (Trigger).\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rows = await fetchCandidates();

  if (args.cmd === 'sync') {
    const keys = [
      ...new Set(rows.map((r) => r.situation_key).filter(Boolean)),
    ];
    // Also refresh from distinct event keys
    const ev = await fetch(
      `${base}/rest/v1/beta_situation_events?select=situation_key`,
      { headers: headers() },
    );
    if (ev.ok) {
      const evRows = await ev.json();
      for (const e of evRows) {
        if (e.situation_key) keys.push(e.situation_key);
      }
    }
    for (const k of [...new Set(keys)]) {
      await rpc('refresh_situation_candidate', { p_situation_key: k });
    }
    rows = await fetchCandidates();
    console.log(`Synced ${keys.length} situation keys.`);
  }

  if (args.cmd === 'review' || args.cmd === 'sync') {
    printReview(rows);
    const active = await fetchActive();
    console.log(`Active blueprints live: ${active.length}`);
    for (const a of active.slice(0, 15)) {
      console.log(
        `  • [${a.source}] v${a.version} ${a.situation_key} — ${a.summary || ''}`,
      );
    }
    return;
  }

  const resolveKeys = () => {
    const keys = [...args.keys];
    for (const id of args.ids) {
      const row = rows[id - 1];
      if (!row) {
        console.error(`Unknown id #${id} (list has ${rows.length} rows)`);
        process.exit(1);
      }
      keys.push(row.situation_key);
    }
    return [...new Set(keys)];
  };

  if (args.cmd === 'promote') {
    const keys = resolveKeys();
    if (!keys.length) {
      console.error('Specify --ids 1,3 or --keys "..."');
      process.exit(1);
    }
    for (const k of keys) {
      const ok = await rpc('promote_situation_blueprint', {
        p_situation_key: k,
        p_by: 'manual_lars',
      });
      console.log(ok ? `✓ promoted ${k}` : `✗ failed ${k}`);
    }
    return;
  }

  if (args.cmd === 'reject') {
    const keys = resolveKeys();
    if (!keys.length) {
      console.error('Specify --ids or --keys');
      process.exit(1);
    }
    for (const k of keys) {
      const ok = await rpc('reject_situation_blueprint', {
        p_situation_key: k,
      });
      console.log(ok ? `✓ rejected ${k}` : `✗ failed ${k}`);
    }
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
