/**
 * Community place tips — anonymisierte User-Feedbacks (lecker / Hotel gut).
 * Supabase-Tabelle community_place_feedback; lokal soft-fail wenn fehlt.
 */

import { env } from '../../config/env';
import { haversineMeters } from '../../db/database';

export type CommunityPlaceAggregate = {
  placeKey: string;
  placeName: string;
  placeType: string;
  lat: number | null;
  lng: number | null;
  positiveCount: number;
  negativeCount: number;
  topDishes: string[];
  distanceM: number | null;
};

type FeedbackRow = {
  place_key: string;
  place_name: string;
  place_type?: string | null;
  lat?: number | null;
  lng?: number | null;
  sentiment: number;
  dish_mention?: string | null;
};

function normalizePlaceKey(name: string, lat?: number | null, lng?: number | null): string {
  const n = name
    .toLowerCase()
    .replace(/^hotel\s+/i, '')
    .replace(/[^a-zäöüß0-9]+/giu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    // ~1.1 km cell — groups nearby same-name tips
    const cellLat = Math.round(lat * 100) / 100;
    const cellLng = Math.round(lng * 100) / 100;
    return `${n}@${cellLat},${cellLng}`;
  }
  return n;
}

export async function pushCommunityPlaceFeedback(input: {
  placeName: string;
  placeType: string;
  lat?: number | null;
  lng?: number | null;
  cityHint?: string | null;
  sentiment: number;
  tipText: string;
  dishMention?: string | null;
}): Promise<void> {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key) return;

  const place_key = normalizePlaceKey(input.placeName, input.lat, input.lng);
  try {
    const res = await fetch(`${base}/rest/v1/community_place_feedback`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        place_key,
        place_name: input.placeName,
        place_type: input.placeType,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        city_hint: input.cityHint ?? null,
        sentiment: input.sentiment,
        tip_text: input.tipText.slice(0, 200),
        dish_mention: input.dishMention ?? null,
      }),
    });
    if (__DEV__ && !res.ok && res.status !== 404) {
      console.warn('[community-tips] push', res.status);
    }
  } catch (err) {
    if (__DEV__) console.warn('[community-tips] push failed:', err);
  }

  if (input.sentiment > 0 && input.placeName.trim().length >= 3) {
    try {
      const { contributeDiscoveredPlace } = await import('./collectiveLearning');
      void contributeDiscoveredPlace({
        name: input.placeName,
        placeType: input.placeType || 'place',
        cityHint: input.cityHint,
        lat: input.lat,
        lng: input.lng,
        factText: input.tipText.slice(0, 200),
        sourceTrust: 0.5,
      });
    } catch {
      /* soft */
    }
  }
}

