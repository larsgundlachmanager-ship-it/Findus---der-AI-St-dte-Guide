/**
 * Phonetic Pre-Filter vor eSpeak/Kokoro.
 * - Alle Ziffern → ausgeschriebene deutsche Wörter
 * - Clean-Text: keine Bindestriche, Ellipsen, Sternchen, Sonderzeichen
 * - Uhrzeiten, Ordinal-Daten, Buchstaben-Codes
 * - Audio-only: Englisch-Ortho + Kurzwort-Hints (Hof→Hoff); UI bleibt Original
 * - Scan: pronunciations.json + englishOrthoPronunciations.json vor G2P
 */

import englishOrthoJson from '../../assets/data/englishOrthoPronunciations.json';
import deProblemWordJson from '../../assets/data/deProblemWordPronunciations.json';
import pronunciationsJson from '../../assets/data/pronunciations.json';
import {
  applyDictionaryToAudioText,
  getCombinedDictionary,
  onDictionaryCacheInvalidate,
} from '../tts/dictionaryEngine';
import { applyGermanTtsProsodyRules } from './germanTtsProsodyRules';
import { stripArtificialBreathPauses } from './ttsProsody';

/** IPA-typische Zeichen — Werte damit bleiben IPA-Marker, keine Ortho-Hints. */
const IPA_HINT_RE =
  /[ˈˌːɪʊəɛɔɑɒæθðʃʒŋɡɟçʁβɸχʏøœʌɒɟɲʎʋɹɾʈɖɤɘɵɨʉɶ]/u;

/**
 * True = echter IPA-Eintrag (⟦…⟧).
 * False = deutsche Orthografie-Hilfe für eSpeak (Fairway→Feerwäy, Hof→Hoff).
 */
export function isIpaPronunciation(value: string): boolean {
  return IPA_HINT_RE.test(value);
}

export function isOrthoPronunciation(value: string): boolean {
  const v = value.trim();
  if (!v || isIpaPronunciation(v)) return false;
  return /^[A-Za-zÄÖÜäöüß\s'-]+$/.test(v);
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

const ORDINAL_MASC: Record<number, string> = {
  1: 'erster',
  2: 'zweiter',
  3: 'dritter',
  4: 'vierter',
  5: 'fünfter',
  6: 'sechster',
  7: 'siebter',
  8: 'achter',
  9: 'neunter',
  10: 'zehnter',
  11: 'elfter',
  12: 'zwölfter',
  13: 'dreizehnter',
  14: 'vierzehnter',
  15: 'fünfzehnter',
  16: 'sechzehnter',
  17: 'siebzehnter',
  18: 'achtzehnter',
  19: 'neunzehnter',
  20: 'zwanzigster',
  21: 'einundzwanzigster',
  22: 'zweiundzwanzigster',
  23: 'dreiundzwanzigster',
  24: 'vierundzwanzigster',
  25: 'fünfundzwanzigster',
  26: 'sechsundzwanzigster',
  27: 'siebenundzwanzigster',
  28: 'achtundzwanzigster',
  29: 'neunundzwanzigster',
  30: 'dreißigster',
  31: 'einunddreißigster',
};

const ORDINAL_NEUT: Record<number, string> = {
  1: 'erstes',
  2: 'zweites',
  3: 'drittes',
  4: 'viertes',
  5: 'fünftes',
  6: 'sechstes',
  7: 'siebtes',
  8: 'achtes',
  9: 'neuntes',
  10: 'zehntes',
};

const MONTHS =
  'Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';

const ONES = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
  'dreizehn',
  'vierzehn',
  'fünfzehn',
  'sechzehn',
  'siebzehn',
  'achtzehn',
  'neunzehn',
];

const TENS = [
  '',
  '',
  'zwanzig',
  'dreißig',
  'vierzig',
  'fünfzig',
  'sechzig',
  'siebzig',
  'achtzig',
  'neunzig',
];

const UNIT_MAP: [RegExp, string][] = [
  [/€/g, ' Euro'],
  [/\$/g, ' Dollar'],
  [/\bkm\b/gi, ' Kilometer'],
  [/\bcm\b/gi, ' Zentimeter'],
  [/\bmm\b/gi, ' Millimeter'],
  [/\bkg\b/gi, ' Kilogramm'],
];

/**
 * Zahl → ausgeschriebene deutsche Wörter.
 * Jahre 1100–1999: „achtzehnhundertvierundsiebzig“ (Jahr-Lesart).
 */
export function numberToGermanWords(
  n: number,
  options?: { yearStyle?: boolean },
): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0;
  let v = Math.abs(Math.floor(n));

  if (options?.yearStyle && v >= 1100 && v <= 1999) {
    const century = Math.floor(v / 100);
    const rest = v % 100;
    const head = underHundred(century);
    const body =
      rest === 0 ? 'hundert' : `hundert${underHundred(rest)}`;
    return neg ? `minus ${head}${body}` : `${head}${body}`;
  }

  let out: string;
  if (v < 20) {
    out = ONES[v] ?? String(v);
  } else if (v < 100) {
    out = underHundred(v);
  } else if (v < 1000) {
    const h = Math.floor(v / 100);
    const rest = v % 100;
    const head = h === 1 ? 'einhundert' : `${ONES[h]}hundert`;
    out = rest === 0 ? head : `${head}${underHundred(rest)}`;
  } else if (v < 1_000_000) {
    const th = Math.floor(v / 1000);
    const rest = v % 1000;
    const head =
      th === 1 ? 'eintausend' : `${numberToGermanWords(th)}tausend`;
    out =
      rest === 0
        ? head
        : `${head}${numberToGermanWords(rest)}`;
  } else {
    out = String(v)
      .split('')
      .map((d) => ONES[Number(d)] ?? d)
      .join(' ');
  }

  return neg ? `minus ${out}` : out;
}

