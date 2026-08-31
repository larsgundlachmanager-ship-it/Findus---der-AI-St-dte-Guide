/**
 * Gerät → Cloud-Inbox: neuer Ort wächst ins offizielle Stadt-Pack
 * (CI: merge + wiki-depth + upload:city).
 */

import { env } from '../../config/env';
import { getOrCreateContributorHash } from '../memory/betaSituationQueue';

export type PackSpotInboxPayload = {
  cityId: string;
  cityName?: string | null;
  name: string;
  lat: number;
  lng: number;
  category?: string | null;
  packRole?: 'story' | 'directory';
  placeTier?: number | null;
  facts: Array<{ text: string; sourceUrl?: string | null }>;
  wikiExtract?: string | null;
  sourceUrl?: string | null;
};

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

export async function submitPackSpotToInbox(
  payload: PackSpotInboxPayload,
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false, error: 'no_supabase' };

  const cityId = payload.cityId.trim().toLowerCase().replace(/^soft_/, '');
  const name = payload.name.trim();
  if (!cityId || cityId.length < 2 || name.length < 2) {
    return { ok: false, error: 'bad_payload' };
  }
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return { ok: false, error: 'bad_coords' };
  }

  let hash = 'anon';
  try {
    hash = await getOrCreateContributorHash();
  } catch {
    /* soft */
  }

  try {
    const res = await fetch(`${cfg.base}/rest/v1/rpc/submit_pack_spot`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_city_id: cityId,
        p_city_name: payload.cityName ?? null,
        p_name: name,
        p_lat: payload.lat,
        p_lng: payload.lng,
        p_category: payload.category ?? null,
        p_pack_role: payload.packRole ?? 'directory',
        p_place_tier: payload.placeTier ?? null,
        p_facts_json: payload.facts.slice(0, 12),
        p_wiki_extract: payload.wikiExtract ?? null,
        p_source_url: payload.sourceUrl ?? null,
        p_contributor_hash: hash,
      }),
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[packSpotInbox] submit HTTP', res.status);
      }
      return { ok: false, error: `http_${res.status}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      duplicate?: boolean;
    };
    return { ok: data?.ok !== false, duplicate: data?.duplicate === true };
  } catch (err) {
    if (__DEV__) console.warn('[packSpotInbox] submit failed', err);
    return { ok: false, error: 'network' };
  }
}
