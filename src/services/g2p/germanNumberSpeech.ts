/**
 * Zahlen / Uhrzeiten / Ordinalziffern → gesprochene deutsche Wörter (TTS).
 * Rein, ohne React-Native — für Smoke + AudioVoiceService.
 */

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

function underHundred(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return TENS[t]!;
  const one = o === 1 ? 'ein' : ONES[o];
  return `${one}und${TENS[t]}`;
}

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
      rest === 0 ? 'hundert' : `hundert ${underHundred(rest)}`;
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

/** Stundenwort vor „Uhr“ — „ein Uhr“, nicht „eins Uhr“. */
export function clockHourToGermanWords(h: number): string {
  if (!Number.isFinite(h)) return String(h);
  const v = Math.floor(Math.abs(h)) % 24;
  if (v === 0) return 'null';
  if (v === 1) return 'ein';
  return numberToGermanWords(v);
}

/** "08:00 Uhr", "8:00", "01:19", "7:35", "7 Uhr 35" → "sieben Uhr fünfunddreißig" */
export function transformClockTimes(text: string): string {
  let s = text.replace(
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[Uu]hr)?\b/g,
    (_m, hRaw: string, mRaw: string) => {
      const h = clockHourToGermanWords(Number(hRaw));
      const mins = Number(mRaw);
      if (mins === 0) return `${h} Uhr`;
      return `${h} Uhr ${numberToGermanWords(mins)}`;
    },
  );
  // LLM schreibt oft „7 Uhr 35“ statt „7:35“
  s = s.replace(
    /\b([01]?\d|2[0-3])\s*[Uu]hr\s*([0-5]?\d)\b/g,
    (_m, hRaw: string, mRaw: string) => {
      const h = clockHourToGermanWords(Number(hRaw));
      const mins = Number(mRaw);
      if (!Number.isFinite(mins) || mins < 0 || mins > 59) {
        return `${h} Uhr`;
      }
      if (mins === 0) return `${h} Uhr`;
      return `${h} Uhr ${numberToGermanWords(mins)}`;
    },
  );
  return s;
}

/**
 * Spannen mündlich: „13-18 Grad“ / „13–18“ → „13 bis 18“.
 * Vor Bindestrich-Strip, sonst sagt TTS den Strich oder ein Komma.
 * Keine ISO-/Punkt-Daten (die sind schon umgeschrieben).
 */
export function transformNumericRanges(text: string): string {
  let s = text;
  // 15-09-2026 / 2026-09-15 nicht als Spanne lesen
  s = s.replace(
    /\b(\d{1,2})[-–—−](\d{1,2})[-–—−](\d{2,4})\b/g,
    '$1.$2.$3',
  );
  s = s.replace(
    /\b(\d{4})[-–—−](\d{1,2})[-–—−](\d{1,2})\b/g,
    '$1 $2 $3',
  );
  return s.replace(
    /\b(\d{1,4}(?:[.,]\d{1,2})?)\s*[-–—−]\s*(\d{1,4}(?:[.,]\d{1,2})?)\b/g,
    '$1 bis $2',
  );
}

/** "18.08.2026" → "18. August 2026" */
export function transformNumericDotDates(text: string): string {
  const names = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];
  return text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (full, ds, ms, ys) => {
    const d = Number(ds);
    const mo = Number(ms);
    const y = Number(ys);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return full;
    return `${d}. ${names[mo - 1]} ${y}`;
  });
}

/** "1. Mai" → "erster Mai" */
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

/** Stehende Ordinalziffern: "1." / "2." → "erster" / "zweiter" */
export function transformBareOrdinals(text: string): string {
  return text.replace(/\b(\d{1,2})\.(?=\s|$|[\/),;:])/g, (_m, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      return numberToGermanWords(n);
    }
    return ORDINAL_MASC[n] ?? `${numberToGermanWords(n)}ter`;
  });
}
