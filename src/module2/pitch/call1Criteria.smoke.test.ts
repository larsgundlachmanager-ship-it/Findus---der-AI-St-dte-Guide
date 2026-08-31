/**
 * Call-1 criteria + ranking weights smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/call1Criteria.smoke.test.ts
 */
import {
  criteriaFromMustHaves,
  formatCall1CriteriaForPrompt,
  looksLikeVenueCriterionKey,
  mergeCall1Criteria,
  parseCall1Criteria,
  visitAtMsFromCall1When,
} from './call1Criteria';
import { buildPitchSearchBrief } from './searchBrief';
import { rankCandidatesForUser, shortlistTopN } from './candidateRank';
import { parseWishesFromText } from './parentBrief';
import type { PitchCandidate, PitchRequest } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  assert(!looksLikeVenueCriterionKey('terrasse'), 'terrasse ok');
  assert(
    looksLikeVenueCriterionKey('Einhorn Restaurant'),
    'venue name rejected',
  );
}

{
  const parsed = parseCall1Criteria([
    { key: 'terrasse', role: 'must', weight: 20 },
    { key: 'spaziergang_nah', role: 'nice', weight: 18 },
    { key: 'Einhorn Restaurant', role: 'must', weight: 2 },
  ]);
  assert(parsed.length === 2, 'venue stripped');
  assert(parsed[0]!.weight === 20, 'terrasse 20');
  assert(parsed[1]!.key === 'spaziergang_nah', 'walk criterion');
}

{
  const merged = mergeCall1Criteria({
    criteria: [{ key: 'terrasse', role: 'must', weight: 20 }],
    mustHaves: ['Terrasse', 'vegan'],
  });
  assert(
    merged.some((c) => /vegan/i.test(c.key)),
    'mustHave vegan appended',
  );
  assert(criteriaFromMustHaves(['Steak'])[0]!.weight === 20, 'default must 20');
}

{
  const ms = visitAtMsFromCall1When([
    { kind: 'day', dateKey: '2026-08-30', at: null },
    { kind: 'clock', at: '19:00', dateKey: '2026-08-30' },
  ]);
  assert(typeof ms === 'number' && ms > 0, 'visitAt from when');
  const d = new Date(ms!);
  assert(d.getHours() === 19, '19:00');
  assert(d.getFullYear() === 2026, 'year');
}

{
  const brief = buildPitchSearchBrief({
    userText: 'Abendessen mit Terrasse, lieber zu Fuß',
    kind: 'food',
    baseWishes: parseWishesFromText('Abendessen mit Terrasse'),
    call1MustHaves: ['Terrasse'],
    call1Criteria: [
      { key: 'terrasse', role: 'must', weight: 20 },
      { key: 'spaziergang_nah', role: 'nice', weight: 18 },
      { key: 'abend_offen', role: 'must', weight: 15 },
    ],
    authorIntent: 'Top-2 mit Terrasse fußläufig',
  });
  assert(brief.shortlistSize === 5, 'shortlist 5');
  assert(brief.criteria.length >= 2, 'criteria kept');
  assert(
    brief.wishes.some((w) => /terrasse/i.test(w.text) && w.weight === 20),
    'wish weight from criteria',
  );
  assert(
    /CALL1_CRITERIA/.test(formatCall1CriteriaForPrompt(brief.criteria)),
    'prompt block',
  );
}

{
  const req: PitchRequest = {
    requestId: 'r1',
    title: 'terrasse',
    context: 'Abendessen mit Terrasse',
    kind: 'food',
    searchMode: 'here_now',
    visitAtMs: Date.now(),
    wishes: [{ text: 'terrasse', hardness: 'must', kind: 'vibe', weight: 20 }],
    prefs: {},
    anchor: { lat: 53.55, lng: 9.99 },
    uiLayout: 'live_split',
    call1Criteria: [
      { key: 'terrasse', role: 'must', weight: 20 },
      { key: 'spaziergang_nah', role: 'nice', weight: 18 },
    ],
    shortlistSize: 5,
  };
  const pool: PitchCandidate[] = [
    {
      name: 'Einhorn Terrasse',
      lat: 53.55,
      lng: 9.99,
      mapsUrl: 'https://maps.google.com',
      rating: 4.2,
      ratingCount: 80,
      source: 'places',
      softTags: ['terrasse'],
      hardEvidence: ['terrasse'],
      distFromAnchorM: 400,
      openNow: true,
    },
    {
      name: 'Weit Weg Steak',
      lat: 53.6,
      lng: 10.1,
      mapsUrl: 'https://maps.google.com',
      rating: 4.9,
      ratingCount: 900,
      source: 'places',
      softTags: ['steak'],
      hardEvidence: ['steak'],
      distFromAnchorM: 8000,
      openNow: true,
    },
    {
      name: 'Nah Bistro',
      lat: 53.551,
      lng: 9.991,
      mapsUrl: 'https://maps.google.com',
      rating: 4.8,
      ratingCount: 500,
      source: 'places',
      softTags: ['bistro'],
      distFromAnchorM: 200,
      openNow: true,
    },
  ];
  const ranked = rankCandidatesForUser(req, pool);
  assert(
    ranked[0]!.c.name.includes('Einhorn'),
    'terrasse+nah wins over far steak',
  );
  assert(ranked[0]!.factors.call1 > 0, 'call1 factor used');
  const short = shortlistTopN(req, pool);
  assert(short.length <= 5, 'max 5');
  assert(short[0]!.name.includes('Einhorn'), 'shortlist lead');
}

console.log('call1Criteria.smoke.test.ts ok');
