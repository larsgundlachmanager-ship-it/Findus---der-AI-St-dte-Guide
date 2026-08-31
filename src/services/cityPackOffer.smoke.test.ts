/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityPackOffer.smoke.test.ts
 */
import { isPlausibleSoftCityName } from './softCityName';
import {
  extractCityFromText,
  extractTravelCityFromText,
} from '../module2/context/shortTermContext';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(!isPlausibleSoftCityName('Mit Pool Und'), 'Mit Pool Und ≠ Stadt');
assert(!isPlausibleSoftCityName('Pool und Sauna'), 'Pool ≠ Stadt');
assert(!isPlausibleSoftCityName('mit Frühstück'), 'Frühstück ≠ Stadt');
assert(isPlausibleSoftCityName('Lissabon'), 'Lissabon ok');
assert(isPlausibleSoftCityName('Athen'), 'Athen ok');
assert(isPlausibleSoftCityName('Bad Homburg'), 'Bad Homburg ok');

assert(
  extractTravelCityFromText('Hotel mit Pool und Sauna unter 500 Euro') == null,
  'Hotel mit Pool ≠ Stadt',
);
assert(
  extractCityFromText('Hotel mit Pool und Sauna unter 500 Euro') == null,
  'extractCity Hotel mit Pool ≠ Stadt',
);
assert(
  extractCityFromText('Hotel in Lissabon mit Pool') === 'Lissabon',
  'Hotel in Lissabon',
);

console.log('cityPackOffer.smoke.test.ts ok');
