import * as SQLite from 'expo-sqlite';
import { SEED_FACTS, SEED_POIS } from './seed';
import type { Fact, Poi, PoiKind, PoiWithFacts } from './types';
import type { RemoteFact, RemotePoi } from '../services/supabase';
import { ensureUserSettingsTable } from './userSettings';
import { ensureCityPronunciationsTable } from './cityPronunciations';
import { ensureUserCustomPhoneticsTable } from './userCustomPhonetics';
import { ensureFeedbackEntriesTable } from './feedbackEntries';
import { ensureUserMemoryFactsTable } from './userMemoryFacts';
import {
  approxPolygonAreaM2,
  distanceToPolygonM,
  parsePolygonJson,
  parsePolygonRings,
} from '../services/geo/polygon';
import { runExclusiveDbWrite } from './dbWriteLock';
import {
  effectiveTriggerRadiusM,
  geoKindRank,
  teasedApproachSpotKeys,
} from '../services/geo/triggerRadius';
import { FOOTPRINT_TRIGGER_BUFFER_M } from '../services/geo/footprintTrigger';

export { runExclusiveDbWrite } from './dbWriteLock';

const DB_NAME = 'findus.db';

type FindusDbGlobal = typeof globalThis & {
  __findusDbPromise?: Promise<SQLite.SQLiteDatabase> | null;
  __findusDbInitPromise?: Promise<void> | null;
  __findusDbClosing?: boolean;
  __findusDbInFlight?: number;
};

function instrumentSqlite(db: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  const anyDb = db as SQLite.SQLiteDatabase & {
    __findusDbg?: boolean;
    __findusDead?: boolean;
  };
  if (anyDb.__findusDbg) return db;
  anyDb.__findusDbg = true;
  const wrap = (method: 'getAllAsync' | 'getFirstAsync' | 'runAsync') => {
    const orig = anyDb[method].bind(db) as (
      sql: string,
      ...rest: unknown[]
    ) => Promise<unknown>;
    (anyDb as unknown as Record<string, unknown>)[method] = async (
      sql: string,
      ...rest: unknown[]
    ) => {
      if (anyDb.__findusDead || g.__findusDbClosing) {
        const fresh = await getDb();
        const next = fresh as unknown as Record<
          string,
          (s: string, ...r: unknown[]) => Promise<unknown>
        >;
        return next[method](sql, ...rest);
      }
      g.__findusDbInFlight = (g.__findusDbInFlight ?? 0) + 1;
      try {
        return await orig(sql, ...rest);
      } finally {
        g.__findusDbInFlight = Math.max(0, (g.__findusDbInFlight ?? 1) - 1);
      }
    };
  };
  wrap('getAllAsync');
  wrap('getFirstAsync');
  wrap('runAsync');
  return db;
}

const g = globalThis as FindusDbGlobal;

/** Soft-Reload setzt Modul-State zurück, Native-Connection bleibt — sonst 2. Open → locked. */
function getDbPromiseSlot(): Promise<SQLite.SQLiteDatabase> | null {
  return g.__findusDbPromise ?? null;
}

function setDbPromiseSlot(p: Promise<SQLite.SQLiteDatabase> | null): void {
  g.__findusDbPromise = p;
}

function getInitPromiseSlot(): Promise<void> | null {
  return g.__findusDbInitPromise ?? null;
}

function setInitPromiseSlot(p: Promise<void> | null): void {
  g.__findusDbInitPromise = p;
}

/** Soft-Reload / Unmount: Native-Handle freigeben, sonst bleibt die DB locked. */
export async function closeFindusDatabase(): Promise<void> {
  const slot = getDbPromiseSlot();
  g.__findusDbClosing = true;
  const t0 = Date.now();
  while ((g.__findusDbInFlight ?? 0) > 0 && Date.now() - t0 < 2000) {
    await new Promise((r) => setTimeout(r, 40));
  }
  setDbPromiseSlot(null);
  setInitPromiseSlot(null);
  if (!slot) {
    g.__findusDbClosing = false;
    return;
  }
  try {
    const db = await slot;
    (db as SQLite.SQLiteDatabase & { __findusDead?: boolean }).__findusDead =
      true;
    await db.closeAsync();
  } catch {
    /* already closed / soft-reload race */
  } finally {
    g.__findusDbClosing = false;
  }
}

