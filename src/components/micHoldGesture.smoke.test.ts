/**
 * Run: npx --yes tsx src/components/micHoldGesture.smoke.test.ts
 */

import {
  resolveMicHoldSwipe,
  resolveMicHoldSwipeOnRelease,
} from './micHoldGesture';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(resolveMicHoldSwipe(40, 0) === 'lock', 'rechts 40 = lock');
assert(resolveMicHoldSwipe(56, 10) === 'lock', 'rechts diagonal = lock');
assert(resolveMicHoldSwipe(-40, 4) === 'live', 'links = live');
assert(resolveMicHoldSwipe(20, 0) === null, 'zu kurz');
assert(resolveMicHoldSwipe(50, 80) === null, 'eher vertikal');
assert(resolveMicHoldSwipeOnRelease(32, 8) === 'lock', 'release lock');
assert(resolveMicHoldSwipeOnRelease(-32, 0) === 'live', 'release live');
assert(resolveMicHoldSwipeOnRelease(10, 0) === null, 'release zu kurz');

console.log('micHoldGesture.smoke.test.ts OK');
