/**
 * Laufzeit: Stadt-SQLite (Stufe 1) als Map-Cache.
 * Global-JSON (Stufe 2) lebt in tts/pronunciationMap.ts.
 */
import { getDatabase } from '../../db/database';
import {
  ensureCityPronunciationsTable,
  loadCityPronunciationMap,
} from '../../db/cityPronunciations';
import {
  getPronunciationCache,
  getPronunciationRecord,
  loadPronunciationDictionary,
} from '../tts/pronunciationMap';

type CityCacheEntry = {
  cityId: string;
  map: Map<string, string>;
  loadedAt: number;
};

let cityCache: CityCacheEntry | null = null;

export function invalidateCityPronunciationCache(cityId?: string): void {
  if (!cityId || cityCache?.cityId === cityId.trim().toLowerCase()) {
    cityCache = null;
  }
}

/** Merge plain records — Stadt überschreibt Global (Legacy). */
export function mergePronunciationMaps(
  globalMap: Record<string, string>,
  cityMap: Record<string, string>,
): Record<string, string> {
  return { ...globalMap, ...cityMap };
}

/**
 * Stufe-1-Cache: word→ipa Map der aktiven Stadt (SQLite).
 * Ohne cityId → leere Map.
 */
export async function getCityPronunciationMap(
  cityId?: string | null,
): Promise<Map<string, string>> {
  const id = (cityId ?? '').trim().toLowerCase();
  if (!id) return new Map();

  if (cityCache && cityCache.cityId === id) {
    return cityCache.map;
  }

  try {
    const db = await getDatabase();
    await ensureCityPronunciationsTable(db);
    const record = await loadCityPronunciationMap(db, id);
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(record)) {
      const key = k.trim().toLowerCase();
      if (key && v) map.set(key, v);
    }
    cityCache = { cityId: id, map, loadedAt: Date.now() };
    if (__DEV__) {
      console.log(`[pronunciation] Stadt-Cache ${id}: ${map.size} Einträge`);
    }
    return map;
  } catch (err) {
    console.warn('[pronunciation] City-Map Load fehlgeschlagen:', err);
    return new Map();
  }
}

/**
 * Legacy: fusionierte Record-Map (Stadt gewinnt).
 * Bevorzugt getCityPronunciationMap + getPronunciationCache für 3-Tier.
 */
export async function getFusedPronunciationMap(
  cityId?: string | null,
): Promise<Record<string, string>> {
  await loadPronunciationDictionary();
  const cityMap = await getCityPronunciationMap(cityId);
  if (cityMap.size === 0) {
    return getPronunciationRecord();
  }
  const fused = mergePronunciationMaps(
    getPronunciationRecord(),
    Object.fromEntries(cityMap),
  );
  return fused;
}

/** Boot-Warmup: JSON-Map + optional Stadt. */
export async function warmupPronunciationPipeline(
  cityId?: string | null,
): Promise<void> {
  await loadPronunciationDictionary();
  if (cityId) await getCityPronunciationMap(cityId);
  // touch cache size for readiness
  void getPronunciationCache().size;
}