async function getDb(opts?: { forceNew?: boolean }): Promise<SQLite.SQLiteDatabase> {
  if (opts?.forceNew) {
    await closeFindusDatabase();
  }
  let slot = getDbPromiseSlot();
  if (!slot) {
    slot = (async () => {
      const openOnce = async (forceNew: boolean) => {
        let db: SQLite.SQLiteDatabase | null = null;
        try {
          db = await SQLite.openDatabaseAsync(DB_NAME, {
            // After Soft-Reload the native cache can hold a mid-transaction handle.
            useNewConnection: forceNew,
            finalizeUnusedStatementsBeforeClosing: true,
          });
          try {
            if (await db.isInTransactionAsync()) {
              await db.execAsync('ROLLBACK;');
            }
          } catch {
            /* no open txn */
          }
          await db.execAsync(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 15000;
            PRAGMA foreign_keys = ON;
          `);
          return instrumentSqlite(db);
        } catch (err) {
          if (db) {
            try {
              await db.closeAsync();
            } catch {
              /* leaked open */
            }
          }
          throw err;
        }
      };
      let last: unknown;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          return await openOnce(attempt > 0 || !!opts?.forceNew);
        } catch (err) {
          last = err;
          const locked =
            /database is locked|finalizeAsync|SQLITE_BUSY|Error code 5/i.test(
              String(err ?? ''),
            );
          if (!locked || attempt === 5) throw err;
          // Don't close our own in-flight promise — just wait and open a new native conn.
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
      throw last;
    })().catch((err) => {
      setDbPromiseSlot(null);
      throw err;
    });
    setDbPromiseSlot(slot);
  }
  return slot;
}

/** Für Settings-Sync außerhalb von POI-Queries. */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  // Wenn Boot gerade initialisiert: warten, sonst Race mit CREATE/Seed.
  const init = getInitPromiseSlot();
  if (init) {
    try {
      await init;
    } catch {
      /* init failed — caller may still open for soft paths */
    }
  }
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
  // StrictMode / soft boot / Fast-Refresh — share one init across JS reloads.
  const existing = getInitPromiseSlot();
  if (existing) {
    try {
      await existing;
      return;
    } catch {
      // Stale rejected init from Soft-Reload — clear and retry fresh.
      setInitPromiseSlot(null);
    }
  }
  const initPromise = (async () => {
    await runExclusiveDbWrite(async () => {
      let db = await getDb();
      try {
        if (await db.isInTransactionAsync()) {
          await db.execAsync('ROLLBACK;');
        }
      } catch {
        /* soft */
      }

      const runSchema = async (database: SQLite.SQLiteDatabase) => {
        await database.execAsync(`
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

        await ensurePoiGeoColumns(database);
        await ensureUserSettingsTable(database);
        await ensureCityPronunciationsTable(database);
        await ensureUserCustomPhoneticsTable(database);
        await ensureFeedbackEntriesTable(database);
        await ensureUserMemoryFactsTable(database);

        const row = await database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM pois',
        );

        if ((row?.count ?? 0) === 0) {
          await seedDatabase(database);
        }
      };

      try {
        await runSchema(db);
      } catch (err) {
        const locked =
          /database is locked|finalizeAsync|SQLITE_BUSY|Error code 5/i.test(
            String(err ?? ''),
          );
        if (!locked) throw err;
        db = await getDb({ forceNew: true });
        await runSchema(db);
      }
    });
  })().catch((err) => {
    setInitPromiseSlot(null);
    throw err;
  });
  setInitPromiseSlot(initPromise);
  return initPromise;
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
 * Master-Sync: lokale POIs/Fakten ersetzen.
 * Batches + Write-Lock → UI bleibt ansprechbar, keine Nested-Transactions.
 */
export async function replacePoisAndFacts(
  pois: RemotePoi[],
  facts: RemoteFact[],
): Promise<void> {
  await runExclusiveDbWrite(async () => {
    const db = await getDb();
    await ensurePoiGeoColumns(db);

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM facts');
      await db.runAsync('DELETE FROM pois');
    });

    const BATCH = 48;
    for (let i = 0; i < pois.length; i += BATCH) {
      const slice = pois.slice(i, i + BATCH);
      await db.withTransactionAsync(async () => {
        for (const poi of slice) {
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
      });
      // JS-Thread atmen lassen (große Packs wie Hamburg)
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    for (let i = 0; i < facts.length; i += BATCH) {
      const slice = facts.slice(i, i + BATCH);
      await db.withTransactionAsync(async () => {
        for (const fact of slice) {
          await db.runAsync(
            `INSERT INTO facts (id, poi_id, fact_text)
             VALUES (?, ?, ?)`,
            fact.id,
            fact.poi_id,
            fact.fact_text,
          );
        }
      });
      await new Promise<void>((r) => setTimeout(r, 0));
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

/** Grobes Rechteck um den User — Geofence muss nicht alle POIs der Stadt anfassen. */
export async function getPoisNear(
  lat: number,
  lng: number,
  padDeg = 0.025,
): Promise<Poi[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return getAllPois();
  const db = await getDb();
  const lngPad = padDeg * 1.6;
  return db.getAllAsync<Poi>(
    `SELECT * FROM pois
     WHERE lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
     ORDER BY name ASC`,
    lat - padDeg,
    lat + padDeg,
    lng - lngPad,
    lng + lngPad,
  );
}

export async function getPoiById(id: number): Promise<Poi | null> {
  if (!Number.isFinite(id)) return null;
  const db = await getDb();
  return db.getFirstAsync<Poi>('SELECT * FROM pois WHERE id = ?', id);
}

/** OSM-Footprint nachziehen — Homescreen-Karte + Modul-1-Geofence. */
export async function updatePoiPolygonJson(
  poiId: number,
  polygonJson: string,
): Promise<void> {
  if (!Number.isFinite(poiId) || !polygonJson.trim()) return;
  const db = await getDb();
  await db.runAsync('UPDATE pois SET polygon_json = ? WHERE id = ?', [
    polygonJson,
    poiId,
  ]);
}

export async function getFactsForPoi(poiId: number): Promise<Fact[]> {
  const db = await getDb();
  return db.getAllAsync<Fact>(
    'SELECT * FROM facts WHERE poi_id = ? ORDER BY id ASC',
    poiId,
  );
}

/** Viewport-Prefetch: Fakten für mehrere sichtbare Orte in einem Roundtrip. */
export async function getFactsForPois(
  poiIds: number[],
): Promise<Map<number, Fact[]>> {
  const ids = [
    ...new Set(
      poiIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => id | 0),
    ),
  ].slice(0, 48);
  const out = new Map<number, Fact[]>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<Fact>(
    `SELECT * FROM facts WHERE poi_id IN (${placeholders}) ORDER BY poi_id ASC, id ASC`,
    ...ids,
  );
  for (const row of rows) {
    const pid = Number(row.poi_id);
    if (!Number.isFinite(pid)) continue;
    const list = out.get(pid) ?? [];
    list.push(row);
    out.set(pid, list);
  }
  return out;
}

/**
 * Autonomes Lernen: recherchierter Fakt landet im lokalen Pack-Datensatz (SQLite),
 * damit derselbe User / nächster Turn den Ort reicher hat.
 * Pack-JSON auf Disk wird nicht überschrieben — Sync über Community-FAQ-Cache.
 */
export async function appendLearnedFactToPoi(opts: {
  poiId: number;
  factText: string;
  /** stabile Id-Suffix-Quelle, z. B. FAQ-id */
  idHint?: string | null;
}): Promise<boolean> {
  const text = (opts.factText || '').trim();
  if (!text || text.length < 12 || !Number.isFinite(opts.poiId)) return false;
  try {
    const db = await getDb();
    const existing = await getFactsForPoi(opts.poiId);
    const lower = text.toLowerCase().slice(0, 80);
    if (
      existing.some(
        (f) => (f.fact_text || '').toLowerCase().slice(0, 80) === lower,
      )
    ) {
      return false;
    }
    const idNum =
      Number.parseInt(String(opts.idHint || '').replace(/\D/g, ''), 10) || 0;
    const id =
      idNum > 0
        ? idNum
        : (Math.abs(
            (opts.poiId * 4099 + text.length * 9176 + (text.charCodeAt(0) || 1)) |
              0,
          ) %
            80_000_000) +
          910_000_000;
    await runExclusiveDbWrite(async () => {
      await db.runAsync(
        `INSERT OR IGNORE INTO facts (id, poi_id, fact_text) VALUES (?, ?, ?)`,
        id,
        opts.poiId,
        text.slice(0, 2000),
      );
    });
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[db] appendLearnedFactToPoi', err);
    return false;
  }
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
 * Alle Geo-Treffer am Standort (noch unsortiert / ungefiltert außer exclude/visited).
 */
export async function collectGeoHits(
  lat: number,
  lng: number,
  opts?: {
    excludePoiIds?: Set<number>;
    visitedSpotKeys?: Set<string>;
    radiusScale?: number;
  },
): Promise<GeoMatch[]> {
  const pois = await getPoisNear(lat, lng);
  const hits: GeoMatch[] = [];
  const exclude = opts?.excludePoiIds;
  const visitedSpots = opts?.visitedSpotKeys;
  const teasedSpots = teasedApproachSpotKeys(pois, exclude);
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

    if (
      kind === 'approach' &&
      spotKey &&
      (visitedSpots?.has(spotKey) || teasedSpots.has(spotKey))
    ) {
      continue;
    }

    const distance = haversineMeters(lat, lng, poi.lat, poi.lng);
    const radius = effectiveTriggerRadiusM(poi, scale);

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

    const polygon = parsePolygonJson(poi.polygon_json);
    const rings = parsePolygonRings(poi.polygon_json);
    const nearFootprint =
      (polygon &&
        distanceToPolygonM(lat, lng, polygon) <= FOOTPRINT_TRIGGER_BUFFER_M) ||
      rings.some(
        (r) =>
          r.length >= 3 &&
          distanceToPolygonM(lat, lng, r) <= FOOTPRINT_TRIGGER_BUFFER_M,
      );
    if (nearFootprint) {
      const dPoly =
        polygon != null
          ? distanceToPolygonM(lat, lng, polygon)
          : rings.reduce(
              (best, r) => Math.min(best, distanceToPolygonM(lat, lng, r)),
              Number.POSITIVE_INFINITY,
            );
      hits.push({
        poi,
        distanceM: Number.isFinite(dPoly) ? dPoly : distance,
        via: 'polygon',
      });
      continue;
    }
    // Ohne Footprint: Punkt-Radius (Story-Floors unverändert für Approaches)
    if (distance <= radius) {
      hits.push({
        poi,
        distanceM: distance,
        via: 'radius',
      });
    }
  }

  return hits;
}

function sortGeoHitsNearest(hits: GeoMatch[]): GeoMatch[] {
  return [...hits].sort((a, b) => {
    const ka = geoKindRank(a.poi, a.via);
    const kb = geoKindRank(b.poi, b.via);
    // Gleicher Spot: Hauptort vor eigenem Wegweiser (User steht schon da)
    const sameSpot =
      Boolean(a.poi.spot_key) && a.poi.spot_key === b.poi.spot_key;
    if (sameSpot && ka !== kb) return ka - kb;

    const distDiff = a.distanceM - b.distanceM;
    if (Math.abs(distDiff) > 8) return distDiff;
    if (ka !== kb) return ka - kb;

    if (a.via === 'polygon' || b.via === 'polygon') {
      const sa = approxPolygonAreaM2(parsePolygonJson(a.poi.polygon_json) ?? []);
      const sb = approxPolygonAreaM2(parsePolygonJson(b.poi.polygon_json) ?? []);
      if (sa !== sb) return sa - sb;
    }
    return a.distanceM - b.distanceM;
  });
}

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
  const hits = await collectGeoHits(lat, lng, opts);
  if (hits.length === 0) return null;
  return sortGeoHitsNearest(hits)[0] ?? null;
}

/**
 * Primärer Treffer + Nachbarn im Bundle-Radius (für 50-m Audio-Bundling).
 */
export async function matchGeoTriggerCluster(
  lat: number,
  lng: number,
  opts?: {
    excludePoiIds?: Set<number>;
    visitedSpotKeys?: Set<string>;
    radiusScale?: number;
    bundleRadiusM?: number;
  },
): Promise<{ primary: GeoMatch; nearby: GeoMatch[] } | null> {
  const hits = await collectGeoHits(lat, lng, opts);
  if (hits.length === 0) return null;
  const sorted = sortGeoHitsNearest(hits);
  const primary = sorted[0]!;
  const bundleR = opts?.bundleRadiusM ?? 50;
  const nearby = sorted.filter((h) => {
    const dToPrimary = haversineMeters(
      primary.poi.lat,
      primary.poi.lng,
      h.poi.lat,
      h.poi.lng,
    );
    // Im 50-m-Cluster um den Primary (nicht nur User-Radius)
    return dToPrimary <= bundleR || h.poi.id === primary.poi.id;
  });
  return { primary, nearby };
}

export async function findPoiAtLocation(
  lat: number,
  lng: number,
): Promise<Poi | null> {
  const match = await matchGeoTriggers(lat, lng);
  return match?.poi ?? null;
}

export { haversineMeters } from '../services/geo/haversine';
