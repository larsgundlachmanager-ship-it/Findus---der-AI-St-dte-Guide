/**
 * Kurze, nutzbare Ortsnamen für Timeline / HUD.
 */

const LEGAL_SUFFIX =
  /\b(gmbh|mbh|ag|kg|ug|e\.?\s*k\.?|ltd|inc|corp|co\.?|ohg|gbr|se|e\.?\s*v\.?|haftungsbeschr[aä]nkt)\b\.?/gi;

const NOISE =
  /\b(filiale|niederlassung|hauptgesch[aä]ft|store|outlet|deutschland|germany)\b/gi;

export function simplifyPlaceName(raw: string): string {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Alte vage Prefixes entfernen
  s = s.replace(/^(halt\s+bei|halt\s+unterwegs|gps[-\s]?halt)\s*/i, '');
  s = s.replace(LEGAL_SUFFIX, ' ');
  s = s.replace(NOISE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s,.\-–—|/]+|[\s,.\-–—|/]+$/g, '');

  // Ersten sinnvollen Teil behalten
  if (s.length > 36) {
    const part = s.split(/\s*[,|–—]\s*/)[0]?.trim() ?? s;
    s = part;
  }
  if (s.length > 36) {
    s = `${s.slice(0, 34).trim()}…`;
  }
  return s;
}

/** Straße + Hausnummer, mit Pin. */
export function formatStreetPin(street: string, houseNr?: string | null): string {
  const road = simplifyPlaceName(street).replace(/^📍\s*/, '');
  if (!road) return '📍 Unbekannte Straße';
  const nr = (houseNr || '').trim();
  return nr ? `📍 ${road} ${nr}` : `📍 ${road}`;
}

export function isVaguePlaceLabel(title: string): boolean {
  const t = title.toLowerCase().replace(/^📍\s*/, '').trim();
  return (
    !t ||
    /halt (unterwegs|bei)/i.test(t) ||
    /hier in der gegend/i.test(t) ||
    /unbekannter ort/i.test(t) ||
    /unbenannter ort/i.test(t) ||
    /^halt\b/i.test(t)
  );
}

export function placeNameKey(title: string): string {
  return simplifyPlaceName(title)
    .toLowerCase()
    .replace(/^📍\s*/, '')
    .replace(/[^a-z0-9äöüß]+/gi, '')
    .slice(0, 48);
}
