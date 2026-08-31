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
assert.ok(/Timeline|Bescheid|los/i.test(pitchTimingLaterSpeech(opt.name)));

const dining = pitchDiningForkActions(opt);
assert.ok(dining.some((a) => a.type === 'START_NAVIGATION' && /Route/i.test(a.label)));
assert.ok(dining.some((a) => a.type === 'OPEN_URL' && /reservier|Speisekarte/i.test(a.label)));
assert.ok(/Route|Tisch|reserv/i.test(pitchDiningForkSpeech(opt.name)));

console.log('pitchTimingFork.smoke: ok');
