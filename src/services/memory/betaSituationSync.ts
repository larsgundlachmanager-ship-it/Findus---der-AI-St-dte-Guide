/**
 * Evening/night upload of beta situation events + download of active blueprints.
 * Window: local 02:00–04:00 (+ catch-up later if missed).
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';
import { env } from '../../config/env';
import type { SituationBlueprint } from '../../types/situationBlueprints';
import {
  getActiveSituationBlueprintsCached,
  invalidateSituationBlueprintCache,
  listPendingBetaSituationEvents,
  markBetaSituationEventsUploaded,
  saveActiveSituationBlueprintsPack,
} from './betaSituationQueue';
import {
  LEARNED_RULE_AVOID_LABELS,
  LEARNED_RULE_EXPECT_LABELS,
  type LearnedRule,
  type LearnedRuleAvoid,
  type LearnedRuleExpect,
  type LearnedRuleIntentFamily,
} from '../../types/learnedRules';

/** Lightweight intent→family map (avoid importing correctionLearning → cycles). */
function intentToFamilyLocal(intent: string | null | undefined): LearnedRuleIntentFamily {
  const i = (intent ?? '').toLowerCase();
  if (/gastro|dining|food|meal|restaurant/.test(i)) return 'dining';
  if (/hotel|stay|accommodation/.test(i)) return 'hotel';
  if (/event|party|nightlife|ticket|cinema|kino|film/.test(i)) return 'events';
  if (/activit|sport|leisure|booking_platform|rental/.test(i)) return 'activity_poi';
  if (/nav|route|mobility|directions/.test(i)) return 'navigation';
  if (/plan|itinerar|day/.test(i)) return 'planning';
  if (/book|reserv/.test(i)) return 'booking';
  if (/know|histor|museum|poi|story|place/.test(i)) return 'knowledge';
  return 'general';
}

function inferFamilyFromText(text: string): LearnedRuleIntentFamily {
  const blob = text.toLowerCase();
  if (/\b(kino|film|cinema|event|konzert|party|ticket)\b/u.test(blob)) return 'events';
  if (/\b(restaurant|essen|gastro|café|cafe)\b/u.test(blob)) return 'dining';
  if (/\b(hotel|übernacht|uebernacht)\b/u.test(blob)) return 'hotel';
  if (/\b(wasserski|surf|sport|aktivität|buchen)\b/u.test(blob)) return 'activity_poi';
  if (/\b(navig|route|führ\s+mich)\b/u.test(blob)) return 'navigation';
  if (/\b(geschichte|historie|museum)\b/u.test(blob)) return 'knowledge';
  return 'general';
}

const META_PATH = `${FileSystem.documentDirectory}findus-beta-situation-sync.json`;

type SyncMeta = {
  lastUploadAtMs: number;
  lastDownloadAtMs: number;
  lastUploadedCount: number;
};

export const BETA_SITUATION_SYNC_HOUR = 2;
export const BETA_SITUATION_SYNC_WINDOW_HOURS = 2;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: NativeEventSubscription | null = null;

async function readMeta(): Promise<SyncMeta> {
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) {
      return { lastUploadAtMs: 0, lastDownloadAtMs: 0, lastUploadedCount: 0 };
    }
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      lastUploadAtMs: Number(parsed.lastUploadAtMs) || 0,
      lastDownloadAtMs: Number(parsed.lastDownloadAtMs) || 0,
      lastUploadedCount: Number(parsed.lastUploadedCount) || 0,
    };
  } catch {
    return { lastUploadAtMs: 0, lastDownloadAtMs: 0, lastUploadedCount: 0 };
  }
}

async function writeMeta(meta: SyncMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
  } catch {
    /* soft */
  }
}

function todayWindowStart(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(BETA_SITUATION_SYNC_HOUR, 0, 0, 0);
  return start;
}

/** True in 02:00–04:00 or catch-up after window if today's sync not done. */
export function isInBetaSituationSyncWindow(lastUploadAtMs: number): boolean {
  const now = new Date();
  const windowStart = todayWindowStart(now);
  const windowEnd = new Date(windowStart);
  windowEnd.setHours(
    BETA_SITUATION_SYNC_HOUR + BETA_SITUATION_SYNC_WINDOW_HOURS,
    0,
    0,
    0,
  );

  if (now.getTime() >= windowStart.getTime() && now.getTime() <= windowEnd.getTime()) {
    return lastUploadAtMs < windowStart.getTime();
  }

  // After 04:00 until next 02:00: catch-up if today's window was missed
  if (now.getTime() > windowEnd.getTime()) {
    return lastUploadAtMs < windowStart.getTime();
  }

  return false;
}

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

async function uploadPendingEvents(): Promise<number> {
  const cfg = supabaseConfig();
  if (!cfg) return 0;
  const pending = await listPendingBetaSituationEvents();
  if (!pending.length) return 0;

  const rows = pending.map((e) => ({
    event_id: e.eventId,
    contributor_hash: e.contributorHash,
    situation_key: e.situationKey,
    intent_family: e.intentFamily,
    tags: e.tags,
    expect: e.expect,
    avoid: e.avoid,
    summary: e.summary,
    user_type_hint: e.userTypeHint,
    correction_digest: e.correctionDigest,
    prior_user_digest: e.priorUserDigest ?? null,
    created_at: e.createdAt,
  }));

  const res = await fetch(`${cfg.base}/rest/v1/beta_situation_events`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    if (__DEV__) {
      const body = await res.text().catch(() => '');
      console.warn('[beta-situations] upload', res.status, body.slice(0, 200));
    }
    return 0;
  }

  await markBetaSituationEventsUploaded(pending.map((e) => e.eventId));
  return pending.length;
}

