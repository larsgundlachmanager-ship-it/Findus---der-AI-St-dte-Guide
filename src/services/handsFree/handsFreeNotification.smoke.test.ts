/**
 * Run: npx --yes tsx src/services/handsFree/handsFreeNotification.smoke.test.ts
 */

import { shouldShowHandsFreeSticky } from './handsFreeNotificationPolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  !shouldShowHandsFreeSticky({
    prefOn: true,
    locationFgsActive: true,
    os: 'android',
  }),
  'Android: Standort-Karte reicht, kein zweites Sprechen',
);
assert(
  shouldShowHandsFreeSticky({
    prefOn: true,
    locationFgsActive: false,
    os: 'android',
  }),
  'ohne GPS-FGS darf Sprechen in der Leiste stehen',
);
assert(
  !shouldShowHandsFreeSticky({
    prefOn: false,
    locationFgsActive: false,
    os: 'android',
  }),
  'Pref aus = keine Sticky',
);
assert(
  shouldShowHandsFreeSticky({
    prefOn: true,
    locationFgsActive: true,
    os: 'ios',
  }),
  'iOS hat keine FGS-Karte, Sticky bleibt',
);

console.log('handsFreeNotification.smoke.test.ts OK');
