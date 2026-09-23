/**
 * Order-Ticket SSOT smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1OrderTicket.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  parseCall1OrderTicket,
  orderTicketToMustHaves,
  formatCall1OrderTicketForPrompt,
  FINDUS_CALL1_TOOLBOX_BLOCK,
} from './call1OrderTicket';
import { finalizeCall1Execution } from './call1Dispatch';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

function base(partial: Partial<ManagerAnalysis>): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Welche AYCE-Spots Freitag ohne Asia — ich such das.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'pitch',
    ...partial,
  };
}

const ayce = parseCall1OrderTicket({
  order: {
    must: ['all_you_can_eat'],
    avoid: ['avoid_cuisine_asian'],
    search: {
      mode: 'hard',
      stages: ['pack', 'neighbor', 'metro', 'web'],
      maxRadiusKm: 100,
      forbidSoftFill: true,
    },
    need: { menuUrl: true, prices: true, maps: true },
    ui: { openPitch: true },
    bulletBudget: { max: 3, maxLines: 2, maxChars: 72 },
  },
});
assert.equal(ayce.search.mode, 'hard');
assert.equal(ayce.search.forbidSoftFill, true);
assert.ok(ayce.must.includes('all_you_can_eat'));
assert.ok(ayce.avoid.some((a) => /asian/i.test(a)));
assert.ok(orderTicketToMustHaves(ayce).length >= 2);
assert.ok(formatCall1OrderTicketForPrompt(ayce).includes('forbidSoftFill=true'));
assert.ok(FINDUS_CALL1_TOOLBOX_BLOCK.includes('Workers:'));
assert.ok(FINDUS_CALL1_TOOLBOX_BLOCK.includes('order.act') || FINDUS_CALL1_TOOLBOX_BLOCK.includes('actions[]'));

const actTicket = parseCall1OrderTicket({
  heardAs: 'take me to the cruise terminal and put the sailing on my calendar',
  order: {
    actions: ['navigate', 'timeline'],
    place: 'Cruise Center Kiel',
    topic: 'cruise',
    jobShape: 'schedule_write',
    ui: { startNav: true, openTimeline: true },
  },
});
assert.deepEqual(actTicket.act.actions, ['navigate', 'timeline']);
assert.equal(actTicket.act.place, 'Cruise Center Kiel');
assert.equal(actTicket.act.topic, 'cruise');

const uiBoth = parseCall1OrderTicket({
  order: { ui: { startNav: true, openTimeline: true }, place: 'Hafen' },
});
assert.ok(uiBoth.act.actions.includes('navigate'));
assert.ok(uiBoth.act.actions.includes('timeline'));

const navOnly = parseCall1OrderTicket({
  order: { ui: { startNav: true }, actions: ['navigate'], place: 'Museum' },
});
assert.deepEqual(navOnly.act.actions, ['navigate']);
assert.equal(navOnly.act.topic, null);

// Explicit pitch_module wins — soft food path must not flip away
assert.equal(
  finalizeCall1Execution(
    base({
      execution: 'pitch_module',
      order: ayce,
      mustHaves: orderTicketToMustHaves(ayce),
      frame: emptyTurnFrame({
        tasks: [{ id: 'd1', worker: 'dining', brief: 'AYCE Freitag ohne Asia' }],
      }),
    }),
    'Freitag All you can eat Hamburg, aber kein Asiatisch',
  ),
  'pitch_module',
  'explicit AYCE pitch stays pitch',
);

// Explicit chat stays chat for weather (safety may still cut sticky — weather text)
assert.equal(
  finalizeCall1Execution(
    base({
      execution: 'chat_lane',
      chatLane: 'chat',
      bridge: 'Kurz zum Regen — ich check das.',
    }),
    'Regnet es gleich?',
  ),
  'chat_lane',
  'weather stays chat_lane',
);

// Explicit nav honored
assert.equal(
  finalizeCall1Execution(
    base({
      execution: 'nav_execute',
      chatLane: 'nav',
      bridge: 'Klar, Navigation zum Tennisclub — ich starte.',
    }),
    'Navigiere mich zum Tennis-Club',
  ),
  'nav_execute',
  'explicit nav stays',
);

console.log('call1OrderTicket.smoke.test.ts OK');
