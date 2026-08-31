/**
 * Taxi / Uber / Ride-Hail — Intent + Ziel, stadt-agnostisch.
 * Kein ÖPNV, kein alter Thread. Code-Spiegel: classifyJob + mobilityAgent.
 */

const TAXI_RE =
  /\b(taxi|taxistand|taxizentrale|taxifahrer|mietwagen\s+mit\s+fahrer)\b/iu;
const RIDE_HAIL_RE = /\b(uber|bolt|freenow|free\s*now)\b/iu;
const CALL_TAXI_RE =
  /\b(?:ruf(?:e|en)?|bestell(?:e|en)?|hol(?:e|en)?|organisier(?:e|en)?)\s+(?:mir\s+)?(?:bitte\s+)?(?:ein(?:en)?\s+)?(?:taxi|uber)|(?:taxi|uber)\s+(?:rufen|bestellen|holen|organisieren)\b/iu;

export function wantsTaxiRide(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(uber\s*eats|eats\b|lieferung|liefern\s+lassen)\b/iu.test(t)) {
    return false;
  }
  // Flug-Satz mit Taxi = Anreise-Präferenz, kein Taxi-Hail.
  if (
    /\b(flieg(?:e|st|t)?|fliegen|flug|flieger|abflug)\b/iu.test(t) &&
    /\b(nach|richtung)\s+[A-Za-zÄÖÜäöüß]/iu.test(t)
  ) {
    return false;
  }
  if (CALL_TAXI_RE.test(t)) return true;
  if (TAXI_RE.test(t)) return true;
  if (
    RIDE_HAIL_RE.test(t) &&
    /\b(zum|zur|nach|rufen|bestellen|fahrt|fahr\s+mich|bring\s+mich)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** Neues konkretes Ziel im Satz — nicht Anapher auf den alten Thread. */
export function looksLikeNewConcreteDestination(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  if (wantsTaxiRide(t)) return true;
  try {
    const { looksLikeStreetAddress } = require('../navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
    };
    if (looksLikeStreetAddress(t)) return true;
    const { looksLikeSpokenCityCorrection } = require('../navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    if (looksLikeSpokenCityCorrection(t)) return true;
  } catch {
    /* soft */
  }
  return /\b(?:zum|zur|nach|bis)\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜa-zäöüß-]{2,}){0,5}\b/.test(
    t,
  );
}

export function extractTaxiDestName(text: string): string {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const first =
    raw.match(
      /\b(?:zu(?:m|r)?|nach)\s+(.+?)(?:\s*[.?!]|$)/i,
    )?.[1] ||
    raw.match(
      /\b(?:taxi|uber|bolt|freenow)\s+(?:zu(?:m|r)?|nach|für|fuer)\s+(.+?)(?:\s*[.?!]|$)/i,
    )?.[1] ||
    '';
  let name = first.replace(/\s+/g, ' ').trim();
  name = name
    .replace(
      /\b(?:kannst\s+du|bitte|gerne|jetzt|ein\s+taxi|dafür|dafuer|rufen|bestellen|organisieren|hol(?:en)?).*$/iu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || /^(dahin|dorthin|dort|da|hin)$/iu.test(name)) {
    return '';
  }
  return name.slice(0, 80);
}
