/**
 * KI-Wachstum (Phase 10) — Offline → Online → 03:00 Community-Update.
 * Local-first landmark/geocode/Street-View cache grows with use;
 * deltas push to community DB (nightly ~03:00 + immediate on new fetches).
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import * as Network from 'expo-network';
import { env } from '../config/env';
import { haversineMeters } from '../db/database';
import {
  putCachedGeocode,
  queryCachedLandmarksNear,
  upsertCachedLandmarks,
} from '../services/navigation/landmarkCache';
import {
  bearingDegrees,
  fetchNearbyPlaceLandmarks,
  fetchStreetViewImageBase64,
  streetViewAvailable,
} from '../services/navigation/googleMapsNav';
import { isDeviceOffline } from '../services/navigation/networkState';
import {
  getCachedStreetView,
  putCachedStreetView,
} from '../services/navigation/streetViewCache';
import {
  COMMUNITY_SYNC_HOUR,
  pushCommunityCacheImmediate,
  runNightlyCacheSync,
  scheduleImmediateCommunityCachePush,
  startNightlyCacheSyncMonitor,
} from '../services/sync/nightlyCacheSync';
import { startBetaSituationSyncMonitor } from '../services/memory/betaSituationSync';
import { getCachedUserProfile } from '../services/userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';

export type GrowthSnapshot = {
  online: boolean;
  lastPullAtMs: number;
  lastPullImported: number;
  lastWarmAtMs: number;
  pendingCommunityPush: boolean;
  syncHourLocal: number;
};

const WARM_MIN_GAP_MS = 50_000;
const PULL_MIN_GAP_MS = 8 * 60_000;
const ONLINE_PULL_DEBOUNCE_MS = 4_000;

let lastWarmAtMs = 0;
let lastPullAtMs = 0;
let lastPullImported = 0;
let lastOnline = true;
let onlinePullTimer: ReturnType<typeof setTimeout> | null = null;
let netTimer: ReturnType<typeof setInterval> | null = null;
let netSub: NativeEventSubscription | null = null;
let growthStarted = false;

type CommunityNavRow = {
  city_hint?: string | null;
  landmarks_json?: unknown;
  geocodes_json?: unknown;
  street_views_json?: unknown;
  uploaded_at?: string;
};

function asRecordArray(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is Record<string, unknown> =>
      row != null && typeof row === 'object' && !Array.isArray(row),
  );
}

async function mergeCommunityLandmarks(
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  const places = rows
    .map((r) => {
      const name = String(r.name ?? '').trim();
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      let types: string[] = [];
      if (typeof r.types_json === 'string') {
        try {
          types = JSON.parse(r.types_json) as string[];
        } catch {
          types = [];
        }
      } else if (Array.isArray(r.types)) {
        types = r.types.map(String);
      }
      return {
        name,
        lat,
        lng,
        types,
        placeId: r.place_id != null ? String(r.place_id) : undefined,
        rating: typeof r.rating === 'number' ? r.rating : null,
        openNow:
          r.open_now == null
            ? undefined
            : Number(r.open_now) === 1,
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    lat: number;
    lng: number;
    types?: string[];
    placeId?: string;
    rating?: number | null;
    openNow?: boolean;
  }>;

  if (!places.length) return 0;
  await upsertCachedLandmarks('landmark', places);
  return places.length;
}

async function mergeCommunityGeocodes(
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  let count = 0;
  for (const r of rows) {
    const query = String(r.query_norm ?? '').trim();
    const label = String(r.label ?? query).trim();
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (query.length < 2 || !label || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    await putCachedGeocode(query, { lat, lng, label });
    count += 1;
  }
  return count;
}

async function mergeCommunityStreetViewHints(
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  let count = 0;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const heading =
      typeof r.heading_bucket === 'number'
        ? r.heading_bucket
        : Number(r.heading_bucket ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const existing = await getCachedStreetView(lat, lng, heading).catch(
      () => null,
    );
    if (existing?.base64) continue;

    const available = Number(r.available ?? 1) !== 0;
    await putCachedStreetView({
      lat,
      lng,
      headingDeg: heading,
      base64: null,
      available,
    });
    count += 1;
  }
  return count;
}

/**
 * Pull recent community nav cache rows near user / city — soft-fail → 0.
 */
