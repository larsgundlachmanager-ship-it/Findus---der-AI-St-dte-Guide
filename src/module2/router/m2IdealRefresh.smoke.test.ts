/**
 * Evidence button order + open-world novel (no RN imports).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/m2IdealRefresh.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  dropGenericWebWhenEvidence,
  prioritizeEvidenceButtons,
} from '../pitch/evidenceButtons';
import { buildOpenWorldContract } from './call1OpenWorldContract';
import { FINDUS_CALL1_OPEN_WORLD_BLOCK } from './call1OpenWorldContract';

const buttons = prioritizeEvidenceButtons(
  dropGenericWebWhenEvidence([
    {
      type: 'OPEN_URL',
      label: 'Web suchen',
      payload: { url: 'https://google.com/search?q=x' },
    },
    {
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: 'https://venue.example/menu' },
    },
    { type: 'START_NAVIGATION', label: '📍 Ort', payload: {} },
    {
      type: 'OPEN_URL',
      label: 'Maps',
      payload: { url: 'https://maps.google.com/?q=1' },
    },
  ]),
);
assert.equal(buttons[0]?.label?.includes('Speisekarte'), true, 'menu first');
assert.ok(
  buttons.every((b) => !/web\s*suchen/i.test(String(b.label))),
  'no generic web when evidence',
);

assert.ok(
  FINDUS_CALL1_OPEN_WORLD_BLOCK.includes('OPEN-WORLD'),
  'open world prompt block',
);

const novel = buildOpenWorldContract({
  userText: 'Hop-on Hop-off Bus in Hamburg, Tickets bitte',
});
assert.ok(novel.novelRequiresDeepWeb, 'hop-on novel deep web');
assert.ok(novel.uiRequirements.needTicket, 'ticket ui');

const hotel = buildOpenWorldContract({
  userText: 'Hotel für heute noch schnell',
});
assert.equal(hotel.answerSlot, 'hotel');
assert.equal(hotel.uiRequirements.openCalendar, false);


// —— remaining Ideal pieces ——
{
  const { noteLastLiveInventory, clearLastLiveInventory } = require('../context/shortTermContext') as {
    noteLastLiveInventory: (o: { kind: 'pitch_choice'; query: string }) => void;
    clearLastLiveInventory: () => void;
  };
  clearLastLiveInventory();
  noteLastLiveInventory({
    kind: 'pitch_choice',
    query: 'all you can eat kein Asiatisch Hamburg',
  });
  const follow = buildOpenWorldContract({
    userText: 'kein Asiatisch bitte',
  });
  assert.ok(
    follow.must.some((m) => /ayce|all_you_can_eat/i.test(m)),
    'follow-up keeps AYCE must from live inventory',
  );
  assert.equal(follow.answerSlot, 'venue_pitch', 'follow-up stays dining slot');
  clearLastLiveInventory();
}

{
  const { finalizeCall1Execution } = require('./call1Dispatch') as {
    finalizeCall1Execution: (a: unknown, t: string) => string;
  };
  const base = {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Ok.',
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
  };
  assert.equal(
    finalizeCall1Execution(base, 'Pauschalreise Check24 schnell Links'),
    'pitch_module',
    'package_quick -> pitch not reisebuero',
  );
}

{
  const { formatBriefForCall2 } = require('./call1WorkOrchestrator') as {
    formatBriefForCall2: (b: any) => string;
  };
  const { buildCall1TaskBrief } = require('./call1TaskBrief') as {
    buildCall1TaskBrief: (o: any) => any;
  };
  const brief = buildCall1TaskBrief({
    analysis: {
      bridge: 'Wetter check.',
      session: 'new',
      authorIntent: 'Wetter',
      intentSummary: 'Wetter',
      frame: {
        tasks: [{ id: 'w1', worker: 'weather', brief: 'Regen heute' }],
        mustHaves: [],
        referents: [],
        thinkAhead: [],
      },
    },
    userText: 'Regnet es heute Nachmittag?',
  });
  const block = formatBriefForCall2(brief);
  assert.ok(/temp_c|rain_timing|Wetter/i.test(block), 'weather tip in Call2 brief');
}

{
  const { resolveLocalAnchor } = require('../context/shortTermContext') as {
    resolveLocalAnchor: (t: string) => unknown;
  };
  assert.equal(
    resolveLocalAnchor('Ken Eat heute Abend kein Asiatisch'),
    null,
    'AYCE does not soft-fill Goldschätzchen',
  );
  assert.ok(
    resolveLocalAnchor('Fahr mich zum Goldschätzchen'),
    'named Goldschätzchen still resolves',
  );
}


console.log('m2IdealRefresh.smoke.test.ts OK');
