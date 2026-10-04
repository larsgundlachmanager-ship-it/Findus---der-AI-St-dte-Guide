/**
 * Qualität: Horror-Verbindungen rausfiltern.
 */
import assert from 'node:assert/strict';
import {
  isSaneFlightOption,
  MAX_GOOD_FLIGHT_DURATION_MIN,
} from './cheapFlightQuality';

assert.equal(MAX_GOOD_FLIGHT_DURATION_MIN, 14 * 60);
assert.equal(isSaneFlightOption({ durationMin: 150, stops: 0 }), true);
assert.equal(isSaneFlightOption({ durationMin: 8 * 60, stops: 1 }), true);
assert.equal(isSaneFlightOption({ durationMin: 50 * 60, stops: 1 }), false, '50h bad');
assert.equal(isSaneFlightOption({ durationMin: 10 * 60, stops: 3 }), false, '3 stops bad');
assert.equal(isSaneFlightOption({}), true, 'unknown ok');

console.log('cheapFlightQuality.smoke.test.ts: ok');
