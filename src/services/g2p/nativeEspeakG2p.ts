/**
 * Natives espeak-ng G2P (de / de-DE) → Kokoro-IPA.
 *
 * Primär: JNI C++ (findus-espeak). Fallback: JS-Regelwerk (nur wenn Native fehlt).
 */

import { Platform } from 'react-native';
import { filterPhonemesToVocab } from '../../constants/kokoroVocab';
import type { GermanG2PProvider } from './types';
import { normalizeGermanTtsText } from './germanTextNormalize';
import { phonemizeGermanIpa } from './de/germanIpaG2p';

const VOICE_DE = 'de';

/** Englische IPA-Zeichen, die bei de-Voice nicht vorkommen dürfen */
const ENGLISH_ONLY = /[θðæɹɾ]/u;

let nativeReady = false;
let nativeTried = false;
let nativeModule: typeof import('findus-espeak') | null = null;

async function loadNative(): Promise<typeof import('findus-espeak') | null> {
  if (nativeTried) return nativeModule;
  nativeTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('findus-espeak');
    return nativeModule;
  } catch (e) {
    console.warn('[g2p/espeak-native] Modul nicht ladbar:', e);
    nativeModule = null;
    return null;
  }
}

/**
 * Extrahiert/zeigt auf espeak-ng-data und initialisiert JNI.
 */
export async function warmupNativeEspeakG2P(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    console.warn('[g2p/espeak-native] Nur Android — Fallback JS-G2P');
    return false;
  }

  const mod = await loadNative();
  if (!mod?.isNativeEspeakAvailable()) {
    console.warn('[g2p/espeak-native] Native Bridge fehlt — Dev Client neu bauen');
    return false;
  }

  if (mod.nativeEspeakIsReady()) {
    nativeReady = true;
    return true;
  }

  // "assets" → Modul kopiert aus APK-Assets nach filesDir
  const ok = await mod.nativeEspeakInitialize('assets', VOICE_DE);
  nativeReady = ok;
  if (ok) {
    console.log('[g2p/espeak-native] espeak-ng bereit (voice=de)');
  } else {
    console.warn('[g2p/espeak-native] initialize() fehlgeschlagen');
  }
  return ok;
}

/**
 * Post-Processing: espeak IPA → Kokoro-Vocab (ʏ→y, Stress behalten, Filter).
 * Wichtig: IPA ɡ (\u0261) NICHT nach ASCII g mappen — g fehlt im Vocab und
 * wird sonst verworfen (Begleiter→Beleiter, anlegen→anleen).
 */
export function mapEspeakIpaToKokoro(ipa: string): string {
  let s = ipa.normalize('NFC');

  s = s.replace(/\u028f/g, 'y'); // ʏ → y
  s = s.replace(/\u0265/g, 'y'); // ɥ rare → y
  s = s.replace(/\u03c7/g, 'x'); // χ → x (ach-Laut oft als x im Vocab)
  // ASCII g → IPA ɡ (Vocab-ID 92); IPA ɡ unverändert lassen
  s = s.replace(/g/g, '\u0261');
  s = s.replace(/\u027e/g, 'r'); // ɾ (engl.) → r falls doch
  s = s.replace(/\u0279/g, 'ʁ'); // ɹ → ʁ für DE-Kontext
  s = s.replace(/\u00f0/g, 'd'); // ð
  s = s.replace(/\u03b8/g, 't'); // θ → t (sollte bei de nicht vorkommen)
  s = s.replace(/\u00e6/g, 'ɛ'); // æ → ɛ
  s = s.replace(/\u025c/g, 'ə'); // ɜ → ə (DE-Schwa)
  s = s.replace(/\u025a/g, 'ə'); // ɚ → ə

  s = s.replace(/\u2026+/g, ','); // … → kurze Komma-Pause, kein langer Silence
  s = s.replace(/\.{3,}/g, ',');
  s = s.replace(/\u2013/g, ','); // – → ,
  s = s.replace(/\u2014/g, ','); // — → ,

  // Mehrfach-Spaces → einzelnes Space
  s = s.replace(/\s+/g, ' ').trim();

  return filterPhonemesToVocab(s);
}

export function assertNoEnglishPhonemes(ipa: string, label = 'ipa'): void {
  if (ENGLISH_ONLY.test(ipa)) {
    const hits = ipa.match(ENGLISH_ONLY) ?? [];
    console.warn(
      `[g2p/espeak-native] WARN ${label}: englische IPA-Zeichen ${[...new Set(hits)].join(',')}`,
    );
  }
}

export async function phonemizeGermanNativeEspeak(
  text: string,
): Promise<string> {
  const normalized = normalizeGermanTtsText(text);

  if (!nativeReady) {
    await warmupNativeEspeakG2P();
  }

  const mod = await loadNative();
  if (nativeReady && mod) {
    const raw = await mod.nativeEspeakTextToPhonemes(normalized, VOICE_DE);
    assertNoEnglishPhonemes(raw, 'espeak-raw');
    const mapped = mapEspeakIpaToKokoro(raw);
    assertNoEnglishPhonemes(mapped, 'kokoro-mapped');
    if (__DEV__) {
      console.log(
        `[g2p/espeak-native] de IPA (${mapped.length}): ${mapped.slice(0, 140)}`,
      );
    }
    return mapped;
  }

  // Fallback (Emulator ohne Native / iOS)
  console.warn('[g2p/espeak-native] Fallback → JS germanIpaG2P');
  return phonemizeGermanIpa(normalized);
}

export const nativeEspeakGermanG2P: GermanG2PProvider = {
  id: 'espeak-ng-native-de',
  productionReady: true,
  phonemize(text: string): string {
    // Sync-API: nur JS-Fallback (Native ist async)
    return phonemizeGermanIpa(normalizeGermanTtsText(text));
  },
};

/** Für Tests ohne Device: erwartet deutsche IPA-Merkmale. */
export function validateGermanIpaSample(ipa: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!ipa || ipa.length < 4) reasons.push('leer/zu kurz');
  if (ENGLISH_ONLY.test(ipa)) reasons.push('englische Phoneme');
  if (/\boe\b|\bue\b|oe|ue/.test(ipa) && !/[øœy]/.test(ipa)) {
    reasons.push('ASCII-Umlaut-Digraphen statt IPA');
  }
  // Willkommen / Findus typische DE-Laute
  if (!/[ɪəʁʃçɔʊ]/.test(ipa) && !/[aɪaʊ]/.test(ipa)) {
    reasons.push('keine typischen DE-IPA-Zeichen');
  }
  return { ok: reasons.length === 0, reasons };
}
