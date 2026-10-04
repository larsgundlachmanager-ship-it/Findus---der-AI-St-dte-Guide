/**
 * Phase 6 — Activity-Prefetch (Alster→SUP).
 * Fact-Turn wärmt Verleiher; Follow-up spricht sofort aus Cache (Preise → Call-3).
 */

import type { ActivitySportResearchResult } from './activitySportResearch';
import type { ActivityKind } from './activitySportQuery';
import {
  cityBiasForNamed,
  detectActivityKind,
  extractNamedActivityPlace,
} from './activitySportQuery';

async function loadResearchActivitySport() {
  const m = await import('./activitySportResearch');
  return m.researchActivitySport;
}

const PREFETCH_TTL_MS = 20 * 60_000;

type CacheEntry = {
  atMs: number;
  key: string;
  result: ActivitySportResearchResult;
  pricesFetched: boolean;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ActivitySportResearchResult>>();

export function activityPrefetchKey(opts: {
  kind: ActivityKind;
  namedPlace: string | null;
  cityHint?: string | null;
}): string {
  const city =
    cityBiasForNamed(opts.namedPlace, opts.cityHint?.trim() || null) || '';
  return `${opts.kind}|${(opts.namedPlace || '').toLowerCase()}|${city.toLowerCase()}`;
}

function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return Boolean(entry && Date.now() - entry.atMs < PREFETCH_TTL_MS);
}

/** Bekannte Gewässer-Anker für Prefetch (stadt-agnostisch per Name). */
export function extractWaterAnchorName(text: string): string | null {
  const fromActivity = extractNamedActivityPlace(text);
  if (fromActivity) return fromActivity;
  const m = String(text || '').match(
    /\b(außenalster|aussenalster|innenalster|alster|elb[e]?|binnenalster)\b/iu,
  );
  if (!m?.[1]) return null;
  const raw = m[1];
  if (/außenalster|aussenalster/i.test(raw)) return 'Außenalster';
  if (/innenalster|binnenalster/i.test(raw)) return 'Innenalster';
  if (/^elb/i.test(raw)) return 'Elbe';
  return 'Alster';
}

function defaultSearchCoords(named: string | null): { lat: number; lng: number } {
  if (named && /alster/i.test(named)) return { lat: 53.559, lng: 10.008 };
  if (named && /elb/i.test(named)) return { lat: 53.543, lng: 9.97 };
  return { lat: 53.55, lng: 9.99 };
}

export function peekPrefetchedActivity(opts: {
  userText: string;
  cityHint?: string | null;
}): ActivitySportResearchResult | null {
  const kind = detectActivityKind(opts.userText);
  let named =
    extractNamedActivityPlace(opts.userText) ||
    extractWaterAnchorName(opts.userText);
  if (!named) {
    try {
      const { getLastWaterAnchor } = require('../../module2/context/shortTermContext') as {
        getLastWaterAnchor: () => string | null;
      };
      named = getLastWaterAnchor();
    } catch {
      /* soft */
    }
  }
  const key = activityPrefetchKey({
    kind,
    namedPlace: named,
    cityHint: opts.cityHint,
  });
  const hit = cache.get(key);
  if (fresh(hit)) return hit.result;
  // Fallback: any fresh entry for same kind (Prefetch vor Follow-up-Text)
  for (const entry of cache.values()) {
    if (
      fresh(entry) &&
      entry.result.kind === kind &&
      entry.result.primary
    ) {
      return entry.result;
    }
  }
  return null;
}

export function clearActivityPrefetchCache(): void {
  cache.clear();
  inflight.clear();
}

/** Test/Inject: Cache setzen ohne Places. */
export function seedActivityPrefetchForTest(
  opts: {
    kind: ActivityKind;
    namedPlace: string | null;
    cityHint?: string | null;
  },
  result: ActivitySportResearchResult,
  pricesFetched = false,
): void {
  const key = activityPrefetchKey(opts);
  cache.set(key, {
    atMs: Date.now(),
    key,
    result,
    pricesFetched,
  });
}

function noteInventoryFromResult(
  query: string,
  result: ActivitySportResearchResult,
): void {
  try {
    const {
      noteLastLiveInventory,
      noteActivityInventoryDetails,
    } = require('../../module2/context/shortTermContext') as {
      noteLastLiveInventory: (o: {
        kind: 'activity_rental';
        query: string;
      }) => void;
      noteActivityInventoryDetails: (o: {
        anchor: string | null;
        must: string[];
        venues: Array<{
          name: string;
          lat: number;
          lng: number;
          websiteUrl?: string | null;
          priceLabel?: string | null;
        }>;
      }) => void;
    };
    const q = (query || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!q) return;
    noteLastLiveInventory({ kind: 'activity_rental', query: q });
    const venues = [result.primary, result.alternative]
      .filter(Boolean)
      .map((v) => ({
        name: v!.name,
        lat: v!.lat,
        lng: v!.lng,
        websiteUrl: v!.websiteUri,
        priceLabel: v!.priceLabel ?? null,
      }));
    noteActivityInventoryDetails({
      anchor: result.namedPlace,
      must: [result.kind, result.namedPlace].filter(Boolean) as string[],
      venues,
    });
    // Phase 7: Verleiher → Spot-Inbox (fire-and-forget)
    if (venues.length) {
      void import('./persistLiveResearch')
        .then(({ persistActivitySportHits }) =>
          persistActivitySportHits({
            userText: q,
            cityHint: result.namedPlace,
            venues: venues.map((v) => ({
              name: v.name,
              lat: v.lat,
              lng: v.lng,
              websiteUri: v.websiteUrl,
              priceLabel: v.priceLabel,
            })),
          }),
        )
        .catch(() => {});
    }
  } catch {
    /* soft */
  }
}

