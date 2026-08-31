/**
 * Picknick / Grillen — Outdoor-Spot, keine Heritage-Tour.
 * Kein RN. Keine Ortsnamen.
 */

const PICNIC_RE =
  /\b(picknick|picnic|grillen|grillplatz|grillstelle|liegewiese)\b/iu;

const PICNIC_UNSUITABLE_RE =
  /(denkmal|ehrenmal|mahnmal|gedenk(?:stätte|staette|stein)?|memorial|\bkrieger|heimatverein|heimatbund|geschichtsverein|museum|kirche|kapelle|\bdom\b|rathaus|friedhof|grabmal|vereinshaus)/iu;

const PICNIC_OUTDOOR_RE =
  /\b(park|wiese|see|teich|grillplatz|grillstelle|picknick|picnic|liegewiese|garten|auen|waldlichtung|badesee|strand)\b/iu;

export function looksLikePicnicQuery(text: string): boolean {
  return PICNIC_RE.test((text || '').replace(/\s+/g, ' ').trim());
}

/** Kriegerehrenmal / Heimatverein / Kirche — kein Picknick-Spot. */
export function isPicnicUnsuitableVenue(
  name: string,
  extra?: string | string[] | null,
): boolean {
  const extraBlob = Array.isArray(extra) ? extra.join(' ') : extra ?? '';
  return PICNIC_UNSUITABLE_RE.test(`${name ?? ''} ${extraBlob}`);
}

export function looksLikePicnicOutdoorVenue(
  name: string,
  extra?: string | string[] | null,
): boolean {
  const extraBlob = Array.isArray(extra) ? extra.join(' ') : extra ?? '';
  return PICNIC_OUTDOOR_RE.test(`${name ?? ''} ${extraBlob}`);
}
