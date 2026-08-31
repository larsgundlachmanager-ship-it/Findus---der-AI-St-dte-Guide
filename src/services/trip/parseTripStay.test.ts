/**
 * Quick self-check: npx --yes tsx src/services/trip/parseTripStay.test.ts
 */
import {
  looksLikeTripStayOnly,
  parseTripStayUtterance,
} from './parseTripStay';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const a = parseTripStayUtterance('Ich fliege 4 Tage nach München');
assert(a?.dayCount === 4, '4 Tage München');
assert(a?.cityName?.toLowerCase().includes('münchen') || a?.cityName?.toLowerCase().includes('munchen'), 'city München');

const b = parseTripStayUtterance('Wochenende in Lübeck');
assert(b?.dayCount === 2, 'Wochenende = 2');
assert(/lübeck|lubeck/i.test(b?.cityName ?? ''), 'Lübeck');

const c = parseTripStayUtterance('Tagestrip Hamburg');
assert(c?.dayCount === 1, 'Tagestrip');

const d = parseTripStayUtterance('München für vier Tage');
assert(d?.dayCount === 4, 'für vier Tage');

assert(looksLikeTripStayOnly('4 Tage München'), 'stay only');
assert(
  !looksLikeTripStayOnly(
    '4 Tage München und dann Frühstück Meeting und Abendessen und Party',
  ),
  'chaos not stay-only',
);

assert(
  parseTripStayUtterance('in 4 Tagen zum Arzt') == null,
  'offset ≠ Aufenthalt',
);

console.log('parseTripStay.test.ts OK');
