/**
 * Run: npx --yes tsx src/services/homeMap/searchCityIndex.smoke.test.ts
 */

import type { Poi } from '../../db/types';
import { lookupOfflineAddress, searchCityIndex } from './searchCityIndex';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const steak = {
  id: 11,
  name: 'Grillhaus Nord',
  lat: 53.68,
  lng: 9.76,
  radius_meters: 40,
  spot_key: 'g',
  parent_poi_id: null,
  kind: 'area',
  category: 'restaurant',
  tags_json: '["directory","steak"]',
  polygon_json: null,
  teaser_text: 'Gäste erwähnen regelmäßig Steak.',
  condition_rule: 'always',
  special_radius_m: null,
} as Poi;

const cafe = {
  id: 12,
  name: 'Café Mühle',
  lat: 53.681,
  lng: 9.761,
  radius_meters: 30,
  spot_key: 'c',
  parent_poi_id: null,
  kind: 'area',
  category: 'café',
  tags_json: '["directory"]',
  polygon_json: null,
  teaser_text: 'Kuchen.',
  condition_rule: 'always',
  special_radius_m: null,
} as Poi;

const steakHits = searchCityIndex({ query: 'steak', pois: [steak, cafe] });
assert(steakHits.length === 1 && steakHits[0]?.name === 'Grillhaus Nord', 'Facet steak');

const nums = [
  { lat: 53.68, lng: 9.76, n: '23', s: 'Öl Mühle' },
  { lat: 53.69, lng: 9.77, n: '12', s: 'Heisterhoop' },
];
const addr = lookupOfflineAddress('Oel Muehle 23', nums);
assert(addr?.kind === 'address', 'Straße+Nr. offline');
assert(addr?.name.includes('23'), 'Hausnummer im Label');

const folded = lookupOfflineAddress('Öl-Mühle 23', nums);
assert(folded?.lat === 53.68, 'Umlaut/Bindestrich');

assert(
  lookupOfflineAddress('Heisterhoop 99', nums) == null,
  'falsche Nummer kein Treffer',
);

console.log('searchCityIndex.smoke.test.ts OK');
