/**
 * Genannter Spiel-/Termin-Auftrag — Struktur, keine Team-Liste.
 * „Wann spielt X …?“ / FC|SV + Spiel → Event-Research, nicht GPS-Nightlife.
 */

const SCHEDULE_INTENT_RE =
  /\b(?:wann\s+(?:spielt|spielen|ist|findet)|n[aä]chstes?\s+(?:spiel|heimspiel|game|match)|spielplan|heimspiel|ausw[aä]rtsspiel|anpfiff|spielzeiten?|spielt\s+(?:hier|wieder|n[aä]chst))\b/iu;

const CLUB_PREFIX_RE =
  /\b(?:fc|sv|tsv|sc|vfb|bvb|1\.\s*fc|baskets?|united|city)\b/iu;

/** Mindestens ein Eigenname / Marke (stadt-agnostisch). */
const NAMED_SUBJECT_RE =
  /\b(?:die|der|das)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]{2,}\b|\b[A-ZÄÖÜ][\wÄÖÜäöüß\-]{2,}(?:\s+[A-ZÄÖÜ0-9][\wÄÖÜäöüß\-]{1,}){0,4}\b/u;

const VENUE_ASK_RE =
  /\b(?:halle|arena|stadion|park)\b/iu;

/**
 * User fragt nach Termin eines genannten Teams/Acts/Orts —
 * nicht „was geht heute Abend?“ ohne Namen.
 */
export function looksLikeNamedScheduleQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return false;
  const hasSchedule =
    SCHEDULE_INTENT_RE.test(t) ||
    (/\bspiel(?:en|t)?\b/iu.test(t) && VENUE_ASK_RE.test(t)) ||
    (/\b(?:ticket|eintritt|gegner)\b/iu.test(t) &&
      (CLUB_PREFIX_RE.test(t) || NAMED_SUBJECT_RE.test(t)));
  if (!hasSchedule) return false;
  if (CLUB_PREFIX_RE.test(t)) return true;
  if (NAMED_SUBJECT_RE.test(t)) return true;
  return false;
}

/** Follow-up (Tickets/Gegner) nach Spielplan-Turn. */
export function looksLikeNamedScheduleFollowUp(
  text: string,
  pendingQuery: string | null | undefined,
): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || !pendingQuery) return false;
  if (!looksLikeNamedScheduleQuery(pendingQuery)) return false;
  return /\b(?:ticket|preis|teuer|gegner|uhrzeit|wann|website|link|mehr)\b/iu.test(
    t,
  );
}

/** @deprecated Alias — Call-Sites / Tests */
export function isSportsScheduleQuery(text: string): boolean {
  return looksLikeNamedScheduleQuery(text);
}

export function isSportsScheduleFollowUp(
  text: string,
  pendingQuery: string | null | undefined,
): boolean {
  return looksLikeNamedScheduleFollowUp(text, pendingQuery);
}

/**
 * Keine Team→Stadt-Hardcodes. Stadt kommt aus Call-1 / extractCityFromText.
 * Soft nur STT-Halle-Varianten ohne Stadtname (Ballsport… → oft HH, aber optional).
 */
export function resolveSportsResearchCity(_userText: string): string | null {
  return null;
}
