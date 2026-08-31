/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/context/travelCityExtract.smoke.test.ts
 */
import {
  extractCityFromText,
  extractTravelCityFromText,
} from './shortTermContext';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  extractCityFromText(
    'In zwei Wochen moechte ich ein Wochenende nach Lissabon',
  ) === 'Lissabon',
  'Lissabon erkannt',
);
assert(
  extractTravelCityFromText('Hotel mit Pool und Sauna unter 500 Euro') == null,
  'Hotel mit Pool ≠ Stadt',
);
assert(
  extractCityFromText('Hotel mit Pool und Sauna unter 500 Euro') == null,
  'extractCity Hotel mit Pool ≠ Stadt',
);
assert(
  extractTravelCityFromText('Hotel in Lissabon mit Pool') === 'Lissabon',
  'Hotel in Lissabon',
);
assert(
  extractCityFromText('Finde einen Flug nach London') === 'London',
  'London',
);

console.log('travelCityExtract.smoke.test.ts ok');
