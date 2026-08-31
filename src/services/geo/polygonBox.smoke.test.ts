/**
 * Run: npx --yes tsx src/services/geo/polygonBox.smoke.test.ts
 */

import {
  isAxisAlignedBoxPolygon,
  parsePolygonJson,
} from './polygon';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const box = parsePolygonJson(
  JSON.stringify([
    { lat: 53.87, lng: 10.69 },
    { lat: 53.87, lng: 10.691 },
    { lat: 53.871, lng: 10.691 },
    { lat: 53.871, lng: 10.69 },
    { lat: 53.87, lng: 10.69 },
  ]),
);
assert(box && isAxisAlignedBoxPolygon(box), 'GPS-Box is axis-aligned');

const building = parsePolygonJson(
  JSON.stringify([
    { lat: 53.87, lng: 10.69 },
    { lat: 53.8702, lng: 10.6904 },
    { lat: 53.8705, lng: 10.6901 },
    { lat: 53.8703, lng: 10.6897 },
    { lat: 53.87, lng: 10.69 },
  ]),
);
assert(
  building && !isAxisAlignedBoxPolygon(building),
  'real footprint is not a box',
);

console.log('polygonBox.smoke.test ok');
