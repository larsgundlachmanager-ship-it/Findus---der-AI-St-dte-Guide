import type { PendingNavOffer } from './navigationTypes';

const AFFIRM =
  /^(ja|jo|jap|jep|yes|yep|ok|okay|klar|gerne|los|zeig|zeige|bring|führ|fuehr|mach|natürlich|natuerlich|bitte|schon|sicher|mach\s+(ihn|den|mir)|anmachen|den\s+ersten|die\s+erste|option\s*1|nummer\s*1)\b/iu;

const NAV_INTENT =
  /\b(zeig(e| mir)?|bring( mich)?|führ( mich)?|fuehr( mich)?|navigier|navigation|kompass|bahnsteig|hin|dort|dahin|sehen|schauen|komm|anmachen|nehmen\s+wir)\b/iu;

const STOP_NAV =
  /\b(stopp|stop|abbrechen|abbruch|navigation (beenden|aus|stopp)|genug|lass mal)\b/iu;

export function isNavAffirmation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (STOP_NAV.test(t)) return false;
  if (AFFIRM.test(t)) return true;
  if (NAV_INTENT.test(t) && t.length < 80) return true;
  return false;
}

export function isStopNavigationIntent(text: string): boolean {
  return STOP_NAV.test(text.trim());
}

function nameMatchesOffer(text: string, offer: PendingNavOffer): boolean {
  const t = text.toLowerCase();
  const name = offer.name.toLowerCase();
  const tokens = name
    .split(/[\s,\-/]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
  if (tokens.some((tok) => t.includes(tok))) return true;
  // Kurzname: erstes Wort
  const first = tokens[0];
  if (first && first.length >= 4 && t.includes(first)) return true;
  return false;
}

/**
 * „Ja“ → Primary-Offer; Namensnennung → passendes Offer inkl. Alternativen.
 */
export function resolveNavOfferFromReply(
  text: string,
  primary: PendingNavOffer | null,
  alternatives: PendingNavOffer[] = [],
): PendingNavOffer | null {
  if (!primary && alternatives.length === 0) return null;
  const t = text.trim();
  const all = [
    ...(primary ? [primary] : []),
    ...alternatives.filter((a) => a.poiId !== primary?.poiId),
  ];

  for (const offer of all) {
    if (nameMatchesOffer(t, offer)) return offer;
  }

  if (/\b(zweite|zweiter|option\s*2|nummer\s*2|den\s+anderen)\b/iu.test(t)) {
    return alternatives[0] ?? null;
  }
  if (/\b(dritte|option\s*3|nummer\s*3)\b/iu.test(t)) {
    return alternatives[1] ?? null;
  }

  if (primary && isNavAffirmation(t)) return primary;
  return null;
}

export function shouldStartNavFromOffer(
  text: string,
  offer: PendingNavOffer | null,
  alternatives: PendingNavOffer[] = [],
): boolean {
  return resolveNavOfferFromReply(text, offer, alternatives) != null;
}
