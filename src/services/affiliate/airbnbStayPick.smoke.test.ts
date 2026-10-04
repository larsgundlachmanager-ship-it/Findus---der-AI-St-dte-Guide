/**
 * Airbnb stay pick — rein, ohne RN.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/affiliate/airbnbStayPick.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildAirbnbStayCandidates,
  pickAirbnbStayActions,
} from './airbnbStayPick';
import {
  buildAirbnbAction,
  buildAirbnbRoomsUrl,
  extractAirbnbRoomId,
  getAirbnbSearchUrl,
  normalizeAirbnbListingUrl,
  shouldProbeAirbnb,
  wantsApartmentLodging,
  wantsExplicitAirbnb,
  withAirbnbStayPrefill,
} from './airbnbDeepLink';

assert.equal(wantsExplicitAirbnb('Zeig mir Airbnb in Berlin'), true);
assert.equal(wantsExplicitAirbnb('Apartment in Berlin'), false);

assert.equal(wantsApartmentLodging('Apartment Berlin'), true);
assert.equal(wantsApartmentLodging('Wohnung in Hamburg'), true);
assert.equal(wantsApartmentLodging('Fewo an der Nordsee'), true);
assert.equal(wantsApartmentLodging('Hotel Berlin'), false);

assert.equal(
  shouldProbeAirbnb({ text: 'Apartment Berlin', lodgingType: 'apartment', liveCount: 0 }),
  true,
);
assert.equal(
  shouldProbeAirbnb({ text: 'Apartment Berlin', lodgingType: 'apartment', liveCount: 5 }),
  false,
);
assert.equal(
  shouldProbeAirbnb({ text: 'Hotel Berlin', lodgingType: 'hotel', liveCount: 0 }),
  false,
);
assert.equal(
  shouldProbeAirbnb({ text: 'Airbnb Berlin', lodgingType: 'hotel', liveCount: 5 }),
  true,
  'explicit Airbnb always probes',
);
// Brand search primary still requires explicit word
assert.equal(wantsExplicitAirbnb('Apartment Berlin'), false);

const searchUrl = getAirbnbSearchUrl({
  city: 'Berlin',
  checkin: '2026-08-01',
  checkout: '2026-08-05',
  adults: 2,
  children: 1,
});
assert.match(searchUrl, /airbnb\.de\/s\/berlin\/homes/);
assert.match(searchUrl, /checkin=2026-08-01/);
assert.match(searchUrl, /adults=2/);
assert.match(searchUrl, /children=1/);

const barePrefill = withAirbnbStayPrefill('https://www.airbnb.de', {
  city: 'Hamburg',
  checkin: '2026-09-10',
  checkout: '2026-09-14',
  adults: 2,
  children: 0,
});
assert.match(barePrefill, /airbnb\.de\/s\/hamburg\/homes/);
assert.match(barePrefill, /checkin=2026-09-10/);
assert.match(barePrefill, /adults=2/);

// buildAirbnbRoomsUrl sets check_in/check_out/adults
const roomsBuilt = buildAirbnbRoomsUrl('1359377017583012847', {
  city: 'Berlin',
  checkin: '2026-09-28',
  checkout: '2026-10-03',
  adults: 2,
  children: 0,
});
assert.match(roomsBuilt, /airbnb\.de\/rooms\/1359377017583012847/);
assert.match(roomsBuilt, /check_in=2026-09-28/);
assert.match(roomsBuilt, /check_out=2026-10-03/);
assert.match(roomsBuilt, /adults=2/);
assert.match(roomsBuilt, /children=0/);
assert.match(roomsBuilt, /infants=0/);
assert.match(roomsBuilt, /pets=0/);
assert.equal(extractAirbnbRoomId(roomsBuilt), '1359377017583012847');

// normalize strips impression ids + applies dates
const normalized = normalizeAirbnbListingUrl(
  'https://www.airbnb.de/rooms/998877?source_impression_id=p3_abc&federated_search_id=xyz&previous_page_section_name=1000&search_mode=flex&adults=1&check_in=2020-01-01',
  {
    city: 'Berlin',
    checkin: '2026-08-01',
    checkout: '2026-08-05',
    adults: 2,
    children: 1,
  },
);
assert.match(normalized, /\/rooms\/998877/);
assert.match(normalized, /check_in=2026-08-01/);
assert.match(normalized, /check_out=2026-08-05/);
assert.match(normalized, /adults=2/);
assert.match(normalized, /children=1/);
assert.equal(/source_impression_id/.test(normalized), false);
assert.equal(/federated_search_id/.test(normalized), false);
assert.equal(/previous_page_section_name/.test(normalized), false);
assert.equal(/search_mode/.test(normalized), false);

// withAirbnbStayPrefill on rooms URL OVERWRITES dates (check_in/check_out)
const roomsPrefill = withAirbnbStayPrefill(
  'https://www.airbnb.de/rooms/998877?check_in=2020-01-01&check_out=2020-01-05&adults=1&source_impression_id=junk',
  {
    city: 'Berlin',
    checkin: '2026-08-01',
    checkout: '2026-08-05',
    adults: 2,
    children: 1,
  },
);
assert.match(roomsPrefill, /\/rooms\/998877/);
assert.match(roomsPrefill, /check_in=2026-08-01/);
assert.match(roomsPrefill, /check_out=2026-08-05/);
assert.match(roomsPrefill, /adults=2/);
assert.match(roomsPrefill, /children=1/);
assert.equal(/2020-01-01/.test(roomsPrefill), false);
assert.equal(/source_impression_id/.test(roomsPrefill), false);

// buildAirbnbAction with roomId + price → label includes price, rooms URL
const pricedAct = buildAirbnbAction({
  city: 'Berlin',
  checkin: '2026-09-28',
  checkout: '2026-10-03',
  adults: 2,
  roomId: '1359377017583012847',
  name: 'Loft Mitte',
  priceTotalEur: 587,
});
assert.match(pricedAct.label, /🔑 Loft Mitte · 587€/);
assert.match(pricedAct.payload.url, /\/rooms\/1359377017583012847/);
assert.match(pricedAct.payload.url, /check_in=2026-09-28/);

assert.equal(
  withAirbnbStayPrefill('https://www.booking.com/hotel/x', {
    city: 'Berlin',
    adults: 2,
  }),
  'https://www.booking.com/hotel/x',
);

// Explicit Airbnb + no live → Airbnb primary
const noLive = pickAirbnbStayActions({
  city: 'Berlin',
  checkin: '2026-08-01',
  checkout: '2026-08-05',
  adults: 2,
  userText: 'Bitte Airbnb in Berlin',
});
assert.equal(noLive.length >= 1, true, 'at least airbnb action');
assert.match(noLive[0]!.payload.url, /airbnb\.de\/s\/berlin\/homes/);
assert.match(noLive[0]!.label, /Airbnb/);

// Same identity: cheaper Expedia wins over Airbnb listing with higher price
const sameHouse = buildAirbnbStayCandidates({
  city: 'Lissabon',
  checkin: '2026-09-10',
  checkout: '2026-09-14',
  adults: 2,
  userText: 'Airbnb Casa Sol',
  liveStays: [
    {
      name: 'Casa Sol',
      priceEur: 240,
      bookUrl: 'https://www.airbnb.de/rooms/998877',
    },
    {
      name: 'Casa Sol',
      priceEur: 180,
      bookUrl:
        'https://www.expedia.de/go/hotel/info/1234567/2026-09-10/2026-09-14',
    },
  ],
});
const rooms = sameHouse.find((c) => String(c.id).includes('998877'));
const exp = sameHouse.find((c) => c.id.startsWith('expedia'));
assert.ok(rooms && exp, 'rooms + expedia candidates');
assert.equal(
  rooms!.identity,
  exp!.identity,
  'same-house identity unified for price compare',
);

const picked = pickAirbnbStayActions({
  city: 'Lissabon',
  checkin: '2026-09-10',
  checkout: '2026-09-14',
  adults: 2,
  userText: 'Airbnb Casa Sol',
  liveStays: [
    {
      name: 'Casa Sol',
      priceEur: 240,
      bookUrl: 'https://www.airbnb.de/rooms/998877',
    },
    {
      name: 'Casa Sol',
      priceEur: 180,
      bookUrl:
        'https://www.expedia.de/go/hotel/info/1234567/2026-09-10/2026-09-14',
    },
  ],
});
assert.equal(picked.length >= 1, true);
assert.match(picked[0]!.payload.url, /expedia/i, 'cheaper Expedia primary');
assert.ok(
  picked.some((a) => /airbnb/i.test(a.payload.url) && /Auch bei Airbnb/i.test(a.label)),
  'Airbnb secondary Auch bei Airbnb',
);

// Explicit Airbnb + live without same-house → Airbnb search primary, live secondary
const altLive = pickAirbnbStayActions({
  city: 'Porto',
  checkin: '2026-07-01',
  checkout: '2026-07-04',
  adults: 2,
  userText: 'Ich will Airbnb',
  liveStays: [
    {
      name: 'Other Apartment',
      priceEur: 120,
      bookUrl: 'https://www.stay22.com/allez/findus?address=Other%20Apartment',
    },
  ],
});
assert.match(altLive[0]!.payload.url, /airbnb\.de\/s\/porto\/homes/);
assert.equal(altLive.length >= 2, true, 'live stay as secondary');
assert.match(altLive[1]!.payload.url, /stay22/i);

console.log('airbnbStayPick.smoke.test.ts: ok');
