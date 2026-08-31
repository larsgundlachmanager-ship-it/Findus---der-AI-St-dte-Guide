/**
 * Stadt-Cover dauerhaft unter documentDirectory/cities/covers/.
 * Einmal gesehen/gesucht → JPEG bleibt; App-Neustart lädt nicht neu.
 */

import * as FileSystem from 'expo-file-system';
import type { ImageSourcePropType } from 'react-native';
import { CITY_CARD_HERO } from '../constants/personaPortraits';

function remoteCoverUrl(coverUrl?: string | null): string | null {
  const url = (coverUrl || '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

const DOC = FileSystem.documentDirectory;
const COVER_DIR = DOC ? `${DOC}cities/covers/` : null;
const META_PATH = DOC ? `${DOC}cities/cover-meta.json` : null;

type CoverMeta = Record<string, { url: string; file: string }>;

const memFile = new Map<string, string>();
let meta: CoverMeta = {};
let hydrated = false;
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(cityId: string, url: string): string {
  return `${cityId.trim().toLowerCase()}|${url.trim()}`;
}

function fileNameFor(cityId: string, url: string): string {
  const leaf = url.split('/').pop()?.split('?')[0] || 'cover.jpg';
  const safeLeaf = leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const id = cityId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'city';
  return `${id}_${safeLeaf}`;
}

async function ensureCoverDir(): Promise<boolean> {
  if (!COVER_DIR) return false;
  try {
    const info = await FileSystem.getInfoAsync(COVER_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(COVER_DIR, { intermediates: true });
    }
    return true;
  } catch {
    return false;
  }
}

async function readMeta(): Promise<CoverMeta> {
  if (!META_PATH) return {};
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as CoverMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMeta(next: CoverMeta): Promise<void> {
  if (!META_PATH) return;
  try {
    await ensureCoverDir();
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function hydrateCityCoverCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  meta = await readMeta();
  for (const [id, row] of Object.entries(meta)) {
    if (!row?.url || !row?.file || !COVER_DIR) continue;
    const path = `${COVER_DIR}${row.file}`;
    memFile.set(cacheKey(id, row.url), path);
  }
}

/** Sync-Treffer nach hydrate / erfolgreichem Download. */
export function peekCachedCoverFile(
  cityId: string,
  coverUrl?: string | null,
): string | null {
  const url = remoteCoverUrl(coverUrl);
  if (!url) return null;
  return memFile.get(cacheKey(cityId, url)) ?? null;
}

export async function ensureCityCoverCached(
  cityId: string,
  coverUrl?: string | null,
): Promise<string | null> {
  const url = remoteCoverUrl(coverUrl);
  const id = cityId.trim().toLowerCase();
  if (!url || !id || !COVER_DIR) return null;
  await hydrateCityCoverCache();
  const key = cacheKey(id, url);
  const hit = memFile.get(key);
  if (hit) {
    try {
      const info = await FileSystem.getInfoAsync(hit);
      if (info.exists && (info.size ?? 0) > 80) return hit;
    } catch {
      memFile.delete(key);
    }
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    try {
      const ok = await ensureCoverDir();
      if (!ok || !COVER_DIR) return null;
      const file = fileNameFor(id, url);
      const dest = `${COVER_DIR}${file}`;
      const tmp = `${COVER_DIR}_tmp_${Date.now()}_${file}`;
      const res = await FileSystem.downloadAsync(url, tmp);
      if (res.status < 200 || res.status >= 300) {
        try {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        } catch {
          /* ignore */
        }
        return null;
      }
      try {
        await FileSystem.moveAsync({ from: tmp, to: dest });
      } catch {
        try {
          await FileSystem.deleteAsync(dest, { idempotent: true });
          await FileSystem.moveAsync({ from: tmp, to: dest });
        } catch {
          try {
            await FileSystem.deleteAsync(tmp, { idempotent: true });
          } catch {
            /* ignore */
          }
          return null;
        }
      }
      memFile.set(key, dest);
      meta[id] = { url, file };
      await writeMeta(meta);
      return dest;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

export function cachedCoverImageSource(
  cityId: string,
  coverUrl?: string | null,
  fallback?: ImageSourcePropType,
): ImageSourcePropType {
  const file = peekCachedCoverFile(cityId, coverUrl);
  if (file) {
    return { uri: file.startsWith('file:') ? file : `file://${file}` };
  }
  const remote = remoteCoverUrl(coverUrl);
  if (remote) return { uri: remote };
  return fallback ?? CITY_CARD_HERO;
}
