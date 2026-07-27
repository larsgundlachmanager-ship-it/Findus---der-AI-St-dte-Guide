/**
 * Dynamische Dictionary-Engine — Offline-First (studio-v4).
 *
 * Kanonische Offline-Quelle:
 *   FileSystem.documentDirectory/pronunciations_master.json
 *
 * Schichten (Priorität hoch → niedrig beim Lookup):
 * 1) User/Scanner-Korrekturen (geschützt — Cloud überschreibt nie)
 * 2) Master (Base + Cloud + User, persistent auf dem Gerät)
 * 3) Bundle-Base (pronunciations.json) nur als Seed beim ersten Boot
 *
 * App-Boot lädt SOFORT die lokale Master-Datei — kein Netz nötig.
 */
import * as FileSystem from 'expo-file-system';
import pronunciationsJson from '../../assets/data/pronunciations.json';
import { PRONUNCIATION_OVERRIDES } from './pronunciationOverrides';

/** IPA-Zeichen → kein Ortho-Hint für den Fließtext. */
const IPA_HINT_RE =
  /[ˈˌːɪʊəɛɔɑɒæθðʃʒŋɡɟçʁβɸχʏøœʌɒɟɲʎʋɹɾʈɖɤɘɵɨʉɶ]/u;

function isOrthoPronunciation(value: string): boolean {
  const v = value.trim();
  if (!v || IPA_HINT_RE.test(v)) return false;
  return /^[A-Za-zÄÖÜäöüß\s'-]+$/.test(v);
}

export type PronunciationDict = Record<string, string>;

type CacheInvalidator = () => void;
const invalidators = new Set<CacheInvalidator>();

/** Phonetic-Transformer / Ortho-Caches an Dictionary-Updates koppeln. */
export function onDictionaryCacheInvalidate(fn: CacheInvalidator): () => void {
  invalidators.add(fn);
  return () => {
    invalidators.delete(fn);
  };
}

function notifyDictionaryChanged(): void {
  for (const fn of invalidators) {
    try {
      fn();
    } catch (err) {
      console.warn('[dictionaryEngine] Invalidator-Fehler:', err);
    }
  }
}

export type DictionaryLayer = 'base' | 'cloud' | 'user' | 'master';

export type DictionaryLookup = {
  word: string;
  pronunciation: string;
  layer: DictionaryLayer;
};

const DOC = FileSystem.documentDirectory;
/** Kanonische Offline-Master-Datei — wächst mit jedem Sync/Scan. */
export const MASTER_PATH = DOC
  ? `${DOC}pronunciations_master.json`
  : null;
export const USER_PATH = DOC ? `${DOC}user_pronunciations.json` : null;
/** Legacy Cloud-Overlay (wird in Master gemerged, weiter geschrieben). */
export const CLOUD_PATH = DOC ? `${DOC}cloud_pronunciations.json` : null;

let baseCache: Map<string, string> | null = null;
let masterCache: Map<string, string> = new Map();
let cloudCache: Map<string, string> = new Map();
/** Geschützte User-/Scanner-Korrekturen — nie von Cloud überschreiben. */
let userCache: Map<string, string> = new Map();
let combinedCache: Map<string, string> | null = null;
let phraseKeys: string[] = [];
let bootPromise: Promise<void> | null = null;

function normalizeKey(word: string): string {
  return word.normalize('NFKC').toLowerCase().trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchWordCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.charAt(0).toLowerCase() + replacement.slice(1);
}

function recordToMap(record: PronunciationDict): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rawKey, rawVal] of Object.entries(record)) {
    const key = normalizeKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val) continue;
    map.set(key, val);
  }
  return map;
}

