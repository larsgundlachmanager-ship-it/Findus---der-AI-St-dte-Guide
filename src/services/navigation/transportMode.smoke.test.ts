/**
 * Smoke: Fuß/Jog/Rad/ÖPNV-Cut.
 * Run: npx --yes tsx src/services/navigation/transportMode.smoke.test.ts
 */

import {
  rawModeFromSpeedAndCadence,
  SPEED_WALK_MAX_MS,
  JOG_MIN_STEPS_PER_MIN,
} from './transportModeClassify';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(rawModeFromSpeedAndCadence(1.4, 100) === 'walk', 'normal walk');
assert(
  rawModeFromSpeedAndCadence(SPEED_WALK_MAX_MS + 0.05, null) === 'bicycle',
  'over walk cap → bike',
);
assert(
  rawModeFromSpeedAndCadence(2.8, JOG_MIN_STEPS_PER_MIN + 10) === 'jog',
  'cadence jog',
);
assert(rawModeFromSpeedAndCadence(3.3, 10) === 'bicycle', 'fast low steps bike');
assert(rawModeFromSpeedAndCadence(7.0, 5) === 'transit_bus', 'transit');

console.log('transportMode.smoke.test.ts OK');
