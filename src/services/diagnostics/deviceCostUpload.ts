/**
 * Täglicher anonymisierter Kosten-Upload (contributor_hash).
 * Sonntags-Digest liest die Fleet-Summe aus device_cost_daily.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../../config/env';
import { getOrCreateContributorHash } from '../memory/betaSituationQueue';
import { getCostOverviewAsync, getTodayCostUploadPayload } from './apiCostLedger';

const META_PATH = `${FileSystem.documentDirectory}device-cost-upload-v1.json`;
const MIN_GAP_MS = 15 * 60_000;

type UploadMeta = {
  lastDay: string;
  lastAtMs: number;
  lastEur: number;
};

async function readMeta(): Promise<UploadMeta> {
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return { lastDay: '', lastAtMs: 0, lastEur: 0 };
    const parsed = JSON.parse(
      await FileSystem.readAsStringAsync(META_PATH),
    ) as Partial<UploadMeta>;
    return {
      lastDay: typeof parsed.lastDay === 'string' ? parsed.lastDay : '',
      lastAtMs: Number(parsed.lastAtMs) || 0,
      lastEur: Number(parsed.lastEur) || 0,
    };
  } catch {
    return { lastDay: '', lastAtMs: 0, lastEur: 0 };
  }
}

async function writeMeta(meta: UploadMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

/** Upsert today's conservative cost. Safe to call often; debounced per day. */
export async function uploadDeviceCostDay(opts?: {
  force?: boolean;
}): Promise<boolean> {
  const cfg = supabaseConfig();
  if (!cfg) return false;

  await getCostOverviewAsync();
  const payload = getTodayCostUploadPayload();
  if (!opts?.force && payload.conservativeEur < 0.00001 && payload.geminiRequests + payload.mapsRequests < 1) {
    return true;
  }

  const meta = await readMeta();
  const now = Date.now();
  const sameSnapshot =
    meta.lastDay === payload.day &&
    Math.abs(meta.lastEur - payload.conservativeEur) < 0.0005;
  if (!opts?.force && sameSnapshot && now - meta.lastAtMs < MIN_GAP_MS) {
    return true;
  }

  let hash = 'anon';
  try {
    hash = await getOrCreateContributorHash();
  } catch {
    /* soft */
  }
  if (!hash || hash.length < 8) return false;

  try {
    const res = await fetch(`${cfg.base}/rest/v1/rpc/submit_device_cost_day`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_contributor_hash: hash,
        p_day: payload.day,
        p_conservative_eur: payload.conservativeEur,
        p_efficient_eur: payload.efficientEur,
        p_gemini_requests: payload.geminiRequests,
        p_maps_requests: payload.mapsRequests,
        p_tts_chars: payload.ttsChars,
        p_modules: payload.modules,
      }),
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[device-cost] upload HTTP', res.status);
      }
      return false;
    }
    await writeMeta({
      lastDay: payload.day,
      lastAtMs: now,
      lastEur: payload.conservativeEur,
    });
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[device-cost] upload failed', err);
    return false;
  }
}
