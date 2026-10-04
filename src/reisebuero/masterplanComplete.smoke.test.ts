/**
 * Masterplan Phase 3–7 Smokes: Recap · Flugfenster · Brief · Map · Timeline · Shelf.
 */
import assert from 'node:assert/strict';
import { composeRecapSpeech, recapFactHints } from './recapSpeech';
import { expandFlightWindowOptions } from './flightWindowVariants';
import { buildResearchBriefJson } from './researchBriefJson';
import { buildMagazineMapPins, ensureDayWeekdayLabels } from './magazineMapPins';
import { buildTimelineStopsFromOption } from './timelineStopsFromOption';
import { __setShelfAskedForTest, mergeShelfIntoAsked, listShelfAsked } from './shelfAskedPrefs';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import { STAGE_META } from './research/stageMeta';
import { detectCatalogBranches } from './questionCatalog';
import type { ReiseOption } from './types';

const flexLed = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots(
    'Am liebsten Freitag los, Donnerstag ab 13 geht auch. Rück Dienstag schöner als Mittwoch. Apartment, Notfall Hotel. Zwei Leute, 400 Euro, ab Hamburg.',
  ),
);

// Phase 3 Recap
const recap = composeRecapSpeech(flexLed);
assert(/Prefer|lieber|Soft|Do|Fr|Di/i.test(recap) || /Freitag|Donnerstag|Dienstag/i.test(recap) || /Los|Rück/i.test(recap), `recap flex ${recap}`);
const hints = recapFactHints(flexLed);
assert(hints.some((h) => /Prefer|Los|Rück|Notfall/i.test(h)), `hints ${hints.join('|')}`);

// Research brief JSON
const brief = buildResearchBriefJson(flexLed);
assert(brief.when.preferOutbound === 'fr' || brief.when.softOutbound.includes('do'), JSON.stringify(brief.when));
assert(brief.targetOptions >= 2);

// Phase 4 Flugfenster → mind. 2
const baseOpt: ReiseOption = {
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
      title: 'Fr 18.9. · Anreise',
      blocks: [
        { id: 'f1', time: '13:40', title: 'Flug', detail: 'HAM→PRG', bookUrl: 'https://example.com/fly' },
        { id: 'c1', time: '16:00', title: 'Check-in', detail: 'Hotel', bookUrl: 'https://example.com/stay' },
      ],
    },
    {
      dayKey: '2026-09-19',
      title: 'Sa 19.9. · Erkunden',
      blocks: [{ id: 'a1', time: '11:00', title: 'Altstadt', detail: 'Spaziergang', bookUrl: 'https://example.com/ticket' }],
    },
    {
      dayKey: '2026-09-20',
      title: 'So 20.9. · Abreise',
      blocks: [{ id: 'r1', time: '14:00', title: 'Flug', detail: 'Rück', bookUrl: 'https://example.com/fly2' }],
    },
  ]),
  transports: [
    {
      id: 'out',
      kind: 'flight',
      label: 'Hin',
      departAt: '2026-09-18T13:40:00',
      arriveAt: '2026-09-18T15:00:00',
      priceEur: 90,
      bookUrl: 'https://example.com/fly',
      better: true,
      departDateKey: '2026-09-18',
    },
  ],
};
const expanded = expandFlightWindowOptions([baseOpt], flexLed);
assert(expanded.length >= 2, `windows ${expanded.length}`);
assert(expanded.some((o) => /Fenster:/i.test((o.decisionNotes ?? []).join(' '))), 'fenster note');
assert(
  expanded.filter((o) => /Fenster:/i.test((o.decisionNotes ?? []).join(' '))).length >= 2,
  'prefer+soft as two magazin options',
);

// Theater aliases
assert(STAGE_META.package_pick?.title, 'package_pick meta');
assert(STAGE_META.flight_matrix?.title, 'flight_matrix meta');

// Map pins Tag-Nummern + Layout
const pins = buildMagazineMapPins(baseOpt);
assert(pins.some((p) => p.dayNum === 1), `pins ${JSON.stringify(pins.map((p) => p.dayNum))}`);
assert(pins.some((p) => p.kind === 'stay' || p.kind === 'day'), 'pin kinds');
const { layoutMagazineMapPins } = require('./magazineMapPins') as typeof import('./magazineMapPins');
const laid = layoutMagazineMapPins(pins);
assert(laid.every((p) => p.xPct >= 5 && p.xPct <= 95 && p.yPct >= 5 && p.yPct <= 95), 'layout pct');

