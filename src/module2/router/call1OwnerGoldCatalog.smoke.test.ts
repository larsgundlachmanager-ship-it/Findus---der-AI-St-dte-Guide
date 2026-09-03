/**
 * Call-1 Owner-Gold Katalog + Isolation — smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1OwnerGoldCatalog.smoke.test.ts
 */

import assert from 'node:assert/strict';
import {
  collectOwnerGoldCatalog,
  formatOwnerGoldCatalogForCall1,
  formatSelectedGoldForCall2,
} from './call1OwnerGoldCatalog';
import { shouldScrubStickyForNewTopic } from './call1ManagerIsolation';
import type { ManagerAnalysis } from './types';

const gold = collectOwnerGoldCatalog();
assert(Array.isArray(gold), 'gold array');
const cat = formatOwnerGoldCatalogForCall1(gold);
assert(cat.includes('OWNER_GOLD_KATALOG') || cat === '', 'katalog format');
if (gold[0]?.situationKey) {
  const picked = formatSelectedGoldForCall2([gold[0].situationKey], gold);
  assert(picked.includes('OWNER_GOLD_GEWAEHLT'), 'selected format');
}

const base = {
  intentSummary: 'x',
  route: 'blueprint',
  blueprintId: null,
  blueprintStage: null,
  session: 'new',
  threadMatchId: null,
  subject: null,
  bridge: null,
  lanePlan: 'fast_only',
  pace: 'instant',
  bridgeMaxWords: 12,
  fastDeadlineMs: 2000,
  latencyHintSec: null,
  tasks: [],
  openLoops: [],
  nameAllowed: false,
  jobHint: null,
} as ManagerAnalysis;

assert(shouldScrubStickyForNewTopic(base) === true, 'new session scrubs');
assert(
  shouldScrubStickyForNewTopic({
    ...base,
    session: 'continue',
    topicScope: { mode: 'followup', turnsForCall2: 4, inheritLiveInventory: true },
  }) === false,
  'followup keep',
);
assert(
  shouldScrubStickyForNewTopic({
    ...base,
    session: 'continue',
    topicScope: { mode: 'new', turnsForCall2: 0 },
  }) === true,
  'topic new scrubs',
);

console.log('call1OwnerGoldCatalog.smoke.test.ts OK');
