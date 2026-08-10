/**
 * Dauerhafte Offline-Navigation: gespeicherte Ziele + letzte Route pro Ziel.
 * Jeder einmal online gefundene Ort bleibt offline navigierbar.
 */

import { getDatabase } from '../../db/database';
import { getCachedUserProfile } from '../userProfileService';
import type { NavWaypoint } from './navigationTypes';
import type { PedestrianTravelMode } from './googleMapsNav';

export type CachedDestinationSource =
  | 'db_poi'
  | 'geocode'
  | 'discovery'
  | 'nav'
  | 'offer'
  | 'search'
  | 'route';

export type CachedDestination = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  poiId: number | null;
  source: CachedDestinationSource;
  searchQuery: string | null;
  updatedAtMs: number;
};

export type CachedRoute = {
  destKey: string;
  destName: string;
  destLat: number;
  destLng: number;
  waypoints: NavWaypoint[];
  stations: NavWaypoint[];
  travelMode: PedestrianTravelMode | null;
  walkingDistanceM: number | null;
  updatedAtMs: number;
};

let tableReady: Promise<void> | null = null;

function normName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^📍\s*/u, '')
    .replace(/^route:\s*/iu, '');
}

export function destinationKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

async function ensureTables(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDatabase();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS cached_destinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_norm TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        poi_id INTEGER,
        source TEXT NOT NULL,
        aliases_json TEXT,
        search_query TEXT,
        city_id TEXT,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_dest_name
        ON cached_destinations(name_norm);
      CREATE INDEX IF NOT EXISTS idx_cached_dest_coords
        ON cached_destinations(lat, lng);
      CREATE TABLE IF NOT EXISTS cached_routes (
        dest_key TEXT PRIMARY KEY,
        dest_name TEXT,
        dest_lat REAL NOT NULL,
        dest_lng REAL NOT NULL,
        waypoints_json TEXT NOT NULL,
        stations_json TEXT,
        travel_mode TEXT,
        walking_distance_m INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
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

type DestRow = {
  id: number;
  name: string;
  name_norm: string;
  lat: number;
  lng: number;
  poi_id: number | null;
  source: string;
  search_query: string | null;
  updated_at_ms: number;
  aliases_json: string | null;
};

function rowToDestination(row: DestRow): CachedDestination {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    poiId: row.poi_id,
    source: row.source as CachedDestinationSource,
    searchQuery: row.search_query,
    updatedAtMs: row.updated_at_ms,
  };
}

export async function upsertCachedDestination(input: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number | null;
  source: CachedDestinationSource;
  searchQuery?: string | null;
  aliases?: string[];
}): Promise<void> {
  const name = input.name.trim();
  if (!name || !Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return;
  }
  await ensureTables();
  const db = await getDatabase();
  const now = Date.now();
  const nameNorm = normName(name);
  const cityId = getCachedUserProfile()?.cityId ?? null;
  const aliases = [
    ...new Set(
      (input.aliases ?? [])
        .map((a) => a.trim())
        .filter((a) => a.length >= 2 && normName(a) !== nameNorm),
    ),
  ];
  const aliasesJson = aliases.length ? JSON.stringify(aliases) : null;
  const searchQuery = input.searchQuery?.trim() || null;

  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM cached_destinations
     WHERE ABS(lat - ?) < 0.00005 AND ABS(lng - ?) < 0.00005
     ORDER BY updated_at_ms DESC LIMIT 1`,
    input.lat,
    input.lng,
  );

  if (existing?.id != null) {
    await db.runAsync(
      `UPDATE cached_destinations SET
         name = ?, name_norm = ?, poi_id = COALESCE(?, poi_id),
         source = ?, aliases_json = COALESCE(?, aliases_json),
         search_query = COALESCE(?, search_query),
         city_id = COALESCE(?, city_id),
         updated_at_ms = ?
       WHERE id = ?`,
      name,
      nameNorm,
      input.poiId ?? null,
      input.source,
      aliasesJson,
      searchQuery,
      cityId,
      now,
      existing.id,
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO cached_destinations
      (name, name_norm, lat, lng, poi_id, source, aliases_json, search_query, city_id, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    name,
    nameNorm,
    input.lat,
    input.lng,
    input.poiId ?? null,
    input.source,
    aliasesJson,
    searchQuery,
    cityId,
    now,
  );
}

function scoreNameMatch(queryNorm: string, row: DestRow): number {
  const nameNorm = row.name_norm;
  if (nameNorm === queryNorm) return 100;
  if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) return 80;
  if (row.search_query && normName(row.search_query) === queryNorm) return 75;
  try {
    const aliases = row.aliases_json
      ? (JSON.parse(row.aliases_json) as string[])
      : [];
    for (const alias of aliases) {
      const a = normName(alias);
      if (a === queryNorm) return 70;
      if (a.includes(queryNorm) || queryNorm.includes(a)) return 55;
    }
  } catch {
    // ignore
  }
  const tokens = queryNorm.split(' ').filter((t) => t.length >= 3);
  let score = 0;
  for (const tok of tokens) {
    if (nameNorm.includes(tok)) score += 12;
  }
  return score;
}

export async function lookupCachedDestinationByName(
  query: string,
): Promise<CachedDestination | null> {
  const q = normName(query);
  if (q.length < 2) return null;
  await ensureTables();
  const db = await getDatabase();
  const cityId = getCachedUserProfile()?.cityId ?? null;
  const rows = await db.getAllAsync<DestRow>(
    `SELECT id, name, lat, lng, poi_id, source, search_query, updated_at_ms, aliases_json, name_norm
     FROM cached_destinations
     WHERE city_id IS NULL OR city_id = ? OR ? IS NULL
     ORDER BY updated_at_ms DESC
     LIMIT 120`,
    cityId,
    cityId,
  );
  let best: DestRow | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = scoreNameMatch(q, row);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best || bestScore < 24) return null;
  return rowToDestination(best);
}

export async function lookupCachedDestinationNear(
  lat: number,
  lng: number,
  radiusM = 35,
): Promise<CachedDestination | null> {
  await ensureTables();
  const db = await getDatabase();
  const deg = (radiusM + 20) / 111_320;
  const rows = await db.getAllAsync<DestRow>(
    `SELECT id, name, lat, lng, poi_id, source, search_query, updated_at_ms, aliases_json, name_norm
     FROM cached_destinations
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
     ORDER BY updated_at_ms DESC LIMIT 20`,
    lat - deg,
    lat + deg,
    lng - deg,
    lng + deg,
  );
  let best: DestRow | null = null;
  let bestD = Infinity;
  for (const row of rows) {
    const d =
      Math.abs(row.lat - lat) * 111_320 +
      Math.abs(row.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  if (!best || bestD > radiusM) return null;
  return rowToDestination(best);
}

export async function listRecentCachedDestinations(
  limit = 12,
): Promise<CachedDestination[]> {
  await ensureTables();
  const db = await getDatabase();
  const rows = await db.getAllAsync<DestRow>(
    `SELECT id, name, lat, lng, poi_id, source, search_query, updated_at_ms, aliases_json, name_norm
     FROM cached_destinations
     ORDER BY updated_at_ms DESC
     LIMIT ?`,
    limit,
  );
  return rows.map(rowToDestination);
}

export async function putCachedRoute(input: {
  destName: string;
  destLat: number;
  destLng: number;
  waypoints: NavWaypoint[];
  stations?: NavWaypoint[];
  travelMode?: PedestrianTravelMode | null;
  walkingDistanceM?: number | null;
}): Promise<void> {
  if (!input.waypoints.length) return;
  await ensureTables();
  const db = await getDatabase();
  const now = Date.now();
  const key = destinationKey(input.destLat, input.destLng);
  await db.runAsync(
    `INSERT INTO cached_routes
      (dest_key, dest_name, dest_lat, dest_lng, waypoints_json, stations_json,
       travel_mode, walking_distance_m, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dest_key) DO UPDATE SET
       dest_name = excluded.dest_name,
       dest_lat = excluded.dest_lat,
       dest_lng = excluded.dest_lng,
       waypoints_json = excluded.waypoints_json,
       stations_json = excluded.stations_json,
       travel_mode = excluded.travel_mode,
       walking_distance_m = excluded.walking_distance_m,
       updated_at_ms = excluded.updated_at_ms`,
    key,
    input.destName.trim(),
    input.destLat,
    input.destLng,
    JSON.stringify(input.waypoints),
    input.stations?.length ? JSON.stringify(input.stations) : null,
    input.travelMode ?? null,
    input.walkingDistanceM != null ? Math.round(input.walkingDistanceM) : null,
    now,
    now,
  );
}

export async function getCachedRoute(
  destLat: number,
  destLng: number,
): Promise<CachedRoute | null> {
  await ensureTables();
  const db = await getDatabase();
  const key = destinationKey(destLat, destLng);
  const row = await db.getFirstAsync<{
    dest_key: string;
    dest_name: string | null;
    dest_lat: number;
    dest_lng: number;
    waypoints_json: string;
    stations_json: string | null;
    travel_mode: string | null;
    walking_distance_m: number | null;
    updated_at_ms: number;
  }>(`SELECT * FROM cached_routes WHERE dest_key = ?`, key);
  if (!row) return null;
  try {
    const waypoints = JSON.parse(row.waypoints_json) as NavWaypoint[];
    if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
    const stations = row.stations_json
      ? (JSON.parse(row.stations_json) as NavWaypoint[])
      : [];
    return {
      destKey: row.dest_key,
      destName: row.dest_name ?? 'Ziel',
      destLat: row.dest_lat,
      destLng: row.dest_lng,
      waypoints,
      stations: Array.isArray(stations) ? stations : [],
      travelMode: (row.travel_mode as PedestrianTravelMode | null) ?? null,
      walkingDistanceM: row.walking_distance_m,
      updatedAtMs: row.updated_at_ms,
    };
  } catch {
    return null;
  }
}
