/**
 * Flight / FlixBus / Event schedule parsers (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/travelScheduleExtra.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  looksLikeFlightScheduleWrite,
  looksLikeFlixBusScheduleWrite,
  looksLikeEventScheduleWrite,
  parseFlightIdentFromText,
  parseCityPairFromText,
  extractFlightSlotsFromBlob,
  extractBusSlotsFromBlob,
  extractEventSlotsFromBlob,
  hasScheduleWriteSignal,
} from './travelScheduleExtra';
import {
  detectAllTravelScheduleKinds,
  looksLikeTravelScheduleWriteJob,
  upsertHotelStammToTimeline,
  parseHotelStammFromText,
} from './travelScheduleHarden';
import { inferCall1JobShape } from '../router/call1JobShape';

assert.equal(hasScheduleWriteSignal('Trag das in den Terminkalender'), true);
assert.equal(
  looksLikeFlightScheduleWrite('Trag LH400 Check-in und Boarding in die Timeline'),
  true,
);
assert.equal(parseFlightIdentFromText('Mein Flug LH 400 nach JFK'), 'LH400');
assert.equal(
  looksLikeFlightScheduleWrite('Wann fliegt LH400?'),
  false,
  'no write → no steal',
);

const flightSlots = extractFlightSlotsFromBlob(
  'LH400 nach New York: Check-in ab 10:00, Boarding um 11:30, Abflug 12:15, Ankunft 15:40 Gate A12.',
);
assert.equal(flightSlots.checkInHm, '10:00');
assert.equal(flightSlots.boardingHm, '11:30');
assert.equal(flightSlots.departHm, '12:15');
assert.equal(flightSlots.arriveHm, '15:40');

assert.equal(
  looksLikeFlixBusScheduleWrite(
    'FlixBus von Hamburg nach Berlin um 9 Uhr in die Timeline',
  ),
  true,
);
const pair = parseCityPairFromText('FlixBus von Hamburg nach Berlin');
assert.equal(pair.origin, 'Hamburg');
assert.equal(pair.dest, 'Berlin');
const bus = extractBusSlotsFromBlob('Abfahrt 09:00 Ankunft 12:30 · 3h 30min');
assert.equal(bus.departHm, '09:00');
assert.equal(bus.arriveHm, '12:30');

assert.equal(
  looksLikeEventScheduleWrite(
    'Konzert Metallica Einlass 19 Beginn 20 Uhr in den Kalender',
  ),
  true,
);
const ev = extractEventSlotsFromBlob(
  'Konzert Metallica im Holstenhallen: Einlass 19:00 Beginn 20:00 https://www.eventim.de/ticket',
);
assert.equal(ev.doorsHm, '19:00');
assert.equal(ev.startHm, '20:00');
assert.ok(ev.ticketUrl);

const multi = detectAllTravelScheduleKinds(
  'Trag Bahn nach Kiel, Hotel Atlantic Check-in 15 und FlixBus zurück in die Timeline',
);
assert.ok(multi.includes('hotel_stamm'), `hotel in ${multi}`);
assert.ok(multi.includes('train') || multi.includes('flixbus'), `transport in ${multi}`);

assert.equal(
  looksLikeTravelScheduleWriteJob(
    'Flug LH400 und Hotel Check-in in die Timeline',
  ),
  true,
);
assert.equal(
  inferCall1JobShape('Trag FlixBus und Konzert in den Kalender'),
  'schedule_write',
);

const hotel = parseHotelStammFromText(
  'Hotel Atlantic Check-in um 15 Uhr, Frühstück und Check-out um 11',
);
hotel.checkoutDayKey = '2099-06-14';
hotel.dayKey = '2099-06-12';
hotel.breakfastHm = '07:30';
hotel.breakfast = true;
const up = upsertHotelStammToTimeline(hotel);
assert.equal(up.ok, true, 'hotel multi-day upsert');

console.log('travelScheduleExtra.smoke.test.ts OK');
