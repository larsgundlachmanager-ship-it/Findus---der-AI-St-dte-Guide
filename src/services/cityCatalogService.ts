import * as FileSystem from 'expo-file-system';
import { InteractionManager } from 'react-native';
import { env } from '../config/env';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { mapCityPackToRemote, type CityPack, type CityPackLink } from './cityPack';
import { replacePoisAndFacts, getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { parseAndCacheCityPronunciations } from './tts/cityPronunciationParser';
import { scanCityDatasetSafe } from './scanner/cityScanner';
import { scanPoiDatasetSafe } from './ai/poiDatasetScanner';
import { syncDictionaryAfterCityDownload } from './sync/dictionarySyncService';
import {
  applyPackPatch,
  chooseUpdatePath,
  packDataVersion,
  type CityPackPatchRef,
  type CityPackPatchV1,
  type PackUpdateDecision,
} from './cityPack/packDelta';
import {
  parseLocalCityStorageFile,
  poisLookLikeCity,
  type LocalCityDataset,
} from './cityPack/cityLocalStorage';

/**
 * City-pack persistence (on-device):
 * - Full JSON packs live forever under documentDirectory/cities/<id>.json
 *   once downloaded. Switching cities never deletes other cities' files.
 * - SQLite + store.pois hold only the *active* (selected) city for Modul 1 /
 *   geofence triggers. Concierge/Q&A may read any cached JSON via packPlaceResolve.
 * - Stadtwechsel: Index-Version prüfen. Gleich → lokales Pack, kein Download.
 *   SQLite schon diese Stadt+Version → sofort umschalten (kein JSON-Remap).
 * - Neuere Version → Patch-Kette (≤3) oder Full-File, nur für diese Stadt.
 * - Offline-Städte (Settings) darf lokale Dateien löschen; Zugang bleibt.
 */
const STAEDTE_BUCKET = 'staedte';
const DOC_DIR = FileSystem.documentDirectory;
const CITIES_DIR = DOC_DIR ? `${DOC_DIR}cities/` : null;
const VERSIONS_PATH = CITIES_DIR ? `${CITIES_DIR}versions.json` : null;
const ACTIVE_PATH = CITIES_DIR ? `${CITIES_DIR}active.json` : null;
const INDEX_CACHE_PATH = CITIES_DIR ? `${CITIES_DIR}index.cache.json` : null;

export type CityIndexEntry = {
  id: string;
  name: string;
  data_version?: number;
  symbol?: string;
  lat?: number;
  lng?: number;
  district?: string;
  /** Hero-Cover (HTTPS) — aus Pack `cover_url` / `_meta.cover_url` */
  coverUrl?: string | null;
  /** Stadtgrenze BBox (Stempelkarte / Homescreen) */
  latMin?: number;
  latMax?: number;
  lngMin?: number;
  lngMax?: number;
  /** Vereinfachtes OSM-Gemeinde-Polygon [lat,lng][] — Kartenfarbe ohne Nominatim-Warten */
  polygon?: Array<[number, number]>;
  /** Kleine Updates gegen die lokal gespeicherte data_version */
  patches?: CityPackPatchRef[];
  triggerCount?: number;
  zoneCount?: number;
  storyCount?: number;
  factCount?: number;
  directoryCount?: number;
  placeCount?: number;
  gpsCount?: number;
  trigger_count?: number;
  story_count?: number;
  fact_count?: number;
};

export type CityCatalogItem = CityIndexEntry & {
  distanceKm: number | null;
  /** Summe aller GPS-Trigger (Zonen + Wegpunkte + Unterpunkte) */
  triggerCount: number;
  /** Area-/Legacy-Zonen */
  zoneCount: number;
  /** Approach-Wegpunkte */
  approachCount: number;
  /** Sub-POI-Unterpunkte */
  subCount: number;
  /** Anzahl Fakten (Bullets + Erzählungen + Deep-Data) */
  factCount: number;
  /** Story-Orte (Trigger/Narration) */
  storyCount?: number;
  /** Directory / Offline-Katalog */
  directoryCount?: number;
  /** Alle GPS-Trigger mit Typ (für Auflistung in der Städteauswahl) */
  triggers: Array<{
    name: string;
    kind: 'zone' | 'approach' | 'sub';
  }>;
  /** @deprecated Alias für zoneCount (UI-Kompat) */
  gpsCount: number;
  /** @deprecated Alias für triggerCount */
  placeCount: number;
};

type CityIndexFile = {
  last_global_update?: string;
  available_cities?: CityIndexEntry[];
};

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Map/TTS halten InteractionManager oft fest — nie endlos warten. */
function yieldToUi(maxWaitMs = 64): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, Math.max(16, maxWaitMs));
    try {
      const handle = InteractionManager.runAfterInteractions(() => {
        clearTimeout(timer);
        finish();
      });
      void handle;
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

function catalogItemFromIndex(
  entry: CityIndexEntry,
  userCoords: { lat: number; lng: number } | null,
): CityCatalogItem {
  const lat = entry.lat;
  const lng = entry.lng;
  const distanceKm =
    userCoords && typeof lat === 'number' && typeof lng === 'number'
      ? haversineKm(userCoords.lat, userCoords.lng, lat, lng)
      : null;
  const n = (v: unknown): number => {
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
  };
  const raw = entry as CityIndexEntry & {
    cover_url?: string;
    zone_count?: number;
    directory_count?: number;
  };
  const triggerCount =
    n(entry.triggerCount) || n(entry.trigger_count) || n(entry.placeCount);
  const storyCount = n(entry.storyCount) || n(entry.story_count);
  const factCount = n(entry.factCount) || n(entry.fact_count);
  const directoryCount = n(entry.directoryCount) || n(raw.directory_count);
  const zoneCount =
    n(entry.zoneCount) ||
    n(raw.zone_count) ||
    n(entry.gpsCount) ||
    directoryCount ||
    storyCount;
  const coverUrl =
    (typeof entry.coverUrl === 'string' && entry.coverUrl.trim()) ||
    (typeof raw.cover_url === 'string' && raw.cover_url.trim()) ||
    null;
  return {
    ...entry,
    name: entry.name || titleCaseId(entry.id),
    symbol: entry.symbol ?? '📍',
    coverUrl,
    distanceKm,
    triggerCount,
    zoneCount,
    approachCount: 0,
    subCount: 0,
    factCount,
    storyCount,
    directoryCount,
    triggers: [],
    gpsCount: zoneCount,
    placeCount: triggerCount || zoneCount,
  };
}

function titleCaseId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Pack-Datei im Bucket — nicht index, nicht Offline-Karte (london.map.json). */
export function isCityPackStorageName(fileName: string): boolean {
  const name = String(fileName || '').trim().toLowerCase();
  if (!name.endsWith('.json') || name === 'index.json' || name.startsWith('_')) {
    return false;
  }
  const base = name.slice(0, -'.json'.length);
  if (!base || base.includes('.')) return false;
  return true;
}

function resolveSupabaseBase(): string {
  const base = env.supabaseUrl().replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'Supabase-URL fehlt (EXPO_PUBLIC_SUPABASE_URL). Stadt-Download nicht möglich.',
    );
  }
  return base;
}

