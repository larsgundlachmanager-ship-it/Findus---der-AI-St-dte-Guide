/**
 * Run: npx --yes tsx src/module2/context/extractTravelCity.smoke.test.ts
 */

import {
  extractCityFromText,
  extractTravelCityFromText,
} from './shortTermContext';
import { destinationCityFromUtterance } from '../planning/planDestinationCity';
import { destinationSwitchSpeech } from '../../services/destinationCitySwitchSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  extractCityFromText('Hotel in Athen für zwei Nächte') === 'Athen',
  `athen hotel, got ${extractCityFromText('Hotel in Athen für zwei Nächte')}`,
);
assert(
  extractTravelCityFromText('ich suche ein Hotel in Athen') === 'Athen',
  'travel in athen',
);
assert(
  extractCityFromText('ich fliege morgen nach Athen') === 'Athen',
  'flight nach athen',
);
assert(
  extractCityFromText('Hotel in Hamburg für morgen Abend') === 'Hamburg',
  'known pack city still wins',
);
assert(
  extractCityFromText('in der Nähe ein Hotel') == null ||
    extractCityFromText('in der Nähe ein Hotel') !== 'Nähe',
  'nahe is not a city',
);
assert(
  extractTravelCityFromText(
    'Frühstück dann bei Ankunft, voraussichtlich ab 10 Uhr.',
  ) == null,
  'ankunft is not a city',
);
assert(
  extractCityFromText('Wie wird das Wetter heute? Regnet es?') == null,
  'regen is not a city',
);
assert(
  extractTravelCityFromText('regnet es heute noch') == null,
  'regnet travel false positive',
);
assert(
  extractCityFromText('Wetter in Athen heute') === 'Athen',
  'athen weather explicit city',
);
assert(
  destinationCityFromUtterance(
    'such mir ein Hotel in Athen',
    'Hamburg',
  ) === 'Athen',
  'dest athen vs hamburg gps',
);
assert(
  destinationCityFromUtterance('Hotel in Hamburg', 'Hamburg') == null,
  'same city is not dest',
);

const speech = destinationSwitchSpeech({
  cityName: 'Athen',
  activeName: 'Hamburg',
  firstName: 'Lars',
  intent: 'hotel',
});
assert(/lars/i.test(speech), 'speech uses first name');
assert(/athen/i.test(speech), 'speech names dest city');
assert(/wechsel|wechsle/i.test(speech), 'asks to switch');
assert(/hotel/i.test(speech), 'hotel intent in speech');

console.log('extractTravelCity.smoke.test.ts ok');
