/**
 * Fragenkatalog: Master → Branches → Tiefe; Extras; nächste Frage.
 */
import assert from 'node:assert/strict';
import {
  detectCatalogBranches,
  maybeProposeCatalogExtra,
  nextCatalogQuestion,
  QUESTION_CATALOG,
} from './questionCatalog';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import { nextQuestionKey } from './completeness';

assert(QUESTION_CATALOG.some((q) => q.id === 'purpose'), 'purpose master');
assert(QUESTION_CATALOG.some((q) => q.branch === 'party'), 'party branch');
assert(QUESTION_CATALOG.some((q) => q.branch === 'spa'), 'spa branch');
assert(QUESTION_CATALOG.some((q) => q.branch === 'tournament'), 'tournament branch');
assert(QUESTION_CATALOG.some((q) => q.branch === 'event'), 'event branch');
assert(QUESTION_CATALOG.some((q) => q.branch === 'cruise'), 'cruise branch');
assert(QUESTION_CATALOG.some((q) => q.id === 'whenFlex'), 'whenFlex');
assert(QUESTION_CATALOG.some((q) => q.id === 'surfacePref'), 'surfacePref');
assert(QUESTION_CATALOG.some((q) => q.id === 'lodgingRank'), 'lodgingRank');
assert(QUESTION_CATALOG.some((q) => q.id === 'hopStops'), 'hopStops');

assert.equal(nextCatalogQuestion(cloneEmptyLedger(), [])?.id, 'purpose');

const core = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('fliegen, vom 11. bis 13. Juni, zu zweit, 400 Euro, Hostel, ab Hamburg'),
);
assert.equal(nextQuestionKey(core).key, 'bags', `core next ${nextQuestionKey(core).key}`);

const partyLed = mergeLedger(cloneEmptyLedger(), {
  purpose: entry('Männerwochenende Party', 'user'),
  adults: entry(4, 'user'),
  dateMonth: entry('2026-09', 'user'),
  budgetEur: entry(200, 'user'),
  originCity: entry('Hamburg', 'user'),
  lodgingOpen: entry(true, 'user'),
  mode: entry('fly', 'user'),
  cabinBags: entry(1, 'user'),
  meals: entry('breakfast', 'user'),
  localMovePref: entry('walk', 'user'),
  locationBias: entry('central', 'user'),
  destinationHint: entry('offen', 'user'),
  partyGrain: entry('clubs', 'user'),
});
const branches = detectCatalogBranches(partyLed, 'wir wollen feiern');
assert(branches.includes('party'), `party branch ${branches.join(',')}`);

const spaLine = 'richtig geiles Spa Wellness Wochenende';
assert(detectCatalogBranches(cloneEmptyLedger(), spaLine).includes('spa'), 'spa from line');

const extra = maybeProposeCatalogExtra(cloneEmptyLedger(), 'keine Ahnung irgendwie', 'budget');
assert(extra?.askSeed, 'vague budget → extra');

console.log('questionCatalog.smoke.test.ts ok');