function underHundred(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return TENS[t];
  const one = o === 1 ? 'ein' : ONES[o];
  return `${one}und${TENS[t]}`;
}

/** "08:00 Uhr", "8:00", "20:15" → "acht Uhr" / "zwanzig Uhr fünfzehn" */
export function transformClockTimes(text: string): string {
  return text.replace(
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[Uu]hr)?\b/g,
    (_m, hRaw: string, mRaw: string) => {
      const h = numberToGermanWords(Number(hRaw));
      const mins = Number(mRaw);
      if (mins === 0) return `${h} Uhr`;
      return `${h} Uhr ${numberToGermanWords(mins)}`;
    },
  );
}

/** "1. Juni" → "erster Juni" */
export function transformOrdinalDates(text: string): string {
  const re = new RegExp(`\\b([0-3]?\\d)\\.\\s*(${MONTHS})\\b`, 'gi');
  return text.replace(re, (_m, dayRaw: string, month: string) => {
    const day = Number(dayRaw);
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      return `${numberToGermanWords(Number(dayRaw))} ${month}`;
    }
    const ordinal = ORDINAL_MASC[day] ?? `${numberToGermanWords(day)}ter`;
    return `${ordinal} ${month}`;
  });
}

/** Stehende Ordinalziffern: "1." / "2." → "erstes" / "zweites" */
export function transformBareOrdinals(text: string): string {
  return text.replace(/\b(\d{1,2})\.(?=\s|$)/g, (_m, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      return numberToGermanWords(n);
    }
    return ORDINAL_NEUT[n] ?? ORDINAL_MASC[n] ?? `${numberToGermanWords(n)}tes`;
  });
}

/**
 * Buchstaben-Codes: "FDK 61" → "F D K sechs eins"
 * Kurze deutsche Substantive (Hof, Dom, …) NIEMALS buchstabieren.
 */
export function transformLetterCodes(text: string): string {
  return text.replace(
    /\b([A-ZÄÖÜ]{2,6})(?:\s*[-/]?\s*(\d{1,4}))?\b/g,
    (full, letters: string, digits?: string) => {
      const lower = letters.toLowerCase();
      // Hof/Dom/Rat/Tor … — immer Title Case, nie H-O-F
      if (SHORT_GERMAN_NOUNS.has(lower) || SHORT_NOUN_AUDIO[lower]) {
        return toTitleCaseDe(letters);
      }
      if (
        /^(DER|DIE|DAS|UND|MIT|FÜR|FUR|VON|BEI|AUS|EIN|EINE|ALS|AM|IM|ZU|ZUM|ZUR|DEN|DEM|DES|EINEN|EINEM|EINER)$/i.test(
          letters,
        )
      ) {
        return full;
      }
      // 2–3 Buchstaben mit Vokal = Wort, kein Code (HOF, DOM, TOR, RAT)
      if (letters.length <= 3 && /[AEIOUÄÖÜ]/i.test(letters) && !digits) {
        return toTitleCaseDe(letters);
      }
      const spelled = letters.split('').join(' ');
      if (!digits) return spelled;
      const digitWords = digits
        .split('')
        .map((d) => numberToGermanWords(Number(d)))
        .join(' ');
      return `${spelled} ${digitWords}`;
    },
  );
}

