/**
 * Run: npx --yes -p tsx@4.19.3 tsx src/services/ui/hudRemainLabel.smoke.ts
 */
import { formatHudRemain, sameLocalCalendarDay } from './hudRemainLabel';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  }
}

assert(formatHudRemain(42 * 60_000) === 'noch 42 Min', 'under 60 min');
assert(formatHudRemain(60 * 60_000) === 'noch 1 Std', 'exact hour');
assert(formatHudRemain(72 * 60_000) === 'noch 1 Std 12 Min', 'hour+min');
assert(formatHudRemain(1409 * 60_000) === 'noch 23 Std 29 Min', 'next-day dump');
assert(
  sameLocalCalendarDay(
    Date.parse('2026-08-23T21:04:00+02:00'),
    Date.parse('2026-08-23T20:33:00+02:00'),
  ),
  'same evening',
);
assert(
  !sameLocalCalendarDay(
    Date.parse('2026-08-23T21:04:00+02:00'),
    Date.parse('2026-08-24T20:33:00+02:00'),
  ),
  'next calendar day',
);

if (failed) {
  console.error(`hudRemainLabel smoke: ${failed} failed`);
  process.exit(1);
}
console.log('hudRemainLabel smoke: ok');
