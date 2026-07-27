import * as SQLite from 'expo-sqlite';
import { SEED_FACTS, SEED_POIS } from './seed';
import type { Fact, Poi, PoiKind, PoiWithFacts } from './types';
import type { RemoteFact, RemotePoi } from '../services/supabase';
import { ensureUserSettingsTable } from './userSettings';
import { ensureCityPronunciationsTable } from './cityPronunciations';
import { ensureUserCustomPhoneticsTable } from './userCustomPhonetics';
import {
  approxPolygonAreaM2,
  parsePolygonJson,
  pointInPolygon,
} from '../services/geo/polygon';

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

async function ensurePoiGeoColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(pois)',
  );
  const have = new Set(cols.map((c) => c.name));
  const add = async (name: string, ddl: string) => {
    if (have.has(name)) return;
    await db.execAsync(`ALTER TABLE pois ADD COLUMN ${ddl}`);
  };
  await add('spot_key', 'spot_key TEXT');
  await add('parent_poi_id', 'parent_poi_id INTEGER');
  await add('kind', "kind TEXT DEFAULT 'legacy'");
  await add('category', 'category TEXT');
  await add('tags_json', 'tags_json TEXT');
  await add('polygon_json', 'polygon_json TEXT');
  await add('teaser_text', 'teaser_text TEXT');
  await add('condition_rule', "condition_rule TEXT DEFAULT 'always'");
  await add('special_radius_m', 'special_radius_m REAL');
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
      radius_meters REAL NOT NULL,
      spot_key TEXT,
      parent_poi_id INTEGER,
      kind TEXT DEFAULT 'legacy',
      category TEXT,
      tags_json TEXT,
      polygon_json TEXT,
      teaser_text TEXT,
      condition_rule TEXT DEFAULT 'always',
      special_radius_m REAL
    );
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY NOT NULL,
      poi_id INTEGER NOT NULL,
      fact_text TEXT NOT NULL,
      FOREIGN KEY (poi_id) REFERENCES pois(id) ON DELETE CASCADE
    );
  `);

  await ensurePoiGeoColumns(db);
  await ensureUserSettingsTable(db);
  await ensureCityPronunciationsTable(db);
  await ensureUserCustomPhoneticsTable(db);

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
        `INSERT OR REPLACE INTO pois
         (id, name, lat, lng, radius_meters, kind)
         VALUES (?, ?, ?, ?, ?, 'legacy')`,
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
 */
export async function replacePoisAndFacts(
  pois: RemotePoi[],
  facts: RemoteFact[],
): Promise<void> {
  const db = await getDb();
  await ensurePoiGeoColumns(db);

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM facts');
    await db.runAsync('DELETE FROM pois');

    for (const poi of pois) {
      await db.runAsync(
        `INSERT INTO pois (
          id, name, lat, lng, radius_meters,
          spot_key, parent_poi_id, kind, category, tags_json,
          polygon_json, teaser_text, condition_rule, special_radius_m
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        poi.id,
        poi.name,
        poi.lat,
        poi.lng,
        poi.radius_meters,
        poi.spot_key ?? null,
        poi.parent_poi_id ?? null,
        poi.kind ?? 'legacy',
        poi.category ?? null,
        poi.tags_json ?? null,
        poi.polygon_json ?? null,
        poi.teaser_text ?? null,
        poi.condition_rule ?? 'always',
        poi.special_radius_m ?? null,
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

export async function getChildPois(parentPoiId: number): Promise<Poi[]> {
  const db = await getDb();
  return db.getAllAsync<Poi>(
    'SELECT * FROM pois WHERE parent_poi_id = ? ORDER BY kind ASC, name ASC',
    parentPoiId,
  );
}

export type GeoMatch = {
  poi: Poi;
  distanceM: number;
  via: 'sub' | 'polygon' | 'radius' | 'approach';
};

/**
 * Nächster gültiger Trigger gewinnt.
 * Schon gesprochene IDs / Spot-Keys (Wegweiser nach Besuch) werden übersprungen.
 */
export async function matchGeoTriggers(
  lat: number,
  lng: number,
  opts?: {
    excludePoiIds?: Set<number>;
    /** Spot-Keys, deren Area schon besucht → weitere Approaches ignorieren */
    visitedSpotKeys?: Set<string>;
    /**
     * Skaliert Pack-Radien (Free-Roam: Fuß 1×, Rad ~2.4×, Bus ~6×).
     * Default 1.
     */
    radiusScale?: number;
  },
): Promise<GeoMatch | null> {
  const pois = await getAllPois();
  const hits: GeoMatch[] = [];
  const exclude = opts?.excludePoiIds;
  const visitedSpots = opts?.visitedSpotKeys;
  const scale =
    typeof opts?.radiusScale === 'number' &&
    Number.isFinite(opts.radiusScale) &&
    opts.radiusScale > 0
      ? opts.radiusScale
      : 1;

  for (const poi of pois) {
    if (exclude?.has(poi.id)) continue;

    const kind = (poi.kind ?? 'legacy') as PoiKind;
    const spotKey = poi.spot_key ?? null;

    // Andere Wegweiser zum selben Ort sind irrelevant, wenn Hauptort schon gehört
    if (
      kind === 'approach' &&
      spotKey &&
      visitedSpots?.has(spotKey)
    ) {
      continue;
    }

    const distance = haversineMeters(lat, lng, poi.lat, poi.lng);
    const radius = Math.max(1, poi.radius_meters * scale);

    if (kind === 'sub') {
      if (distance <= radius) {
        hits.push({ poi, distanceM: distance, via: 'sub' });
      }
      continue;
    }

    if (kind === 'approach') {
      if (distance <= radius) {
        hits.push({ poi, distanceM: distance, via: 'approach' });
      }
      continue;
    }

    // area | legacy
    const polygon = parsePolygonJson(poi.polygon_json);
    if (polygon && pointInPolygon(lat, lng, polygon)) {
      hits.push({ poi, distanceM: distance, via: 'polygon' });
      continue;
    }
    if (distance <= radius) {
      hits.push({
        poi,
        distanceM: distance,
        via: 'radius',
      });
    }
  }

  if (hits.length === 0) return null;

  // Primär: geringste Distanz. Bei Gleichstand: kleinerer Trigger (Sub/Approach/kleine Fläche).
  hits.sort((a, b) => {
    const distDiff = a.distanceM - b.distanceM;
    if (Math.abs(distDiff) > 2) return distDiff;

    const sizeRank = (m: GeoMatch): number => {
      const k = (m.poi.kind ?? 'legacy') as PoiKind;
      if (k === 'sub') return 0;
      if (k === 'approach') return 1;
      if (m.via === 'polygon') {
        return approxPolygonAreaM2(parsePolygonJson(m.poi.polygon_json) ?? []);
      }
      return Math.max(m.poi.radius_meters, 1) ** 2;
    };
    const sa = sizeRank(a);
    const sb = sizeRank(b);
    if (sa !== sb) return sa - sb;
    return a.distanceM - b.distanceM;
  });

  return hits[0];
}

export async function findPoiAtLocation(
  lat: number,
  lng: number,
): Promise<Poi | null> {
  const match = await matchGeoTriggers(lat, lng);
  return match?.poi ?? null;
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
