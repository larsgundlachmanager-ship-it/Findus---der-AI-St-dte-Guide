/**
 * Römische Zahlen → deutsche Aussprache für TTS (Regentennamen).
 * Display behält XIV.; Audio: „Leo der Vierzehnte“.
 */

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

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
  32: 'zweiunddreißigster',
  33: 'dreiunddreißigster',
  34: 'vierunddreißigster',
  35: 'fünfunddreißigster',
  36: 'sechsunddreißigster',
  37: 'siebenunddreißigster',
  38: 'achtunddreißigster',
  39: 'neununddreißigster',
  40: 'vierzigster',
};

const ROMAN_FEM_ARTICLE_RE =
  /^(königin|queen|kaiserin|herzogin|elisabeth|elizabeth|victoria|maria|marie|katharina|catharina|anna|anne|sofia|sophia)$/iu;

/** Römische Zahl → Integer (1–3999) oder null. */
export function parseRomanNumeral(raw: string): number | null {
  const s = (raw || '').trim().toUpperCase();
  if (!s || !/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN_VALUES[s[i]!] ?? 0;
    const next = ROMAN_VALUES[s[i + 1]!] ?? 0;
    if (cur < next) total -= cur;
    else total += cur;
  }
  if (total < 1 || total > 3999) return null;
  return total;
}

/** „Vierzehnte“ — absolute Ordinalform für Regentennamen. */
export function germanOrdinalAbsolute(n: number): string {
  const attr = ORDINAL_MASC[n];
  if (!attr) return `${n}.`;
  const abs = attr
    .replace(/ster$/u, 'ste')
    .replace(/ter$/u, 'te')
    .replace(/er$/u, 'e');
  return abs.charAt(0).toUpperCase() + abs.slice(1);
}

/**
 * Römische Regentenzahlen für TTS:
 * „Leo XIV.“ → „Leo der Vierzehnte“.
 */
export function expandRomanNumeralsForSpeech(text: string): string {
  if (!text || !/[IVXLCDM]/i.test(text)) return text;
  return text.replace(
    /\b([A-ZÄÖÜ][\p{L}'’\-]{1,40})\s+([IVXLCDM]{1,8})\.?(?=(?:\s|[.,!?;:]|$))/gu,
    (full, name: string, roman: string) => {
      const n = parseRomanNumeral(roman);
      if (n == null || n < 1 || n > 40) return full;
      if (
        /^(Der|Die|Das|Den|Dem|Des|Ein|Eine|Einer|Eines|Und|Oder|Von|Zum|Zur|Am|Im|Bei|Mit|Als|Wie|Ist|War|Sind)$/u.test(
          name,
        )
      ) {
        return full;
      }
      if (name === name.toUpperCase() && name.length <= 4) return full;
      const article = ROMAN_FEM_ARTICLE_RE.test(name) ? 'die' : 'der';
      return `${name} ${article} ${germanOrdinalAbsolute(n)}`;
    },
  );
}
