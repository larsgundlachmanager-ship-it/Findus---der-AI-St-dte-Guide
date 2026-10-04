/**
 * Run: npx tsx src/reisebuero/research/liveStaySearch.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { cityStayQueryAliases } from './cityStayAliases';
import { lodgingLanesForSearch } from './lodgingLanes';

assert.ok(cityStayQueryAliases('Krakau').includes('Krakow'), 'Krakau→Krakow');
assert.ok(cityStayQueryAliases('Lissabon').includes('Lisbon'), 'Lissabon→Lisbon');
assert.deepEqual(cityStayQueryAliases('Budapest'), ['Budapest']);

const lanesAi = lodgingLanesForSearch({
  preferred: 'apartment',
  preferAllInclusive: true,
  amenityBlob: 'villa pool ferienwohnung',
  maxLanes: 4,
});
assert.ok(lanesAi.includes('resort'), 'AI→resort');
assert.ok(lanesAi.includes('apartment'), 'fewo lane');
assert.ok(lanesAi.includes('villa') || lanesAi.includes('hotel'), 'villa or hotel');

console.log('liveStaySearch.smoke: aliases+lanes ok', lanesAi.join(','));
