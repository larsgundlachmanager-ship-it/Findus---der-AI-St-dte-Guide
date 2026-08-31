/**
 * Run: npx --yes tsx src/services/discovery/nominatimCityLocale.smoke.test.ts
 */

import {
  nominatimLocaleForCity,
  isBerlinCityPackId,
  osmAdminNameForCity,
} from './nominatimCityLocale';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const londonId = nominatimLocaleForCity({ cityId: 'london', name: 'London' });
assert(londonId.countryCode === 'gb', 'london id → gb');
assert(
  /united kingdom/i.test(londonId.displayName),
  'london display enthält UK',
);

const londonCoords = nominatimLocaleForCity({
  cityId: 'unknown',
  name: 'London',
  lat: 51.507,
  lng: -0.128,
});
assert(londonCoords.countryCode === 'gb', 'London-Koordinaten → gb');

const prisdorf = nominatimLocaleForCity({
  cityId: 'prisdorf',
  name: 'Prisdorf',
  lat: 53.68,
  lng: 9.76,
});
assert(prisdorf.countryCode === 'de', 'Prisdorf → de');
assert(/germany/i.test(prisdorf.displayName), 'Prisdorf display Germany');

const berlinPack = nominatimLocaleForCity({
  cityId: 'berlin-zentral',
  name: 'Berlin Zentral',
  lat: 52.52,
  lng: 13.4,
});
assert(/^Berlin,/i.test(berlinPack.displayName), 'berlin-zentral → OSM Berlin');
assert(!/zentral/i.test(berlinPack.displayName), 'kein Produktname Zentral');
assert(isBerlinCityPackId('berlin-zentral'), 'berlin-zentral ist Berlin-Pack');
assert(!isBerlinCityPackId('berlin-umland'), 'Umland ist kein Stadt-Pack');
assert(
  osmAdminNameForCity({ cityId: 'berlin-zentral', name: 'Berlin Zentral' }) ===
    'Berlin',
  'OSM-Name Berlin',
);

const berlinUmland = nominatimLocaleForCity({
  cityId: 'berlin-umland',
  name: 'Berlin Umland',
});
assert(
  /umland/i.test(berlinUmland.displayName),
  'Umland-Pack bleibt Umland (keine Stadtfläche)',
);

console.log('nominatimCityLocale.smoke.test.ts OK');
