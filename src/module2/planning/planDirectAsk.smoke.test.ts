/**
 * Run: npx --yes tsx src/module2/planning/planDirectAsk.smoke.test.ts
 */

import { onPlanDirectAsk } from './planDirectAsk';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(typeof onPlanDirectAsk === 'function', 'onPlanDirectAsk exported');
onPlanDirectAsk();

console.log('planDirectAsk.smoke.test.ts ok');
