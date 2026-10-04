/**
 * Call-1 Task-Brief / Orchestrator Smokes.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1TaskBrief.smoke.test.ts
 */

import assert from 'node:assert/strict';
import {
  buildCall1TaskBrief,
  detectComboIntents,
  detectTaxiAirportBlocker,
  inferExecuteWhen,
  inferProximityMode,
  isPrematureNavStart,
} from './call1TaskBrief';
import { resolveCall1Task } from './call1WorkOrchestrator';
import { CALL1_CAPABILITY_CATALOG, normalizeWorkerId } from './call1CapabilityMap';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';
import { clearFollowThroughGoal } from './missionFollowThrough';

clearFollowThroughGoal();

function baseAnalysis(partial?: Partial<ManagerAnalysis>): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'smalltalk',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Kurz check ich das.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    topicScope: { mode: 'new', turnsForCall2: 0 },
    frame: emptyTurnFrame(),
    ...partial,
  };
}

// --- Proximity ---
assert.equal(inferProximityMode('Wo ist die nächste Toilette?'), 'urgent_near');
assert.equal(
  inferProximityMode('Ich habe Lust auf Spaghetti-Eis, wo kann ich hin?'),
  'here_now',
);
assert.equal(
  inferProximityMode('SUP auf der Alster in Hamburg'),
  'city_best',
);
assert.equal(
  inferProximityMode('In drei Tagen irgendwohin zum besten Angus'),
  'later_free',
);

// --- Timing ---
assert.equal(isPrematureNavStart('Morgen möchte ich dahin fahren'), true);
assert.equal(
  isPrematureNavStart('Bring mich jetzt zur Alster'),
  false,
);
assert.equal(
  inferExecuteWhen('Morgen dahin zur Elbphilharmonie', 'nav', {
    kind: 'day',
    label: 'morgen',
    dateKey: '2026-09-12',
  }),
  'later',
);
assert.equal(
  inferExecuteWhen('Taxi jetzt zum Bahnhof bestellen', 'transit', null),
  'now',
);
assert.equal(
  inferExecuteWhen('Taxi später nach dem Essen', 'transit', null),
  'later',
);

// --- Taxi blocker ---
const blocked = detectTaxiAirportBlocker(
  'Kannst du mir ein Taxi zum Flughafen vorbestellen?',
);
assert.equal(blocked.blocked, true);
assert.ok(blocked.askBack && /flug/i.test(blocked.askBack));

const okTaxi = detectTaxiAirportBlocker(
  'Taxi zum Flughafen für Flug LH400 um 18:00 Uhr',
);
assert.equal(okTaxi.blocked, false);

// --- Combo ---
const combo = detectComboIntents(
  'Erinner mich in 10 Minuten und wie wird morgen das Wetter?',
);
assert.equal(combo.wantsTimer, true);
assert.equal(combo.wantsWeather, true);

const comboBrief = buildCall1TaskBrief({
  analysis: baseAnalysis({
    authorIntent: 'Timer und Wetter',
    frame: emptyTurnFrame(),
  }),
  userText: 'Erinner mich in 10 Minuten und wie wird morgen das Wetter?',
});
assert.ok(
  comboBrief.work.some((w) => w.worker === 'timer_alarm'),
  'combo timer work',
);
assert.ok(
  comboBrief.work.some((w) => w.worker === 'weather'),
  'combo weather work',
);
assert.ok(comboBrief.runnableWork.length >= 2, 'combo runnable parallel');

// --- Premature nav → not nav_execute ---
const tomorrow = resolveCall1Task({
  analysis: baseAnalysis({
    authorIntent: 'Morgen zur Elphi',
    execution: 'nav_execute',
    frame: emptyTurnFrame({
      tasks: [
        {
          id: 'n1',
          worker: 'nav',
          brief: 'Route zur Elbphilharmonie',
          when: { kind: 'day', label: 'morgen', dateKey: '2026-09-12' },
        },
      ],
    }),
  }),
  userText: 'Morgen möchte ich zur Elbphilharmonie dahin',
});
assert.ok(
  tomorrow.brief.work.every(
    (w) => w.worker !== 'nav' || w.executeWhen === 'later',
  ),
  'nav later when morgen dahin',
);
assert.notEqual(tomorrow.primaryExecution, 'nav_execute');

