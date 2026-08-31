/**
 * Dining pitch: parking never food; steak/cuisine must-haves parse + score + rank.
 * Run: npm exec --yes --package tsx -- tsx src/module2/pitch/diningPitch.smoke.test.ts
 */
import { parseWishesFromText } from './parentBrief';
import { isGroceryOrMarketCounterVenue, isParkingOrForestLotVenue } from './nonFoodVenueGate';
import { scoreSpecializedFoodWish, queryNeedsLiveFoodResearch } from './specializedFoodMatch';
import { filterAndRank } from './wishFilterRank';
import { mixLiveResearchSeed } from './liveFoodResearch';
import { buildLiveResearchVenue } from '../../services/research/persistLiveResearch';
import { pitchHeadlineFromContext } from './pitchHeadline';
import { namedVenueFromWishes } from './namedVenueIntent';
import type { PitchCandidate, PitchRequest } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isParkingOrForestLotVenue('Waldparkplatz am Forst', ['park', 'food']),
  'compound Waldparkplatz is parking',
);
assert(
  isParkingOrForestLotVenue('Wanderparkplatz', 'amenity=parking'),
  'Wanderparkplatz is parking',
);
assert(
  isParkingOrForestLotVenue('Parkplatz Forst', ['parking']),
  'parkplatz + type parking',
);
assert(
  !isParkingOrForestLotVenue('Landgasthof am See', ['restaurant']),
  'gasthof is not parking',
);

{
  const w = parseWishesFromText('wo kann man am besten steak essen?');
  assert(
    w.some((x) => x.kind === 'dish' && /steak/i.test(x.text) && x.hardness === 'must'),
    'best steak → must dish',
  );
}

{
  const w = parseWishesFromText('wo gibt es gutes veganes essen');
  assert(
    w.some((x) => x.kind === 'cuisine' && /vegan/i.test(x.text) && x.hardness === 'must'),
    'vegan → must cuisine',
  );
}

{
  const w = parseWishesFromText('asiatisch essen bitte');
  assert(
    w.some((x) => x.kind === 'cuisine' && /asia/i.test(x.text) && x.hardness === 'must'),
    'asian → must cuisine',
  );
}

{
  const w = parseWishesFromText(
    'irgendwo indisch heute Abend, authentisch heimisch nicht steril',
  );
  assert(
    w.some((x) => x.kind === 'cuisine' && /indisch/i.test(x.text) && x.hardness === 'must'),
    'indisch → must cuisine',
  );
  assert(
    w.some(
      (x) =>
        x.kind === 'vibe' &&
        /authentisch/i.test(x.text) &&
        x.hardness === 'nice',
    ),
    'authentisch → nice vibe (kein Hard-Wipe)',
  );
}

assert(
  scoreSpecializedFoodWish('Ganesha Indian Restaurant curry', {
    text: 'indisch',
    hardness: 'must',
    kind: 'cuisine',
  }) >= 3,
  'indian name is indisch evidence',
);
assert(
  queryNeedsLiveFoodResearch('indisch heute Abend Hamburg'),
  'indisch needs live places',
);

