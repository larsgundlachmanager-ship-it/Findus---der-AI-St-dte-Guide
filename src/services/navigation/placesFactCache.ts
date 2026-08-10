/**
 * Places-Fakten-Cache: Eingang + Dwell-Hint — einmal Google, lokal wiederverwenden.
 */

import * as FileSystem from 'expo-file-system';

export type CachedPlaceFacts = {
  key: string;
  name: string;
  placeId: string | null;
  lat: number;
  lng: number;
  usedEntrance: boolean;
  via: string;
  dwellMinMin?: number;
  dwellMaxMin?: number;
  updatedAtMs: number;
};

const PATH = `${FileSystem.documentDirectory}findus-places-facts-cache.json`;
const MAX = 400;
let byKey: Record<string, CachedPlaceFacts> = {};
let hydrated = false;

function normKey(name: string, placeId?: string | null): string {
  if (placeId?.trim()) return `id:${placeId.trim()}`;
  return `n:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as {
      byKey?: Record<string, CachedPlaceFacts>;
    };
    if (parsed.byKey) byKey = parsed.byKey;
  } catch {
    byKey = {};
  }
}

function persist(): void {
  const entries = Object.entries(byKey)
    .sort((a, b) => b[1].updatedAtMs - a[1].updatedAtMs)
    .slice(0, MAX);
  byKey = Object.fromEntries(entries);
  void FileSystem.writeAsStringAsync(
    PATH,
    JSON.stringify({ byKey, savedAt: Date.now() }),
  ).catch(() => {});
}

export async function getCachedPlaceFacts(
  name: string,
  placeId?: string | null,
): Promise<CachedPlaceFacts | null> {
  await hydrate();
  return byKey[normKey(name, placeId)] ?? null;
}

export function getCachedPlaceFactsSync(
  name: string,
  placeId?: string | null,
): CachedPlaceFacts | null {
  void hydrate();
  return byKey[normKey(name, placeId)] ?? null;
}

export async function putCachedPlaceFacts(
  partial: Omit<CachedPlaceFacts, 'key' | 'updatedAtMs'> & { key?: string },
): Promise<void> {
  await hydrate();
  const key = partial.key ?? normKey(partial.name, partial.placeId);
  const prev = byKey[key];
  byKey[key] = {
    ...prev,
    ...partial,
    key,
    updatedAtMs: Date.now(),
  };
  // Auch unter Name-Key indexieren, wenn placeId gesetzt
  if (partial.placeId && partial.name) {
    const nameKey = normKey(partial.name, null);
    if (nameKey !== key) {
      byKey[nameKey] = { ...byKey[key]!, key: nameKey };
    }
  }
  persist();
}

/** Cache für ein Ziel löschen → nächster Resolve erzwingt frischen Google-Call. */
export async function invalidateCachedPlaceFacts(opts: {
  name?: string | null;
  placeId?: string | null;
}): Promise<boolean> {
  await hydrate();
  let removed = false;
  const keys = new Set<string>();
  if (opts.placeId) keys.add(normKey('', opts.placeId));
  if (opts.name) keys.add(normKey(opts.name, null));
  if (opts.name && opts.placeId) keys.add(normKey(opts.name, opts.placeId));

  // Auch Einträge mit gleichem Namen finden
  if (opts.name) {
    const needle = opts.name.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [k, v] of Object.entries(byKey)) {
      if (v.name?.trim().toLowerCase().replace(/\s+/g, ' ') === needle) {
        keys.add(k);
      }
    }
  }

  for (const k of keys) {
    if (byKey[k]) {
      delete byKey[k];
      removed = true;
    }
  }
  if (removed) persist();
  return removed;
}

/**
 * Bei manuellem Abbruch nahe Ziel oder Nav-Fail: Entrance-Cache invalidieren.
 */
export async function invalidateEntranceCacheOnNavAbort(opts: {
  destName?: string | null;
  placeId?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  userLat?: number | null;
  userLng?: number | null;
  /** Distanz unter der „nahe Ziel abgebrochen“ gilt */
  nearAbortMaxM?: number;
  reason?: 'user_abort_near' | 'nav_fail' | 'manual';
}): Promise<boolean> {
  const nearMax = opts.nearAbortMaxM ?? 180;
  let shouldInvalidate = opts.reason === 'nav_fail' || opts.reason === 'manual';

  if (
    !shouldInvalidate &&
    opts.destLat != null &&
    opts.destLng != null &&
    opts.userLat != null &&
    opts.userLng != null
  ) {
    const dist = haversineM(
      opts.userLat,
      opts.userLng,
      opts.destLat,
      opts.destLng,
    );
    if (dist <= nearMax) shouldInvalidate = true;
  }

  // Ohne Koordinaten aber mit Namen + user_abort_near: trotzdem invalidieren
  if (!shouldInvalidate && opts.reason === 'user_abort_near' && opts.destName) {
    shouldInvalidate = true;
  }

  if (!shouldInvalidate || (!opts.destName && !opts.placeId)) return false;
  return invalidateCachedPlaceFacts({
    name: opts.destName,
    placeId: opts.placeId,
  });
}

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
