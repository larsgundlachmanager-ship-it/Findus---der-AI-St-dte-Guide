/**
 * Run: npx --yes tsx src/services/navigation/stampMapPlanMatch.smoke.test.ts
 */

import { plannedPoiIdSet } from './stampMapPlanMatch';
import { isAxisAlignedBoxPolygon } from '../geo/polygon';
import type { Poi } from '../../db/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function poi(partial: Partial<Poi> & { name: string; id: number }): Poi {
  return {
    id: partial.id,
    name: partial.name,
    lat: partial.lat ?? 53.87,
    lng: partial.lng ?? 10.69,
    radius_meters: 40,
    spot_key: 'x',
    parent_poi_id: null,
    kind: 'area',
    category: partial.category ?? 'kultur',
    tags_json: '["must_have"]',
    polygon_json: null,
    teaser_text: partial.teaser_text ?? 'Fachwerk aus dem 17. Jahrhundert am Markt.',
    condition_rule: 'always',
    special_radius_m: null,
  };
}

const church = poi({ id: 1, name: 'Marienkirche', lat: 53.87, lng: 10.69 });
const ids = plannedPoiIdSet([church], [
  { title: 'Marienkirche Lübeck', lat: 53.8701, lng: 10.6901, status: 'planned' },
]);
assert(ids.has(1), 'plan stop matches POI by name/geo');

const skipped = plannedPoiIdSet([church], [
  { title: 'Marienkirche', status: 'done' },
]);
assert(!skipped.has(1), 'done stops are not planned');

const far = plannedPoiIdSet([church], [
  { title: 'Ganz woanders', lat: 48.1, lng: 11.5, status: 'planned' },
]);
assert(!far.has(1), 'distant stop does not match');

const hotel = poi({ id: 10, name: 'Hotel Sonne', lat: 53.87, lng: 10.69 });
const kita = poi({
  id: 11,
  name: 'Kindergarten Sonnenschein',
  lat: 53.8704,
  lng: 10.6905,
});
const onlyHotel = plannedPoiIdSet([hotel, kita], [
  { title: 'Hotel Sonne', lat: 53.87, lng: 10.69, status: 'planned' },
]);
assert(onlyHotel.has(10), 'geplanter Hotel-Stopp trifft das Hotel');
assert(!onlyHotel.has(11), 'Kindergarten daneben ist nicht geplant');

const byPoiId = plannedPoiIdSet([hotel, kita], [
  { id: 'nav_live_tour_0_10', title: 'Irgendwas', status: 'planned' },
]);
assert(byPoiId.has(10) && !byPoiId.has(11), 'Stopp-ID bindet genau einen POI');

assert(
  isAxisAlignedBoxPolygon([
    { latitude: 53.87, longitude: 10.69 },
    { latitude: 53.87, longitude: 10.691 },
    { latitude: 53.871, longitude: 10.691 },
    { latitude: 53.871, longitude: 10.69 },
    { latitude: 53.87, longitude: 10.69 },
  ]),
  'box polygon detected',
);

console.log('stampMapPlanMatch.smoke.test ok');
