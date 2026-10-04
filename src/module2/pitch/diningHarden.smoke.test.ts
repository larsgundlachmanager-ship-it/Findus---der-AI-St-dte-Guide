/**
 * P9 dining harden smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/diningHarden.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  touristTrapRankPenalty,
  parseBudgetPerPersonEur,
  filterOpenNowHard,
  diningDishNeedFromText,
  syncMenuOpenUrlAction,
} from './diningHarden';
import { inferCall1JobShape } from '../router/call1JobShape';

assert.ok(touristTrapRankPenalty({ rating: 3.9, ratingCount: 900 }) < 0);
assert.equal(parseBudgetPerPersonEur('max 25 Euro pro Person'), 25);
assert.equal(
  filterOpenNowHard(
    [
      { openNow: true },
      { openNow: false },
      { openNow: true, closedOnVisitDay: true },
    ],
    'here_now',
  ).kept.length,
  1,
);

const rucola = 'Pizza mit Rucola in der Nähe, offen jetzt';
assert.equal(inferCall1JobShape(rucola), 'place_dining');
assert.ok(
  diningDishNeedFromText(rucola)?.toLowerCase().includes('rucola') ||
    diningDishNeedFromText('Lust auf Rucola-Salat')
      ?.toLowerCase()
      .includes('rucola'),
);

const weird = 'Ich hab Lust auf Kimchi-Bowl';
assert.ok(
  diningDishNeedFromText(weird)?.toLowerCase().includes('kimchi'),
  'weird dish need token',
);

assert.equal(syncMenuOpenUrlAction({ menuUrl: 'not-a-url' }), null);
assert.ok(syncMenuOpenUrlAction({ menuUrl: 'https://example.com/menu.pdf' }));

console.log('diningHarden.smoke.test.ts OK');