async function downloadActiveBlueprints(): Promise<number> {
  const cfg = supabaseConfig();
  if (!cfg) return 0;
  const res = await fetch(
    `${cfg.base}/rest/v1/situation_blueprints_active?select=situation_key,intent_family,tags,expect,avoid,summary,source,version,updated_at&order=updated_at.desc`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
    },
  );
  if (!res.ok) {
    if (__DEV__ && res.status !== 404) {
      console.warn('[beta-situations] download', res.status);
    }
    return 0;
  }
  const rows = (await res.json()) as Array<{
    situation_key: string;
    intent_family: string;
    tags?: string[];
    expect?: string[];
    avoid?: string[];
    summary?: string;
    source?: string;
    version?: number;
    updated_at?: string;
  }>;
  const blueprints: SituationBlueprint[] = (rows ?? []).map((r) => ({
    situationKey: r.situation_key,
    intentFamily: r.intent_family as LearnedRuleIntentFamily,
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    expect: (Array.isArray(r.expect) ? r.expect : []) as LearnedRuleExpect[],
    avoid: (Array.isArray(r.avoid) ? r.avoid : []) as LearnedRuleAvoid[],
    summary: String(r.summary ?? ''),
    source: r.source ?? 'auto_3plus',
    version: Number(r.version) || 1,
    updatedAt: r.updated_at,
  }));
  await saveActiveSituationBlueprintsPack(blueprints);
  invalidateSituationBlueprintCache();
  await getActiveSituationBlueprintsCached(true);
  return blueprints.length;
}

export async function runBetaSituationEveningSync(opts?: {
  force?: boolean;
}): Promise<{ ok: boolean; uploaded: number; downloaded: number }> {
  const meta = await readMeta();
  const shouldUpload =
    opts?.force || isInBetaSituationSyncWindow(meta.lastUploadAtMs);
  // Download at least daily when uploading, or every 12h
  const shouldDownload =
    opts?.force ||
    shouldUpload ||
    Date.now() - meta.lastDownloadAtMs > 12 * 60 * 60 * 1000;

  let uploaded = 0;
  let downloaded = 0;
  let ok = true;

  try {
    if (shouldUpload) {
      uploaded = await uploadPendingEvents();
      meta.lastUploadAtMs = Date.now();
      meta.lastUploadedCount = uploaded;
    }
    if (shouldDownload) {
      downloaded = await downloadActiveBlueprints();
      meta.lastDownloadAtMs = Date.now();
    }
    await writeMeta(meta);
  } catch (err) {
    ok = false;
    if (__DEV__) console.warn('[beta-situations] sync failed', err);
  }

  return { ok, uploaded, downloaded };
}

export function startBetaSituationSyncMonitor(): () => void {
  if (started) return () => undefined;
  started = true;
  const tick = () => {
    void runBetaSituationEveningSync({ force: true });
  };
  tick();
  timer = setInterval(tick, 20 * 60_000);
  appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') tick();
  });
  return () => {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    appSub?.remove();
    appSub = null;
  };
}

/** Map active product blueprints → LearnedRule-shaped for prompt injection. */
export function blueprintsToPseudoRules(
  blueprints: SituationBlueprint[],
): LearnedRule[] {
  const ts = new Date().toISOString();
  return blueprints.map((b) => ({
    id: `bp_${b.situationKey}`,
    scope: 'user' as const,
    intentFamily: b.intentFamily,
    tags: b.tags,
    expect: b.expect,
    avoid: b.avoid,
    summary: b.summary || 'Product situation blueprint',
    strength: b.source === 'owner_gold' ? 0.92 : 0.85,
    hitCount: 0,
    createdAt: ts,
    updatedAt: b.updatedAt ?? ts,
  }));
}

export async function matchProductSituationBlueprints(opts: {
  intent?: string | null;
  userText?: string | null;
  limit?: number;
}): Promise<LearnedRule[]> {
  const pack = await getActiveSituationBlueprintsCached();
  if (!pack.length) return [];
  const family = opts.intent
    ? intentToFamilyLocal(opts.intent)
    : inferFamilyFromText(opts.userText ?? '');
  const text = (opts.userText ?? '').toLowerCase();
  const scored = pack
    .map((b) => {
      let score = 0.5;
      if (b.intentFamily === family) score += 0.4;
      else if (b.intentFamily === 'general' || family === 'general') score += 0.1;
      else score -= 0.2;
      for (const tag of b.tags) {
        if (tag && text.includes(tag.toLowerCase())) score += 0.08;
      }
      for (const e of b.expect) {
        const label = LEARNED_RULE_EXPECT_LABELS[e] ?? e;
        if (text.includes(String(e)) || text.includes(label.slice(0, 8))) {
          score += 0.05;
        }
      }
      void LEARNED_RULE_AVOID_LABELS;
      return { b, score };
    })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3)
    .map((x) => x.b);
  return blueprintsToPseudoRules(scored);
}

export function formatProductBlueprintsPromptBlock(
  rules: LearnedRule[],
): string {
  if (!rules.length) return '';
  const lines = [
    '=== PRODUCT SITUATION-BLAUPAUSEN (Founder-Gold + Beta→Release) ===',
    'Struktur aus Korrekturen. Wortlaut frei. Keine Orts-Hardcodes.',
  ];
  for (const r of rules) {
    const exp = r.expect
      .map((e) => LEARNED_RULE_EXPECT_LABELS[e] ?? e)
      .join('; ');
    const av = r.avoid
      .map((a) => LEARNED_RULE_AVOID_LABELS[a] ?? a)
      .join('; ');
    lines.push(
      `- [${r.intentFamily}] ${r.summary}` +
        (exp ? ` | erwarte: ${exp}` : '') +
        (av ? ` | vermeide: ${av}` : ''),
    );
  }
  return lines.join('\n');
}