export async function pullCommunityNavCacheNear(opts: {
  lat: number;
  lng: number;
  cityHint?: string | null;
  limit?: number;
}): Promise<{ imported: number }> {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key) return { imported: 0 };

  const cityHint = opts.cityHint ?? getCachedUserProfile()?.cityId ?? null;
  const limit = opts.limit ?? 6;

  try {
    let url =
      `${base}/rest/v1/community_nav_cache?select=city_hint,landmarks_json,geocodes_json,street_views_json,uploaded_at` +
      `&order=uploaded_at.desc&limit=${limit}`;
    if (cityHint) {
      url += `&city_hint=eq.${encodeURIComponent(cityHint)}`;
    }

    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) return { imported: 0 };

    const rows = (await res.json()) as CommunityNavRow[];
    if (!Array.isArray(rows) || !rows.length) return { imported: 0 };

    let imported = 0;
    for (const row of rows) {
      imported += await mergeCommunityLandmarks(asRecordArray(row.landmarks_json));
      imported += await mergeCommunityGeocodes(asRecordArray(row.geocodes_json));
      imported += await mergeCommunityStreetViewHints(
        asRecordArray(row.street_views_json),
      );
    }

    lastPullAtMs = Date.now();
    lastPullImported = imported;
    if (__DEV__ && imported > 0) {
      console.log(`[growth] community pull imported=${imported} city=${cityHint ?? 'any'}`);
    }
    return { imported };
  } catch (err) {
    if (__DEV__) console.warn('[growth] community pull failed:', err);
    return { imported: 0 };
  }
}

/** Background Street View warm — download once, queue community push on new image. */
export async function warmStreetViewForPoint(opts: {
  lat: number;
  lng: number;
  headingDeg: number;
}): Promise<void> {
  try {
    const cached = await getCachedStreetView(opts.lat, opts.lng, opts.headingDeg);
    if (cached?.base64 || cached?.available === false) return;

    const ok = await streetViewAvailable(opts.lat, opts.lng);
    if (!ok) return;

    await fetchStreetViewImageBase64(opts.lat, opts.lng, opts.headingDeg);
  } catch {
    /* soft fail */
  }
}

/** Flow A / GPS: warm landmark + Street View assets for approach target. */
export async function warmApproachVisualAssets(opts: {
  userLat: number;
  userLng: number;
  targetLat: number;
  targetLng: number;
}): Promise<void> {
  const offline = await isDeviceOffline();
  if (offline) return;

  const now = Date.now();
  if (now - lastWarmAtMs < WARM_MIN_GAP_MS) return;
  lastWarmAtMs = now;

  try {
    const cached = await queryCachedLandmarksNear(
      opts.userLat,
      opts.userLng,
      90,
      'landmark',
    );
    if (cached.length < 2) {
      void fetchNearbyPlaceLandmarks(opts.userLat, opts.userLng, 55).catch(
        () => undefined,
      );
    }

    const heading = bearingDegrees(
      opts.userLat,
      opts.userLng,
      opts.targetLat,
      opts.targetLng,
    );
    void warmStreetViewForPoint({
      lat: opts.targetLat,
      lng: opts.targetLng,
      headingDeg: heading,
    });
  } catch {
    /* ignore */
  }
}

async function tickOnlineTransition(): Promise<void> {
  const offline = await isDeviceOffline();
  const online = !offline;

  if (online && !lastOnline) {
    if (onlinePullTimer) clearTimeout(onlinePullTimer);
    onlinePullTimer = setTimeout(() => {
      onlinePullTimer = null;
      void onBackOnline();
    }, ONLINE_PULL_DEBOUNCE_MS);
  }

  lastOnline = online;
}

