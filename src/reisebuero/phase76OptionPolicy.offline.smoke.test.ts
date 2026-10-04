/**
 * Masterplan 7.6 offline: Policy-Ziele warm/günstig=4, Prag-WE≥2.
 * Device-QA separat wenn Handy online.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from './parseBriefSlots';
import { cloneEmptyLedger, mergeLedger } from './slotLedger';
import {
  classifyOptionBrief,
  targetOptionCount,
  sliceOptionsToPolicy,
} from './optionPolicy';
import { finalizeMagazineOptions } from './magazineOptionPolicy';
import type { ReiseOption } from './types';

function led(text: string) {
  return mergeLedger(cloneEmptyLedger(), parseBriefSlots(text));
}

function stub(id: string, place: string): ReiseOption {
  return {
    id,
    title: place,
    placeName: place,
    matchScore: 70,
    pricePerPerson: 200,
    gaps: [],
    facts: [],
    decisionNotes: [],
  };
}

const openLed = led(
  'Irgendwohin warm und günstig, zwei Leute, ab Hamburg, flexibel, Deal suchen',
);
assert.equal(classifyOptionBrief(openLed), 'open', 'A grain open');
assert.equal(targetOptionCount(openLed), 4, 'A target 4');

const pool4 = ['a', 'b', 'c', 'd', 'e'].map((id, i) => stub(id, `Ort${i}`));
const finOpen = finalizeMagazineOptions(pool4.slice(0, 2), openLed, pool4);
assert.ok(finOpen.length >= 4, `A finalize ≥4 got ${finOpen.length}`);
assert.equal(sliceOptionsToPolicy(pool4, openLed).length, 4, 'A slice 4');

const pragLed = led(
  'Prag dieses Wochenende, Freitag bis Sonntag, Apartment oder Hotel, zwei Leute, 400 Euro, ab Hamburg',
);
assert.match(pragLed.destinationHint?.value || '', /prag/i, 'B dest Prag');
assert.equal(classifyOptionBrief(pragLed), 'specific', `B grain ${classifyOptionBrief(pragLed)}`);
assert.equal(targetOptionCount(pragLed), 2, 'B target 2');

const pool2 = [stub('p1', 'Prag Apt'), stub('p2', 'Prag Hotel'), stub('p3', 'Prag Extra')];
const finPrag = finalizeMagazineOptions([pool2[0]!], pragLed, pool2);
assert.ok(finPrag.length >= 2, `B finalize ≥2 got ${finPrag.length}`);
assert.ok(finPrag.length <= 3, `B not open-4 got ${finPrag.length}`);

console.log('phase76_option_policy.offline.ok', {
  A: { grain: classifyOptionBrief(openLed), n: finOpen.length },
  B: { grain: classifyOptionBrief(pragLed), n: finPrag.length, target: targetOptionCount(pragLed) },
});
