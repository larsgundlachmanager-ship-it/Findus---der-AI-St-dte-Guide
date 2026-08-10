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

/**
 * Kombiniert relatives Datum + Uhrzeit „HH:MM“ / „um 8“ / „8 Uhr“.
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

  const hm =
    opts.text.match(/\b(?:um\s*)?(\d{1,2})(?::(\d{2}))?\s*uhr\b/iu) ||
    opts.text.match(/\b(\d{1,2}):(\d{2})\b/);

  let hour = opts.defaultHour ?? 8;
  let minute = opts.defaultMinute ?? 0;
  if (hm) {
    hour = Math.min(23, Math.max(0, parseInt(hm[1], 10)));
    minute = hm[2] ? Math.min(59, parseInt(hm[2], 10)) : 0;
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
