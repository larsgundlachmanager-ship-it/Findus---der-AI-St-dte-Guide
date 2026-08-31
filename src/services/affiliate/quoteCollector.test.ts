/**
 * Run: npx --yes tsx src/services/affiliate/quoteCollector.test.ts
 */
import { pickAffiliateOffer } from './affiliatePickOffer';
import {
  flightIdentity,
  hotelIdentity,
  ticketIdentity,
  ticketProductKey,
  userWantsCheapest,
} from './quoteIdentity';
import { parseOfferPriceFromHtml, parseEurNumber } from './quotePriceParse';
import { collectQuotes, pickQuotedTicket } from './quoteCollector';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(userWantsCheapest('Zeig mir das Günstigste'), 'günstigste');
assert(userWantsCheapest('billigste Tickets'), 'billigste');
assert(!userWantsCheapest('ein gutes Hotel'), 'nicht jedes günstig');

const gyg =
  'https://www.getyourguide.com/berlin-l17/reichstag-t181448/';
const gygOther =
  'https://www.getyourguide.com/berlin-l17/fernsehturm-t999111/';
const tiq =
  'https://www.tiqets.com/de/berlin-attractions-c12/reichstag-p975704/';

assert(ticketProductKey(gyg) === 'gyg:181448', ticketProductKey(gyg));
assert(ticketProductKey(tiq) === 'tiqets:975704', ticketProductKey(tiq) ?? '');
assert(
  ticketIdentity({ url: gyg, dateIso: '2026-08-21', adults: 2 }) ===
    'ticket:gyg:181448:2026-08-21:2',
  'ticket identity',
);
assert(
  ticketIdentity({ url: gyg, dateIso: '2026-08-21', adults: 2 }) !==
    ticketIdentity({ url: gygOther, dateIso: '2026-08-21', adults: 2 }),
  'andere Slugs nicht vergleichen',
);
assert(
  ticketIdentity({ url: gyg, dateIso: '2026-08-21', adults: 2 }) !==
    ticketIdentity({ url: gyg, dateIso: '2026-08-22', adults: 2 }),
  'anderes Datum nicht vergleichen',
);

assert(
  hotelIdentity({
    propertyId: '12345',
    city: 'Berlin',
    checkin: '2026-08-21',
    checkout: '2026-08-22',
    adults: 2,
  }) === 'hotel:id:12345:berlin:2026-08-21:2026-08-22:2',
  'hotel identity',
);
assert(
  flightIdentity({
    fromIata: 'HAM',
    toIata: 'AYT',
    dateIso: '2026-10-14',
    adults: 1,
  }) === 'flight:HAM:AYT:2026-10-14:1',
  'flight identity',
);

const sameId = ticketIdentity({ url: gyg, dateIso: '2026-08-21', adults: 2 });
const mismatch = pickAffiliateOffer([
  {
    id: 'gyg',
    label: 'gyg',
    url: gyg,
    commissionScore: 65,
    deepLinkLevel: 'deep',
    partnerPriceEur: 40,
    identity: sameId,
  },
  {
    id: 'tower',
    label: 'tower',
    url: gygOther,
    commissionScore: 65,
    deepLinkLevel: 'deep',
    partnerPriceEur: 10,
    identity: ticketIdentity({
      url: gygOther,
      dateIso: '2026-08-21',
      adults: 2,
    }),
  },
]);
assert(
  mismatch?.id === 'gyg',
  `verschiedene Slugs → kein Preisvergleich, Score: ${mismatch?.id}`,
);

const sameProduct = pickAffiliateOffer([
  {
    id: 'gyg',
    label: 'gyg',
    url: gyg,
    commissionScore: 65,
    deepLinkLevel: 'deep',
    partnerPriceEur: 110,
    identity: sameId,
  },
  {
    id: 'tiqets',
    label: 'tiqets',
    url: tiq,
    commissionScore: 74,
    deepLinkLevel: 'deep',
    partnerPriceEur: 104,
    identity: sameId,
  },
]);
assert(sameProduct?.id === 'tiqets', `gleiche Identity 5%: ${sameProduct?.id}`);

const html = `<html><script type="application/ld+json">{"@type":"Offer","price":"29.50","priceCurrency":"EUR"}</script></html>`;
assert(parseOfferPriceFromHtml(html) === 29.5, 'json-ld price');
assert(parseEurNumber('ab 12,00 €') === 12, 'parse eur');

const ldHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
  {
    '@type': 'Product',
    offers: { '@type': 'Offer', price: '42', priceCurrency: 'EUR' },
  },
)}</script></head></html>`;

async function main(): Promise<void> {
  const quoted = await pickQuotedTicket(
    [
      { url: gyg, html: ldHtml },
      {
        url: 'https://www.tiqets.com/de/x-p975704/',
        priceEur: 40,
      },
    ],
    {
      dateIso: '2026-08-21',
      adults: 2,
      fetchHtml: async () => {
        throw new Error('should not fetch when html/price given');
      },
    },
  );
  assert(quoted != null, 'quoted winner');

  const timedOut = await collectQuotes(
    [
      {
        id: 'dead',
        url: gyg,
        commissionScore: 90,
        identity: sameId,
      },
      {
        id: 'live',
        url: 'https://www.tiqets.com/de/x-p975704/',
        commissionScore: 74,
        priceEur: 40,
        identity: sameId,
      },
    ],
    {
      timeoutMs: 50,
      fetchHtml: () => new Promise(() => {}),
    },
  );
  const live = timedOut.find((c) => c.id === 'live');
  const dead = timedOut.find((c) => c.id === 'dead');
  assert(live?.partnerPriceEur === 40, 'lebende Quelle behält Preis');
  assert(dead?.partnerPriceEur == null, 'Timeout = kein Preis');
  const afterTimeout = pickAffiliateOffer(timedOut);
  assert(
    afterTimeout?.id === 'live',
    `Timeout → andere gewinnt: ${afterTimeout?.id}`,
  );

  console.log('quoteCollector.test.ts OK');
}

void main();
