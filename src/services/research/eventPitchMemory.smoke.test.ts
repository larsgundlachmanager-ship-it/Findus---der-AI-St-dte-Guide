/**
 * Event-Pitch Quota — rein, ohne RN.
 */
import assert from 'node:assert/strict';
import {
  MAX_EVENT_PITCHES_PER_WINDOW,
  EVENT_PITCH_COOLDOWN_MS,
  buildEventOfferKey,
  canEventPitch,
  eventPitchQuotaExhausted,
  pitchesInEventWindow,
  type EventPitchQuotaMemory,
} from './eventPitchQuota';

const now = Date.now();
const mem: EventPitchQuotaMemory = {
  recentPitches: [
    {
      atMs: now - 60_000,
      venueName: 'Arena Nord',
      offerKey: buildEventOfferKey({
        venueName: 'Arena Nord',
        whenLabel: 'heute 20:00',
        titleOrHook: 'Rock Night',
      }),
    },
  ],
};

assert.equal(MAX_EVENT_PITCHES_PER_WINDOW, 1);
assert.equal(EVENT_PITCH_COOLDOWN_MS, 2 * 60 * 60_000);
assert.equal(pitchesInEventWindow(mem, now).length, 1);
assert.equal(eventPitchQuotaExhausted(mem, now), true);

assert.equal(
  canEventPitch(mem, now, {
    venueName: 'Arena Nord',
    offerKey: buildEventOfferKey({
      venueName: 'Arena Nord',
      whenLabel: 'heute 21:00',
      titleOrHook: 'Jazz',
    }),
  }).ok,
  false,
);

assert.equal(
  canEventPitch(mem, now, {
    venueName: 'Stadttheater',
    offerKey: buildEventOfferKey({
      venueName: 'Stadttheater',
      whenLabel: 'heute 19:30',
      titleOrHook: 'Musical',
    }),
  }).ok,
  false,
  'nach einer Ansage im 2h-Fenster: Quota voll',
);

const memFresh: EventPitchQuotaMemory = {
  recentPitches: [
    {
      atMs: now - EVENT_PITCH_COOLDOWN_MS - 60_000,
      venueName: 'Alte Halle',
      offerKey: 'gestern|alt',
    },
  ],
};
assert.equal(eventPitchQuotaExhausted(memFresh, now), false);
assert.equal(
  canEventPitch(memFresh, now, {
    venueName: 'Stadttheater',
    offerKey: buildEventOfferKey({
      venueName: 'Stadttheater',
      whenLabel: 'heute 19:30',
      titleOrHook: 'Musical',
    }),
  }).ok,
  true,
);

const mem2: EventPitchQuotaMemory = {
  recentPitches: [
    ...mem.recentPitches,
    {
      atMs: now - 30_000,
      venueName: 'Konzerthalle',
      offerKey: buildEventOfferKey({
        venueName: 'Konzerthalle',
        whenLabel: 'heute 18:00',
        titleOrHook: 'Symphonie',
      }),
    },
  ],
};
assert.equal(eventPitchQuotaExhausted(mem2, now), true);
assert.equal(
  canEventPitch(mem2, now, {
    venueName: 'Oper',
    offerKey: 'heute|oper',
  }).reason,
  'quota',
);

console.log('eventPitchMemory.smoke.test.ts: ok');
