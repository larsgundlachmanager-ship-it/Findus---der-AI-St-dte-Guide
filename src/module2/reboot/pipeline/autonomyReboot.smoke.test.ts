/**
 * Autonomy Reboot smokes — Pace, Gold-Fallback, Pitch-Force soft, Root-Goal,
 * Intent-Queue, Call-2 Gap-Cap, Capability-Eval (Flug/Nav/Papst/Timeline/Tour/Pitch).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/reboot/pipeline/autonomyReboot.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  bridgeBudgetSecFor,
  inferPaceBrick,
  paceSignalKey,
  BRIDGE_TO_CALL2_GAP_MAX_MS,
  resolvePaceAwareResearchBudgetSec,
} from './bridgePace';
import {
  call2SpeechDeadlineMs,
  shouldForceCall2SpeechNow,
  raceCall2ReadyOrGapCap,
} from '../../router/call2AfterBridge';
import {
  formatFamilyGoldFallback,
  formatSelectedGoldForCall2,
  collectOwnerGoldCatalog,
} from '../../router/call1OwnerGoldCatalog';
import {
  clearIntentQueue,
  seedIntentQueue,
  completeActiveAndPeekNatural,
  naturalNextIntentBrief,
} from '../../router/intentQueue';
import {
  noteSessionRootGoal,
  getSessionRootGoal,
  appendSessionThreadSpine,
  getSessionThreadSpine,
  clearSessionRootGoal,
} from '../../context/shortTermContext';
import { finalizeCall1Execution } from '../../router/call1Dispatch';
import { shouldHandoffToPitchModule } from '../../pitch/shouldHandoffPitch';
import { deriveEvidenceNeeds } from '../../evidence/evidenceNeeds';
import { mustSkipChatLane } from '../../router/liveInventoryGate';
import {
  beginPaceTurn,
  notePaceBridgeStarted,
  notePaceCall2Ready,
  notePaceUsedCall3,
  flushPaceTurnSample,
  shouldForceCall2FromPace,
  getPaceTurn,
} from './paceTurnSession';
import {
  contributePaceBridgeSample,
  getPaceBridgeBudgetSec,
  _resetPaceBridgeCacheForTests,
} from '../../../services/memory/paceBridgeLearning';

assert.equal(BRIDGE_TO_CALL2_GAP_MAX_MS, 2000, 'gap max 2s');

const trivia = inferPaceBrick({ userText: 'Wie alt ist der Papst?' });
assert.equal(trivia.bucket, 'instant');
assert.equal(trivia.brick, 'trivia');

const events = inferPaceBrick({
  userText: 'was geht vom 16. bis 20 Oktober in Korbach',
  execution: 'events_research',
});
assert.equal(events.bucket, 'deep');
assert.ok(bridgeBudgetSecFor('deep') >= 12);

const flight = inferPaceBrick({
  userText: 'Flug nach Lissabon morgen',
  execution: 'flight_advisor',
});
assert.equal(flight.bucket, 'heavy');

const paced = resolvePaceAwareResearchBudgetSec({
  userText: 'zwei Restaurants mit Terrasse',
  execution: 'pitch_module',
  lane: 'pitch',
});
assert.ok(paced >= 8 && paced <= 22, `paced=${paced}`);

assert.equal(
  paceSignalKey('deep', 'events_window'),
  'pace::deep::events_window',
);

const ended = 1_000_000;
assert.equal(call2SpeechDeadlineMs(ended), ended + 2000);
assert.equal(shouldForceCall2SpeechNow(ended, ended + 1999), false);
assert.equal(shouldForceCall2SpeechNow(ended, ended + 2000), true);

async function runAsyncChecks(): Promise<void> {
  const ready = new Promise<string>((r) => setTimeout(() => r('ok'), 50));
  const raced = await raceCall2ReadyOrGapCap({
    ready,
    bridgeEndedAtMs: Date.now() - 3000,
  });
  assert.equal(raced.forcedByGapCap, true, 'past bridge → gap cap');
  assert.equal(raced.value, null);

  _resetPaceBridgeCacheForTests();
  beginPaceTurn({
    turnId: 't_smoke',
    userText: 'zwei Restaurants',
    execution: 'pitch_module',
    lane: 'pitch',
    bridgeBudgetSec: 3,
  });
  notePaceBridgeStarted(Date.now() - 8000);
  // Bridge-Ende explizit in der Vergangenheit
  const { notePaceBridgeEnded } = require('./paceTurnSession') as {
    notePaceBridgeEnded: (at?: number) => void;
  };
  notePaceBridgeEnded(Date.now() - 3000);
  notePaceCall2Ready(Date.now());
  assert.equal(shouldForceCall2FromPace(Date.now()), true);
  assert.ok(
    getPaceTurn()?.brick === 'place_options' || getPaceTurn()?.brick === 'generic',
  );
  await flushPaceTurnSample();

  for (let i = 0; i < 10; i++) {
    await contributePaceBridgeSample({
      bucket: 'standard',
      brick: 'place_options',
      bridgeMs: 9000,
      call2ReadyMs: 11000,
      gapAfterBridgeMs: 800,
      usedCall3: false,
    });
  }
  const learned = getPaceBridgeBudgetSec('standard', 'place_options');
  assert.ok(
    learned != null && learned >= 8 && learned <= 22,
    `learned budget=${learned}`,
  );

  notePaceUsedCall3(); // no active turn — soft no-op
}

const gold = collectOwnerGoldCatalog();
assert.ok(gold.length > 0, 'gold pack');
const fam = formatFamilyGoldFallback(gold);
assert.ok(fam.length >= 1 && fam.length <= 8);
const selectedEmpty = formatSelectedGoldForCall2([], gold);
assert.ok(selectedEmpty.includes('OWNER_GOLD_GEWAEHLT'), 'fallback when empty keys');

clearSessionRootGoal();
noteSessionRootGoal('SUP auf der Alster fahren');
assert.equal(getSessionRootGoal(), 'SUP auf der Alster fahren');
appendSessionThreadSpine('wie teuer');
assert.ok((getSessionThreadSpine() || '').includes('teuer'));
clearSessionRootGoal();
assert.equal(getSessionRootGoal(), null);

clearIntentQueue();
seedIntentQueue([
  { id: '1', lane: 'pitch', brief: 'Abendessen Optionen' },
  { id: '2', lane: 'nav', brief: 'zum Michel' },
] as any);
const soft = naturalNextIntentBrief();
assert.ok(soft && /Abendessen|Michel/i.test(soft));
const after = completeActiveAndPeekNatural();
assert.ok(after.softBrief && /Michel/i.test(after.softBrief));
clearIntentQueue();

// Hotel-Find: Mission-Safety — nie inventing chat_lane
const hotelChat = finalizeCall1Execution(
  {
    execution: 'chat_lane',
    chatLane: 'chat',
    session: 'new',
  } as any,
  'Hotel mit Pool in der Nähe',
);
assert.equal(hotelChat, 'pitch_module', 'hotel find blocks inventing chat');

// SUP / Aktivität: shouldHandoff nicht erzwingen — Fanout statt Pitch
const supForce = shouldHandoffToPitchModule('Wo kann ich SUP auf der Alster fahren?');
assert.equal(supForce, false, 'SUP not pitch-forced');

assert.equal(
  finalizeCall1Execution(
    {
      execution: 'chat_lane',
      chatLane: 'chat',
      session: 'new',
    } as any,
    'Wo kann ich SUP auf der Alster fahren?',
  ),
  'task_fanout',
  'SUP → fanout not inventing chat',
);

assert.equal(
  mustSkipChatLane('Wo kann ich SUP auf der Alster fahren?', {
    execution: 'chat_lane',
    chatLane: 'chat',
  }),
  false,
  'SUP fanout path not stolen to pitch via mustSkip',
);

const evNeeds = deriveEvidenceNeeds({
  userText: 'was geht vom 16. bis 20 Oktober in Korbach',
});
assert.ok(evNeeds.needs.includes('date_window'));
assert.ok(evNeeds.needs.includes('empty_calendar_fallback'));

// --- Capability Eval (S5 cutover checklist) ---
assert.equal(
  finalizeCall1Execution(
    { execution: 'flight_advisor', chatLane: 'chat', session: 'new' } as any,
    'Flug nach Amsterdam Freitag',
  ),
  'flight_advisor',
  'flight capability',
);
assert.equal(
  finalizeCall1Execution(
    { execution: 'nav_execute', chatLane: 'nav', session: 'new' } as any,
    'navigiere mich zum Bahnhof',
  ),
  'nav_execute',
  'nav capability',
);
assert.equal(
  inferPaceBrick({ userText: 'Wie alt ist der Papst?' }).brick,
  'trivia',
  'papst/trivia not pitch',
);
assert.equal(
  finalizeCall1Execution(
    { execution: 'plan_module', chatLane: 'plan', session: 'new' } as any,
    'Trag das in die Timeline ein',
  ),
  'plan_module',
  'timeline/plan capability',
);
assert.equal(
  finalizeCall1Execution(
    { execution: 'tour_module', chatLane: 'chat', session: 'new' } as any,
    'Stadtführung Altstadt bitte',
  ),
  'tour_module',
  'tour capability',
);
assert.equal(
  finalizeCall1Execution(
    { execution: 'pitch_module', chatLane: 'pitch', session: 'new' } as any,
    'zwei gute Restaurants bitte',
  ),
  'pitch_module',
  'pitch when Call-1 chooses',
);

void runAsyncChecks()
  .then(() => {
    console.log('autonomyReboot.smoke.test.ts ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
