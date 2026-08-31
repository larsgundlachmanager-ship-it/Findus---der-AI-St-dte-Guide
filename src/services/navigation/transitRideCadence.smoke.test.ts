/**
 * Run: npx --yes tsx src/services/navigation/transitRideCadence.smoke.test.ts
 */
import {
  alightLeadSec,
  isDenseLocalRide,
  isLongHaulRide,
  midRideStopMarks,
  shouldSpeakAlightSoon,
  shouldSpeakRemainingStop,
} from './transitRideCadence';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const sbahnMany = {
  line: 'S3',
  vehicle: 'Bahn' as const,
  remainingStops: 8,
  rideMin: 12,
  boardedStops: 8,
};
assert(!isDenseLocalRide(sbahnMany), 'S-Bahn 8 Halt / 12 Min ist nicht dicht');
assert(
  JSON.stringify(midRideStopMarks(sbahnMany)) === JSON.stringify([5, 3]),
  `S-Bahn Mid-Marks 5+3, war ${midRideStopMarks(sbahnMany)}`,
);
assert(shouldSpeakRemainingStop(5, sbahnMany), '5 Halte sagen');
assert(shouldSpeakRemainingStop(3, sbahnMany), '3 Halte sagen');
assert(shouldSpeakRemainingStop(1, sbahnMany), 'nächste Station sagen');
assert(!shouldSpeakRemainingStop(4, sbahnMany), 'keine 4er-Ansage');
assert(alightLeadSec(sbahnMany) === 65, 'S-Bahn ~1 Min Vorlauf');

const shortHop = {
  line: 'S21',
  vehicle: 'Bahn' as const,
  remainingStops: 5,
  rideMin: 5,
  boardedStops: 5,
};
assert(isDenseLocalRide(shortHop), '1-Min-Takt: dicht');
assert(midRideStopMarks(shortHop).length === 0, 'kein 5/3 bei 1-Min-Takt');
assert(shouldSpeakRemainingStop(1, shortHop), 'nur nächste Station');
assert(!shouldSpeakRemainingStop(5, shortHop), '5 nicht extra nach Losfahren-Takt');

const oneStop = {
  line: 'RB61',
  vehicle: 'Bahn' as const,
  remainingStops: 1,
  rideMin: 2,
  boardedStops: 1,
};
assert(midRideStopMarks(oneStop).length === 0, 'eine Station: keine Mid-Marks');
assert(shouldSpeakRemainingStop(1, oneStop), 'sofort nächste Station');

const ice = {
  line: 'ICE 615',
  vehicle: 'Bahn' as const,
  remainingStops: 1,
  rideMin: 32,
  boardedStops: 1,
};
assert(isLongHaulRide(ice), 'ICE ist Fernverkehr');
assert(midRideStopMarks(ice).length === 0, 'ICE keine Halt-Zähl-Kette');
assert(alightLeadSec(ice) === 300, 'ICE 5 Min Vorlauf');
assert(
  shouldSpeakAlightSoon({
    remainingStops: 1,
    etaSec: 290,
    leadSec: 300,
    nextStopSpokenAtMs: Date.now() - 10 * 60_000,
    nowMs: Date.now(),
  }),
  'ICE ~5 Min vorher Ausstieg',
);
assert(
  !shouldSpeakAlightSoon({
    remainingStops: 1,
    etaSec: 70,
    leadSec: 65,
    nextStopSpokenAtMs: Date.now() - 8_000,
    nowMs: Date.now(),
  }),
  'S-Bahn nicht doppelt 8s nach nächste-Station',
);

const bus = {
  line: 'X3',
  vehicle: 'Bus' as const,
  remainingStops: 2,
  rideMin: 4,
  boardedStops: 2,
};
assert(midRideStopMarks(bus).length === 0, 'Bus 2 Halt: nur nächste');

console.log('transitRideCadence.smoke.test.ts OK');
