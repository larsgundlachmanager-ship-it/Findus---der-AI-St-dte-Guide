/**
 * Straße + Hausnummer — Geocode before Places/POI.
 * SSOT für looksLikeStreetAddress (Nav, Canonical Dest, Tests).
 */

import {
  fuzzyResolveCityName,
  loadNearbyCitiesFromIndex,
  nearestCityName,
  splitStreetAndCity,
} from './fuzzyCityResolve';

/**
 * Straße + Hausnummer (z. B. „Heisterhoop 12“, „Hauptstr. 3a in Prisdorf“).
 * Dann: Geocode before Places/POI — sonst gewinnt oft ein Establishment gleichen Namens.
 */
const TRAILING_NAV_JUNK =
  /\s+(?:navigiert(?:\s+werden)?|navigieren|bitte|jetzt|dorthin|hin)$/iu;

/** Hausnummer aus „Heisterhoop 12“ / „Hauptstr. 3a“. */
export function parseStreetHouseQuery(
  raw: string,
): { street: string; housenumber: string } | null {
  const q = raw.replace(/\s+/g, ' ').trim();
  const m = q.match(
    /^(.+?)\s+(\d{1,4}[a-zA-Z]?)(?:\s*,?\s*(?:in\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-]*)?$/u,
  );
  if (!m) return null;
  const street = m[1]!.replace(/[.,]+$/g, '').trim();
  const housenumber = m[2]!.trim();
  if (street.length < 3 || /\b(hotel|linie|bus|restaurant)\b/iu.test(street)) {
    return null;
  }
  return { street, housenumber };
}

export function stripNavJunkFromDest(label: string): string {
  return label.replace(TRAILING_NAV_JUNK, '').replace(/\s+/g, ' ').trim();
}

const ADDRESS_ANAPHOR_RE =
  /\b(?:dieser|diese|dieses|die|der|jene[smnr]?)\s+adresse\b/iu;

/** „dieser Adresse“ / nacktes „dahin“ — nie als Ortsname geocoden. */
export function looksLikeAddressAnaphor(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (ADDRESS_ANAPHOR_RE.test(t)) return true;
  return /^(?:bring\s+mich\s+)?(?:bitte\s+)?(?:dahin|dorthin)(?:\s+bitte)?[.!?]?$/iu.test(
    t,
  );
}

