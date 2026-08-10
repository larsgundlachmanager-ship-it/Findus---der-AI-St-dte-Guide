/**
 * Fuzzy match für Fahrtrichtungs-Filter (HAFAS/Transitous).
 * „Hamburg Hauptbahnhof“ muss „Hamburg Hbf“ / „Hamburg“ treffen — nicht nur exakten Substring.
 */

const FILLER = new Set([
  'nach',
  'richtung',
  'bahnhof',
  'haltepunkt',
  'haltestelle',
  'station',
  'der',
  'die',
  'das',
  'dem',
  'den',
  'zum',
  'zur',
  'bitte',
  'jetzt',
  'mal',
  'mit',
]);

function normalizeDir(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\bhbf\b/g, 'hauptbahnhof')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * true = Abfahrt passt zur gewünschten Richtung / zum Zielhinweis.
 */
export function directionMatchesHint(
  direction: string,
  hint: string | null | undefined,
): boolean {
  const hRaw = (hint ?? '').trim();
  if (!hRaw) return true;
  const d = normalizeDir(direction);
  const h = normalizeDir(hRaw);
  if (!d || !h) return true;
  if (d.includes(h) || h.includes(d)) return true;

  const tokens = h
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !FILLER.has(t));

  // „hauptbahnhof“ allein ist zu schwach — Ortstoken brauchen Match
  const placeTokens = tokens.filter((t) => t !== 'hauptbahnhof');
  if (!placeTokens.length) {
    return tokens.some((t) => d.includes(t));
  }

  // Alle Ortstoken müssen in der Richtung vorkommen (hamburg ✓, pinneberg ✗)
  return placeTokens.every((t) => d.includes(t));
}
