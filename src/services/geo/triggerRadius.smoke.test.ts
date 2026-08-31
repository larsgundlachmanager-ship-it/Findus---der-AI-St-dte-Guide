/**
 * Run: npx --yes tsx src/services/geo/triggerRadius.smoke.test.ts
 */

import { effectiveTriggerRadiusM, geoKindRank, teasedApproachSpotKeys } from './triggerRadius';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  effectiveTriggerRadiusM({
    radius_meters: 12,
    kind: 'approach',
    tags_json: '["must_have","module1"]',
  }) >= 80,
  'must_have approach floor 80m',
);

assert(
  effectiveTriggerRadiusM({
    radius_meters: 18,
    kind: 'approach',
    tags_json: '["directory","amenity_skip"]',
  }) === 18,
  'directory approach keeps pack radius',
);

assert(
  effectiveTriggerRadiusM({
    radius_meters: 12,
    kind: 'area',
    tags_json: '["must_have"]',
    name: 'Marienkirche',
  }) >= 120,
  'large building area floor 120m',
);

assert(
  effectiveTriggerRadiusM({
    radius_meters: 12,
    kind: 'approach',
    tags_json: '["must_have"]',
    name: 'Filmhaus',
  }) >= 120,
  'large building approach floor 120m',
);

assert(
  geoKindRank({ kind: 'area' }, 'polygon') < geoKindRank({ kind: 'approach' }),
  'area ranks before approach',
);

assert(geoKindRank({ kind: 'sub' }) < geoKindRank({ kind: 'area' }), 'sub first');

const teased = teasedApproachSpotKeys(
  [
    { id: 1, kind: 'approach', spot_key: 'church' },
    { id: 2, kind: 'approach', spot_key: 'church' },
    { id: 3, kind: 'area', spot_key: 'church' },
  ],
  new Set([1]),
);
assert(teased.has('church'), 'spoken approach marks spot teased');
assert(teased.size === 1, 'only that spot');

console.log('triggerRadius.smoke.test.ts OK');
