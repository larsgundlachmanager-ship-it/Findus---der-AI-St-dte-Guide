/**
 * Travel-Research-Cache — Fenster, Dest-Scores, Near-Misses, valid_until.
 * Lokal (AsyncStorage); CI/Supabase-Merge optional später.
 */

export type TravelCacheEntry = {
  key: string;
  kind:
    | 'flight_window'
    | 'dest_score'
    | 'stay_harvest'
    | 'near_miss'
    | 'deal_seed'
    | 'surface_fare'
    | 'inspiration_harvest';
  payload: Record<string, unknown>;
  validUntilMs: number;
  updatedAtMs: number;
};

const STORAGE_KEY = 'findus.reisebuero.travel_research.v1';
const MAX_ENTRIES = 120;

let entries: TravelCacheEntry[] = [];
let hydrated = false;

async function getStorage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { entries?: TravelCacheEntry[] };
    if (Array.isArray(p.entries)) entries = p.entries;
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ entries: entries.slice(-MAX_ENTRIES) }),
    );
  } catch {
    /* soft */
  }
}

export function buildTravelCacheKey(parts: {
  origin?: string | null;
  monthBand?: string | null;
  nights?: number | null;
  partySize?: number | null;
  musts?: string[];
  lodgingType?: string | null;
  vibe?: string | null;
}): string {
  return [
    parts.origin ?? '',
    parts.monthBand ?? '',
    parts.nights ?? '',
    parts.partySize ?? '',
    (parts.musts ?? []).slice().sort().join(','),
    parts.lodgingType ?? '',
    parts.vibe ?? '',
  ]
    .join('|')
    .toLowerCase()
    .slice(0, 240);
}

export async function putTravelCache(
  entry: Omit<TravelCacheEntry, 'updatedAtMs'>,
): Promise<void> {
  await hydrate();
  const now = Date.now();
  entries = [
    ...entries.filter((e) => e.key !== entry.key || e.kind !== entry.kind),
    { ...entry, updatedAtMs: now },
  ].slice(-MAX_ENTRIES);
  await persist();
}

export async function getTravelCache(
  key: string,
  kind?: TravelCacheEntry['kind'],
): Promise<TravelCacheEntry | null> {
  await hydrate();
  const now = Date.now();
  const hit = entries.find(
    (e) =>
      e.key === key &&
      (!kind || e.kind === kind) &&
      e.validUntilMs > now,
  );
  return hit ?? null;
}

/** Test helper */
export function _resetTravelCacheForTests(): void {
  entries = [];
  hydrated = true;
}
