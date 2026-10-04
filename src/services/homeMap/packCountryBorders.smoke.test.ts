/**
 * Country-ISO-Helfer (noch für Meta/Legacy); Grenzen kommen aus Protomaps.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/packCountryBorders.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeCountryToA3,
  packCountryA3CodesFromNames,
} from './packCountryBorders';

assert.equal(normalizeCountryToA3('Deutschland'), 'DEU');
assert.equal(normalizeCountryToA3('Netherlands'), 'NLD');
assert.equal(normalizeCountryToA3('United Kingdom'), 'GBR');
assert.equal(normalizeCountryToA3('Portugal'), 'PRT');

const codes = packCountryA3CodesFromNames([
  'Deutschland',
  'Niederlande',
  'United Kingdom',
]);
assert.deepEqual(codes, ['DEU', 'GBR', 'NLD']);

const style = readFileSync(
  join(process.cwd(), 'src/services/homeMap/yorroProtomapsBasemapStyle.ts'),
  'utf8',
);
assert(
  style.includes('ensureProtomapsBoundaryLayers') &&
    style.includes('boundaries_country') &&
    style.includes('HOME_MAP_COUNTRY_BORDER'),
  'weiße Ländergrenzen aus Protomaps-Basemap',
);

const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(
  !view.includes('pack-country-borders'),
  'kein grobes ShapeSource-Länder-Overlay',
);

console.log('packCountryBorders.smoke.test.ts OK');
