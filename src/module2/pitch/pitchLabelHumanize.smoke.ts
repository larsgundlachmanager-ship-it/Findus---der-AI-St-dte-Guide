/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/pitchLabelHumanize.smoke.ts
 */
import {
  humanizePitchLabel,
  humanizePitchLabels,
} from './pitchLabelHumanize';
import { scoreAyceEvidence } from './hardMatchVerify';
import { applyCriteriaCascade } from './criteriaCascade';
import type { PitchCandidate, PitchRequest } from './types';

function assert(c: unknown, m: string) {
  if (!c) throw new Error(m);
}

assert(humanizePitchLabel('all_you_can_eat') === 'All-you-can-eat', 'ayce label');
assert(humanizePitchLabel('location_hamburg') === '', 'location gone');
assert(humanizePitchLabel('cuisine_not_asian') === '', 'neg gone');
assert(
  humanizePitchLabels(['all_you_can_eat', 'location_hamburg', 'Freitag']).join(
    ',',
  ) === 'All-you-can-eat,Freitag',
  'labels filter',
);

assert(scoreAyceEvidence('cozy cafe specialty coffee') < 2, 'cafe not ayce');
assert(scoreAyceEvidence('all you can eat sushi flatrate') >= 2, 'real ayce');

const cafe: PitchCandidate = {
  name: 'Kaffeerei',
  lat: 53.5,
  lng: 9.9,
  placeId: 'x',
  rating: 4.5,
  ratingCount: 100,
  address: null,
  mapsUrl: '',
  openNow: true,
  closedOnVisitDay: false,
  source: 'places',
  softTags: ['cafe', 'coffee'],
  distFromAnchorM: 5000,
};
const req = {
  kind: 'food',
  wishes: [
    { text: 'all_you_can_eat', hardness: 'must', kind: 'amenity' },
  ],
  prefs: {},
  title: 'ayce',
  context: 'all you can eat',
  searchMode: 'city_best',
  visitAtMs: Date.now(),
  anchor: { lat: 53.5, lng: 9.9 },
  cityHint: 'Hamburg',
} as unknown as PitchRequest;

const cascaded = applyCriteriaCascade(req, [cafe]);
assert(
  cascaded.checklist.some(
    (s) => /all_you_can_eat/i.test(s.key) && s.status === 'soft_miss',
  ),
  'ayce hard miss on cafe',
);
assert(
  !/Perfect-Strang/i.test(cascaded.honestyLine || ''),
  'no Perfect-Strang jargon',
);
assert(
  !/_hamburg|_asian|cuisine_not/i.test(cascaded.honestyLine || ''),
  'no meta keys in honesty',
);

console.log('pitchLabelHumanize.smoke ok');