function cityPackPublicUrl(cityId: string): string {
  const safeId = encodeURIComponent(cityId);
  return `${resolveSupabaseBase()}/storage/v1/object/public/${STAEDTE_BUCKET}/${safeId}.json`;
}

async function ensureCitiesDir(): Promise<boolean> {
  if (!CITIES_DIR) return false;
  try {
    const info = await FileSystem.getInfoAsync(CITIES_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CITIES_DIR, { intermediates: true });
    }
    return true;
  } catch (err) {
    console.warn('[cityCatalog] cities-Dir nicht anlegbar:', err);
    return false;
  }
}

async function readBodyAsText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder('utf-8').decode(data as ArrayBufferView);
  }
  const maybeBlob = data as {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof maybeBlob?.text === 'function') {
    return maybeBlob.text();
  }
  if (typeof maybeBlob?.arrayBuffer === 'function') {
    const buf = await maybeBlob.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }
  // FileReader fallback (ältere RN-Blobs)
  if (typeof FileReader !== 'undefined' && data && typeof data === 'object') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader'));
      reader.readAsText(data as Blob);
    });
  }
  throw new Error('Unbekanntes Download-Format');
}

function parseJsonStrict<T>(text: string, label: string): T {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error(`Leere Antwort (${label})`);
  }
  const parsed = JSON.parse(trimmed) as T & {
    statusCode?: number | string;
    error?: string;
    message?: string;
    spots?: unknown;
    available_cities?: unknown;
  };
  // Storage-Fehlerseiten: JSON mit statusCode, ohne Stadt-Inhalt
  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.statusCode != null &&
    !('spots' in parsed) &&
    !('available_cities' in parsed) &&
    !('trigger_points' in parsed)
  ) {
    throw new Error(
      `Storage ${parsed.statusCode}: ${parsed.message || parsed.error || label}`,
    );
  }
  return parsed as T;
}

