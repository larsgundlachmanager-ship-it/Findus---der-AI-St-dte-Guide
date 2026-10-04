/**
 * Weltwissen (Papst, Trivia, allgemeine Zahlen) = fact_number.
 * Keine Timeline, kein Stadt-Pack-Writeback.
 */

const CITY_POI_RE =
  /\b(michel|alster|elbe|rathaus|kirche|museum|dom|schloss|hafen|stadtpark|aussichtsturm)\b/iu;

const WORLD_FACT_RE =
  /\b(papst|pope|eiffelturm|eiffel|central\s*park|vollmond|mondphase|bundeskanzler|us[-\s]?präsident|us[-\s]?praesident|premier(?:minister)?|oscar|nobelpreis|fifa|champions\s+league|wie\s+lang(?:e)?\s+ist\s+die\s+elbe)\b/iu;

const AGE_HEIGHT_RE =
  /\b(wie\s+alt\s+ist|wie\s+hoch\s+ist|wie\s+lang(?:e)?\s+ist|wie\s+viele\s+(?:einwohner|meter|bäume|baeume|bäume)|wann\s+ist\s+vollmond)\b/iu;

export function isWorldFactUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // „Wie hoch ist der Michel?“ = Trivia/Zahl — nicht als Nearby-Sight-Pitch lesen.
  if (AGE_HEIGHT_RE.test(t)) return true;
  if (CITY_POI_RE.test(t)) return false;
  if (WORLD_FACT_RE.test(t)) return true;
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
