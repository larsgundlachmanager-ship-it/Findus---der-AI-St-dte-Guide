/**
 * Preis vs. Provision — reine Wahl, kein RN.
 *
 * - Explizit günstigste → min(Preis), auch ohne Cut.
 * - Nie >15 % über dem Günstigsten.
 * - Innerhalb 5 % → höchste erwartete Provision.
 */

export type DeepLinkLevel = 'search' | 'category' | 'deep';

export type AffiliateOfferCandidate = {
  id: string;
  label: string;
  url: string;
  /** 0–100; 0 = keine Provision */
  commissionScore: number;
  deepLinkLevel: DeepLinkLevel;
  partnerPriceEur?: number | null;
  /** Gleiches Produkt+Datum+Pax. Unterschiedlich → kein Preisvergleich. */
  identity?: string | null;
};

export const AFFILIATE_COMMISSION_TIE_BAND = 0.05;
export const AFFILIATE_MAX_PRICE_DELTA = 0.15;

export type PickAffiliateOfferOpts = {
  userWantsCheapest?: boolean;
};

function livePrice(c: AffiliateOfferCandidate): number | null {
  const n = c.partnerPriceEur;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function expectedEarn(c: AffiliateOfferCandidate, price: number): number {
  return price * (Math.max(0, c.commissionScore) / 100);
}

function byCommission(candidates: AffiliateOfferCandidate[]): AffiliateOfferCandidate | null {
  return (
    [...candidates].sort((a, b) => b.commissionScore - a.commissionScore)[0] ??
    null
  );
}

/**
 * Preisvergleich nur innerhalb derselben Identity.
 * Gemischte Slugs/Daten oder nur ein bepreister Partner → kein Vergleich.
 */
function comparablePricePool(
  candidates: AffiliateOfferCandidate[],
): AffiliateOfferCandidate[] | null {
  const withId = candidates.filter((c) => String(c.identity || '').trim());
  if (withId.length === 0) return candidates;
  const groups = new Map<string, AffiliateOfferCandidate[]>();
  for (const c of withId) {
    const k = String(c.identity);
    const list = groups.get(k) ?? [];
    list.push(c);
    groups.set(k, list);
  }
  const comparable = [...groups.values()].filter(
    (g) => g.filter((c) => livePrice(c) != null).length >= 2,
  );
  if (!comparable.length) return null;
  return comparable.sort((a, b) => b.length - a.length)[0]!;
}

export function pickAffiliateOffer(
  candidates: AffiliateOfferCandidate[],
  opts?: PickAffiliateOfferOpts,
): AffiliateOfferCandidate | null {
  if (!candidates.length) return null;
  const pool = comparablePricePool(candidates);
  if (!pool) {
    const withId = candidates.filter((c) => String(c.identity || '').trim());
    const groups = new Map<string, AffiliateOfferCandidate[]>();
    for (const c of withId) {
      const k = String(c.identity);
      const list = groups.get(k) ?? [];
      list.push(c);
      groups.set(k, list);
    }
    for (const g of groups.values()) {
      const priced = g.filter((c) => livePrice(c) != null);
      if (priced.length === 1 && g.length >= 2) return priced[0]!;
    }
    return byCommission(candidates);
  }
  const withPrice = pool.filter((c) => livePrice(c) != null);
  if (withPrice.length < 2) {
    return byCommission(candidates);
  }

  const priced = [...withPrice].sort(
    (a, b) => (livePrice(a) ?? 0) - (livePrice(b) ?? 0),
  );
  const cheapest = priced[0]!;
  const floor = livePrice(cheapest)!;
  if (opts?.userWantsCheapest) return cheapest;

  const withinCap = priced.filter((c) => {
    const p = livePrice(c)!;
    return (p - floor) / floor <= AFFILIATE_MAX_PRICE_DELTA + 1e-9;
  });
  const capped = withinCap.length ? withinCap : [cheapest];
  const poolFloor = livePrice(capped[0]!)!;
  const inTie = capped.filter((c) => {
    const p = livePrice(c)!;
    return (p - poolFloor) / poolFloor <= AFFILIATE_COMMISSION_TIE_BAND + 1e-9;
  });
  const band = inTie.length ? inTie : capped;
  return (
    [...band].sort((a, b) => {
      const pa = livePrice(a)!;
      const pb = livePrice(b)!;
      const ea = expectedEarn(a, pa);
      const eb = expectedEarn(b, pb);
      if (eb !== ea) return eb - ea;
      if (b.commissionScore !== a.commissionScore) {
        return b.commissionScore - a.commissionScore;
      }
      return pa - pb;
    })[0] ?? cheapest
  );
}
