/**
 * Smoke: bare Hauptbahnhof → regionaler Groß-Hbf (nicht Dorf-Bahnhof).
 */
import assert from 'assert';
import {
  expandBareHauptbahnhofQuery,
  isBareHauptbahnhofLabel,
} from './expandBareHauptbahnhof';

assert.strictEqual(isBareHauptbahnhofLabel('Hauptbahnhof'), true);
assert.strictEqual(isBareHauptbahnhofLabel('Hbf'), true);
assert.strictEqual(isBareHauptbahnhofLabel('Hamburg Hauptbahnhof'), false);

const prisdorf = expandBareHauptbahnhofQuery('Hauptbahnhof', {
  cityHint: 'prisdorf',
});
assert.strictEqual(prisdorf, 'Hamburg Hauptbahnhof');

const gpsHh = expandBareHauptbahnhofQuery('Hbf', {
  lat: 53.68,
  lng: 9.76,
});
assert.strictEqual(gpsHh, 'Hamburg Hauptbahnhof');

console.log('expandBareHauptbahnhof.smoke: ok');