function mapToRecord(map: Map<string, string>): PronunciationDict {
  const out: PronunciationDict = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

function rebuildCombined(): void {
  const map = new Map<string, string>();
  // Master = Offline-Wahrheit; harte IPA-Overrides gewinnen darüber;
  // User/Scanner-Korrekturen gewinnen zuletzt.
  for (const [k, v] of masterCache) map.set(k, v);
  for (const [k, v] of Object.entries(PRONUNCIATION_OVERRIDES)) {
    const key = normalizeKey(k);
    const val = String(v ?? '').trim();
    if (key && val) map.set(key, val);
  }
  for (const [k, v] of userCache) map.set(k, v);
  combinedCache = map;
  phraseKeys = [...map.keys()]
    .filter((k) => k.includes(' ') || k.includes('-'))
    .sort((a, b) => b.length - a.length);
}

async function readJsonFile(path: string | null): Promise<PronunciationDict> {
  if (!path) return {};
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PronunciationDict;
  } catch (err) {
    console.warn('[dictionaryEngine] Lesen fehlgeschlagen:', path, err);
    return {};
  }
}

async function writeJsonFile(
  path: string | null,
  record: PronunciationDict,
): Promise<void> {
  if (!path) return;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(record), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/** Schreibt Master unumstößlich auf Disk (Offline-Persistenz). */
export async function persistMasterDictionary(): Promise<void> {
  await writeJsonFile(MASTER_PATH, mapToRecord(masterCache));
}

function ensureBaseCache(): Map<string, string> {
  if (!baseCache) {
    baseCache = recordToMap(pronunciationsJson as PronunciationDict);
  }
  return baseCache;
}

/**
 * Boot: LOKALE Master-Datei SOFORT laden — kein Netzwerk.
 * Fehlt Master → Seed aus Bundle (+ Legacy Cloud/User), dann speichern.
 */
export async function initDictionaryEngine(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    ensureBaseCache();

    const [masterDisk, cloudDisk, userDisk] = await Promise.all([
      readJsonFile(MASTER_PATH),
      readJsonFile(CLOUD_PATH),
      readJsonFile(USER_PATH),
    ]);

    userCache = recordToMap(userDisk);
    cloudCache = recordToMap(cloudDisk);

    const masterKeys = Object.keys(masterDisk);
    if (masterKeys.length > 0) {
      masterCache = recordToMap(masterDisk);
    } else {
      // Erster Boot / leeres Gerät: Bundle → Master, Legacy mergen
      const seeded: PronunciationDict = {
        ...mapToRecord(ensureBaseCache()),
        ...cloudDisk,
        ...userDisk,
      };
      masterCache = recordToMap(seeded);
      await persistMasterDictionary();
      if (__DEV__) {
        console.log(
          `[dictionaryEngine] Master geseedet: ${masterCache.size} Einträge → pronunciations_master.json`,
        );
      }
    }

    // User-Korrekturen immer in Master spiegeln (falls nur User-Datei existierte)
    if (userCache.size > 0) {
      let touched = false;
      for (const [k, v] of userCache) {
        if (masterCache.get(k) !== v) {
          masterCache.set(k, v);
          touched = true;
        }
      }
      if (touched) await persistMasterDictionary();
    }

    rebuildCombined();
    notifyDictionaryChanged();
    if (__DEV__) {
      console.log(
        `[dictionaryEngine] Offline bereit: master=${masterCache.size} user=${userCache.size} combined=${combinedCache?.size ?? 0}`,
      );
    }
  })().catch((err) => {
    bootPromise = null;
    throw err;
  });
  return bootPromise;
}

function ensureCombined(): Map<string, string> {
  if (!combinedCache) rebuildCombined();
  return combinedCache!;
}

/** Kombinierte Map (Master + User) — immer offline. */
export function getCombinedDictionary(): Map<string, string> {
  return ensureCombined();
}

export function getCombinedDictionarySize(): number {
  return ensureCombined().size;
}

export function getMasterDictionarySnapshot(): PronunciationDict {
  return mapToRecord(masterCache);
}

export function getMasterDictionarySize(): number {
  return masterCache.size;
}

