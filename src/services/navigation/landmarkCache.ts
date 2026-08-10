/**
 * Persistent landmark / Places / geocode cache (SQLite).
 * Query local first within ~500 m → only hit Google/OSM on miss.
 */

import { getDatabase } from '../../db/database';
import type { DiscoveredPlace, PlaceLandmark } from './googleMapsNav';
import { upsertCachedDestination } from './offlineNavCache';

const CACHE_RADIUS_QUERY_M = 500;
const LANDMARK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let tableReady: Promise<void> | null = null;

function geohashApprox(lat: number, lng: number, precision = 6): string {
  // Simple grid cell (≈0.01° ~1 km at mid latitudes for precision 2 digits → use finer)
  const p = Math.max(3, Math.min(precision, 6));
  const scale = 10 ** p;
  return `${Math.round(lat * scale)}_${Math.round(lng * scale)}`;
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function ensureLandmarkCacheTable(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDatabase();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS landmark_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        place_id TEXT,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        types_json TEXT,
        rating REAL,
        open_now INTEGER,
        geohash TEXT,
        query_key TEXT,
        fetched_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_landmark_cache_geo
        ON landmark_cache(geohash);
      CREATE INDEX IF NOT EXISTS idx_landmark_cache_kind
        ON landmark_cache(kind, query_key);
      CREATE TABLE IF NOT EXISTS geocode_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_norm TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        fetched_at_ms INTEGER NOT NULL
      );
    `);
  })();
  try {
    await tableReady;
  } catch (err) {
    tableReady = null;
    throw err;
  }
}

type CacheRow = {
  name: string;
  lat: number;
  lng: number;
  types_json: string | null;
  rating: number | null;
  open_now: number | null;
  place_id: string | null;
  fetched_at_ms: number;
};

/** Local landmarks within radius (default 500 m). */
export async function queryCachedLandmarksNear(
  lat: number,
  lng: number,
  radiusM = CACHE_RADIUS_QUERY_M,
  kind = 'landmark',
): Promise<PlaceLandmark[]> {
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const now = Date.now();
  // Bounding box ≈ radius + margin
  const deg = (radiusM + 80) / 111_320;
  const rows = await db.getAllAsync<CacheRow>(
    `SELECT name, lat, lng, types_json, rating, open_now, place_id, fetched_at_ms
     FROM landmark_cache
     WHERE kind = ?
       AND lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
       AND fetched_at_ms > ?`,
    kind,
    lat - deg,
    lat + deg,
    lng - deg,
    lng + deg,
    now - LANDMARK_TTL_MS,
  );
  const out: PlaceLandmark[] = [];
  for (const r of rows) {
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d > radiusM) continue;
    let types: string[] = [];
    try {
      types = r.types_json ? (JSON.parse(r.types_json) as string[]) : [];
    } catch {
      types = [];
    }
    out.push({
      name: r.name,
      types,
      lat: r.lat,
      lng: r.lng,
      distanceM: Math.round(d),
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

export async function queryCachedDiscoveriesNear(
  lat: number,
  lng: number,
  placeType: string,
  radiusM = CACHE_RADIUS_QUERY_M,
): Promise<DiscoveredPlace[]> {
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const now = Date.now();
  const deg = (radiusM + 80) / 111_320;
  const rows = await db.getAllAsync<CacheRow>(
    `SELECT name, lat, lng, types_json, rating, open_now, place_id, fetched_at_ms
     FROM landmark_cache
     WHERE kind = ?
       AND (query_key = ? OR query_key IS NULL OR types_json LIKE ?)
       AND lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
       AND fetched_at_ms > ?`,
    'discovery',
    placeType,
    `%${placeType}%`,
    lat - deg,
    lat + deg,
    lng - deg,
    lng + deg,
    now - LANDMARK_TTL_MS,
  );
  const out: DiscoveredPlace[] = [];
  for (const r of rows) {
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d > radiusM) continue;
    let types: string[] = [];
    try {
      types = r.types_json ? (JSON.parse(r.types_json) as string[]) : [];
    } catch {
      types = [];
    }
    out.push({
      placeId: r.place_id ?? `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`,
      name: r.name,
      types,
      lat: r.lat,
      lng: r.lng,
      distanceM: Math.round(d),
      rating: r.rating,
      openNow: r.open_now == null ? true : r.open_now === 1,
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

export async function upsertCachedLandmarks(
  kind: 'landmark' | 'discovery',
  places: Array<{
    name: string;
    lat: number;
    lng: number;
    types?: string[];
    placeId?: string;
    rating?: number | null;
    openNow?: boolean;
  }>,
  queryKey?: string,
): Promise<void> {
  if (!places.length) return;
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const now = Date.now();
  for (const p of places) {
    const gh = geohashApprox(p.lat, p.lng);
    // Dedup: same name+geohash → update
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM landmark_cache
       WHERE kind = ? AND name = ? AND geohash = ? LIMIT 1`,
      kind,
      p.name,
      gh,
    );
    const typesJson = JSON.stringify(p.types ?? []);
    const openNow =
      p.openNow == null ? null : p.openNow ? 1 : 0;
    if (existing?.id != null) {
      await db.runAsync(
        `UPDATE landmark_cache SET
           lat = ?, lng = ?, types_json = ?, rating = ?, open_now = ?,
           place_id = ?, query_key = ?, fetched_at_ms = ?
         WHERE id = ?`,
        p.lat,
        p.lng,
        typesJson,
        p.rating ?? null,
        openNow,
        p.placeId ?? null,
        queryKey ?? null,
        now,
        existing.id,
      );
    } else {
      await db.runAsync(
        `INSERT INTO landmark_cache
          (kind, place_id, name, lat, lng, types_json, rating, open_now, geohash, query_key, fetched_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        kind,
        p.placeId ?? null,
        p.name,
        p.lat,
        p.lng,
        typesJson,
        p.rating ?? null,
        openNow,
        gh,
        queryKey ?? null,
        now,
      );
    }
  }
  for (const p of places) {
    void upsertCachedDestination({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      source: kind === 'discovery' ? 'discovery' : 'search',
      searchQuery: queryKey ?? p.name,
    }).catch(() => undefined);
  }
}

export async function getCachedGeocode(
  query: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const norm = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length < 2) return null;
  const row = await db.getFirstAsync<{
    label: string;
    lat: number;
    lng: number;
    fetched_at_ms: number;
  }>(
    `SELECT label, lat, lng, fetched_at_ms FROM geocode_cache WHERE query_norm = ?`,
    norm,
  );
  if (!row) return null;
  if (Date.now() - row.fetched_at_ms > GEOCODE_TTL_MS) return null;
  return { lat: row.lat, lng: row.lng, label: row.label };
}

/** Navigation: kein TTL — einmal geocodete Orte bleiben offline auffindbar. */
export async function getCachedGeocodeForNav(
  query: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const norm = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length < 2) return null;
  const row = await db.getFirstAsync<{
    label: string;
    lat: number;
    lng: number;
  }>(
    `SELECT label, lat, lng FROM geocode_cache WHERE query_norm = ?`,
    norm,
  );
  if (!row) return null;
  return { lat: row.lat, lng: row.lng, label: row.label };
}

export async function putCachedGeocode(
  query: string,
  result: { lat: number; lng: number; label: string },
): Promise<void> {
  await ensureLandmarkCacheTable();
  const db = await getDatabase();
  const norm = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length < 2) return;
  await db.runAsync(
    `INSERT INTO geocode_cache (query_norm, label, lat, lng, fetched_at_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(query_norm) DO UPDATE SET
       label = excluded.label,
       lat = excluded.lat,
       lng = excluded.lng,
       fetched_at_ms = excluded.fetched_at_ms`,
    norm,
    result.label,
    result.lat,
    result.lng,
    Date.now(),
  );
  void upsertCachedDestination({
    name: result.label,
    lat: result.lat,
    lng: result.lng,
    source: 'geocode',
    searchQuery: query,
    aliases: [query],
  }).catch(() => undefined);
}

export const LANDMARK_CACHE_QUERY_RADIUS_M = CACHE_RADIUS_QUERY_M;
