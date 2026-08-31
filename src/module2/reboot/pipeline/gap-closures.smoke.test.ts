/**
 * Gap Closures — strukturelle Smoke-Checks (RFC gap-closures.md).
 * Nur Node-sichere Imports (kein React Native).
 */

import { parseCall2Tail } from './call2Tail';
import { buildAnalysisFromChoice, resolveChoiceSlotFromPrompt } from '../../router/choiceTurnContext';
import { resolveShortAnswerSlotKey } from './shortAnswerChips';
import { parseTopicScope } from './topicScopeParse';
import { trackCall3Rate, getCall3Rate } from './turnLatencyMetrics';
import { formatUserMemoryForPrompt } from '../../../db/userMemoryFacts';
import { estimateBulletMaxChars } from '../../../services/concierge/visualBullets';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const tail = parseCall2Tail(
  JSON.stringify({
    bullets: ['Wecker 7 Uhr'],
    background_tasks: [{ type: 'SET_NATIVE_ALARM', hour: 7, minute: 0 }],
    followUp: { needed: true, delegateTo: 'call3', reason: 'menu_prices' },
  }),
);
assert(tail?.background_tasks?.length === 1, 'gap1 background_tasks');
assert(tail?.followUp?.delegateTo === 'call3', 'gap4 call3 delegate');

const scope = parseTopicScope({
  mode: 'followup',
  turnsForCall2: 2,
  inheritLiveInventory: true,
});
assert(scope?.inheritLiveInventory === true, 'gap6 inherit');

const choiceAnalysis = buildAnalysisFromChoice(
  {
    parentTurnId: 't1',
    choiceId: 'c1',
    label: 'Aufgabegepäck',
    slotKey: 'baggage_type',
  },
  null,
);
assert(choiceAnalysis.jobHint === 'flight_trip', 'gap7 baggage slot');
assert(choiceAnalysis.bridgeSpokenEarly === true, 'gap7 no bridge');

const planFork = buildAnalysisFromChoice(
  {
    parentTurnId: 't2',
    choiceId: 'p1',
    label: 'Museum zuerst',
    slotKey: 'plan_fork',
  },
  null,
);
assert(planFork.route === 'm5_plan', 'gap7 plan_fork');

const ltmLine = formatUserMemoryForPrompt([
  {
    id: '1',
    subject: 'hamburg',
    keyword: 'veg',
    fact: 'Freundin ist vegetarisch',
    sourceTurnId: null,
    createdAtMs: 0,
    updatedAtMs: 0,
  },
]);
assert(ltmLine.includes('vegetarisch'), 'gap9 ltm format');

const bulletMax = estimateBulletMaxChars({
  widthPx: 360,
  fontSize: 14,
  lines: 2,
});
assert(bulletMax >= 22, 'gap10 bullet estimate');

trackCall3Rate();
assert(getCall3Rate() >= 0, 'latency call3 rate');

const baggageSlot = resolveChoiceSlotFromPrompt('Mit Aufgabegepäck', 'Aufgabegepäck');
assert(baggageSlot?.slotKey === 'baggage_type', 'baggage slot resolve');

const slotKey = resolveShortAnswerSlotKey(
  { followUp: { reason: 'menu_prices' } },
  'dining_nearby',
);
assert(slotKey === 'generic_fork', 'slot key menu');

console.log('[gap-closures] ok');
