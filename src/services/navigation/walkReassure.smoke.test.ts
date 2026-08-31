/**
 * Run: npx --yes tsx src/services/navigation/walkReassure.smoke.test.ts
 */
import {
  bucketTeaserMeters,
  shouldFireWalkReassure,
  walkReassureGapMs,
  walkReassureSpeech,
} from './walkReassure';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(bucketTeaserMeters(470) === 500, 'Meter runden');
assert(bucketTeaserMeters(320) === 300, '300er Bucket');

const firstGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  isFirst: true,
});
const laterGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  isFirst: false,
});
assert(firstGap < laterGap, `erste Teaser früher (${firstGap} < ${laterGap})`);
assert(firstGap < 90_000, 'erster Teaser unter 90s');
assert(laterGap > 150_000 && laterGap < 400_000, `Abstand auf 1 km ~2–3×, war ${laterGap}`);

const t1 = walkReassureSpeech({
  remainingRouteM: 1000,
  distanceToNextTurnM: 800,
});
assert(/800|richtig/i.test(t1), `Teaser mit Metern zur Gabelung: ${t1}`);

const t2 = walkReassureSpeech({
  remainingRouteM: 500,
  distanceToNextTurnM: null,
});
assert(/500/.test(t2), `kurzer Meter-Teaser: ${t2}`);

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
    nowMs: now,
    lastReassureAtMs: 0,
    lastSpokenAtMs: 0,
    stretchArmedAtMs: now,
  }),
  'direkt nach Arm noch kein Teaser',
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
    nowMs: now + firstGap + 500,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'nach erstem Abstand Teaser',
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
    nowMs: now + 200_000,
    lastReassureAtMs: now,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'kurz vor der Gabelung kein Teaser',
);

console.log('walkReassure.smoke.test.ts OK');
