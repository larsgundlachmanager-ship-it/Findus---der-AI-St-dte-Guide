/**
 * Heuristik: User will bestehenden Plan ändern (nicht neu ingesten).
 */

/** Ganzen Tag / Timeline leeren — kein neuer Wunsch, kein LLM. */
export function looksLikeClearDayPlan(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const wipe =
    /\b(lösch|loesch|streich|leer(?:en)?|vergiss|reset|abbrechen|cancel|über\s+den\s+haufen|ueber\s+den\s+haufen)\w*/i.test(
      t,
    );
  if (!wipe) return false;
  if (/\b(timeline|zeitlinie|kalender)\b/i.test(t)) return true;
  if (
    /\b(alles|komplette?n?|ganzen?\s+plan|ganze\s+planung|alle\s+(termine|einträge|eintraege|stopps|orte|punkte)|neu\s+starten|heutige[nr]?\s+plan)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(den|die|das|meinen|meine|unseren)\s+plan(?:ung)?\b/i.test(t)) {
    return true;
  }
  if (/\bplan(?:ung)?\s+(?:bitte\s+)?(?:lösch|loesch|leer)/i.test(t)) return true;
  if (
    /\b(?:lösch|loesch|leer)\w*\s+(?:bitte\s+)?(?:den\s+|die\s+|das\s+)?plan(?:ung)?\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function looksLikePlanEditUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeClearDayPlan(t)) return true;
  return (
    /\b(nicht\s+mehr|raus\s+damit|lösch|loesch|streich|änder|aender|verschieb|früher|frueher|später|spaeter|stattdessen|doch\s+nicht|ganz\s+anderen?\s+plan|komplett\s+neu)\b/i.test(
      t,
    ) ||
    // „das Tennisturnier ändern“ / „ändern sollst“ — kein Neu-Ingest
    /\b(?:soll(?:st|en)?\s+.{0,40})?änder(?:n|e)|änder(?:n|e)\s+soll/i.test(t) ||
    /\b(will\s+ich\s+nicht|brauche\s+ich\s+nicht|nimm\s+.{0,20}\s+raus)\b/i.test(
      t,
    ) ||
    // Inkrementell hinzufügen während Timeline offen
    /\b(noch\s+(?:dazu|ein|einen|eine|was)|dazu\s+(?:noch|ein)|pack(?:e)?\s+.{0,40}\s+dazu|ergänz|ergaenz|hinzu(?:fügen|fuegen)?|füg(?:e)?\s+.{0,30}\s+hinzu|fueg(?:e)?\s+.{0,30}\s+hinzu|auch\s+noch)\b/i.test(
      t,
    ) ||
    // „von 14 auf 16“ / „auf 16 Uhr“ — Zeit nachziehen
    /\bvon\s+\d{1,2}(?::\d{2})?\s*(?:uhr\s*)?(?:auf|um)\s+\d{1,2}(?::\d{2})?\b/i.test(
      t,
    ) ||
    // „Bewerbung von 10 bis 12“ / „Tennis 14–20“ — Zeitslot nachziehen
    /\b(?:von\s+)?\d{1,2}(?::\d{2})?\s*(?:uhr\s*)?(?:bis|-|–|—)\s*\d{1,2}(?::\d{2})?\b/i.test(
      t,
    )
  );
}
