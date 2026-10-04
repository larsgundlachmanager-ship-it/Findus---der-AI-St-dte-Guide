/**
 * Task1→Task2 Leave-by Speech — Deep-Link Just-Do-It ohne Anreise-Ask.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/flights/flightTaxiTask2Handoff.smoke.ts
 */
import assert from 'node:assert/strict';
import { buildLeaveBySpeech } from './flightLeaveBySpeech';

const spoken = buildLeaveBySpeech({
  destCity: 'London',
  ident: 'EW7446',
  depMs: Date.parse('2026-09-17T18:05:00'),
  leaveMs: Date.parse('2026-09-17T15:00:00'),
  airportMs: Date.parse('2026-09-17T15:30:00'),
  luggage: 'carry',
  leaveByAsk: true,
  taxiCommitted: true,
  taxiMin: 30,
});

assert.match(spoken.speech, /Deep-Link|vorbereitet/i);
assert.doesNotMatch(spoken.speech, /ÖPNV oder Taxi/i);
assert.ok(spoken.bullets.some((b) => /Taxi vorbestellen/i.test(b)));

const openAsk = buildLeaveBySpeech({
  destCity: 'London',
  ident: 'EW7446',
  depMs: Date.parse('2026-09-17T18:05:00'),
  leaveMs: Date.parse('2026-09-17T15:00:00'),
  airportMs: Date.parse('2026-09-17T15:30:00'),
  luggage: 'carry',
  leaveByAsk: true,
  taxiCommitted: false,
});
assert.match(openAsk.speech, /ÖPNV oder Taxi/i);

console.log('flightTaxiTask2Handoff.smoke.ts OK');
