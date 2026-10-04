import { verifyHardMatches, scoreAyceEvidence } from '../src/module2/pitch/hardMatchVerify';
import { scoreSpecializedFoodWish } from '../src/module2/pitch/specializedFoodMatch';
import { applyCriteriaCascade } from '../src/module2/pitch/criteriaCascade';
import type { PitchCandidate, PitchRequest, PitchWish } from '../src/module2/pitch/types';

const gold: PitchCandidate = {
  name: 'Restaurant Goldschätzchen',
  lat: 53.67,
  lng: 9.76,
  softTags: ['food', 'restaurant', 'biergarten', 'gemütlich'],
  hardEvidence: ['Abendkarte & Kulinarik'],
  source: 'pack',
  distFromAnchorM: 800,
  rating: 4.5,
};

const q = 'All you can eat, kein Asiatisch';

async function run(wishes: PitchWish[], label: string) {
  const req: PitchRequest = {
    requestId: 't',
    title: q,
    context: q,
    kind: 'food',
    searchMode: 'city_best',
    visitAtMs: Date.now(),
    wishes,
    prefs: { avoidCategories: ['asiatisch'] },
    anchor: { lat: 53.67, lng: 9.76 },
    cityHint: 'Prisdorf',
    route: null,
    landmark: null,
    uiLayout: 'live_split',
    bridgeAlreadySpoken: true,
    continueFromBridge: null,
  };
  const casc = applyCriteriaCascade(req, [gold]);
  console.log(label, 'cascade pool', casc.pool.map((c) => c.name), casc.checklist);
  const r = await verifyHardMatches({ req, candidates: [gold] });
  console.log(
    label,
    'top',
    r.top.map((c) => c.name),
    'soft',
    r.softFail,
    String(r.reason || '').slice(0, 80),
  );
}

(async () => {
  await run(
    [{ text: 'All you can eat', hardness: 'must', kind: 'dish' }],
    'DISH-only',
  );
  await run(
    [{ text: 'must_ayce_evidence', hardness: 'must', kind: 'dish' }],
    'must_ayce_evidence dish',
  );
  await run(
    [{ text: 'all_you_can_eat', hardness: 'must', kind: 'amenity' }],
    'AMENITY',
  );
  await run([], 'EMPTY wishes');
  console.log(
    'spec dish',
    scoreSpecializedFoodWish(
      'restaurant goldschätzchen biergarten food',
      { text: 'All you can eat', kind: 'dish', hardness: 'must' },
    ),
  );
  console.log(
    'hitsKey-ish parts',
    ['all', 'you', 'can', 'eat'].every((p) =>
      'restaurant goldschätzchen biergarten food abendkarte kulinarik'.includes(p),
    ),
  );
})();
