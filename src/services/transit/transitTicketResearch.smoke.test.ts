/**
 * Run: npx --yes tsx src/services/transit/transitTicketResearch.smoke.test.ts
 */
import { parseGoogleRouteFare } from '../navigation/googleRouteFare';
import { extractSpokenPriceEur } from '../research/extractSpokenPrice';
import {
  buildDbBookingOpenUrl,
  buildDbJourneySearchUrl,
  dbJourneySearchUrl,
  extractTicketProductName,
  looksLikeLongDistanceRailBooking,
  scoreTransitTicketShopUrl,
  wantsTransitTicketFare,
} from './transitTicketFareParse';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  wantsTransitTicketFare('wie teuer wäre das ticket dafür'),
  'Follow-up Ticketpreis',
);
assert(wantsTransitTicketFare('Ticket kaufen'), 'Kauf-Intent');
assert(!wantsTransitTicketFare('Parkticket bis 14 Uhr'), 'kein Parkticket');
assert(!wantsTransitTicketFare('Kinoticket Spider-Man'), 'kein Kino');

assert(
  extractTicketProductName('HVV Einzelkarte Erwachsene 3,90 €') ===
    'Einzelkarte Erwachsene',
  'Produktname',
);
assert(extractSpokenPriceEur('€3.50') === '3,50 €', 'Euro-Prefix');
assert(
  parseGoogleRouteFare({
    status: 'OK',
    routes: [{ fare: { currency: 'EUR', value: 3.9, text: '€3.90' } }],
  }) === '€3.90',
  'Google fare text',
);

const shop = 'https://www.hvv.de/de/fahrkarten/einzeltickets';
const home = 'https://www.bahn.de/';
const buchung = dbJourneySearchUrl('Prisdorf', 'Hamburg Hbf');
assert(buchung != null && /buchung\/fahrplan\/suche/i.test(buchung), 'DB Suche');
assert(
  scoreTransitTicketShopUrl(shop, 'Einzelkarten') >
    scoreTransitTicketShopUrl(home, 'Bahn'),
  'Shop schlägt Bahn-Home',
);
assert(
  buchung != null &&
    scoreTransitTicketShopUrl(buchung, 'Fahrplan') >
      scoreTransitTicketShopUrl(home, 'Bahn'),
  'Buchung schlägt Home',
);


assert(wantsTransitTicketFare('ICE Hamburg Berlin buchen'), 'ICE buchen');
assert(
  wantsTransitTicketFare('brauche eine 9-Uhr-Karte Preis'),
  '9-Uhr-Karte',
);
assert(
  looksLikeLongDistanceRailBooking('ICE von Hamburg nach Berlin', 'ICE 602'),
  'long distance',
);
const book = buildDbBookingOpenUrl({
  fromName: 'Hamburg Hbf',
  toName: 'Berlin Hbf',
  departAt: new Date('2026-09-22T09:12:00'),
  userText: 'ICE nach Berlin',
  line: 'ICE 602',
});
assert(book && /bahn\.de\/buchung/.test(book.url), 'book url');
assert(book && /ICE buchen/i.test(book.label), 'ICE label');
const timed = buildDbJourneySearchUrl({
  from: 'Hamburg Hbf',
  to: 'Berlin Hbf',
  departAt: new Date('2026-09-22T09:12:00'),
});
assert(timed && decodeURIComponent(timed).includes('2026-09-22T09:12:00'), 'hd clock');

console.log('transitTicketResearch.smoke.test.ts OK');
