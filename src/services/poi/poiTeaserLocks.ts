/**
 * Durable POI teaser LOCK after full story or visit (Masterbook V5 Deduplication).
 * Locked spots never fire Wegweiser/approach teasers again.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-poi-locks.json`;

type LockFile = {
  /** spot_key or `id:${poiId}` */
  locked: string[];
};

let cache: Set<string> | null = null;
let loaded = false;

function keyFor(opts: { spotKey?: string | null; poiId?: number | null }): string | null {
  const sk = opts.spotKey?.trim();
  if (sk) return sk.toLowerCase();
  if (opts.poiId != null && opts.poiId >= 0) return `id:${opts.poiId}`;
  return null;
}

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    const body: LockFile = { locked: [...cache].slice(-800) };
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(body));
  } catch {
    /* ignore */
  }
}

export async function loadPoiTeaserLocks(): Promise<void> {
  if (loaded && cache) return;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as LockFile;
      cache = new Set(
        (parsed.locked ?? []).map((k) => String(k).toLowerCase()).filter(Boolean),
      );
      return;
    }
  } catch {
    /* fresh */
  }
  cache = new Set();
}

export function isPoiTeaserLocked(opts: {
  spotKey?: string | null;
  poiId?: number | null;
}): boolean {
  if (!cache) return false;
  const k = keyFor(opts);
  if (!k) return false;
  return cache.has(k);
}

export async function lockPoiTeaser(opts: {
  spotKey?: string | null;
  poiId?: number | null;
}): Promise<void> {
  await loadPoiTeaserLocks();
  const k = keyFor(opts);
  if (!k || !cache) return;
  if (cache.has(k)) return;
  cache.add(k);
  await persist();
}
