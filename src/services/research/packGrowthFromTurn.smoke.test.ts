/**
 * Run: npx --yes tsx src/services/research/packGrowthFromTurn.smoke.test.ts
 */
import { shouldGrowPackFromUtterance } from './packGrowthPolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(shouldGrowPackFromUtterance('Wo bin ich?'), 'where am I');
assert(shouldGrowPackFromUtterance('Was ist das hier?'), 'deictic');
assert(shouldGrowPackFromUtterance('Erzähl mir die Geschichte'), 'story ask');
assert(!shouldGrowPackFromUtterance('Wie wird das Wetter?'), 'weather is not a place');
assert(!shouldGrowPackFromUtterance('ok'), 'too short');

console.log('packGrowthFromTurn.smoke.test.ts OK');
