import * as SQLite from 'expo-sqlite';
import { SEED_FACTS, SEED_POIS } from './seed';
import type { Fact, Poi, PoiWithFacts } from './types';
import type { RemoteFact, RemotePoi } from '../services/supabase';
import { ensureUserSettingsTable } from './userSettings';
import { ensureCityPronunciationsTable } from './cityPronunciations';

const DB_NAME = 'findus.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

/** Für Settings-Sync außerhalb von POI-Queries. */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

export async function initDatabase(): Promise<void> {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS pois (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_meters REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY NOT NULL,
      poi_id INTEGER NOT NULL,
      fact_text TEXT NOT NULL,
      FOREIGN KEY (poi_id) REFERENCES pois(id) ON DELETE CASCADE
    );
  `);

  await ensureUserSettingsTable(db);
  await ensureCityPronunciationsTable(db);

  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM pois',
  );

  if ((row?.count ?? 0) === 0) {
    await seedDatabase(db);
  }
}

async function seedDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    let poiId = 1;
    let factId = 1;

    for (const poi of SEED_POIS) {
      await db.runAsync(
        'INSERT OR REPLACE INTO pois (id, name, lat, lng, radius_meters) VALUES (?, ?, ?, ?, ?)',
        poiId,
        poi.name,
        poi.lat,
        poi.lng,
        poi.radius_meters,
      );

      const facts = SEED_FACTS[poi.name] ?? [];
      for (const factText of facts) {
        await db.runAsync(
          'INSERT OR REPLACE INTO facts (id, poi_id, fact_text) VALUES (?, ?, ?)',
          factId,
          poiId,
          factText,
        );
        factId += 1;
      }
      poiId += 1;
    }
  });
}

/**
 * Master-Sync aus Supabase: lokale POIs/Fakten komplett durch Remote ersetzen.
 * Entfernt Seed-/Dummy-Daten (z. B. Bahnhof Prisdorf), sobald echte Remote-Daten da sind.
 */
export async function replacePoisAndFacts(
  pois: RemotePoi[],
  facts: RemoteFact[],
): Promise<void> {
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM facts');
    await db.runAsync('DELETE FROM pois');

    for (const poi of pois) {
      await db.runAsync(
        `INSERT INTO pois (id, name, lat, lng, radius_meters)
         VALUES (?, ?, ?, ?, ?)`,
        poi.id,
        poi.name,
        poi.lat,
        poi.lng,
        poi.radius_meters,
      );
    }

    for (const fact of facts) {
      await db.runAsync(
        `INSERT INTO facts (id, poi_id, fact_text)
         VALUES (?, ?, ?)`,
        fact.id,
        fact.poi_id,
        fact.fact_text,
      );
    }
  });
}

/** @deprecated Alias – nutzt denselben Replace wie der Sync. */
export async function upsertPoisAndFacts(
  pois: RemotePoi[],
  facts: RemoteFact[],
): Promise<void> {
  return replacePoisAndFacts(pois, facts);
}

export async function getAllPois(): Promise<Poi[]> {
  const db = await getDb();
  return db.getAllAsync<Poi>('SELECT * FROM pois ORDER BY name ASC');
}

export async function getFactsForPoi(poiId: number): Promise<Fact[]> {
  const db = await getDb();
  return db.getAllAsync<Fact>(
    'SELECT * FROM facts WHERE poi_id = ? ORDER BY id ASC',
    poiId,
  );
}

export async function getPoiWithFacts(poiId: number): Promise<PoiWithFacts | null> {
  const db = await getDb();
  const poi = await db.getFirstAsync<Poi>('SELECT * FROM pois WHERE id = ?', poiId);
  if (!poi) return null;

  const facts = await getFactsForPoi(poiId);
  return { ...poi, facts };
}

export async function findPoiAtLocation(
  lat: number,
  lng: number,
): Promise<Poi | null> {
  const pois = await getAllPois();

  let closest: Poi | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const poi of pois) {
    const distance = haversineMeters(lat, lng, poi.lat, poi.lng);
    if (distance <= poi.radius_meters && distance < closestDistance) {
      closest = poi;
      closestDistance = distance;
    }
  }

  return closest;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
