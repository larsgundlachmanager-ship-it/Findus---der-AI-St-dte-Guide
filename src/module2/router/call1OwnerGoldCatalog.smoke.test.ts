/**
 * Call-1 Owner-Gold Katalog + Isolation — smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1OwnerGoldCatalog.smoke.test.ts
 */

import assert from 'node:assert/strict';
import {
  collectOwnerGoldCatalog,
  formatOwnerGoldCatalogForCall1,
  formatSelectedGoldForCall2,
  inferOwnerGoldFamilyHints,
} from './call1OwnerGoldCatalog';
import { shouldScrubStickyForNewTopic } from './call1ManagerIsolation';
import type { ManagerAnalysis } from './types';

const gold = collectOwnerGoldCatalog();
assert(Array.isArray(gold), 'gold array');
assert(gold.length >= 40, `expected most golds, got ${gold.length}`);

const cat = formatOwnerGoldCatalogForCall1(gold);
assert(cat.includes('OWNER_GOLD_KATALOG'), 'katalog format');
assert(/Situations-Muster/i.test(cat), 'muster header');
assert(/ungetestete Formulierungen|analog|Absicht/i.test(cat), 'transfer instruction');
assert(
  cat.includes('events::date_window_empty_things_to_do_v1') ||
    /date_window_empty/i.test(cat),
  'events date-window gold in catalog',
);
assert(
  cat.includes('planning::reisebuero_collect_v1') || /reisebuero_collect/i.test(cat),
  'reisebuero gold in catalog',
);

const ranked = formatOwnerGoldCatalogForCall1(
  gold,
  'events',
  inferOwnerGoldFamilyHints(
    'Wir sind vom 16. bis 20. in Korbach — was für Events gibt es da?',
  ),
);
const eventsPos = ranked.indexOf('family=events');
const planningPos = ranked.indexOf('family=planning');
assert(eventsPos >= 0, 'events present when hinted');
if (planningPos >= 0) {
  assert(eventsPos < planningPos, 'events ranked before planning on whats-on ask');
}

const hintsTrip = inferOwnerGoldFamilyHints(
  'Boah ich überlege nach Paris im Oktober zu fliegen — was schickst du mir davor?',
);
assert(hintsTrip.includes('planning'), 'trip → planning hint');

if (gold[0]?.situationKey) {
  const picked = formatSelectedGoldForCall2([gold[0].situationKey], gold);
  assert(picked.includes('OWNER_GOLD_GEWAEHLT'), 'selected format');
  assert(/übertragen|Struktur/i.test(picked), 'selected transfer cue');
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
