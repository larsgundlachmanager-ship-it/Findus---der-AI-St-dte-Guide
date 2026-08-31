import assert from 'node:assert/strict';
import {
  deriveCall1Execution,
  finalizeCall1Execution,
  resolveCall1Execution,
  shouldSpeakManagerBridge,
} from './call1Dispatch';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

function baseAnalysis(partial: Partial<ManagerAnalysis>): ManagerAnalysis {
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
  resolveCall1Execution(
    baseAnalysis({
      execution: 'flight_advisor',
      chatLane: 'pitch',
    }),
  ),
  'flight_advisor',
  'explicit execution wins over lane',
);

assert.equal(
  deriveCall1Execution(
    baseAnalysis({
      chatLane: 'pitch',
      frame: emptyTurnFrame({
        tasks: [
          { id: 'd1', worker: 'dining', brief: 'Steak in Hamburg' },
        ],
      }),
    }),
  ),
  'pitch_module',
  'dining worker → pitch',
);

assert.equal(
  deriveCall1Execution(
    baseAnalysis({
      chatLane: 'plan',
      frame: emptyTurnFrame({
        tasks: [{ id: 'f1', worker: 'flight', brief: 'Leave-by Antalya' }],
      }),
    }),
  ),
  'flight_advisor',
  'flight worker beats plan lane',
);

assert.equal(
  shouldSpeakManagerBridge(
    baseAnalysis({ session: 'continue', bridge: 'Noch da.' }),
  ),
  false,
  'no bridge on continue',
);

assert.equal(
  shouldSpeakManagerBridge(
    baseAnalysis({ session: 'new', bridge: 'Verstanden — ich schau.' }),
  ),
  true,
  'bridge on new session',
);

{
  const { setFlightTripSession, resetFlightTripSessionForTests } = require(
    '../../services/flights/flightTripSession',
  ) as {
    setFlightTripSession: (s: import('../travel/tripSlotMerge').TripSlotState | null) => void;
    resetFlightTripSessionForTests: () => void;
  };
  resetFlightTripSessionForTests();
  setFlightTripSession({
    mode: 'flight',
    destCity: 'Athen',
    destIata: 'ATH',
    originIata: 'HAM',
    originName: 'Hamburg Airport',
    originCity: 'Hamburg',
    originLat: 53.63,
    originLng: 10.0,
    dateKey: null,
    dateLocked: false,
    dateFlex: null,
    monthIndex: null,
    clockHm: null,
    stance: 'booked',
    selectedIdent: null,
    luggage: 'unknown',
    leaveByAsk: true,
    pendingAsk: 'time',
    updatedAtMs: Date.now(),
  });
  assert.equal(
    finalizeCall1Execution(
      baseAnalysis({
        execution: 'chat_lane',
        chatLane: 'chat',
        session: 'new',
      }),
      'um 20 Uhr',
    ),
    'flight_advisor',
    'bare clock with open flight session → flight_advisor not chat/weather',
  );
  resetFlightTripSessionForTests();
}

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'chat_lane',
      chatLane: 'chat',
      session: 'new',
    }),
    'Ich fliege heute um 20 Uhr nach Athen',
  ),
  'flight_advisor',
  'fresh flight query overrides chat_lane execution',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'plan_module',
      chatLane: 'plan',
      session: 'new',
    }),
    'In zwei Wochen fahre ich für ein Wochenende nach Lissabon',
  ),
  'reisebuero',
  'named weekend trip → reisebuero not local plan',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'flight_advisor',
      chatLane: 'plan',
      session: 'new',
    }),
    'Plane mir einen Wochenendurlaub nach Lissabon: Flug Hamburg, Hotel und grobes Programm',
  ),
  'reisebuero',
  'Wochenendurlaub+Flug → reisebuero beats flight_advisor',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'reisebuero',
      chatLane: 'plan',
      session: 'new',
    }),
    'Samstagabend wäre cool Live Musik — was kannst du mir vorschlagen?',
  ),
  'plan_walkthrough',
  'stay-day fill does not open reisebuero',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'reisebuero',
      chatLane: 'pitch',
      session: 'new',
      jobHint: 'stay_search',
    }),
    'Hotel Freitag bis Sonntag mit Pool und Sauna unter 500 Euro',
  ),
  'pitch_module',
  'local hotel amenities → pitch not reisebuero',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'plan_module',
      chatLane: 'plan',
      session: 'new',
    }),
    'Ich plane ein Wochenende in London — Hotel mit guter Lage',
  ),
  'reisebuero',
  'wochenende + named city → reisebuero',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      chatLane: 'chat',
      session: 'new',
    }),
    'Wann spielen die Hamburg Towers in der Ballsporthalle?',
  ),
  'events_research',
  'named schedule → events_research',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'reisebuero',
      chatLane: 'plan',
      session: 'new',
    }),
    'Bier irgendwo im Angebot?',
  ),
  'chat_lane',
  'product offer irgendwo → chat_lane not reisebuero',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'pitch_module',
      chatLane: 'pitch',
      session: 'new',
    }),
    'Bier irgendwo im Angebot?',
  ),
  'chat_lane',
  'product offer never pitch even if Call-1 says dining',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'reisebuero',
      chatLane: 'plan',
      session: 'new',
    }),
    'Milch und Butter irgendwo im Angebot?',
  ),
  'chat_lane',
  'multi product offer → not reisebuero',
);

assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      chatLane: 'chat',
      session: 'new',
    }),
    'Was gibt es für Bier im Angebot?',
  ),
  'chat_lane',
  'beer offer stays chat_lane',
);

assert.equal(
  shouldSpeakManagerBridge(
    baseAnalysis({
      session: 'new',
      bridge: 'Klar, ich schau nach dem Spielplan.',
      bridgeSpokenEarly: true,
    }),
  ),
  false,
  'no second bridge after early',
);

console.log('call1Dispatch.smoke.test.ts OK');
