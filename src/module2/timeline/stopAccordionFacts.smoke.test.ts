/**
 * Run: npx --yes tsx src/module2/timeline/stopAccordionFacts.smoke.test.ts
 */

import { stopAccordionFacts } from './stopAccordionFacts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const arrive = new Date(2026, 7, 18, 23, 11).getTime();
const leave = new Date(2026, 7, 18, 23, 14).getTime();
const lastEnd = new Date(2026, 7, 18, 23, 37).getTime();

const mid = stopAccordionFacts({
  atMs: arrive,
  endMs: leave,
  notes: 'ca. 3 Min vor Ort',
});
assert(mid.length === 2, 'zwei Stichpunkte');
assert(mid[0] === 'Ankunft 23:11 · ca. 3 Min vor Ort', `Ankunft+Pause: ${mid[0]}`);
assert(mid[1] === 'Weiter ab 23:14', `Weiter: ${mid[1]}`);

const last = stopAccordionFacts({
  atMs: new Date(2026, 7, 18, 23, 29).getTime(),
  endMs: lastEnd,
  notes: 'ca. 8 Min vor Ort · Tour fertig ~23:37',
});
assert(last[0]?.includes('Ankunft 23:29'), 'letzter Stop Ankunft');
assert(last[1] === 'Tour fertig ~23:37', `Tour-Ende statt Weiter: ${last[1]}`);

assert(
  stopAccordionFacts({
    atMs: arrive,
    endMs: leave,
    notes: '53.12345, 9.87654 · 25476 Prisdorf',
  }).every((s) => !s.includes('53.') && !s.includes('25476')),
  'keine GPS/PLZ in Stichpunkten',
);

console.log('stopAccordionFacts.smoke.test.ts ok');
