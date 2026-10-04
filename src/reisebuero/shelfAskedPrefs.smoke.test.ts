/**
 * Shelf abhaken: Wert merken → Apply → Catalog skip → Flipchart-Chips.
 */
import assert from 'node:assert/strict';
import {
  __resetShelfAskedForTest,
  __setShelfAskedForTest,
  applyShelfPrefsToLedger,
  listShelfAsked,
  mergeShelfIntoAsked,
  rememberShelfFromLedger,
  shelfCheckOffChips,
  shelfReuseTopics,
} from './shelfAskedPrefs';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { nextCatalogQuestion } from './questionCatalog';

__resetShelfAskedForTest();

const filled = mergeLedger(cloneEmptyLedger(), {
  meals: entry('breakfast', 'user'),
  cabinBags: entry(1, 'user'),
  checkedBags: entry(0, 'user'),
  originCity: entry('Hamburg', 'user'),
  surfacePref: entry('train_ok_bus_no', 'user'),
});

const saved = rememberShelfFromLedger(filled, ['meals', 'bags', 'origin', 'surfacePref']);
assert.deepEqual(
  saved.sort(),
  ['bags', 'meals', 'origin', 'surfacePref'].sort(),
  `saved ${saved}`,
);
assert(listShelfAsked().includes('meals'), 'list meals');

// Neuer Trip: Apply füllt leere Slots mit source shelf
const applied = applyShelfPrefsToLedger(cloneEmptyLedger());
assert.equal(applied.ledger.meals?.value, 'breakfast', 'meals applied');
assert.equal(applied.ledger.meals?.source, 'shelf', 'meals source shelf');
assert.equal(applied.ledger.cabinBags?.value, 1, 'bags applied');
assert.equal(applied.ledger.originCity?.value, 'Hamburg', 'origin applied');
assert(applied.appliedIds.includes('meals'), `appliedIds ${applied.appliedIds}`);

// Catalog: shelfable Fragen abgehakt
const asked = mergeShelfIntoAsked(applied.ledger, []);
assert(asked.includes('meals') && asked.includes('bags') && asked.includes('origin'), `asked ${asked}`);

// UX chips
const chips = shelfCheckOffChips(applied.ledger);
assert(chips.some((c) => c.topic === 'Essen'), `chips ${JSON.stringify(chips)}`);
assert(chips.some((c) => c.id === 'bags'), 'bags chip');
assert(shelfReuseTopics(applied.ledger).includes('Essen'), 'reuse topics');

// User überschreibt Shelf
const userWins = mergeLedger(applied.ledger, {
  meals: entry('all', 'user'),
});
assert.equal(userWins.meals?.value, 'all');
assert.equal(userWins.meals?.source, 'user');

// Snapshot-Apply (wie originDefaults nach hydrate)
__setShelfAskedForTest(['meals'], [
  {
    id: 'meals',
    value: 'half',
    topic: 'Essen',
    updatedAtMs: Date.now(),
  },
]);
const viaSnap = applyShelfPrefsToLedger(cloneEmptyLedger());
assert.equal(viaSnap.ledger.meals?.value, 'half', 'snap apply');
assert.equal(viaSnap.ledger.meals?.source, 'shelf');

// Legacy ID-only: merge nur wenn Wert schon da
__setShelfAskedForTest(['meals', 'origin']);
const legacyMerge = mergeShelfIntoAsked(
  mergeLedger(cloneEmptyLedger(), { meals: entry('self', 'user') }),
  [],
);
assert(legacyMerge.includes('meals'), 'legacy meals');
assert(!legacyMerge.includes('origin'), 'legacy origin ohne Wert nicht skippen');

// nextCatalogQuestion überspringt shelf-meals wenn Core sonst offen
__resetShelfAskedForTest();
rememberShelfFromLedger(
  mergeLedger(cloneEmptyLedger(), {
    meals: entry('breakfast', 'user'),
    cabinBags: entry(1, 'user'),
  }),
  ['meals', 'bags'],
);
const core = mergeLedger(cloneEmptyLedger(), {
  purpose: entry('Urlaub', 'user'),
  adults: entry(2, 'user'),
  dateStart: entry('2026-09-11', 'user'),
  dateEnd: entry('2026-09-14', 'user'),
  budgetEur: entry(500, 'user'),
  originCity: entry('Hamburg', 'user'),
  lodgingOpen: entry(true, 'user'),
  mode: entry('fly', 'user'),
});
const withShelf = applyShelfPrefsToLedger(core).ledger;
const next = nextCatalogQuestion(withShelf, []);
assert(next?.id !== 'meals' && next?.id !== 'bags', `next should skip shelf ${next?.id}`);

console.log('shelfAskedPrefs.smoke.test.ts ok');
