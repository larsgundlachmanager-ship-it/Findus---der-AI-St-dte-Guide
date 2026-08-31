/**
 * Run: npx --yes tsx src/services/affiliate/partnerAwinHolidayDeepLink.test.ts
 */
import {
  buildAbInDenUrlaubOffersUrl,
  buildCheck24CarCompareUrl,
  buildCheck24PackageSearchUrl,
  buildSolmarHotelUrl,
  buildWegDeSearchUrl,
  check24DurationBand,
  extractAbInDenUrlaubGiataId,
  parseOriginIata,
  sanitizeWegDeUrl,
  TRAVELSECURE_TARIFRECHNER_URL,
} from './partnerAwinHolidayDeepLink';
import { isHollowPartnerUrl } from './hollowPartnerUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const pkg = buildCheck24PackageSearchUrl({
  departureDate: '2026-08-29',
  returnDate: '2026-09-06',
  airport: 'BRE',
  adults: 2,
});
assert(/check24\.net\/pauschalreisen-vergleich/.test(pkg), pkg);
assert(/c24pp_departure_date=2026-08-29/.test(pkg), pkg);
assert(/c24pp_return_date=2026-09-06/.test(pkg), pkg);
assert(/c24pp_travel_duration=5-8/.test(pkg), pkg);
assert(/c24pp_airport=BRE/.test(pkg), pkg);
assert(/c24pp_adult=2/.test(pkg), pkg);
assert(!/c24pp_city_id=/.test(pkg), 'no invented city_id');
assert(!/hotelId=/.test(pkg), 'no invented hotelId');
assert(!isHollowPartnerUrl(pkg), 'check24 package search not hollow');
assert(check24DurationBand(8) === '5-8', 'duration band');

const car = buildCheck24CarCompareUrl();
assert(/check24\.net\/mietwagen-preisvergleich/.test(car), car);
assert(!isHollowPartnerUrl(car), 'check24 car compare not hollow');
assert(
  isHollowPartnerUrl('https://urlaub.check24.de/'),
  'check24 package home hollow',
);

const brokenWeg =
  'https://staedtereisen.weg.de/s/tsx/3844?seed=787a917a&source=csw&searchId=t17873103586129072&destination=149530&dateFrom=2026-09-22&dateTo=2026-09-27&origin=BER&pageType=hotelDetail&adults=2&rctx=xxx&rsign=e2c5f9a2&clickId=oss';
const weg = sanitizeWegDeUrl(brokenWeg);
assert(!/\/s\/tsx\//.test(weg), weg);
assert(!/[?&]seed=/.test(weg), 'no seed');
assert(!/[?&]searchId=/.test(weg), 'no searchId');
assert(!/[?&]rctx=/.test(weg), 'no rctx');
assert(/dateFrom=2026-09-22/.test(weg), weg);
assert(/origin=BER/.test(weg), weg);
assert(/adults=2/.test(weg), weg);
assert(/destination=149530/.test(weg), 'keep evidenced destination id');
assert(!isHollowPartnerUrl(weg), 'weg search not hollow');
assert(isHollowPartnerUrl('https://www.weg.de/'), 'weg home hollow');

const wegBuilt = buildWegDeSearchUrl({
  dateFrom: '2026-09-22',
  dateTo: '2026-09-27',
  origin: 'BER',
  adults: 2,
  cityOrQuery: 'Athen',
});
assert(/staedtereisen\.weg\.de/.test(wegBuilt), wegBuilt);
assert(/dateFrom=2026-09-22/.test(wegBuilt), wegBuilt);
assert(/origin=BER/.test(wegBuilt), wegBuilt);

const aidu = buildAbInDenUrlaubOffersUrl({
  hotelGiataId: '1036158',
  destinationId: 'city-gr-99-athen',
  dateMin: '2026-09-17',
  dateMax: '2026-09-27',
  airports: 'BER',
  adults: 2,
  durationMin: 5,
  durationMax: 5,
});
assert(/\/find\/hotel\/1036158-giata\/offers/.test(aidu), aidu);
assert(/destinationId=city-gr-99-athen/.test(aidu), aidu);
assert(/dateMin=2026-09-17/.test(aidu), aidu);
assert(/airports=BER/.test(aidu), aidu);
assert(/rooms=A%2CA/.test(aidu) || /rooms=A,A/.test(aidu), aidu);
assert(/travelType=packageTour/.test(aidu), aidu);
assert(
  extractAbInDenUrlaubGiataId(aidu) === '1036158',
  'giata extract',
);
assert(!isHollowPartnerUrl(aidu), 'aidu hotel offers not hollow');
assert(
  isHollowPartnerUrl('https://www.ab-in-den-urlaub.de/'),
  'aidu home hollow',
);

const aiduSearch = buildAbInDenUrlaubOffersUrl({
  dateMin: '2026-09-17',
  dateMax: '2026-09-27',
  airports: 'BER',
  adults: 2,
});
assert(/\/find\/offers/.test(aiduSearch), aiduSearch);
assert(!/hotel\/\d+-giata/.test(aiduSearch), 'no invented giata');
assert(!/city-gr-99-athen/.test(aiduSearch), 'no invented destinationId');

const solmar = buildSolmarHotelUrl({
  citySlug: 'Malgrat de Mar',
  hotelSlug: 'Hotel Indalo Park',
});
assert(
  solmar === 'https://www.solmar.de/malgrat-de-mar/hotel-indalo-park',
  solmar,
);
assert(!isHollowPartnerUrl(solmar), 'solmar hotel not hollow');
assert(isHollowPartnerUrl('https://www.solmar.de/'), 'solmar home hollow');

assert(
  /tarifrechner-rr\.html/.test(TRAVELSECURE_TARIFRECHNER_URL),
  TRAVELSECURE_TARIFRECHNER_URL,
);
assert(
  !isHollowPartnerUrl(TRAVELSECURE_TARIFRECHNER_URL),
  'tarifrechner not hollow',
);
assert(
  isHollowPartnerUrl('https://www.travelsecure.de/'),
  'travelsecure home hollow',
);

assert(parseOriginIata('ab BRE fliegen') === 'BRE', 'iata');
assert(parseOriginIata('ohne Flughafen') == null, 'no invented iata');

console.log('partnerAwinHolidayDeepLink.test.ts OK');