// --- Taxi askBack ---
const taxiOrch = resolveCall1Task({
  analysis: baseAnalysis({
    authorIntent: 'Taxi Flughafen',
    frame: emptyTurnFrame({
      tasks: [
        {
          id: 't1',
          worker: 'transit',
          brief: 'Taxi zum Flughafen bestellen',
        },
      ],
    }),
  }),
  userText: 'Kannst du mir ein Taxi zum Flughafen vorbestellen?',
});
assert.ok(taxiOrch.brief.askBack, 'taxi askBack');
assert.ok(
  !taxiOrch.brief.runnableWork.some((w) => w.worker === 'transit'),
  'no ghost taxi worker',
);

// --- Flight+Taxi chain ---
clearFollowThroughGoal();
const chain = buildCall1TaskBrief({
  analysis: baseAnalysis({
    authorIntent: 'Flug und Taxi',
    frame: emptyTurnFrame(),
  }),
  userText: 'Mein Flug ist um 18 Uhr, bestell mir danach ein Taxi zum Flughafen',
});
assert.ok(
  chain.work.some((w) => w.worker === 'flight'),
  'flight in chain',
);
assert.ok(
  chain.work.some((w) => w.dependsOn && /flight|chain_flight/i.test(w.dependsOn)),
  'taxi depends on flight',
);
{
  const taxiW = chain.work.find(
    (w) => w.dependsOn && /flight|chain_flight/i.test(w.dependsOn || ''),
  )!;
  assert.equal(taxiW.executeWhen, 'now', 'leave-by known → taxi runnable now');
  assert.ok(taxiW.wantBookingLink, 'taxi deep-link');
}
{
  clearFollowThroughGoal();
  const pending = buildCall1TaskBrief({
    analysis: baseAnalysis({
      authorIntent: 'Flug und Taxi ohne Uhr',
      frame: emptyTurnFrame(),
    }),
    userText: 'Bestell mir ein Taxi, dass ich pünktlich zum Flug nach Athen komme',
  });
  const taxiPending = pending.work.find(
    (w) => w.worker === 'transit' || w.worker === 'taxi',
  );
  assert.ok(taxiPending, 'Task 2 in work even without clock');
  assert.equal(taxiPending!.executeWhen, 'later');
  assert.ok(
    pending.work.some((w) => w.worker === 'flight'),
    'Task 1 flight present',
  );
  clearFollowThroughGoal();
}

// --- curatedContext topicCut ---
assert.equal(comboBrief.topicCut, true);
assert.ok(comboBrief.curatedContext.length >= 1);

// --- Capability map ---
assert.ok(CALL1_CAPABILITY_CATALOG.length >= 20);
assert.equal(normalizeWorkerId('dining'), 'dining');
assert.equal(normalizeWorkerId('deep-web'), 'deep_web');
assert.equal(normalizeWorkerId('m1_poi'), 'm1_poi');
assert.equal(normalizeWorkerId('taxi'), 'taxi');
assert.equal(normalizeWorkerId('package'), 'package_quick');
assert.ok(comboBrief.openWorld?.uiRequirements?.maxBullets === 3, 'openWorld bullets');

clearFollowThroughGoal();
const hotelBrief = buildCall1TaskBrief({
  analysis: baseAnalysis({ authorIntent: 'Hotel heute' }),
  userText: 'Ich brauche schnell ein Hotel für heute',
});
assert.ok(
  hotelBrief.work.some((w) => w.worker === 'hotel'),
  'hotel worker',
);
clearFollowThroughGoal();

const taxiBrief = buildCall1TaskBrief({
  analysis: baseAnalysis({ authorIntent: 'Taxi' }),
  userText: 'Kannst du mir ein Taxi zum Bahnhof bestellen?',
});
assert.ok(
  taxiBrief.work.some((w) => w.worker === 'taxi' || w.worker === 'transit'),
  'taxi worker',
);

// Self-decompose mega-question
const mega = buildCall1TaskBrief({
  analysis: baseAnalysis({
    authorIntent: 'Ferien und Tennis an der Küste',
    frame: emptyTurnFrame(),
  }),
  userText:
    'Wann sind Sommerferien Schleswig-Holstein und wann könnte man zu einem Tennisturnier an Elbe oder Ostsee?',
});
assert.ok(mega.selfQuestions.length >= 2, 'self questions');
assert.ok(
  mega.selfQuestions.some((q) => /ferien|event|ort|gewässer|küste/i.test(q)),
  'self questions relevant',
);

const { formatBriefForCall2 } = require('./call1WorkOrchestrator') as {
  formatBriefForCall2: (b: typeof comboBrief) => string;
};
const block = formatBriefForCall2(comboBrief);
assert.ok(/CALL1_TASK_BRIEF/.test(block), 'brief block header');
assert.ok(/uiRequirements|openWorld/.test(block), 'brief includes openWorld/uiReq');

console.log('[call1TaskBrief] ok');


