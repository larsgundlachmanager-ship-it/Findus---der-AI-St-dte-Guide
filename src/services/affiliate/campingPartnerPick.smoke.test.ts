/**
 * Camping partner pick — rein, ohne RN.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/affiliate/campingPartnerPick.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from './affiliatePickOffer';

const identity = 'camping:bretagne:test:2026-07-01_2026-07-05';

const samePrice: AffiliateOfferCandidate[] = [
  {
    id: 'camping_info',
    label: 'camping.info',
    url: 'https://www.camping.info/de/search?q=Bretagne',
    commissionScore: 71,
    deepLinkLevel: 'search',
    partnerPriceEur: 200,
    identity,
  },
  {
    id: 'camping_and_co',
    label: 'Camping-and-Co',
    url: 'https://de.camping-and-co.com/?q=Bretagne',
    commissionScore: 88,
    deepLinkLevel: 'search',
    partnerPriceEur: 200,
    identity,
  },
];

const samePick = pickAffiliateOffer(samePrice);
assert.equal(samePick?.id, 'camping_and_co', 'gleicher Preis → höhere Provision');

const cheaperInfo: AffiliateOfferCandidate[] = [
  {
    ...samePrice[0]!,
    partnerPriceEur: 150,
  },
  {
    ...samePrice[1]!,
    partnerPriceEur: 200,
  },
];
const cheapPick = pickAffiliateOffer(cheaperInfo);
assert.equal(cheapPick?.id, 'camping_info', 'klar günstiger → Preis gewinnt');

const noPrice = pickAffiliateOffer(
  samePrice.map((c) => ({ ...c, partnerPriceEur: null })),
);
assert.equal(
  noPrice?.id,
  'camping_and_co',
  'ohne Preis → höhere commissionScore',
);

console.log('campingPartnerPick.smoke.test.ts: ok');
