/**
 * Run: npx --yes tsx src/services/navigation/walkReassure.smoke.test.ts
 */
import {
  bucketTeaserMeters,
  shouldFireWalkReassure,
  stretchAfterTurnSpeech,
  walkReassureGapMs,
  walkReassureSpeech,
  WALK_REASSURE_FIRST_MS,
  WALK_REASSURE_SECOND_MS,
  WALK_REASSURE_LATER_MS,
  WALK_REASSURE_SILENCE_MS,
  STRETCH_ANNOUNCE_MIN_M,
} from './walkReassure';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(bucketTeaserMeters(470) === 500, 'Meter runden');
assert(bucketTeaserMeters(320) === 300, '300er Bucket');
assert(WALK_REASSURE_SILENCE_MS === 7 * 60_000, '7 Min erste Stille');
assert(WALK_REASSURE_FIRST_MS === 7 * 60_000, '7 Min first');
assert(WALK_REASSURE_SECOND_MS === 15 * 60_000, '15 Min second');
assert(WALK_REASSURE_LATER_MS === 20 * 60_000, '20 Min later');

const firstGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  reassureCount: 0,
});
const secondGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  reassureCount: 1,
});
const laterGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  reassureCount: 2,
});
assert(firstGap === WALK_REASSURE_FIRST_MS, `first Gap 7 Min (${firstGap})`);
assert(secondGap === WALK_REASSURE_SECOND_MS, `second Gap 15 Min (${secondGap})`);
assert(laterGap === WALK_REASSURE_LATER_MS, `later Gap 20 Min (${laterGap})`);

const t1 = walkReassureSpeech({
  remainingRouteM: 1000,
  distanceToNextTurnM: 630,
});
assert(/630|richtig/i.test(t1), `Teaser mit Metern zur Gabelung: ${t1}`);

const t2 = walkReassureSpeech({
  remainingRouteM: 500,
  distanceToNextTurnM: null,
});
assert(/500/.test(t2), `kurzer Meter-Teaser: ${t2}`);

const stretch = stretchAfterTurnSpeech({
  distanceM: 1800,
  roadName: 'Waldweg',
});
assert(
  stretch != null && /1,8|Waldweg/i.test(stretch),
  `stretch nach Kreuzung: ${stretch}`,
);
assert(
  stretchAfterTurnSpeech({ distanceM: STRETCH_ANNOUNCE_MIN_M - 1 }) == null,
  'unter 1,2 km kein Stretch',
);

const now = 1_000_000;
assert(
  !shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 1000,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + 90_000,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'nach 90s Stille noch kein Teaser',
);
assert(
  shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 900,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + WALK_REASSURE_FIRST_MS + 500,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'nach 7 Min Stille Teaser',
);
assert(
  !shouldFireWalkReassure({
    stretchM: 40,
    distanceToTurnM: 40,
    turnSpeakStartM: 12,
    remainingRouteM: 40,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + 400_000,
    lastReassureAtMs: now,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'kurz vor der Gabelung kein Teaser',
);
assert(
  !shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 900,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'transit_bus',
    userMoving: true,
    nowMs: now + WALK_REASSURE_FIRST_MS + 500,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'ÖPNV kein Reassure',
);

console.log('walkReassure.smoke.test.ts OK');
