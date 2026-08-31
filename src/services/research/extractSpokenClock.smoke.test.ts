/**
 * Run: npx --yes tsx src/services/research/extractSpokenClock.smoke.test.ts
 */
import { extractSpokenClock, extractSpokenEndClock } from './extractSpokenClock';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  extractSpokenEndClock('Ab 11 Uhr mit Live-Musik bis 23:30 Uhr') === '23:30',
  'end 23:30',
);
assert(extractSpokenClock('Ab 11 Uhr') === '11:00', 'start 11');
assert(
  extractSpokenEndClock('endet um 22 Uhr') === '22:00',
  'end 22 uhr',
);

console.log('extractSpokenClock.smoke.test.ts OK');
