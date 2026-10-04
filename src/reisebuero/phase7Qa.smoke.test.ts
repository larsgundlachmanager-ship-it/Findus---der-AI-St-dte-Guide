/**
 * Phase 7 QA — Prefer-Score · Option-Policy · Funnel-Rail · Magazin/Timeline-Form.
 */
import assert from 'node:assert/strict';
import {
  parseWhenFlexFromText,
  scoreWhenFlexLeg,
  scoreOptionWhenFlex,
} from './whenFlex';
import {
  classifyOptionBrief,
  targetOptionCount,
  sliceOptionsToPolicy,
} from './optionPolicy';
import { QUESTION_CATALOG } from './questionCatalog';
import { RESEARCH_STATUS_RAIL } from './research/progressPace';
import { normalizeTheaterStage } from './research/theaterStages';
import { buildMagazineMapPins, ensureDayWeekdayLabels, layoutMagazineMapPins } from './magazineMapPins';
import { buildTimelineStopsFromOption } from './timelineStopsFromOption';
import { expandFlightWindowOptions } from './flightWindowVariants';
import { magazineOptionKind } from './magazineOptionKind';
import { auditPartnerLedgerKeys } from './partnerFieldAudit';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import type { ReiseOption } from './types';

// --- 7.1 Katalog + whenFlex Parse ---
for (const id of ['whenFlex', 'lodgingRank', 'surfacePref', 'hopStops', 'accessNeeds']) {
  assert(QUESTION_CATALOG.some((q) => q.id === id), `catalog ${id}`);
}

const flex = parseWhenFlexFromText(
  'Am liebsten Freitag los, Donnerstag ab 13 geht auch. Rück Dienstag schöner als Mittwoch.',
);
assert.equal(flex?.outbound?.preferWeekday, 'fr');
assert.ok(flex?.outbound?.softWeekdays?.includes('do'));
assert.equal(flex?.outbound?.earliestHour, 13);
assert.equal(flex?.return?.preferWeekday, 'di');
assert.ok(flex?.return?.softWeekdays?.includes('mi'));

// --- 7.2 Prefer-Score: Di > Mi bei gleichem Preisniveau ---
// 2026-09-22 = Di, 2026-09-23 = Mi
assert.equal(scoreWhenFlexLeg(flex!.return!, '2026-09-22', 12), 12, 'Di prefer');
assert.equal(scoreWhenFlexLeg(flex!.return!, '2026-09-23', 12), 7, 'Mi soft');
const led = mergeLedger(cloneEmptyLedger(), { whenFlex: entry(flex!, 'user', 'wish') });
const diScore = scoreOptionWhenFlex(led, {
  outboundDateKey: '2026-09-18', // Fr prefer
  outboundHour: 14,
  returnDateKey: '2026-09-22',
  returnHour: 12,
});
const miScore = scoreOptionWhenFlex(led, {
  outboundDateKey: '2026-09-18',
  outboundHour: 14,
  returnDateKey: '2026-09-23',
  returnHour: 12,
});
assert.ok(diScore > miScore, `Di ${diScore} > Mi ${miScore} same window`);

// --- 7.3 Optionen-Policy ---
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
assert.equal(sliceOptionsToPolicy([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], openLed).length, 4);
assert.equal(sliceOptionsToPolicy([{ id: 1 }, { id: 2 }, { id: 3 }], specLed).length, 2);

// --- 7.4 Funnel-Stage Rail ---
assert.equal(RESEARCH_STATUS_RAIL[0]?.stage, 'brief_plan');
assert.equal(RESEARCH_STATUS_RAIL.at(-1)?.stage, 'package_pick');
assert.equal(normalizeTheaterStage('climate'), 'open_space');
assert.equal(normalizeTheaterStage('flights'), 'flight_matrix');
assert.equal(normalizeTheaterStage('qa'), 'package_pick');

// --- 7.5 Magazin Timetable + Karte Datenform ---
const flexLed = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots(
    'Am liebsten Freitag los, Donnerstag ab 13 geht auch. Rück Dienstag schöner als Mittwoch. Prag Wochenende ab Hamburg.',
  ),
);
const base: ReiseOption = {
  id: 'o1',
  title: 'Prag Weekend',
  placeName: 'Prag',
  matchScore: 80,
  pricePerPerson: 220,
  gaps: [],
  facts: [],
  decisionNotes: [],
  lat: 50.08,
  lng: 14.43,
  days: ensureDayWeekdayLabels([
    {
      dayKey: '2026-09-18',
      title: 'Anreise',
      blocks: [
        { id: 'f1', time: '13:40', title: 'Flug', detail: 'HAM→PRG', bookUrl: 'https://example.com/fly' },
        { id: 'c1', time: '16:00', title: 'Check-in', detail: 'Hotel', bookUrl: 'https://example.com/stay' },
      ],
    },
    {
      dayKey: '2026-09-19',
      title: 'Erkunden',
      blocks: [{ id: 'a1', time: '11:00', title: 'Altstadt', detail: 'Spaziergang', bookUrl: 'https://example.com/t' }],
    },
    {
      dayKey: '2026-09-20',
      title: 'Abreise',
      blocks: [{ id: 'r1', time: '14:00', title: 'Flug', detail: 'Rück', bookUrl: 'https://example.com/fly2' }],
    },
  ]),
};
const windows = expandFlightWindowOptions([base], flexLed);
assert.ok(windows.length >= 2, `flight windows ${windows.length}`);
assert.ok(windows.some((o) => magazineOptionKind(o) === 'flight_window'));

const pins = buildMagazineMapPins(base);
assert.ok(pins.some((p) => p.dayNum === 1));
const laid = layoutMagazineMapPins(pins);
assert.ok(laid.every((p) => p.xPct >= 5 && p.xPct <= 95 && p.yPct >= 5 && p.yPct <= 95));

const tl = buildTimelineStopsFromOption(base, flexLed);
assert.ok(tl.length >= 3, `timeline days ${tl.length}`);
assert.ok(tl.some((s) => /Fr|18\.9/i.test(s.title || '')));
assert.ok(tl.some((s) => s.mapsUrl && /example\.com/.test(s.mapsUrl)));

// Partner keys still present
const audit = auditPartnerLedgerKeys();
assert.ok(audit.ok, `partner keys ${'missing' in audit ? audit.missing.join(',') : ''}`);

console.log('phase7Qa.smoke.test.ts ok');
