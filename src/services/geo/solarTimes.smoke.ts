/**
 * Run: npx --yes -p tsx@4.19.3 tsx src/services/geo/solarTimes.smoke.ts
 */
import {
  computeNextSunsetMs,
  computeSunsetMs,
  isTodaysSunsetLive,
} from './solarTimes';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  }
}

// Hamburg 23.8.2026 — Sunset ~20:15–20:25 CEST (18:15–18:25 UTC)
const hamburg = computeSunsetMs(
  53.5511,
  9.9937,
  Date.UTC(2026, 7, 23, 12, 0, 0),
);
assert(hamburg != null, 'hamburg sunset exists');
if (hamburg != null) {
  const utcH = new Date(hamburg).getUTCHours();
  const utcM = new Date(hamburg).getUTCMinutes();
  const mins = utcH * 60 + utcM;
  assert(mins >= 17 * 60 + 50 && mins <= 18 * 60 + 50, `hamburg utc ${utcH}:${String(utcM).padStart(2, '0')} in 17:50–18:50`);
}

const next = computeNextSunsetMs(53.55, 10.0, Date.parse('2026-08-23T16:00:00+02:00'));
assert(next != null && next > Date.parse('2026-08-23T16:00:00+02:00'), 'next sunset after 16:00');

const evening = Date.parse('2026-08-23T21:04:00+02:00');
assert(
  hamburg != null && !isTodaysSunsetLive(evening, hamburg),
  'after sunset tonight card is dead',
);
assert(
  hamburg != null && isTodaysSunsetLive(Date.parse('2026-08-23T18:00:00+02:00'), hamburg),
  'before sunset card is live',
);

if (failed) {
  console.error(`solarTimes smoke: ${failed} failed`);
  process.exit(1);
}
console.log('solarTimes smoke: ok');
