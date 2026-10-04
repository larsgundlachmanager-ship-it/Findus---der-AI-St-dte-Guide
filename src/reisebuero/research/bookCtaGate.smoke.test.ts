/**
 * Book-CTA-Gate: nur mit belegter Angebots-ID buchen, sonst „noch nachziehen“.
 */
import assert from 'node:assert/strict';
import {
  gateFlightBookItem,
  gateStayBookItem,
  isVerifiedFlightOffer,
  isVerifiedStayOffer,
  mayOpenBookingCheckItem,
  pendingBookLabel,
} from './bookCtaGate';
import { buildBookingChecklist } from './composePlan';
import {
  bookingBriefGaps,
  briefParamsReady,
} from '../completeness';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';
import { parseBriefSlots } from '../parseBriefSlots';

const PROP =
  'https://www.expedia.de/Hotel-Information?hotelId=12345678&chkin=2026-07-10&chkout=2026-07-17';
const SEARCH =
  'https://www.expedia.de/Hotel-Search?destination=Antalya&startDate=2026-07-10&endDate=2026-07-17';
const AIRBNB = 'https://www.airbnb.com/rooms/1359377017583012847?adults=2';
const KIWI = 'https://www.kiwi.com/deep?from=HAM&to=AYT&departure=2026-07-10';

assert.equal(isVerifiedStayOffer({ bookUrl: PROP, expediaPropertyId: null }), true);
assert.equal(isVerifiedStayOffer({ bookUrl: SEARCH, expediaPropertyId: null }), false);
assert.equal(isVerifiedStayOffer({ bookUrl: SEARCH, expediaPropertyId: '12345678' }), true);
assert.equal(isVerifiedStayOffer({ bookUrl: AIRBNB }), true);
assert.equal(isVerifiedStayOffer({ bookUrl: 'https://www.expedia.com/' }), false);

assert.equal(isVerifiedFlightOffer({ flightNumber: 'FR2049' }), true);
assert.equal(isVerifiedFlightOffer({ flightNumber: 'XQ 291', carrier: 'SunExpress' }), true);
assert.equal(isVerifiedFlightOffer({ flightNumber: null, carrier: 'FR' }), false);
assert.equal(isVerifiedFlightOffer({ flightNumber: 'soon' }), false);

{
  const ok = gateStayBookItem({
    id: 'st-1',
    name: 'Hotel Paloma',
    bookUrl: PROP,
    expediaPropertyId: '12345678',
  });
  assert.equal(ok.label, 'Hotel Paloma');
  assert.ok(ok.url);
  assert.equal(mayOpenBookingCheckItem(ok), true);
}

{
  const soft = gateStayBookItem({
    id: 'st-2',
    name: 'Irgendwas',
    bookUrl: SEARCH,
    expediaPropertyId: null,
  });
  assert.equal(soft.label, pendingBookLabel('stay'));
  assert.equal(soft.url, null);
  assert.equal(mayOpenBookingCheckItem(soft), false);
}

{
  const hollow = gateStayBookItem({
    id: 'st-3',
    name: 'Hohl',
    bookUrl: 'https://www.expedia.com/',
    expediaPropertyId: null,
  });
  assert.equal(hollow.label, pendingBookLabel('stay'));
  assert.equal(hollow.url, null);
  assert.equal(mayOpenBookingCheckItem(hollow), false);
}

{
  const flyOk = gateFlightBookItem({
    id: 'tr-1',
    label: 'HAM→AYT',
    bookUrl: KIWI,
    flightNumber: 'XQ291',
    carrier: 'XQ',
  });
  assert.match(flyOk.label, /XQ291|Flug/);
  assert.equal(mayOpenBookingCheckItem(flyOk), true);
}

{
  const flyPend = gateFlightBookItem({
    id: 'tr-2',
    label: 'HAM→AYT',
    bookUrl: KIWI,
    flightNumber: null,
    carrier: null,
  });
  assert.equal(flyPend.label, pendingBookLabel('flight'));
  assert.equal(flyPend.url, null);
  assert.equal(mayOpenBookingCheckItem(flyPend), false);
}

{
  const list = buildBookingChecklist({
    transports: [
      {
        id: 'f1',
        kind: 'flight',
        label: 'HAM→AYT',
        bookUrl: KIWI,
        priceEur: 120,
        flightNumber: null,
        carrier: null,
        better: true,
      },
    ],
    selectedTransportId: 'f1',
    stays: [
      {
        id: 's1',
        name: 'Paloma',
        priceEur: 400,
        bookUrl: PROP,
        photoUrl: null,
        why: 'Deal',
        expediaPropertyId: '12345678',
      },
      {
        id: 's2',
        name: 'Nur Suche',
        priceEur: 300,
        bookUrl: SEARCH,
        photoUrl: null,
        why: 'x',
      },
    ],
    selectedStayId: 's1',
  });
  const stayOk = list.find((i) => i.id === 'st-s1');
  const stayAlt = list.find((i) => i.id === 'st-s2');
  const fly = list.find((i) => i.id === 'tr-f1');
  assert.ok(stayOk && stayOk.label === 'Paloma');
  // Alternativ-Stay nicht in der Buchungsliste — nur der Favorit
  assert.ok(!stayAlt, 'no compare stay in checklist');
  assert.ok(fly && /noch nachziehen/i.test(fly.label));

  const softOnly = buildBookingChecklist({
    stays: [
      {
        id: 's2',
        name: 'Nur Suche',
        priceEur: 300,
        bookUrl: SEARCH,
        photoUrl: null,
        why: 'x',
      },
    ],
    selectedStayId: 's2',
  });
  const staySoft = softOnly.find((i) => i.id === 'st-s2');
  assert.ok(staySoft && /noch nachziehen/i.test(staySoft.label));
}

{
  let led = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('fliegen, vom 11. bis 13. Juni, zu zweit, 400 Euro, Hostel, ab Hamburg'),
  );
  assert.ok(bookingBriefGaps(led).some((g) => g.key === 'bags'));
  assert.equal(briefParamsReady(led), false);
  led = mergeLedger(led, { cabinBags: entry(0, 'user'), checkedBags: entry(0, 'user') });
  assert.ok(!bookingBriefGaps(led).some((g) => g.key === 'bags'));
  assert.equal(briefParamsReady(led), true);
}

console.log('bookCtaGate.smoke.test.ts: ok');