function aggregateRows(
  rows: FeedbackRow[],
  origin: { lat: number; lng: number } | null,
): CommunityPlaceAggregate[] {
  const map = new Map<
    string,
    CommunityPlaceAggregate & { dishCounts: Map<string, number> }
  >();

  for (const r of rows) {
    const key = r.place_key;
    let cur = map.get(key);
    if (!cur) {
      const dist =
        origin &&
        typeof r.lat === 'number' &&
        typeof r.lng === 'number'
          ? haversineMeters(origin.lat, origin.lng, r.lat, r.lng)
          : null;
      cur = {
        placeKey: key,
        placeName: r.place_name,
        placeType: r.place_type ?? 'custom',
        lat: r.lat ?? null,
        lng: r.lng ?? null,
        positiveCount: 0,
        negativeCount: 0,
        topDishes: [],
        distanceM: dist,
        dishCounts: new Map(),
      };
      map.set(key, cur);
    }
    if (r.sentiment > 0) cur.positiveCount += 1;
    else if (r.sentiment < 0) cur.negativeCount += 1;
    if (r.dish_mention) {
      const d = r.dish_mention.trim();
      if (d) cur.dishCounts.set(d, (cur.dishCounts.get(d) ?? 0) + 1);
    }
  }

  return [...map.values()]
    .map((c) => {
      const topDishes = [...c.dishCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
      const { dishCounts: _d, ...rest } = c;
      return { ...rest, topDishes };
    })
    .filter((c) => c.positiveCount + c.negativeCount > 0)
    .sort((a, b) => {
      const score = (x: CommunityPlaceAggregate) =>
        x.positiveCount * 2 - x.negativeCount;
      return score(b) - score(a);
    });
}

/**
 * Lädt Community-Feedback in der Nähe (anon read). Soft-fail → [].
 */
export async function fetchCommunityPlaceTipsNear(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  limit?: number;
}): Promise<CommunityPlaceAggregate[]> {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key) return [];

  const radius = opts.radiusM ?? 2500;
  // Bounding box rough filter (PostgREST)
  const dLat = radius / 111_000;
  const dLng = radius / (111_000 * Math.cos((opts.lat * Math.PI) / 180));
  const minLat = opts.lat - dLat;
  const maxLat = opts.lat + dLat;
  const minLng = opts.lng - dLng;
  const maxLng = opts.lng + dLng;

  try {
    const url =
      `${base}/rest/v1/community_place_feedback?select=place_key,place_name,place_type,lat,lng,sentiment,dish_mention` +
      `&lat=gte.${minLat}&lat=lte.${maxLat}&lng=gte.${minLng}&lng=lte.${maxLng}` +
      `&limit=400`;

    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as FeedbackRow[];
    if (!Array.isArray(rows)) return [];

    const filtered = rows.filter((r) => {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return true;
      return (
        haversineMeters(opts.lat, opts.lng, r.lat, r.lng) <= radius + 50
      );
    });

    return aggregateRows(filtered, { lat: opts.lat, lng: opts.lng }).slice(
      0,
      opts.limit ?? 8,
    );
  } catch {
    return [];
  }
}

/** Speech-/Prompt-Zeile aus Aggregat. */
export function formatCommunityTipSpeech(
  tip: CommunityPlaceAggregate,
): string | null {
  const total = tip.positiveCount + tip.negativeCount;
  if (tip.positiveCount < 3) return null; // zu wenig Signal
  const disappointRate =
    total > 0 ? tip.negativeCount / total : 0;
  if (disappointRate > 0.35) return null;

  let crowd: string;
  if (tip.positiveCount >= 100) {
    crowd = `über ${Math.floor(tip.positiveCount / 10) * 10} Findus-User`;
  } else if (tip.positiveCount >= 20) {
    crowd = 'schon viele Findus-User';
  } else {
    crowd = 'schon mehrere Findus-User';
  }

  const rarely =
    disappointRate < 0.15
      ? 'und wurden selten enttäuscht'
      : 'und waren meist zufrieden';

  let dish = '';
  if (tip.topDishes[0]) {
    dish = ` Besonders den ${tip.topDishes[0]} empfehlen andere.`;
  }

  const kind =
    tip.placeType === 'hotel'
      ? 'dieses Hotel'
      : tip.placeType === 'restaurant'
        ? 'dieses Restaurant'
        : tip.placeName;

  return `Hey — ${kind === tip.placeName ? tip.placeName : `${kind} (${tip.placeName})`} haben ${crowd} schon ausprobiert ${rarely}.${dish}`;
}

export function communityTipsPromptBlock(
  tips: CommunityPlaceAggregate[],
): string {
  const lines = tips
    .map((t) => {
      const speech = formatCommunityTipSpeech(t);
      if (!speech) return null;
      return `- ${t.placeName}: +${t.positiveCount}/−${t.negativeCount}${
        t.topDishes[0] ? ` · Gerichte: ${t.topDishes.join(', ')}` : ''
      } → Stimme: „${speech}“`;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return [
    '=== COMMUNITY-TIPPS (anonym, von Findus-Usern) ===',
    'Wenn relevant: natürlich einflechten (nicht als Werbung). Schwache Signale (<3 positiv) ignorieren.',
    ...lines,
  ].join('\n');
}
