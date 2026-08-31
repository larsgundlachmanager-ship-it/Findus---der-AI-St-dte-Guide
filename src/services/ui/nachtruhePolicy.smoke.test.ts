/**
 * Run: npx --yes tsx src/services/ui/nachtruhePolicy.smoke.test.ts
 */

import {
  isNachtruhe,
  NACHTRUHE_ACTIVE_END_MIN,
  NACHTRUHE_ACTIVE_START_MIN,
} from './nachtruhePolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function at(h: number, m: number): number {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

assert(NACHTRUHE_ACTIVE_START_MIN === 9 * 60, 'Aktiv ab 9:00');
assert(NACHTRUHE_ACTIVE_END_MIN === 21 * 60 + 30, 'Nachtruhe ab 21:30');
assert(isNachtruhe(at(0, 35)) === true, '00:35 Nachtruhe');
assert(isNachtruhe(at(8, 59)) === true, '8:59 noch Nachtruhe');
assert(isNachtruhe(at(9, 0)) === false, '9:00 Aktiv');
assert(isNachtruhe(at(21, 0)) === false, '21:00 noch Abend');
assert(isNachtruhe(at(21, 29)) === false, '21:29 noch Aktiv');
assert(isNachtruhe(at(21, 30)) === true, '21:30 Nachtruhe');

console.log('nachtruhePolicy.smoke.test.ts OK');
