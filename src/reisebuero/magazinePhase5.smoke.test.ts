/**
 * Phase 5 Magazin — Optionen · Timetable · Karte · Buy-in · Refine.
 */
import assert from 'node:assert/strict';
import { expandFlightWindowOptions } from './flightWindowVariants';
import {
  expandLodgingTrackOptions,
  magazineOptionKind,
  magazineOptionKindLabel,
} from './magazineOptionKind';
import { buildMagazineMapPins, ensureDayWeekdayLabels, layoutMagazineMapPins } from './magazineMapPins';
import { composeMagazineRefineAck, magazineWantsResearchAgain } from './magazineRefine';
import { buyInFromParts } from './research/composePlan';
import { annotateDayPlansWithHopStops } from './research/hopDayAnnotate';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import type { ReiseOption } from './types';
import { targetOptionCount, sliceOptionsToPolicy } from './optionPolicy';

const flexLed = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots(
    'Am liebsten Freitag los, Donnerstag ab 13 geht auch. Rück Dienstag schöner als Mittwoch. Apartment, Notfall Hotel. Zwei Leute, 400 Euro, ab Hamburg. Prag dieses Wochenende.',
  ),
);

assert(targetOptionCount(flexLed) >= 2, 'specific ≥2');

const base: ReiseOption = {
  id: 'o1',
  title: 'Prag Weekend',
  placeName: 'Prag',
  matchScore: 82,
  pricePerPerson: 220,
  gaps: [],
  facts: [],
  decisionNotes: [],
  lat: 50.08,
  lng: 14.43,
  stayPriceEur: 180,
  flightPriceEur: 90,
  stays: [
    { id: 'apt1', name: 'Altstadt Apartment', priceEur: 180, bookUrl: 'https://example.com/apt' },
    { id: 'hot1', name: 'Central Hotel', priceEur: 220, bookUrl: 'https://example.com/hot' },
  ],
  days: ensureDayWeekdayLabels([
    {
      dayKey: '2026-09-18',
      title: 'Anreise',
      blocks: [
        { id: 'f1', time: '13:40', title: 'Flug', detail: 'HAM→PRG', bookUrl: 'https://example.com/fly' },
        { id: 'c1', time: '16:00', title: 'Check-in', detail: 'Apartment', bookUrl: 'https://example.com/apt' },
      ],
    },
    {
      dayKey: '2026-09-19',
      title: 'Erkunden',
      blocks: [{ id: 'a1', time: '11:00', title: 'Altstadt', detail: 'Spaziergang', bookUrl: 'https://example.com/t' }],
    },
  ]),
};

// 5.8 Flugfenster → 2 Karten
const windows = expandFlightWindowOptions([base], flexLed);
assert(windows.length >= 2, `windows ${windows.length}`);
assert(windows.every((o) => magazineOptionKind(o) === 'flight_window' || o.id === base.id) || windows.length >= 2);
assert(magazineOptionKind(windows[0]!) === 'flight_window', 'prefer window kind');
assert(magazineOptionKindLabel('flight_window') === 'Flugfenster');

// 5.1 Stay-Spuren
const tracks = expandLodgingTrackOptions([base], flexLed);
assert(tracks.length >= 2, `tracks ${tracks.length}`);
assert(tracks.some((o) => magazineOptionKind(o) === 'lodging_track'), 'lodging track');
assert(
  tracks.some((o) => /Erstspur/i.test((o.decisionNotes ?? []).join(' '))),
  'erstspur note',
);

// Policy slice
const sliced = sliceOptionsToPolicy([...windows, ...tracks.slice(0, 1)], flexLed);
assert(sliced.length >= 2 && sliced.length <= 4, `slice ${sliced.length}`);

// 5.3 Karte
const pins = buildMagazineMapPins(base);
const laid = layoutMagazineMapPins(pins);
assert(pins.some((p) => p.dayNum === 1), 'day1 pin');
assert(laid.length >= 2, 'layout');

// 5.4 Timetable form
assert(base.days![0]!.weekdayLabel, 'weekday');
assert(base.days![0]!.blocks.some((b) => b.bookUrl && b.time), 'block time+link');

// 5.7 Multi-city annotate
const hopLed = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('Mailand dann Verona dann Venedig, eine Woche, ab Hamburg'),
);
const hopDays = annotateDayPlansWithHopStops(base.days!, hopLed.hopStops?.value);
assert(hopDays.some((d) => /Mailand|Verona|Venedig/i.test(d.title)), 'hop city in title');

// 5.6 Buy-in ohne Extras
const buy = buyInFromParts({
  flightPerPersonEur: 90,
  stayEur: 180,
  transferEur: 40,
  extrasEur: 120,
  adults: 2,
});
assert(buy.buyInEur === Math.round((90 * 2 + 180 + 40) / 2), `buy ${buy.buyInEur}`);
assert(!/Extras/i.test(buy.buyInLabel) || /ohne/i.test(buy.buyInLabel), buy.buyInLabel);

// 5.5 Mic refine
assert(magazineWantsResearchAgain('bitte neu suchen'), 'research again');
assert(!magazineWantsResearchAgain('lieber Pool dazu'), 'no research');
const ack = composeMagazineRefineAck(flexLed, 'lieber Pool');
assert(/suchen|Feinschliff|mitgezogen/i.test(ack), ack);

console.log('magazinePhase5.smoke.test.ts ok');
