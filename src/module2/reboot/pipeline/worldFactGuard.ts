/**
 * Weltwissen (Papst, Trivia, allgemeine Zahlen) = fact_number.
 * Keine Timeline, kein Stadt-Pack-Writeback.
 */

const CITY_POI_RE =
  /\b(michel|alster|elbe|rathaus|kirche|museum|dom|schloss|hafen|stadtpark|aussichtsturm)\b/iu;

const WORLD_FACT_RE =
  /\b(papst|pope|eiffelturm|eiffel|vollmond|mondphase|bundeskanzler|us[-\s]?präsident|us[-\s]?praesident|premier(?:minister)?|oscar|nobelpreis|fifa|champions\s+league)\b/iu;

const AGE_HEIGHT_RE =
  /\b(wie\s+alt\s+ist|wie\s+hoch\s+ist|wie\s+viele\s+(?:einwohner|meter)|wann\s+ist\s+vollmond)\b/iu;

export function isWorldFactUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (CITY_POI_RE.test(t)) return false;
  if (WORLD_FACT_RE.test(t)) return true;
  if (AGE_HEIGHT_RE.test(t) && !/\b(michel|turm|kirche|dom|hier|das\s+da)\b/iu.test(t)) {
    return true;
  }
  return false;
}

export function shouldWriteCityPack(opts: {
  name: string;
  userText?: string;
}): boolean {
  const blob = `${opts.userText ?? ''} ${opts.name ?? ''}`;
  if (isWorldFactUtterance(blob)) return false;
  if (WORLD_FACT_RE.test(opts.name || '')) return false;
  return true;
}
