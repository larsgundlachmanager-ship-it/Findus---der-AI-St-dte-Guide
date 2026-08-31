#!/usr/bin/env node
/**
 * Sunday Founder Report — feedback, blueprints, packs, affiliate hints, Play P&L.
 *
 * Usage:
 *   npm run report:weekly
 *   npm run report:weekly -- --days 7 --dry
 *   npm run report:weekly -- --out reports/weekly/custom.md
 *
 * Env: see .env.example (Founder weekly report section)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AFFILIATE_PROGRAMS,
  estimateApiCostEur,
  LOOKBACK_DAYS,
  PLAY_CONSOLE_FINANCIAL_URL,
} from './founderReport/config.mjs';
import { fetchPlayWeeklyPnl } from './founderReport/playGcs.mjs';
import {
  fetchFleetCostDigest,
  renderFleetCostMarkdown,
} from './weeklyCostDigest.mjs';

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
  const out = { days: LOOKBACK_DAYS, dry: false, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (a === '--json') out.json = true;
    else if (a === '--days' && argv[i + 1]) out.days = Math.max(1, Number(argv[++i]) || 7);
    else if (a === '--out' && argv[i + 1]) out.out = argv[++i];
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

function weekRange(days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to, days };
}

function supabaseCfg() {
  const baseUrl = (
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!baseUrl || !key || baseUrl.includes('your-project')) return null;
  return { baseUrl, key };
}

function parseFeedbackRecords(text) {
  if (!text?.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row) => row && typeof row === 'object' && typeof row.feedback_id === 'string',
    );
  } catch {
    return [];
  }
}

async function collectFeedback(range) {
  const cfg = supabaseCfg();
  if (!cfg) {
    return { ok: false, reason: 'Supabase not configured', items: [] };
  }
  const publicUrl = `${cfg.baseUrl}/storage/v1/object/public/feedback/master_feedback.json`;
  const authUrl = `${cfg.baseUrl}/storage/v1/object/feedback/master_feedback.json`;
  let text = '';
  try {
    let res = await fetch(publicUrl);
    if (!res.ok) {
      res = await fetch(authUrl, {
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          apikey: cfg.key,
        },
      });
    }
    if (res.status === 404) return { ok: true, items: [], totalCloud: 0 };
    if (!res.ok) {
      return {
        ok: false,
        reason: `feedback download HTTP ${res.status}`,
        items: [],
      };
    }
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: String(err.message || err), items: [] };
  }

  const all = parseFeedbackRecords(text);
  const items = all.filter((r) => {
    const t = Date.parse(r.timestamp || '');
    if (!Number.isFinite(t)) return false;
    return t >= range.from.getTime() && t <= range.to.getTime();
  });

  const enriched = items.map((r) => {
    const tel = r.telemetry_10min || {};
    const judge = Array.isArray(tel.judge_passes) ? tel.judge_passes : [];
    const corrections = judge.flatMap((j) => j.judge_corrections_made || []);
    const actions = Array.isArray(tel.findus_actions_triggered)
      ? tel.findus_actions_triggered
      : [];
    const clicked = actions.flatMap((a) => a.clicked || []);
    return {
      id: r.feedback_id,
      at: r.timestamp,
      user: r.user_name || 'anon',
      issue: String(r.issue_description || '').trim(),
      desired: String(r.desired_behavior || '').trim(),
      lastUi: (tel.ui_states || []).slice(-3),
      lastActions: (tel.last_actions || []).slice(-5),
      speechUser: (tel.user_speech_exact || []).slice(-2),
      speechFindus: (tel.findus_speech_exact || []).slice(-2),
      judgeCorrections: [...new Set(corrections)],
      clickedLabels: clicked.map((c) => c.label || c.type).filter(Boolean),
      navActive: Boolean(tel.nav_execution_tracking?.nav_active_atMs),
    };
  });

  return { ok: true, items: enriched, totalCloud: all.length };
}

async function collectBetaBlueprints() {
  const cfg = supabaseCfg();
  if (!cfg) {
    return { ok: false, reason: 'Supabase not configured', pending: [], autoReady: [], active: [] };
  }
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
  };
  try {
    const [candRes, activeRes] = await Promise.all([
      fetch(
        `${cfg.baseUrl}/rest/v1/situation_blueprint_candidates?select=*&order=unique_contributors.desc,updated_at.desc`,
        { headers },
      ),
      fetch(
        `${cfg.baseUrl}/rest/v1/situation_blueprints_active?select=situation_key,summary,source,version,updated_at&order=updated_at.desc&limit=30`,
        { headers },
      ),
    ]);
    const candidates = candRes.ok ? await candRes.json() : [];
    const active = activeRes.ok ? await activeRes.json() : [];
    const pending = candidates.filter(
      (c) => c.status !== 'promoted' && c.status !== 'rejected',
    );
    const autoReady = pending.filter(
      (c) =>
        c.status === 'auto_ready' ||
        (Number(c.unique_contributors) >= 3 && c.status !== 'promoted'),
    );
    const needsReview = pending.filter(
      (c) => !autoReady.includes(c),
    );
    return {
      ok: true,
      pending: needsReview,
      autoReady,
      active,
      allPending: pending,
    };
  } catch (err) {
    return {
      ok: false,
      reason: String(err.message || err),
      pending: [],
      autoReady: [],
      active: [],
    };
  }
}

function collectFileBlueprints() {
  const stagingDir = path.join(ROOT, 'data', 'blueprints', 'staging');
  if (!fs.existsSync(stagingDir)) {
    return { reviews: [], digests: [] };
  }
  const reviews = fs
    .readdirSync(stagingDir)
    .filter((f) => f.endsWith('.review.md'));
  const digests = reviews.map((f) => {
    const full = path.join(stagingDir, f);
    let head = '';
    try {
      head = fs.readFileSync(full, 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
    } catch {
      /* soft */
    }
    return { file: f, head };
  });
  return { reviews, digests };
}