/** Lookup mit Schicht-Info. */
export function lookupPronunciation(word: string): DictionaryLookup | null {
  const key = normalizeKey(word);
  if (!key) return null;
  if (userCache.has(key)) {
    return { word: key, pronunciation: userCache.get(key)!, layer: 'user' };
  }
  if (masterCache.has(key)) {
    return {
      word: key,
      pronunciation: masterCache.get(key)!,
      layer: 'master',
    };
  }
  if (cloudCache.has(key)) {
    return { word: key, pronunciation: cloudCache.get(key)!, layer: 'cloud' };
  }
  const base = ensureBaseCache();
  if (base.has(key)) {
    return { word: key, pronunciation: base.get(key)!, layer: 'base' };
  }
  return null;
}

/**
 * Heuristische Orthografie-Regeln für unklare Fremdwörter.
 * Ergebnis ist eine deutsche Schreibweise für eSpeak (kein IPA).
 */
export function applyHeuristicPhonetics(word: string): string | null {
  const w = word.normalize('NFKC').trim();
  if (w.length < 3) return null;
  let s = w;

  s = s.replace(/ph/gi, (m) => (m[0] === 'P' ? 'F' : 'f'));
  s = s.replace(/th/gi, (m) => (m[0] === 'T' ? 'S' : 's'));
  s = s.replace(/ough/gi, 'oh');
  s = s.replace(/ight/gi, 'ait');
  s = s.replace(/tion\b/gi, 'schon');
  s = s.replace(/sion\b/gi, 'schon');
  s = s.replace(/ture\b/gi, 'tschä');
  s = s.replace(/que\b/gi, 'k');
  s = s.replace(/gui/gi, 'gi');
  s = s.replace(/gue\b/gi, 'g');
  s = s.replace(/c(?=[eiy])/gi, (m) => (m === 'C' ? 'S' : 's'));
  s = s.replace(/y\b/gi, 'i');
  s = s.replace(/ee/gi, 'ii');
  s = s.replace(/oo/gi, 'uh');
  s = s.replace(/ay\b/gi, 'eh');
  s = s.replace(/ai/gi, 'eh');
  s = s.replace(/ou/gi, 'au');
  s = s.replace(/sh/gi, 'sch');
  s = s.replace(/ch(?![aeiouäöü])/gi, 'tsch');

  if (normalizeKey(s) === normalizeKey(w)) return null;
  return matchWordCase(w, s);
}

/**
 * Audio-only: ersetzt Wörter per Exact-Word-Boundary (`\bWort\b`).
 * Nur Orthografie-Hints (Buss, Hoff) — IPA kommt später als ⟦…⟧-Marker.
 * Display-Untertitel dürfen diese Funktion nie nutzen.
 */
export function applyDictionaryToAudioText(text: string): string {
  const map = ensureCombined();
  if (!text || map.size === 0) return text;
  let s = text.normalize('NFKC');

  for (const phrase of phraseKeys) {
    const repl = map.get(phrase);
    if (!repl || !isOrthoPronunciation(repl)) continue;
    if (!s.toLowerCase().includes(phrase)) continue;
    const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, 'gi');
    s = s.replace(re, (match) => matchWordCase(match, repl));
  }

  s = s.replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
    const key = normalizeKey(word.replace(/’/g, "'"));
    const hit = map.get(key) ?? map.get(key.replace(/-/g, ''));
    if (!hit || !isOrthoPronunciation(hit)) return word;
    return matchWordCase(word, hit);
  });

  return s;
}

/** Konfliktfreier Merge: bestehende Keys gewinnen, sofern keepExisting=true. */
export function mergeDictionaries(
  target: PronunciationDict,
  incoming: PronunciationDict,
  keepExisting = true,
): { merged: PronunciationDict; added: number; updated: number } {
  const merged: PronunciationDict = { ...target };
  let added = 0;
  let updated = 0;
  for (const [rawKey, rawVal] of Object.entries(incoming)) {
    const key = normalizeKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val) continue;
    if (!(key in merged)) {
      merged[key] = val;
      added++;
    } else if (!keepExisting && merged[key] !== val) {
      merged[key] = val;
      updated++;
    }
  }
  return { merged, added, updated };
}

