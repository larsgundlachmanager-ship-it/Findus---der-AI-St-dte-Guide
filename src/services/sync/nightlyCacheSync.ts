/**
 * Nightly sync of local Google/landmark/geocode cache → cloud (Masterbook €-Saver).
 * Runs around local midnight; zero-cost reads stay local-first.
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';
import { getDatabase } from '../../db/database';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';
import { collectStreetViewDelta } from '../navigation/streetViewCache';

const META_PATH = `${FileSystem.documentDirectory}findus-nightly-cache-sync.json`;

type SyncMeta = {
  lastSyncAtMs: number;
  lastUploadCount: number;
};

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: NativeEventSubscription | null = null;
let immediateTimer: ReturnType<typeof setTimeout> | null = null;
let lastImmediateAtMs = 0;

async function readMeta(): Promise<SyncMeta> {
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return { lastSyncAtMs: 0, lastUploadCount: 0 };
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      lastSyncAtMs: Number(parsed.lastSyncAtMs) || 0,
      lastUploadCount: Number(parsed.lastUploadCount) || 0,
    };
  } catch {
    return { lastSyncAtMs: 0, lastUploadCount: 0 };
  }
}

async function writeMeta(meta: SyncMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

/** Local community push window — Masterbook: ~03:00 nightly update. */
export const COMMUNITY_SYNC_HOUR = 3;
export const COMMUNITY_SYNC_WINDOW_HOURS = 2;

function todaySyncWindowStart(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(COMMUNITY_SYNC_HOUR, 0, 0, 0);
  return start;
}

/** True when local time is in 03:00–05:00 window and not yet synced this cycle. */
export function isInCommunitySyncWindow(lastSyncAtMs: number): boolean {
  const now = new Date();
  const windowStart = todaySyncWindowStart(now);
  const windowEnd = new Date(windowStart);
  windowEnd.setHours(
    COMMUNITY_SYNC_HOUR + COMMUNITY_SYNC_WINDOW_HOURS,
    0,
    0,
    0,
  );

  if (now.getTime() < windowStart.getTime()) {
    return false;
  }

  if (now.getTime() <= windowEnd.getTime()) {
    return lastSyncAtMs < windowStart.getTime();
  }

  // After 05:00 — catch-up until next 03:00 if today's window was missed
  return lastSyncAtMs < windowStart.getTime();
}

async function collectCacheDelta(sinceMs: number): Promise<{
  landmarks: Array<Record<string, unknown>>;
  geocodes: Array<Record<string, unknown>>;
  streetViews: Array<Record<string, unknown>>;
}> {
  const db = await getDatabase();
  const landmarks = await db.getAllAsync<Record<string, unknown>>(
    `SELECT kind, place_id, name, lat, lng, types_json, rating, open_now, geohash, query_key, fetched_at_ms
     FROM landmark_cache WHERE fetched_at_ms > ? ORDER BY fetched_at_ms DESC LIMIT 400`,
    sinceMs,
  );
  const geocodes = await db.getAllAsync<Record<string, unknown>>(
    `SELECT query_norm, label, lat, lng, fetched_at_ms
     FROM geocode_cache WHERE fetched_at_ms > ? ORDER BY fetched_at_ms DESC LIMIT 200`,
    sinceMs,
  );
  let streetViews: Array<Record<string, unknown>> = [];
  try {
    streetViews = await collectStreetViewDelta(sinceMs);
  } catch {
    streetViews = [];
  }
  return {
    landmarks: landmarks ?? [],
    geocodes: geocodes ?? [],
    streetViews,
  };
}

async function uploadDelta(payload: {
  landmarks: Array<Record<string, unknown>>;
  geocodes: Array<Record<string, unknown>>;
  streetViews: Array<Record<string, unknown>>;
  cityHint: string | null;
  poiDrafts?: Array<Record<string, unknown>>;
}): Promise<boolean> {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key) {
    // No cloud — still mark local sync so we don't spin; data stays in SQLite (€0)
    return true;
  }
  if (
    !payload.landmarks.length &&
    !payload.geocodes.length &&
    !payload.streetViews.length &&
    !(payload.poiDrafts?.length)
  ) {
    return true;
  }

  try {
    const res = await fetch(`${base}/rest/v1/community_nav_cache`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        city_hint: payload.cityHint,
        landmarks_json: [
          ...payload.landmarks,
          ...(payload.poiDrafts ?? []),
        ],
        geocodes_json: payload.geocodes,
        street_views_json: payload.streetViews,
        uploaded_at: new Date().toISOString(),
      }),
    });
    // 404 table missing → treat as soft success (local cache remains SSOT)
    if (res.status === 404 || res.status === 401) return true;
    return res.ok || res.status === 201 || res.status === 409;
  } catch {
    return false;
  }
}

/**
 * V7.0: After fetching an unmapped area, push to community DB ASAP
 * (debounced 2.5s, max once / 20s) so future users benefit without waiting for midnight.
 */
export function scheduleImmediateCommunityCachePush(): void {
  if (immediateTimer) clearTimeout(immediateTimer);
  immediateTimer = setTimeout(() => {
    immediateTimer = null;
    void pushCommunityCacheImmediate();
  }, 2_500);
}

