/**
 * Weather must not become complex_plan / help via „heute Abend“.
 */
import assert from 'node:assert/strict';
import {
  analyzeSmartRoute,
  detectSmartIntents,
} from './smartRouteLite';
import { detectFloskelCategoryPublic, pickFloskelForUserText } from './floskelEngine';
import { searchHelpEntries } from '../../constants/helpCatalog';

const wx = 'Wie wird heute Abend das Wetter?';
assert.deepEqual(detectSmartIntents(wx), ['weather'], 'weather-only intents');
const route = analyzeSmartRoute(wx);
assert.equal(route.intentDensity, 1, 'no multi-intent for weather tonight');
assert.equal(detectFloskelCategoryPublic(wx), 'weather', 'floskel weather');
const pick = pickFloskelForUserText(wx);
assert.equal(pick.category, 'weather', 'ack category weather');
assert(
  !/Puffer|Reihenfolge|Sunset|Abendplan/i.test(pick.phrase),
  'no plan floskel on weather',
);

const help = searchHelpEntries(wx, 3);
assert.equal(help.length, 0, 'weather must not hit help catalog');

console.log('weatherTonightRoute.smoke: ok');
