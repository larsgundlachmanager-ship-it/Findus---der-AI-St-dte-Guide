/**
 * Run: npx --yes tsx src/services/affiliate/openUrlBookingPrefill.test.ts
 */
import { withReservationPrefill } from '../reservation/reservationPrefill';
import {
  applyOpenUrlBookingPrefill,
  looksLikeHotelBookOpenUrl,
  looksLikeReservationOpenUrl,
} from './openUrlBookingPrefill';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeHotelBookOpenUrl('🏨 Zimmer buchen', 'https://www.expedia.de/go/hotel/info/123/2026-08-20/2026-08-21'),
  'hotel url',
);
assert(
  looksLikeReservationOpenUrl('🌐 Tisch online', 'https://www.opentable.de/r/gasthaus'),
  'opentable reservation',
);
assert(
  !looksLikeHotelBookOpenUrl('🍽 Karte', 'https://wirtshaus.de/speisekarte'),
  'menu is not hotel',
);

const ot = withReservationPrefill('https://www.opentable.de/r/demo', {
  partySize: 2,
  dateIso: '2026-08-20',
  timeHm: '19:30',
  guestName: 'Lars Finder',
  guestEmail: 'lars@example.com',
});
assert(/covers=2/.test(ot), `opentable covers: ${ot}`);
assert(/datetime=2026-08-20T19%3A30|datetime=2026-08-20T19:30/.test(ot), `opentable datetime: ${ot}`);
assert(/Lars/.test(decodeURIComponent(ot)), 'opentable first name');
assert(/lars%40example.com|lars@example.com/.test(ot), 'opentable email');

const hotel = applyOpenUrlBookingPrefill({
  url: 'https://www.expedia.de/go/hotel/info/99999/2026-08-20/2026-08-21',
  label: '🏨 Zimmer buchen',
  payload: {
    destName: 'Hotel Atlantic',
    checkin: '2026-08-20',
    checkout: '2026-08-22',
    adults: 2,
  },
});
assert(/2026-08-20/.test(hotel.url) && /2026-08-22/.test(hotel.url), `hotel dates in url: ${hotel.url}`);
assert(hotel.checkin === '2026-08-20', 'checkin patch');
assert(hotel.checkout === '2026-08-22', 'checkout patch');

const destHotel = applyOpenUrlBookingPrefill({
  url: 'https://www.stay22.com/allez/findus?address=Germany',
  label: '🏨 Zimmer buchen',
  payload: {
    destName: 'Electra Metropolis',
    destination: 'Athen',
    checkin: '2026-08-21',
    checkout: '2026-08-23',
    adults: 1,
  },
});
assert(
  /electra|metropolis|athen/i.test(decodeURIComponent(destHotel.url)),
  `prefill inserts named hotel + dest city: ${destHotel.url}`,
);
assert(
  !/[?&](?:address|destination)=Germany(?:&|$)/i.test(destHotel.url),
  `prefill does not keep Germany-only dest: ${destHotel.url}`,
);
assert(destHotel.checkin === '2026-08-21' && destHotel.checkout === '2026-08-23', 'prefill dates');
assert(destHotel.adults === 1, 'prefill adults');

console.log('openUrlBookingPrefill.test.ts ok');