export async function pushCommunityCacheImmediate(): Promise<void> {
  const now = Date.now();
  if (now - lastImmediateAtMs < 20_000) return;
  lastImmediateAtMs = now;
  try {
    const since = now - 10 * 60_000;
    const delta = await collectCacheDelta(since);
    if (
      !delta.landmarks.length &&
      !delta.geocodes.length &&
      !delta.streetViews.length
    ) {
      return;
    }
    const cityHint = getCachedUserProfile()?.cityId ?? null;
    const ok = await uploadDelta({ ...delta, cityHint });
    if (__DEV__ && ok) {
      console.log(
        `[community-cache] immediate push L=${delta.landmarks.length} G=${delta.geocodes.length} SV=${delta.streetViews.length}`,
      );
    }
  } catch (err) {
    if (__DEV__) console.warn('[community-cache] immediate push failed:', err);
  }
}

export async function runNightlyCacheSync(opts?: {
  force?: boolean;
}): Promise<{ ok: boolean; uploaded: number }> {
  const meta = await readMeta();
  if (!opts?.force && !isInCommunitySyncWindow(meta.lastSyncAtMs)) {
    return { ok: true, uploaded: 0 };
  }

  const since = Math.max(0, meta.lastSyncAtMs - 60_000);
  let landmarks: Array<Record<string, unknown>> = [];
  let geocodes: Array<Record<string, unknown>> = [];
  let streetViews: Array<Record<string, unknown>> = [];
  try {
    const delta = await collectCacheDelta(since);
    landmarks = delta.landmarks;
    geocodes = delta.geocodes;
    streetViews = delta.streetViews;
  } catch (err) {
    console.warn('[nightly-cache] collect failed:', err);
    return { ok: false, uploaded: 0 };
  }

  const cityHint = getCachedUserProfile()?.cityId ?? null;

  let poiDrafts: Array<Record<string, unknown>> = [];
  let draftIds: string[] = [];
  try {
    const { getUnsyncedPoiDrafts, markPoiDraftsSynced } = await import(
      '../research/poiDiscoveryResearch'
    );
    const drafts = await getUnsyncedPoiDrafts();
    draftIds = drafts.map((d) => d.id);
    poiDrafts = drafts.map((d) => ({
      kind: 'poi_draft',
      place_id: d.id,
      name: d.name,
      lat: d.lat,
      lng: d.lng,
      types_json: JSON.stringify([d.category ?? 'landmark']),
      facts_json: JSON.stringify(d.facts),
      city_id: d.cityId,
      fetched_at_ms: d.researchedAtMs,
    }));
  } catch {
    poiDrafts = [];
  }

  let faqIds: string[] = [];
  try {
    const { getUnsyncedFaqFacts, markFaqFactsSynced } = await import(
      '../memory/module1FaqLearn'
    );
    const faqs = await getUnsyncedFaqFacts();
    faqIds = faqs.map((f) => f.id);
    for (const f of faqs) {
      poiDrafts.push({
        kind: 'poi_faq_fact',
        place_id: f.id,
        name: f.poiName,
        lat: 0,
        lng: 0,
        types_json: JSON.stringify(['faq', f.mustSay ? 'must_say' : 'fact']),
        facts_json: JSON.stringify([
          {
            text: f.factText,
            sourceUrl: f.sourceUrl,
            confidence: f.confidence,
            askCount: f.askCount,
            mustSay: f.mustSay,
            questionCluster: f.questionCluster,
            poiKey: f.poiKey,
            poiId: f.poiId,
          },
        ]),
        city_id: cityHint,
        fetched_at_ms: f.updatedAtMs,
      });
    }
  } catch {
    /* soft */
  }

  const ok = await uploadDelta({
    landmarks,
    geocodes,
    streetViews,
    cityHint,
    poiDrafts,
  });
  if (ok) {
    if (draftIds.length) {
      try {
        const { markPoiDraftsSynced } = await import(
          '../research/poiDiscoveryResearch'
        );
        await markPoiDraftsSynced(draftIds);
      } catch {
        /* soft */
      }
    }
    if (faqIds.length) {
      try {
        const { markFaqFactsSynced } = await import(
          '../memory/module1FaqLearn'
        );
        await markFaqFactsSynced(faqIds);
      } catch {
        /* soft */
      }
    }
    await writeMeta({
      lastSyncAtMs: Date.now(),
      lastUploadCount:
        landmarks.length +
        geocodes.length +
        streetViews.length +
        poiDrafts.length,
    });
  }
  return {
    ok,
    uploaded:
      landmarks.length + geocodes.length + streetViews.length + poiDrafts.length,
  };
}

/** Poll every 15 min + on foreground; sync in local 03:00–05:00 window. */
export function startNightlyCacheSyncMonitor(): () => void {
  if (started) return () => undefined;
  started = true;

  const tick = () => {
    void runNightlyCacheSync();
  };
  tick();
  timer = setInterval(tick, 15 * 60_000);
  appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') tick();
  });

  return () => {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (immediateTimer) clearTimeout(immediateTimer);
    immediateTimer = null;
    appSub?.remove();
    appSub = null;
  };
}
