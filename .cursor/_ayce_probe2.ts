import { detectPitchKind, parseWishesFromText } from '../src/module2/pitch/parentBrief';
import { shouldHandoffToPitchModule } from '../src/module2/pitch/shouldHandoffPitch';
import { looksLikeAyceQuery } from '../src/module2/pitch/ayceIntent';
import {
  wishesFromMustHaves,
  buildPitchSearchBrief,
} from '../src/module2/pitch/searchBrief';
import { verifyHardMatches, scoreAyceEvidence } from '../src/module2/pitch/hardMatchVerify';
import type { PitchCandidate, PitchRequest } from '../src/module2/pitch/types';

const qs = [
  'All you can eat, kein Asiatisch',
  'all you can eat',
  'Ken Eat kein Asiatisch',
  'Ich möchte all you can eat essen gehen',
];

for (const q of qs) {
  console.log('===', q);
  console.log('kind', detectPitchKind(q));
  console.log('ayce', looksLikeAyceQuery(q));
  console.log('handoff', shouldHandoffToPitchModule(q));
  console.log(
    'wishes',
    parseWishesFromText(q).map((w) => `${w.kind}:${w.text}`),
  );
}

console.log(
  'wishesFromMustHaves',
  wishesFromMustHaves(['all_you_can_eat', 'All you can eat', 'must_ayce_evidence']),
);

const q = 'All you can eat, kein Asiatisch';
const brief = buildPitchSearchBrief({
  userText: q,
  kind: detectPitchKind(q),
  baseWishes: parseWishesFromText(q),
  call1MustHaves: ['All you can eat', 'must_ayce_evidence'],
});
console.log(
  'brief.wishes',
  brief.wishes.map((w) => `${w.kind}:${w.text}:${w.hardness}`),
);

const gold: PitchCandidate = {
  name: 'Restaurant Goldschätzchen',
  lat: 53.67,
  lng: 9.76,
  softTags: ['food', 'restaurant', 'biergarten'],
  hardEvidence: ['Abendkarte', 'Kulinarik'],
  source: 'pack',
  distFromAnchorM: 800,
  rating: 4.5,
};

const req: PitchRequest = {
  requestId: 't',
  title: q,
  context: q,
  kind: 'food',
  searchMode: 'city_best',
  visitAtMs: Date.now(),
  wishes: brief.wishes,
  prefs: { avoidCategories: ['asiatisch'] },
  anchor: { lat: 53.67, lng: 9.76 },
  cityHint: 'Prisdorf',
  route: null,
  landmark: null,
  uiLayout: 'live_split',
  bridgeAlreadySpoken: true,
  continueFromBridge: null,
};

verifyHardMatches({ req, candidates: [gold] }).then((r) => {
  console.log(
    'verify gold',
    r.top.map((c) => c.name),
    'softFail',
    r.softFail,
    'reason',
    r.reason,
  );
  console.log('score', scoreAyceEvidence('Restaurant Goldschätzchen biergarten'));
});