/**
 * Cloud → Local Safe Merge:
 * - Neue Cloud-Keys → in Master einfügen
 * - User-Korrekturen (userCache) → NIEMALS überschreiben
 * - Bestehende Master-Keys → behalten (add-only)
 * Danach sofort pronunciations_master.json speichern.
 */
export async function applyCloudDictionaryUpdate(
  incoming: PronunciationDict,
): Promise<{ added: number; updated: number; size: number; skippedProtected: number }> {
  await initDictionaryEngine();

  const protectedKeys = new Set(userCache.keys());
  const safeIncoming: PronunciationDict = {};
  let skippedProtected = 0;

  for (const [rawKey, rawVal] of Object.entries(incoming)) {
    const key = normalizeKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val) continue;
    if (protectedKeys.has(key)) {
      skippedProtected++;
      continue;
    }
    safeIncoming[key] = val;
  }

  // Cloud-Overlay: add-only gegen bisheriges Cloud-File
  const cloudCurrent = mapToRecord(cloudCache);
  const cloudMerged = mergeDictionaries(cloudCurrent, safeIncoming, true);
  cloudCache = recordToMap(cloudMerged.merged);
  await writeJsonFile(CLOUD_PATH, cloudMerged.merged);

  // Master: add-only — niemals bestehende (inkl. User) überschreiben
  const masterCurrent = mapToRecord(masterCache);
  const masterMerged = mergeDictionaries(masterCurrent, safeIncoming, true);
  masterCache = recordToMap(masterMerged.merged);
  // User-Overlay erneut auf Master legen (Schutz)
  for (const [k, v] of userCache) masterCache.set(k, v);

  await persistMasterDictionary();
  rebuildCombined();
  notifyDictionaryChanged();

  return {
    added: masterMerged.added,
    updated: 0,
    size: masterCache.size,
    skippedProtected,
  };
}

/**
 * Scanner/User-Korrekturen:
 * 1) User-Overlay (geschützt)
 * 2) Master mergen & SOFORT speichern
 */
export async function upsertUserPronunciations(
  entries: PronunciationDict,
): Promise<{ added: number; size: number }> {
  await initDictionaryEngine();
  const current = mapToRecord(userCache);
  let added = 0;
  for (const [rawKey, rawVal] of Object.entries(entries)) {
    const key = normalizeKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val) continue;
    if (!(key in current)) added++;
    current[key] = val;
    masterCache.set(key, val);
  }
  userCache = recordToMap(current);
  await writeJsonFile(USER_PATH, current);
  await persistMasterDictionary();
  rebuildCombined();
  notifyDictionaryChanged();
  return { added, size: userCache.size };
}

export function getUserPronunciationsSnapshot(): PronunciationDict {
  return mapToRecord(userCache);
}

export function getCloudPronunciationsSnapshot(): PronunciationDict {
  return mapToRecord(cloudCache);
}

/**
 * Neue User-/Scan-Einträge als Suggest-Delta
 * (nicht schon in Bundle-Base und nicht bereits identisch in Cloud).
 */
export function getPendingSuggestEntries(
  alreadyUploaded: Set<string>,
): PronunciationDict {
  const out: PronunciationDict = {};
  const base = ensureBaseCache();
  for (const [k, v] of userCache) {
    if (alreadyUploaded.has(k)) continue;
    const baseVal = base.get(k);
    const cloudVal = cloudCache.get(k);
    if (baseVal === v || cloudVal === v) continue;
    // Neu oder abweichend von Base/Cloud → melden
    out[k] = v;
  }
  return out;
}

/** Ob Key als User-Korrektur geschützt ist. */
export function isProtectedUserKey(word: string): boolean {
  return userCache.has(normalizeKey(word));
}
