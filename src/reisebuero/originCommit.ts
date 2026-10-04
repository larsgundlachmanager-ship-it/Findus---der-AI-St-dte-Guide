/**
 * Explizites A→B / Wohnort-Wechsel — darf prioren Startort überschreiben.
 * Hub-Listen („Hamburg, Berlin oder Bremen“) sind kein Origin-Wechsel.
 */
export function isExplicitFlightOriginChange(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;

  // Klar: von X nach Y
  if (
    /\bvon\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,2}\s+(?:nach|richtung)\b/iu.test(
      s,
    )
  ) {
    return true;
  }

  // Mehrere Hub-Städte / „oder“-Liste → kein einzelner Startort-Wechsel
  if (
    /\b(hamburg|berlin|bremen|hannover|köln|koeln|münchen|muenchen|düsseldorf|duesseldorf|frankfurt|stuttgart)\b/iu.test(
      s,
    ) &&
    /\boder\b|,/.test(s) &&
    (
      s.match(
        /\b(hamburg|berlin|bremen|hannover|köln|koeln|münchen|muenchen|düsseldorf|duesseldorf|frankfurt|stuttgart)\b/giu,
      ) || []
    ).length >= 2
  ) {
    return false;
  }

  return (
    /\b(?:starten|startort|wohne|wohnen)\b/iu.test(s) ||
    /\baus\s+\w+\s+starten\b/iu.test(s) ||
    /\bvon\s+\w+(?:\s+\w+){0,2}\s+aus\b/iu.test(s) ||
    /\b(?:abfliegen|starten)\s+(?:von|ab|aus)\s+[A-Za-zÄÖÜäöüß]/iu.test(s) ||
    /\b(?:fliegen|flieg|abfliegen)\s+von\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+(?:nach|richtung)\b|(?:\s*[.,!?]|$))/iu.test(
      s,
    )
  );
}
