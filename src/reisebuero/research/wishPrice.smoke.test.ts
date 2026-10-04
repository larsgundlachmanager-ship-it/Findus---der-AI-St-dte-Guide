/**
 * Wish-Preis + Theater-Pin-Overlap — Node-smoke ohne RN.
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/wishPrice.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  formatVonBisEur,
  formatWishPriceLabel,
  mergePriceIntoLabel,
  parseCostRange,
} from './wishPrice';
import { deconflictPins, pinBoxOverlapRatio } from './theaterScene';

{
  assert.equal(formatVonBisEur(12, 25), 'von 12 bis 25 €');
  assert.equal(formatVonBisEur(20, 20), '20€');
  assert.equal(parseCostRange('Eintritt 15€').exact, 15);
  assert.equal(parseCostRange('von 10 bis 20 €').label, 'von 10 bis 20 €');
  assert.equal(parseCostRange('12–18€').min, 12);
  assert.equal(parseCostRange('12–18€').max, 18);
  assert.equal(
    formatWishPriceLabel({ priceMinEur: 15, priceMaxEur: 30 }),
    'von 15 bis 30 €',
  );
  assert.equal(formatWishPriceLabel({ priceEur: 22 }), '22€');
  assert.equal(mergePriceIntoLabel('Duplex', 'von 15 bis 30 €'), 'Duplex · von 15 bis 30 €');
  assert.ok(mergePriceIntoLabel('Duplex · 22€', '22€').includes('22'));
}

{
  const stacked = [
    { id: 'a', emoji: '📍', xPct: 50, yPct: 50, label: 'A' },
    { id: 'b', emoji: '🎶', xPct: 51, yPct: 51, label: 'B' },
    { id: 'c', emoji: '🎟️', xPct: 50.5, yPct: 50.5, label: 'C' },
  ];
  assert.ok(pinBoxOverlapRatio(stacked[0]!, stacked[1]!) > 0.2, 'stacked overlap high');
  const spaced = deconflictPins(stacked);
  for (let i = 0; i < spaced.length; i++) {
    for (let j = i + 1; j < spaced.length; j++) {
      const o = pinBoxOverlapRatio(spaced[i]!, spaced[j]!);
      assert.ok(o <= 0.2 + 1e-6, `overlap ${o} pins ${i}/${j}`);
    }
  }
}

console.log('wishPrice.smoke.test.ts: ok');
