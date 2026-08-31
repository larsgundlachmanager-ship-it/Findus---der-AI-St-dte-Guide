/**
 * Run: npx --yes tsx src/services/research/extractSpokenPrice.test.ts
 */
import { extractSpokenPriceEur } from './extractSpokenPrice';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  extractSpokenPriceEur('Tickets kosten circa 25,00 bis 29,37 Euro') ===
    '25–29,37 €',
  'range from speech',
);
assert(extractSpokenPriceEur('Eintritt 25 €') === '25 €', 'single euro');
assert(extractSpokenPriceEur('ohne Preis') === null, 'no invent');
assert(
  extractSpokenPriceEur('Tickets kosten circa 25,00 Euro') === '25 €',
  'single with euro word',
);

console.log('extractSpokenPrice.test.ts OK');
