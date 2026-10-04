/**
 * Phase 6 Timeline — Multi-Day 1:1 · Links · schon gebucht ohne Fake-URL.
 */
import assert from 'node:assert/strict';
import {
  buildTimelineDayBuckets,
  buildTimelineStopsFromOption,
  usableBookUrl,
} from './timelineStopsFromOption';
import { ensureDayWeekdayLabels } from './magazineMapPins';
import { annotateDayPlansWithHopStops } from './research/hopDayAnnotate';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import type { ReiseOption } from './types';

assert.equal(usableBookUrl(null), null);
assert.equal(usableBookUrl('not-a-url'), null);
assert.ok(usableBookUrl('https://kiwi.com/x'));

const led = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('Zwei Leute, ab Hamburg, Apartment'),
);
led.dateStart = entry('2026-09-18', 'user');
led.dateEnd = entry('2026-09-20', 'user');
led.stayNights = entry(2, 'user');

const opt: ReiseOption = {
  id: 'tl1',
  title: 'Prag',
  placeName: 'Prag',
  matchScore: 80,
  pricePerPerson: 200,
  gaps: [],
  facts: [],
  decisionNotes: [],
  lat: 50.08,
  lng: 14.43,
  flightBookUrl: 'https://example.com/fly',
  stayBookUrl: 'https://example.com/stay',
  days: ensureDayWeekdayLabels([
    {
      dayKey: '2026-09-18',
      title: 'Anreise',
      blocks: [
        {
          id: 'f1',
          time: '13:40',
          title: 'Flug',
          detail: 'HAM→PRG',
          bookUrl: 'https://example.com/fly',
        },
        {
          id: 'c1',
          time: '16:00',
          title: 'Check-in',
          detail: 'Apartment',
          bookUrl: 'https://example.com/stay',
        },
      ],
    },
    {
      dayKey: '2026-09-19',
      title: 'Stadt',
      blocks: [
        {
          id: 'a1',
          time: '11:00',
          title: 'Altstadt',
          detail: 'Spaziergang',
          bookUrl: 'https://example.com/ticket',
        },
      ],
    },
    {
      dayKey: '2026-09-20',
      title: 'Rück',
      blocks: [
        {
          id: 'r1',
          time: '14:00',
          title: 'Flug',
          detail: 'Rück',
          bookUrl: 'https://example.com/fly2',
        },
      ],
    },
  ]),
  bookingChecklist: [
    {
      id: 'chk_fly',
      label: 'Flug buchen',
      url: 'https://example.com/fly-chk',
      alreadyBooked: false,
    },
  ],
  wishChapters: [
    {
      id: 'w1',
      title: 'Party',
      mustHaveId: 'party',
      met: true,
      blurb: 'Club',
      bookUrl: 'https://example.com/club',
    },
  ],
};

// 6.1 Multi-Day Buckets
const buckets = buildTimelineDayBuckets(opt, led);
assert.equal(buckets.length, 3, `days ${buckets.length}`);
assert.deepEqual(
  buckets.map((b) => b.dayKey),
  ['2026-09-18', '2026-09-19', '2026-09-20'],
);
assert.ok(buckets[0]!.stops.some((s) => /Flug/i.test(s.title) && /Fr|18\.9/i.test(s.title)));
assert.ok(buckets[1]!.stops.some((s) => /Altstadt/i.test(s.title)));
assert.ok(
  buckets[0]!.stops.some((s) => s.mapsUrl === 'https://example.com/fly'),
  'flight link day1',
);
assert.ok(
  buckets[1]!.stops.some((s) => s.mapsUrl === 'https://example.com/ticket'),
  'ticket link day2',
);

// 6.2 Alle Book-Links (Checklist + Wish)
const flat = buildTimelineStopsFromOption(opt, led);
assert.ok(flat.some((s) => /Flug gebucht|Flug buchen/i.test(s.title || '') && s.mapsUrl));
assert.ok(flat.some((s) => /Party öffnen/i.test(s.title || '') && /club/.test(s.mapsUrl || '')));

// 6.3 Schon gebucht → kein Fake-URL
const bookedLed = mergeLedger(led, {
  bookedFlight: entry(true, 'user'),
  bookedStay: entry(true, 'user'),
});
const booked = buildTimelineStopsFromOption(opt, bookedLed);
assert.ok(booked.some((s) => /schon gebucht/i.test(`${s.title} ${s.notes}`)));
assert.ok(
  !booked.some(
    (s) => /Flug/i.test(s.title || '') && s.mapsUrl && /example\.com\/fly/.test(s.mapsUrl),
  ),
  'no fly url when booked',
);
assert.ok(
  !booked.some(
    (s) => /Check-in/i.test(s.title || '') && s.mapsUrl && /example\.com\/stay/.test(s.mapsUrl),
  ),
  'no stay url when booked',
);

// Multi-City hop still 1:1 days
const hopLed = mergeLedger(
  led,
  parseBriefSlots('Mailand dann Verona dann Venedig, eine Woche, ab Hamburg'),
);
const hopOpt: ReiseOption = {
  ...opt,
  id: 'hop',
  placeName: 'Norditalien',
  days: ensureDayWeekdayLabels(
    annotateDayPlansWithHopStops(opt.days!, hopLed.hopStops?.value),
  ),
};
const hopBuckets = buildTimelineDayBuckets(hopOpt, hopLed);
assert.ok(hopBuckets.length >= 2, 'hop days');
assert.ok(
  hopBuckets.some((b) => b.stops.some((s) => /Mailand|Verona|Venedig|Zug/i.test(s.title || ''))),
  'hop city/zug in timeline',
);

console.log('timelinePhase6.smoke.test.ts ok');
