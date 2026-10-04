/**
 * Open Place Find — Ortstyp dynamisch aus der Frage, ohne Whitelist-Hardcodes.
 * „Wo ist das nächste X?“ → X wird Must-Amenity für Pitch/Places/Harvest.
 * Bekannte Amenities (Toilette/…) bleiben in amenityPlaceFind; hier nur Fallback.
 */

const FIND_INTENT_RE =
  /\b(wo|find(?:e|en)?|suche|such|gibt\s+es|kann\s+(?:ich|man|wir)|zeig|brauch(?:e|en)?|möcht(?:e)?|moecht(?:e)?|will|hingehen|beste[rn]?|nächste[rn]?|naechste[rn]?)\b/iu;

/** Trivia / Meta — kein Nearby-Pitch. */
const TRIVIA_BLOCK_RE =
  /\b(geboren|gebaut|bedeutet|passwort|unterschied|gemalt|erfunden|geschrieben|komponiert|wie\s+alt|wie\s+hoch|wie\s+gro[sß]s|wer\s+ist|was\s+ist\s+ein)\b/iu;

/** Verleih/Kurs → Activity-Pfad, nicht Open-Place. */
const RENTAL_BLOCK_RE =
  /\b(verleih|ausleihen|mieten|kurs|schule|unterricht|bouldern|sup\b|stand[-\s]?up|surf(?:en|kurs)?|spikeball)\b/iu;

/**
 * Keine Ortstypen (Füllwörter / Zeit / Pronomen / Meta).
 * Stadt-agnostisch — keine Ortsnamen-Liste.
 */
const TYPE_STOP_RE =
  /^(das|die|der|dem|den|ein|eine|einen|einer|eines|hier|dort|da|jetzt|gleich|heute|morgen|in|im|am|an|auf|bei|von|zum|zur|mit|ohne|nähe|naehe|umkreis|stadt|ort|platz|stelle|ding|sache|option|möglichkeit|moeglichkeit|ich|mir|mich|uns|wir|man|bitte|mal|doch|denn|noch|schon|sehr|ganz|echt|richtig|nächste|naechste|nächster|naechster|nächstes|naechstes|nächsten|naechsten|all|you|can|eat|kein|keine|asiatisch|asia)$/iu;

/** Eng lokal halten (Whitelist-Amenities) — Open-Extract bekommt Metro-Radius. */
export const TIGHT_LOCAL_AMENITY_RE =
  /\b(toilette|klo|wc|briefkasten|postkasten|mailbox|packstation|paketautomat|trinkwasser|trinkbrunnen|geldautomat|atm|ladestation)\b/iu;

function normalizePlaceTypeToken(raw: string): string | null {
  let t = String(raw || '')
    .replace(/[?!.:,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (t.length < 3 || t.length > 48) return null;
  if (TYPE_STOP_RE.test(t)) return null;
  // Artikel am Anfang
  t = t.replace(/^(das|die|der|ein|eine|einen|einer|eines)\s+/iu, '').trim();
  if (t.length < 3 || TYPE_STOP_RE.test(t)) return null;
  // Keine reinen Zahlen / GPS
  if (/^\d+([.,]\d+)?$/.test(t)) return null;
  if (/^\d+[.,]\d+\s*,\s*\d+[.,]\d+$/.test(t)) return null;
  return t;
}

/**
 * Ortstyp aus Äußerung — strukturell, kein Domänen-Hardcode.
 * Liefert z. B. „fitnessstudio“, „kletterhalle“, „schuhgeschäft“.
 */
export function extractOpenPlaceType(text: string): string | null {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 8) return null;
  if (TRIVIA_BLOCK_RE.test(t)) return null;
  if (RENTAL_BLOCK_RE.test(t)) return null;
  if (isOwnedDiningOrStay(t)) return null;
  if (!FIND_INTENT_RE.test(t)) return null;

  const patterns: RegExp[] = [
    /\b(?:nächste[rn]?s?|naechste[rn]?s?)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})/iu,
    /\bwo\s+(?:ist|liegt|finde\s+ich)\s+(?:das|die|der|ein|eine|einen|nen)?\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})/iu,
    /\bgibt\s+es\s+(?:hier\s+|in\s+der\s+nähe\s+|in\s+der\s+naehe\s+)?(?:(?:ein|eine|einen|einer|nen)\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})/iu,
    /\b(?:suche|such|finde|zeig(?:\s+mir)?|brauch(?:e|en)?|möchte|moechte)\s+(?:(?:ein|eine|einen|das|die|der|nen)\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})/iu,
    /\b(?:zum|zur|zu\s+einem|zu\s+einer)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})\b/iu,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const norm = normalizePlaceTypeToken(m[1]);
    if (norm) return norm;
  }
  return null;
}

