/**
 * Supermarkt-Prospekt — Query + Hollow-URL (analog Speisekarte/Spielplan).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/research/supermarketProspectResearch.smoke.test.ts
 */

import {
  extractSupermarketOfferHints,
  isHollowProspectUrl,
  isSupermarketOfferQuery,
} from './supermarketProspectGates';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isSupermarketOfferQuery('Wo ist aktuell Bier im Angebot?'),
  'beer offer query',
);
assert(
  isSupermarketOfferQuery('Milch und Butter irgendwo im Angebot?'),
  'multi product offer',
);
assert(
  isSupermarketOfferQuery('Bierpreise im Supermarkt'),
  'product prices at market',
);
assert(
  isSupermarketOfferQuery('Was gibt es für Bier im Angebot?'),
  'was gibt es bier angebot',
);
assert(!isSupermarketOfferQuery('Wie wird das Wetter?'), 'weather not offer');
assert(
  !isSupermarketOfferQuery('Irgendwo warm hinfliegen'),
  'travel irgendwo not offer',
);

const hints = extractSupermarketOfferHints('Wo ist aktuell Bier im Angebot?');
assert(hints.productHints.some((p) => /bier/i.test(p)), 'product bier');

const priceHints = extractSupermarketOfferHints('Bierpreise im Supermarkt');
assert(
  priceHints.productHints.some((p) => p === 'bier'),
  'bierpreise → product bier',
);

assert(isHollowProspectUrl('https://www.rewe.de/'), 'rewe home hollow');
assert(isHollowProspectUrl('https://www.lidl.de'), 'lidl home hollow');
assert(
  !isHollowProspectUrl('https://www.rewe.de/angebote/bier'),
  'rewe angebot deep',
);
assert(
  !isHollowProspectUrl('https://www.kaufda.de/prospekte/lidl-flyer-123'),
  'kaufda flyer deep',
);
assert(
  !isHollowProspectUrl('https://cdn.example.com/wochenprospekt.pdf'),
  'pdf deep',
);

console.log('supermarketProspectResearch.smoke.test.ts ok');
