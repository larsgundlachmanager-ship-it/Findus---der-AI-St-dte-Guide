/**
 * Voice-Follow-up für Affiliate-Buttons („Ja, buchen“, „Zeig mir das“).
 */

import type { QuickAction } from '../../types/concierge';
import { isPartnerAffiliateAction } from '../../constants/legal';

const BOOK_AFFIRM =
  /\b((ja|ok|okay|gerne|klar)[,.]?\s*)?(bitte\s+)?(buchen|buch\s+(das|mir|es)|buch(?:en)?\s+(?:den|die|das)\s+\w+)\b/iu;

const SHOW_AFFIRM =
  /\b(zeig(e)?(\s+mir)?(\s+(das|den\s+link|die\s+option))?|öffne(\s+(das|den\s+link))?|oeffne(\s+(das|den\s+link))?|link\s+öffnen|link\s+oeffnen)\b/iu;

const BARE_YES = /^(ja|jo|jap|jep|yes|yep|ok|okay|gerne|klar|bitte)[.!]?\s*$/iu;

export function isAffiliateBookAffirmation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (BOOK_AFFIRM.test(t)) return true;
  if (SHOW_AFFIRM.test(t)) return true;
  return false;
}

/**
 * Bare „Ja“ nur akzeptieren, wenn kein Nav-Offer parallel wartet
 * (Nav-„Ja“ hat Vorrang in useVoiceInput).
 */
export function shouldAcceptPendingAffiliateOffer(
  text: string,
  offer: QuickAction | null,
  hasPendingNavOffer: boolean,
): boolean {
  if (!offer || !isPartnerAffiliateAction(offer)) return false;
  if (isAffiliateBookAffirmation(text)) return true;
  if (!hasPendingNavOffer && BARE_YES.test(text.trim())) return true;
  return false;
}

/** Primäre Partner-Action für Voice-Follow-up merken. */
export function pickPendingAffiliateOffer(
  actions: QuickAction[],
): QuickAction | null {
  const partner = actions.find((a) => isPartnerAffiliateAction(a));
  return partner ?? null;
}
