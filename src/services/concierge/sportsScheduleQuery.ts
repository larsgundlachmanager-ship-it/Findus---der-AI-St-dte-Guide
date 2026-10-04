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
  /\b(?:halle|arena|stadion|park|barclays|barclaycard|barley|katarina|inselpark)\b/iu;

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

/**
 * Genannte Team-/Act-Tokens aus der User-Frage (Hard-Match gegen Research).
 * Stadt-agnostisch — keine Team-Liste, nur Eigennamen + Club-Prefix.
 */
export function extractNamedScheduleSubjects(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s.length < 3) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    // Stopwords / reine Venue-Wörter nicht als Team
    if (
      /^(?:wann|spielt|spielen|nächstes|naechstes|spiel|heimspiel|ticket|arena|halle|stadion|heute|abend|saison|jahr)$/iu.test(
        s,
      )
    ) {
      return;
    }
    seen.add(key);
    out.push(s);
  };
  const multi =
    t.match(
      /\b(?:die|der|das)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ0-9][\wÄÖÜäöüß\-]+){0,3})\b/gu,
    ) || [];
  for (const m of multi) {
    push(m.replace(/^(?:die|der|das)\s+/iu, ''));
  }
  const caps =
    t.match(/\b[A-ZÄÖÜ][\wÄÖÜäöüß\-]{2,}(?:\s+[A-ZÄÖÜ0-9][\wÄÖÜäöüß\-]{1,}){0,3}\b/gu) ||
    [];
  for (const m of caps) push(m);
  return out.slice(0, 6);
}

/** Event passt zum genannten Team/Act — Konzert-Ersatz rausfiltern. */
export function eventMatchesNamedScheduleSubject(
  event: { title?: string | null; venue?: string | null; summary?: string | null },
  subjects: string[],
): boolean {
  if (!subjects.length) return true;
  const blob = `${event.title || ''} ${event.venue || ''} ${event.summary || ''}`.toLowerCase();
  if (!blob.trim()) return false;
  return subjects.some((s) => {
    const needle = s.toLowerCase();
    if (needle.length < 3) return false;
    if (blob.includes(needle)) return true;
    // „Hamburg Towers“ ↔ „Towers“
    const parts = needle.split(/\s+/).filter((p) => p.length >= 4);
    return parts.length > 0 && parts.every((p) => blob.includes(p));
  });
}

/** @deprecated Alias — Call-Sites / Tests */
export function isSportsScheduleQuery(text: string): boolean {
  return looksLikeNamedScheduleQuery(text);
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
