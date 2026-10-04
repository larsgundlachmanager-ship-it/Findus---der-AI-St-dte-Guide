/**
 * Reisebegleiter-Foresight + Hard-Publish-Gate.
 */
import assert from 'node:assert/strict';
import {
  detectTimelineForesight,
  foresightAskBack,
  picnicForesightAuthorIntent,
  packAsCacheAuthorIntent,
} from '../router/travelCompanionForesight';
import {
  gatePitchCandidatesForPublish,
  gatePitchOptionsForPublish,
} from '../pitch/pitchHardPublishGate';
import type { PitchCandidate, PitchRequest } from '../pitch/types';

const now = Date.parse('2026-09-14T15:00:00');
const dinner = Date.parse('2026-09-14T19:00:00');

const overlap = detectTimelineForesight({
  userText: 'Dann lass uns heute lieber ins Theater gehen',
  nowMs: now,
  stops: [
    {
      id: '1',
      title: 'Abendessen Reservierung',
      plannedStartMs: dinner,
      bufferMin: 15,
      transport: 'walk',
      hardAnchor: true,
      reserveUrl: 'https://example.com/reserve',
      status: 'planned',
    },
  ],
});
assert.ok(overlap, 'timeline overlap');
assert.equal(overlap!.kind, 'hard_overlap');
assert.ok(foresightAskBack(overlap), 'ask back on overlap');

const squeeze = detectTimelineForesight({
  userText: 'Kann ich vorher noch schnell auf den Turm?',
  nowMs: Date.parse('2026-09-14T16:30:00'),
  stops: [
    {
      id: '1',
      title: 'Abendessen',
      plannedStartMs: dinner,
      bufferMin: 15,
      transport: 'walk',
      hardAnchor: true,
      reserveUrl: 'https://example.com/r',
      status: 'planned',
    },
  ],
});
assert.ok(squeeze, 'soft squeeze');
assert.equal(squeeze!.kind, 'soft_squeeze');
assert.equal(foresightAskBack(squeeze), null);

assert.ok(/Cache/.test(packAsCacheAuthorIntent()));
assert.ok(/Wetter/.test(picnicForesightAuthorIntent('Picknick im Park')));

const baseReq = {
  title: 'All you can eat kein asiatisch',
  context: 'All you can eat, kein asiatisch',
  wishes: [
    { text: 'all_you_can_eat', hardness: 'must' as const, kind: 'amenity' as const, weight: 30 },
  ],
  prefs: { avoidCategories: ['asiatisch'] },
  forbidSoftFill: true,
  call1MustHaves: ['all_you_can_eat'],
} as unknown as PitchRequest;

const cands: PitchCandidate[] = [
  {
    name: 'Asia Buffet',
    lat: 1,
    lng: 1,
    mapsUrl: 'https://maps.example/a',
    softTags: ['buffet', 'asiatisch', 'all you can eat'],
    hardEvidence: ['all you can eat buffet'],
    source: 'places',
  },
  {
    name: 'Grill Haus',
    lat: 1,
    lng: 2,
    mapsUrl: 'https://maps.example/b',
    softTags: ['all you can eat', 'grill', 'fleisch'],
    hardEvidence: ['all you can eat schlemmerbuffet'],
    source: 'places',
  },
  {
    name: 'Pizza Soft',
    lat: 1,
    lng: 3,
    mapsUrl: 'https://maps.example/c',
    softTags: ['pizza'],
    hardEvidence: [],
    source: 'pack',
  },
];

const gated = gatePitchCandidatesForPublish(baseReq, cands);
assert.ok(
  gated.kept.every((c) => !/asia|asiat/i.test(c.name)),
  'asian dropped',
);
assert.ok(
  gated.kept.some((c) => /Grill/i.test(c.name)),
  'ayce non-asian kept',
);
assert.ok(!gated.kept.some((c) => /Pizza Soft/i.test(c.name)), 'non-ayce dropped');

const opts = gatePitchOptionsForPublish(baseReq, [
  {
    id: '1',
    name: 'Sushi Flatrate',
    lat: 0,
    lng: 0,
    role: 'favorite',
    speechPitch: 'x',
    bullets: ['all you can eat sushi'],
    mapsUrl: '',
    actions: [],
  },
]);
assert.equal(opts.length, 0, 'asian option gated');

console.log('travelCompanionForesight.smoke: ok');
