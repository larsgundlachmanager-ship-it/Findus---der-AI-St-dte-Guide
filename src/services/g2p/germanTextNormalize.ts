/**
 * DE-TTS-Normalisierung vor G2P:
 * - Phonetic Pre-Filter (Ziffern→Wörter, Clean-Text, Uhrzeiten, Ordinal-Daten)
 * - Abkürzungen → sprechbare Formen
 * - Prosodie nur über einfache Satzzeichen (, . ! ?)
 */

import {
  applyPhoneticTransformer,
  numberToGermanWords,
} from './phoneticTransformer';
import { applyTtsProsodyPolish } from './ttsProsody';

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDr\./gi, 'Doktor'],
  [/\bProf\./gi, 'Professor'],
  [/\bNr\./gi, 'Nummer'],
  [/\bca\./gi, 'zirka'],
  [/\bd\.\s*h\./gi, 'das heißt'],
  [/\busw\./gi, 'und so weiter'],
  [/\betc\./gi, 'et cetera'],
  [/\bzzgl\./gi, 'zuzüglich'],
  [/\bggf\./gi, 'gegebenenfalls'],
  [/\bGmbH\b/g, 'GmbH'],
  [/\bz\.\s*B\./gi, 'zum Beispiel'],
  [/\bzB\b/g, 'zum Beispiel'],
];

const PRONUNCIATION_GUARDS: [RegExp, string][] = [
  [/\bAudio[\s-]?[Gg]uide\b/g, 'Audioguide'],
  [/\bAudio[\s-]?[Gg]uides\b/g, 'Audioguides'],
  [/\bBegleiter\b/gi, 'Begleiter'],
  [/\bBegleiters\b/gi, 'Begleiters'],
  [/\banlegen\b/gi, 'anlegen'],
  [/\bAnlegen\b/g, 'anlegen'],
];

/** @deprecated Nutze numberToGermanWords aus phoneticTransformer. */
export function germanNumberWords(n: number): string {
  return numberToGermanWords(n);
}

/** Einzelbuchstaben für Initialismen (F D K). */
export function spellGermanLetters(run: string): string {
  return run
    .split('')
    .filter((c) => /\p{L}/u.test(c))
    .join(' ');
}

/**
 * Satzzeichen → natürliche, kurze Prosodie für TTS (wie Hörproben).
 * Keine Ellipsen, keine Gedankenstriche, kein Silence-Stacking um jedes Zeichen.
 */
export function normalizeProsodyPunctuation(text: string): string {
  let s = text;
  s = s.replace(/\u2026+/g, ',');
  s = s.replace(/\.{2,}/g, '.');
  s = s.replace(/[\u2010-\u2015―─–—−-]+/g, ',');
  // Komma: kurze Pause, am Wort klebend
  s = s.replace(/\s*,\s*/g, ', ');
  // Satzende: ein Leerzeichen danach — kein „ . “-Insel-Token
  s = s.replace(/\s+([.!?])/g, '$1');
  s = s.replace(/([.!?])(?=\p{L})/gu, '$1 ');
  s = s.replace(/([.!?])\s+/g, '$1 ');
  s = s.replace(/(\s*,\s*){2,}/g, ', ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Verbliebene Ziffern → Zahlworte (Fallback). */
export function expandGermanDigits(text: string): string {
  return text.replace(/\d{1,6}/g, (raw) => {
    if (raw.length > 1 && raw.startsWith('0')) {
      return raw
        .split('')
        .map((d) => numberToGermanWords(Number(d)))
        .join(' ');
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    const yearStyle = n >= 1100 && n <= 1999 && raw.length === 4;
    return numberToGermanWords(n, { yearStyle });
  });
}

/**
 * Text-Normalisierung für G2P (Audio). Display nutzt prepareDisplayText separat.
 */
export function normalizeGermanTtsText(text: string): string {
  let s = applyPhoneticTransformer(text);
  if (!s) return s;
  for (const [pattern, replacement] of ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PRONUNCIATION_GUARDS) {
    s = s.replace(pattern, replacement);
  }
  // Sicherheitsnetz falls doch noch Ziffern
  s = expandGermanDigits(s);
  s = applyTtsProsodyPolish(s);
  s = normalizeProsodyPunctuation(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Nach G2P: fehlende Silence-Tokens aus dem Quelltext nachziehen.
 */
export function ensureSilenceTokens(
  sourceNormalized: string,
  phonemes: string,
): string {
  const strong = (sourceNormalized.match(/[.!?]/g) ?? []).length;
  const soft = (sourceNormalized.match(/[,]/g) ?? []).length;
  const haveStrong = (phonemes.match(/[.!?]/g) ?? []).length;
  const haveSoft = (phonemes.match(/[,]/g) ?? []).length;

  if (haveStrong >= strong && haveSoft >= Math.floor(soft * 0.5)) {
    return phonemes;
  }

  const chunks = sourceNormalized.split(/(\s+)/);
  const punctOnly = chunks
    .filter((c) => /^[,.!?]+$/.test(c.trim()))
    .map((c) => c.trim());
  if (punctOnly.length === 0) return phonemes;

  let out = phonemes;
  for (const p of punctOnly) {
    const token = p[0];
    if (token && !out.includes(token)) {
      out = `${out} ${token}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}
