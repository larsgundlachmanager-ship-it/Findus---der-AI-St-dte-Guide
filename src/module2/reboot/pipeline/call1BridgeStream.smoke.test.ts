/**
 * Sprint A smoke — bridge stream + research budget.
 */

import { tryExtractBridgeField } from './streamJsonBridge';
import { resolveResearchBudget } from './researchBudget';
import { parseTopicScope } from './topicScopeParse';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Bridge extractor
{
  const partial = '{"intentSummary":"x","bridge":"Hamburg heute Abend';
  assert(tryExtractBridgeField(partial) === null, 'partial bridge incomplete');
  const full =
    '{"bridge":"Hamburg heute Abend — ich schau was läuft.","lane":"pitch"}';
  const hit = tryExtractBridgeField(full);
  assert(hit?.complete === true, 'bridge complete');
  assert(
    hit?.value?.includes('Hamburg heute Abend'),
    'bridge text',
  );
}

// Research budget hybrid
{
  const nav = resolveResearchBudget({ lane: 'nav' });
  assert(nav.finalSec <= 2, 'nav fast');
  const events = resolveResearchBudget({
    lane: 'chat',
    blueprintId: 'live_events',
    needsResearch: 'deep',
    llmResearchBudgetSec: 15,
  });
  assert(events.finalSec <= 12, 'events capped');
  assert(events.finalSec >= 7, 'events floor');
}

// topicScope
{
  const scope = parseTopicScope({ mode: 'followup', turnsForCall2: 14 });
  assert(scope.turnsForCall2 === 10, 'clamp 10');
  const fresh = parseTopicScope({ mode: 'new', turnsForCall2: 0 });
  assert(fresh.turnsForCall2 === 0, 'zero turns new');
}

console.log('[call1-bridge-stream] ok');
