/**
 * Run: npx --yes tsx src/services/navigation/streetAddressAnaphor.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isWeakNavDestLabel,
  looksLikeAddressAnaphor,
} from './streetAddressQuery';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(looksLikeAddressAnaphor('Bring mich zu dieser Adresse'), 'dieser Adresse');
assert(looksLikeAddressAnaphor('dahin'), 'dahin');
assert(!looksLikeAddressAnaphor('Heisterhoop 12 in Prisdorf'), 'echte Adresse');
assert(isWeakNavDestLabel('dieser Adresse'), 'weak dieser Adresse');
assert(isWeakNavDestLabel('dahin'), 'weak dahin');
assert(!isWeakNavDestLabel('Heisterhoop 12'), 'street not weak');

const hard = readFileSync(
  join(process.cwd(), 'src/services/navigation/hardNavOverride.ts'),
  'utf8',
);
assert(hard.includes('looksLikeAddressAnaphor'), 'Hard-Nav löst Anapher auf');
assert(hard.includes('isWeakNavDestLabel'), 'Pronomen nicht geocoden');

console.log('streetAddressAnaphor.smoke.test.ts OK');
