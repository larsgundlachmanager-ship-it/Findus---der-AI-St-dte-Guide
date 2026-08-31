/**
 * Fest-Typ Hard-Match (stadt-agnostisch) — pure Helpers ohne RN/Store.
 * SSOT-Nutzung: eventResearchService + liveInventoryGate Follow-ups.
 */

export function userAskedForFestival(text: string): boolean {
  return /\b(fest|festival|weinfest|stadtfest|sommerfest|volksfest|wein\s*fest|open[\s-]?air)\b/iu.test(
    text.replace(/\s+/g, ' '),
  );
}

/**
 * Spezifischer Fest-Typ aus der Frage.
 * Weinfest ≠ Straßenfest/Stadtfest — Hard-Match für Filter + Prompt.
 */
export type AskedFestivalType =
  | 'wine'
  | 'beer'
  | 'street'
  | 'city'
  | 'music'
  | 'food'
  | 'generic';

export function detectAskedFestivalType(text: string): AskedFestivalType | null {
  const t = text.replace(/\s+/g, ' ').toLowerCase();
  if (/\b(weinfest|wein\s*fest|weinmarkt|wine\s*fest(?:ival)?)\b/.test(t)) {
    return 'wine';
  }
  if (/\b(bierfest|bier\s*fest|oktoberfest)\b/.test(t)) return 'beer';
  if (
    /\b(straßenfest|strassenfest|landstraßenfest|landstrassenfest|viertelfest|kiezfest|street\s*fest)\b/.test(
      t,
    )
  ) {
    return 'street';
  }
  if (/\b(stadtfest|stadt\s*fest)\b/.test(t)) return 'city';
  if (/\b(musikfest|music\s*fest|jazzfest|konzertfest)\b/.test(t)) return 'music';
  if (/\b(food\s*fest|street\s*food|schlemmerfest|genussfest)\b/.test(t)) {
    return 'food';
  }
  if (userAskedForFestival(t)) return 'generic';
  return null;
}

/** Nachfragen zu einem zuvor genannten Fest — ohne erneutes „Festival“-Keyword. */
export function isEventFestivalDeepenQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200) return false;
  return (
    /\b(wann\s+(geht(?:'s|s)?|startet|fängt|anfaengt|anfängt|los|auf)|ab\s+wann|bis\s+wann|welche\s+zeiten|uhrzeit|spielzeit|öffnungszeit|oeffnungszeit)\b/iu.test(
      t,
    ) ||
    /\b(erzähl|erzaehl|mehr\s+dazu|mehr\s+darüber|mehr\s+darueber|mehr\s+programm|ausführlich|ausfuehrlich|briefing|details?)\b/iu.test(
      t,
    ) ||
    /\b(läuft|laeuft|geht)\s+(das|es|jetzt|noch|dort|da)\b/iu.test(t) ||
    /\b(gibt\s+es\s+(wirklich|tatsächlich|tatsaechlich|aktuell|jetzt)|wirklich\s+(ein|eins|noch)|aktuell\s+(noch\s+)?(am\s+laufen|offen|aktiv))\b/iu.test(
      t,
    ) ||
    /\b(programm|flyer|pdf|eintritt|tickets?|stände|staende|acts?|was\s+läuft|was\s+laeuft)\b/iu.test(
      t,
    ) ||
    // „ich bin gerade beim Weinfest / erzähl darüber Programm“
    /\b(bin\s+(gerade|jetzt)|mache?\s+(eben|gerade)|steh(?:e|st)?\s+(gerade|jetzt)).{0,40}\b(fest|weinfest|festival)\b/iu.test(
      t,
    ) ||
    /\b(darüber|darueber|dazu).{0,24}\b(programm|erzähl|erzaehl|mehr)\b/iu.test(t) ||
    /\b(programm|erzähl|erzaehl|mehr).{0,24}\b(darüber|darueber|dazu)\b/iu.test(t)
  );
}

export function wantsEventBriefingActions(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isEventFestivalDeepenQuery(t)) return true;
  return (
    /\b(erzähl|erzaehl|mehr|wann|start|programm|navigation|route|fahr\s*hin)\b/iu.test(
      t,
    ) &&
    (userAskedForFestival(t) || detectAskedFestivalType(t) != null)
  );
}

/** Weinladen/Bar ≠ Fest — nur wenn User klar ein Fest wollte. */
export function looksLikeShopNotFestival(e: {
  title: string;
  venue: string;
  summary: string;
}): boolean {
  const blob = `${e.title} ${e.venue} ${e.summary}`.toLowerCase();
  const shopish =
    /\b(weinhandlung|weinladen|vinothek|weine?\s*shop|weinboutique|weinstube|weinbar|wine\s*bar|wein\s*handel|probierstube)\b/.test(
      blob,
    );
  if (!shopish) return false;
  // Shop-Tokens schlagen schwache Fest-Wörter („Veranstaltung“ in Laden-Werbung)
  const strongFest =
    /\b(weinfest|wein\s*fest|open[\s-]?air|volksfest|stadtfest|sommerfest|festival)\b/.test(
      blob,
    );
  return !strongFest;
}

/** Treffer zum angefragten Fest-Typ? Weinfest ≠ generisches Straßenfest. */
export function eventMatchesFestivalType(
  e: { title: string; venue: string; summary: string },
  type: AskedFestivalType | null,
): boolean {
  if (!type || type === 'generic') return true;
  const blob = `${e.title} ${e.venue} ${e.summary}`.toLowerCase();
  switch (type) {
    case 'wine':
      return (
        /\b(weinfest|wein\s*fest|weinmarkt|wine\s*fest(?:ival)?|winzerfest)\b/.test(
          blob,
        ) ||
        (/\bwein\b/.test(blob) &&
          /\b(fest|festival|markt|stände|staende|ausschank)\b/.test(blob) &&
          !/\b(straßenfest|strassenfest|landstraßen|landstrassen|stadtfest|weinprobe)\b/.test(
            blob,
          ))
      );
    case 'beer':
      return /\b(bierfest|bier\s*fest|oktoberfest|biergarten)\b/.test(blob);
    case 'street':
      return /\b(straßenfest|strassenfest|landstraßen|landstrassen|viertelfest|kiezfest|street\s*fest)\b/.test(
        blob,
      );
    case 'city':
      return /\b(stadtfest|stadt\s*fest|volksfest)\b/.test(blob);
    case 'music':
      return /\b(musikfest|music\s*fest|jazzfest|konzertfest|open[\s-]?air)\b/.test(
        blob,
      );
    case 'food':
      return /\b(food\s*fest|street\s*food|schlemmerfest|genussfest|kulinar)\b/.test(
        blob,
      );
    default:
      return true;
  }
}
