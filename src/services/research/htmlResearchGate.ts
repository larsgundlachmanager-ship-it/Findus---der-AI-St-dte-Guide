/**
 * Wann HTML-Scraping (Open-Web-Agent / Gemeinde-Seiten) die falsche Waffe ist.
 * Wetter → API. Trivia → Google Search am Antwort-LLM. Nav → Geocode. Gastro → Places.
 */

export function shouldSkipHtmlWebResearch(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return false;

  try {
    const { isQuickLookupQuery } = require('../concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t)) return true;
  } catch {
    /* soft */
  }

  try {
    const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(t)) return true;
  } catch {
    /* soft */
  }

  try {
    const {
      looksLikeStreetAddress,
      extractStreetAddressFromUtterance,
    } = require('../navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    if (looksLikeStreetAddress(t) || extractStreetAddressFromUtterance(t)) {
      return true;
    }
  } catch {
    /* soft */
  }

  if (
    /\b(wetter|temperatur|anziehen|jacke|pulli|wolken|grad\b)\b/iu.test(t) &&
    !/\b(webseite|website|pdf|flyer|dwd)\b/iu.test(t)
  ) {
    return true;
  }
  if (/\bregen\b/iu.test(t) && /\b(morgen|heute|wetter|anziehen)\b/iu.test(t)) {
    return true;
  }

  if (
    /\b(empfehl|frühstück(?:en)?\s+gehen|fruehstueck(?:en)?\s+gehen|essen\s+gehen|wo\s+kann\s+man\b.{0,80}\bessen|am\s+besten.{0,40}(?:steak|sushi|vegan|vegetar|asia|pizza|essen))\b/iu.test(
      t,
    ) &&
    !/\b(speisekarte|öffnungszeit|oeffnungszeit|website|homepage|pdf)\b/iu.test(t)
  ) {
    return true;
  }

  return false;
}

export function isHtmlScrapeFailureSpeech(text: string): boolean {
  return /\b(seiten?\s*leer|js[-\s]?only|javascript[-\s]?basiert|nicht an alle details)\b/iu.test(
    text || '',
  );
}

const MONTH_ONLY_RE =
  /^(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)$/iu;

const WEEKDAY_ONLY_RE =
  /^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)$/iu;

/**
 * Monat / Wochentag / Datum allein — nie Nav-Ziel (z. B. „27. Dezember“ → „Dezember“).
 * Stadt-agnostisch; kein Team-/Venue-Hardcode.
 */
export function isMonthOrDateOnlyNavName(name: string): boolean {
  const t = String(name || '')
    .replace(/^📍\s*/u, '')
    .replace(/^(?:Route:\s*|Route\s+zu\s+)/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  if (MONTH_ONLY_RE.test(t) || WEEKDAY_ONLY_RE.test(t)) return true;
  // „27. Dezember“, „Dezember 2026“, „15.04.“, ISO-Tag
  if (/^\d{1,2}\.\s*(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/iu.test(t)) {
    return true;
  }
  if (/^(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+20\d{2}$/iu.test(t)) {
    return true;
  }
  if (/^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\.?$/u.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(t)) return true;
  return false;
}

/**
 * Kategorie-/Gattungsname ohne konkreten Ort — nie Live-Pin / Nav-Ziel.
 * „Hochhäuser“, „Museen“, „Restaurants“… ≠ Tele-Michel / Elbphilharmonie.
 */
export function isCategoryNavDestName(name: string): boolean {
  const t = String(name || '')
    .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF📍🧭📌]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 3) return true;
  // Mehrere Gattungen mit Komma: „Hochhäuser, Museen“
  const parts = t.split(/\s*[,;/|]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => isSingleCategoryLabel(p))) {
    return true;
  }
  return isSingleCategoryLabel(t);
}

function isSingleCategoryLabel(t: string): boolean {
  const s = t.replace(/^die\s+|^der\s+|^das\s+/iu, '').trim();
  // Reine Gattung / Plural ohne Eigennamen-Signal
  if (
    /^(hochhäuser|hochhauser|wolkenkratzer|museen|museums?|restaurants?|cafés?|cafes?|hotels?|parks?|kirchen?|brücken?|bruecken?|strände|straende|shops?|läden|laeden|geschäfte|geschaefte|supermarkt(?:e|s)?|kinos?|clubs?|bars?|märkte|maerkte|sehenswürdigkeiten|sehenswuerdigkeiten|attraktionen|denkmäler|denkmaeler|aussichten|rooftops?|hochhäuser\s+und\s+\w+)$/iu.test(
      s,
    )
  ) {
    return true;
  }
  // „Hochhäuser in Hamburg“ ohne konkreten Namen
  if (
    /^(hochhäuser|museen|restaurants?|cafés?|hotels?|kinos?|parks?)\s+(in|bei|nahe|um)\s+\w+/iu.test(
      s,
    ) &&
    !/\b(turm|michel|elbphilharmonie|rathaus|dom|schloss|museum\s+\w)/iu.test(s)
  ) {
    return true;
  }
  return false;
}

/** Scrape-/Meta-Text darf nie Nav-Ziel oder HUD-Pin werden. */
export function isBogusNavDestName(name: string): boolean {
  const t = String(name || '')
    .replace(/^📍\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 3) return true;
  if (isMonthOrDateOnlyNavName(t)) return true;
  if (isCategoryNavDestName(t)) return true;
  if (/\[TASK\b/i.test(t)) return true;
  if (/\bdining_menus\b/i.test(t)) return true;
  if (/\bspeisekarten-urls?\b/i.test(t)) return true;
  if (/\bfuer\s+\d+\b/i.test(t) && /\b(task|speisekarte)/i.test(t)) return true;
  if (isHtmlScrapeFailureSpeech(t)) return true;
  if (
    /^(seiten?\s*leer|js[-\s]?only|ziel unklar|nichts greifbares|nichts verlässliches|offline-katalog)$/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(offline-katalog|greifbares|verlässliches|js[-\s]?only|tippen\s*→\s*route)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}
