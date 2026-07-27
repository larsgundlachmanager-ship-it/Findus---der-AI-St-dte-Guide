/**
 * Multilinguale EU-Phonetik-Engine (< 1 ms Lookup).
 *
 * Säule 1: europeanBasePhonetics.json (Bundle, ≥5.000 Einträge)
 * Säule 2: user_custom_phonetics (SQLite, POI-Scanner)
 * Säule 3: transformMultilingualTerms() vor Piper TTS
 */
import europeanBaseJson from '../../assets/phonetics/europeanBasePhonetics.json';
import { getDatabase } from '../../db/database';
import { loadAllUserCustomPhonetics } from '../../db/userCustomPhonetics';

export type PhoneticDict = Record<string, string>;

const IPA_HINT_RE =
  /[ˈˌːɪʊəɛɔɑɒæθðʃʒŋɡɟçʁβɸχʏøœʌɒɟɲʎʋɹɾʈɖɤɘɵɨʉɶ]/u;

let baseCache: Map<string, string> | null = null;
let userCache: Map<string, string> = new Map();
let combinedCache: Map<string, string> | null = null;
let phraseKeys: string[] = [];
let bootPromise: Promise<void> | null = null;

type Invalidator = () => void;
const invalidators = new Set<Invalidator>();

export function onPhoneticCacheInvalidate(fn: Invalidator): () => void {
  invalidators.add(fn);
  return () => invalidators.delete(fn);
}

function notifyChanged(): void {
  for (const fn of invalidators) {
    try {
      fn();
    } catch (err) {
      console.warn('[multilingualPhoneticEngine] Invalidator:', err);
    }
  }
}

export function normalizePhoneticKey(word: string): string {
  return word.normalize('NFKC').toLowerCase().trim();
}

function isOrthoPronunciation(value: string): boolean {
  const v = value.trim();
  if (!v || IPA_HINT_RE.test(v)) return false;
  return /^[A-Za-zÄÖÜäöüß\s'.-]+$/.test(v);
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

function recordToMap(record: PhoneticDict): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rawKey, rawVal] of Object.entries(record)) {
    const key = normalizePhoneticKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val || !isOrthoPronunciation(val)) continue;
    map.set(key, val);
  }
  return map;
}

function ensureBaseCache(): Map<string, string> {
  if (!baseCache) {
    baseCache = recordToMap(europeanBaseJson as PhoneticDict);
  }
  return baseCache;
}

function rebuildCombined(): void {
  const map = new Map<string, string>();
  for (const [k, v] of ensureBaseCache()) map.set(k, v);
  for (const [k, v] of userCache) map.set(k, v);
  combinedCache = map;
  phraseKeys = [...map.keys()]
    .filter((k) => k.includes(' ') || k.includes('-'))
    .sort((a, b) => b.length - a.length);
}

function ensureCombined(): Map<string, string> {
  if (!combinedCache) rebuildCombined();
  return combinedCache!;
}

/** Boot: Basis-Bundle + SQLite user_custom_phonetics → RAM-Map. */
export async function initMultilingualPhoneticEngine(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    ensureBaseCache();
    try {
      const db = await getDatabase();
      const custom = await loadAllUserCustomPhonetics(db);
      userCache = recordToMap(custom);
    } catch (err) {
      console.warn('[multilingualPhoneticEngine] SQLite-Laden:', err);
      userCache = new Map();
    }
    rebuildCombined();
    if (__DEV__) {
      console.log(
        `[multilingualPhoneticEngine] bereit: base=${ensureBaseCache().size} user=${userCache.size} combined=${combinedCache?.size ?? 0}`,
      );
    }
  })().catch((err) => {
    bootPromise = null;
    throw err;
  });
  return bootPromise;
}

/** Nach POI-Scan: User-Cache neu laden. */
export async function reloadUserCustomPhonetics(): Promise<void> {
  const db = await getDatabase();
  const custom = await loadAllUserCustomPhonetics(db);
  userCache = recordToMap(custom);
  rebuildCombined();
  notifyChanged();
}

/** Merge neue Einträge in RAM (nach Scan, vor Disk-Commit). */
export function mergeRuntimePhonetics(entries: PhoneticDict): number {
  let n = 0;
  for (const [rawKey, rawVal] of Object.entries(entries)) {
    const key = normalizePhoneticKey(rawKey);
    const val = String(rawVal ?? '').trim();
    if (!key || !val || !isOrthoPronunciation(val)) continue;
    userCache.set(key, val);
    n += 1;
  }
  if (n > 0) rebuildCombined();
  return n;
}

export function getCombinedPhoneticMap(): Map<string, string> {
  return ensureCombined();
}

export function getCombinedPhoneticSize(): number {
  return ensureCombined().size;
}

export function lookupMultilingualPhonetic(word: string): string | null {
  const key = normalizePhoneticKey(word);
  if (!key) return null;
  return ensureCombined().get(key) ?? null;
}

/**
 * Audio-only (Stufe A, kurz vor Piper): EU-/Fremdwort-Ortho.
 * Nie auf Untertitel anwenden — Display bleibt Originalschreibweise.
 * Phrasen zuerst (längste Keys), dann Einzelwörter — Wortgrenzen-respektierend.
 */
export function transformMultilingualTerms(text: string): string {
  const map = ensureCombined();
  if (!text || map.size === 0) return text;

  let s = text.normalize('NFKC');

  for (const phrase of phraseKeys) {
    const repl = map.get(phrase);
    if (!repl) continue;
    if (!s.toLowerCase().includes(phrase)) continue;
    const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, 'gi');
    s = s.replace(re, (match) => matchWordCase(match, repl));
  }

  s = s.replace(/[\p{L}][\p{L}'\u2019-]*/gu, (word) => {
    const key = normalizePhoneticKey(word.replace(/\u2019/g, "'"));
    const hit = map.get(key) ?? map.get(key.replace(/-/g, ' '));
    if (!hit) return word;
    return matchWordCase(word, hit);
  });

  return s;
}

/** Sync-Init für Hot-Path (AudioVoiceService). */
export function ensurePhoneticEngineSync(): void {
  if (!combinedCache) {
    ensureBaseCache();
    rebuildCombined();
    void initMultilingualPhoneticEngine();
  }
}