/** Kurze Problem-Substantive, die eSpeak sonst buchstabiert. */
const SHORT_GERMAN_NOUNS = new Set([
  'hof',
  'dom',
  'rat',
  'tor',
  'zug',
  'bus',
  'bar',
  'bad',
  'see',
  'ort',
  'weg',
  'berg',
  'turm',
  'park',
  'platz',
  'markt',
  'kai',
  'pier',
  'wall',
  'deich',
]);

/** Audio-only: kurze Nomen + Komposita für eSpeak (UI behält Original). */
const SHORT_NOUN_AUDIO: Record<string, string> = {
  hof: 'Hoff',
  höfe: 'Höffe',
  hoefe: 'Höffe',
  innenhof: 'Innenhoff',
  bahnhof: 'Bahnoff',
  bauernhof: 'Bauernhoff',
  schulhof: 'Schulhoff',
  hinterhof: 'Hinterhoff',
  vorhof: 'Vorhoff',
  gasthof: 'Gasthoff',
  friedhof: 'Friedhoff',
  kirchhof: 'Kirchhoff',
  dom: 'Dohm',
  rat: 'Raht',
  tor: 'Tohr',
  zug: 'Zuug',
  bus: 'Buss',
  busse: 'Busse',
  bar: 'Baar',
  bad: 'Baad',
  see: 'Seh',
  ort: 'Ortt',
  weg: 'Weeg',
  kai: 'Kai',
  pier: 'Piir',
  // Dedizierte JSON-Overrides (Bus/Hof/Bahnhof/…) gewinnen
  ...(deProblemWordJson as Record<string, string>),
};

/** Längste zuerst — Komposita vor Stammwort (Bahnhof vor Hof). */
const DE_PROBLEM_AUDIO_KEYS = Object.keys(SHORT_NOUN_AUDIO).sort(
  (a, b) => b.length - a.length,
);

function toTitleCaseDe(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * ALL-CAPS / gemischte Kurzformen → normale Großschreibung (kein H-O-F).
 */
export function normalizeShortGermanNounCasing(text: string): string {
  return text.replace(/\b[\p{L}]{2,5}\b/gu, (word) => {
    const lower = word.toLowerCase();
    if (!SHORT_GERMAN_NOUNS.has(lower) && !SHORT_NOUN_AUDIO[lower]) {
      return word;
    }
    // Reine Großbuchstaben oder alles klein am Satzanfang → Title Case
    if (word === word.toUpperCase() || word === word.toLowerCase()) {
      return toTitleCaseDe(word);
    }
    return word;
  });
}

/**
 * Audio-only: Bus/Hof/Bahnhof/… mit Wortgrenzen — nie buchstabieren, nie engl. „Bas“.
 * Untertitel bleiben „Bus“ / „Hof“.
 */
export function applyShortNounAudioHints(text: string): string {
  let s = text.normalize('NFKC');
  for (const key of DE_PROBLEM_AUDIO_KEYS) {
    const repl = SHORT_NOUN_AUDIO[key];
    if (!repl) continue;
    const re = new RegExp(`\\b${escapeRe(key)}\\b`, 'gi');
    s = s.replace(re, (match) => matchWordCase(match, repl));
  }
  return s;
}

/** Einheiten und Währungssymbole → Wörter, dann Ziffern expandieren. */
function expandUnitsAndCurrency(text: string): string {
  let s = text;
  // 6,50€ / 10€ / 123m vor Symbol-Strip
  s = s.replace(
    /(\d{1,3}(?:[.,]\d{1,2})?)\s*€/g,
    (_m, raw: string) => `${decimalToWords(raw)} Euro`,
  );
  s = s.replace(
    /(\d+(?:[.,]\d+)?)\s*(km|m|cm|mm|kg|g|t)\b/gi,
    (_m, raw: string, unit: string) => {
      const u =
        unit.toLowerCase() === 'km'
          ? 'Kilometer'
          : unit.toLowerCase() === 'cm'
            ? 'Zentimeter'
            : unit.toLowerCase() === 'mm'
              ? 'Millimeter'
              : unit.toLowerCase() === 'kg'
                ? 'Kilogramm'
                : unit.toLowerCase() === 'g'
                  ? 'Gramm'
                  : unit.toLowerCase() === 't'
                    ? 'Tonnen'
                    : 'Meter';
      return `${decimalToWords(raw)} ${u}`;
    },
  );
  for (const [re, rep] of UNIT_MAP) {
    s = s.replace(re, rep);
  }
  return s;
}

function decimalToWords(raw: string): string {
  const norm = raw.replace(',', '.');
  const n = Number(norm);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n)) return numberToGermanWords(n);
  // 1,5 → eineinhalb wenn .5
  const parts = norm.split('.');
  const whole = Number(parts[0] ?? 0);
  const frac = parts[1] ?? '';
  if (frac === '5' && whole >= 1 && whole <= 20) {
    if (whole === 1) return 'eineinhalb';
    return `${numberToGermanWords(whole)}einhalb`.replace('eins', 'ein');
  }
  return `${numberToGermanWords(whole)} Komma ${frac
    .split('')
    .map((d) => numberToGermanWords(Number(d)))
    .join(' ')}`;
}

