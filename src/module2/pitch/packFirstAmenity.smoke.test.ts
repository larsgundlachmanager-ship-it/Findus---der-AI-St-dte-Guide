/**
 * Pack-first Amenities (WLAN/Steckdose) + Live-Writeback smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/packFirstAmenity.smoke.test.ts
 */
import { inferGastroFacetTags } from './gastroFacetTags';
import {
  parseCall1Criteria,
  criterionAliasKeys,
  normalizeAmenityCriterionKey,
} from './call1Criteria';
import { wishesFromMustHaves } from './searchBrief';
import { parseWishesFromText, detectPitchKind } from './parentBrief';
import { rankCandidatesForUser } from './candidateRank';
import { packLearnPolicy } from '../reboot/pipeline/packFirstLearn';
import type { PitchCandidate, PitchRequest } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const tags = inferGastroFacetTags(
    'Café Workspace',
    'free wifi Steckdose ruhig zum arbeiten',
  );
  assert(tags.includes('wlan'), 'facet wlan');
  assert(tags.includes('steckdose'), 'facet steckdose');
  assert(tags.includes('ruhig'), 'facet ruhig');
}

{
  assert(normalizeAmenityCriterionKey('wifi') === 'wlan', 'wifi→wlan');
  assert(
    normalizeAmenityCriterionKey('power_outlet') === 'steckdose',
    'power_outlet→steckdose',
  );
  assert(criterionAliasKeys('WLAN').includes('wifi'), 'alias wifi');
  const c = parseCall1Criteria([
    { key: 'wifi', role: 'must', weight: 20 },
    { key: 'power_outlet', role: 'must', weight: 18 },
  ]);
  assert(c.some((x) => x.key === 'wlan'), 'criteria wlan');
  assert(c.some((x) => x.key === 'steckdose'), 'criteria steckdose');
}

{
  const w = wishesFromMustHaves(['wifi', 'power_outlet', 'ruhig']);
  assert(w.some((x) => x.text === 'wlan' && x.kind === 'amenity'), 'wish wlan');
  assert(
    w.some((x) => x.text === 'steckdose' && x.kind === 'amenity'),
    'wish steckdose',
  );
  assert(w.some((x) => x.text === 'ruhig' && x.kind === 'vibe'), 'wish ruhig');
}

{
  const q =
    'Ich brauche WLAN und Steckdose, ruhig zum arbeiten';
  assert(detectPitchKind(q) === 'food', 'workspace → food pitch');
  const wishes = parseWishesFromText(q);
  assert(wishes.some((w) => w.text === 'wlan'), 'parse wlan');
  assert(wishes.some((w) => w.text === 'steckdose'), 'parse steckdose');
  assert(wishes.some((w) => w.text === 'ruhig'), 'parse ruhig');

  const req: PitchRequest = {
    requestId: 'amenity1',
    title: q,
    context: q,
    kind: 'food',
    searchMode: 'here_now',
    visitAtMs: Date.now(),
    wishes,
    call1Criteria: parseCall1Criteria([
      { key: 'wlan', role: 'must', weight: 20 },
      { key: 'steckdose', role: 'must', weight: 20 },
    ]),
    prefs: {},
    anchor: { lat: 53.55, lng: 9.99 },
    uiLayout: 'live_split',
  };
  // Places-Query-Bits (gleiche Heuristik wie candidatePool.queryFor food-Amenity)
  const amenBits = wishes
    .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'))
    .map((w) => w.text.toLowerCase());
  assert(amenBits.includes('wlan'), 'amenity bits wlan for places query');
  assert(amenBits.includes('steckdose'), 'amenity bits steckdose');

  const pool: PitchCandidate[] = [
    {
      name: 'Laut Bar',
      lat: 53.55,
      lng: 9.99,
      mapsUrl: 'https://maps.google.com',
      rating: 4.9,
      ratingCount: 500,
      source: 'places',
      softTags: ['food', 'bar'],
      distFromAnchorM: 100,
      openNow: true,
    },
    {
      name: 'Quiet Desk Café',
      lat: 53.551,
      lng: 9.991,
      mapsUrl: 'https://maps.google.com',
      rating: 4.2,
      ratingCount: 80,
      source: 'osm',
      softTags: ['food', 'cafe', 'wlan', 'steckdose', 'ruhig'],
      hardEvidence: ['wlan', 'steckdose'],
      distFromAnchorM: 400,
      openNow: true,
    },
  ];
  const ranked = rankCandidatesForUser(req, pool);
  assert(
    ranked[0]!.c.name.includes('Quiet Desk'),
    'wifi café ranks over loud bar',
  );

  // Writeback-Tags = dieselben Facetten (persistLiveResearch nutzt inferGastroFacetTags)
  const writeTags = inferGastroFacetTags(
    pool[1]!.name,
    (pool[1]!.softTags ?? []).join(' '),
  );
  assert(writeTags.includes('wlan'), 'writeback tag wlan');
  assert(writeTags.includes('steckdose'), 'writeback tag steckdose');

  assert(
    packLearnPolicy({
      userText: q,
      packHit: false,
      researchedHit: true,
      placeName: 'Quiet Desk Café',
    }) === 'write_pack',
    'policy write_pack for live hit',
  );
  assert(
    packLearnPolicy({
      userText: q,
      packHit: true,
      researchedHit: false,
      placeName: 'Pack Café',
    }) === 'use_pack',
    'policy use_pack when pack hit',
  );
}

console.log('packFirstAmenity.smoke.test.ts ok');
