/**
 * Run: npx tsx src/reisebuero/research/railJourneyTiming.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { sanitizeRailCityName } from './railJourneyTiming';
import { formatJourneyClock } from './storyMagazine';

assert.equal(sanitizeRailCityName('davon'), 'Hamburg');
assert.equal(sanitizeRailCityName('dahin'), 'Hamburg');
assert.equal(sanitizeRailCityName('Davon'), 'Hamburg');
assert.equal(sanitizeRailCityName('Hamburg'), 'Hamburg');
assert.equal(formatJourneyClock('7:23'), '07:23');
assert.equal(formatJourneyClock('2026-09-11T07:23:11+02:00'), '07:23');

console.log('railJourneyTiming.smoke: ok');