/**
 * Alle verbliebenen Ziffern → Wörter (Jahre in Jahr-Lesart).
 */
export function expandAllDigitsToWords(text: string): string {
  // Tausenderpunkte: 8.000 / 50.000
  let s = text.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (raw) => {
    const n = Number(raw.replace(/\./g, ''));
    return Number.isFinite(n) ? numberToGermanWords(n) : raw;
  });

  // Vierstellige Jahreszahlen
  s = s.replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (raw) => {
    const y = Number(raw);
    return numberToGermanWords(y, { yearStyle: y >= 1100 && y <= 1999 });
  });

  // Dezimalzahlen 1,5 / 3.14
  s = s.replace(/\b(\d+)[.,](\d+)\b/g, (_m, a: string, b: string) =>
    decimalToWords(`${a}.${b}`),
  );

  // Restliche Ganzzahlen
  s = s.replace(/\b\d{1,6}\b/g, (raw) => {
    if (raw.length > 1 && raw.startsWith('0')) {
      return raw
        .split('')
        .map((d) => numberToGermanWords(Number(d)))
        .join(' ');
    }
    return numberToGermanWords(Number(raw));
  });

  return s;
}

/**
 * Clean-Text: Bindestriche, Ellipsen, Sternchen, Sonderzeichen weg.
 * Nur Buchstaben, Ziffern (danach expandiert), einfache Satzzeichen.
 * Keine künstlichen Atempausen für Kokoro.
 */
