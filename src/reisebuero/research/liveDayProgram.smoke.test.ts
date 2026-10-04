/**
 * Live-Tagesprogramm — Slot-Mapping (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/liveDayProgram.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';
import {
  liveSlotsForTheme,
  themeFromDayTitle,
} from './liveDayProgram';

assert.equal(themeFromDayTitle('Tag 1 · Anreise'), 'arrival_evening');
assert.equal(themeFromDayTitle('Tag 2 · Feiern'), 'party');
assert.equal(themeFromDayTitle('Tag 3 · Erkunden'), 'explore');

const partyLed = mergeLedger(cloneEmptyLedger(), {
  partyGrain: entry('clubs', 'user', 'wish'),
  stayNights: entry(3, 'user'),
});
const partySlots = liveSlotsForTheme('party', 'Budapest', partyLed);
assert.ok(partySlots.some((s) => s.kind === 'club'), 'party has club slot');
assert.ok(partySlots.every((s) => /Budapest/i.test(s.query)), 'city in query');

const spaLed = mergeLedger(cloneEmptyLedger(), {
  spaStyle: entry('thermal', 'user', 'wish'),
});
const spaSlots = liveSlotsForTheme('spa', 'Budapest', spaLed);
assert.ok(spaSlots.some((s) => /thermal|spa/i.test(s.query)), 'spa query');

const explore = liveSlotsForTheme(
  'explore',
  'Bukarest',
  mergeLedger(cloneEmptyLedger(), {
    mustActivities: entry(['Museum'], 'user', 'wish'),
  }),
);
assert.ok(explore.some((s) => s.kind === 'museum' || /museum/i.test(s.query)), 'museum act');

console.log('liveDayProgram.smoke.test.ts: ok');
