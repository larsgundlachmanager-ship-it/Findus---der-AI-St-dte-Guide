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
  clampBridgeWords,
  buildPitchParentBridge,
  countWords,
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
  'searchMode on_route when nav',
  resolveSearchMode({
    text: 'wo kann man gut essen',
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
  const bridge = clampBridgeWords(
    buildPitchParentBridge({
      searchMode: 'here_now',
      kind: 'food',
      cityBest: false,
    }),
  );
  const w = countWords(bridge);
  ok(`bridge words 8–22 (got ${w})`, w >= 8 && w <= 22);
}

{
  const wishes = parseWishesFromText('Ich will Pannfisch und einen Biergarten');
  ok(
    'dish wish parsed',
    wishes.some((x) => /pannfisch/i.test(x.text)),
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

ok(
  'handoff pizza',
  shouldHandoffToPitchModule('Wo kann ich gut Pizza essen?'),
);
ok(
  'no handoff pure plan',
  !shouldHandoffToPitchModule('Plane mir den ganzen Tag Timeline'),
);

console.log(`\nPITCH GATE GRÜN (${passed} checks)`);
