/**
 * STT-Reparatur + Nav-Ziel für Kreuzfahrt / Mein Schiff / Cruise Center.
 * Android hört oft „Crew Center“ und „meinen Schiff“.
 */

export function repairCruiseVoiceText(text: string): string {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.replace(/\bcrew[\s-]*center\b/giu, 'Cruise Center');
  t = t.replace(/\bmein(?:en|em|e)\s+schiff\b/giu, 'Mein Schiff');
  // STT: „Adidia“ / „Aidia“ / „Aiida“ → AIDA
  t = t.replace(/\b(?:adidia|aidia|aiida)\b/giu, 'AIDA');
  return t.replace(/\s+/g, ' ').trim();
}

const CRUISE_CENTER_RE =
  /\b(?:cruise\s*center|kreuzfahrt(?:terminal|hafen)|einschiff(?:ungs)?(?:hafen|terminal)?)\b/iu;

const CRUISE_CTX_RE =
  /\b(?:mein\s+schiff|kreuzfahrt|aida|adidia|aidia|cruise|schiff)\b/iu;

const SEEK_RE =
  /\b(?:irgendwo|wo\s+(?:ist|liegt|finde)|muss\s+doch|find(?:e|en)?|zeig|bring|navigier|fahr|zum|zur|nach|hin)\b/iu;

const PORT_CITY_RE =
  /\b(Kiel|Hamburg|Warnemünde|Warnemuende|Rostock|Bremerhaven|Cuxhaven|Travemünde|Travemuende)\b/iu;

/** Grund-Satz nach dem Ziel — gehört nicht in den Ortsnamen. */
const PURPOSE_TAIL_RE =
  /\b(?:damit|hinterher|danach|weil|um\s+mein|wo\s+ich|mein(?:en|em|e)?\s+schiff|mit\s+dem\s+schiff|fahre\s+ich|fahren\s+kann|einschiffen)\b/iu;

/**
 * „Cruise Center … Kiel, damit wir mit mein Schiff fahren können“
 * → Geocode-Query „Cruise Center Kiel“, nie den ganzen Satz.
 * STT lässt „Center“ oft weg: „Cruise hinterher in Kiel damit … Schiff“.
 */
export function extractCruiseCenterNavDest(text: string): string | null {
  const t = repairCruiseVoiceText(text);
  if (!t) return null;
  const hasCenter = CRUISE_CENTER_RE.test(t);
  const cruiseWord = /\bcruise\b/iu.test(t);
  const cityHit = PORT_CITY_RE.test(t);
  const purpose = PURPOSE_TAIL_RE.test(t) || CRUISE_CTX_RE.test(t);
  // „Cruise hinterher in Kiel … Schiff“ zählt auch ohne das Wort Center.
  if (!hasCenter && !(cruiseWord && cityHit && purpose)) return null;
  if (!purpose && !hasCenter) return null;
  if (!SEEK_RE.test(t) && !/\bnach\s+[A-ZÄÖÜ]/u.test(t) && !purpose && !cityHit) {
    return null;
  }

  const cityRaw =
    t.match(/\b(?:nach|in|bei)\s+([A-ZÄÖÜ][a-zäöüß\-.]{2,})\b/u)?.[1] ||
    t.match(PORT_CITY_RE)?.[1] ||
    null;
  const city =
    cityRaw && !/cruise|center|schiff|kreuzfahrt|terminal|hafen|hinterher|damit/i.test(cityRaw)
      ? cityRaw
      : null;

  if (city && (/\bcruise\b/iu.test(t) || hasCenter)) return `Cruise Center ${city}`;
  if (city) return `Kreuzfahrtterminal ${city}`;
  if (/\bcruise\s*center\b/iu.test(t)) return 'Cruise Center';
  return 'Kreuzfahrtterminal';
}

export function looksLikeCruiseCenterNavAsk(text: string): boolean {
  return extractCruiseCenterNavDest(text) != null;
}

/** Hafenstadt aus „nach Kiel“ / Cruise-Center-Satz. */
export function cruisePortCityFromText(text: string): string | null {
  const t = repairCruiseVoiceText(text);
  const fromDest = extractCruiseCenterNavDest(t);
  const blob = `${fromDest || ''} ${t}`;
  const hit = blob.match(PORT_CITY_RE);
  return hit?.[1] || null;
}

export type CruiseTerminalPin = {
  name: string;
  lat: number;
  lng: number;
};

/**
 * Fester Liegeplatz — nicht den Füllsatz geocoden und nicht Ostufer/Fähre.
 * SSOT: cruiseTerminalAnchors.ts (alle Pack-Städte mit Terminal).
 */
export function cruiseTerminalPin(text: string): CruiseTerminalPin | null {
  const dest = extractCruiseCenterNavDest(text);
  if (!dest) return null;
  try {
    const {
      cruiseTerminalPinFromText,
    } = require('../cruiseTerminalAnchors') as {
      cruiseTerminalPinFromText: (t: string) => CruiseTerminalPin | null;
    };
    return cruiseTerminalPinFromText(`${repairCruiseVoiceText(text)} ${dest}`);
  } catch {
    return null;
  }
}

/** Für Detector-Regex: „Mein Schiff“ inkl. STT „meinen Schiff“. */
export const MEIN_SCHIFF_RE = /\bmein(?:en|em|e)?\s+schiff\b/iu;

/** AIDA inkl. STT-Verhörer „Adidia“ / „Aidia“. */
export const AIDA_LINE_RE = /\b(?:aida|adidia|aidia|aiida)\b/iu;