/** Pronomen / leere Dest-Labels — Kontext nutzen, nie geocoden. */
export function isWeakNavDestLabel(name: string): boolean {
  const t = (name || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return true;
  if (ADDRESS_ANAPHOR_RE.test(t)) return true;
  return /^(dein\s+ziel|dahin|dorthin|dort|da|hin|hier|ziel|ort|location|adresse)$/iu.test(
    t,
  );
}

/** Manager-Leak / Analyse-Brief — nicht Teil der Adresse. */
export function stripNavDestLeak(raw: string): string {
  return String(raw || '')
    .replace(/\s*\[TASK[^\]]*\]\s*/gi, ' ')
    .replace(/\bBeantworte:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pack-Sub-POI „Ort · Haupteingang“ — für HUD/Karte den Ort zeigen.
 * Nur generische Eingangs-Suffixe; benannte Türen (Nord/Süd) bleiben.
 */
export function stripEntranceDisplaySuffix(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[·•|,/\-–—]\s*(?:Haupteingang|Eingang)(?:\s*\d+)?\s*$/iu, '')
    .trim();
}

/**
 * Adress-Query säubern: TASK/Brief weg, erste Straße+Stadt behalten.
 * „Steinstraße 1, Düsseldorf [TASK …] … Berlin Umland“ → „Steinstraße 1, Düsseldorf“.
 */
export function sanitizeNavDestQuery(raw: string): string {
  const t = stripNavDestLeak(raw);
  if (!t) return t;
  const extracted = extractStreetAddressFromUtterance(t) || t;
  const { street, spokenCity } = splitStreetAndCity(extracted);
  if (spokenCity) {
    const city = fuzzyResolveCityName(spokenCity) || spokenCity;
    return `${street}, ${city}`;
  }
  return extracted.replace(/\s+/g, ' ').trim();
}

const LAST_STREET_TTL_MS = 30 * 60_000;
let lastStreetNav: { query: string; atMs: number } | null = null;

/** Letzte Straßen-Query — überlebt Nav-Clear bei „nein, andere Stadt“. */
export function rememberStreetNavQuery(query: string): void {
  const q = (query || '').replace(/\s+/g, ' ').trim();
  if (!q || !looksLikeStreetAddress(q)) return;
  lastStreetNav = { query: q, atMs: Date.now() };
}

export function peekLastStreetNavQuery(): string | null {
  if (!lastStreetNav) return null;
  if (Date.now() - lastStreetNav.atMs > LAST_STREET_TTL_MS) {
    lastStreetNav = null;
    return null;
  }
  return lastStreetNav.query;
}

/**
 * Adresse in einem ganzen Satz („navigiert werden zum Heisterhoop 12“).
 */
export function extractStreetAddressFromUtterance(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m =
    t.match(
      /\b([\wÄÖÜäöüß.\-]{3,}(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|hof|hoop)\s+\d{1,4}[a-zA-Z]?(?:\s*(?:,\s*|\s+in\s+)[A-ZÄÖÜ][\wÄÖÜäöüß\-]{2,})?)\b/iu,
    ) ||
    t.match(
      /\b([\wÄÖÜäöüß.\-]{3,}\s+\d{1,4}[a-zA-Z]?(?:\s*(?:,\s*|\s+in\s+)[A-ZÄÖÜ][\wÄÖÜäöüß\-]{2,})?)(?=\s|$|[.!?])/u,
    );
  if (!m?.[1]) return null;
  const cand = stripNavJunkFromDest(m[1].trim());
  return looksLikeStreetAddress(cand) ? cand : null;
}

export function looksLikeStreetAddress(q: string): boolean {
  const t = q.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return false;
  // „unter 500 Euro“ / „bis 80“ ist Budget, keine Hausnummer
  if (
    /^(?:unter|über|ueber|bis|ab|max(?:imal)?|um|ca\.?|circa|rund|etwa|mind(?:estens)?)\s+\d{1,4}\b/iu.test(
      t,
    ) ||
    /\b\d{1,4}\s*(?:€|euro)\b/iu.test(t)
  ) {
    return false;
  }
  // „ist 50“ / „heute 50“ aus Budget-Sätzen — kein Straßenname
  if (
    /^(?:ist|und|oder|für|fuer|mit|zum|zur|bei|von|nach|heute|budget|mein|eine[mn]?|der|die|das)\s+\d{1,4}\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  const hasStreetSuffixNumber =
    /\b[\wÄÖÜäöüß.\-]*(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|chaussee|hof|hoop)\s+\d{1,4}[a-zA-Z]?\b/iu.test(
      t,
    );
  // „Hotel 12 Apostel“, „Bus Linie 12“ — außer klassische Straßen-Endung
  if (
    /\b(hotel|hostel|unterkunft|restaurant|café|cafe|bar|club|museum|linie|bus|bahn|tram|u-?bahn|s-?bahn|apartment|suite|pension)\b/iu.test(
      t,
    ) &&
    !hasStreetSuffixNumber
  ) {
    return false;
  }
  if (hasStreetSuffixNumber) return true;
  // Name + standalone Hausnummer, optional Stadt
  return /\b[\wÄÖÜäöüß.\-]{3,}\s+\d{1,4}[a-zA-Z]?(?:\s*,?\s*(?:in\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-]*)?\s*$/u.test(
    t,
  );
}

/** Phonetic STT: …hof 12 ↔ …hoop 12 (ohne Orts-Hardcode). */
export function streetAddressGeocodeCandidates(query: string): string[] {
  const q = query.replace(/\s+/g, ' ').trim();
  const out: string[] = [q];
  const m = q.match(/^(.+?)(hof|hoop)(\s+\d{1,4}[a-zA-Z]?\b.*)$/iu);
  if (m) {
    const alt = m[2].toLowerCase() === 'hof' ? 'hoop' : 'hof';
    const swapped = `${m[1]}${alt}${m[3]}`;
    if (!out.some((x) => x.toLowerCase() === swapped.toLowerCase())) {
      out.push(swapped);
    }
  }
  return out;
}

/**
 * Adress-Geocode-Kandidaten: Hof/Hoop + fuzzy Stadt („Pillerberg“→Pinneberg)
 * + Profil-Stadt + nächste Stadt per GPS.
 */
export function expandStreetAddressGeocodeQueries(
  query: string,
  opts?: {
    profileCity?: string | null;
    biasLat?: number;
    biasLng?: number;
  },
): string[] {
  const cleaned = sanitizeNavDestQuery(query) || query.replace(/\s+/g, ' ').trim();
  const base = streetAddressGeocodeCandidates(cleaned);
  const { street, spokenCity } = splitStreetAndCity(cleaned);
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  rememberStreetNavQuery(cleaned);

  if (spokenCity) {
    const resolved = fuzzyResolveCityName(spokenCity) || spokenCity;
    push(`${street}, ${resolved}`);
    push(`${street} in ${resolved}`);
  }
  for (const b of base) push(b);

  if (!spokenCity) {
    const profile = opts?.profileCity?.trim();
    if (profile) {
      push(`${street}, ${profile}`);
    }
    const nearest = nearestCityName(
      opts?.biasLat,
      opts?.biasLng,
      loadNearbyCitiesFromIndex(),
    );
    if (nearest) {
      push(`${street}, ${nearest}`);
    }
  }


  return out;
}
