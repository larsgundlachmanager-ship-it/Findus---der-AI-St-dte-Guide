/**
 * Street View / Places imagery — download ONCE, serve from local DB.
 * Hard TTL: 6 months. NO polling Google for timestamp updates.
 */

import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../../db/database';

const SV_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 6 months
const CACHE_DIR = `${FileSystem.documentDirectory}streetview-cache/`;
const HEADING_BUCKET_DEG = 45;

let tableReady: Promise<void> | null = null;

function geohashCell(lat: number, lng: number, precision = 5): string {
  const p = Math.max(3, Math.min(precision, 6));
  const scale = 10 ** p;
  return `${Math.round(lat * scale)}_${Math.round(lng * scale)}`;
}

function headingBucket(headingDeg: number): number {
  const h = ((Math.round(headingDeg) % 360) + 360) % 360;
  return Math.round(h / HEADING_BUCKET_DEG) * HEADING_BUCKET_DEG;
}

function cacheKey(lat: number, lng: number, headingDeg: number): string {
  return `${geohashCell(lat, lng)}_${headingBucket(headingDeg)}`;
}

async function ensureStreetViewCache(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDatabase();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS street_view_cache (
        cache_key TEXT PRIMARY KEY NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        heading_bucket INTEGER NOT NULL,
        file_uri TEXT,
        base64_preview TEXT,
        available INTEGER NOT NULL DEFAULT 1,
        fetched_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sv_cache_fetched
        ON street_view_cache(fetched_at_ms);
    `);
    try {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    } catch {
      /* exists */
    }
  })();
  try {
    await tableReady;
  } catch (err) {
    tableReady = null;
    throw err;
  }
}

type SvRow = {
  cache_key: string;
  file_uri: string | null;
  base64_preview: string | null;
  available: number;
  fetched_at_ms: number;
};

/**
 * Look up cached Street View. Returns:
 * - hit with base64 / file
 * - miss (null) if absent or past 6-month TTL
 * Never revalidates timestamps with Google on hits.
 */
export async function getCachedStreetView(
  lat: number,
  lng: number,
  headingDeg: number,
): Promise<{ base64: string | null; available: boolean } | null> {
  await ensureStreetViewCache();
  const db = await getDatabase();
  const key = cacheKey(lat, lng, headingDeg);
  const row = await db.getFirstAsync<SvRow>(
    `SELECT cache_key, file_uri, base64_preview, available, fetched_at_ms
     FROM street_view_cache WHERE cache_key = ?`,
    key,
  );
  if (!row) return null;
  if (Date.now() - row.fetched_at_ms > SV_TTL_MS) {
    // Hard TTL expired — drop local row; next call may re-download once
    if (row.file_uri) {
      try {
        await FileSystem.deleteAsync(row.file_uri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
    await db.runAsync(`DELETE FROM street_view_cache WHERE cache_key = ?`, key);
    return null;
  }

  if (row.available === 0) {
    return { base64: null, available: false };
  }

  if (row.base64_preview) {
    return { base64: row.base64_preview, available: true };
  }

  if (row.file_uri) {
    try {
      const info = await FileSystem.getInfoAsync(row.file_uri);
      if (info.exists) {
        const b64 = await FileSystem.readAsStringAsync(row.file_uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return { base64: b64, available: true };
      }
    } catch {
      /* fall through to miss */
    }
  }
  return null;
}

/** Persist a Street View image (or negative availability) for 6 months. */
export async function putCachedStreetView(opts: {
  lat: number;
  lng: number;
  headingDeg: number;
  base64: string | null;
  available: boolean;
}): Promise<void> {
  await ensureStreetViewCache();
  const db = await getDatabase();
  const key = cacheKey(opts.lat, opts.lng, opts.headingDeg);
  const heading = headingBucket(opts.headingDeg);
  let fileUri: string | null = null;
  let preview: string | null = null;

  if (opts.available && opts.base64) {
    fileUri = `${CACHE_DIR}${key}.jpg`;
    try {
      await FileSystem.writeAsStringAsync(fileUri, opts.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      fileUri = null;
    }
    // Keep a short preview in SQLite only if small enough
    if (opts.base64.length <= 120_000) {
      preview = opts.base64;
    }
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO street_view_cache
      (cache_key, lat, lng, heading_bucket, file_uri, base64_preview, available, fetched_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    key,
    opts.lat,
    opts.lng,
    heading,
    fileUri,
    preview,
    opts.available ? 1 : 0,
    Date.now(),
  );
}

/** Rows newer than sinceMs for nightly community sync. */
export async function collectStreetViewDelta(
  sinceMs: number,
): Promise<Array<Record<string, unknown>>> {
  try {
    await ensureStreetViewCache();
    const db = await getDatabase();
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT cache_key, lat, lng, heading_bucket, available, fetched_at_ms
       FROM street_view_cache
       WHERE fetched_at_ms > ? AND available = 1
       ORDER BY fetched_at_ms DESC LIMIT 100`,
      sinceMs,
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export const STREET_VIEW_TTL_MS = SV_TTL_MS;
