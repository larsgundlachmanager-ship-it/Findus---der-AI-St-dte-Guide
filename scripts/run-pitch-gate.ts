/**
 * Pitch-Modul Gate — Detour-Heuristik, visitAt, city_best, Bridge-Wörter, Soft-Fail.
 * Run: npx tsx scripts/run-pitch-gate.ts
 */

import assert from 'node:assert/strict';
import {
  scoreDetourOnRoute,
  hereNowPrio,
  HERE_NOW_RINGS_M,
  DETOUR_PRIO_BANDS_MIN,
} from '../src/module2/pitch/detourHeuristic';
import {
  detectCityBestIntent,
  resolveSearchMode,
  resolveVisitAtMs,
  buildPitchParentBridge,
  parseWishesFromText,
} from '../src/module2/pitch/parentBrief';
import { filterAndRank } from '../src/module2/pitch/wishFilterRank';
import { shouldHandoffToPitchModule } from '../src/module2/pitch/shouldHandoffPitch';
import type { PitchCandidate, PitchRequest } from '../src/module2/pitch/types';

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log('OK', name);
}

// Detour: Ort auf dem Weg vs. weit abseits
{
  const route = {
    start: { lat: 53.55, lng: 9.99 },
    end: { lat: 53.56, lng: 10.02 },
    user: { lat: 53.55, lng: 9.99 },
  };
  const onPath = scoreDetourOnRoute(
    { lat: 53.555, lng: 10.005 },
    route,
  );
  const far = scoreDetourOnRoute({ lat: 53.6, lng: 10.1 }, route);
  ok('on-path better prio than far', onPath.prio < far.prio);
  ok('extra_min finite', Number.isFinite(onPath.extraMin));
}

ok('here_now 100m → prio 1', hereNowPrio(100) === 1);
ok(
  'here_now past last ring → 6',
  hereNowPrio(HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1]! + 500) === 6,
);
ok('detour bands length 5', DETOUR_PRIO_BANDS_MIN.length === 5);

ok(
  'city_best explicit',
  detectCityBestIntent('Such mir den besten Italiener der Stadt'),
);
ok(
  'city_best not for plain italian',
  !detectCityBestIntent('Ich will irgendwo italienisch essen'),
);

ok(
  'searchMode city_best',
  resolveSearchMode({
    text: 'den besten Italiener in Hamburg',
    hasActiveNav: false,
    hasTimelineNext: false,
  }) === 'city_best',
);
ok(
  'searchMode here_now',
  resolveSearchMode({
    text: 'Ich will jetzt was essen',
    hasActiveNav: false,
    hasTimelineNext: false,
  }) === 'here_now',
);
ok(
  'searchMode here_now even with nav unless explicit route',
  resolveSearchMode({
    text: 'wo kann man gut essen',
    hasActiveNav: true,
    hasTimelineNext: false,
  }) === 'here_now',
);
ok(
  'searchMode on_route when user asks along the way',
  resolveSearchMode({
    text: 'wo kann man auf dem Weg gut essen',
    hasActiveNav: true,
    hasTimelineNext: false,
  }) === 'on_route',
);

{
  const morning = new Date();
  morning.setHours(10, 0, 0, 0);
  const visit = resolveVisitAtMs('Abendessen um 18 Uhr', morning.getTime());
  const d = new Date(visit);
  ok('visitAt 18:00', d.getHours() === 18);
}

{
  const bridge = buildPitchParentBridge({
    searchMode: 'here_now',
    kind: 'food',
    cityBest: false,
  });
  ok('parent does not emit wait-floskel', !bridge.trim());
}

{
  const wishes = parseWishesFromText('Ich will Pannfisch und einen Biergarten');
  ok(
    'dish wish parsed',
    wishes.some((x) => /pannfisch/i.test(x.text)),
  );
}
{
  const wishes = parseWishesFromText('Ich möchte Hamburger Pannenfisch essen');
  ok(
    'pannenfisch canonicalizes',
    wishes.some((x) => x.kind === 'dish' && x.text === 'pannfisch'),
  );
}

