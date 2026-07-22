/**
 * DE-TTS-Normalisierung vor G2P:
 * - Abkürzungen → sprechbare Formen
 * - Prosodie-Satzzeichen → Kokoro-Silence-Tokens (, . — …)
 * - Ziffern → deutsche Zahlwörter (Artikulation, kein Inhalt-Rewrite für LLM-Display)
 *
 * Der sichtbare LLM-Wortlaut bleibt unverändert; hier nur phonetische Vorbereitung.
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDr\./gi, 'Doktor'],
  [/\bProf\./gi, 'Professor'],
  [/\bNr\.?\b/gi, 'Nummer'],
  [/\bca\.?\b/gi, 'zirka'],
  [/\bu\.\s*s\.\s*w\.?\b/gi, 'und so weiter'],
  [/\busw\.?\b/gi, 'und so weiter'],
  [/\bd\.\s*h\.?\b/gi, 'das heißt'],
  [/\bdh\b/gi, 'das heißt'],
  [/\betc\.?\b/gi, 'et cetera'],
  [/\bzzgl\.?\b/gi, 'zuzüglich'],
  [/\bggf\.?\b/gi, 'gegebenenfalls'],
  [/\bbzw\.?\b/gi, 'beziehungsweise'],
  [/\bGmbH\b/g, 'G M B H'],
  [/\bz\.\s*B\.?\b/gi, 'zum Beispiel'],
  [/\bzB\b/gi, 'zum Beispiel'],
  [/\bu\.?\s*a\.?\b/gi, 'unter anderem'],
  [/\bo\.\s*ä\.?\b/gi, 'oder ähnlich'],
  [/\binkl\.?\b/gi, 'inklusive'],
  [/\bexkl\.?\b/gi, 'exklusive'],
  [/\bmax\.?\b/gi, 'maximal'],
  [/\bmin\.?\b/gi, 'minimal'],
];

/** Deutsche Buchstabenbezeichnungen (RB → er be, U → u). */
export const DE_LETTER_NAMES: Record<string, string> = {
  A: 'a',
  B: 'be',
  C: 'ze',
  D: 'de',
  E: 'e',
  F: 'ef',
  G: 'ge',
  H: 'ha',
  I: 'i',
  J: 'jot',
  K: 'ka',
  L: 'el',
  M: 'em',
  N: 'en',
  O: 'o',
  P: 'pe',
  Q: 'ku',
  R: 'er',
  S: 'es',
  T: 'te',
  U: 'u',
  V: 'vau',
  W: 'we',
  X: 'iks',
  Y: 'ypsilon',
  Z: 'zet',
  Ä: 'ä',
  Ö: 'ö',
  Ü: 'ü',
};

const ROMAN_NUMERAL = /^[IVXLCDM]+$/;

const PRONUNCIATION_GUARDS: [RegExp, string][] = [
  [/\bAudio[\s-]?[Gg]uide\b/g, 'Audioguide'],
  [/\bAudio[\s-]?[Gg]uides\b/g, 'Audioguides'],
  [/\bBegleiter\b/gi, 'Begleiter'],
  [/\bBegleiters\b/gi, 'Begleiters'],
  [/\banlegen\b/gi, 'anlegen'],
  [/\bAnlegen\b/g, 'anlegen'],
  [/\bStadtguide\b/gi, 'Stadt, Guide'],
  [/\bStadtgudie\b/gi, 'Stadt, Guide'],
  [/\bStadtführer\b/gi, 'Stadt, Führer'],
  [/\bStadtfuehrer\b/gi, 'Stadt, Führer'],
  [/\bFindus\b/g, 'Findus'],
];

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

export function spellGermanLetters(run: string): string {
  return Array.from(run.toUpperCase(), (ch) => DE_LETTER_NAMES[ch] ?? ch).join(
    ' ',
  );
}

/**
 * Jahreszahlen 1000–2099 im üblichen deutschen Stil:
 * 1911 → neunzehnhundertelf, 2005 → zweitausendfünf, 1011 → tausendelf.
 */
export function germanYearWords(year: number): string {
  if (!Number.isFinite(year) || year < 1000 || year > 2099) {
    return germanNumberWords(year);
  }

  if (year >= 2000) {
    if (year === 2000) return 'zweitausend';
    const rest = year % 100;
    return `zweitausend${germanNumberWords(rest)}`;
  }

  if (year >= 1100) {
    const century = Math.floor(year / 100);
    const rest = year % 100;
    const head = `${germanNumberWords(century)}hundert`;
    return rest === 0 ? head : `${head}${germanNumberWords(rest)}`;
  }

  if (year === 1000) return 'tausend';
  const rest = year % 100;
  return rest === 0 ? 'tausend' : `tausend${germanNumberWords(rest)}`;
}

function isGermanYearNumber(raw: string, n: number): boolean {
  return raw.length === 4 && n >= 1000 && n <= 2099;
}

/** Linien-/Routencodes: RB61 → er be einundsechzig, U1 → u eins. */
export function expandAlphanumericCodes(text: string): string {
  let s = text;
  s = s.replace(
    /\b([A-ZÄÖÜ]{2,})\s*(\d{1,4})\b/g,
    (_, letters: string, digits: string) => {
      const n = Number(digits);
      if (!Number.isFinite(n)) return `${letters} ${digits}`;
      return `${spellGermanLetters(letters)} ${germanNumberWords(n)}`;
    },
  );
  s = s.replace(
    /\b([A-ZÄÖÜ])\s*(\d{1,4})\b/g,
    (_, letter: string, digits: string) => {
      const n = Number(digits);
      if (!Number.isFinite(n)) return `${letter} ${digits}`;
      const spelled = DE_LETTER_NAMES[letter] ?? letter;
      return `${spelled} ${germanNumberWords(n)}`;
    },
  );
  return s;
}

