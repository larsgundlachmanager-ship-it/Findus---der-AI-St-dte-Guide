/**
 * Search-Brief + Ranking smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/searchBrief.smoke.test.ts
 */
import { buildPitchSearchBrief, wishesFromMustHaves, isAtmosphereVibeLabel, broadenDiningPitchRequest } from './searchBrief';
import { rankCandidatesForUser, shortlistTopN } from './candidateRank';
import { parseWishesFromText, detectPitchKind } from './parentBrief';
import type { PitchCandidate, PitchRequest } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const w = wishesFromMustHaves(['indisch', 'authentisch', 'heute Abend', 'Hamburg']);
  assert(
    w.some((x) => x.kind === 'cuisine' && /indisch/i.test(x.text) && x.hardness === 'must'),
    'indisch must cuisine',
  );
  assert(
    w.some((x) => x.kind === 'vibe' && /authentisch/i.test(x.text) && x.hardness === 'nice'),
    'authentisch nice vibe',
  );
  assert(
    !w.some((x) => /heute\s*abend/i.test(x.text)),
    'heute Abend not a dish wish',
  );
  assert(!w.some((x) => /^hamburg$/i.test(x.text)), 'Hamburg not a dish wish');
  assert(isAtmosphereVibeLabel('heimische Dorfküche'), 'dorfküche is atmosphere');
  const broadened = broadenDiningPitchRequest({
    wishes: [
      { text: 'indisch', hardness: 'must' as const, kind: 'cuisine' as const },
      { text: 'authentisch', hardness: 'must' as const, kind: 'vibe' as const },
    ],
    searchMode: 'here_now' as const,
    shortlistSize: 5,
  });
  assert(broadened.searchMode === 'city_best', 'retry city_best');
  assert(
    broadened.wishes.every(
      (w) => w.kind !== 'vibe' || w.hardness === 'nice',
    ),
    'retry relaxes vibe to nice',
  );
  assert(
    broadened.wishes.some((w) => w.kind === 'cuisine' && /indisch/i.test(w.text)),
    'retry keeps cuisine',
  );
}

{
  const brief = buildPitchSearchBrief({
    userText: 'Agno Steak in der Nähe',
    kind: 'food',
    baseWishes: parseWishesFromText('Agno Steak in der Nähe'),
    call1MustHaves: ['Angus', 'Steak'],
    authorIntent: 'User will Angus-Steak nah mit Beleg',
  });
  assert(brief.shortlistSize === 5, 'shortlist 5');
  assert(brief.speakTop === 2, 'speak 2');
  assert(
    brief.mustHaves.some((m) => /steak|angus/i.test(m)),
    'mustHaves steak/angus',
  );
  assert(
    /Angus-Steak/i.test(brief.authorIntent || ''),
    'authorIntent kept',
  );
  assert(brief.dataset === 'places_plus_pack', 'food dataset');
  assert(Array.isArray(brief.criteria), 'criteria array');
  assert(
    brief.criteria.some((c) => /steak|angus/i.test(c.key)),
    'criteria from mustHaves',
  );
}

{
  const req: PitchRequest = {
    requestId: 'r1',
    title: 'steak',
    context: 'steak essen',
    kind: 'food',
    searchMode: 'here_now',
    visitAtMs: Date.now(),
    wishes: [{ text: 'steak', hardness: 'must', kind: 'dish' }],
    prefs: {},
    anchor: { lat: 53.55, lng: 9.99 },
    uiLayout: 'live_split',
  };
  const pool: PitchCandidate[] = [
    {
      name: 'Bulls Steakhouse',
      lat: 53.55,
      lng: 9.99,
      mapsUrl: 'https://maps.google.com',
      rating: 4.5,
      ratingCount: 200,
      source: 'places',
      softTags: ['steak', 'steakhouse'],
      hardEvidence: ['steak'],
      distFromAnchorM: 3000,
      openNow: true,
    },
    {
      name: 'Döner Palace',
      lat: 53.551,
      lng: 9.991,
      mapsUrl: 'https://maps.google.com',
      rating: 4.9,
      ratingCount: 800,
      source: 'places',
      softTags: ['döner', 'imbiss'],
      distFromAnchorM: 200,
      openNow: true,
    },
    {
      name: 'Closed Steak',
      lat: 53.55,
      lng: 9.99,
      mapsUrl: 'https://maps.google.com',
      rating: 4.8,
      ratingCount: 100,
      source: 'places',
      softTags: ['steak'],
      hardEvidence: ['steak'],
      distFromAnchorM: 500,
      openNow: false,
    },
  ];
  const ranked = rankCandidatesForUser(req, pool);
  assert(ranked[0]!.c.name.includes('Bulls'), 'open steakhouse ranks over döner');
  assert(
    ranked.find((r) => /döner/i.test(r.c.name))!.score <
      ranked.find((r) => /Bulls/i.test(r.c.name))!.score,
    'döner below steakhouse for steak wish',
  );
  const short = shortlistTopN(req, pool, 5);
  assert(short.length <= 5, 'shortlist max 5');
  assert(detectPitchKind('Döner bitte') === 'food', 'döner kind food');
}

console.log('searchBrief.smoke.test.ts ok');
