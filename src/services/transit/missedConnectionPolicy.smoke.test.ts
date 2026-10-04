/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/missedConnectionPolicy.smoke.test.ts
 */
import {
  HEAVY_DELAY_MIN,
  isDepartureClearlyMissed,
  pickMissedConnection,
  shouldAutoApplyMissedPick,
} from './missedConnectionPolicy';
import type { JourneyItinerary } from './journeyPlanner';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function fakeIt(
  line: string,
  depIso: string,
  arriveIso: string,
): JourneyItinerary {
  const start = new Date(depIso);
  const end = new Date(arriveIso);
  return {
    source: 'transitous',
    startTime: start,
    endTime: end,
    durationSec: Math.round((end.getTime() - start.getTime()) / 1000),
    transfers: 0,
    legs: [],
    firstTransitDeparture: start,
    firstTransitLine: line,
    firstTransitDelaySec: null,
    walkToStopSec: null,
  };
}

const now = Date.parse('2026-09-13T16:00:00+02:00');

const sameSoon = fakeIt(
  'S6',
  '2026-09-13T16:08:00+02:00',
  '2026-09-13T16:40:00+02:00',
);
const altFast = fakeIt(
  'Bus 745',
  '2026-09-13T16:05:00+02:00',
  '2026-09-13T16:22:00+02:00',
);
const sameLate = fakeIt(
  'S6',
  '2026-09-13T16:35:00+02:00',
  '2026-09-13T17:10:00+02:00',
);

const tooSlow = pickMissedConnection({
  itineraries: [sameSoon, altFast],
  preferLine: 'S6',
  nowMs: now,
  reason: 'too_slow',
  missedLineLabel: 'S6',
});
assert(shouldAutoApplyMissedPick(tooSlow), 'too_slow → auto');
assert(tooSlow.mode === 'silent_same_line' || tooSlow.mode === 'silent_best', 'silent mode');
assert(tooSlow.applySpeech != null && /schaffen wir nicht/i.test(tooSlow.applySpeech), 'Speech zu langsam');

const cancelled = pickMissedConnection({
  itineraries: [sameLate, altFast],
  preferLine: 'S6',
  nowMs: now,
  reason: 'cancelled',
  missedLineLabel: 'S6',
});
assert(shouldAutoApplyMissedPick(cancelled), 'cancelled → auto');
assert(cancelled.mode === 'silent_best', 'Ausfall → beste Route');
assert(
  cancelled.primary?.firstTransitLine === 'Bus 745',
  'Ausfall nimmt schnellere Alt',
);

const heavy = pickMissedConnection({
  itineraries: [sameLate, altFast],
  preferLine: 'S6',
  nowMs: now,
  reason: 'heavy_delay',
  delayMin: HEAVY_DELAY_MIN + 5,
  missedLineLabel: 'S6',
});
assert(shouldAutoApplyMissedPick(heavy), 'schwere Verspätung + bessere Alt → auto');
assert(heavy.primary?.firstTransitLine === 'Bus 745', 'heavy nimmt schnellere');

assert(
  !isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now + 5 * 60_000,
    boardWhenMs: now + 8 * 60_000,
  }),
  'Board noch in Zukunft → nicht missed',
);
assert(
  isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 5 * 60_000,
    boardWhenMs: now - 2 * 60_000,
  }),
  'Board klar vorbei → missed',
);
assert(
  isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 3 * 60_000,
    waitSec: -90,
  }),
  'waitSec klar negativ → missed',
);
assert(
  !isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 30_000,
  }),
  'ohne Board nur kurze Überziehung → nicht missed',
);

console.log('missedConnectionPolicy.smoke.test.ts OK');
