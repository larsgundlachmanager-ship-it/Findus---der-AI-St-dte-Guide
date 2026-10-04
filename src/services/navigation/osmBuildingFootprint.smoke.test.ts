/**
 * Run: npx --yes tsx src/services/navigation/osmBuildingFootprint.smoke.test.ts
 */

import {
  isMapCrossingPoi,
  packNeedsOsmFootprint,
  pickBestFootprint,
} from './osmBuildingFootprint';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isMapCrossingPoi('Eisenbahnbrücke am Hudenbarg'), 'bridge name');
assert(!isMapCrossingPoi('Gemeindezentrum am Hudenbarg'), 'campus not crossing');

assert(
  packNeedsOsmFootprint({
    name: 'Eisenbahnbrücke am Hudenbarg',
    polygon_json: null,
  }) === false,
  'crossing never asks Overpass for a house',
);

assert(
  packNeedsOsmFootprint({
    name: 'Alte Schule',
    polygon_json: null,
    tags_json: '["gps_manual_fix","story"]',
  }) === true,
  'manual GPS ohne Umriss → Overpass für Gebäudefüllung',
);

const kita = [
  { latitude: 53.67749, longitude: 9.7576 },
  { latitude: 53.67749, longitude: 9.7579 },
  { latitude: 53.67732, longitude: 9.7579 },
  { latitude: 53.67732, longitude: 9.7576 },
  { latitude: 53.67749, longitude: 9.7576 },
];
assert(
  packNeedsOsmFootprint({
    name: 'Alte Schule',
    polygon_json: JSON.stringify(kita),
    tags_json: '["gps_manual_fix","story"]',
  }) === true,
  'GPS-Box trotz manual_fix → Overpass',
);
const fire = [
  { latitude: 53.67756, longitude: 9.7566 },
  { latitude: 53.67756, longitude: 9.7576 },
  { latitude: 53.67749, longitude: 9.7576 },
  { latitude: 53.67749, longitude: 9.7566 },
  { latitude: 53.67756, longitude: 9.7566 },
];
const picked = pickBestFootprint(
  53.677065,
  9.756206,
  [
    { ring: kita, tags: { building: 'yes', amenity: 'kindergarten' } },
    { ring: fire, tags: { building: 'yes', amenity: 'fire_station' } },
  ],
  'Eisenbahnbrücke am Hudenbarg',
);
assert(picked == null, 'bridge must not snap to Kita or Feuerwehr');

assert(
  packNeedsOsmFootprint({
    name: 'Stadtgeschichte',
    lat: 53.6782,
    lng: 9.75895,
    polygon_json: JSON.stringify([
      { latitude: 53.6772, longitude: 9.7572 },
      { latitude: 53.6772, longitude: 9.7581 },
      { latitude: 53.6779, longitude: 9.7581 },
      { latitude: 53.6779, longitude: 9.7572 },
      { latitude: 53.6772, longitude: 9.7572 },
    ]),
  }) === true,
  'Pin außerhalb Shared-Footprint → Overpass neu',
);

console.log('osmBuildingFootprint.smoke.test.ts ok');
