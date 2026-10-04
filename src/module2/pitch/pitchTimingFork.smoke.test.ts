/**
 * Pitch Timing: jetzt / später / dining_fork.
 */
import assert from 'node:assert/strict';
import {
  resolvePitchTimingMode,
  pitchTimingAskActions,
  pitchTimingLaterSpeech,
  pitchTimingNowActions,
  pitchDiningForkActions,
  pitchDiningForkSpeech,
} from './pitchTimingFork';
import type { PitchOptionCard } from './types';

assert.equal(
  resolvePitchTimingMode({ userText: 'jetzt hin' }),
  'now',
);
assert.equal(
  resolvePitchTimingMode({ userText: 'später einplanen' }),
  'later',
);
assert.equal(
  resolvePitchTimingMode({
    visitAtMs: Date.now() + 3 * 60 * 60_000,
    userText: 'Pannfisch zum Sonnenuntergang',
    pitchKind: 'food',
  }),
  'dining_fork',
);
assert.equal(
  resolvePitchTimingMode({
    userText: 'wo kann ich heute Abend was Leckeres essen',
    pitchKind: 'food',
  }),
  'dining_fork',
);

const opt: PitchOptionCard = {
  id: 'o1',
  name: 'Fischers Fritz',
  lat: 53.54,
  lng: 9.98,
  role: 'favorite',
  speechPitch: 'x',
  bullets: [],
  mapsUrl: 'https://maps.example/a',
  menuUrl: 'https://menu.example/a',
  websiteUrl: 'https://restaurant.example/a',
  actions: [],
};

const ask = pitchTimingAskActions(opt);
assert.ok(ask.some((a) => a.type === 'START_NAVIGATION'));
assert.ok(
  ask.some(
    (a) =>
      a.type === 'SET_DEPARTURE_REMINDER' &&
      (a.payload as { pitchTiming?: string }).pitchTiming === 'later',
  ),
);
assert.ok(pitchTimingNowActions(opt).some((a) => a.type === 'START_NAVIGATION'));
assert.ok(/eingeplant|Tisch|vorbereiten/i.test(pitchTimingLaterSpeech(opt.name)));

const dining = pitchDiningForkActions(opt);
assert.ok(dining.some((a) => a.type === 'START_NAVIGATION' && /Jetzt/i.test(a.label)));
assert.ok(
  dining.some(
    (a) =>
      a.type === 'SET_DEPARTURE_REMINDER' &&
      (a.payload as { pitchTiming?: string }).pitchTiming === 'later',
  ),
);
assert.ok(/jetzt|einplanen|Tisch|Zeitpunkt/i.test(pitchDiningForkSpeech(opt.name)));

assert.equal(
  resolvePitchTimingMode({
    userText: 'morgen lecker Pannfisch essen',
    pitchKind: 'food',
  }),
  'dining_fork',
);

assert.equal(
  resolvePitchTimingMode({
    visitAtMs: Date.now() + 3 * 60 * 60_000,
    userText: 'Olaf der Flipper heute Abend',
    pitchKind: 'event',
  }),
  'later',
);

// Freitagabend → einplanen, kein Sofort-„Jetzt hin?“
{
  const fri = new Date();
  fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7 || 7));
  fri.setHours(19, 0, 0, 0);
  assert.equal(
    resolvePitchTimingMode({
      visitAtMs: fri.getTime(),
      userText: 'Freitagabend essen gehen',
      pitchKind: 'food',
    }),
    'later',
  );
  assert.equal(
    resolvePitchTimingMode({
      userText: 'Freitagabend essen gehen',
      pitchKind: 'food',
    }),
    'later',
  );
}

console.log('pitchTimingFork.smoke: ok');
