/**
 * Run: npx --yes tsx src/services/navigation/navRetargetChoice.smoke.test.ts
 */

import { isSameNavTarget, buildNavRetargetChoice } from './navRetargetChoiceLogic';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isSameNavTarget(
    { name: 'Kindergarten', lat: 53.68, lng: 9.76, poiId: 12 },
    { name: 'Kindergarten', lat: 53.68, lng: 9.76, poiId: 12 },
  ),
  'gleiches Ziel',
);

assert(
  !isSameNavTarget(
    { name: 'Kindergarten', lat: 53.68, lng: 9.76, poiId: 12 },
    { name: 'Bäckerei', lat: 53.7, lng: 9.8, poiId: 99 },
  ),
  'anderes Ziel',
);

const choice = buildNavRetargetChoice({
  destName: 'Bäckerei',
  destLat: 53.7,
  destLng: 9.8,
  targetPoiId: 99,
});
assert(choice.actions.length === 2, 'zwei Buttons');
assert(
  choice.actions.some((a) => a.payload.replaceRoute === true),
  'Route neu',
);
assert(
  choice.actions.some((a) => a.payload.addStop === true),
  'Stopp hinzufügen',
);

console.log('navRetargetChoice.smoke.test.ts OK');
