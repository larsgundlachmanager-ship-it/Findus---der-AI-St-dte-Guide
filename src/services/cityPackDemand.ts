/**
 * City-Pack Demand: Unique User in Soft-/GPS-Stadt zählen.
 * Ab 10 → Queue; CI/Script baut city:auto + Upload.
 */

import { env } from '../config/env';
import { getOrCreateContributorHash } from './memory/betaSituationQueue';
import {
  getSoftWorkingCity,
  isSoftCityId,
  slugifySoftCityId,
} from './softWorkingCity';
import { getCachedUserProfile } from './userProfileService';
import { loadCityCatalog } from './cityCatalogService';

/** Ab so vielen Unique-Usern lohnt sich voller Datensatz. */
export const CITY_PACK_DEMAND_THRESHOLD = 10;

const PING_GAP_MS = 6 * 60 * 60_000; // max 1× / 6 h pro Stadt lokal

type PingResult = {
  ok: boolean;
  cityId?: string;
  cityName?: string;
  uniqueUsers?: number;
  threshold?: number;
  status?: string;
  becameQueued?: boolean;
  error?: string;
};

let lastPingCityId: string | null = null;
let lastPingAtMs = 0;
let catalogIdsCache: Set<string> | null = null;
let catalogIdsAtMs = 0;

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

/** soft_wedel / Soft-ID → kanonische Pack-ID. */
export function normalizeDemandCityId(
  id: string | null | undefined,
  name?: string | null,
): string | null {
  let raw = (id || '').trim().toLowerCase();
  if (raw.startsWith('soft_')) raw = raw.slice(5);
  if (!raw && name) {
    raw = slugifySoftCityId(name).replace(/^soft_/, '');
  }
  raw = raw.replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
  return raw.length >= 2 ? raw : null;
}

async function knownCatalogIds(): Promise<Set<string>> {
  const now = Date.now();
  if (catalogIdsCache && now - catalogIdsAtMs < 30 * 60_000) {
    return catalogIdsCache;
  }
  try {
    const cat = await loadCityCatalog(null);
    catalogIdsCache = new Set(cat.map((c) => c.id.toLowerCase()));
    catalogIdsAtMs = now;
    return catalogIdsCache;
  } catch {
    return catalogIdsCache ?? new Set();
  }
}

/**
 * Ping aktuelle Soft-/Arbeitsstadt (nur wenn noch kein Pack im Katalog).
 */
export async function maybePingCityPackDemand(opts?: {
  lat?: number | null;
  lng?: number | null;
  force?: boolean;
}): Promise<PingResult | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const working = getSoftWorkingCity();
  const profile = getCachedUserProfile();
  const rawId =
    working?.id ||
    (profile?.cityId && isSoftCityId(profile.cityId) ? profile.cityId : null);
  const name = working?.name || profile?.cityName || null;
  const cityId = normalizeDemandCityId(rawId, name);
  if (!cityId || !name) return null;

  // Schon voller Katalog-Eintrag → kein Demand
  const known = await knownCatalogIds();
  if (known.has(cityId)) return null;

  // Soft-Arbeitsstadt oder außerhalb Pack-Speech
  const soft =
    working?.soft === true ||
    isSoftCityId(working?.id) ||
    isSoftCityId(profile?.cityId);
  if (!soft && !opts?.force) return null;

  const now = Date.now();
  if (
    !opts?.force &&
    lastPingCityId === cityId &&
    now - lastPingAtMs < PING_GAP_MS
  ) {
    return null;
  }

  const hash = await getOrCreateContributorHash();
  const lat =
    typeof opts?.lat === 'number'
      ? opts.lat
      : typeof working?.lat === 'number'
        ? working.lat
        : null;
  const lng =
    typeof opts?.lng === 'number'
      ? opts.lng
      : typeof working?.lng === 'number'
        ? working.lng
        : null;

  try {
    const res = await fetch(`${cfg.base}/rest/v1/rpc/ping_city_pack_demand`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_city_id: cityId,
        p_city_name: name,
        p_contributor_hash: hash,
        p_lat: lat,
        p_lng: lng,
        p_threshold: CITY_PACK_DEMAND_THRESHOLD,
      }),
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[cityDemand] ping HTTP', res.status);
      }
      return { ok: false, error: `http_${res.status}` };
    }
    const data = (await res.json()) as PingResult;
    lastPingCityId = cityId;
    lastPingAtMs = now;
    if (__DEV__ && data.ok) {
      console.log(
        `[cityDemand] ${data.cityId} users=${data.uniqueUsers}/${data.threshold} status=${data.status}`,
      );
    }
    return data;
  } catch (err) {
    if (__DEV__) console.warn('[cityDemand] ping failed', err);
    return { ok: false, error: 'network' };
  }
}
