/**
 * Stadt-Korrektur einer laufenden Straßen-Navigation.
 * Blaupause: gleiche Straße, andere Stadt — kein Orts-Hardcode.
 */

import {
  extractStreetAddressFromUtterance,
  looksLikeStreetAddress,
  parseStreetHouseQuery,
  rememberStreetNavQuery,
} from './streetAddressQuery';
import { fuzzyResolveCityName, splitStreetAndCity } from './fuzzyCityResolve';

const CORRECTION_CUE =
  /\b(?:nein|nee|nö|noe|ne\b|nicht|sondern|ich\s+meinte?|meinst|ich\s+meine|es\s+ist|falsch|doch|stattdessen|korrektur)\b/iu;

const CITY_STOP = new Set([
  'nein',
  'nicht',
  'bitte',
  'doch',
  'halt',
  'das',
  'der',
  'die',
  'ist',
  'eine',
  'einen',
  'okay',
  'ok',
]);

export function looksLikeSpokenCityCorrection(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const addr = extractStreetAddressFromUtterance(t);
  if (addr && splitStreetAndCity(addr).spokenCity) return true;
  if (addr && CORRECTION_CUE.test(t)) return true;
  if (!CORRECTION_CUE.test(t)) return false;
  return extractCorrectedCityName(t) != null;
}

/** Straße+Nr. aus Dest-Label / Nominatim-display_name. */
export function streetCoreFromDestLabel(label: string): string | null {
  const t = (label || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const extracted = extractStreetAddressFromUtterance(t);
  if (extracted) {
    const { street } = splitStreetAndCity(extracted);
    if (looksLikeStreetAddress(street)) return street;
    const parsed = parseStreetHouseQuery(extracted);
    if (parsed) return `${parsed.street} ${parsed.housenumber}`;
  }
  const nomNumFirst = t.match(
    /\b(\d{1,4}[a-zA-Z]?),\s*([\wÄÖÜäöüß.\-]*(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|hof|hoop))\b/iu,
  );
  if (nomNumFirst) return `${nomNumFirst[2]} ${nomNumFirst[1]}`;
  const nomStreetFirst = t.match(
    /\b([\wÄÖÜäöüß.\-]*(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|hof|hoop)),\s*(\d{1,4}[a-zA-Z]?)\b/iu,
  );
  if (nomStreetFirst) return `${nomStreetFirst[1]} ${nomStreetFirst[2]}`;
  const parsed = parseStreetHouseQuery(splitStreetAndCity(t).street);
  if (parsed) return `${parsed.street} ${parsed.housenumber}`;
  return null;
}

/** „Alsterhaus, Lübeck“ → Alsterhaus — Stadt ab, Name behalten. */
export function placeCoreFromDestLabel(label: string): string | null {
  const t = String(label || '')
    .replace(/\s*\[TASK[^\]]*\]\s*/gi, ' ')
    .replace(/\bBeantworte:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const street = streetCoreFromDestLabel(t);
  if (street) return street;
  const first = t.split(',')[0]?.trim() || t;
  const stripped = first.replace(/\s+in\s+[A-ZÄÖÜ].*$/u, '').trim();
  if (stripped.length < 3) return null;
  if (/^(nein|nicht|ok|okay|bitte|ziel|end)$/iu.test(stripped)) return null;
  return stripped;
}

export function extractCorrectedCityName(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const fromAddr = extractStreetAddressFromUtterance(t);
  if (fromAddr) {
    const { spokenCity } = splitStreetAndCity(fromAddr);
    if (spokenCity) return fuzzyResolveCityName(spokenCity) || spokenCity;
  }
  const inCity = t.match(
    /\b(?:in|nach)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]{2,})\s*$/iu,
  );
  const cueCity = t.match(
    /\b(?:nein|nee|nicht|sondern|meinte?|meinst|meine|ist|falsch|doch)[,.]?\s+(?:in\s+|nach\s+)?([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]{3,})\s*$/iu,
  );
  const raw = (inCity?.[1] || cueCity?.[1] || '').trim();
  if (!raw || CITY_STOP.has(raw.toLowerCase())) return null;
  return fuzzyResolveCityName(raw);
}

export function resolveNavDestCorrection(opts: {
  userText: string;
  currentDestName?: string | null;
  lastStreetQuery?: string | null;
}): string | null {
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const spoken = extractStreetAddressFromUtterance(t);
  if (spoken) {
    rememberStreetNavQuery(spoken);
    const { street, spokenCity } = splitStreetAndCity(spoken);
    const dest = spokenCity
      ? `${street}, ${fuzzyResolveCityName(spokenCity) || spokenCity}`
      : spoken;
    return dest;
  }
  const city = extractCorrectedCityName(t);
  if (!city) return null;
  if (!CORRECTION_CUE.test(t) && !/\bin\s+/iu.test(t)) return null;
  const streetSrc = opts.lastStreetQuery || opts.currentDestName || '';
  const core =
    streetCoreFromDestLabel(streetSrc) || placeCoreFromDestLabel(streetSrc);
  if (!core) return null;
  const dest = `${core}, ${city}`;
  return dest;
}
