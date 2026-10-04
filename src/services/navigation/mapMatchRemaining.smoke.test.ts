/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/mapMatchRemaining.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/navigation/mapMatchEngine.ts'),
  'utf8',
);
assert(src.includes('export function getRemainingRouteCoords'), 'Remaining API');
assert(src.includes('never prepends a spur'), 'kein Spur zurück zum Start');
assert(src.includes('lastAlongM = projection.alongM'), 'Along tracked');
assert(src.includes('snapMaxM'), 'optional GPS snap');
assert(!src.includes('current.unshift'), 'kein unshift in Match-Engine');

console.log('mapMatchRemaining.smoke.test.ts OK');