assert(
  scoreSpecializedFoodWish('steakhouse grill', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) >= 3,
  'steakhouse is steak evidence',
);
assert(
  scoreSpecializedFoodWish('grillhaus fleischerei', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 1,
  'grillhaus is category-only for steak',
);
assert(
  scoreSpecializedFoodWish('landgasthof restaurant', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 0,
  'generic gastro is not steak family',
);
assert(
  scoreSpecializedFoodWish('pizzeria roma pizza', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 0,
  'pizzeria is not a steak candidate',
);
assert(
  scoreSpecializedFoodWish('vegan bowls cafe', {
    text: 'vegan',
    hardness: 'must',
    kind: 'cuisine',
  }) >= 3,
  'vegan name matches',
);
assert(
  scoreSpecializedFoodWish('steakhouse grill', {
    text: 'vegan',
    hardness: 'must',
    kind: 'cuisine',
  }) === 0,
  'steakhouse is not vegan',
);

function foodReq(wishes: PitchRequest['wishes']): PitchRequest {
  return {
    requestId: 't',
    title: 'wo kann man am besten steak essen?',
    context: 'wo kann man am besten steak essen?',
    kind: 'food',
    searchMode: 'city_best',
    visitAtMs: Date.parse('2026-08-22T12:00:00+02:00'),
    wishes,
    prefs: {},
    anchor: { lat: 53.68, lng: 9.76 },
    uiLayout: 'live_split',
  };
}

function cand(name: string, extra: Partial<PitchCandidate> = {}): PitchCandidate {
  return {
    name,
    lat: 53.68,
    lng: 9.76,
    mapsUrl: 'https://maps.google.com/?cid=1',
    rating: 4.2,
    source: 'places',
    softTags: ['food', 'restaurant'],
    distFromAnchorM: 400,
    detourPrio: 1,
    openNow: true,
    ...extra,
  };
}

{
  const ranked = filterAndRank(foodReq([{ text: 'steak', hardness: 'must', kind: 'dish' }]), [
    cand('Waldparkplatz am Forst', {
      softTags: ['food', 'park', 'parking'],
      rating: 4.9,
    }),
    cand('Landgasthof Grill', {
      softTags: ['food', 'restaurant', 'steak', 'steakhouse'],
      rating: 4.6,
    }),
  ]);
  assert(
    !ranked.top.some((x) => /parkplatz/i.test(x.name)),
    'parking lot is not a food candidate',
  );
  assert(
    ranked.top.some((x) => /gasthof|grill/i.test(x.name)),
    'real gastro remains',
  );
}

{
  const ranked = filterAndRank(foodReq([{ text: 'steak', hardness: 'must', kind: 'dish' }]), [
    cand('Landgasthof am See', {
      softTags: ['food', 'restaurant'],
      rating: 4.4,
    }),
  ]);
  // Hard-Match: ohne Steak-Signal keine Fake-Familie (Verify/Retry holen Places neu)
  assert(
    ranked.top.length === 0 && ranked.softFail === true,
    'generic restaurant without steak signal → empty softFail (no fake)',
  );
}

{
  const ranked = filterAndRank(foodReq([{ text: 'steak', hardness: 'must', kind: 'dish' }]), [
    cand('Pizzeria Roma', { softTags: ['food', 'pizza'] }),
    cand('Sushi Bar', { softTags: ['food', 'sushi'] }),
  ]);
  assert(
    ranked.softFail && ranked.top.length === 0,
    'steak without steak family → empty (no pizza/sushi substitute)',
  );
}

{
  const ranked = filterAndRank(foodReq([{ text: 'steak', hardness: 'must', kind: 'dish' }]), [
    cand('Landgasthof Grill', {
      softTags: ['food', 'restaurant', 'steak', 'steakhouse'],
      rating: 4.5,
      openNow: false,
      closedOnVisitDay: true,
    }),
  ]);
  assert(ranked.top.length >= 1, 'closed venues still get pitched');
  assert(ranked.softFail, 'closed now is honest soft-fail');
  assert(
    /morgen/i.test(ranked.reason ?? ''),
    'closed now points to tomorrow',
  );
}

{
  const ranked = filterAndRank(
    foodReq([{ text: 'vegan', hardness: 'must', kind: 'cuisine' }]),
    [
      cand('Pizzeria Roma', { softTags: ['food', 'pizza'] }),
      cand('Green Bowl', { softTags: ['food', 'restaurant', 'vegan'] }),
    ],
  );
  assert(
    !ranked.top.some((x) => /pizzeria/i.test(x.name)),
    'vegan cuisine drops unrelated pizzeria',
  );
  assert(
    ranked.top.some((x) => /bowl/i.test(x.name)),
    'vegan cuisine keeps vegan venue',
  );
}

{
assert(
  queryNeedsLiveFoodResearch('wo kann man am besten steak essen?'),
  'steak wants live research',
);
assert(queryNeedsLiveFoodResearch('veganes essen bitte'), 'vegan wants live research');
assert(
  queryNeedsLiveFoodResearch('Ich möchte Hamburger Pannenfisch essen'),
  'pannenfisch wants live research',
);
  assert(
    !queryNeedsLiveFoodResearch('wo kann man essen gehen'),
    'generic eat does not force live research',
  );

  const req = foodReq([{ text: 'steak', hardness: 'must', kind: 'dish' }]);
  const genericPack = cand('Dorfwirtschaft', {
    source: 'pack',
    softTags: ['food', 'restaurant'],
    rating: 4.8,
    distFromAnchorM: 200,
  });
  const liveReviewHit = cand('Gasthof am See', {
    source: 'places',
    softTags: ['food', 'restaurant'],
    rating: 4.3,
    distFromAnchorM: 3500,
  });
  const seed = mixLiveResearchSeed(req, [genericPack, liveReviewHit], [genericPack], 12);
  assert(
    seed.some((c) => c.source === 'places' && /gasthof/i.test(c.name)),
    'live places stay in verify seed even if pack ranked first',
  );
}

{
  const draft = buildLiveResearchVenue(
    cand('Landgasthof am See', {
      hookNotes: ['Leckeres Steak, Filet gegrillt, super Sättigungsbeilage.'],
      websiteUrl: 'https://venue.example/speisekarte',
    }),
  );
  assert(draft?.tags.includes('steak'), 'live research draft tags steak from reviews');
  assert(
    draft?.facts.some((f) => /steak/i.test(f.text) && !/\d+\s*€/.test(f.text)),
    'facet fact has no prices',
  );
  assert(
    buildLiveResearchVenue(
      cand('Waldparkplatz', { softTags: ['parking', 'food'] }),
    ) == null,
    'parking is not persisted into the dataset',
  );
}

assert(
  isGroceryOrMarketCounterVenue('Marktkauf', ['supermarket', 'food']),
  'Marktkauf is grocery',
);
assert(
  isGroceryOrMarketCounterVenue('Bäckerei Allwörden Marktkauf', ['bakery', 'food']),
  'market bakery counter is grocery',
);
assert(
  !isGroceryOrMarketCounterVenue('BEKUN Restaurant', ['restaurant', 'food']),
  'asia restaurant is not grocery',
);

{
  const req: PitchRequest = {
    ...foodReq([{ text: 'asiatisch', hardness: 'must', kind: 'cuisine' }]),
    title: 'asiatisch essen bitte',
    context: 'asiatisch essen bitte',
    searchMode: 'here_now',
    visitAtMs: Date.parse('2026-08-23T23:55:00+02:00'),
    stayMin: 75,
  };
  const ranked = filterAndRank(req, [
    cand('Marktkauf', {
      softTags: ['food', 'supermarket', 'asia'],
      rating: 4.1,
      openNow: true,
    }),
    cand('Bäckerei Allwörden', {
      softTags: ['food', 'bakery', 'marktkauf'],
      rating: 4.4,
      openNow: true,
    }),
    cand('BEKUN Restaurant', {
      softTags: ['food', 'restaurant', 'asiatisch', 'sushi'],
      rating: 4.3,
      openNow: true,
      closesAtMin: 23 * 60 + 59,
    }),
  ]);
  assert(
    !ranked.top.some((x) => /marktkauf|allwörden/i.test(x.name)),
    'grocery is not an asia restaurant',
  );
  assert(
    !ranked.outOfBox || !/marktkauf|allwörden/i.test(ranked.outOfBox.name),
    'grocery is not out-of-box for asia',
  );
}

{
  const late = new Date();
  late.setHours(23, 55, 0, 0);
  if (late.getTime() <= Date.now() + 60_000) late.setDate(late.getDate() + 1);
  const req: PitchRequest = {
    ...foodReq([{ text: 'asiatisch', hardness: 'must', kind: 'cuisine' }]),
    title: 'asiatisch essen',
    searchMode: 'here_now',
    visitAtMs: late.getTime(),
    stayMin: 75,
  };
  const ranked = filterAndRank(req, [
    cand('Sushi Bar Mitternacht', {
      softTags: ['food', 'restaurant', 'sushi', 'asiatisch'],
      rating: 4.6,
      openNow: true,
      closesAtMin: 0,
    }),
  ]);
  assert(
    !ranked.top.some((x) => /sushi/i.test(x.name)),
    'place closing at midnight is too tight at 23:55',
  );
}

{
  assert(
    scoreSpecializedFoodWish('spezialität hamburger pannfisch', {
      text: 'pannfisch',
      hardness: 'must',
      kind: 'dish',
    }) >= 3,
    'specialty pannfisch is hard evidence',
  );
  assert(
    scoreSpecializedFoodWish('fischrestaurant seafood', {
      text: 'pannfisch',
      hardness: 'must',
      kind: 'dish',
    }) === 1,
    'fish restaurant is family fallback',
  );
  assert(
    scoreSpecializedFoodWish('vegan bowls cafe', {
      text: 'pannfisch',
      hardness: 'must',
      kind: 'dish',
    }) === 0,
    'vegan cafe is not a pannfisch candidate',
  );

  const ranked = filterAndRank(
    {
      ...foodReq([{ text: 'pannfisch', hardness: 'must', kind: 'dish' }]),
      title: 'Hamburger Pannfisch',
      context: 'Ich möchte Hamburger Pannfisch essen',
    },
    [
      cand('Erdapfel Hamburg', {
        softTags: ['food', 'restaurant', 'vegan'],
        rating: 4.5,
      }),
      cand('Alt Helgoländer Fischerstube', {
        softTags: ['food', 'restaurant', 'fisch', 'pannfisch'],
        hookNotes: ['Spezialität: hamburger pannfisch'],
        rating: 4.7,
      }),
    ],
  );
  assert(
    !ranked.top.some((x) => /erdapfel/i.test(x.name)),
    'vegan soulfood is not a fish fallback',
  );
  assert(
    ranked.top.some((x) => /fischerstube|helgoländer/i.test(x.name)),
    'fish restaurant with pannfisch stays',
  );
}

{
  const venueReq: PitchRequest = {
    ...foodReq([{ text: 'Herzstück', hardness: 'must', kind: 'venue' }]),
    title: 'Empfehlung für das Herzstück',
    context: 'Empfehlung für das Herzstück',
    cityHint: 'Prisdorf',
  };
  assert(
    namedVenueFromWishes(venueReq.wishes) === 'Herzstück',
    'named venue wish is the restaurant',
  );
  assert(
    !/heute in/i.test(
      pitchHeadlineFromContext({
        userText: 'Empfehlung für das Herzstück',
        city: 'Prisdorf',
      }),
    ),
    'named venue headline is not GPS-city heute',
  );
  const ranked = filterAndRank(venueReq, [
    cand('Erdapfel Hamburg', {
      softTags: ['food', 'restaurant', 'vegan'],
      rating: 4.8,
      distFromAnchorM: 25000,
    }),
    cand('Herzstück', {
      softTags: ['food', 'restaurant'],
      rating: 4.4,
      distFromAnchorM: 28000,
    }),
  ]);
  assert(
    ranked.top.some((x) => /herzstück/i.test(x.name)),
    'named venue keeps the named restaurant',
  );
  assert(
    !ranked.top.some((x) => /erdapfel/i.test(x.name)),
    'named venue does not substitute a vegan nearby pitch',
  );
  assert(queryNeedsLiveFoodResearch('Empfehlung für das Herzstück'), 'named venue wants live research');
}

console.log('diningPitch.smoke.test.ts ok');