function publicObjectUrl(path: string): string {
  const base = resolveSupabaseBase();
  return `${base}/storage/v1/object/public/${STAEDTE_BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

async function fetchPublicJson<T>(
  path: string,
  opts?: { revalidate?: boolean; etag?: string },
): Promise<{ data: T; etag?: string; notModified?: boolean }> {
  const publicUrl = publicObjectUrl(path);
  const errors: string[] = [];
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts?.etag) headers['If-None-Match'] = opts.etag;
  if (opts?.revalidate) headers['Cache-Control'] = 'max-age=0';

  try {
    const response = await fetch(publicUrl, { method: 'GET', headers });
    if (response.status === 304) {
      return { data: undefined as T, notModified: true, etag: opts?.etag };
    }
    if (response.ok) {
      const text = await response.text();
      return {
        data: parseJsonStrict<T>(text, `fetch ${path}`),
        etag: response.headers.get('etag') ?? undefined,
      };
    }
    errors.push(`fetch HTTP ${response.status}`);
    console.warn(
      `[cityCatalog] public fetch ${path}: HTTP ${response.status}`,
    );
  } catch (err) {
    errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`[cityCatalog] public fetch ${path}:`, err);
  }

  if (CITIES_DIR) {
    try {
      const ok = await ensureCitiesDir();
      if (ok) {
        const tmp = `${CITIES_DIR}_tmp_${Date.now()}.json`;
        const result = await FileSystem.downloadAsync(publicUrl, tmp);
        if (result.status >= 200 && result.status < 300) {
          try {
            const text = await FileSystem.readAsStringAsync(tmp);
            const parsed = parseJsonStrict<T>(text, `FS ${path}`);
            try {
              await FileSystem.deleteAsync(tmp, { idempotent: true });
            } catch {
              // ignore
            }
            return { data: parsed };
          } catch (parseErr) {
            errors.push(
              `FS-parse: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            );
            try {
              await FileSystem.deleteAsync(tmp, { idempotent: true });
            } catch {
              // ignore
            }
          }
        } else {
          errors.push(`FS HTTP ${result.status}`);
        }
      }
    } catch (err) {
      errors.push(`FS: ${err instanceof Error ? err.message : String(err)}`);
      console.warn(`[cityCatalog] FS download ${path}:`, err);
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(STAEDTE_BUCKET)
        .download(path);
      if (!error && data) {
        const text = await readBodyAsText(data);
        return { data: parseJsonStrict<T>(text, `sdk ${path}`) };
      }
      errors.push(`sdk: ${error?.message ?? 'keine Daten'}`);
      console.warn(`[cityCatalog] download ${path}:`, error?.message);
    } catch (err) {
      errors.push(`sdk: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push('sdk: kein Client');
  }

  throw new Error(
    `Stadt-Datei nicht ladbar: ${path} (${errors.join(' | ') || 'unbekannt'})`,
  );
}

/** Alle Stadt-Packs aus dem Bucket (nicht nur index.json). */
async function listCityIdsFromBucket(): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase.storage
      .from(STAEDTE_BUCKET)
      .list('', { limit: 200, sortBy: { column: 'name', order: 'asc' } });

    if (error || !data) {
      console.warn('[cityCatalog] list bucket:', error?.message);
      return [];
    }

    return data
      .map((f) => f.name)
      .filter((name) => typeof name === 'string' && isCityPackStorageName(name))
      .map((name) => name.replace(/\.json$/i, ''));
  } catch (err) {
    console.warn('[cityCatalog] list bucket Exception:', err);
    return [];
  }
}

/** Offline-/Dev-Fallback wenn Bucket/Index leer oder Supabase fehlt. */
const HARDCODED_CITY_INDEX: CityIndexEntry[] = [
  {
    id: 'prisdorf',
    name: 'Prisdorf',
    lat: 53.6799982,
    lng: 9.7606944,
    symbol: '🌳',
  },
  {
    id: 'pinneberg',
    name: 'Pinneberg',
    lat: 53.7278939,
    lng: 9.6979598,
    symbol: '🌳',
  },
  {
    id: 'tornesch',
    name: 'Tornesch',
    lat: 53.6973396,
    lng: 9.7123761,
    symbol: '🌳',
  },
  {
    id: 'hamburg',
    name: 'Hamburg',
    lat: 53.5511,
    lng: 9.9937,
    symbol: '⚓',
  },
  {
    id: 'luebeck',
    name: 'Lübeck',
    lat: 53.8654673,
    lng: 10.6865593,
    symbol: '🏛️',
  },
  {
    id: 'hechingen',
    name: 'Hechingen',
    lat: 48.3538888,
    lng: 8.9613627,
    symbol: '🏰',
  },
  {
    id: 'tettnang',
    name: 'Tettnang',
    lat: 47.6681722,
    lng: 9.5916036,
    symbol: '🏰',
  },
  {
    id: 'wangerooge',
    name: 'Wangerooge',
    lat: 53.7902,
    lng: 7.8995,
    symbol: '🏝️',
  },
];

/** Veraltete Duplikat-IDs — nie in der Stadtauswahl anzeigen (auch wenn noch im Bucket). */
const OBSOLETE_CITY_IDS = new Set([
  'berlin',
  'berlin_umland',
  'frankfurt',
  'hochheim',
]);

/** Wenn mehrere IDs denselben Anzeigenamen haben, behalte diese. */
const PREFERRED_CITY_ID_BY_NAME: Record<string, string> = {
  'berlin zentral': 'berlin-zentral',
  'berlin umland': 'berlin-umland',
  'frankfurt am main': 'frankfurt_am_main',
  'hochheim am main': 'hochheim_am_main',
};

function normalizeCityName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dedupeCityIndex(entries: CityIndexEntry[]): CityIndexEntry[] {
  const byId = new Map<string, CityIndexEntry>();
  for (const e of entries) {
    if (!e?.id || OBSOLETE_CITY_IDS.has(e.id) || e.id.includes('.')) continue;
    byId.set(e.id, e);
  }
  const byName = new Map<string, CityIndexEntry[]>();
  for (const e of byId.values()) {
    const key = normalizeCityName(e.name || e.id);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(e);
  }
  const out: CityIndexEntry[] = [];
  for (const [key, group] of byName) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const preferred = PREFERRED_CITY_ID_BY_NAME[key];
    const pick =
      (preferred && group.find((g) => g.id === preferred)) ||
      group.sort((a, b) => (b.data_version ?? 0) - (a.data_version ?? 0))[0]!;
    out.push(pick);
  }
  return out.sort((a, b) =>
    String(a.name || a.id).localeCompare(String(b.name || b.id), 'de'),
  );
}

let lastCityIndexCache: CityIndexEntry[] | null = null;
let lastIndexEtag: string | undefined;

type DiskIndexCache = {
  etag?: string;
  fetchedAtMs: number;
  entries: CityIndexEntry[];
};

type VersionSidecar = Record<string, { version: number }>;

/** Letzter Städte-Index (Pack-Katalog), ohne Netzwerk. */
export function peekCityIndexCache(): CityIndexEntry[] | null {
  return lastCityIndexCache ?? peekWarmCityCatalog();
}

async function readDiskIndex(): Promise<DiskIndexCache | null> {
  if (!INDEX_CACHE_PATH) return null;
  try {
    const info = await FileSystem.getInfoAsync(INDEX_CACHE_PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(INDEX_CACHE_PATH);
    const parsed = JSON.parse(raw) as DiskIndexCache;
    if (!parsed?.entries?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskIndex(cache: DiskIndexCache): Promise<void> {
  if (!INDEX_CACHE_PATH) return;
  try {
    await ensureCitiesDir();
    await FileSystem.writeAsStringAsync(
      INDEX_CACHE_PATH,
      JSON.stringify(cache),
    );
  } catch {
    /* ignore */
  }
}

async function readVersionSidecar(): Promise<VersionSidecar> {
  if (!VERSIONS_PATH) return {};
  try {
    const info = await FileSystem.getInfoAsync(VERSIONS_PATH);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(VERSIONS_PATH);
    const parsed = JSON.parse(raw) as VersionSidecar;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLocalPackVersion(
  cityId: string,
  version: number,
): Promise<void> {
  if (!VERSIONS_PATH) return;
  try {
    const all = await readVersionSidecar();
    all[cityId] = { version };
    await ensureCitiesDir();
    await FileSystem.writeAsStringAsync(VERSIONS_PATH, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

type ActiveInstall = { cityId: string; version: number };
let memActive: ActiveInstall | null = null;

async function readActiveInstall(): Promise<ActiveInstall | null> {
  if (memActive) return memActive;
  if (!ACTIVE_PATH) return null;
  try {
    const info = await FileSystem.getInfoAsync(ACTIVE_PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(ACTIVE_PATH);
    const parsed = JSON.parse(raw) as ActiveInstall;
    if (!parsed?.cityId || typeof parsed.version !== 'number') return null;
    memActive = {
      cityId: String(parsed.cityId).toLowerCase(),
      version: parsed.version,
    };
    return memActive;
  } catch {
    return null;
  }
}

async function writeActiveInstall(next: ActiveInstall): Promise<void> {
  memActive = next;
  if (!ACTIVE_PATH) return;
  try {
    await ensureCitiesDir();
    await FileSystem.writeAsStringAsync(ACTIVE_PATH, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function entriesFromIndexFile(index: CityIndexFile): CityIndexEntry[] {
  const byId = new Map<string, CityIndexEntry>();
  for (const city of index.available_cities ?? []) {
    if (!city?.id || OBSOLETE_CITY_IDS.has(city.id) || city.id.includes('.')) {
      continue;
    }
    const raw = city as CityIndexEntry & { cover_url?: string };
    const coverUrl =
      (typeof raw.coverUrl === 'string' && raw.coverUrl.trim()) ||
      (typeof raw.cover_url === 'string' && raw.cover_url.trim()) ||
      null;
    const patches = Array.isArray(raw.patches) ? raw.patches : undefined;
    byId.set(city.id, { ...raw, coverUrl, patches });
  }
  return dedupeCityIndex(Array.from(byId.values()));
}

/**
 * Städte-Index. Default: Speicher/Platte, kein Bucket-Listing.
 * `fresh` nur Morgen-Check und Stadtwechsel.
 */
export async function fetchCityIndex(opts?: {
  bustCache?: boolean;
  fresh?: boolean;
  skipBucketListing?: boolean;
}): Promise<CityIndexEntry[]> {
  const fresh = opts?.fresh === true || opts?.bustCache === true;
  const skipBucketListing = opts?.skipBucketListing !== false;

  if (!fresh && lastCityIndexCache && lastCityIndexCache.length > 0) {
    return lastCityIndexCache;
  }

  if (!isSupabaseConfigured()) {
    lastCityIndexCache = [...HARDCODED_CITY_INDEX];
    return lastCityIndexCache;
  }

  const disk = await readDiskIndex();
  if (!fresh && disk?.entries?.length) {
    lastCityIndexCache = disk.entries;
    lastIndexEtag = disk.etag;
    return disk.entries;
  }

  try {
    const fetched = await fetchPublicJson<CityIndexFile>('index.json', {
      revalidate: fresh,
      etag: disk?.etag || lastIndexEtag,
    });
    if (fetched.notModified && disk?.entries?.length) {
      lastCityIndexCache = disk.entries;
      lastIndexEtag = fetched.etag || disk.etag;
      return disk.entries;
    }
    if (fetched.data) {
      const entries = entriesFromIndexFile(fetched.data);
    if (entries.length) {
      lastCityIndexCache = entries;
      lastIndexEtag = fetched.etag;
      await writeDiskIndex({
        etag: fetched.etag,
        fetchedAtMs: Date.now(),
        entries,
      });
      if (skipBucketListing) return entries;
    }
    }
  } catch (err) {
    console.warn('[cityCatalog] index.json fehlgeschlagen:', err);
    if (disk?.entries?.length) {
      lastCityIndexCache = disk.entries;
      return disk.entries;
    }
  }

  const byId = new Map<string, CityIndexEntry>();
  for (const e of lastCityIndexCache ?? []) byId.set(e.id, e);

  if (!skipBucketListing) {
    const listed = await listCityIdsFromBucket();
    for (const id of listed) {
      if (OBSOLETE_CITY_IDS.has(id) || id.includes('.')) continue;
      if (!byId.has(id)) {
        byId.set(id, { id, name: titleCaseId(id), symbol: '📍' });
      }
    }
  }

  if (byId.size === 0) {
    console.warn('[cityCatalog] Keine Städte – Hardcoded Fallback');
    lastCityIndexCache = [...HARDCODED_CITY_INDEX];
    return lastCityIndexCache;
  }

  const deduped = dedupeCityIndex(Array.from(byId.values()));
  lastCityIndexCache = deduped;
  return deduped;
}

async function cachePackLocally(cityId: string, pack: CityPack): Promise<void> {
  if (!CITIES_DIR) return;
  try {
    const ok = await ensureCitiesDir();
    if (!ok) return;
    await FileSystem.writeAsStringAsync(
      `${CITIES_DIR}${cityId}.json`,
      JSON.stringify(pack),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
    await writeLocalPackVersion(cityId, packDataVersion(pack));
  } catch (err) {
    console.warn('[cityCatalog] Lokaler Cache fehlgeschlagen:', err);
  }
}

export async function fetchCityPackById(
  cityId: string,
  _opts?: { bustCache?: boolean },
): Promise<CityPack> {
  const fetched = await fetchPublicJson<CityPack>(`${cityId}.json`);
  const pack = fetched.data;
  if (!pack || typeof pack !== 'object') {
    throw new Error(`Ungültiges Stadt-Pack: ${cityId}`);
  }
  await cachePackLocally(cityId, pack);
  return pack;
}

/** True if cities/<id>.json exists (usable for Q&A without being the active SQLite city). */
export async function isCityPackCachedOnDevice(cityId: string): Promise<boolean> {
  const id = cityId.trim().toLowerCase();
  if (!id || !CITIES_DIR) return false;
  try {
    const info = await FileSystem.getInfoAsync(`${CITIES_DIR}${id}.json`);
    return Boolean(info.exists && (info.size ?? 0) > 100);
  } catch {
    return false;
  }
}

let browseEnsureInFlight: Promise<boolean> | null = null;
let browseEnsureInFlightId: string | null = null;

/**
 * Pack nur auf Disk + Pin-Index (Zubringer / Viewport).
 * Kein SQLite-Swap, kein writeActiveInstall, kein Profil-Stadtwechsel.
 * GPS-/Aktiv-Stadt bleibt unverändert.
 */
export async function ensureBrowseCityPackOnDevice(
  cityId: string,
): Promise<boolean> {
  const id = cityId.trim().toLowerCase();
  if (!id) return false;
  if (browseEnsureInFlight && browseEnsureInFlightId === id) {
    return browseEnsureInFlight;
  }
  if (browseEnsureInFlight) {
    try {
      await browseEnsureInFlight;
    } catch {
      /* soft */
    }
  }
  browseEnsureInFlightId = id;
  browseEnsureInFlight = (async () => {
    try {
      let pack: CityPack | null = null;
      if (await isCityPackCachedOnDevice(id)) {
        pack = await loadCityPackLocalOnly(id);
      } else {
        pack = await fetchCityPackById(id);
      }
      if (!pack) return false;
      const mapped = mapCityPackToRemote(pack);
      if (!mapped.pois.length) return false;
      try {
        const { writeMapPinIndex } = await import('./homeMap/mapPinIndex');
        await writeMapPinIndex(id, mapped.pois);
      } catch {
        /* soft */
      }
      await registerCoverageFromLocalPacks({ cityIds: [id] });
      if (__DEV__) {
        console.log(
          `[cityCatalog] Browse-Pack bereit (ohne Aktiv-Switch): ${id} (${mapped.pois.length} Orte)`,
        );
      }
      return true;
    } catch (err) {
      console.warn(
        `[cityCatalog] Browse-Pack ${id} fehlgeschlagen:`,
        String(err).slice(0, 180),
      );
      return false;
    }
  })();
  try {
    return await browseEnsureInFlight;
  } finally {
    browseEnsureInFlight = null;
    browseEnsureInFlightId = null;
  }
}

export async function listLocalCityDatasets(): Promise<LocalCityDataset[]> {
  if (!CITIES_DIR) return [];
  try {
    const dir = await FileSystem.getInfoAsync(CITIES_DIR);
    if (!dir.exists) return [];
    const names = await FileSystem.readDirectoryAsync(CITIES_DIR);
    const versions = await readVersionSidecar();
    const index = peekCityIndexCache() ?? [];
    const byId = new Map<string, LocalCityDataset>();
    for (const name of names) {
      const parsed = parseLocalCityStorageFile(name);
      if (!parsed) continue;
      let bytes = 0;
      try {
        const fi = await FileSystem.getInfoAsync(`${CITIES_DIR}${name}`);
        bytes =
          'size' in fi && typeof fi.size === 'number' ? fi.size : 0;
      } catch {
        bytes = 0;
      }
      const prev = byId.get(parsed.id);
      const next: LocalCityDataset = prev ?? {
        id: parsed.id,
        name:
          index.find((c) => c.id === parsed.id)?.name ?? titleCaseId(parsed.id),
        version: versions[parsed.id]?.version ?? 0,
        bytes: 0,
        packBytes: 0,
        pinsBytes: 0,
        mapBytes: 0,
        hasPack: false,
        hasPins: false,
        hasMap: false,
      };
      next.bytes += bytes;
      if (parsed.kind === 'pack') {
        next.hasPack = true;
        next.packBytes += bytes;
      }
      if (parsed.kind === 'pins') {
        next.hasPins = true;
        next.pinsBytes += bytes;
      }
      if (parsed.kind === 'map') {
        next.hasMap = true;
        next.mapBytes += bytes;
      }
      byId.set(parsed.id, next);
    }
    return [...byId.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'de'));
  } catch {
    return [];
  }
}

/** Nur lokale Dateien. Abo/Zugang bleibt — Datensatz jederzeit neu ladbar. */
export async function removeLocalCityDataset(
  cityId: string,
  opts?: { activeCityId?: string | null },
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  const active = (opts?.activeCityId ?? '').trim().toLowerCase();
  if (!id) return;
  if (active && active === id) {
    throw new Error(
      'Die aktive Stadt kann nicht gelöscht werden. Erst eine andere Stadt wählen.',
    );
  }
  if (!CITIES_DIR) return;
  for (const file of [`${id}.json`, `${id}.pins.json`, `${id}.map.json`]) {
    try {
      await FileSystem.deleteAsync(`${CITIES_DIR}${file}`, { idempotent: true });
    } catch {
      /* soft */
    }
  }
  try {
    const all = await readVersionSidecar();
    delete all[id];
    if (VERSIONS_PATH) {
      await FileSystem.writeAsStringAsync(VERSIONS_PATH, JSON.stringify(all));
    }
  } catch {
    /* soft */
  }
  if (memActive?.cityId === id) {
    memActive = null;
    if (ACTIVE_PATH) {
      try {
        await FileSystem.deleteAsync(ACTIVE_PATH, { idempotent: true });
      } catch {
        /* soft */
      }
    }
  }
  void import('./homeMap/mapPinIndex')
    .then((m) => m.deleteMapPinIndexFile(id))
    .catch(() => undefined);
  void import('./homeMap/cityMapExtract')
    .then((m) => m.deleteCityMapExtractFile(id))
    .catch(() => undefined);
  try {
    const { getDatabase } = await import('../db/database');
    const { deleteCityPronunciations } = await import('../db/cityPronunciations');
    const db = await getDatabase();
    await deleteCityPronunciations(db, id);
  } catch {
    /* soft */
  }
}

/** Einzelne Offline-Teile löschen. Aktive Stadt: Pack bleibt, Karte darf weg. */
export async function removeLocalCityFiles(
  cityId: string,
  kinds: Array<'pack' | 'pins' | 'map'>,
  opts?: { activeCityId?: string | null },
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  const active = (opts?.activeCityId ?? '').trim().toLowerCase();
  if (!id || !kinds.length || !CITIES_DIR) return;
  const wantPack = kinds.includes('pack');
  const wantPins = kinds.includes('pins') || wantPack;
  const wantMap = kinds.includes('map');
  if (active && active === id && wantPack) {
    throw new Error(
      'Die aktive Stadt kann nicht gelöscht werden. Erst eine andere Stadt wählen.',
    );
  }
  const files: string[] = [];
  if (wantPack) files.push(`${id}.json`);
  if (wantPins) files.push(`${id}.pins.json`);
  if (wantMap) files.push(`${id}.map.json`);
  for (const file of files) {
    try {
      await FileSystem.deleteAsync(`${CITIES_DIR}${file}`, { idempotent: true });
    } catch {
      /* soft */
    }
  }
  if (wantPack) {
    try {
      const all = await readVersionSidecar();
      delete all[id];
      if (VERSIONS_PATH) {
        await FileSystem.writeAsStringAsync(VERSIONS_PATH, JSON.stringify(all));
      }
    } catch {
      /* soft */
    }
    if (memActive?.cityId === id) {
      memActive = null;
      if (ACTIVE_PATH) {
        try {
          await FileSystem.deleteAsync(ACTIVE_PATH, { idempotent: true });
        } catch {
          /* soft */
        }
      }
    }
    void import('./homeMap/mapPinIndex')
      .then((m) => m.deleteMapPinIndexFile(id))
      .catch(() => undefined);
    try {
      const { getDatabase } = await import('../db/database');
      const { deleteCityPronunciations } = await import('../db/cityPronunciations');
      const db = await getDatabase();
      await deleteCityPronunciations(db, id);
    } catch {
      /* soft */
    }
  }
  if (wantMap) {
    void import('./homeMap/cityMapExtract')
      .then((m) => m.deleteCityMapExtractFile(id))
      .catch(() => undefined);
  }
}


export async function loadCityPackLocalOnly(
  cityId: string,
): Promise<CityPack | null> {
  const id = cityId.trim().toLowerCase();
  if (!id || !CITIES_DIR) return null;
  try {
    const localPath = `${CITIES_DIR}${id}.json`;
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists || (info.size ?? 0) <= 100) return null;
    const text = await FileSystem.readAsStringAsync(localPath);
    const pack = parseJsonStrict<CityPack>(text, `cache ${id}`);
    return pack && typeof pack === 'object' ? pack : null;
  } catch {
    return null;
  }
}

/**
 * Gemeindegrenzen aus allen lokalen Packs registrieren — nicht nur der
 * aktiven Modul-1-Stadt. Sonst fehlen Offline-Nachbarn (z. B. Tornesch)
 * auf der Rubbelkarte, weil Nominatim offline ausfällt und `_coverage`
 * sonst nur in `mapCityPackToRemote` landet.
 */
export async function registerCoverageFromLocalPacks(opts?: {
  cityIds?: readonly string[];
}): Promise<string[]> {
  const {
    registerCoverageBoundsFromPack,
    hasDetailedCityBoundaryPolygon,
    resolveCityCoverageBoundsSync,
  } = await import('./discovery/cityCoverageBounds');
  const ids = (
    opts?.cityIds?.length
      ? opts.cityIds.map((id) => id.trim().toLowerCase())
      : (await listLocalCityDatasets())
          .filter((r) => r.hasPack)
          .map((r) => r.id.toLowerCase())
  ).filter((id) => id && !id.includes('.'));
  const registered: string[] = [];
  for (const id of ids) {
    const existing = resolveCityCoverageBoundsSync(id);
    if (hasDetailedCityBoundaryPolygon(existing?.polygon)) continue;
    const pack = await loadCityPackLocalOnly(id);
    const cov = pack?._coverage;
    if (!cov) continue;
    if (
      ![cov.latMin, cov.latMax, cov.lngMin, cov.lngMax].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
      )
    ) {
      continue;
    }
    const got = registerCoverageBoundsFromPack({
      cityId: id,
      name: pack.name,
      latMin: cov.latMin,
      latMax: cov.latMax,
      lngMin: cov.lngMin,
      lngMax: cov.lngMax,
      polygon: cov.polygon,
    });
    if (got) registered.push(id);
  }
  return registered;
}

async function localPackVersion(cityId: string, pack: CityPack | null): Promise<number> {
  const fromPack = packDataVersion(pack);
  if (fromPack > 0) return fromPack;
  const side = await readVersionSidecar();
  return side[cityId]?.version ?? 0;
}

async function downloadAndApplyPatches(
  local: CityPack,
  chain: CityPackPatchRef[],
): Promise<CityPack> {
  let cur = local as unknown as Record<string, unknown>;
  for (const ref of chain) {
    const fetched = await fetchPublicJson<CityPackPatchV1>(ref.file);
    cur = applyPackPatch(cur, fetched.data);
  }
  return cur as unknown as CityPack;
}

async function resolvePackForInstall(
  id: string,
  checkRemote: boolean,
): Promise<{ pack: CityPack; decision: PackUpdateDecision }> {
  const local = await loadCityPackLocalOnly(id);
  if (!checkRemote && local) return { pack: local, decision: { kind: 'skip' } };

  const localVer = await localPackVersion(id, local);
  let remoteVer = 0;
  let patches: CityPackPatchRef[] = [];
  try {
    const index = await fetchCityIndex({
      fresh: checkRemote,
      skipBucketListing: true,
    });
    const entry = index.find((c) => c.id === id);
    remoteVer = Number(entry?.data_version) || 0;
    patches = Array.isArray(entry?.patches) ? entry!.patches! : [];
  } catch (err) {
    if (local) {
      console.warn('[cityCatalog] Index fehlgeschlagen, nutze Lokal:', err);
      return { pack: local, decision: { kind: 'skip' } };
    }
  }

  const decision = chooseUpdatePath(localVer, remoteVer, patches);
  if (decision.kind === 'skip' && local) {
    return { pack: local, decision };
  }
  if (decision.kind === 'patch' && local) {
    try {
      const applied = await downloadAndApplyPatches(local, decision.chain);
      await cachePackLocally(id, applied);
      return { pack: applied, decision };
    } catch (err) {
      console.warn('[cityCatalog] Patch fehlgeschlagen → Full:', err);
    }
  }

  return { pack: await fetchCityPackById(id), decision: { kind: 'full' } };
}

/** Liest gecachtes Pack, sonst Download. */
export async function loadCityPackCachedOrRemote(
  cityId: string,
): Promise<CityPack> {
  const id = cityId.trim().toLowerCase();
  const local = await loadCityPackLocalOnly(id);
  if (local) return local;
  return fetchCityPackById(id);
}

export type PackTriggerSummary = {
  /** Alle GPS-Trigger, die nach Mapping feuern können */
  triggerCount: number;
  /** Area + Legacy */
  zoneCount: number;
  /** Approach-Wegpunkte */
  approachCount: number;
  /** Sub-POI-Unterpunkte */
  subCount: number;
  factCount: number;
  storyCount?: number;
  directoryCount?: number;
  /** Einzelne Trigger für die Städteauswahl */
  triggers: Array<{
    name: string;
    kind: 'zone' | 'approach' | 'sub';
  }>;
  /** @deprecated = zoneCount */
  gpsCount: number;
  /** @deprecated = triggerCount */
  placeCount: number;
};

/**
 * Zählt echte GPS-Trigger wie nach `mapCityPackToRemote`:
 * Zonen (area/legacy), Wegpunkte (approach), Unterpunkte (sub).
 */
export function summarizePack(pack: CityPack): PackTriggerSummary {
  const mapped = mapCityPackToRemote(pack);
  let zoneCount = 0;
  let approachCount = 0;
  let subCount = 0;
  const triggers: PackTriggerSummary['triggers'] = [];

  for (const poi of mapped.pois) {
    if (poi.kind === 'approach') {
      approachCount += 1;
      triggers.push({ name: poi.name, kind: 'approach' });
    } else if (poi.kind === 'sub') {
      subCount += 1;
      triggers.push({ name: poi.name, kind: 'sub' });
    } else {
      zoneCount += 1;
      triggers.push({ name: poi.name, kind: 'zone' });
    }
  }

  const triggerCount = mapped.pois.length;
  const storyCount = (pack.spots ?? []).filter(
    (s) => s.pack_role !== 'directory',
  ).length;
  const directoryCount = (pack.spots ?? []).filter(
    (s) => s.pack_role === 'directory',
  ).length;
  // Index nur als Fallback wenn Spots fehlen (ältere Partial-Packs)
  const idx = pack._pack_index;
  const storyCountFinal =
    storyCount > 0
      ? storyCount
      : typeof idx?.story === 'number'
        ? idx.story
        : storyCount;
  const directoryCountFinal =
    directoryCount > 0
      ? directoryCount
      : typeof idx?.directory === 'number'
        ? idx.directory
        : directoryCount;

  return {
    triggerCount,
    zoneCount,
    approachCount,
    subCount,
    factCount: mapped.facts.length,
    triggers,
    gpsCount: zoneCount,
    placeCount: triggerCount,
    storyCount: storyCountFinal,
    directoryCount: directoryCountFinal,
  };
}

/** Einzeiler: „111 Orte · 38 Stories · 73 Katalog · 320 Fakten“ */
export function formatTriggerStats(stats: {
  triggerCount: number;
  zoneCount: number;
  approachCount?: number;
  subCount?: number;
  factCount?: number;
  storyCount?: number;
  directoryCount?: number;
}): string {
  const parts = [`${stats.zoneCount} Orte`];
  if (typeof stats.storyCount === 'number' && typeof stats.directoryCount === 'number') {
    parts.push(`${stats.storyCount} Stories`);
    parts.push(`${stats.directoryCount} Katalog`);
  } else {
    parts.unshift(`${stats.triggerCount} Trigger`);
  }
  if (typeof stats.factCount === 'number') {
    parts.push(`${stats.factCount} Fakten`);
  }
  return parts.join(' · ');
}

/**
 * Lädt Stadt-Pack (lokal / Patch / Full) und schreibt POIs in SQLite.
 * Nur bei expliziter Auswahl / bestätigtem Stadtwechsel / Morgen-Check
 * der aktiven Stadt — kein Auto-Prefetch benachbarter Städte.
 *
 * checkRemote: Index vergleichen. Gleiche Version → kein Download.
 */
let installInFlight: Promise<{
  poiCount: number;
  factCount: number;
  cityName: string;
  gpsCount: number;
}> | null = null;
let installInFlightId: string | null = null;

export async function installCityPack(
  cityId: string,
  opts?: {
    forceRefresh?: boolean;
    checkRemote?: boolean;
    reason?: 'switch' | 'morning' | 'install' | 'sync';
  },
): Promise<{
  poiCount: number;
  factCount: number;
  cityName: string;
  gpsCount: number;
}> {
  const id = cityId.trim().toLowerCase();
  const checkRemote =
    opts?.checkRemote === true ||
    opts?.forceRefresh === true ||
    opts?.reason === 'switch' ||
    opts?.reason === 'morning';
  if (installInFlight && installInFlightId === id) {
    return installInFlight;
  }
  if (installInFlight) {
    try {
      await installInFlight;
    } catch {
      /* soft */
    }
  }

  installInFlightId = id;
  installInFlight = (async () => {
    if (__DEV__) {
      console.log(
        `[cityCatalog] Installiere Stadt-Pack: ${id} (checkRemote=${checkRemote})`,
      );
    }

    if (!opts?.forceRefresh && (await isCityPackCachedOnDevice(id))) {
      const sideVer = (await readVersionSidecar())[id]?.version ?? 0;
      let remoteVer = 0;
      let patches: CityPackPatchRef[] = [];
      if (checkRemote) {
        try {
          const index = await fetchCityIndex({
            fresh: true,
            skipBucketListing: true,
          });
          const entry = index.find((c) => c.id === id);
          remoteVer = Number(entry?.data_version) || 0;
          patches = Array.isArray(entry?.patches) ? entry.patches : [];
        } catch {
          remoteVer = 0;
        }
      }
      const preview = chooseUpdatePath(sideVer, remoteVer, patches);
      const storePois = useFinnusStore.getState().pois;
      const active = await readActiveInstall();
      const alreadyOn =
        preview.kind === 'skip' &&
        sideVer > 0 &&
        ((active?.cityId === id && active.version === sideVer) ||
          poisLookLikeCity(id, storePois));
      if (alreadyOn) {
        if (__DEV__) {
          console.log(`[cityCatalog] Aktuell — Switch ohne Download: ${id} v${sideVer}`);
        }
        await writeActiveInstall({ cityId: id, version: sideVer });
        // Coverage trotzdem aus lokalem Pack — sonst fehlt die Gemeindegrenze
        // auf der Homemap (kein mapCityPackToRemote in diesem Fast-Path).
        void registerCoverageFromLocalPacks({ cityIds: [id] }).catch(() => undefined);
        let pois = storePois;
        if (pois.length === 0) {
          pois = await getAllPois();
          useFinnusStore.getState().setPois(pois);
        }
        const meta = peekCityIndexCache()?.find((c) => c.id === id);
        return {
          poiCount: pois.length || meta?.placeCount || 0,
          factCount: meta?.factCount || 0,
          cityName: meta?.name ?? titleCaseId(id),
          gpsCount: meta?.gpsCount || pois.length || 0,
        };
      }
    }

    // Offline-Extract nur Legacy (MAP_VECTOR_TILES=0). Protomaps: kein *.map.json.
    try {
      const { isVectorBasemapEnabled } = await import('./homeMap/mapTileConfig');
      if (!isVectorBasemapEnabled()) {
        const { scheduleIdleCityMapExtract } = await import('./homeMap/cityMapExtract');
        scheduleIdleCityMapExtract(id);
      }
    } catch {
      /* Extract optional */
    }
    await yieldToUi(checkRemote ? 40 : 120);
    const { pack, decision } = await resolvePackForInstall(id, checkRemote);
    const mapped = mapCityPackToRemote(pack);

    if (mapped.pois.length === 0) {
      throw new Error(
        `In „${id}.json“ wurden keine Orte mit GPS gefunden. Datei prüfen.`,
      );
    }

    const firstWave = mapped.pois.filter((p) => {
      const kind = p.kind ?? 'legacy';
      if (kind === 'approach' || kind === 'sub') return false;
      return !(p.tags_json ?? '').toLowerCase().includes('directory');
    });
    useFinnusStore.getState().setPois(
      firstWave.length > 0 ? firstWave : mapped.pois,
    );
    void import('./homeMap/mapPinIndex')
      .then((m) => m.writeMapPinIndex(id, mapped.pois))
      .catch(() => undefined);
    await yieldToUi(48);
    await replacePoisAndFacts(mapped.pois, mapped.facts);
    try {
      const { reapplyLearnedPoisForCity } = await import('../db/learnedPoiOverlay');
      await reapplyLearnedPoisForCity(id);
    } catch {
      /* soft */
    }
    const localPois = await getAllPois();
    useFinnusStore.getState().setPois(localPois);
    void import('./homeMap/mapPinIndex')
      .then((m) => m.writeMapPinIndex(id, localPois))
      .catch(() => undefined);
    await writeActiveInstall({
      cityId: id,
      version: packDataVersion(pack) || (await localPackVersion(id, pack)),
    });
    if (__DEV__) {
      console.log(
        `[cityCatalog] Install OK: ${mapped.pois.length} Orte, ${mapped.facts.length} Fakten (${id}, ${decision.kind})`,
      );
    }

    const skipHeavy = decision.kind === 'skip' && opts?.forceRefresh !== true;
    if (!skipHeavy) {
      void (async () => {
        try {
          await parseAndCacheCityPronunciations(pack);
        } catch (err) {
          if (__DEV__) console.warn('[cityCatalog] Aussprache-Parser:', err);
        }
        try {
          await scanCityDatasetSafe(pack);
          await scanPoiDatasetSafe(pack);
          void syncDictionaryAfterCityDownload().catch(() => undefined);
        } catch (err) {
          if (__DEV__) console.warn('[cityCatalog] Dictionary-Scanner:', err);
        }
        void import('./homeMap/enrichHomeMapFootprints')
          .then((m) => m.enrichFootprintsAfterPackInstall(localPois))
          .catch(() => undefined);
        try {
          const { useGpsStore } = await import('../store/useGpsStore');
          const g = useGpsStore.getState();
          if (g.lat != null && g.lng != null) {
            const { prefetchRegionalFallbackAfterOnline } = await import(
              './homeMap/regionalFallbackPrefetch'
            );
            void prefetchRegionalFallbackAfterOnline(g.lat, g.lng);
          }
        } catch {
          /* soft */
        }
      })();
    }

    return {
      poiCount: mapped.pois.length,
      factCount: mapped.facts.length,
      cityName: pack.name ?? titleCaseId(id),
      gpsCount: mapped.pois.length,
    };
  })();

  try {
    return await installInFlight;
  } finally {
    installInFlight = null;
    installInFlightId = null;
  }
}

function sortByDistance(items: CityCatalogItem[]): CityCatalogItem[] {
  return [...items].sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) {
      return a.name.localeCompare(b.name, 'de');
    }
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

/**
 * Lädt den Städte-Index (klein). Volle Packs werden erst bei Auswahl geladen —
 * früher hat die Liste jedes JSON parallel geholt und den JS-Thread 30–90 s
 * eingefroren (Buttons tot, Zurück tot, Settings tot).
 */
export async function loadCityCatalog(
  userCoords: {
    lat: number;
    lng: number;
  } | null,
  opts?: { bustCache?: boolean; fresh?: boolean; skipBucketListing?: boolean },
): Promise<CityCatalogItem[]> {
  const entries = await fetchCityIndex({
    fresh: opts?.fresh === true || opts?.bustCache === true,
    skipBucketListing: opts?.skipBucketListing !== false,
  });
  if (__DEV__) {
    console.log(
      `[cityCatalog] ${entries.length} Städte (Index, ohne Pack-Download):`,
      entries.map((e) => e.id).join(', '),
    );
  }

  const items = entries.map((entry) => catalogItemFromIndex(entry, userCoords));
  const sorted = sortByDistance(items);
  void import('../constants/cityCovers')
    .then((m) => {
      if (typeof m.prefetchCityCovers === 'function') {
        m.prefetchCityCovers(sorted.slice(0, 4));
      }
    })
    .catch(() => undefined);
  return sorted;
}

/** Cache → Picker, ohne Netzwerk. */
export function catalogItemsFromIndexCache(
  userCoords: { lat: number; lng: number } | null,
): CityCatalogItem[] | null {
  const warmed = peekWarmCityCatalog();
  if (warmed && warmed.length > 0) {
    return userCoords ? resortCatalogByCoords(warmed, userCoords) : warmed;
  }
  if (!lastCityIndexCache?.length) return null;
  return sortByDistance(
    lastCityIndexCache.map((entry) => catalogItemFromIndex(entry, userCoords)),
  );
}

/** Nach Settings-Chrome: nahe Städte aus Index, kein Bucket-Listing. */
export async function prefetchNearbyCityCatalog(): Promise<CityCatalogItem[]> {
  const { useGpsStore } = await import('../store/useGpsStore');
  const g = useGpsStore.getState();
  const coords =
    g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null;
  return loadCityCatalog(coords, {
    bustCache: false,
    skipBucketListing: true,
  });
}

/** Onboarding-Warmup: Katalog + GPS schon laden, bevor der City-Screen sichtbar ist. */
let warmCatalogPromise: Promise<CityCatalogItem[]> | null = null;
let warmCatalogCache: CityCatalogItem[] | null = null;
let warmGpsStatus: 'pending' | 'ready' | 'unavailable' = 'pending';

export function getWarmCityCatalogGpsStatus():
  | 'pending'
  | 'ready'
  | 'unavailable' {
  return warmGpsStatus;
}

export function peekWarmCityCatalog(): CityCatalogItem[] | null {
  return warmCatalogCache;
}

/** Verwirft Warm-Cache, damit der nächste Warmup frisch von Remote lädt. */
export function invalidateWarmCityCatalog(): void {
  warmCatalogPromise = null;
  warmCatalogCache = null;
  warmGpsStatus = 'pending';
}

/**
 * Startet Katalog+GPS im Hintergrund.
 * Ohne `force` idempotent (paralleles Warten ok).
 * Mit `force` immer frischer Index — Einrichtung und Settings bleiben synchron.
 */
export function warmCityCatalogForOnboarding(opts?: {
  force?: boolean;
}): Promise<CityCatalogItem[]> {
  if (opts?.force) {
    warmCatalogPromise = null;
  } else if (warmCatalogPromise) {
    return warmCatalogPromise;
  }

  warmGpsStatus = 'pending';
  warmCatalogPromise = (async () => {
    try {
      const base = await loadCityCatalog(null, { fresh: false });
      warmCatalogCache = base;

      const { getCurrentCoords } = await import('./locationService');
      const coords = await getCurrentCoords({ timeoutMs: 8000 });
      if (coords) {
        const sorted = resortCatalogByCoords(base, coords);
        warmCatalogCache = sorted;
        warmGpsStatus = 'ready';
        return sorted;
      }
      warmGpsStatus = 'unavailable';
      return base;
    } catch (err) {
      warmGpsStatus = 'unavailable';
      warmCatalogPromise = null;
      throw err;
    }
  })();

  return warmCatalogPromise;
}

/** Entfernungen neu berechnen / sortieren (nach spätem GPS-Fix). */
export function resortCatalogByCoords(
  items: CityCatalogItem[],
  userCoords: { lat: number; lng: number } | null,
): CityCatalogItem[] {
  if (!userCoords) return sortByDistance(items);

  const updated = items.map((item) => {
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number') {
      return { ...item, distanceKm: null };
    }
    return {
      ...item,
      distanceKm: haversineKm(
        userCoords.lat,
        userCoords.lng,
        item.lat,
        item.lng,
      ),
    };
  });

  return sortByDistance(updated);
}

/** Mappt Pack für Sync (gleiche Logik wie syncService). */
export function packToRemote(pack: CityPack) {
  return mapCityPackToRemote(pack);
}

/** Für Tests / Debug */
export function getCityPackPublicUrl(cityId: string): string {
  return cityPackPublicUrl(cityId);
}

const WANGEROOGE_ORTSPLAN: CityPackLink = {
  id: 'ortsplan_interaktiv',
  title: 'Interaktiver Orts- & Inselplan',
  url: 'https://www.wangerooge.de/ortsplan-inselplan-der-nordseeinsel',
  provider: 'wangerooge.de / Kurverwaltung',
  description:
    'Offizielle Karte mit Filtern für Unterkünfte, Genuss, Touren und Inselziele.',
  tags: ['karte', 'orientierung', 'must_have', 'official'],
};

function normalizePackLinks(raw: unknown): CityPackLink[] {
  if (!Array.isArray(raw)) return [];
  const out: CityPackLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!url.startsWith('http') || !title) continue;
    out.push({
      id: typeof row.id === 'string' ? row.id : title,
      title,
      url,
      provider: typeof row.provider === 'string' ? row.provider : undefined,
      description:
        typeof row.description === 'string' ? row.description : undefined,
      tags: Array.isArray(row.tags)
        ? row.tags.map(String).filter(Boolean)
        : undefined,
    });
  }
  return out;
}

/**
 * Offizielle Stadt-Links aus lokalem Cache / Remote-Pack.
 * Fallback: bekannte Must-have-Links (z. B. Wangerooge Ortsplan), bis Cloud-Pack nachzieht.
 */
export async function getCityPackLinks(
  cityId: string | null | undefined,
): Promise<CityPackLink[]> {
  const id = (cityId ?? '').trim().toLowerCase();
  if (!id) return [];

  let links: CityPackLink[] = [];
  try {
    const pack = await loadCityPackLocalOnly(id);
    if (!pack) {
      /* kein Netz nur für Links */
    } else {
    links = normalizePackLinks(pack._links);
    // _meta.sources → synthetische Links (Website/Events), wenn kein _links-Eintrag
    const sources = Array.isArray(pack._meta?.sources)
      ? pack._meta!.sources!.filter((u): u is string => typeof u === 'string')
      : [];
    const seen = new Set(links.map((l) => l.url.toLowerCase()));
    for (const raw of sources) {
      const url = raw.trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./i, '');
      } catch {
        continue;
      }
      links.push({
        id: `source_${host}`,
        title: host,
        url,
        tags: [/event|vergnueg|vergnüg|kalender|fest/i.test(url + host)
          ? 'events'
          : 'website'],
      });
    }
    }
  } catch (err) {
    console.warn('[cityCatalog] Links laden fehlgeschlagen:', err);
  }

  if (id === 'wangerooge' && !links.some((l) => l.id === WANGEROOGE_ORTSPLAN.id)) {
    links = [WANGEROOGE_ORTSPLAN, ...links];
  }
  return links;
}

export type { CityPackLink };

