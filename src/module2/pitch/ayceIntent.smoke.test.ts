/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/ayceIntent.smoke.test.ts
 */
import { looksLikeAyceQuery, normalizeAyceStt } from './ayceIntent';
import { scoreAyceEvidence, verifyHardMatches } from './hardMatchVerify';
import type { PitchCandidate, PitchRequest, PitchWish } from './types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(looksLikeAyceQuery('all you can eat'), 'canonical ayce');
assert(looksLikeAyceQuery('all xou can eat'), 'stt xou');
assert(looksLikeAyceQuery('ich möchte morgen abend all xou can eat essen gehen'), 'full stt sentence');
assert(looksLikeAyceQuery('Euer Ken Eat essen gehen'), 'stt Ken Eat');
assert(looksLikeAyceQuery('Oyukin-Eat kein Asiatisch'), 'stt Oyukin');
assert(looksLikeAyceQuery('Eurokinit Eat bitte'), 'stt Eurokinit');
assert(looksLikeAyceQuery('euken eat'), 'stt euken eat');
assert(looksLikeAyceQuery('Euken Eat'), 'stt Euken Eat');
assert(looksLikeAyceQuery('Eukin Eat bitte'), 'stt Eukin');
assert(
  normalizeAyceStt('all xou can eat bitte') === 'all you can eat bitte',
  'normalize xou',
);
assert(
  normalizeAyceStt('Ken Eat bitte').includes('all you can eat'),
  'normalize Ken Eat',
);
assert(
  normalizeAyceStt('Euken Eat bitte').includes('all you can eat'),
  'normalize Euken Eat',
);
assert(!looksLikeAyceQuery('Pizza essen gehen'), 'plain pizza not ayce');

assert(scoreAyceEvidence('all you can eat sushi flatrate') >= 4, 'strong ayce');
assert(scoreAyceEvidence('asiatisches Buffet mongolischer Grill') >= 3, 'asian buffet');
assert(scoreAyceEvidence('Frühstücksbuffet im Hotel') < 2, 'breakfast buffet weak');
assert(scoreAyceEvidence('Kaffeerei Rösterei specialty coffee') < 2, 'roastery not ayce');
assert(
  scoreAyceEvidence(
    'Restaurant Goldschätzchen biergarten gemütlich Abendkarte & Kulinarik',
  ) < 2,
  'Goldschätzchen not ayce evidence',
);

const gold: PitchCandidate = {
  name: 'Restaurant Goldschätzchen',
  lat: 53.6764,
  lng: 9.758,
  softTags: ['food', 'restaurant', 'biergarten', 'gemütlich'],
  hardEvidence: ['Abendkarte & Kulinarik'],
  source: 'pack',
  distFromAnchorM: 800,
  rating: 4.5,
};

async function assertNoGoldSoftFill(
  wishes: PitchWish[],
  title: string,
  label: string,
): Promise<void> {
  const req = {
    requestId: 'ayce_smoke',
    title,
    context: title,
    kind: 'food',
    searchMode: 'city_best',
    visitAtMs: Date.now(),
    wishes,
    prefs: { avoidCategories: ['asiatisch'] },
    anchor: { lat: 53.6764, lng: 9.758 },
    cityHint: 'Prisdorf',
    route: null,
    landmark: null,
    uiLayout: 'live_split',
    bridgeAlreadySpoken: true,
    continueFromBridge: null,
  } as unknown as PitchRequest;
  const r = await verifyHardMatches({ req, candidates: [gold] });
  assert(
    !r.top.some((c) => /goldschätz|goldschaetz/i.test(c.name)),
    `${label}: must not publish Goldschätzchen`,
  );
  assert(r.softFail === true || r.top.length === 0, `${label}: softFail or empty`);
}

void (async () => {
  await assertNoGoldSoftFill(
    [],
    'All you can eat heute Abend, kein Asiatisch bitte',
    'EMPTY wishes + AYCE title',
  );
  await assertNoGoldSoftFill(
    [{ text: 'gemütlich', hardness: 'must', kind: 'vibe' }],
    'All you can eat heute Abend, kein Asiatisch bitte',
    'vibe-only + AYCE title',
  );
  await assertNoGoldSoftFill(
    [{ text: 'all_you_can_eat', hardness: 'must', kind: 'amenity' }],
    'All you can eat heute Abend, kein Asiatisch bitte',
    'amenity must',
  );

  const { parseWishesFromText } = require('./parentBrief') as {
    parseWishesFromText: (t: string) => PitchWish[];
  };
  const { extractNamedRestaurantWish } = require('./namedVenueIntent') as {
    extractNamedRestaurantWish: (t: string) => string | null;
  };
  assert(
    extractNamedRestaurantWish(
      'Ich habe Lust heute Abend All you can eat zu essen, aber kein Asiatisch',
    ) == null,
    'kein Asiatisch is not a venue name',
  );
  assert(
    !parseWishesFromText(
      'Ich habe Lust heute Abend All you can eat zu essen, aber kein Asiatisch',
    ).some((w) => w.kind === 'venue' && /asiat/i.test(w.text)),
    'AYCE avoid asia must not become venue must',
  );

  console.log('ayceIntent.smoke.test.ts OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