{
  const req = {
    requestId: 't',
    title: 'Pizza',
    context: 'jetzt pizza',
    kind: 'food' as const,
    searchMode: 'here_now' as const,
    visitAtMs: Date.now(),
    wishes: [{ text: 'pizza', hardness: 'must' as const, kind: 'cuisine' }],
    prefs: {},
    anchor: { lat: 53.55, lng: 10 },
    uiLayout: 'live_split' as const,
  } satisfies PitchRequest;

  const pool: PitchCandidate[] = [
    {
      name: 'Pizzeria A',
      lat: 53.55,
      lng: 10.001,
      mapsUrl: 'https://maps.google.com',
      rating: 4.6,
      source: 'places',
      softTags: ['food', 'pizza'],
      distFromAnchorM: 200,
      detourPrio: 1,
      openNow: true,
    },
    {
      name: 'Closed Shop',
      lat: 53.55,
      lng: 10.002,
      mapsUrl: 'https://maps.google.com',
      rating: 4.9,
      source: 'places',
      softTags: ['food'],
      distFromAnchorM: 150,
      detourPrio: 1,
      openNow: false,
    },
  ];
  const ranked = filterAndRank(req, pool);
  ok('closed filtered when now', !ranked.top.some((t) => t.name === 'Closed Shop'));
  ok('softFail empty pool', filterAndRank(req, []).softFail === true);
}

{
  const steakReq = {
    requestId: 'steak',
    title: 'wo kann man am besten steak essen?',
    context: 'wo kann man am besten steak essen?',
    kind: 'food' as const,
    searchMode: 'city_best' as const,
    visitAtMs: Date.parse('2026-08-22T12:00:00+02:00'),
    wishes: [{ text: 'steak', hardness: 'must' as const, kind: 'dish' }],
    prefs: {},
    anchor: { lat: 53.68, lng: 9.76 },
    uiLayout: 'live_split' as const,
  } satisfies PitchRequest;
  const steakPool: PitchCandidate[] = [
    {
      name: 'Waldparkplatz am Forst',
      lat: 53.68,
      lng: 9.761,
      mapsUrl: 'https://maps.google.com',
      rating: 4.9,
      source: 'places',
      softTags: ['food', 'park', 'parking'],
      distFromAnchorM: 200,
      detourPrio: 1,
      openNow: true,
    },
    {
      name: 'Landgasthof Grill',
      lat: 53.681,
      lng: 9.762,
      mapsUrl: 'https://maps.google.com',
      rating: 4.6,
      source: 'places',
      softTags: ['food', 'restaurant', 'steakhouse', 'steak'],
      distFromAnchorM: 400,
      detourPrio: 1,
      openNow: true,
    },
    {
      name: 'Pizzeria Roma',
      lat: 53.682,
      lng: 9.763,
      mapsUrl: 'https://maps.google.com',
      rating: 4.8,
      source: 'places',
      softTags: ['food', 'pizza'],
      distFromAnchorM: 300,
      detourPrio: 1,
      openNow: true,
    },
  ];
  const steakRanked = filterAndRank(steakReq, steakPool);
  ok(
    'parking lot never a food candidate',
    !steakRanked.top.some((x) => /parkplatz/i.test(x.name)),
  );
  ok(
    'steak keeps gastro with evidence',
    steakRanked.top.some((x) => /gasthof|grill/i.test(x.name)),
  );
  ok(
    'steak must-have filters non-matching pizzeria',
    !steakRanked.top.some((x) => /pizzeria/i.test(x.name)),
  );
  {
    const withDoener: PitchCandidate[] = [
      ...steakPool,
      {
        name: 'Döner Palace',
        lat: 53.683,
        lng: 9.764,
        mapsUrl: 'https://maps.google.com',
        rating: 4.95,
        source: 'places',
        softTags: ['food', 'döner', 'imbiss', 'kebab'],
        distFromAnchorM: 150,
        detourPrio: 1,
        openNow: true,
      },
    ];
    const ranked = filterAndRank(steakReq, withDoener);
    ok(
      'steak never pitches döner as soft-fail',
      !ranked.top.some((x) => /döner|doener|kebab/i.test(x.name)),
    );
  }
  const veganReq = {
    ...steakReq,
    requestId: 'vegan',
    title: 'veganes essen',
    context: 'veganes essen',
    wishes: [{ text: 'vegan', hardness: 'must' as const, kind: 'cuisine' }],
  } satisfies PitchRequest;
  const veganRanked = filterAndRank(veganReq, [
    steakPool[2]!,
    {
      name: 'Green Bowl',
      lat: 53.68,
      lng: 9.76,
      mapsUrl: 'https://maps.google.com',
      rating: 4.5,
      source: 'places',
      softTags: ['food', 'restaurant', 'vegan'],
      distFromAnchorM: 250,
      detourPrio: 1,
      openNow: true,
    },
  ]);
  ok(
    'vegan cuisine drops pizzeria',
    !veganRanked.top.some((x) => /pizzeria/i.test(x.name)),
  );
  ok(
    'vegan cuisine keeps vegan venue',
    veganRanked.top.some((x) => /bowl/i.test(x.name)),
  );
}

