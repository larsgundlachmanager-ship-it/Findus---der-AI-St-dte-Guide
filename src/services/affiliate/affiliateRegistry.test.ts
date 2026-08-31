/**
 * Run: npx --yes tsx src/services/affiliate/affiliateRegistry.test.ts
 */
import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from './affiliatePickOffer';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function c(
  id: string,
  price: number,
  commissionScore: number,
): AffiliateOfferCandidate {
  return {
    id,
    label: id,
    url: `https://example.test/${id}`,
    commissionScore,
    deepLinkLevel: 'deep',
    partnerPriceEur: price,
  };
}

const cheapNoCut = c('direct', 100, 0);
const affiliate104 = c('tiqets', 104, 74);
const affiliate110 = c('gyg', 110, 90);
const affiliate121 = c('vip', 121, 99);

const withinFive = pickAffiliateOffer([cheapNoCut, affiliate104]);
assert(withinFive?.id === 'tiqets', `≤5% → Provision: ${withinFive?.id}`);

const mid = pickAffiliateOffer([cheapNoCut, affiliate110]);
assert(mid?.id === 'direct', `10% → User-Preis: ${mid?.id}`);

const over = pickAffiliateOffer([cheapNoCut, affiliate121]);
assert(over?.id === 'direct', `>15% → auch ohne Cut: ${over?.id}`);

const cheapestAsk = pickAffiliateOffer([cheapNoCut, affiliate104], {
  userWantsCheapest: true,
});
assert(cheapestAsk?.id === 'direct', 'explizit günstigste');

const twoCuts = pickAffiliateOffer([
  c('a', 100, 50),
  c('b', 103, 80),
]);
assert(twoCuts?.id === 'b', `in 5%-Band höherer Cut: ${twoCuts?.id}`);

const noPrice = pickAffiliateOffer([
  { ...c('x', 0, 40), partnerPriceEur: null },
  { ...c('y', 0, 82), partnerPriceEur: null },
]);
assert(noPrice?.id === 'y', 'ohne Live-Preis → höherer Score');

const idA = 'ticket:gyg:1:2026-08-21:2';
const idB = 'ticket:gyg:2:2026-08-21:2';
const mixedId = pickAffiliateOffer([
  { ...c('cheap-other', 10, 40), identity: idB },
  { ...c('gyg', 100, 90), identity: idA },
]);
assert(
  mixedId?.id === 'gyg',
  `Identity-Mismatch kein Preisvergleich: ${mixedId?.id}`,
);

console.log('affiliatePickOffer.test.ts OK');
