/**
 * Such-Prozess-Meta nie vorlesen — nur finale Antwort.
 * Pure (kein RN) — Smoke-testbar.
 */
export function stripSearchProcessFromSpeech(text: string): string {
  let s = String(text || '');
  // Meta-Präfixe, Rest der Aussage behalten
  s = s.replace(/\bOnline erweitert\s*(?:\([^)]{0,40}\))?\s*[,:—-]?\s*/giu, '');
  s = s.replace(/\bnicht nur (?:im )?Datensatz\s*[,:—-]?\s*/giu, '');
  s = s.replace(/\bringweise\s*(?:\([^)]{0,40}\))?\s*[,:—-]?\s*/giu, '');
  s = s.replace(
    /\bin\s+(?:ca\.?\s*)?\d{1,3}\s*km\b[^.!?]{0,80}\b(?:nichts|kein(?:e|en)?|keine Treffer|leer|gefunden)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\b(?:im Umkreis|innerhalb|unter|bis)\s+(?:von\s+)?\d{1,3}\s*km\b[^.!?]{0,80}\b(?:nichts|kein|leer|gefunden)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  // „bei 10 km nichts …“ / „erst ab 20 km Treffer“ — nicht Nav „nach 20 km rechts“
  s = s.replace(
    /\b(?:bei|ab|erst ab)\s+(?:ca\.?\s*)?\d{1,3}\s*km\b[^.!?]{0,40}\b(?:nichts|kein|leer|gefunden|Treffer|erweitert)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\b(?:Umkreis|Radius)\s+(?:auf|auf ca\.?|auf zirka)?\s*\d{1,3}\s*km\b[^.!?]{0,40}\b(?:erweitert|nichts|kein|leer)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\b\d{1,3}\s*\/\s*\d{1,3}\s*(?:\/\s*\d{1,3})?\s*km\b/giu,
    ' ',
  );
  s = s.replace(
    /\bsoll(?:en)?\s+ich\s+weiter\s+(?:suchen|gucken|schauen)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\b(?:soll ich |darf ich )?(?:noch\s+)?weiter\s+(?:suchen|gucken|schauen)\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(/\bPerfect-Strang\b/giu, ' ');
  s = s.replace(/\b(?:Such[- ]?Prozess|Recherche[- ]?Log)\b/giu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
