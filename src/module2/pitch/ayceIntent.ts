/**
 * All-you-can-eat Erkennung inkl. STT-Aliens („Ken Eat“, „Oyukin“, „Eurokinit“…).
 * Rein — kein RN.
 */

/** STT-Varianten von „you“ in „all you can eat“. */
const AYCE_YOU_ALT = 'you|xou|jou|ju|yo|u|iu|jau|yoo|yu';

/**
 * STT zerlegt „all you can eat“ oft zu Ken/Oyukin/Eurokinit/Kidney/Euken + Eat.
 * Vor Downstream-Regex kanonisieren.
 */
const AYCE_STT_ALIEN_RE =
  /\b(?:euer\s+)?(?:ken|oyukin|oyuken|ojukin|euken|eukin|euerken|eurokinit|eurokinet|kidney|okin|okinat|allikin|allekin|ayucin|allucan|allecan|oilcan)\s*[\s-]*eat\b|\b(?:eukeneat|allucaneat|allecaneat)\b/giu;

const AYCE_PHRASE_RE = new RegExp(
  `\\ball[\\s-]*(?:${AYCE_YOU_ALT})[\\s-]*can[\\s-]*eat\\b|\\ballyoucaneat\\b|\\bayce\\b|\\bunbegrenzt\\s+essen\\b|\\bschlemmer[\\s-]*buffet\\b|\\bunlimited\\s+buffet\\b|\\brodiz(?:io)?\\b`,
  'i',
);

/** Kanonisiert STT-AYCE zu „all you can eat“ für Downstream-Regex. */
export function normalizeAyceStt(text: string): string {
  let t = (text || '').replace(AYCE_STT_ALIEN_RE, 'all you can eat');
  t = t.replace(
    new RegExp(`\\ball[\\s-]*(?:${AYCE_YOU_ALT})[\\s-]*can[\\s-]*eat\\b`, 'gi'),
    'all you can eat',
  );
  return t;
}

export function looksLikeAyceQuery(text: string): boolean {
  const t = normalizeAyceStt(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (AYCE_PHRASE_RE.test(t)) return true;
  if (/\bbuffet\b/i.test(t) && /\b(all|unbegrenzt|flatrate)\b/i.test(t)) return true;
  // Roh-Aliens falls normalize nicht greift
  if (
    /\b(?:ken|oyukin|oyuken|ojukin|euken|eukin|euerken|eurokinit|eurokinet|kidney|allucan|allecan|oilcan)\s*[\s-]*eat\b|\b(?:eukeneat|allucaneat|allecaneat)\b/i.test(
      text || '',
    )
  ) {
    return true;
  }
  return false;
}
