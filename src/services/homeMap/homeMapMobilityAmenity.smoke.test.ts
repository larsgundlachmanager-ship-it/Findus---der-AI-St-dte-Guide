/**
 * Run: npx --yes tsx src/services/homeMap/homeMapMobilityAmenity.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isCarMobilityMapAmenity,
  parkingCostHintFromPoi,
  shouldShowCarMobilityAmenityOnMap,
} from './homeMapMobilityAmenity';

const parkingPoi = {
  id: 1,
  name: 'P+R Parkplatz Bahnhof',
  category: 'Parkplatz',
  lat: 53.67,
  lng: 9.76,
  tags_json: '["directory"]',
} as const;

const fuelPoi = {
  id: 2,
  name: 'Shell Tankstelle',
  category: 'Tankstelle',
  lat: 53.67,
  lng: 9.76,
  tags_json: '',
} as const;

assert.equal(isCarMobilityMapAmenity(parkingPoi as never), true);
assert.equal(
  shouldShowCarMobilityAmenityOnMap(parkingPoi as never, {
    mobilityMode: 'public_transit',
    travelModes: ['transit'],
  } as never),
  false,
);
assert.equal(
  shouldShowCarMobilityAmenityOnMap(fuelPoi as never, {
    mobilityMode: 'car',
  } as never),
  true,
);
assert.equal(
  parkingCostHintFromPoi({
    ...parkingPoi,
    name: 'Kostenloser Parkplatz Markt',
  } as never),
  'Kostenlos parken',
);

console.log('homeMapMobilityAmenity.smoke.test.ts OK');
