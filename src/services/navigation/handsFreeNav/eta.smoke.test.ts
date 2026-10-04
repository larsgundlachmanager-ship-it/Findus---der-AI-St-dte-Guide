/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/handsFreeNav/eta.smoke.test.ts
 */
import {
  clampLivePaceMps,
  etaMinutesForPace,
  LIVE_PACE_MIN_SAMPLES,
  resolveEtaPaceMPerMin,
  smoothLivePaceMps,
} from './etaMath';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// At a steady 90 m/min, four elapsed minutes must remove about four ETA minutes.
const initial = etaMinutesForPace({ remainingRouteM: 1_200, mPerMin: 90 });
const afterFourMin = etaMinutesForPace({
  remainingRouteM: 1_200 - 4 * 90,
  mPerMin: 90,
});
assert(
  initial - afterFourMin === 4,
  `steady pace converges with elapsed time (${initial} -> ${afterFourMin})`,
);

// A single impossible GPS reading is bounded before it enters the ETA EMA.
assert(clampLivePaceMps(12, 'walk') === 2.4, 'walk spike capped');
assert(clampLivePaceMps(30, 'bike') === 8.3, 'bike spike capped');
const afterSpike = smoothLivePaceMps(1.5, 12, 'walk');
assert(
  afterSpike > 1.5 && afterSpike < 1.8,
  `spike only nudges smoothed walk pace (${afterSpike})`,
);

// Live pace takes over after a few movement fixes, not only after 1 km.
const warming = resolveEtaPaceMPerMin({
  profileMPerMin: 83,
  livePaceMps: 1.6,
  liveSampleCount: LIVE_PACE_MIN_SAMPLES - 1,
  inDwell: false,
});
assert(warming.source === 'profile', 'startup remains conservative');
const live = resolveEtaPaceMPerMin({
  profileMPerMin: 83,
  livePaceMps: 1.6,
  liveSampleCount: LIVE_PACE_MIN_SAMPLES,
  inDwell: false,
});
assert(live.source === 'user_cruise', 'live pace selected within a few fixes');
assert(
  live.mPerMin >= 94 && live.mPerMin <= 98,
  `live pace remains near 96 m/min (${live.mPerMin})`,
);
const standing = resolveEtaPaceMPerMin({
  profileMPerMin: 83,
  livePaceMps: 1.6,
  liveSampleCount: LIVE_PACE_MIN_SAMPLES,
  inDwell: true,
});
assert(standing.source === 'profile', 'standing returns to conservative profile');

console.log('handsFreeNav/eta.smoke.test.ts OK');
