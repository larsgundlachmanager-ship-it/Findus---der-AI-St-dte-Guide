/**
 * Globales Aussprache-Wörterbuch + 3-Stufen-Lookup.
 *
 * Stufe 1: Stadt-SQLite (city Map)
 * Stufe 2: pronunciations.json (dieser Cache)
 * Stufe 3: natives espeak-ng (de) — Caller
 *
 * Boot: loadPronunciationDictionary() → JavaScript Map (<1ms Lookup/Wort).
 */
import pronunciationsJson from '../../assets/data/pronunciations.json';

type DictRecord = Record<string, string>;

let globalCache: Map<string, string> | null = null;
/** Phrasen mit Leerzeichen, längste zuerst — einmalig gebaut. */
let globalPhrases: string[] = [];
let loadPromise: Promise<Map<string, string>> | null = null;

function normalizeKey(word: string): string {
  return word.normalize('NFKC').toLowerCase().trim();
}

function buildCacheFromRecord(record: DictRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rawKey, rawIpa] of Object.entries(record)) {
    const key = normalizeKey(rawKey);
    const ipa = String(rawIpa ?? '').trim();
    if (!key || !ipa) continue;
    map.set(key, ipa);
  }
  return map;
}

function rebuildPhraseIndex(map: Map<string, string>): string[] {
  return [...map.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
}

/**
 * Lädt pronunciations.json einmalig in einen Map-Cache.
 * Idempotent — Folgeaufrufe geben denselben Cache zurück.
 */
export async function loadPronunciationDictionary(): Promise<Map<string, string>> {
  if (globalCache) return globalCache;
  if (!loadPromise) {
    loadPromise = (async () => {
      const map = buildCacheFromRecord(pronunciationsJson as DictRecord);
      globalCache = map;
      globalPhrases = rebuildPhraseIndex(map);
      if (__DEV__) {
        console.log(
          `[pronunciation] JSON-Cache bereit: ${map.size} Einträge, ${globalPhrases.length} Phrasen`,
        );
      }
      return map;
    })().finally(() => {
      // keep cache; allow retry only if failed
      if (!globalCache) loadPromise = null;
    });
  }
  return loadPromise;
}

/** Sync-Zugriff nach Boot; lazy-init falls noch nicht geladen. */
export function getPronunciationCache(): Map<string, string> {
  if (!globalCache) {
    globalCache = buildCacheFromRecord(pronunciationsJson as DictRecord);
    globalPhrases = rebuildPhraseIndex(globalCache);
  }
  return globalCache;
}

export function getGlobalPhraseKeys(): readonly string[] {
  if (!globalCache) getPronunciationCache();
  return globalPhrases;
}

/** O(1) Lookup im globalen JSON-Cache. */
export function lookupGlobalPronunciation(word: string): string | undefined {
  return getPronunciationCache().get(normalizeKey(word));
}

/**
 * 3-Stufen-Wort-Lookup (Stadt → JSON → undefined/espeak).
 * Ziel: <1ms pro Wort (Map.get).
 */
export function lookupPronunciationTier(
  word: string,
  cityMap?: Map<string, string> | null,
): { ipa: string; tier: 1 | 2 } | null {
  const key = normalizeKey(word);
  if (!key) return null;
  const cityIpa = cityMap?.get(key);
  if (cityIpa) return { ipa: cityIpa, tier: 1 };
  const globalIpa = getPronunciationCache().get(key);
  if (globalIpa) return { ipa: globalIpa, tier: 2 };
  return null;
}

/** Alias-Record für Legacy-APIs (lazy Proxy über Map). */
function mapToRecord(map: Map<string, string>): DictRecord {
  const out: DictRecord = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

/** @deprecated Prefer getPronunciationCache() — bleibt für Export-Kompatibilität. */
export const PRONUNCIATION_MAP: DictRecord = new Proxy({} as DictRecord, {
  get(_t, prop: string | symbol) {
    if (typeof prop !== 'string') return undefined;
    return getPronunciationCache().get(normalizeKey(prop));
  },
  ownKeys() {
    return [...getPronunciationCache().keys()];
  },
  getOwnPropertyDescriptor(_t, prop) {
    if (typeof prop !== 'string') return undefined;
    const v = getPronunciationCache().get(normalizeKey(prop));
    if (v === undefined) return undefined;
    return { configurable: true, enumerable: true, value: v };
  },
  has(_t, prop) {
    return typeof prop === 'string' && getPronunciationCache().has(normalizeKey(prop));
  },
});

export const PRONUNCIATION_DICTIONARY = PRONUNCIATION_MAP;

/** Kategorien entfallen in JSON-Architektur — leere Gruppen für API-Kompatibilität. */
export const PRONUNCIATION_CATEGORIES = {
  global: PRONUNCIATION_MAP,
} as const;

export type PronunciationCategory = keyof typeof PRONUNCIATION_CATEGORIES;

export function getPronunciationCategoryCounts(): Record<PronunciationCategory, number> {
  return { global: getPronunciationCache().size };
}

export function getPronunciationMapSize(): number {
  return getPronunciationCache().size;
}

/** Snapshot als plain object (z. B. Tests / Merge). */
export function getPronunciationRecord(): DictRecord {
  return mapToRecord(getPronunciationCache());
}

export { pronunciationsJson };
