/**
 * whenFlex Prefer/Soft + Optionen-Policy + Partner-Audit + Hop-Annotate.
 */
import assert from 'node:assert/strict';
import {
  parseWhenFlexFromText,
  scoreWhenFlexLeg,
  scoreOptionWhenFlex,
  returnTimeTradeoffBonus,
} from './whenFlex';
import {
  classifyOptionBrief,
  targetOptionCount,
  sliceOptionsToPolicy,
} from './optionPolicy';
import { auditPartnerLedgerKeys } from './partnerFieldAudit';
import { annotateDayPlansWithHopStops } from './research/hopDayAnnotate';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import { QUESTION_CATALOG } from './questionCatalog';
import { dayTabLabel, normalizeDayPlans } from './research/composePlan';

// --- Catalog keys exist ---
for (const id of [
  'whenFlex',
  'lodgingRank',
  'surfacePref',
  'bahncard',
  'hopStops',
  'cityExplore',
  'accessNeeds',
  'maxRailH',
  'spaIntent',
  'partyMusic',
]) {
  assert(QUESTION_CATALOG.some((q) => q.id === id), `catalog ${id}`);
}

// --- whenFlex parse ---
const flex = parseWhenFlexFromText(
  'Am liebsten Freitag los, Donnerstag ab 13 Uhr geht auch. Rück Dienstag schöner als Mittwoch.',
);
assert(flex?.outbound?.preferWeekday === 'fr', `prefer out ${flex?.outbound?.preferWeekday}`);
assert(flex?.outbound?.softWeekdays?.includes('do'), `soft do ${flex?.outbound?.softWeekdays}`);
assert(flex?.outbound?.earliestHour === 13, `earliest ${flex?.outbound?.earliestHour}`);
assert(flex?.return?.preferWeekday === 'di', `prefer ret ${flex?.return?.preferWeekday}`);
assert(flex?.return?.softWeekdays?.includes('mi'), `soft mi ${flex?.return?.softWeekdays}`);

assert.equal(scoreWhenFlexLeg(flex!.outbound!, '2026-09-18', 10), 12); // Fr prefer (18.9.2026 = Fr)
assert.equal(scoreWhenFlexLeg(flex!.outbound!, '2026-09-17', 14), 7); // Do soft + after 13
assert.equal(scoreWhenFlexLeg(flex!.outbound!, '2026-09-17', 10), 2); // Do soft but too early

assert(returnTimeTradeoffBonus({ preferHour: 6, softHour: 14 }) >= 4, 'tradeoff early ret');

const ledFlex = mergeLedger(cloneEmptyLedger(), {
  whenFlex: entry(flex!, 'user', 'wish'),
});
assert(scoreOptionWhenFlex(ledFlex, { outboundDateKey: '2026-09-18', outboundHour: 9 }) >= 10);

const parsed = parseBriefSlots(
  'Am liebsten Freitag, Donnerstag ab 13 geht auch. FlixTrain ok, Bus eher nicht. Mailand dann Verona dann Venedig.',
);
assert(parsed.whenFlex?.value?.outbound?.preferWeekday === 'fr', 'parse whenFlex');
assert(parsed.surfacePref?.value === 'train_ok_bus_no' || parsed.surfacePref?.value === 'train_only', `surface ${parsed.surfacePref?.value}`);
assert((parsed.hopStops?.value?.length ?? 0) >= 2, `hops ${JSON.stringify(parsed.hopStops?.value)}`);

const rank = parseBriefSlots('Am geilsten All-Inclusive Hotel, Notfall Apartment');
assert(rank.lodgingKind?.value === 'hotel', `rank kind ${rank.lodgingKind?.value}`);
assert(rank.lodgingFallback?.value === 'apartment', `rank fb ${rank.lodgingFallback?.value}`);

// --- Option policy ---
const openLed = mergeLedger(cloneEmptyLedger(), {
  weatherWant: entry('warm', 'user'),
  budgetVibe: entry('cheap', 'user'),
  dealHunt: entry(true, 'user'),
});
assert.equal(classifyOptionBrief(openLed), 'open');
assert.equal(targetOptionCount(openLed), 4);

const specLed = mergeLedger(cloneEmptyLedger(), {
  destinationHint: entry('Prag', 'user'),
  dateStart: entry('2026-09-19', 'user'),
  dateEnd: entry('2026-09-21', 'user'),
  dateFlex: entry('exact', 'user'),
});
assert.equal(classifyOptionBrief(specLed), 'specific');
assert.equal(targetOptionCount(specLed), 2);

const many = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
assert.equal(sliceOptionsToPolicy(many, openLed).length, 4);
assert.equal(sliceOptionsToPolicy(many, specLed).length, 2);
assert.equal(sliceOptionsToPolicy([{ id: 1 }], openLed).length, 1);

// --- Partner audit ---
const audit = auditPartnerLedgerKeys();
assert(audit.ok, `partner keys missing ${'missing' in audit ? audit.missing.join(',') : ''}`);

// --- Day weekday + hop annotate ---
const tab = dayTabLabel('2026-09-18', 1);
assert(/Fr/.test(tab), `tab ${tab}`);
const norm = normalizeDayPlans([
  { dayKey: '2026-09-18', title: '', blocks: [{ id: 'a', title: 'Flug', detail: 'x', bookUrl: 'https://example.com/f' }] },
]);
assert(norm[0]?.weekdayLabel === 'Fr', `wd ${norm[0]?.weekdayLabel}`);
assert(norm[0]?.blocks[0]?.bookUrl, 'block link');

const hopped = annotateDayPlansWithHopStops(
  [
    { dayKey: '2026-09-18', title: 'Fr 18.9. · Anreise', blocks: [] },
    { dayKey: '2026-09-19', title: 'Sa 19.9. · Erkunden', blocks: [] },
    { dayKey: '2026-09-20', title: 'So 20.9. · Abreise', blocks: [] },
  ],
  [
    { city: 'Mailand', nights: 1 },
    { city: 'Verona', nights: 1 },
    { city: 'Venedig', nights: 1 },
  ],
);
assert(/Mailand/.test(hopped[0]!.title), hopped[0]!.title);
assert(/Verona/.test(hopped[1]!.title), hopped[1]!.title);
assert(/Venedig/.test(hopped[2]!.title), hopped[2]!.title);

console.log('phase1Plus.smoke.test.ts ok');