/** Verbleibende Großbuchstaben-Abkürzungen buchstabieren (USA → u es a). */
export function expandGermanInitialisms(text: string): string {
  return text.replace(/\b[A-ZÄÖÜ]{2,}\b/g, (run) => {
    if (ROMAN_NUMERAL.test(run)) return run;
    return spellGermanLetters(run);
  });
}

/** 0–999 → deutsche Zahlworte (für saubere Kokoro-Artikulation). */
export function germanNumberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    if (o === 0) return TENS[t];
    const one = o === 1 ? 'ein' : ONES[o];
    return `${one}und${TENS[t]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const head = h === 1 ? 'einhundert' : `${ONES[h]}hundert`;
    return rest === 0 ? head : `${head}${germanNumberWords(rest)}`;
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const head =
      th === 1 ? 'eintausend' : `${germanNumberWords(th)}tausend`;
    return rest === 0 ? head : `${head}${germanNumberWords(rest)}`;
  }
  // Sehr große Zahlen: ziffernweise (vermeidet Verschlucken)
  return String(Math.floor(n))
    .split('')
    .map((d) => ONES[Number(d)] ?? d)
    .join(' ');
}

/**
 * Satzzeichen → Kokoro-Silence-Tokens.
 * Komma, Punkt, Gedankenstrich, Auslassungspunkte bleiben hörbare Pausen.
 */
export function normalizeProsodyPunctuation(text: string): string {
  let s = text;
  // ASCII-Ellipsen → eine typografische Ellipse
  s = s.replace(/\.{3,}/g, ' … ');
  // Beliebige Ellipse-Läufe (mit Spaces) → max. zwei Silence-Tokens
  s = s.replace(/(?:\u2026\s*)+/g, ' … … ');
  // Gedankenstriche (en/em) → — mit kurzer Luft
  s = s.replace(/\u2013+/g, ' — ');
  s = s.replace(/\u2014+/g, ' — ');
  s = s.replace(/(\D|^)\s+-\s+(\D|$)/g, '$1 — $2');
  // Satzende-Punkte mit Luft (Dezimalzahlen 3.14 bleiben)
  s = s.replace(/(\D)\.(\D|$)/g, '$1 . $2');
  s = s.replace(/^\./g, ' . ');
  s = s.replace(/\.$/g, ' . ');
  s = s.replace(/,/g, ' , ');
  s = s.replace(/!/g, ' ! ');
  s = s.replace(/\?/g, ' ? ');
  s = s.replace(/;/g, ' ; ');
  s = s.replace(/:/g, ' : ');
  // Nochmal glätten (falls Punkt+Ellipse gestapelt)
  s = s.replace(/(?:\u2026\s*){3,}/g, ' … … ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Ziffernfolgen → Zahlworte (Jahre, Alter, Mengen). */
export function expandGermanDigits(text: string): string {
  return text.replace(/\d{1,6}/g, (raw) => {
    // Führende Nullen (z. B. Codes): ziffernweise
    if (raw.length > 1 && raw.startsWith('0')) {
      return raw
        .split('')
        .map((d) => ONES[Number(d)] ?? d)
        .join(' ');
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    if (isGermanYearNumber(raw, n)) return germanYearWords(n);
    return germanNumberWords(n);
  });
}

/**
 * Text-Normalisierung für G2P (Aussprache), nicht für UI-Anzeige.
 */
export function normalizeGermanTtsText(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  // Anführungszeichen vereinheitlichen — Gedankenstriche NICHT zu Komma machen
  s = s.replace(/[«»‹›""„‟]/g, '"');
  for (const [pattern, replacement] of ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }
  s = expandAlphanumericCodes(s);
  s = expandGermanInitialisms(s);
  for (const [pattern, replacement] of PRONUNCIATION_GUARDS) {
    s = s.replace(pattern, replacement);
  }
  s = expandGermanDigits(s);
  s = normalizeProsodyPunctuation(s);
  return s;
}

/**
 * Nach G2P: fehlende Silence-Tokens aus dem Quelltext nachziehen,
 * falls espeak Interpunktion verschluckt hat.
 */
export function ensureSilenceTokens(
  sourceNormalized: string,
  phonemes: string,
): string {
  const strong = (sourceNormalized.match(/[.…!?—]/g) ?? []).length;
  const soft = (sourceNormalized.match(/[,;:]/g) ?? []).length;
  const haveStrong = (phonemes.match(/[.…!?—]/g) ?? []).length;
  const haveSoft = (phonemes.match(/[,;:]/g) ?? []).length;

  if (haveStrong >= strong && haveSoft >= Math.floor(soft * 0.85)) {
    return phonemes;
  }

  // Wortweise: Kern phonemisch (bereits in phonemes), Interpunktion aus Quelle injizieren
  const chunks = sourceNormalized.split(/(\s+)/);
  const punctOnly = chunks
    .filter((c) => /^[,.!?;:…—]+$/.test(c.trim()))
    .map((c) => c.trim());
  if (punctOnly.length === 0) return phonemes;

  let out = phonemes;
  for (const p of punctOnly) {
    const token = p.includes('…')
      ? '…'
      : p.includes('—')
        ? '—'
        : p[0];
    if (!out.includes(token)) {
      out = `${out} ${token}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}
