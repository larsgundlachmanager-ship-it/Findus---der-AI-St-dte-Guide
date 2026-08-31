/**
 * Erkennt geklebte Bridge-Sätze (User-Fragment + Floskel).
 * Rein — kein RN.
 */

const WAIT_RE =
  /\b(ich\s+(?:schau|check|guck|sehe)\s*(?:mal|kurz)?|ich\s+bin\s+dran|moment(?:\s+mal)?|warte(?:\s+kurz)?|recherchier(?:e|en)?|guck\s+mal|sekunde|kurze?\s+geduld|alles\s+klar|gute\s+frage|mega\s+plan|ich\s+schau\s+mal\s+nach)\b/iu;

const WEATHER_IGNORANCE_RE =
  /\b(wissen\s+(?:wir\s+)?nicht|keine\s+ahnung|kann\s+ich\s+(?:dir\s+)?(?:gerade\s+)?nicht\s+sagen|hab(?:e|)\s+ich\s+gerade\s+nicht|steht\s+mir\s+nicht\s+zur\s+verfügung)\b/iu;

/** Meta-Wartefloskel raus; Inhaltssatz bleibt. Kein RN. */
export function sanitizeBridgeText(text: string | null | undefined): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (WEATHER_IGNORANCE_RE.test(t)) return null;
  if (looksLikeSlotGluedBridge(t)) return null;
  const taxiCommit =
    /\b(taxi|uber|fahrt)\b/iu.test(t) &&
    /\b(organisieren|organisiere|rufe|rufen|bestellen|holen)\b/iu.test(t);
  if (taxiCommit) return t;
  // Kurze Wetter-/Lookup-Zusage („lass uns nachgucken“) behalten.
  if (
    /\b(wetter|regen|schauer|grad|°)\b/iu.test(t) &&
    /\b(nachgucken|nachschauen|reinschauen|kurz\s+(?:mal\s+)?(?:schauen|gucken|checken))\b/iu.test(t)
  ) {
    return t;
  }
  if (WAIT_RE.test(t) && t.split(/\s+/).length <= 10) return null;
  const cleaned = t
    .replace(WAIT_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.;:\-–—]\s*/, '')
    .trim();
  if (!cleaned || cleaned.split(/\s+/).length < 3) return null;
  return cleaned;
}

export function looksLikeSlotGluedBridge(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bklingt richtig gut\b/iu.test(t)) return true;
  if (
    t.split(/\s+/).length <= 14 &&
    /\bnach\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß'-]*\s+muss(?:t)?\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}