ok(
  'handoff pizza',
  shouldHandoffToPitchModule('Wo kann ich gut Pizza essen?'),
);
ok(
  'handoff named venue recommendation',
  shouldHandoffToPitchModule('Empfehlung für das Herzstück'),
);
ok(
  'named venue wish extracted',
  parseWishesFromText('Empfehlung für das Herzstück').some(
    (w) => w.kind === 'venue' && /herzstück/i.test(w.text),
  ),
);
ok(
  'no handoff pure plan',
  !shouldHandoffToPitchModule('Plane mir den ganzen Tag Timeline'),
);

{
  const breedWishes = parseWishesFromText(
    'Restaurant mit Angus-Steak oder Wagyu in der Nähe',
  );
  ok(
    'angus dish wish parsed',
    breedWishes.some((w) => w.kind === 'dish' && /angus/i.test(w.text)),
  );
  const zugWishes = parseWishesFromText('Gibt es ein Zugrestaurant oder Speisewagen hier?');
  ok(
    'zugrestaurant amenity parsed',
    zugWishes.some((w) => w.kind === 'amenity' && /zugrestaurant/i.test(w.text)),
  );
}

{
  const angusReq = {
    requestId: 'angus',
    title: 'Angus Steak',
    context: 'Restaurant mit Angus-Fleisch',
    kind: 'food' as const,
    searchMode: 'city_best' as const,
    visitAtMs: Date.parse('2026-08-22T12:00:00+02:00'),
    wishes: [{ text: 'angus', hardness: 'must' as const, kind: 'dish' }],
    prefs: {},
    anchor: { lat: 53.55, lng: 10 },
    uiLayout: 'live_split' as const,
  } satisfies PitchRequest;
  const angusPool: PitchCandidate[] = [
    {
      name: 'Black Angus Grillhaus',
      lat: 53.55,
      lng: 10.001,
      mapsUrl: 'https://maps.google.com',
      rating: 4.7,
      source: 'places',
      softTags: ['food', 'restaurant', 'angus', 'steak', 'steakhouse'],
      distFromAnchorM: 200,
      detourPrio: 1,
      openNow: true,
    },
    {
      name: 'Pizzeria Roma',
      lat: 53.551,
      lng: 10.002,
      mapsUrl: 'https://maps.google.com',
      rating: 4.8,
      source: 'places',
      softTags: ['food', 'pizza'],
      distFromAnchorM: 180,
      detourPrio: 1,
      openNow: true,
    },
  ];
  const angusRanked = filterAndRank(angusReq, angusPool);
  ok(
    'angus keeps breed venue',
    angusRanked.top.some((x) => /angus/i.test(x.name)),
  );
  ok(
    'angus drops pizzeria',
    !angusRanked.top.some((x) => /pizzeria/i.test(x.name)),
  );
}

{
  const zugReq = {
    requestId: 'zug',
    title: 'Zugrestaurant',
    context: 'Speisewagen essen',
    kind: 'food' as const,
    searchMode: 'here_now' as const,
    visitAtMs: Date.now(),
    wishes: [{ text: 'zugrestaurant', hardness: 'must' as const, kind: 'amenity' }],
    prefs: {},
    anchor: { lat: 53.55, lng: 10 },
    uiLayout: 'live_split' as const,
  } satisfies PitchRequest;
  const zugPool: PitchCandidate[] = [
    {
      name: 'Restaurant Speisewagen',
      lat: 53.55,
      lng: 10.001,
      mapsUrl: 'https://maps.google.com',
      rating: 4.4,
      source: 'places',
      softTags: ['food', 'zugrestaurant', 'speisewagen'],
      distFromAnchorM: 300,
      detourPrio: 1,
      openNow: true,
    },
    {
      name: 'Bahnhof Imbiss',
      lat: 53.551,
      lng: 10.002,
      mapsUrl: 'https://maps.google.com',
      rating: 3.9,
      source: 'places',
      softTags: ['food', 'imbiss'],
      distFromAnchorM: 100,
      detourPrio: 1,
      openNow: true,
    },
  ];
  const zugRanked = filterAndRank(zugReq, zugPool);
  ok(
    'zugrestaurant keeps speisewagen',
    zugRanked.top.some((x) => /speisewagen/i.test(x.name)),
  );
  ok(
    'zugrestaurant drops bahnhof imbiss',
    !zugRanked.top.some((x) => /imbiss/i.test(x.name)),
  );
}

console.log(`\nPITCH GATE GRÜN (${passed} checks)`);
