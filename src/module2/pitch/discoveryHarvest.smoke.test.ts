/**
 * Smokes: Discovery Harvest gate + AYCE avoid query + Research path + Catalog.
 * Rein Node — kein RN.
 */
import assert from 'node:assert/strict';
import {
  shouldRunDiscoveryHarvest,
  harvestClaimsToSeedCandidates,
  filterHarvestClaims,
  type HarvestClaim,
} from './discoveryHarvest';

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'food',
    topLen: 2,
    softFail: false,
    checklist: [],
  }),
  false,
  'pack-perfect: no harvest',
);

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'food',
    topLen: 0,
    softFail: true,
  }),
  true,
  'gap: harvest',
);

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'food',
    topLen: 2,
    softFail: false,
    checklist: [{ status: 'soft_miss', key: 'all_you_can_eat' }],
  }),
  true,
  'hard soft_miss: harvest',
);

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'sight',
    topLen: 0,
    softFail: true,
  }),
  true,
  'sight gap: harvest',
);

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'generic',
    topLen: 1,
    softFail: true,
  }),
  true,
  'generic gap: harvest',
);

const claims: HarvestClaim[] = [
  {
    name: 'Mercedes AYCE',
    claims: ['griechisch', '29,90'],
    constraintFit: 'perfect',
  },
  {
    name: 'San Burrito',
    claims: ['tacos'],
    constraintFit: 'near_miss',
    rejectedReason: 'weekday_mismatch',
    ayceSchedule: 'Dienstag ab 17',
  },
];
const seeds = harvestClaimsToSeedCandidates(claims, { lat: 53.55, lng: 9.99 });
assert.ok(seeds.some((s) => /Mercedes/i.test(s.name)), 'perfect seed');
assert.ok(
  seeds.some((s) => (s.softTags ?? []).includes('near_miss')),
  'near_miss tagged',
);

{
  const mixed: HarvestClaim[] = [
    {
      name: 'Running Sushi Pan Asia',
      claims: ['all you can eat sushi'],
      constraintFit: 'perfect',
    },
    {
      name: 'Grillhaus Dubrovnik',
      claims: ['all you can eat buffet flatrate griechisch'],
      constraintFit: 'perfect',
    },
  ];
  const req = {
    kind: 'food',
    wishes: [{ text: 'all_you_can_eat', hardness: 'must', kind: 'amenity' }],
    prefs: { avoidCategories: ['asiatisch', 'sushi'] },
    title: 'AYCE kein Asiatisch',
    context: 'all you can eat kein asiatisch',
  } as Parameters<typeof filterHarvestClaims>[1];
  const kept = filterHarvestClaims(mixed, req);
  assert.ok(
    kept.some((c) => /dubrovnik/i.test(c.name)),
    'non-asia ayce kept',
  );
  assert.ok(
    !kept.some((c) => /sushi/i.test(c.name)),
    'asia ayce dropped on avoid',
  );
}

console.log('discoveryHarvest.smoke: ok');