/** Domänen, die schon eigene Pitch-Kinds haben — Open-Find nicht klauen. */
const OWNED_PITCH_DOMAIN_RE =
  /\b(restaurant|essen|pizza|italiener|grieche|sushi|imbiss|café|cafe|frühstück|fruehstueck|burger|döner|doener|hotel|übernacht|uebernacht|airbnb|kino|film|cinema|bar|pub|biergarten|cocktail|all\s*you\s*can\s*eat|ayce|buffet|schlemmer)\b/iu;

function isOwnedDiningOrStay(text: string): boolean {
  const t = String(text || '');
  if (OWNED_PITCH_DOMAIN_RE.test(t)) return true;
  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    if (looksLikeAyceQuery(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Neue Nearby-Frage ohne Whitelist-Treffer → Open Place Find. */
export function isOpenPlaceFindQuery(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isOwnedDiningOrStay(t)) return false;
  return Boolean(extractOpenPlaceType(t));
}

/** Must-Label für Pitch (ein Ortstyp). */
export function openPlaceMustLabels(text: string): string[] {
  const typ = extractOpenPlaceType(text);
  return typ ? [typ] : [];
}

/**
 * Open-Extract / nicht eng-lokale Musts → Radius bis ~100 km.
 * Whitelist-Toilette/Briefkasten bleibt eng (TIGHT_LOCAL).
 */
export function isRegionalOpenPlaceFind(
  text: string,
  mustLabels: string[],
  opts?: { fromWhitelist?: boolean },
): boolean {
  if (!mustLabels.length) return false;
  if (mustLabels.every((m) => TIGHT_LOCAL_AMENITY_RE.test(m))) return false;
  // Whitelist-Treffer ohne Open-Extract: nur expandieren wenn Must nicht tight-local
  if (opts?.fromWhitelist && !isOpenPlaceFindQuery(text)) {
    return mustLabels.some((m) => !TIGHT_LOCAL_AMENITY_RE.test(m));
  }
  return true;
}

/**
 * Soft-Match Ortstyp ↔ Kandidat — stamm-/prefix-basiert, keine Domänen-Synonymliste.
 * „fitnessstudio“ trifft Name „Fitness …“ oder Types mit gemeinsamer Wurzel ≥5 Zeichen.
 */
export function openPlaceTypeSoftScore(blob: string, placeType: string): number {
  const b = String(blob || '').toLowerCase();
  const wt = String(placeType || '').toLowerCase().trim();
  if (!b || wt.length < 3) return 0;
  if (b.includes(wt)) return 3;
  const tokens = wt.match(/[a-zäöüß]{4,}/giu) ?? [];
  for (const tok of tokens) {
    if (b.includes(tok)) return 2;
  }
  // Komposita ohne Leerzeichen: längstes Präfix ≥5
  if (wt.length >= 6 && !/\s/.test(wt)) {
    for (let len = Math.min(10, wt.length - 1); len >= 5; len--) {
      if (b.includes(wt.slice(0, len))) return 2;
    }
  }
  return 0;
}

/**
 * Umgangssprache Erlebnis-Thema — „richtig geile X zu sehen“, „wo … X machen“.
 * Kein Domänen-Hardcode: X wird dynamisch gelesen.
 */
const EXPERIENCE_STOP_RE =
  /^(das|die|der|ein|eine|etwas|was|es|hier|dort|heute|abend|morgen|richtig|echt|sehr|ganz|mal|doch|bitte|spaß|spass|ding|sache)$/iu;

export function extractOpenThemeNeed(text: string): string | null {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 10) return null;
  if (RENTAL_BLOCK_RE.test(t)) return null;
  if (isOwnedDiningOrStay(t) && !/\bzu\s+(?:sehen|erleben|besuchen)\b/iu.test(t)) {
    return null;
  }

  const patterns: RegExp[] = [
    /\b(?:richtig\s+|echt\s+)?(?:geile[rnms]?|beste[rn]?|echte[rn]?|richtige[rnms]?|tolle[rnms]?|krasse[rnms]?)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,28})\s+zu\s+(?:sehen|machen|erleben|besuchen|anschauen)\b/iu,
    /\b([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,28})\s+zu\s+(?:sehen|erleben|besuchen|anschauen)\b/iu,
    /\b(?:lust|bock)\s+auf\s+(?:einen?|eine|ein|das|die|den)?\s*(?:richtig\s+|echt\s+)?(?:geile[rnms]?|beste[rn]?|echte[rn]?)?\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,28})\b/iu,
    /\bwo\s+(?:kann|soll)\s+(?:ich|man|wir).{0,40}?\b([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,28})\s+(?:sehen|machen|erleben|anschauen)\b/iu,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const norm = normalizePlaceTypeToken(m[1]);
    if (!norm || EXPERIENCE_STOP_RE.test(norm)) continue;
    // Trivia-Wörter nicht als Erlebnis
    if (/^(alt|hoch|groß|gross|preis|wetter)$/i.test(norm)) continue;
    return norm;
  }
  return null;
}