async function onBackOnline(): Promise<void> {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;

  if (lat != null && lng != null) {
    await pullCommunityNavCacheNear({ lat, lng });
  }

  void pushCommunityCacheImmediate();
}

/**
 * GPS tick — debounced community pull + landmark/SV warm while exploring online.
 */
export async function tickGrowthOnGps(
  lat: number,
  lng: number,
  opts?: {
    headingDeg?: number | null;
    targetLat?: number | null;
    targetLng?: number | null;
  },
): Promise<void> {
  const offline = await isDeviceOffline();
  if (offline) {
    lastOnline = false;
    return;
  }

  const now = Date.now();

  if (now - lastPullAtMs >= PULL_MIN_GAP_MS) {
    void pullCommunityNavCacheNear({ lat, lng });
  }

  const targetLat = opts?.targetLat;
  const targetLng = opts?.targetLng;
  if (
    typeof targetLat === 'number' &&
    typeof targetLng === 'number' &&
    Number.isFinite(targetLat) &&
    Number.isFinite(targetLng) &&
    haversineMeters(lat, lng, targetLat, targetLng) <= 180
  ) {
    void warmApproachVisualAssets({
      userLat: lat,
      userLng: lng,
      targetLat,
      targetLng,
    });
    return;
  }

  if (now - lastWarmAtMs >= WARM_MIN_GAP_MS) {
    void fetchNearbyPlaceLandmarks(lat, lng, 55).catch(() => undefined);
    lastWarmAtMs = now;
  }
}

export function noteGrowthCacheWrite(): void {
  scheduleImmediateCommunityCachePush();
}

export function getGrowthSnapshot(): GrowthSnapshot {
  return {
    online: lastOnline,
    lastPullAtMs,
    lastPullImported,
    lastWarmAtMs,
    pendingCommunityPush: false,
    syncHourLocal: COMMUNITY_SYNC_HOUR,
  };
}

/** Dev: force community push + optional pull at current coords. */
export async function devForceGrowthSync(opts?: {
  lat?: number;
  lng?: number;
}): Promise<{ uploaded: number; imported: number }> {
  let imported = 0;
  if (opts?.lat != null && opts?.lng != null) {
    const pull = await pullCommunityNavCacheNear({
      lat: opts.lat,
      lng: opts.lng,
      limit: 10,
    });
    imported = pull.imported;
  }
  const push = await runNightlyCacheSync({ force: true });
  return { uploaded: push.uploaded, imported };
}

/**
 * Start growth lifecycle: nightly 03:00 push monitor + online comeback pull.
 */
export function startGrowthMonitor(): () => void {
  if (growthStarted) return () => undefined;
  growthStarted = true;

  const stopNightly = startNightlyCacheSyncMonitor();
  const stopBetaSituations = startBetaSituationSyncMonitor();
  let stopCollective: (() => void) | undefined;
  try {
    const { startCollectiveLearningMonitor } = require('../services/memory/collectiveLearning') as {
      startCollectiveLearningMonitor: () => () => void;
    };
    stopCollective = startCollectiveLearningMonitor();
  } catch {
    stopCollective = undefined;
  }

  void Network.getNetworkStateAsync()
    .then((net) => {
      lastOnline =
        net.type !== Network.NetworkStateType.NONE &&
        net.type !== Network.NetworkStateType.UNKNOWN &&
        net.isInternetReachable !== false;
    })
    .catch(() => undefined);

  const netTick = () => {
    void tickOnlineTransition();
  };
  netTick();
  netTimer = setInterval(netTick, 30_000);
  netSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') netTick();
  });

  return () => {
    growthStarted = false;
    stopNightly();
    stopBetaSituations();
    stopCollective?.();
    if (netTimer) clearInterval(netTimer);
    netTimer = null;
    if (onlinePullTimer) clearTimeout(onlinePullTimer);
    onlinePullTimer = null;
    netSub?.remove();
    netSub = null;
  };
}
