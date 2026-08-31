/**
 * Run: npx --yes tsx src/services/homeMap/placeSeekSearch.smoke.test.ts
 */

import type { Poi } from '../../db/types';
import {
  formatSeekDistanceM,
  looksLikeStreetAddress,
  poiMatchesSeekQuery,
  shouldFetchPlaceSeekRemote,
} from './placeSeekSearch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(formatSeekDistanceM(180) === '180 m', 'Meter unter 1 km');
assert(formatSeekDistanceM(2400) === '2,4 km', 'Kilometer mit Komma');

assert(looksLikeStreetAddress('Ulmenallee 23'), 'Straße + Hausnummer');
assert(looksLikeStreetAddress('Holstenstraße 12a'), 'Straße mit Buchstabe');
assert(!looksLikeStreetAddress('Lasertag'), 'Ort-Stichwort ist keine Adresse');
assert(!looksLikeStreetAddress('ab'), 'zu kurz');

const bakery = {
  id: 1,
  name: 'Bäckerei Hansen',
  lat: 53.55,
  lng: 9.99,
  radius_meters: 40,
  spot_key: 'b',
  parent_poi_id: null,
  kind: 'area',
  category: 'café',
  tags_json: '["directory"]',
  polygon_json: null,
  teaser_text: 'Franzbrötchen und Kornspitz ab 6 Uhr.',
  condition_rule: 'always',
  special_radius_m: null,
} as Poi;

assert(poiMatchesSeekQuery(bakery, 'franzbrötchen'), 'Angebot im Teaser');
assert(poiMatchesSeekQuery(bakery, 'Hansen'), 'Name');
assert(!poiMatchesSeekQuery(bakery, 'Lasertag'), 'kein Treffer');

assert(
  !shouldFetchPlaceSeekRemote({
    query: 'Ulmenallee 23',
    localHits: 1,
    hasAddressHit: true,
  }),
  'lokale Adresse → kein Nominatim',
);
assert(
  shouldFetchPlaceSeekRemote({
    query: 'Lasertag',
    localHits: 0,
    hasAddressHit: false,
  }),
  'Index-Miss → Remote',
);

console.log('placeSeekSearch.smoke.test.ts OK');
