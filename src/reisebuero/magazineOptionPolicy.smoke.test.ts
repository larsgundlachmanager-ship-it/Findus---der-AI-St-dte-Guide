/**
 * Magazin Optionen-Policy UI: offen→4, spez≥2, Cover-Hint, Finalize idempotent.
 */
import assert from 'node:assert/strict';
import { finalizeMagazineOptions } from './magazineOptionPolicy';
import {
  classifyOptionBrief,
  magazineOptionsCoverHint,
  padOptionsFromPool,
  sliceOptionsToPolicy,
  targetOptionCount,
} from './optionPolicy';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { buildResultsCoverState, RESULTS_COVER_MAX } from './resultsCover';
import type { ReiseOption } from './types';

function stub(id: string, place: string, score = 80): ReiseOption {
  return {
    id,
    title: place,
    placeName: place,
    matchScore: score,
    pricePerPerson: 200,
    gaps: [],
    facts: [],
    decisionNotes: [],
    lat: 50,
    lng: 14,
  };
}

const openLed = mergeLedger(cloneEmptyLedger(), {
  weatherWant: entry('warm', 'user'),
  budgetVibe: entry('cheap', 'user'),
  dealHunt: entry(true, 'user'),
});
assert.equal(classifyOptionBrief(openLed), 'open');
assert.equal(targetOptionCount(openLed), 4);

const cities = [
  stub('a', 'Palma', 90),
  stub('b', 'Ibiza', 88),
  stub('c', 'Budapest', 85),
  stub('d', 'Prag', 82),
  stub('e', 'Antalya', 70),
];
const openFinal = finalizeMagazineOptions(cities.slice(0, 2), openLed, cities);
assert.equal(openFinal.length, 4, `open pad→4 got ${openFinal.length}`);
assert.equal(magazineOptionsCoverHint(openLed, openFinal.length), '4 Optionen — Städte & Deals');

const openShort = finalizeMagazineOptions(cities.slice(0, 2), openLed, cities.slice(0, 2));
assert.equal(openShort.length, 2);
assert.match(magazineOptionsCoverHint(openLed, 2), /2 von 4/);

const cover = buildResultsCoverState(openFinal);
assert.equal(cover.options.length, 4);
assert.equal(cover.options.length <= RESULTS_COVER_MAX, true);
assert.ok(cover.selectedOptionId);

const specLed = mergeLedger(cloneEmptyLedger(), {
  destinationHint: entry('Prag', 'user'),
  dateStart: entry('2026-09-19', 'user'),
  dateEnd: entry('2026-09-21', 'user'),
  dateFlex: entry('exact', 'user'),
  lodgingKind: entry('apartment', 'user'),
  lodgingFallback: entry('hotel', 'user'),
  whenFlex: entry(
    {
      outbound: { preferWeekday: 'fr', softWeekdays: ['do'], earliestHour: 13 },
      return: { preferWeekday: 'so', softWeekdays: [] },
    },
    'user',
    'wish',
  ),
});
assert.equal(classifyOptionBrief(specLed), 'specific');
assert.equal(targetOptionCount(specLed), 2);

const prag = stub('prg', 'Prag', 86);
prag.stays = [
  { id: 'apt', name: 'Altstadt Apartment', priceEur: 160, bookUrl: 'https://example.com/a' },
  { id: 'hot', name: 'Central Hotel', priceEur: 200, bookUrl: 'https://example.com/h' },
];
const specFinal = finalizeMagazineOptions([prag], specLed);
assert.ok(specFinal.length >= 2, `specific ≥2 got ${specFinal.length}`);
assert.ok(specFinal.length <= 4);
assert.match(magazineOptionsCoverHint(specLed, specFinal.length), /Pakete/);

// Idempotent: zweimal Finalize ändert Anzahl nicht
const again = finalizeMagazineOptions(specFinal, specLed);
assert.equal(again.length, specFinal.length);

const padded = padOptionsFromPool([cities[0]!], cities, openLed);
assert.equal(sliceOptionsToPolicy(padded, openLed).length, 4);

console.log('magazineOptionPolicy.smoke.test.ts ok');
