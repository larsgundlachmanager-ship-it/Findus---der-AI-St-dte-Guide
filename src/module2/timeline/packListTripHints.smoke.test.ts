/**
 * Pack Trip-Hints + Hochzeit → Anzug / täglich Tennis.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListTripHints.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractPackTripHints,
  ledgerPackBlob,
  looksLikePackContextFollowUp,
} from './packListTripHints';
import { buildPackListItems } from './packListBuilder';

assert.equal(
  looksLikePackContextFollowUp('Ah ja, ich spiele jeden Tag Tennis'),
  true,
);
assert.equal(
  looksLikePackContextFollowUp('bin auf einer Hochzeit eingeladen, brauch Anzug'),
  true,
);

const tennis = extractPackTripHints({
  userText: 'Ah ja, ich spiele jeden Tag Tennis',
  tripDays: 7,
});
assert.ok(tennis.activities.includes('sport_daily'));
assert.ok(tennis.extras.some((e) => /sportshirt/i.test(e.label) && (e.qty ?? 0) >= 7));

const wedding = extractPackTripHints({
  userText: '',
  ledgerBlob: ledgerPackBlob({
    purpose: { value: 'Hochzeit' },
    destinationHint: { value: 'Budapest' },
    dateStart: { value: '2026-11-12' },
  }),
});
assert.ok(wedding.activities.includes('formal'));
assert.ok(wedding.extras.some((e) => /anzug/i.test(e.label)));

const list = buildPackListItems({
  userText: 'Packliste für 5 Tage',
  tripDays: 5,
  timelineBlob: 'purpose:Hochzeit · Budapest · am 2026-11-12',
  tempC: 18,
});
assert.ok(
  list.items.some((i) => /anzug/i.test(i.label) && i.priority === 'high'),
  'wedding suit from ledger blob',
);

const tennisList = buildPackListItems({
  userText: 'Packliste — ich spiele jeden Tag Tennis',
  tripDays: 6,
  tempC: 20,
});
assert.ok(
  tennisList.items.some(
    (i) => /sportshirt|sport-oberteil/i.test(i.label) && (i.qty ?? 0) >= 6,
  ),
  'daily tennis qty',
);

console.log('packListTripHints.smoke.test.ts OK');
