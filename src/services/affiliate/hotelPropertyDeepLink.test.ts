/**
 * Smoke: Hotel Property Deep-Link helpers.
 * Run: npx --yes tsx src/services/affiliate/hotelPropertyDeepLink.test.ts
 */

import {
  extractExpediaPropertyId,
  isExpediaHotelPropertyUrl,
  isExpediaHotelSearchUrl,
  isHotelRoomSelectUrl,
  buildExpediaHotelPropertyDeepLink,
  resolveHotelBookTarget,
  hotelBookOpenUrlPayload,
  hotelNameAppearsInUrl,
  finalizeHotelBookAffiliateUrl,
} from './hotelPropertyDeepLink';
import { unwrapPartnerLandingUrl } from './hollowPartnerUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const prop =
  'https://www.expedia.de/Lubeck-Hotels-Prime-Inn-Lubeck-City.h12345678.Hotel-Information?chkin=2026-08-14&chkout=2026-08-15';
assert(extractExpediaPropertyId(prop) === '12345678', 'hXXXX property id');
assert(isExpediaHotelPropertyUrl(prop), 'Hotel-Information is property');
assert(isHotelRoomSelectUrl(prop), 'property is room-select');

const go =
  'https://www.expedia.de/go/hotel/info/987654/2026-08-14/2026-08-15?NumRooms=1';
assert(extractExpediaPropertyId(go) === '987654', 'go/hotel/info id');
assert(isExpediaHotelPropertyUrl(go), 'go/hotel/info is property');

const deep = buildExpediaHotelPropertyDeepLink('987654', {
  checkin: '2026-08-14',
  checkout: '2026-08-15',
  adults: 2,
});
assert(/\/go\/hotel\/info\/987654\/2026-08-14\/2026-08-15/.test(deep), 'deep link path');
assert(/NumAdult-Room1=2/.test(deep), 'adults in deep link');

const searchOnly =
  'https://www.expedia.de/Hotel-Search?destination=L%C3%BCbeck&chkin=2026-08-17&chkout=2026-08-18';
assert(!isExpediaHotelPropertyUrl(searchOnly), 'Hotel-Search is not property');
assert(isExpediaHotelSearchUrl(searchOnly), 'Hotel-Search detected');
assert(!isHotelRoomSelectUrl(searchOnly), 'search is not room-select');

// Affiliate-Wrapper: Property-ID aus landingPage ziehen
const wrapped =
  'https://expedia.com/affiliate?siteid=1&camref=x&creativeref=y&landingPage=' +
  encodeURIComponent(
    'https://www.expedia.de/go/hotel/info/555666/2026-08-14/2026-08-15',
  );
assert(extractExpediaPropertyId(wrapped) === '555666', 'id from affiliate landingPage');
assert(isHotelRoomSelectUrl(wrapped), 'wrapped property is room-select');

const fromId = buildExpediaHotelPropertyDeepLink('424242', {
  checkin: '2026-08-14',
  checkout: '2026-08-16',
  adults: 1,
});
assert(/\/go\/hotel\/info\/424242\/2026-08-14\/2026-08-16/.test(fromId), 'explicit property deep link');

const ath = resolveHotelBookTarget({
  hotelName: 'Electra Metropolis',
  destination: 'Athen',
});
assert(ath.hotelName === 'Electra Metropolis', `hotel name: ${ath.hotelName}`);
assert(ath.city === 'Athen', `city is dest not GPS: ${ath.city}`);

const tripNotGps = resolveHotelBookTarget({
  hotelName: 'Atlantic Hotel',
  city: 'Prisdorf',
  destination: 'Lübeck',
});
assert(
  /lübeck|luebeck/i.test(tripNotGps.city || ''),
  `destination beats GPS city: ${tripNotGps.city}`,
);

const comma = resolveHotelBookTarget({
  hotelName: 'Hotel Atlantic, Hamburg',
});
assert(/atlantic/i.test(comma.hotelName), `comma hotel: ${comma.hotelName}`);
assert(/hamburg/i.test(comma.city || ''), `comma city: ${comma.city}`);

const payload = hotelBookOpenUrlPayload({
  url: 'https://example.test',
  hotelName: 'Electra Metropolis',
  city: 'Athen',
  checkin: '2026-08-21',
  checkout: '2026-08-23',
  adults: 1,
});
assert(payload.destName === 'Electra Metropolis', 'payload destName is hotel');
assert(payload.destination === 'Athen', 'payload destination is city');
assert(payload.checkin === '2026-08-21' && payload.checkout === '2026-08-23', 'payload dates');
assert(payload.adults === 1, 'payload adults');

assert(
  hotelNameAppearsInUrl(
    'https://www.stay22.com/allez/findus?address=Electra%20Metropolis%20Athens',
    'Electra Metropolis',
  ),
  'stay22 address has hotel',
);
assert(
  !hotelNameAppearsInUrl(
    'https://www.stay22.com/allez/findus?address=Prisdorf',
    'Electra Metropolis',
  ),
  'GPS city is not the hotel',
);

const rebuilt = finalizeHotelBookAffiliateUrl({
  hotelName: 'Electra Metropolis',
  city: 'Athen',
  bookUrl: 'https://www.stay22.com/allez/findus?address=Germany',
  checkin: '2026-08-21',
  checkout: '2026-08-23',
  adults: 1,
});
const landing = unwrapPartnerLandingUrl(rebuilt) || rebuilt;
assert(!/address=Germany/i.test(landing), `hollow Germany not kept: ${landing}`);
assert(
  /electra|metropolis|athen/i.test(decodeURIComponent(landing)),
  `hotel or dest city in rebuilt link: ${landing}`,
);
assert(/2026-08-21/.test(landing) && /2026-08-23/.test(landing), `dates in rebuilt: ${landing}`);
assert(/adults=1|NumAdult-Room1=1|rm1=a1/i.test(landing), `adults in rebuilt: ${landing}`);

console.log('All hotelPropertyDeepLink tests passed.');
