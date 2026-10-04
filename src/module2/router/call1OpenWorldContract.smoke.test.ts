/**
 * Open-World Vertrag + AYCE hard-match + uiRequirements.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1OpenWorldContract.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildOpenWorldContract,
  filterCuratedContextForWorkers,
  formatOpenWorldContractForPrompt,
  inferSearchPlan,
  inferUiRequirements,
} from './call1OpenWorldContract';
import { looksLikeAyceQuery, normalizeAyceStt } from '../pitch/ayceIntent';
import { buildCall1TaskBrief } from './call1TaskBrief';
import type { ManagerAnalysis } from './types';
import { diningExpandRingsFor, AYCE_LIVE_EXPAND_RINGS_M } from '../pitch/searchBrief';

assert.ok(looksLikeAyceQuery('Euer Ken Eat essen gehen'), 'Ken Eat STT');
assert.ok(looksLikeAyceQuery('Oyukin-Eat heute Abend'), 'Oyukin STT');
assert.ok(looksLikeAyceQuery('Eurokinit Eat kein Asiatisch'), 'Eurokinit STT');
assert.equal(
  normalizeAyceStt('Ken Eat bitte').includes('all you can eat'),
  true,
  'normalize Ken Eat',
);

const ow = buildOpenWorldContract({
  userText: 'Ich möchte all you can eat, kein Asiatisch',
  authorIntent: 'AYCE ohne Asia',
  bridge: 'Alles klar — ich suche All-you-can-eat ohne asiatische Küche.',
});
assert.ok(ow.must.some((m) => /ayce|all_you_can_eat/i.test(m)), 'must ayce');
assert.ok(ow.avoid.some((a) => /asian|asiatisch/i.test(a)), 'avoid asian');
assert.equal(ow.stopPolicy.forbidSoftFillOnMust, true, 'no soft fill');
assert.equal(ow.searchPlan.maxRadiusKm, 100, '100km specialty');
assert.equal(ow.uiRequirements.maxBullets, 3, '3 bullets');
assert.equal(ow.uiRequirements.bulletMaxLines, 2, '2 lines');
assert.ok(ow.uiRequirements.needMenuUrl, 'menu url for dining');
assert.ok(ow.uiRequirements.showPriceInBullets, 'price bullets dining');
assert.equal(ow.uiRequirements.openCalendar, false, 'no auto calendar');
assert.ok(ow.bridgeIntentMirror, 'bridge mirror');
assert.ok(formatOpenWorldContractForPrompt(ow).includes('OPEN_WORLD'), 'prompt fmt');
assert.ok(ow.mission, 'mission checklist attached');
assert.ok(
  formatOpenWorldContractForPrompt(ow).includes('MISSION_CHECKLIST'),
  'mission in prompt',
);
assert.equal(ow.mission.family, 'place', 'ayce → place mission');
assert.ok(!ow.mission.askBack, 'ayce no askBack');

const hop = inferSearchPlan('Hop-on Hop-off Bus Tickets Hamburg');
assert.ok(hop.preferDeepWebOnNovel, 'novel deep web');
assert.equal(hop.maxRadiusKm, 100, 'hop radius');

const uiHotel = inferUiRequirements('Hotel für heute Abend noch');
assert.ok(uiHotel.needBookingLink || uiHotel.needMaps, 'hotel ui');

const filtered = filterCuratedContextForWorkers(
  ['Musts: all_you_can_eat', 'Event: große Party heute', 'Research-Stadt: Hamburg'],
  'all you can eat essen',
);
assert.ok(
  filtered.every((l) => !/\bEvent: große Party\b/i.test(l)),
  'no events leak on dining follow-up',
);

const rings = diningExpandRingsFor({
  wishes: [{ text: 'all_you_can_eat', kind: 'amenity', hardness: 'must' }],
});
assert.deepEqual([...rings], [...AYCE_LIVE_EXPAND_RINGS_M], 'ayce rings to 100km');

const analysis = {
  bridge: 'Verstanden — All-you-can-eat ohne Asia.',
  bridgeComplete: false,
  session: 'new',
  authorIntent: 'AYCE',
  intentSummary: 'AYCE',
  mustHaves: ['all_you_can_eat'],
  frame: { tasks: [], mustHaves: ['all_you_can_eat'], referents: [], thinkAhead: [] },
} as unknown as ManagerAnalysis;

const brief = buildCall1TaskBrief({
  analysis,
  userText: 'Ken Eat heute Abend, kein Asiatisch',
});
assert.ok(brief.openWorld, 'brief has openWorld');
assert.equal(brief.openWorld.stopPolicy.forbidSoftFillOnMust, true);
assert.ok(
  brief.work.some((w) => w.worker === 'deep_web') ||
    brief.openWorld.novelRequiresDeepWeb,
  'novel/specialty deep web path',
);
assert.ok(!brief.askBack, 'just-do-it no askBack for dining');

console.log('call1OpenWorldContract.smoke.test.ts OK');
