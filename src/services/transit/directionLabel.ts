/**
 * Richtung/Headsign-Normalisierung für Live-Abfahrten (stadt-agnostisch).
 * DELFI/GTFS setzt manchmal Straßen+Hausnr. statt HVV-Ziel (z. B. Wrist).
 */

/** „Nincoper Straße 160“ → true; „Wrist“ / „Pinneberg“ → false. */
export function looksLikeStreetHeadsign(
  name: string | null | undefined,
): boolean {
  const t = (name || '').trim();
  if (!t) return false;
  const hasStreet = /stra(?:ss|ß)e|\bstr\./i.test(t);
  const hasHouse = /\d{1,4}\s*[a-zA-Z]?\s*$/.test(t);
  return hasStreet && hasHouse;
}

/** Anzeige wie HVV: „Wrist Bahnhof“ → „Wrist“. */
export function cleanDirectionLabel(name: string): string {
  return (name || '')
    .trim()
    .replace(/\s+Bahnhof\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pickRawDirection(
  headsign: string,
  tripToName: string,
): string {
  const h = headsign.trim();
  const t = tripToName.trim();
  if (h && !looksLikeStreetHeadsign(h)) return h;
  if (t && !looksLikeStreetHeadsign(t)) return t;
  return t || h || '—';
}
