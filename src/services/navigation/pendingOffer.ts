import type { PendingNavOffer } from './navigationTypes';
import {
  isPoiInfoQuestion,
  isExplicitNavIntent,
} from '../intent/poiInfoVsNav';
import { isStopOrClearNavigationIntent } from './hardNavOverride';

const AFFIRM =
  /^(ja|jo|jap|jep|yes|yep|ok|okay|klar|gerne|los|zeig|zeige|bring|führ|fuehr|mach|natürlich|natuerlich|schon|sicher|mach\s+(ihn|den|mir)|anmachen|den\s+ersten|die\s+erste|option\s*1|nummer\s*1)(?:\s+bitte)?\s*[.!]?$/iu;

const NAV_INTENT =
  /\b(zeig(?:e| mir)?|bring(?: mich)?|führ(?: mich)?|fuehr(?: mich)?|navigier|navigation|kompass|bahnsteig|hin|dort|dahin|komm|anmachen|nehmen\s+wir)\b/iu;

export function isNavAffirmation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isStopOrClearNavigationIntent(t)) return false;
  if (isPoiInfoQuestion(t)) return false;
  // „Bring mich zum Bäcker/Aldi/…“ = neues Ziel, keine Ja-Bestätigung des Pending-Offers
  if (
    isExplicitNavIntent(t) &&
    /\b(zum|zur|nach|zu|ins)\s+\S{3,}/iu.test(t)
  ) {
    return false;
  }
  if (AFFIRM.test(t)) return true;
  // Kurze Follow-ups („zeig mir“, „navigier dahin“) — keine langen neuen Aufträge
  if (NAV_INTENT.test(t) && t.length < 36) return true;
  return false;
}

export function isStopNavigationIntent(text: string): boolean {
  return isStopOrClearNavigationIntent(text);
}

function nameMatchesOffer(text: string, offer: PendingNavOffer): boolean {
  const t = text.toLowerCase();
  const name = offer.name.toLowerCase();
  const tokens = name
    .split(/[\s,\-/]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
  if (tokens.some((tok) => t.includes(tok))) return true;
  const first = tokens[0];
  if (first && first.length >= 4 && t.includes(first)) return true;
  return false;
}

/**
 * „Ja“ → Primary-Offer; Namensnennung → Offer.
 * POI_INFO (Wann/Gibt es/…) NEVER confirms nav via name alone.
 */
export function resolveNavOfferFromReply(
  text: string,
  primary: PendingNavOffer | null,
  alternatives: PendingNavOffer[] = [],
): PendingNavOffer | null {
  if (!primary && alternatives.length === 0) return null;
  const t = text.trim();
  if (isPoiInfoQuestion(t)) return null;

  const all = [
    ...(primary ? [primary] : []),
    ...alternatives.filter((a) => a.poiId !== primary?.poiId),
  ];

  // Explizite Nav mit neuem Ziel → Pending-Offer nie stehlen
  if (
    isExplicitNavIntent(t) &&
    /\b(zum|zur|nach|zu|ins)\s+\S{3,}/iu.test(t) &&
    !all.some((o) => nameMatchesOffer(t, o))
  ) {
    return null;
  }

  for (const offer of all) {
    if (!nameMatchesOffer(t, offer)) continue;
    // Short pick ("Hanken") or explicit go / affirmation — not long fact questions
    if (t.length < 36 || isNavAffirmation(t) || isExplicitNavIntent(t)) {
      return offer;
    }
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
  if (isPoiInfoQuestion(text)) return false;
  return resolveNavOfferFromReply(text, offer, alternatives) != null;
}
