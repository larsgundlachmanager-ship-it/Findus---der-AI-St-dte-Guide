/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/research/rentalPriceFromWebsite.smoke.test.ts
 */
import {
  extractRentalPricesFromText,
  bestRentalPriceLabel,
} from './rentalPriceFromWebsite';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const sample = `
  SUP Verleih Hamburg Alster
  Preise: Board 20 € / 2 Stunden, 30 € / 3 Stunden.
  Ab 15 € pro Stunde fürs Stand-up-Paddle.
`;

const hits = extractRentalPricesFromText(sample);
assert(hits.length >= 1, `expected prices, got ${hits.length}`);
assert(
  hits.some((h) => h.amountEur === 20 && h.hours === 2),
  `missing 20€/2h: ${JSON.stringify(hits)}`,
);
assert(
  bestRentalPriceLabel(sample)?.includes('€') === true,
  'best label needs euro',
);

assert(
  extractRentalPricesFromText('Schönes Wetter am See, keine Preise hier.').length ===
    0,
  'no fake prices',
);

const flipped = extractRentalPricesFromText('Miete: 2 Stunden 25 Euro inkl. Weste');
assert(
  flipped.some((h) => h.amountEur === 25 && h.hours === 2),
  `flipped hours-first failed: ${JSON.stringify(flipped)}`,
);

console.log('rentalPriceFromWebsite.smoke.test.ts ok');
