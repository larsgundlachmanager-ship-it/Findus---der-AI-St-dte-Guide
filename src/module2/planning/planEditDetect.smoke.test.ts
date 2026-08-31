/**
 * Run: npx --yes tsx src/module2/planning/planEditDetect.smoke.test.ts
 */

import { looksLikeClearDayPlan, looksLikePlanEditUtterance } from './planEditDetect';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeClearDayPlan('kannst du die Timeline bitte löschen'),
  'timeline löschen',
);
assert(
  looksLikeClearDayPlan(
    'kannst du die Timeline bitte löschen also für heute alle Termine die geplant sind löschen',
  ),
  'alle Termine + timeline',
);
assert(looksLikeClearDayPlan('Plan löschen'), 'Plan löschen');
assert(looksLikeClearDayPlan('heutigen Plan leeren'), 'Plan leeren');
assert(looksLikeClearDayPlan('vergiss den Plan'), 'vergiss den Plan');
assert(looksLikePlanEditUtterance('lösche die Timeline'), 'edit path includes clear');

assert(!looksLikeClearDayPlan('Hotel löschen'), 'single stop is not clear-all');
assert(!looksLikeClearDayPlan('Picknick um 19 Uhr'), 'new wish is not clear');
assert(!looksLikeClearDayPlan('wie wird das Wetter'), 'weather is not clear');

console.log('planEditDetect.smoke.test.ts ok');
