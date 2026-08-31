/**
 * Stichpunkte: Ziffern und kompakte Daten.
 * Speech darf Zahlen ausschreiben — UI nicht.
 */

const ONES: Record<string, number> = {
  null: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  einem: 1,
  einen: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  fuenfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
};

const TENS: Record<string, number> = {
  zwanzig: 20,
  dreißig: 30,
  dreissig: 30,
  vierzig: 40,
  fünfzig: 50,
  fuenfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};

const MONTHS =
  'Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
}

/** „siebenundzwanzig“ / „erster“ → Zahl. */
export function germanWordToNumber(raw: string): number | null {
  let w = fold(raw).replace(/[^a-z]/g, '');
  if (!w) return null;
  w = w.replace(/(sten|ster|stes|stem|ste|ten|ter|tes|te)$/u, '');
  if (ONES[w] != null) return ONES[w]!;
  if (TENS[w] != null) return TENS[w]!;
  const und = w.match(/^(.+)und(.+)$/u);
  if (und) {
    const ones = ONES[und[1]!] ?? (und[1] === 'ein' ? 1 : null);
    const tens = TENS[und[2]!];
    if (ones != null && tens != null) return tens + ones;
  }
  const hundert = w.match(/^(.*)hundert(.*)$/u);
  if (hundert) {
    const head = hundert[1]
      ? germanWordToNumber(hundert[1])
      : 1;
    const rest = hundert[2] ? germanWordToNumber(hundert[2]) : 0;
    if (head != null && rest != null) return head * 100 + rest;
  }
  const tausend = w.match(/^(.*)tausend(.*)$/u);
  if (tausend) {
    const head = tausend[1] ? germanWordToNumber(tausend[1]) : 1;
    const rest = tausend[2] ? germanWordToNumber(tausend[2]) : 0;
    if (head != null && rest != null) return head * 1000 + rest;
  }
  return null;
}

function replaceWordYears(s: string): string {
  return s.replace(
    /\b((?:achtzehn|neunzehn|zwanzig)hundert(?:[a-zäöüß]+)?|zweitausend(?:[a-zäöüß]+)?)\b/giu,
    (m) => {
      const n = germanWordToNumber(m);
      return n != null && n >= 1100 && n <= 2100 ? String(n) : m;
    },
  );
}

function replaceOrdinalDates(s: string): string {
  const re = new RegExp(
    `\\b((?:[A-Za-zÄÖÜäöüß]+))\\s+(${MONTHS})\\b`,
    'giu',
  );
  return s.replace(re, (full, dayWord: string, month: string) => {
    const n = germanWordToNumber(dayWord);
    if (n == null || n < 1 || n > 31) return full;
    return `${n}. ${month}`;
  });
}

function replaceAges(s: string): string {
  return s.replace(
    /\b([A-Za-zÄÖÜäöüß]+)\s+Jahre(?:n)?(?:\s+alt)?\b/giu,
    (full, word: string) => {
      const n = germanWordToNumber(word);
      if (n == null || n < 1 || n > 130) return full;
      return `${n} Jahre`;
    },
  );
}

function replaceSimpleCounts(s: string): string {
  return s.replace(
    /\b([A-Za-zÄÖÜäöüß]{3,40})\s+(Euro|€|Meter|m|Stufen|Minuten|Min)\b/giu,
    (full, word: string, unit: string) => {
      const n = germanWordToNumber(word);
      if (n == null || n > 10000) return full;
      return `${n} ${unit}`;
    },
  );
}

/** Speech/LLM-Wörter → kompakte Ziffern für die Karte. */
export function compactBulletDigits(text: string): string {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  s = replaceWordYears(s);
  s = replaceOrdinalDates(s);
  s = replaceAges(s);
  s = replaceSimpleCounts(s);
  return s.replace(/\s+/g, ' ').trim();
}

function clockKey(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

export function bulletClockKey(text: string): string | null {
  return clockKey(text);
}

/** Digit im Stichpunkt gilt, wenn Speech die Ziffer oder das Zahlwort hat. */
export function speechHasBulletDigit(speech: string, digit: string): boolean {
  if (!digit) return true;
  if (speech.includes(digit)) return true;
  return compactBulletDigits(speech).includes(digit);
}

export function ageFromBirthYear(
  year: number,
  now = new Date(),
  monthIdx?: number,
  day?: number,
): number | null {
  if (!Number.isFinite(year) || year < 1800 || year > now.getFullYear()) {
    return null;
  }
  let age = now.getFullYear() - year;
  if (monthIdx != null && day != null) {
    const hadBirthday =
      now.getMonth() > monthIdx ||
      (now.getMonth() === monthIdx && now.getDate() >= day);
    if (!hadBirthday) age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}