/**
 * Fire-and-forget nach Gewässer-Fakt (Alster-Größe → SUP-Verleiher warm).
 * Ohne Preise — die holt Call-3 / Follow-up.
 */
export function prefetchActivitySport(opts: {
  namedPlace: string;
  cityHint?: string | null;
  lat?: number;
  lng?: number;
  kind?: ActivityKind;
  queryHint?: string;
}): Promise<ActivitySportResearchResult | null> {
  const named = String(opts.namedPlace || '').trim();
  if (!named) return Promise.resolve(null);
  const kind = opts.kind ?? 'sup';
  const city = cityBiasForNamed(named, opts.cityHint ?? null);
  const key = activityPrefetchKey({
    kind,
    namedPlace: named,
    cityHint: city,
  });
  const existing = cache.get(key);
  if (fresh(existing) && existing.result.primary) {
    return Promise.resolve(existing.result);
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const coords =
    opts.lat != null && opts.lng != null
      ? { lat: opts.lat, lng: opts.lng }
      : defaultSearchCoords(named);
  const userText =
    opts.queryHint?.trim() ||
    (kind === 'sup'
      ? `SUP Verleih ${named}${city ? ` ${city}` : ''}`
      : `${kind} ${named}`);

  const run = (async () => {
    try {
      const result = await (await loadResearchActivitySport())({
        userText,
        lat: coords.lat,
        lng: coords.lng,
        cityHint: city,
        skipPriceFetch: true,
      });
      cache.set(key, {
        atMs: Date.now(),
        key,
        result,
        pricesFetched: false,
      });
      noteInventoryFromResult(userText, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

/**
 * Follow-up: Cache/Inflight nutzen — kein zweiter Places-Roundtrip.
 * Preise nachziehen nur wenn Cache ohne Preise und Caller das will.
 */
export async function researchActivitySportCached(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
  signal?: AbortSignal;
  /** default true — Preise später via Call-3 wenn Prefetch hit */
  preferPrefetchWithoutPriceWait?: boolean;
}): Promise<{
  result: ActivitySportResearchResult;
  fromPrefetch: boolean;
  pricesPending: boolean;
}> {
  const kind = detectActivityKind(opts.userText);
  let named = extractNamedActivityPlace(opts.userText);
  if (!named) {
    try {
      const { getLastWaterAnchor } = require('../../module2/context/shortTermContext') as {
        getLastWaterAnchor: () => string | null;
      };
      named = getLastWaterAnchor();
    } catch {
      /* soft */
    }
  }
  const key = activityPrefetchKey({
    kind,
    namedPlace: named,
    cityHint: opts.cityHint,
  });

  const hit = cache.get(key);
  if (fresh(hit) && hit.result.primary) {
    return {
      result: hit.result,
      fromPrefetch: true,
      pricesPending: !hit.pricesFetched && hit.result.priceEur == null,
    };
  }

  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    if (opts.signal?.aborted) {
      return { result, fromPrefetch: true, pricesPending: true };
    }
    return {
      result,
      fromPrefetch: true,
      pricesPending: result.priceEur == null,
    };
  }

  const skipPrice =
    opts.preferPrefetchWithoutPriceWait !== false && kind === 'sup';
  const result = await (await loadResearchActivitySport())({
    userText: opts.userText,
    lat: opts.lat,
    lng: opts.lng,
    cityHint: opts.cityHint,
    signal: opts.signal,
    skipPriceFetch: skipPrice,
  });
  cache.set(key, {
    atMs: Date.now(),
    key,
    result,
    pricesFetched: !skipPrice && result.priceEur != null,
  });
  noteInventoryFromResult(opts.userText, result);
  return {
    result,
    fromPrefetch: false,
    pricesPending: skipPrice && result.priceEur == null,
  };
}

/** Erlaubnis-/Fit-Opener für Gewässer-Follow-ups (Antwort zuerst). */
export function buildWaterActivityAllowSpeech(opts: {
  userText: string;
  namedPlace: string | null;
  kind: ActivityKind;
  research: ActivitySportResearchResult;
}): string {
  const t = opts.userText;
  const named = opts.namedPlace || opts.research.namedPlace;
  const kindLabel =
    opts.kind === 'sup'
      ? 'SUP'
      : opts.kind === 'surf'
        ? 'Surfen'
        : opts.kind === 'bouldering'
          ? 'Bouldern'
          : 'das';
  const permission =
    /\b(kann\s+(?:ich|man)|darf\s+(?:ich|man)|geht\s+(?:das|sup)|erlaubt|möglich|moeglich)\b/iu.test(
      t,
    );
  const parts: string[] = [];
  if (permission && named && opts.kind === 'sup') {
    parts.push(
      `Ja — auf der ${named} kannst du ${kindLabel} fahren.`,
    );
  } else if (permission && opts.kind === 'sup') {
    parts.push(`Ja — ${kindLabel} geht dort.`);
  }
  const body = String(opts.research.spokenDraft || '').trim();
  if (body) parts.push(body);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 900);
}
