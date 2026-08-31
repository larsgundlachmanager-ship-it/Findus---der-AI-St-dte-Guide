#!/usr/bin/env node
/**
 * Publish Owner-Gold situation blueprints → situation_blueprints_active.
 * Usage: npm run gold:publish
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACK_PATH = path.join(
  ROOT,
  'src',
  'module2',
  'blueprints',
  'ownerGold.pack.json',
);

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

const SCRIPT_DENY =
  /^(sag genau|du musst sagen|wortlaut:)/i;
const PLACE_DENY = /\b(prisdorf|wangerooge|laboe|lübeck|luebeck)\b/i;

function situationKeyFromParts(b) {
  const exp = [...(b.expect || [])].map((x) => String(x).toLowerCase()).sort().join('+') || 'none';
  const av = [...(b.avoid || [])].map((x) => String(x).toLowerCase()).sort().join('+') || 'none';
  return `${b.intentFamily}::${exp}::${av}`.slice(0, 180);
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const summary = String(raw.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (summary && (SCRIPT_DENY.test(summary) || PLACE_DENY.test(summary))) {
    throw new Error(`Gold summary violates doctrine: ${summary.slice(0, 80)}`);
  }
  const expect = Array.isArray(raw.expect) ? raw.expect.map(String) : [];
  const avoid = Array.isArray(raw.avoid) ? raw.avoid.map(String) : [];
  if (!expect.length && !avoid.length && !summary) return null;
  return {
    situation_key: String(raw.situationKey || situationKeyFromParts({
      intentFamily: raw.intentFamily || 'general',
      expect,
      avoid,
    })).slice(0, 180),
    intent_family: String(raw.intentFamily || 'general'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 8) : [],
    expect,
    avoid,
    summary: summary || 'Antwortstruktur aus Founder-Feedback',
    source: 'owner_gold',
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));
  const list = Array.isArray(pack.blueprints) ? pack.blueprints : [];
  const rows = list.map(normalize).filter(Boolean);
  if (!rows.length) {
    console.log('Owner-Gold pack is empty — nothing to publish.');
    return;
  }

  const base = url.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/situation_blueprints_active`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error('publish failed', res.status, await res.text());
    process.exit(1);
  }
  const saved = await res.json().catch(() => rows);
  console.log(`Published ${Array.isArray(saved) ? saved.length : rows.length} owner-gold blueprint(s).`);
  for (const r of rows) {
    console.log(`  • [${r.intent_family}] ${r.situation_key} — ${r.summary}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