async function collectPacks(range) {
  const cfg = supabaseCfg();
  let remote = null;
  if (cfg) {
    try {
      const url = `${cfg.baseUrl}/storage/v1/object/public/staedte/index.json`;
      const res = await fetch(url);
      if (res.ok) remote = await res.json();
      else {
        const authUrl = `${cfg.baseUrl}/storage/v1/object/staedte/index.json`;
        const res2 = await fetch(authUrl, {
          headers: {
            Authorization: `Bearer ${cfg.key}`,
            apikey: cfg.key,
          },
        });
        if (res2.ok) remote = await res2.json();
      }
    } catch {
      /* soft */
    }
  }

  const localDir = path.join(ROOT, 'data', 'staedte');
  const localPacks = [];
  if (fs.existsSync(localDir)) {
    for (const f of fs.readdirSync(localDir)) {
      // only city packs like prisdorf.json — skip *.merge_report.json etc.
      if (!/^[a-z0-9_-]+\.json$/i.test(f)) continue;
      const full = path.join(localDir, f);
      try {
        const st = fs.statSync(full);
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        localPacks.push({
          id: f.replace(/\.json$/i, ''),
          dataVersion: raw.data_version ?? raw.dataVersion ?? null,
          mtimeMs: st.mtimeMs,
          changedThisWeek: st.mtimeMs >= range.from.getTime(),
        });
      } catch {
        /* soft */
      }
    }
  }

  let gitLog = '';
  let gitChangedIds = [];
  try {
    gitLog = execFileSync(
      'git',
      [
        'log',
        `--since=${range.days}.days`,
        '--pretty=format:%h %ad %s',
        '--date=short',
        '--',
        'data/staedte',
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    gitLog = '';
  }
  try {
    const nameOut = execFileSync(
      'git',
      [
        'log',
        `--since=${range.days}.days`,
        '--name-only',
        '--pretty=format:',
        '--',
        'data/staedte',
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    gitChangedIds = [
      ...new Set(
        nameOut
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^data\/staedte\/[a-z0-9_-]+\.json$/i.test(l))
          .map((l) => path.basename(l, '.json')),
      ),
    ];
  } catch {
    gitChangedIds = [];
  }

  const remoteCities = Array.isArray(remote?.available_cities)
    ? remote.available_cities
    : [];
  // Prefer git-touched packs; fall back to mtime only when git has no hits
  const byGit = localPacks.filter((p) => gitChangedIds.includes(p.id));
  const changedLocal =
    byGit.length > 0
      ? byGit
      : localPacks.filter((p) => p.changedThisWeek).slice(0, 25);

  return {
    lastGlobalUpdate: remote?.last_global_update ?? null,
    remoteCityCount: remoteCities.length,
    changedLocal,
    gitChangedIds,
    gitLog: gitLog
      ? gitLog.split(/\r?\n/).slice(0, 40)
      : [],
  };
}

function collectAffiliateHints(feedbackItems) {
  const blob = feedbackItems
    .map((f) => `${f.issue} ${f.desired} ${(f.speechUser || []).join(' ')}`)
    .join(' ')
    .toLowerCase();

  const momentHits = {
    hotel_night: /hotel|übernacht|unterkunft|hostel|airbnb/,
    plan_gap_tour: /tour|führung|sightseeing|ausflug/,
    evening_free: /abend|nightlife|ticket|konzert|museum/,
    roadtrip_car: /mietwagen|auto mieten|roadtrip/,
    pre_flight_luggage: /gepäck|koffer|flughafen/,
    abroad_esim: /esim|roaming|ausland.*daten/,
    travel_insurance: /reiseversicherung|versicherung/,
    camping: /camping|wohnmobil|stellplatz/,
  };

  const suggested = [];
  for (const prog of AFFILIATE_PROGRAMS) {
    const re = momentHits[prog.moment];
    const fromFeedback = re ? re.test(blob) : false;
    suggested.push({
      ...prog,
      fromFeedback,
      action: fromFeedback
        ? 'Feedback erwähnt verwandten Kontext — Help-First-Moment prüfen / Partner-Button stärken'
        : 'Dashboard der Woche prüfen; bei passenden Concierge-Momenten Link mitliefern',
    });
  }
  return suggested;
}

function buildOptimizations({ feedback, beta, packs, affiliate }) {
  const tips = [];

  const judgeCounts = new Map();
  for (const f of feedback.items) {
    for (const c of f.judgeCorrections || []) {
      judgeCounts.set(c, (judgeCounts.get(c) || 0) + 1);
    }
  }
  const topJudge = [...judgeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topJudge.length) {
    tips.push({
      priority: 'high',
      title: 'Judge-Korrekturen häufen sich',
      detail: topJudge.map(([k, n]) => `${k}×${n}`).join(', '),
      do: 'Prompt/Policy oder Action-Builder für die häufigsten Law-IDs nachschärfen',
    });
  }

  for (const f of feedback.items.slice(0, 8)) {
    const issue = f.issue.toLowerCase();
    if (/nav|route|weg|gps/.test(issue)) {
      tips.push({
        priority: 'high',
        title: `Nav/GPS-Feedback: ${f.user}`,
        detail: f.issue.slice(0, 160),
        do: 'Nav-Execution + Cue-Telemetrie im Feedback prüfen; Resolve-Target / Speech-Cues',
      });
    }
    if (/button|aktion|link/.test(issue)) {
      tips.push({
        priority: 'med',
        title: 'Action-Button-Feedback',
        detail: f.issue.slice(0, 160),
        do: 'zeroFakeActions + Button-Sync mit Spoken Places abgleichen',
      });
    }
    if (/falsch|halluz|erfunden|lüg/.test(issue)) {
      tips.push({
        priority: 'high',
        title: 'Fakten-/Halluzinations-Hinweis',
        detail: f.issue.slice(0, 160),
        do: 'Pack-Depth / LIVE-only Policy; betroffenen Ort im Stadt-Pack prüfen',
      });
    }
  }

  if (beta.autoReady?.length) {
    tips.push({
      priority: 'high',
      title: `${beta.autoReady.length} Situation-Blaupausen auto-ready`,
      detail: beta.autoReady
        .slice(0, 5)
        .map((c) => c.situation_key)
        .join(', '),
      do: 'npm run beta:situations:promote -- --ids … nach Review',
    });
  }

  if (packs.changedLocal?.length === 0 && !packs.gitLog?.length) {
    tips.push({
      priority: 'low',
      title: 'Keine Pack-Änderungen diese Woche',
      detail: 'Datenstand unverändert',
      do: 'Bei Feedback zu Orten: city:auto / Deep-Research / upload:city',
    });
  }

  const affHits = affiliate.filter((a) => a.fromFeedback);
  if (affHits.length) {
    tips.push({
      priority: 'med',
      title: 'Affiliate-Momente im Feedback',
      detail: affHits.map((a) => a.label).join('; '),
      do: 'helpFirstMonetization / partnerRouter für diese Momente prüfen',
    });
  }

  if (!tips.length) {
    tips.push({
      priority: 'low',
      title: 'Ruhige Woche',
      detail: 'Kein starkes Signal aus Feedback/Judge',
      do: 'Offene Blaupausen reviewen; Partner-Dashboards kurz checken',
    });
  }

  // de-dupe by title
  const seen = new Set();
  return tips.filter((t) => {
    if (seen.has(t.title)) return false;
    seen.add(t.title);
    return true;
  });
}

function buildTodos({ feedback, beta, fileBp, packs, play }) {
  const todos = [];
  if (beta.autoReady?.length) {
    todos.push(
      `Situation-Blaupausen freigeben (${beta.autoReady.length}): npm run beta:situations:review && promote`,
    );
  }
  if (beta.pending?.length) {
    todos.push(
      `${beta.pending.length} weitere Candidates reviewen (noch nicht auto-ready)`,
    );
  }
  if (fileBp.reviews?.length) {
    todos.push(
      `${fileBp.reviews.length} Modul-2 Staging-Reviews: data/blueprints/staging/*.review.md`,
    );
  }
  for (const f of feedback.items.slice(0, 5)) {
    todos.push(`Feedback „${f.issue.slice(0, 60)}…“ triagieren (${f.user})`);
  }
  if (packs.changedLocal?.length) {
    todos.push(
      `Pack-Uploads prüfen: ${packs.changedLocal.map((p) => p.id).join(', ')}`,
    );
  }
  if (play.skipped) {
    todos.push(
      'Play Console GCS anbinden (PLAY_REPORTS_BUCKET + Service Account) für echte P&L',
    );
  }
  todos.push('Affiliate-Partner-Dashboards der Woche kurz scannen (GYG, Expedia, AWIN)');
  return todos;
}

function renderMarkdown(data) {
  const {
    weekLabel,
    range,
    summaryLines,
    feedback,
    optimizations,
    beta,
    fileBp,
    packs,
    affiliate,
    apiCost,
    play,
    todos,
  } = data;

  const lines = [];
  lines.push(`# Findus Founder Report — ${weekLabel}`);
  lines.push('');
  lines.push(
    `Zeitraum: **${berlinDateKey(range.from)} → ${berlinDateKey(range.to)}** (${range.days} Tage, Europe/Berlin)`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  for (const s of summaryLines) lines.push(`- ${s}`);
  lines.push('');

  lines.push('## P&L');
  lines.push('');
  if (play.skipped) {
    lines.push(`_Play-Daten fehlen: ${play.reason}_`);
    lines.push('');
  }
  const pnl = play.pnl;
  lines.push(`| Posten | Betrag |`);
  lines.push(`|--------|--------|`);
  lines.push(`| Brutto (Buyer, Estimated Sales) | ${eur(pnl.grossBuyerEur)} |`);
  lines.push(
    `| − Play-Gebühr (${(pnl.playFeeRate * 100).toFixed(0)} %) | ${eur(pnl.playFeeEur)} |`,
  );
  lines.push(`| = nach Play | ${eur(pnl.afterPlayEur)} |`);
  lines.push(
    `| − USt (${(pnl.vatRate * 100).toFixed(0)} %) | ${eur(pnl.vatEur)} |`,
  );
  lines.push(`| = nach Steuer | ${eur(pnl.netAfterTaxEur)} |`);
  lines.push(
    `| − API-Kosten (${apiCost.source}) | ${eur(apiCost.totalEur)} |`,
  );
  lines.push(`| **Netto-Gewinn** | **${eur(pnl.profitEur)}** |`);
  lines.push('');
  if (play.transactions != null) {
    lines.push(
      `Transaktionen: ${play.transactions} charged / ${play.refunds} refunds` +
        (play.package ? ` · Package \`${play.package}\`` : ''),
    );
    lines.push('');
  }
  for (const n of play.notes || []) lines.push(`> ${n}`);
  if ((play.notes || []).length) lines.push('');
  lines.push(`[Play Financial Reports](${PLAY_CONSOLE_FINANCIAL_URL})`);
  lines.push('');
  if (data.fleetCostMd) {
    lines.push(data.fleetCostMd.trim());
    lines.push('');
  }

  lines.push('## User-Feedback');
  lines.push('');
  if (!feedback.items.length) {
    lines.push('_Kein neues Feedback in diesem Zeitraum._');
  } else {
    lines.push(`${feedback.items.length} neue Einträge (Cloud gesamt: ${feedback.totalCloud ?? '—'})`);
    lines.push('');
    for (const f of feedback.items) {
      lines.push(`### ${f.at} — ${f.user}`);
      lines.push(`- **Problem:** ${f.issue || '—'}`);
      lines.push(`- **Gewünscht:** ${f.desired || '—'}`);
      if (f.speechUser?.length) {
        lines.push(`- **User sagte:** ${f.speechUser.map((s) => `„${s}“`).join(' / ')}`);
      }
      if (f.speechFindus?.length) {
        lines.push(
          `- **Findus sagte:** ${f.speechFindus.map((s) => `„${String(s).slice(0, 120)}“`).join(' / ')}`,
        );
      }
      if (f.clickedLabels?.length) {
        lines.push(`- **Buttons geklickt:** ${f.clickedLabels.join(', ')}`);
      }
      if (f.judgeCorrections?.length) {
        lines.push(`- **Judge:** ${f.judgeCorrections.join(', ')}`);
      }
      if (f.lastUi?.length) lines.push(`- **UI:** ${f.lastUi.join(' → ')}`);
      if (f.navActive) lines.push(`- **Nav:** aktiv in Telemetrie-Fenster`);
      lines.push('');
    }
  }

  lines.push('## Optimierungen');
  lines.push('');
  for (const t of optimizations) {
    lines.push(`- **[${t.priority}] ${t.title}** — ${t.detail}`);
    lines.push(`  - → ${t.do}`);
  }
  lines.push('');

  lines.push('## Blaupausen zum Freigeben');
  lines.push('');
  lines.push('### Situation (Beta / Crowd)');
  if (beta.autoReady?.length) {
    lines.push('**Kannst du freigeben (auto-ready / ≥3 User):**');
    for (const c of beta.autoReady) {
      lines.push(
        `- \`${c.situation_key}\` users=${c.unique_contributors} — ${c.summary || '—'}`,
      );
    }
  } else {
    lines.push('_Keine auto-ready Candidates._');
  }
  lines.push('');
  if (beta.pending?.length) {
    lines.push('**Brauch Nacharbeit / manuelles Review:**');
    for (const c of beta.pending.slice(0, 20)) {
      lines.push(
        `- [${c.status}] \`${c.situation_key}\` users=${c.unique_contributors} — ${c.summary || '—'}`,
      );
    }
  }
  lines.push('');
  lines.push(
    `Active live: ${beta.active?.length ?? 0} · Promote: \`npm run beta:situations:promote -- --ids …\``,
  );
  lines.push('');
  lines.push('### Modul-2 Staging (Repo)');
  if (fileBp.reviews?.length) {
    for (const d of fileBp.digests) {
      lines.push(`- \`${d.file}\``);
    }
  } else {
    lines.push('_Keine offenen \`*.review.md\` in data/blueprints/staging._');
  }
  lines.push('');

  lines.push('## Datenänderungen');
  lines.push('');
  lines.push(
    `Remote index last_global_update: **${packs.lastGlobalUpdate ?? '—'}** · Städte remote: ${packs.remoteCityCount}`,
  );
  lines.push('');
  if (packs.changedLocal?.length) {
    lines.push('Lokal geänderte Packs (mtime):');
    for (const p of packs.changedLocal) {
      lines.push(
        `- \`${p.id}\` data_version=${p.dataVersion ?? '—'}`,
      );
    }
  } else {
    lines.push('_Keine lokalen Pack-mtimes in der Woche._');
  }
  lines.push('');
  if (packs.gitLog?.length) {
    lines.push('Git (data/staedte):');
    for (const g of packs.gitLog) lines.push(`- ${g}`);
  }
  lines.push('');

  lines.push('## Affiliate / Programme');
  lines.push('');
  for (const a of affiliate) {
    const flag = a.fromFeedback ? '🔔 Feedback-Kontext' : '·';
    lines.push(`- ${flag} **${a.label}** — ${a.action} (${a.dashboardHint})`);
  }
  lines.push('');

  lines.push('## To-dos');
  lines.push('');
  for (const t of todos) lines.push(`- [ ] ${t}`);
  lines.push('');
  lines.push('---');
  lines.push('_Erzeugt von `npm run report:weekly`_');
  lines.push('');
  return lines.join('\n');
}

function renderSlack(data, mdPath) {
  const { weekLabel, summaryLines, play, feedback, beta, todos, apiCost } = data;
  const pnl = play.pnl;
  const parts = [];
  parts.push(`*Findus Founder Report — ${weekLabel}*`);
  parts.push('');
  for (const s of summaryLines.slice(0, 6)) parts.push(`• ${s}`);
  parts.push('');
  parts.push(
    `*P&L:* Brutto ${eur(pnl.grossBuyerEur)} → nach Play/USt ${eur(pnl.netAfterTaxEur)} − API ${eur(apiCost.totalEur)} = *Gewinn ${eur(pnl.profitEur)}*`,
  );
  if (play.skipped) parts.push(`_Play: ${play.reason}_`);
  parts.push(
    `Feedback neu: *${feedback.items.length}* · Freigaben auto-ready: *${beta.autoReady?.length ?? 0}* · Review: *${beta.pending?.length ?? 0}*`,
  );
  parts.push('');
  if (feedback.items.length) {
    parts.push('*Top Feedback:*');
    for (const f of feedback.items.slice(0, 3)) {
      parts.push(`• ${f.issue.slice(0, 100) || '(ohne Text)'} _(${f.user})_`);
    }
    parts.push('');
  }
  parts.push('*Nächste Schritte:*');
  for (const t of todos.slice(0, 5)) parts.push(`• ${t}`);
  parts.push('');
  parts.push(`Full report: \`${mdPath}\``);
  return parts.join('\n');
}

function buildSummaryLines(data) {
  const lines = [];
  lines.push(
    `${data.feedback.items.length} neues User-Feedback` +
      (data.feedback.totalCloud != null
        ? ` (Cloud gesamt ${data.feedback.totalCloud})`
        : ''),
  );
  lines.push(
    `Blaupausen: ${data.beta.autoReady?.length ?? 0} freigabefähig, ${data.beta.pending?.length ?? 0} Review, ${data.fileBp.reviews?.length ?? 0} Staging-Dateien`,
  );
  lines.push(
    `Packs: ${data.packs.changedLocal?.length ?? 0} geändert (git), remote last_update=${data.packs.lastGlobalUpdate ?? '—'}`,
  );
  const pnl = data.play.pnl;
  lines.push(
    `P&L-Schätzung: Gewinn ${eur(pnl.profitEur)} (Brutto ${eur(pnl.grossBuyerEur)}, API ${eur(data.apiCost.totalEur)})`,
  );
  if (data.play.skipped) {
    lines.push(`Play Console noch nicht angebunden (${data.play.reason})`);
  }
  const high = data.optimizations.filter((o) => o.priority === 'high');
  if (high.length) {
    lines.push(`Top-Risiko: ${high[0].title}`);
  }
  const aff = data.affiliate.filter((a) => a.fromFeedback);
  if (aff.length) {
    lines.push(`Affiliate-Chance aus Feedback: ${aff.map((a) => a.id).join(', ')}`);
  }
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const range = weekRange(args.days);
  const weekLabel = berlinDateKey(range.to);

  const fleet = await fetchFleetCostDigest({ days: args.days });
  const apiCost = fleet.skipped
    ? estimateApiCostEur()
    : {
        totalEur: fleet.totalConservativeEur,
        source: 'device_cost_daily (conservative list prices)',
        breakdown: {
          geminiEur: null,
          mapsEur: null,
          ttsEur: null,
        },
      };
  const [feedback, beta, packs, play] = await Promise.all([
    collectFeedback(range),
    collectBetaBlueprints(),
    collectPacks(range),
    fetchPlayWeeklyPnl({ ...range, apiCostEur: apiCost.totalEur }),
  ]);
  const fileBp = collectFileBlueprints();
  const affiliate = collectAffiliateHints(feedback.items || []);
  const optimizations = buildOptimizations({
    feedback,
    beta,
    packs,
    affiliate,
  });
  const todos = buildTodos({ feedback, beta, fileBp, packs, play });

  const data = {
    weekLabel,
    range,
    feedback,
    beta,
    fileBp,
    packs,
    affiliate,
    optimizations,
    apiCost,
    fleet,
    fleetCostMd: renderFleetCostMarkdown(fleet),
    play,
    todos,
    summaryLines: [],
  };
  data.summaryLines = buildSummaryLines(data);

  const outDir = path.join(ROOT, 'reports', 'weekly');
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = args.out
    ? path.resolve(ROOT, args.out)
    : path.join(outDir, `${weekLabel}.md`);
  const slackPath = mdPath.replace(/\.md$/i, '.slack.txt');
  const jsonPath = mdPath.replace(/\.md$/i, '.json');

  const md = renderMarkdown(data);
  const slack = renderSlack(data, path.relative(ROOT, mdPath).replace(/\\/g, '/'));

  if (!args.dry) {
    fs.writeFileSync(mdPath, md, 'utf8');
    fs.writeFileSync(slackPath, slack, 'utf8');
    if (args.json) {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    }
  }

  console.log(slack);
  console.log('');
  console.log(`---`);
  console.log(args.dry ? `(dry-run) would write ${mdPath}` : `Wrote ${mdPath}`);
  console.log(args.dry ? `(dry-run) would write ${slackPath}` : `Wrote ${slackPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
