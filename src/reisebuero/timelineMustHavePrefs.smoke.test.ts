/**
 * Timeline → Must-Have Prefs (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/timelineMustHavePrefs.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { entry } from './slotLedger';
import { deriveMustHavesFromPastTimelines } from './timelineMustHavePrefs';
import type { ReiseTrip } from './types';
import { EMPTY_LEDGER } from './types';

function fakeTrip(
  id: string,
  must: string[],
  wish: string[] = [],
): ReiseTrip {
  return {
    id,
    name: id,
    createdAtMs: 1,
    updatedAtMs: 1,
    ledger: {
      ...EMPTY_LEDGER,
      mustHaves: must.length ? entry(must as any, 'user', 'must') : null,
      wishHaves: wish.length ? entry(wish as any, 'user', 'wish') : null,
    },
    askedSlotKeys: [],
    frozen: false,
    refineCount: 0,
    initialProSearchDone: false,
    chat: [],
    options: [],
    funnelLog: [],
    researchSteps: [],
    researchSparks: [],
    decisionJournal: [],
    phase: 'results',
    searchReadySticky: false,
    searchReadyAnnounced: false,
    searching: false,
    thinking: false,
    verifyProgress: null,
    researchEtaMin: null,
    searchError: null,
    selectedOptionId: null,
    questionHint: '',
    llmFlipchartNotes: null,
    catalogExtras: [],
    recapSpokenOnce: false,
    recapText: null,
    timelinePushedOptionId: null,
  };
}

const empty = deriveMustHavesFromPastTimelines({ savedTrips: [] });
assert.equal(empty.timelineCount, 0);
assert.equal(empty.mustHaves.length, 0);

const trips = [
  fakeTrip('a', ['pool', 'party'], ['grill']),
  fakeTrip('b', ['pool'], ['spa', 'party']),
  fakeTrip('c', ['pool', 'spa'], ['party']),
  fakeTrip('d', ['sauna'], ['pool']),
  fakeTrip('e', ['pool'], ['grill']),
  fakeTrip('f', ['hotel'], ['warm']), // lodging/weather skipped
];

const d = deriveMustHavesFromPastTimelines({ savedTrips: trips, maxTimelines: 6 });
assert.ok(d.timelineCount >= 5, `timelines ${d.timelineCount}`);
assert.ok(d.mustHaves.includes('pool') || d.wishHaves.includes('pool'), 'pool from history');
assert.ok(!d.mustHaves.includes('hotel') && !d.wishHaves.includes('hotel'), 'no hotel auto');
assert.ok(!d.mustHaves.includes('warm') && !d.wishHaves.includes('warm'), 'no warm auto');
assert.ok(d.note && /früheren Plänen/i.test(d.note), 'note');

const fromPlans = deriveMustHavesFromPastTimelines({
  futurePlans: {
    '2026-06-01': {
      dayKey: '2026-06-01',
      stops: [
        { id: '1', title: 'Pool & Grill', bufferMin: 10, transport: 'walk', kind: 'stop' },
        { id: '2', title: 'Spa Thermal', bufferMin: 10, transport: 'walk', kind: 'stop' },
      ],
      transportDefault: 'walk',
      updatedAtMs: 100,
    },
    '2026-06-02': {
      dayKey: '2026-06-02',
      stops: [
        { id: '3', title: 'Club Night', bufferMin: 10, transport: 'walk', kind: 'stop' },
        { id: '4', title: 'Pool Late', bufferMin: 10, transport: 'walk', kind: 'stop' },
      ],
      transportDefault: 'walk',
      updatedAtMs: 90,
    },
    '2026-06-03': {
      dayKey: '2026-06-03',
      stops: [
        { id: '5', title: 'Spa Morning', bufferMin: 10, transport: 'walk', kind: 'stop' },
        { id: '6', title: 'Pool again', bufferMin: 10, transport: 'walk', kind: 'stop' },
      ],
      transportDefault: 'walk',
      updatedAtMs: 80,
    },
  },
});
assert.ok(
  fromPlans.wishHaves.includes('pool') ||
    fromPlans.mustHaves.includes('pool') ||
    fromPlans.niceHaves.includes('pool'),
  'pool from plan titles',
);

console.log('timelineMustHavePrefs.smoke.test.ts: ok');
