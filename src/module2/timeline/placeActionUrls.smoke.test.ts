/**
 * Run: npx --yes tsx src/module2/timeline/placeActionUrls.smoke.test.ts
 */

import {
  mapsPinUrl,
  mergePlaceActionUrls,
} from './placeActionUrls';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const pin = mapsPinUrl(53.68, 9.76, '1 · Briefkasten');
assert(pin && pin.includes('google.com/maps'), 'Pin ist ein Maps-Link');
assert(pin && pin.includes('Briefkasten'), 'Name im Query');
assert(pin && !pin.includes('1 ·'), 'keine Stop-Nummer im Query');

const merged = mergePlaceActionUrls(
  { mapsUrl: null, menuUrl: 'https://a.example/menu' },
  { mapsUrl: 'https://maps.google.com/?cid=1', websiteUrl: 'https://a.example' },
);
assert(merged.mapsUrl?.includes('maps.google'), 'Maps aus zweiter Quelle');
assert(merged.menuUrl === 'https://a.example/menu', 'Menü bleibt');
assert(merged.websiteUrl === 'https://a.example', 'Website bleibt');

console.log('placeActionUrls.smoke.test.ts ok');
