/**
 * Lokale + Crowd-Priors für Akt-3 Stage-Dauern.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../../config/env';
import { blendStageMs, ewmaUpdate, stageKey } from './progressPace';

type LocalStore = {
  byKey: Record<string, { ewmaMs: number; samples: number }>;
};

const PATH = `${FileSystem.documentDirectory ?? ''}reisebuero-stage-timings.json`;

let cache: LocalStore = { byKey: {} };
let crowd: Record<string, { ewmaMs: number; samples: number }> = {};
let loaded = false;

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (!FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as LocalStore;
      if (parsed?.byKey) cache = parsed;
    }
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* soft */
  }
}

export function getResolvedStageMs(path: string | null | undefined, stage: string): number {
  const key = stageKey(path, stage);
  const local = cache.byKey[key]?.ewmaMs ?? cache.byKey[`default::${stage}`]?.ewmaMs;
  const c = crowd[key] ?? crowd[`default::${stage}`];
  return blendStageMs(stage, local, c?.ewmaMs, c?.samples ?? 0);
}

export async function recordStageDuration(opts: {
  path?: string | null;
  stage: string;
  durationMs: number;
}): Promise<void> {
  await ensureLoaded();
  const ms = opts.durationMs;
  if (!Number.isFinite(ms) || ms < 400 || ms > 1_800_000) return;
  const key = stageKey(opts.path, opts.stage);
  const prev = cache.byKey[key];
  cache.byKey[key] = {
    ewmaMs: ewmaUpdate(prev?.ewmaMs ?? null, ms),
    samples: (prev?.samples ?? 0) + 1,
  };
  void persist();
  void pushCrowdSample(key, ms);
}

async function pushCrowdSample(key: string, durationMs: number): Promise<void> {
  const cfg = supabaseConfig();
  if (!cfg) return;
  try {
    await fetch(`${cfg.base}/rest/v1/rpc/record_reisebuero_stage_timing`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_stage_key: key,
        p_duration_ms: Math.round(durationMs),
      }),
    });
  } catch {
    /* soft */
  }
}

/** Crowd-Priors laden — für alle User. */
export async function pullCrowdStageTimings(): Promise<number> {
  const cfg = supabaseConfig();
  if (!cfg) return 0;
  try {
    const res = await fetch(
      `${cfg.base}/rest/v1/reisebuero_stage_timings?select=stage_key,sample_count,ewma_ms&order=sample_count.desc&limit=200`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    if (!res.ok) return 0;
    const rows = (await res.json()) as Array<{
      stage_key: string;
      sample_count: number;
      ewma_ms: number;
    }>;
    const next: typeof crowd = {};
    for (const r of rows) {
      if (!r.stage_key || !(r.ewma_ms > 0)) continue;
      next[r.stage_key] = {
        ewmaMs: r.ewma_ms,
        samples: r.sample_count || 1,
      };
    }
    crowd = next;
    return Object.keys(crowd).length;
  } catch {
    return 0;
  }
}

export async function warmProgressLearning(): Promise<void> {
  await ensureLoaded();
  await pullCrowdStageTimings();
}

/** Test-Hook: Cache zurücksetzen. */
export function __resetProgressLearningForTests(): void {
  cache = { byKey: {} };
  crowd = {};
  loaded = true;
}

export function __injectCrowdForTests(
  rows: Record<string, { ewmaMs: number; samples: number }>,
): void {
  crowd = { ...rows };
  loaded = true;
}
