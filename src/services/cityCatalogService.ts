import * as FileSystem from 'expo-file-system';
import { env } from '../config/env';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { mapCityPackToRemote, type CityPack, type CityPackLink } from './cityPack';
import { replacePoisAndFacts, getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { parseAndCacheCityPronunciations } from './tts/cityPronunciationParser';
import { scanCityDatasetSafe } from './scanner/cityScanner';
import { scanPoiDatasetSafe } from './ai/poiDatasetScanner';
import { syncDictionaryAfterCityDownload } from './sync/dictionarySyncService';
import { prefetchCityCovers } from '../constants/cityCovers';

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
  /** Hero-Cover (HTTPS) — aus Pack `cover_url` / `_meta.cover_url` */
  coverUrl?: string | null;
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

async function fetchPublicJson<T>(
  path: string,
  opts?: { bustCache?: boolean },
): Promise<T> {
  const base = resolveSupabaseBase();
  let publicUrl = `${base}/storage/v1/object/public/${STAEDTE_BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  if (opts?.bustCache) {
    publicUrl += `${publicUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  }

  const errors: string[] = [];

  // 1) fetch JSON – primärer Weg (zuverlässig in RN Dev Client)
  try {
    const response = await fetch(publicUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
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
    if (!e?.id || OBSOLETE_CITY_IDS.has(e.id)) continue;
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

/**
 * Vereinigt index.json + Bucket-Listing.
 * So erscheinen alle hochgeladenen Städte, auch wenn index.json veraltet ist.
 * `bustCache` umgeht HTTP-/CDN-Caches für index.json (UI soll immer aktuell sein).
 */
export async function fetchCityIndex(opts?: {
  bustCache?: boolean;
}): Promise<CityIndexEntry[]> {
  const byId = new Map<string, CityIndexEntry>();
  const bustCache = opts?.bustCache !== false;

  if (!isSupabaseConfigured()) {
    return [...HARDCODED_CITY_INDEX];
  }

  try {
    const index = await fetchPublicJson<CityIndexFile>('index.json', {
      bustCache,
    });
    for (const city of index.available_cities ?? []) {
      if (!city?.id || OBSOLETE_CITY_IDS.has(city.id)) continue;
      const raw = city as CityIndexEntry & { cover_url?: string };
      const coverUrl =
        (typeof raw.coverUrl === 'string' && raw.coverUrl.trim()) ||
        (typeof raw.cover_url === 'string' && raw.cover_url.trim()) ||
        null;
      byId.set(city.id, { ...raw, coverUrl });
    }
  } catch (err) {
    console.warn('[cityCatalog] index.json fehlgeschlagen:', err);
  }

  const listed = await listCityIdsFromBucket();
  for (const id of listed) {
    if (OBSOLETE_CITY_IDS.has(id)) continue;
    if (!byId.has(id)) {
      byId.set(id, { id, name: titleCaseId(id), symbol: '📍' });
    }
  }

  if (byId.size === 0) {
    console.warn('[cityCatalog] Keine Städte – Hardcoded Fallback');
    return [...HARDCODED_CITY_INDEX];
  }

  return dedupeCityIndex(Array.from(byId.values()));
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
  const idx = pack._pack_index;
  const storyCount =
    typeof idx?.story === 'number'
      ? idx.story
      : (pack.spots ?? []).filter((s) => s.pack_role !== 'directory').length;
  const directoryCount =
    typeof idx?.directory === 'number'
      ? idx.directory
      : (pack.spots ?? []).filter((s) => s.pack_role === 'directory').length;

  return {
    triggerCount,
    zoneCount,
    approachCount,
    subCount,
    factCount: mapped.facts.length,
    triggers,
    gpsCount: zoneCount,
    placeCount: triggerCount,
    storyCount,
    directoryCount,
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
 * Lädt Stadt-Pack herunter, mappt POIs/Fakten und schreibt sie in SQLite.
 * Nur bei expliziter Auswahl / bestätigtem Stadtwechsel — kein Auto-Prefetch
 * benachbarter Städte (Paywall: jede Stadt einzeln).
 */
export async function installCityPack(cityId: string): Promise<{
  poiCount: number;
  factCount: number;
  cityName: string;
  gpsCount: number;
}> {
  if (__DEV__) console.log(`[cityCatalog] Installiere Stadt-Pack: ${cityId}`);
  // UI zuerst atmen lassen (CityStep/Settings bleiben flüssig)
  await new Promise<void>((resolve) => {
    try {
      const { InteractionManager } = require('react-native') as {
        InteractionManager: {
          runAfterInteractions: (cb: () => void) => { cancel?: () => void };
        };
      };
      InteractionManager.runAfterInteractions(() => resolve());
    } catch {
      setTimeout(() => resolve(), 0);
    }
  });
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
    if (__DEV__) console.warn('[cityCatalog] Aussprache-Parser:', err);
  }
  try {
    await scanCityDatasetSafe(pack);
    await scanPoiDatasetSafe(pack);
    void syncDictionaryAfterCityDownload().catch(() => undefined);
  } catch (err) {
    if (__DEV__) console.warn('[cityCatalog] Dictionary-Scanner:', err);
  }
  const localPois = await getAllPois();
  useFinnusStore.getState().setPois(localPois);

  const stats = summarizePack(pack);
  if (__DEV__) {
    console.log(
      `[cityCatalog] Install OK: ${mapped.pois.length} Orte, ${mapped.facts.length} Fakten (${cityId})`,
    );
  }

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
 * Index wird standardmäßig cache-bust geladen, damit neue Städte sofort erscheinen.
 */
export async function loadCityCatalog(
  userCoords: {
    lat: number;
    lng: number;
  } | null,
  opts?: { bustCache?: boolean },
): Promise<CityCatalogItem[]> {
  const entries = await fetchCityIndex({
    bustCache: opts?.bustCache !== false,
  });
  console.log(
    `[cityCatalog] ${entries.length} Städte gefunden:`,
    entries.map((e) => e.id).join(', '),
  );

  const settled = await Promise.allSettled(
    entries.map(async (entry): Promise<CityCatalogItem> => {
      let triggerCount = 0;
      let zoneCount = 0;
      let approachCount = 0;
      let subCount = 0;
      let factCount = 0;
      let storyCount: number | undefined;
      let directoryCount: number | undefined;
      let triggers: CityCatalogItem['triggers'] = [];
      let lat = entry.lat;
      let lng = entry.lng;
      let name = entry.name || titleCaseId(entry.id);
      let symbol = entry.symbol ?? '📍';
      let coverUrl: string | null =
        typeof entry.coverUrl === 'string' ? entry.coverUrl : null;

      try {
        const pack = await fetchCityPackById(entry.id);
        const stats = summarizePack(pack);
        triggerCount = stats.triggerCount;
        zoneCount = stats.zoneCount;
        approachCount = stats.approachCount;
        subCount = stats.subCount;
        factCount = stats.factCount;
        storyCount = stats.storyCount;
        directoryCount = stats.directoryCount;
        triggers = stats.triggers;
        if (typeof pack.lat === 'number') lat = pack.lat;
        if (typeof pack.lng === 'number') lng = pack.lng;
        if (pack.name) name = pack.name;
        if (pack.symbol) symbol = pack.symbol;
        const fromPack =
          (typeof pack.cover_url === 'string' && pack.cover_url.trim()) ||
          (typeof pack._meta?.cover_url === 'string' &&
            String(pack._meta.cover_url).trim()) ||
          '';
        if (fromPack) coverUrl = fromPack;
        console.log(
          `[cityCatalog] ${entry.id}: ${formatTriggerStats(stats)}`,
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
        coverUrl,
        distanceKm,
        triggerCount,
        zoneCount,
        approachCount,
        subCount,
        factCount,
        storyCount,
        directoryCount,
        triggers,
        gpsCount: zoneCount,
        placeCount: triggerCount,
      };
    }),
  );

  const items: CityCatalogItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(result.value);
  }

  const sorted = sortByDistance(items);
  // Nur nahe/vorgeschlagene Städte vorwärmen — nicht die ganze Welt
  prefetchCityCovers(sorted.slice(0, 24));
  return sorted;
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
      // Erst ohne GPS, damit Pack-Stats schnell da sind; Index immer cache-bust
      const base = await loadCityCatalog(null, { bustCache: true });
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
    const pack = await loadCityPackCachedOrRemote(id);
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
  } catch (err) {
    console.warn('[cityCatalog] Links laden fehlgeschlagen:', err);
  }

  if (id === 'wangerooge' && !links.some((l) => l.id === WANGEROOGE_ORTSPLAN.id)) {
    links = [WANGEROOGE_ORTSPLAN, ...links];
  }
  return links;
}

export type { CityPackLink };
