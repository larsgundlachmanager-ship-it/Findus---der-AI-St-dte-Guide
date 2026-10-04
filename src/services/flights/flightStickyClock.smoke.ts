/**
 * Sticky: Follow-up nur Uhr („um 18 Uhr“) bleibt am Flug-/Taxi-Root.
 */
import assert from 'node:assert/strict';
import {
  hasStickyFlightRoot,
  isBareClockStickyFlightFollowUp,
  shouldEnterFlightAdvisor,
  shouldPreserveFlightTripSession,
  blocksExploreDriftForFlight,
} from './flightTripIntent';
import {
  setFlightTripSession,
  resetFlightTripSessionForTests,
} from './flightTripSession';
import {
  clearFollowThroughGoal,
  syncFollowThroughGoal,
  getFollowThroughGoal,
} from '../../module2/router/missionFollowThrough';
import { finalizeCall1Execution } from '../../module2/router/call1Dispatch';

function baseAnalysis(over: Record<string, unknown> = {}) {
  return {
    chatLane: 'chat',
    session: 'new',
    intentSummary: '',
    jobHint: null,
    bridge: null,
    bridgeComplete: false,
    askBack: null,
    frame: null,
    execution: 'chat_lane',
    ...over,
  } as any;
}

clearFollowThroughGoal();
resetFlightTripSessionForTests();

assert.equal(hasStickyFlightRoot(), false, 'no sticky without session/FT');

syncFollowThroughGoal(
  'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
);
assert.equal(getFollowThroughGoal()?.kind, 'taxi_airport');
assert.ok(hasStickyFlightRoot(), 'taxi follow-through is sticky root');

assert.ok(
  isBareClockStickyFlightFollowUp('um 18 Uhr'),
  'um 18 Uhr sticky on FT root',
);
assert.ok(
  isBareClockStickyFlightFollowUp('um 18'),
  'um 18 without Uhr sticky',
);
assert.ok(
  isBareClockStickyFlightFollowUp('18:00'),
  '18:00 sticky',
);
assert.ok(
  shouldPreserveFlightTripSession('um 18 Uhr'),
  'preserve on bare clock',
);
assert.ok(
  blocksExploreDriftForFlight('um 18 Uhr'),
  'bare clock blocks explore on FT',
);
assert.ok(
  shouldEnterFlightAdvisor({
    userText: 'um 18 Uhr',
    chatLane: 'pitch',
    hasOpenSession: false,
  }),
  'FT-only bare clock → flight advisor (even pitch lane)',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'pitch_module',
      chatLane: 'pitch',
      session: 'new',
    }),
    'um 18 Uhr',
  ),
  'flight_advisor',
  'finalize: bare clock + FT → flight_advisor not pitch',
);

syncFollowThroughGoal('um 18');
assert.ok(
  getFollowThroughGoal()?.slots.flightTime,
  'bare um 18 merges into flightTime slot',
);

clearFollowThroughGoal();
resetFlightTripSessionForTests();

setFlightTripSession({
  mode: 'flight',
  destCity: 'London',
  destIata: 'LHR',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originCity: 'Hamburg',
  originLat: 53.63,
  originLng: 10.0,
  dateKey: null,
  dateLocked: false,
  dateFromUserHint: false,
  dateFlex: null,
  monthIndex: null,
  clockHm: null,
  stance: 'booked',
  selectedIdent: null,
  luggage: 'unknown',
  leaveByAsk: true,
  pendingAsk: 'when',
  updatedAtMs: Date.now(),
});

assert.ok(hasStickyFlightRoot(), 'pendingAsk-when session is sticky');
assert.ok(
  shouldEnterFlightAdvisor({
    userText: 'um 18 Uhr',
    chatLane: 'chat',
    session: 'new',
    hasOpenSession: true,
  }),
  'session pending when + bare clock → advisor',
);
assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'chat_lane',
      chatLane: 'chat',
      session: 'new',
    }),
    'um 18 Uhr',
  ),
  'flight_advisor',
  'finalize: session + bare clock → flight_advisor',
);

clearFollowThroughGoal();
resetFlightTripSessionForTests();
console.log('flightStickyClock.smoke.ts OK');
