/**
 * prefer_affiliate_if_same_offer — Userwunsch vor Monetisierung.
 */

export function preferAffiliateIfSameOffer(opts: {
  affiliateUrl: string | null | undefined;
  directUrl: string | null | undefined;
  /** true wenn Partner dasselbe Angebot/Fenster abbildet */
  sameOffer: boolean;
}): string | null {
  const aff = String(opts.affiliateUrl || '').trim();
  const direct = String(opts.directUrl || '').trim();
  if (opts.sameOffer && aff.startsWith('http')) return aff;
  if (direct.startsWith('http')) return direct;
  if (aff.startsWith('http')) return aff;
  return null;
}
