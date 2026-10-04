/**
 * Temporal SSOT — relatives Deutsch (heute/morgen/übermorgen) + Post-Midnight.
 * 00:00–04:00: „morgen“ = anbrechender Kalendertag (nicht +1 blind).
 */

export type RelativeDayKeyword = 'heute' | 'morgen' | 'uebermorgen';

const POST_MIDNIGHT_START = 0;
const POST_MIDNIGHT_END = 4; // exclusive of 4:00 → [0,4)

export function isPostMidnightWindow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= POST_MIDNIGHT_START && h < POST_MIDNIGHT_END;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Löst relatives Tageswort auf.
 * Post-Midnight: „morgen“ = heute (anbrechender Tag), „übermorgen“ = +1.
 * Tagsüber: „morgen“ = +1, „übermorgen“ = +2.
 */
export function resolveRelativeDay(
  keyword: RelativeDayKeyword,
  now = new Date(),
): Date {
  const base = startOfLocalDay(now);
  const post = isPostMidnightWindow(now);

  if (keyword === 'heute') return base;

  if (keyword === 'morgen') {
    return post ? base : addDays(base, 1);
  }

  // uebermorgen
  return post ? addDays(base, 1) : addDays(base, 2);
}

export function detectRelativeDayKeyword(
  text: string,
): RelativeDayKeyword | null {
  const t = text.replace(/\s+/g, ' ').toLowerCase();
  if (/\bübermorgen|uebermorgen\b/.test(t)) return 'uebermorgen';
  if (/\bmorgen\b/.test(t)) return 'morgen';
  if (/\bheute\b/.test(t)) return 'heute';
  return null;
}

/** ISO date YYYY-MM-DD for relative keyword in text, or null. */
export function resolveRelativeDayIsoFromText(
  text: string,
  now = new Date(),
): string | null {
  const kw = detectRelativeDayKeyword(text);
  if (!kw) return null;
  return ymdLocal(resolveRelativeDay(kw, now));
}

const HOUR_WORDS: Record<string, number> = {
  eins: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwölf: 12,
  zwo: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  null: 0,
  zero: 0,
  fünf: 5,
  fuenf: 5,
  zehn: 10,
  fünfzehn: 15,
  fuenfzehn: 15,
  zwanzig: 20,
  fünfundzwanzig: 25,
  fuenfundzwanzig: 25,
  dreißig: 30,
  dreissig: 30,
  fünfunddreißig: 35,
  fuenfunddreissig: 35,
  fuenfunddreißig: 35,
  vierzig: 40,
  fünfundvierzig: 45,
  fuenfundvierzig: 45,
  fünfzig: 50,
  fuenfzig: 50,
  fünfundfünfzig: 55,
  fuenfundfuenfzig: 55,
};

function parseHourToken(raw: string): number | null {
  const s = raw.toLowerCase().replace('ä', 'ae');
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 0 && n <= 23 ? n : null;
  }
  return HOUR_WORDS[s] ?? null;
}

function parseMinuteToken(raw: string): number | null {
  const s = raw.toLowerCase().replace('ä', 'ae');
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 0 && n <= 59 ? n : null;
  }
  return MINUTE_WORDS[s] ?? null;
}

/**
 * Deutsche Weck-/Uhrzeiten aus Speech/STT.
 * Wichtig: „7 Uhr 30“ / „sieben Uhr dreißig“ / „halb acht“ — nicht nur „7 Uhr“ (= :00).
 */
export function parseGermanClockHm(
  text: string,
): { hour: number; minute: number } | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const hm = t.match(/\b(\d{1,2})[:.,](\d{2})\b/);
  if (hm) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const halb = t.match(
    /\b(?:um|gegen)?\s*halb\s+(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo|\d{1,2})\b/iu,
  );
  if (halb?.[1]) {
    const endH = parseHourToken(halb[1]);
    if (endH != null && endH >= 1 && endH <= 23) {
      const hour = endH === 1 ? 0 : endH - 1;
      return { hour, minute: 30 };
    }
  }

  const hourWord =
    'eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo';
  const minWord =
    'null|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|fünfundzwanzig|fuenfundzwanzig|dreißig|dreissig|fünfunddreißig|fuenfunddreißig|fuenfunddreissig|vierzig|fünfundvierzig|fuenfundvierzig|fünfzig|fuenfzig';

  // „7 Uhr 30“ / „sieben Uhr dreißig“ — Minuten NACH uhr (STT oft so)
  const uhrMin = t.match(
    new RegExp(
      `\\b(?:um|gegen)?\\s*(${hourWord}|\\d{1,2})\\s*uhr\\s+(${minWord}|\\d{1,2})\\b`,
      'iu',
    ),
  );
  if (uhrMin) {
    const hour = parseHourToken(uhrMin[1]!);
    const minute = parseMinuteToken(uhrMin[2]!);
    if (hour != null && minute != null) return { hour, minute };
  }

  const uhrOnly = t.match(
    new RegExp(
      `\\b(?:um|gegen)?\\s*(${hourWord}|\\d{1,2})\\s*uhr\\b`,
      'iu',
    ),
  );
  if (uhrOnly) {
    const hour = parseHourToken(uhrOnly[1]!);
    if (hour != null) return { hour, minute: 0 };
  }

  const umHour = t.match(/\b(?:um|gegen)\s+(\d{1,2})\b(?!\s*(?:min|minute|minuten|sek))/iu);
  if (umHour) {
    const hour = Number(umHour[1]);
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }

  return null;
}

/**
 * Kombiniert relatives Datum + Uhrzeit „HH:MM“ / „um 8“ / „8 Uhr“ / „7 Uhr 30“.
 * Wenn Uhrzeit in der Vergangenheit am Zieltag → bleibt am Zieltag (kein Extra-Roll außer explizit).
 */
export function resolveDateTimeMs(opts: {
  text: string;
  now?: Date;
  defaultHour?: number;
  defaultMinute?: number;
}): number | null {
  const now = opts.now ?? new Date();
  const kw = detectRelativeDayKeyword(opts.text);
  const day = kw ? resolveRelativeDay(kw, now) : startOfLocalDay(now);

  const parsed = parseGermanClockHm(opts.text);
  let hour = opts.defaultHour ?? 8;
  let minute = opts.defaultMinute ?? 0;
  if (parsed) {
    hour = parsed.hour;
    minute = parsed.minute;
  } else if (!kw && !/\bheute|morgen|übermorgen|uebermorgen\b/iu.test(opts.text)) {
    return null;
  }

  const out = new Date(day);
  out.setHours(hour, minute, 0, 0);
  return out.getTime();
}

/** Prompt-Block für Gemini — Post-Midnight Korrektur. */
export function temporalPromptBlock(now = new Date()): string {
  const post = isPostMidnightWindow(now);
  const today = ymdLocal(now);
  const morgen = ymdLocal(resolveRelativeDay('morgen', now));
  const lines = [
    '=== ZEIT / POST-MIDNIGHT ===',
    `Jetzt lokal: ${now.toISOString()} (Tag ${today}).`,
    post
      ? `Nachtfenster 00–04 Uhr aktiv: „morgen“ = anbrechender Tag (${morgen}), NICHT übermorgen.`
      : `„morgen“ = ${morgen}.`,
    'Keine erfundenen Öffnungszeiten — live recherchieren.',
  ];
  return lines.join('\n');
}