export function isOpenExperienceQuery(text: string): boolean {
  return Boolean(extractOpenThemeNeed(text));
}

/**
 * Beleg-Qualität für Theme/Erlebnis-Musts.
 * ≥2 = glaubwürdige Attraction; 1 = nur Namens-/Tag-Treffer (zu schwach für Pack-Win);
 * 0 = Souvenir/Bild/Shop-Rauschen oder kein Bezug.
 * Strukturell — keine Domänen-Synonymliste.
 */
export function themeAttractionEvidenceScore(
  blob: string,
  theme: string,
): number {
  const b = String(blob || '').toLowerCase();
  const themeScore = openPlaceTypeSoftScore(b, theme);
  if (themeScore < 2) return 0;
  const attraction =
    /\b(museum|ausstellung|park|zoo|aquarium|erlebnis|schau|show|skelett|fossil|sammlung|galerie|denkmal|attraktion|attraction|besucher|eintritt|ausflug|naturkund|planetarium|science|erleben|besichtig)\b/iu.test(
      b,
    );
  const weakNoise =
    /\b(souvenir|magnet|poster|postkarte|bild|foto|fotografie|spielzeug|merch|shop|laden|café|cafe|bäckerei|baeckerei|imbiss)\b/iu.test(
      b,
    ) && !attraction;
  if (weakNoise) return 0;
  if (attraction) return 3;
  // Nur Name/Tag ohne Attraction-Signal → zu dünn für Pack-„Perfect“
  return 1;
}

/** Pack-Hit zu schwach für Theme-Must → Live-Recherche erzwingen. */
export function packHitTooWeakForThemeMust(
  blob: string,
  themeMusts: string[],
): boolean {
  if (!themeMusts.length) return false;
  return themeMusts.every((th) => themeAttractionEvidenceScore(blob, th) < 2);
}

/**
 * Open Need = Place-Typ ODER Erlebnis-Thema (Umgangssprache).
 * Für Call-1 Pitch/Deep-Web ohne Gold-Blaupause.
 */
export function extractOpenNeedLabel(text: string): string | null {
  return extractOpenThemeNeed(text) || extractOpenPlaceType(text);
}

export function isOpenNeedQuery(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isOpenExperienceQuery(t)) return true;
  if (isOpenPlaceFindQuery(t)) return true;
  return false;
}
