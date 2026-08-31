/**
 * Fleet API-cost digest from device_cost_daily (Sunday 18:00 Berlin).
 *
 * Usage:
 *   node scripts/weeklyCostDigest.mjs
 *   node scripts/weeklyCostDigest.mjs --days 7 --dry
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *      (falls back to EXPO_PUBLIC_SUPABASE_ANON_KEY — may be RLS-blocked)
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

function parseArgs(argv) {
  const out = { days: 7, dry: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (a === '--days' && argv[i + 1]) {
      out.days = Math.max(1, Number(argv[++i]) || 7);
    } else if (a === '--out' && argv[i + 1]) out.out = argv[++i];
  }
  return out;
}

function berlinDateKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function eur(n) {
  const x = Number(n) || 0;
  return `${x.toFixed(2)} €`;
}

function shortHash(h) {
  const s = String(h || '');
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export async function fetchFleetCostDigest({ days = 7 } = {}) {
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!base || !key) {
    return { skipped: true, reason: 'no supabase credentials' };
  }

  const to = berlinDateKey();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const from = berlinDateKey(fromDate);

  const url = `${base}/rest/v1/device_cost_daily?day=gte.${from}&day=lte.${to}&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      skipped: true,
      reason: `HTTP ${res.status} ${body.slice(0, 180)}`,
    };
  }
  const rows = (await res.json()) || [];
  const byUser = new Map();
  let totalCons = 0;
  let totalEff = 0;
  const moduleSums = {};
  for (const row of rows) {
    const hash = String(row.contributor_hash || '');
    const cons = Number(row.conservative_eur) || 0;
    const eff = Number(row.efficient_eur) || 0;
    totalCons += cons;
    totalEff += eff;
    const prev = byUser.get(hash) || { hash, conservativeEur: 0, days: 0 };
    prev.conservativeEur += cons;
    prev.days += 1;
    byUser.set(hash, prev);
    const mods = row.modules && typeof row.modules === 'object' ? row.modules : {};
    for (const [id, val] of Object.entries(mods)) {
      const eurVal =
        val && typeof val === 'object'
          ? Number(val.conservativeEur) || 0
          : Number(val) || 0;
      moduleSums[id] = (moduleSums[id] || 0) + eurVal;
    }
  }

  const users = [...byUser.values()].sort(
    (a, b) => b.conservativeEur - a.conservativeEur,
  );
  const active = users.filter((u) => u.conservativeEur > 0.0005);
  const avg = active.length ? totalCons / active.length : 0;
  const max = active[0]?.conservativeEur || 0;
  const topExpensive = active.slice(0, 10);
  const topCheap = [...active].sort((a, b) => a.conservativeEur - b.conservativeEur).slice(0, 10);

  return {
    skipped: false,
    from,
    to,
    days,
    deviceDays: rows.length,
    uniqueUsers: users.length,
    activeUsers: active.length,
    totalConservativeEur: totalCons,
    totalEfficientEur: totalEff,
    averageEur: avg,
    maxEur: max,
    topExpensive,
    topCheap,
    moduleSums,
  };
}

export function renderFleetCostMarkdown(digest) {
  if (digest.skipped) {
    return `_Fleet-Kosten fehlen: ${digest.reason}_`;
  }
  const lines = [];
  lines.push('## Nutzer-API-Kosten (konservative Listenpreise)');
  lines.push('');
  lines.push(
    `Zeitraum **${digest.from} → ${digest.to}** · ${digest.activeUsers} aktive Geräte · ${digest.deviceDays} Geräte-Tage`,
  );
  lines.push('');
  lines.push(`| Kennzahl | Betrag |`);
  lines.push(`|----------|--------|`);
  lines.push(`| Gesamt (Obergrenze) | ${eur(digest.totalConservativeEur)} |`);
  lines.push(`| Gesamt (Sparpfad) | ${eur(digest.totalEfficientEur)} |`);
  lines.push(`| Durchschnitt / aktives Gerät | ${eur(digest.averageEur)} |`);
  lines.push(`| Teuerstes Gerät | ${eur(digest.maxEur)} |`);
  lines.push('');
  const mods = Object.entries(digest.moduleSums || {}).sort((a, b) => b[1] - a[1]);
  if (mods.length) {
    lines.push('### Module');
    lines.push('');
    for (const [id, val] of mods) {
      if (val < 0.0005) continue;
      lines.push(`- ${id}: ${eur(val)}`);
    }
    lines.push('');
  }
  lines.push('### Top 10 teuerste Geräte');
  lines.push('');
  if (!digest.topExpensive?.length) {
    lines.push('_Keine Uploads._');
  } else {
    for (const u of digest.topExpensive) {
      lines.push(
        `- \`${shortHash(u.hash)}\` · ${eur(u.conservativeEur)} (${u.days} Tage)`,
      );
    }
  }
  lines.push('');
  lines.push('### Top 10 günstigste aktive Geräte');
  lines.push('');
  if (!digest.topCheap?.length) {
    lines.push('_Keine Uploads._');
  } else {
    for (const u of digest.topCheap) {
      lines.push(
        `- \`${shortHash(u.hash)}\` · ${eur(u.conservativeEur)} (${u.days} Tage)`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const digest = await fetchFleetCostDigest({ days: args.days });
  const md = `# Findus Kosten-Digest — ${berlinDateKey()}\n\n${renderFleetCostMarkdown(digest)}\n`;
  const outDir = path.join(ROOT, 'reports', 'weekly');
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = args.out
    ? path.resolve(ROOT, args.out)
    : path.join(outDir, `${berlinDateKey()}-costs.md`);
  if (!args.dry) fs.writeFileSync(mdPath, md, 'utf8');
  console.log(md);
  console.log(args.dry ? `(dry-run) would write ${mdPath}` : `Wrote ${mdPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
