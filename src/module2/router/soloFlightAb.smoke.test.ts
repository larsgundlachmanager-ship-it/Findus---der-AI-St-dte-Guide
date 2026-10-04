/**
 * Modul-2 Solo-Flug A→B → flight_advisor, nie Pitch/Reisebüro.
 */
import assert from 'node:assert/strict';
import {
  isSoloFlightAbSearch,
  shouldEnterFlightAdvisor,
  blocksExploreDriftForFlight,
} from '../../services/flights/flightTripIntent';
import { isFindusReisebueroHandoff } from '../../reisebuero/handoff';
import { finalizeCall1Execution } from './call1Dispatch';
import type { ManagerAnalysis } from './types';
import { resetFlightTripSessionForTests } from '../../services/flights/flightTripSession';

resetFlightTripSessionForTests();

const HAM_SPLIT =
  'Ich brauche einen Flieger vom 27. März bis zum 10. April. Such mir einen Flug von Hamburg nach Split raus.';

assert.equal(isSoloFlightAbSearch(HAM_SPLIT), true, 'solo AB detect');
assert.equal(blocksExploreDriftForFlight(HAM_SPLIT), true, 'blocks explore');
assert.equal(isFindusReisebueroHandoff(HAM_SPLIT), false, 'no reisebuero handoff');
assert.equal(
  shouldEnterFlightAdvisor({ userText: HAM_SPLIT }),
  true,
  'enter advisor despite reisebuero_collect',
);

{
  const { parseFlightTripSlots, extractFlightIdent } = require('../../services/flights/flightTripIntent') as typeof import('../../services/flights/flightTripIntent');
  const cheap =
    'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.';
  const slots = parseFlightTripSlots(cheap);
  assert.equal(slots.originHint, 'Hamburg', `origin ${slots.originHint}`);
  assert.equal(slots.destHint, 'Split', `dest ${slots.destHint}`);
  assert.equal(slots.flightCode, null, 'vom 27 is not flight code');
  assert.equal(extractFlightIdent(cheap), null, 'no VOM27 ident');
  assert.equal(isSoloFlightAbSearch(cheap), true, 'cheap AB solo');
  assert.equal(isFindusReisebueroHandoff(cheap), false, 'cheap AB no reisebuero');
  assert.equal(
    isFindusReisebueroHandoff('günstig nach Antalya fliegen für vier Tage'),
    true,
    'multi-day stay → reisebüro',
  );
}


assert.equal(
  isSoloFlightAbSearch('Wochenendurlaub nach Split mit Flug und Hotel'),
  false,
  'full trip not solo',
);
assert.equal(
  isSoloFlightAbSearch('Nur Hotel in Split, Oktober'),
  false,
  'hotel only not solo flight',
);

function baseAnalysis(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Verstanden.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'chat',
    ...partial,
  };
}

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({ execution: 'chat_lane', chatLane: 'chat' }),
    HAM_SPLIT,
  ),
  'flight_advisor',
  'HAM→Split overrides chat_lane',
);

resetFlightTripSessionForTests();

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({ execution: 'pitch_module', chatLane: 'pitch' }),
    'Flüge von Hamburg nach Split nächste Woche',
  ),
  'flight_advisor',
  'solo flight beats pitch',
);

resetFlightTripSessionForTests();

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({ execution: null as never, chatLane: 'chat' }),
    'Flüge von Hamburg nach Split vom 10. bis 17. Oktober',
  ),
  'flight_advisor',
  'no explicit exec → flight_advisor',
);

// Orchestrator work[] darf Solo-Flug nicht zu Pitch/Chat stehlen
{
  const { reconcileExecutionWithOrchestrator } = require('./call1WorkOrchestrator') as {
    reconcileExecutionWithOrchestrator: (
      c: string,
      o: {
        brief: { askBack: null; runnableWork: unknown[]; work: unknown[]; bridgeComplete: boolean };
        skipHeavyExecution: boolean;
        primaryExecution: string;
      },
      u?: string,
    ) => string;
  };
  const stolen = reconcileExecutionWithOrchestrator(
    'flight_advisor',
    {
      brief: {
        askBack: null,
        runnableWork: [{ worker: 'place' }],
        work: [{ worker: 'place' }],
        bridgeComplete: false,
      },
      skipHeavyExecution: false,
      primaryExecution: 'pitch_module',
    },
    'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.',
  );
  assert.equal(stolen, 'flight_advisor', 'reconcile keeps flight_advisor');
}

resetFlightTripSessionForTests();

const fullTrip = finalizeCall1Execution(
  baseAnalysis({ execution: null as never, chatLane: 'chat' }),
  'Plane mir einen Wochenendurlaub nach Split mit Flug und Hotel',
);
assert.notEqual(fullTrip, 'flight_advisor', `full trip got ${fullTrip}`);
assert.equal(fullTrip, 'reisebuero', `full trip should be reisebuero got ${fullTrip}`);

console.log('soloFlightAb.smoke.test.ts: ok');
