import * as FileSystem from 'expo-file-system';
import { env } from '../config/env';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { mapCityPackToRemote, type CityPack } from './cityPack';
import { replacePoisAndFacts, getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { parseAndCacheCityPronunciations } from './tts/cityPronunciationParser';
import { scanCityDatasetSafe } from './scanner/cityScanner';
import { syncDictionaryAfterCityDownload } from './sync/dictionarySyncService';

const STAEDTE_BUCKET = 'staedte';
const DOC_DIR = FileSystem.documentDirectory;
const CITIES_DIR = DOC_DIR ? `${DOC_DIR}cities/` : null;

export type CityIndexEntry = {
  id: string;
  name: string;
  data_version?: number;
  symbol?: string;
  lat?: number;
  lng?: number;
  district?: string;
};

export type CityCatalogItem = CityIndexEntry & {
  distanceKm: number | null;
  /** Anzahl GPS-Triggerpunkte */
  gpsCount: number;
  /** Anzahl Orte / Spots */
  placeCount: number;
  /** Anzahl Fakten (Bullets + Erzählungen + Deep-Data) */
  factCount: number;
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

function titleCaseId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
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

async function fetchPublicJson<T>(path: string): Promise<T> {
  const base = resolveSupabaseBase();
  const publicUrl = `${base}/storage/v1/object/public/${STAEDTE_BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const errors: string[] = [];

  // 1) fetch JSON – primärer Weg (zuverlässig in RN Dev Client)
  try {
    const response = await fetch(publicUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const text = await response.text();
      return parseJsonStrict<T>(text, `fetch ${path}`);
    }
    errors.push(`fetch HTTP ${response.status}`);
    console.warn(
      `[cityCatalog] public fetch ${path}: HTTP ${response.status}`,
    );
  } catch (err) {
    errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`[cityCatalog] public fetch ${path}:`, err);
  }

  // 2) expo-file-system – Fallback, wenn documentDirectory verfügbar
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
            return parsed;
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

  // 3) Supabase Storage SDK
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(STAEDTE_BUCKET)
        .download(path);
      if (!error && data) {
        const text = await readBodyAsText(data);
        return parseJsonStrict<T>(text, `sdk ${path}`);
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
      .filter(
        (name) =>
          typeof name === 'string' &&
          name.toLowerCase().endsWith('.json') &&
          name.toLowerCase() !== 'index.json',
      )
      .map((name) => name.replace(/\.json$/i, ''));
  } catch (err) {
    console.warn('[cityCatalog] list bucket Exception:', err);
    return [];
  }
}

/**
 * Vereinigt index.json + Bucket-Listing.
 * So erscheinen alle hochgeladenen Städte, auch wenn index.json veraltet ist.
 */
export async function fetchCityIndex(): Promise<CityIndexEntry[]> {
  const byId = new Map<string, CityIndexEntry>();

  if (!isSupabaseConfigured()) {
    return [
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
    ];
  }

  try {
    const index = await fetchPublicJson<CityIndexFile>('index.json');
    for (const city of index.available_cities ?? []) {
      if (city?.id) byId.set(city.id, city);
    }
  } catch (err) {
    console.warn('[cityCatalog] index.json fehlgeschlagen:', err);
  }

  const listed = await listCityIdsFromBucket();
  for (const id of listed) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: titleCaseId(id), symbol: '📍' });
    }
  }

  if (byId.size === 0) {
    console.warn('[cityCatalog] Keine Städte – Hardcoded Fallback');
    return [
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
    ];
  }

  return Array.from(byId.values());
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
  } catch (err) {
    console.warn('[cityCatalog] Lokaler Cache fehlgeschlagen:', err);
  }
}

export async function fetchCityPackById(cityId: string): Promise<CityPack> {
  const pack = await fetchPublicJson<CityPack>(`${cityId}.json`);
  if (!pack || typeof pack !== 'object') {
    throw new Error(`Ungültiges Stadt-Pack: ${cityId}`);
  }
  await cachePackLocally(cityId, pack);
  return pack;
}

/** Liest gecachtes Pack, sonst Download. */
export async function loadCityPackCachedOrRemote(
  cityId: string,
): Promise<CityPack> {
  if (CITIES_DIR) {
    const localPath = `${CITIES_DIR}${cityId}.json`;
    try {
      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists && (info.size ?? 0) > 100) {
        const text = await FileSystem.readAsStringAsync(localPath);
        const pack = parseJsonStrict<CityPack>(text, `cache ${cityId}`);
        if (pack && typeof pack === 'object') {
          return pack;
        }
      }
    } catch {
      // ignore → remote
    }
  }
  return fetchCityPackById(cityId);
}

export function summarizePack(pack: CityPack): {
  gpsCount: number;
  placeCount: number;
  factCount: number;
} {
  const spots = pack.spots ?? [];
  const triggers = pack.trigger_points ?? [];

  let factCount = 0;
  for (const spot of spots) {
    factCount += spot.bullets?.length ?? 0;
  }
  for (const tp of triggers) {
    if (tp.general_info?.trim()) factCount += 1;
    factCount += tp.deep_data_pool?.length ?? 0;
  }

  return {
    gpsCount: triggers.length,
    placeCount: spots.length > 0 ? spots.length : triggers.length,
    factCount,
  };
}

/**
 * Lädt Stadt-Pack herunter, mappt POIs/Fakten und schreibt sie in SQLite.
 */
export async function installCityPack(cityId: string): Promise<{
  poiCount: number;
  factCount: number;
  cityName: string;
  gpsCount: number;
}> {
  console.log(`[cityCatalog] Installiere Stadt-Pack: ${cityId}`);
  const pack = await loadCityPackCachedOrRemote(cityId);
  const mapped = mapCityPackToRemote(pack);

  if (mapped.pois.length === 0) {
    throw new Error(
      `In „${cityId}.json“ wurden keine Orte mit GPS gefunden. Datei prüfen.`,
    );
  }

  await replacePoisAndFacts(mapped.pois, mapped.facts);
  try {
    await parseAndCacheCityPronunciations(pack);
  } catch (err) {
    console.warn('[cityCatalog] Aussprache-Parser:', err);
  }
  try {
    await scanCityDatasetSafe(pack);
    void syncDictionaryAfterCityDownload().catch(() => undefined);
  } catch (err) {
    console.warn('[cityCatalog] Dictionary-Scanner:', err);
  }
  const localPois = await getAllPois();
  useFinnusStore.getState().setPois(localPois);

  const stats = summarizePack(pack);
  console.log(
    `[cityCatalog] Install OK: ${mapped.pois.length} Orte, ${mapped.facts.length} Fakten (${cityId})`,
  );

  return {
    poiCount: mapped.pois.length,
    factCount: mapped.facts.length,
    cityName: pack.name ?? titleCaseId(cityId),
    gpsCount: stats.gpsCount,
  };
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
 * Lädt alle verfügbaren Städte (index + Bucket).
 * Speichert kein volles Pack im State (nur Stats) – Download bei Auswahl.
 */
export async function loadCityCatalog(userCoords: {
  lat: number;
  lng: number;
} | null): Promise<CityCatalogItem[]> {
  const entries = await fetchCityIndex();
  console.log(
    `[cityCatalog] ${entries.length} Städte gefunden:`,
    entries.map((e) => e.id).join(', '),
  );

  const settled = await Promise.allSettled(
    entries.map(async (entry): Promise<CityCatalogItem> => {
      let gpsCount = 0;
      let placeCount = 0;
      let factCount = 0;
      let lat = entry.lat;
      let lng = entry.lng;
      let name = entry.name || titleCaseId(entry.id);
      let symbol = entry.symbol ?? '📍';

      try {
        const pack = await fetchCityPackById(entry.id);
        const stats = summarizePack(pack);
        gpsCount = stats.gpsCount;
        placeCount = stats.placeCount;
        factCount = stats.factCount;
        if (typeof pack.lat === 'number') lat = pack.lat;
        if (typeof pack.lng === 'number') lng = pack.lng;
        if (pack.name) name = pack.name;
        if (pack.symbol) symbol = pack.symbol;
        console.log(
          `[cityCatalog] ${entry.id}: GPS=${gpsCount} Orte=${placeCount} Fakten=${factCount}`,
        );
      } catch (err) {
        console.warn(`[cityCatalog] Pack ${entry.id} fehlgeschlagen:`, err);
      }

      const distanceKm =
        userCoords && typeof lat === 'number' && typeof lng === 'number'
          ? haversineKm(userCoords.lat, userCoords.lng, lat, lng)
          : null;

      return {
        ...entry,
        name,
        symbol,
        lat,
        lng,
        distanceKm,
        gpsCount,
        placeCount,
        factCount,
      };
    }),
  );

  const items: CityCatalogItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(result.value);
  }

  return sortByDistance(items);
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
