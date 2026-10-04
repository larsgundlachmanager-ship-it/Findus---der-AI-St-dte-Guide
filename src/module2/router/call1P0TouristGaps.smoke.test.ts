/**
 * P0 Touristen-Lücken: bridgeComplete-Gate, deep_web shaping, amenity→friction, invent.
 * Run: npx --yes tsx src/module2/router/call1P0TouristGaps.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  resolveBridgeCompleteFlag,
  shouldSkipCall2ForBridgeComplete,
  isCriticalSlotAskBack,
} from './call1BridgeCompleteGate';
import {
  inventTouristFrictionWork,
  classifyTouristInvent,
  looksLikeTouristInventNeed,
} from './call1TouristInvent';
import {
  shapeDeepWebQuery,
  wantsDeepWebBooking,
} from './call1DeepWebWorker';
import { resolveCall1TaskHonor } from './call1TaskHonor';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis, ManagerTask } from './types';

function analysis(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    bridgeComplete: true,
    frame: emptyTurnFrame(),
    ...partial,
  };
}

// --- bridgeComplete Gate ---
assert.equal(
  shouldSkipCall2ForBridgeComplete({
    userText: 'Brauch eSIM für Portugal',
    claimedComplete: true,
    askBack: null,
    runnableWorkCount: 0,
    novelRequiresDeepWeb: true,
  }),
  false,
  'eSIM novel: never skip',
);
assert.equal(
  resolveBridgeCompleteFlag({
    userText: 'Wo ist die nächste Toilette?',
    claimedComplete: true,
    askBack: 'Soll ich suchen?',
    runnableWorkCount: 1,
  }),
  false,
  'toilette + work: no skip',
);
assert.equal(
  looksLikeTouristInventNeed('Brauch eSIM für Italien'),
  true,
);
assert.equal(
  shouldSkipCall2ForBridgeComplete({
    userText: 'Brauch eSIM für Italien',
    claimedComplete: true,
    askBack: null,
    runnableWorkCount: 0,
  }),
  false,
  'eSIM invent need blocks skip',
);
assert.ok(
  isCriticalSlotAskBack(
    'Welche Flugnummer oder Abflugzeit?',
    'Taxi zum Flughafen',
  ),
);
assert.equal(
  shouldSkipCall2ForBridgeComplete({
    userText: 'Taxi zum Flughafen bitte',
    claimedComplete: true,
    askBack: 'Welche Flugnummer oder Abflugzeit?',
    runnableWorkCount: 0,
  }),
  true,
  'taxi airport critical may skip',
);
assert.equal(
  shouldSkipCall2ForBridgeComplete({
    userText: 'stopp die Navigation',
    claimedComplete: true,
    askBack: null,
    runnableWorkCount: 0,
  }),
  true,
  'nav stop may skip',
);

// --- Tourist invent ---
assert.equal(classifyTouristInvent('Brauch eSIM für Portugal'), 'sim_data');
assert.equal(classifyTouristInvent('Koffer abstellen bis 18 Uhr'), 'luggage');
assert.equal(classifyTouristInvent('Wo Wechselstube?'), 'fx_cash');
assert.equal(classifyTouristInvent('Nächste Toilette'), 'friction');
const esimWork = inventTouristFrictionWork(
  'Brauch eSIM für Portugal',
  'here_now',
);
assert.ok(esimWork.some((w) => w.worker === 'deep_web' && w.wantBookingLink));
const toiletWork = inventTouristFrictionWork('Nächste Toilette', 'here_now');
assert.ok(toiletWork.some((w) => w.worker === 'pitch'));

const briefEsim = buildCall1TaskBrief({
  analysis: analysis({ bridgeComplete: true }),
  userText: 'Brauch eSIM für Portugal',
});
assert.equal(briefEsim.bridgeComplete, false, 'brief clears complete for eSIM');
assert.ok(
  briefEsim.runnableWork.some((w) => w.worker === 'deep_web'),
  'eSIM invents deep_web',
);

const briefToilet = buildCall1TaskBrief({
  analysis: analysis({ bridgeComplete: true }),
  userText: 'Wo ist die nächste Toilette?',
});
assert.equal(briefToilet.bridgeComplete, false);
assert.ok(
  briefToilet.runnableWork.some(
    (w) => w.worker === 'pitch' || w.worker === 'place',
  ),
);

// --- deep_web shaping ---
assert.ok(wantsDeepWebBooking('Hop-on Hop-off Tickets Hamburg'));
assert.match(
  shapeDeepWebQuery('Brauch eSIM für Portugal', 'Lissabon'),
  /eSIM/i,
);
assert.match(
  shapeDeepWebQuery('Hop-on Tickets', 'Hamburg', {
    needTicket: true,
    authorIntent: 'Tagesticket kaufen',
  }),
  /Ticket|buchen|Hop/i,
);
assert.match(
  shapeDeepWebQuery('Flug nach Wangerooge bitte'),
  /Wangerooge.*Charter/i,
);

// --- amenity → friction_now ---
const amenityTask: ManagerTask = {
  id: 'a1',
  lane: 'amenity',
  brief: 'Nächste Toilette nah GPS',
  priority: 'fast',
  affectsSpeech: true,
};
const honor = resolveCall1TaskHonor({
  task: amenityTask,
  userText: 'Wo ist die nächste Toilette?',
  analysis: analysis({
    bridgeComplete: false,
    jobHint: 'shopping_errand',
    tasks: [amenityTask],
  }),
});
assert.equal(honor.jobHint, 'friction_now', 'amenity lane → friction not shopping');

console.log('call1P0TouristGaps.smoke: ok');
