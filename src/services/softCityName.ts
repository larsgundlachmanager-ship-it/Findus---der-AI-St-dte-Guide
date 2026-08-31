/**
 * Soft-Arbeitsstadt: nur echte Ortsnamen — nie Hotel-Amenities („Mit Pool Und“).
 * Keine RN-Deps (Smoke-freundlich).
 */

/** Hotel-/Wunsch-Müll — nie Soft-Stadt (auch Title-Case „Mit Pool Und“). */
const AMENITY_CITY_RE =
  /\b(pool|sauna|spa|massage|terrasse|balkon|meerblick|seeblick|wellness|whirlpool|fitness|parking|parkplatz|wlan|wifi|all.?inclusive|frühstück|fruehstueck|mit|ohne|und|oder|unter|über|ueber|euro|preis|günstig|guenstig|billig)\b/iu;

/**
 * Nur echte Ortsnamen als Soft-Stadt — keine Amenity-Sätze, keine Floskeln.
 */
export function isPlausibleSoftCityName(name: string): boolean {
  const raw = (name || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 3 || raw.length > 40) return false;
  if (AMENITY_CITY_RE.test(raw)) return false;
  if (/^\d/.test(raw)) return false;
  if (/^(hotel|restaurant|café|cafe|bar|stadt|datensatz)\b/iu.test(raw)) {
    return false;
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return false;
  const content = parts.filter(
    (p) => !/^(und|oder|mit|ohne|in|nach|für|fuer|bei)$/iu.test(p),
  );
  if (content.length === 0) return false;
  if (/^(mit|ohne)\b/iu.test(raw)) return false;
  return true;
}

export function looksLikeAmenityCityBlob(name: string): boolean {
  return AMENITY_CITY_RE.test((name || '').trim());
}