export function sanitizeSpokenText(text: string): string {
  let s = stripArtificialBreathPauses(text);

  // Ellipsen / Mehrfachpunkte bereits in stripArtificialBreathPauses
  // Gedankenstriche bereits → Komma

  // Apostrophe in Kontraktionen: gibt's → gibts
  s = s.replace(/(\p{L})['’`](\p{L})/gu, '$1$2');

  // Sternchen, Aufzählungszeichen, Klammern, Sonstiges
  s = s.replace(/[*#_~^`|\\/<>[\]{}()„“‚‘«»‹›"']+/g, ' ');
  s = s.replace(/[@$%&=+;:]+/g, ' ');

  // Mehrfach-Punktuation → einfach
  s = s.replace(/!{2,}/g, '!');
  s = s.replace(/\?{2,}/g, '?');
  s = s.replace(/,{2,}/g, ',');
  s = s.replace(/\.{2,}/g, '.');
  s = s.replace(/([.!?])\s*([.!?])+/g, '$1');

  // Nur erlaubte Zeichen behalten
  s = s.replace(/[^\p{L}\p{N}\s,.!?]/gu, ' ');

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Einmalige Pipeline für UI/Untertitel: Ziffern→Wörter, Clean-Text.
 * Englische Orthografie-Swaps und Hof→Hoff kommen NICHT hier rein.
 */
export function prepareDisplayText(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  s = transformClockTimes(s);
  s = transformOrdinalDates(s);
  s = transformBareOrdinals(s);
  s = transformLetterCodes(s);
  s = normalizeShortGermanNounCasing(s);
  s = expandUnitsAndCurrency(s);
  s = sanitizeSpokenText(s);
  s = expandAllDigitsToWords(s);
  s = sanitizeSpokenText(s);
  s = expandAllDigitsToWords(s);
  s = normalizeShortGermanNounCasing(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** @deprecated Alias — Display-Pfad (Untertitel). */
export function prepareSpokenText(text: string): string {
  return prepareDisplayText(text);
}

/**
 * Audio-Pfad: Display-Basis + Lexikon-Scan + Pause-Cleanup (wie Sample-WAVs).
 * UI behält prepareDisplayText (Fairway, Hof). Tempo systemweit 1.0.
 * Dictionary-Engine (Base + Cloud + User) ersetzt vor Ortho per `\bWort\b`.
 */
export function prepareAudioText(text: string): string {
  let s = prepareDisplayText(text);
  if (!s) return s;
  // 0) Prosodie: Aufzählungs-Rhythmus, Kontraktionen, LLM-Marker bereinigen
  s = applyGermanTtsProsodyRules(s);
  // 1) Künstliche Atemholen-Marker entfernen (…, ——, …)
  s = stripArtificialBreathPauses(s);
  // 2) Kombiniertes Wörterbuch (Base + Cloud-Updates + Local-Scan)
  s = applyDictionaryToAudioText(s);
  // 3) Englisch/Fremdwörter + Ortho-Hints
  s = applyEnglishOrthoPronunciations(s);
  // 4) Bus/Hof/Bahnhof explizit mit \b (Audio-only)
  s = applyShortNounAudioHints(s);
  // 5) Title-Case für reine HOF/BUS-CAPS-Reste
  s = normalizeShortGermanNounCasing(s);
  // 6) Finale Bus/Hof-Sicherung (nach Title-Case)
  s = applyShortNounAudioHints(s);
  // 7) Pause-Cleanup
  s = stripArtificialBreathPauses(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Vollständiger Pre-Filter vor G2P/Kokoro (Audio).
 */
export function applyPhoneticTransformer(text: string): string {
  return prepareAudioText(text);
}

/**
 * Scannt einen LLM-Satz und liefert Audio- vs. Display-Text.
 * Display = Original-Wörter; Audio = phonetisch korrigiert.
 */
export function splitDisplayAndAudioText(text: string): {
  display: string;
  audio: string;
} {
  return {
    display: prepareDisplayText(text),
    audio: prepareAudioText(text),
  };
}

// --- Ortho Lexicon (Audio-only): englishOrtho + Ortho-Einträge in pronunciations.json

let englishOrthoCache: Map<string, string> | null = null;
let englishOrthoPhrases: string[] = [];

function getEnglishOrthoMap(): Map<string, string> {
  if (englishOrthoCache) return englishOrthoCache;
  const map = new Map<string, string>();

  const ingest = (record: Record<string, string>, orthoOnly: boolean) => {
    for (const [k, v] of Object.entries(record)) {
      const key = k.normalize('NFKC').toLowerCase().trim();
      const val = String(v ?? '').trim();
      if (!key || !val) continue;
      if (orthoOnly && !isOrthoPronunciation(val)) continue;
      // Kurzwort-Hints und Englisch-Ortho gewinnen gegen generische IPA-Reste
      map.set(key, val);
    }
  };

  // Basis: dediziertes Englisch-Ortho-Lexikon
  ingest(englishOrthoJson as Record<string, string>, false);
  // DE Problemwörter (Bus→Buss, Hof→Hoff, Bahnhof→Bahnoff)
  ingest(deProblemWordJson as Record<string, string>, false);
  // Overlay: Ortho-Hints aus pronunciations.json
  ingest(pronunciationsJson as Record<string, string>, true);

  // Dynamische Engine: Cloud-Updates + User-Scan (Ortho-Werte)
  for (const [k, v] of getCombinedDictionary()) {
    if (isOrthoPronunciation(v)) map.set(k, v);
  }

  // Eingebaute Kurzwort-Hints immer zuletzt (gewinnen)
  for (const [k, v] of Object.entries(SHORT_NOUN_AUDIO)) {
    map.set(k.toLowerCase(), v);
  }

  englishOrthoCache = map;
  englishOrthoPhrases = [...map.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  return map;
}

/** Test/Hot-Reload: Lexikon-Cache leeren. */
export function resetOrthoPronunciationCache(): void {
  englishOrthoCache = null;
  englishOrthoPhrases = [];
}

// Cloud-/User-Overlays → Ortho-Cache invalidieren
onDictionaryCacheInvalidate(() => {
  resetOrthoPronunciationCache();
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ersetzt englische/fremde Wörter + Kurzwörter durch deutsche Orthografie für eSpeak.
 * Nur für Audio — Untertitel bleiben unverändert.
 */
export function applyEnglishOrthoPronunciations(text: string): string {
  const map = getEnglishOrthoMap();
  let s = text.normalize('NFKC');

  for (const phrase of englishOrthoPhrases) {
    const repl = map.get(phrase);
    if (!repl || !s.toLowerCase().includes(phrase)) continue;
    const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, 'gi');
    s = s.replace(re, (match) => matchWordCase(match, repl));
  }

  s = s.replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
    const key = word.toLowerCase().replace(/’/g, "'");
    const hit = map.get(key) ?? map.get(key.replace(/-/g, ''));
    if (!hit) return word;
    return matchWordCase(word, hit);
  });

  return s;
}
