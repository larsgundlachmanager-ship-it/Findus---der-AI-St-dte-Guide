/**
 * Gap-Inventar Masterplan — Parse / Mode / Checklist / Handoff smokes.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from './parseBriefSlots';
import { mergeLedger, cloneEmptyLedger, entry } from './slotLedger';
import { deriveInventoryMode, searchFlightLive, searchStayLive, looksLikeGapAddOn } from './gapInventory';
import { buildFlipchartNotes } from './flipchartNotes';
import { nextQuestionKey } from './completeness';
import { isFindusReisebueroHandoff } from './handoff';
import { buildBookingChecklist } from './research/composePlan';
import { buildJourneyBeats } from './research/storyMagazine';
import { buildTimelineStopsFromOption } from './timelineStopsFromOption';
import { inventoryRecapHint } from './inventoryRecap';
import type { ReiseOption } from './types';

function led(text: string) {
  return mergeLedger(cloneEmptyLedger(), parseBriefSlots(text));
}

// H.1 Parse Zielbild-Sätze
{
  const a = led('Flug haben wir schon gebucht, brauchen noch ein Hotel in Barcelona, zu zweit, Oktober, 500 Euro');
  assert.equal(a.bookedFlight?.value, true, 'flight booked');
  assert.equal(a.bookedStay?.value, false, 'stay need');
  assert.equal(deriveInventoryMode(a), 'gap_fill', 'gap_fill flight+need stay');
}

{
  const b = led('Hotel haben wir schon, muss noch hinfliegen, Palma, 4 Nächte');
  assert.equal(b.bookedStay?.value, true, 'stay booked');
  assert.equal(b.bookedFlight?.value, false, 'flight need');
  assert.ok(b.inventoryMode?.value === 'gap_fill' || deriveInventoryMode(b) === 'gap_fill');
}

{
  const c = led('Flug und Hotel stehen, brauche noch einen Mietwagen vor Ort');
  assert.equal(c.bookedFlight?.value, true, 'c flight');
  assert.equal(c.bookedStay?.value, true, 'c stay');
  assert.equal(c.needCar?.value, true, 'need car');
  assert.equal(c.bookedCar?.value, false, 'car not booked');
  assert.equal(deriveInventoryMode(c), 'gap_fill', 'car gap');
}

{
  const d = led('Bahn schon gebucht, Unterkunft fehlt noch, Berlin, Wochenende');
  assert.equal(d.bookedRail?.value, true, 'rail booked');
  assert.equal(d.mode?.value, 'train', 'mode train');
}

{
  const e = led('Flix schon gebucht, nur noch Hotel in Prag');
  assert.equal(e.bookedBus?.value, true, 'bus booked');
  assert.equal(e.bookedStay?.value, false, 'stay need from nur hotel');
}

{
  const f = led('Konzert-Tickets hab ich schon, Flug und Hotel noch offen, Amsterdam');
  assert.ok((f.bookedActivities?.value?.length ?? 0) >= 1, 'activity booked');
  assert.ok(/konzert/i.test(f.bookedActivities!.value![0]!.name), 'konzert name');
}

// Langer Dump multi-slot
{
  const dump = led(
    'Also wir sind zu viert, Oktober, Budget so 400 Euro pro Person, Hotel in Lissabon haben wir schon gebucht, Flug fehlt noch, Transfer brauchen wir auch noch, und Mietwagen wäre nice, Party und Pool wäre cool',
  );
  assert.equal(dump.adults?.value, 4, 'dump adults');
  assert.equal(dump.bookedStay?.value, true, 'dump stay');
  assert.equal(dump.bookedFlight?.value, false, 'dump flight need');
  assert.ok(dump.budgetEur?.value === 400 || dump.budgetEur?.value != null, 'dump budget');
  assert.ok(inventoryRecapHint(dump)?.length, 'recap hint');
  const notes = buildFlipchartNotes(dump);
  assert.ok(notes.some((n) => n.id === 'bookedStay'), 'flip stay');
  assert.ok(notes.some((n) => n.id === 'scopeFlight' || n.id === 'needCar' || n.label.includes('Flug')), 'flip gap');
}

// H.2 Completeness gap_fill
{
  const g = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots(
      'Hotel schon gebucht, brauche nur noch den Flug, zu zweit, nächstes Wochenende, 300 Euro, ab Hamburg nach Palma',
    ),
  );
  // bags not required when searching flight if mode set; lodging filled via bookedStay
  assert.equal(searchStayLive(g), false, 'no stay live');
  assert.equal(searchFlightLive(g), true, 'flight live');
  const nq = nextQuestionKey(g, ['bookedBits', 'purpose', 'extraWishes', 'highlight']);
  // should not insist on lodgingKind
  assert.notEqual(nq.key, 'lodging', 'skip lodging when booked');
}

// H.4 Checklist nur Lücken
{
  const cl = buildBookingChecklist({
    transports: [
      {
        id: 'f1',
        kind: 'flight',
        label: 'HAM→PMI',
        bookUrl: 'https://www.kiwi.com/deep?from=HAM&to=PMI&date=2026-10-10',
        priceEur: 120,
        better: true,
        flightNumber: 'EW1234',
        carrier: 'Eurowings',
      } as never,
    ],
    stays: [
      {
        id: 's1',
        name: 'Hotel Test',
        bookUrl: 'https://www.booking.com/hotel/es/test-hotel.html',
        priceEur: 400,
      } as never,
    ],
    alreadyBookedStay: true,
    alreadyBookedFlight: false,
  });
  assert.ok(cl.some((i) => i.alreadyBooked && i.kind === 'stay'), 'have stay row');
  assert.ok(!cl.some((i) => i.kind === 'stay' && i.url && !i.alreadyBooked), 'no stay book cta');
  assert.ok(
    cl.some((i) => i.kind === 'flight' && (i.url || i.label)),
    'flight book cta',
  );
}

// Journey beats already booked
{
  const opt: ReiseOption = {
    id: 'o1',
    title: 'Test',
    placeName: 'Palma',
    lat: 39.5,
    lng: 2.6,
    totalEur: null,
    budgetDeltaEur: null,
    transports: [],
    stays: [],
  } as never;
  const ledger = mergeLedger(cloneEmptyLedger(), {
    bookedFlight: entry(true, 'user', 'must'),
    bookedStay: entry(false, 'user', 'wish'),
    dateStart: entry('2026-10-10', 'user'),
  });
  const { outbound } = buildJourneyBeats(opt, { ledger });
  assert.ok(outbound.some((b) => b.alreadyBooked && /flug/i.test(b.title)), 'beat flight have');
}

// Timeline
{
  const opt: ReiseOption = {
    id: 'tl1',
    title: 'Trip',
    placeName: 'Barcelona',
    lat: 41.3,
    lng: 2.1,
    totalEur: 800,
    budgetDeltaEur: null,
    stayName: 'Hostal',
    stayBookUrl: 'https://example.com/stay',
  } as never;
  const ledger = mergeLedger(cloneEmptyLedger(), {
    bookedFlight: entry(true, 'user', 'must'),
    bookedStay: entry(false, 'user', 'wish'),
    dateStart: entry('2026-11-01', 'user'),
    stayNights: entry(3, 'user'),
    adults: entry(2, 'user'),
    needCar: entry(true, 'user', 'wish'),
  });
  const stops = buildTimelineStopsFromOption(opt, ledger);
  assert.ok(stops.some((s) => /schon gebucht/i.test(s.title) && /flug/i.test(s.title)), 'tl flight have');
  assert.ok(stops.some((s) => /mietwagen/i.test(s.title)), 'tl car need');
  assert.ok(stops.some((s) => /hostal|unterkunft|stay/i.test(s.title) && !/schon gebucht/i.test(s.title)), 'tl stay open');
}

// H.5 Handoff
assert.ok(
  isFindusReisebueroHandoff('Hab den Flug schon, brauche noch ein Hotel in Barcelona für Oktober'),
  'handoff flight+need hotel',
);
assert.ok(
  isFindusReisebueroHandoff('Unterkunft steht, muss noch fliegen, Palma Wochenende'),
  'handoff stay+need flight',
);
assert.ok(
  isFindusReisebueroHandoff('Flug und Hotel da, brauche noch Mietwagen'),
  'handoff need car',
);
assert.ok(
  !isFindusReisebueroHandoff('Ich brauche jetzt ein Hotelzimmer hier'),
  'no handoff tonight hotel',
);

{
  assert.equal(looksLikeGapAddOn('brauch noch einen Mietwagen vor Ort'), true, 'gap addon car');
  assert.equal(looksLikeGapAddOn('wie ist das Wetter'), false, 'not gap addon');
}

console.log('gapInventory.smoke.test.ts OK');
