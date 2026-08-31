/**
 * Run: npx --yes tsx src/services/research/extractSpokenClock.test.ts
 */
import { extractSpokenClock } from './extractSpokenClock';
import { formatClockFromMin, hoursSpeechHint } from '../../module2/agents/placeHoursFit';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(extractSpokenClock('ab 21 Uhr') === '21:00', 'ab 21 Uhr');
assert(extractSpokenClock('Start 20:00') === '20:00', '20:00');
assert(extractSpokenClock('heute 17.30 Uhr') === '17:30', '17.30');
assert(extractSpokenClock('um 9 Uhr 15') === '09:15', '9 Uhr 15');
assert(extractSpokenClock('Party im Hafen') === null, 'no clock stays null');
assert(extractSpokenClock('2026 Festival') === null, 'year is not a clock');
assert(extractSpokenClock('20:00') === '20:00', 'bare clock');

assert(formatClockFromMin(600) === '10:00', '600 min = 10:00');
assert(formatClockFromMin(22 * 60 + 30) === '22:30', '22:30');
assert(
  hoursSpeechHint({ opensAtMin: 600, closesAtMin: 1320, openNow: true }) ===
    'heute 10:00–22:00 Uhr',
  'hours speech uses clocks not raw minutes',
);

console.log('extractSpokenClock.test.ts OK');