// Timeline 1:1 mit Wochentag + Links
const tl = buildTimelineStopsFromOption(baseOpt, flexLed);
assert(tl.length >= 3, `tl ${tl.length}`);
assert(tl.some((s) => /Fr|18\.9/i.test(s.title || '')), `wd title ${tl.map((s) => s.title).join('|')}`);
assert(tl.some((s) => s.mapsUrl && /example\.com/.test(s.mapsUrl)), 'timeline links');

// Hop multi-city
const hopLed = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('Mailand dann Verona dann Venedig, eine Woche, ab Hamburg'),
);
assert((hopLed.hopStops?.value?.length ?? 0) >= 2, 'hops');
const { annotateDayPlansWithHopStops } =
  require('./research/hopDayAnnotate') as typeof import('./research/hopDayAnnotate');
const hopDays = annotateDayPlansWithHopStops(
  [
    { dayKey: '2026-09-18', title: 'Anreise', blocks: [{ id: 'a', title: 'Check-in', detail: 'Hotel' }] },
    { dayKey: '2026-09-19', title: 'Erkunden', blocks: [{ id: 'b', title: 'Altstadt', detail: 'Arena' }] },
    { dayKey: '2026-09-20', title: 'Weiter', blocks: [{ id: 'c', title: 'Spaziergang', detail: 'Platz' }] },
  ],
  hopLed.hopStops?.value,
);
assert(hopDays.some((d) => /Mailand|Verona|Venedig/i.test(d.title)), `hop titles ${hopDays.map((d) => d.title).join('|')}`);
assert(
  hopDays.some((d) => (d.blocks ?? []).some((b) => /Zug/i.test(b.title) && /→/.test(b.detail || ''))),
  'hop rail leg',
);
const hopOpt: ReiseOption = {
  ...baseOpt,
  id: 'hop1',
  placeName: 'Norditalien',
  days: ensureDayWeekdayLabels(hopDays),
};
const hopTl = buildTimelineStopsFromOption(hopOpt, hopLed);
assert(hopTl.some((s) => /Mailand|Verona|Venedig/i.test(s.title || '')), `hop tl ${hopTl.map((s) => s.title).join('|')}`);
assert(hopTl.some((s) => /Zug/i.test(s.title || '')), 'timeline zug');

// Recap Prefer full names
assert(/Freitag|Donnerstag|Dienstag|lieber|Erstspur/i.test(recap), `recap prefer words ${recap}`);

// Shelf abhaken
__setShelfAskedForTest(['meals', 'origin']);
const withMeals = mergeLedger(cloneEmptyLedger(), {
  meals: entry('self', 'user'),
  originCity: entry('Hamburg', 'user'),
});
const merged = mergeShelfIntoAsked(withMeals, []);
assert(merged.includes('meals') && merged.includes('origin'), `shelf ${merged}`);
assert(listShelfAsked().includes('meals'), 'list shelf');

// Persona branches
assert(detectCatalogBranches(cloneEmptyLedger(), 'Polarlicht Kreuzfahrt').includes('cruise'), 'cruise persona');
assert(detectCatalogBranches(cloneEmptyLedger(), 'Grand Slam Tennis Turnier').includes('tournament'), 'tournament');
assert(detectCatalogBranches(cloneEmptyLedger(), 'Familie Kids Club Animation').includes('family'), 'family');

// Schon gebucht ohne Fake-URL
const bookedLed = mergeLedger(flexLed, {
  bookedFlight: entry(true, 'user'),
  bookedStay: entry(true, 'user'),
});
const bookedTl = buildTimelineStopsFromOption(baseOpt, bookedLed);
assert(
  bookedTl.filter((s) => /schon gebucht/i.test(`${s.title} ${s.notes}`)).length >= 1,
  'booked markers',
);
assert(
  !bookedTl.some((s) => /Flug/i.test(s.title || '') && s.mapsUrl && /example\.com\/fly/.test(s.mapsUrl || '')),
  'no fake fly url when booked',
);

console.log('masterplanComplete.smoke.test.ts ok');
