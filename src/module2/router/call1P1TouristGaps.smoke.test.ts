/**
 * P1 Touristen-Lücken: Reservierung, Access/Family, Nightlife, UI-Slots.
 * Run: npx --yes tsx src/module2/router/call1P1TouristGaps.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  classifyTouristInvent,
  inventTouristFrictionWork,
  touristInventAuthorIntent,
} from './call1TouristInvent';
import {
  extractTouristConstraintMusts,
  looksLikeEveningPlanAsk,
  looksLikeAccessibilityAsk,
  looksLikeFamilyKidsAsk,
} from './call1TouristConstraints';
import {
  inferAnswerSlot,
  inferUiRequirements,
  inferVerifyConstraints,
  buildOpenWorldContract,
} from './call1OpenWorldContract';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';

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
    frame: emptyTurnFrame(),
    ...partial,
  };
}

// Reservierung
assert.equal(
  classifyTouristInvent('Reservier bitte einen Tisch morgen 20 Uhr'),
  'booking_reserve',
);
const reserveUi = inferUiRequirements(
  'Reservier bitte einen Tisch morgen 20 Uhr beim Italiener',
);
assert.equal(reserveUi.needBookingLink, true, 'reserve → booking link');
const reserveWork = inventTouristFrictionWork(
  'Reservier Tisch morgen 20 Uhr Restaurant',
  'here_now',
);
assert.ok(reserveWork.some((w) => w.worker === 'deep_web' && w.wantBookingLink));
assert.ok(reserveWork.some((w) => w.worker === 'dining'));
assert.equal(
  inferAnswerSlot('Reservier Tisch morgen 20 Uhr'),
  'booking',
);

// Accessibility
assert.ok(looksLikeAccessibilityAsk('Nur barrierefrei zum Museum'));
assert.ok(
  extractTouristConstraintMusts('Nur barrierefrei mit Rollstuhl').includes(
    'barrierefrei',
  ),
);
const accessOw = buildOpenWorldContract({
  userText: 'Museum barrierefrei mit Rollstuhl',
  authorIntent: 'Museum zugänglich',
});
assert.ok(
  accessOw.must.some((m) => /barrierefrei|rollstuhl/i.test(m)),
  'access must in open world',
);
assert.ok(accessOw.stopPolicy.forbidSoftFillOnMust);
assert.ok(inferVerifyConstraints('barrierefrei Museum').includes('barrier_free'));
const accessBrief = buildCall1TaskBrief({
  analysis: analysis(),
  userText: 'Café mit Wickelraum und Kinderwagen',
});
assert.ok(
  accessBrief.runnableWork.some(
    (w) =>
      w.worker === 'pitch' &&
      (w.must ?? []).some((m) => /wickel|kinderwagen/i.test(m.key)),
  ),
  'family musts on pitch',
);
assert.ok(looksLikeFamilyKidsAsk('Café mit Wickelraum'));

// Nightlife evening
assert.ok(looksLikeEveningPlanAsk('Was geht heute Abend?'));
assert.equal(classifyTouristInvent('Was geht heute Abend in Kiel?'), 'nightlife');
const nightWork = inventTouristFrictionWork(
  'Was geht heute Abend?',
  'here_now',
);
assert.ok(nightWork.some((w) => w.worker === 'events'));
assert.ok(nightWork.some((w) => w.worker === 'weather'));
assert.equal(inferAnswerSlot('Was geht heute Abend?'), 'nightlife');
assert.ok(/Abendprogramm|Wetter/i.test(touristInventAuthorIntent('Was geht heute Abend?')));

// Tickets / eSIM UI
assert.equal(
  inferUiRequirements('Hop-on Hop-off Tickets Hamburg').needTicket,
  true,
);
assert.equal(
  inferUiRequirements('Brauch eSIM für Portugal').needBookingLink,
  true,
);
assert.equal(inferAnswerSlot('Brauch eSIM für Portugal'), 'sim_data');
assert.equal(inferAnswerSlot('Koffer abstellen bis 18'), 'luggage');

const nightBrief = buildCall1TaskBrief({
  analysis: analysis({ bridgeComplete: true }),
  userText: 'Was geht heute Abend?',
});
assert.equal(nightBrief.bridgeComplete, false);
assert.ok(nightBrief.runnableWork.some((w) => w.worker === 'events'));

console.log('call1P1TouristGaps.smoke: ok');
