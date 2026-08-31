/**
 * Run: npx --yes tsx src/services/affiliate/partnerBookingDeepLink.test.ts
 */
import {
  withGygDateAdults,
  toTiqetsDeepLanding,
  tiqetsProductSlug,
  withViatorDateAdults,
  buildUberGoUrl,
  uberPlaceFromAddress,
  buildDiscoverCarsSearchUrl,
  buildEconomyBookingsResultsUrl,
  withEconomyBookingsTracking,
  sanitizeEconomyBookingsUrl,
  sanitizeKonfettiUrl,
  isKonfettiEventUrl,
  buildKiwiResultsPageUrl,
  buildAviasalesCompactSearchUrl,
  localPickupFormattedTime,
  buildAiraloCountryPageUrl,
  buildAiraloTravelpayoutsUrl,
  withCampingInfoStayParams,
  campingInfoCityHubPath,
  buildBounceBookUrl,
  bounceStamp,
} from './partnerBookingDeepLink';
import { isHollowPartnerUrl, unwrapPartnerLandingUrl } from './hollowPartnerUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const gyg = withGygDateAdults(
  'https://www.getyourguide.com/athen-l91/akropolis-t181448/?partner_id=ZVQGONB&cmp=findus_app',
  { adults: 2, dateIso: '2026-08-23' },
);
assert(/adults=2/.test(gyg), `gyg adults: ${gyg}`);
assert(/date_from=2026-08-23/.test(gyg), `gyg date: ${gyg}`);
assert(/partner_id=ZVQGONB/.test(gyg), 'gyg keeps partner_id');

const product =
  'https://www.tiqets.com/de/athen-sehenswuerdigkeiten-c99239/tickets-fur-akropolis-von-athen-eintrittskarte-audioguide-akropolis-digital-p975704/';
assert(
  tiqetsProductSlug(product) ===
    'tickets-fur-akropolis-von-athen-eintrittskarte-audioguide-akropolis-digital-p975704',
  'tiqets slug',
);
const checkout = toTiqetsDeepLanding(product, {
  dateIso: '2026-08-23',
  timeHm: '14:00',
  adults: 2,
  variantId: '160288',
  preferCheckout: true,
});
assert(/\/checkout\//.test(checkout), `tiqets checkout: ${checkout}`);
assert(/selected_date=2026-08-23/.test(checkout), 'tiqets date');
assert(/selected_timeslot_id=14(?:%3A|:)00/.test(checkout), 'tiqets slot');
assert(/selected_variants=160288%3D2|selected_variants=160288=2/.test(checkout), 'tiqets qty');

const viator = withViatorDateAdults(
  'https://www.viator.com/de-DE/tours/Athens/Acropolis/d496-2876P76?pid=P00311883&mcid=42383',
  { dateIso: '2026-08-23', adults: 2 },
);
assert(/date=2026-08-23/.test(viator), `viator date: ${viator}`);
assert(/adults=2/.test(viator) && /pax=2/.test(viator), 'viator pax');
assert(/pid=P00311883/.test(viator), 'viator keeps pid');

const now = buildUberGoUrl({
  clientId: 'TESTCLIENT',
  dropoff: uberPlaceFromAddress(53.676, 9.848, 'Brummerackerweg, Tangstedt'),
  pickup: uberPlaceFromAddress(53.579, 9.993, 'Mittelweg 69, 20149 Hamburg'),
});
assert(/m\.uber\.com\/go\/product-selection/.test(now), `uber now: ${now}`);
assert(/client_id=TESTCLIENT/.test(now), 'uber client_id');
assert(/drop%5B0%5D=/.test(now) || /drop\[0\]=/.test(now), 'uber drop json');
assert(/Mittelweg/.test(decodeURIComponent(now)), 'uber pickup street');

const reserve = buildUberGoUrl({
  clientId: 'TESTCLIENT',
  dropoff: uberPlaceFromAddress(53.676, 9.848, 'Brummerackerweg, Tangstedt'),
  pickup: uberPlaceFromAddress(53.579, 9.993, 'Mittelweg 69'),
  pickupTimeHm: '11:51',
  pickupDateIso: '2026-08-23',
});
assert(/\/go\/reserve\/select-time/.test(reserve), `uber reserve: ${reserve}`);
assert(/pickup_formatted_time=2026-08-23T11%3A51%3A00/.test(reserve), 'uber reserve time');
assert(localPickupFormattedTime('11:51', '2026-08-23') === '2026-08-23T11:51:00', 'local time');

const cars = buildDiscoverCarsSearchUrl({
  pickupIata: 'ATH',
  pickupDate: '2026-08-27',
  dropoffDate: '2026-08-30',
  pickupTime: '10:00',
  dropoffTime: '10:00',
  driverAge: 24,
  affiliateAid: 'Yorro-Ai',
});
assert(/discovercars\.com\/de\/search/.test(cars), `cars search: ${cars}`);
assert(/a_aid=Yorro-Ai/.test(cars), 'cars aid');
assert(/driver_age=24/.test(cars), 'cars age');
assert(/sq=/.test(cars), 'cars sq');
assert(!isHollowPartnerUrl(cars), 'cars search not hollow');

const eco = buildEconomyBookingsResultsUrl({
  pickupDate: '2026-08-26',
  dropoffDate: '2026-08-29',
  pickupTime: '10:00',
  dropoffTime: '10:00',
  driverAge: 35,
  pickupCountry: 'DE',
  pickupLocationCode: '113233',
  dropoffLocationCode: '113233',
  countryCode: '81',
});
assert(/economybookings\.com\/de\/cars\/results/.test(eco), eco);
assert(/py=2026/.test(eco) && /pm=08/.test(eco) && /pd=26/.test(eco), eco);
assert(/dy=2026/.test(eco) && /dd=29/.test(eco), eco);
assert(/pt=1000/.test(eco) && /dt=1000/.test(eco), eco);
assert(/age=35/.test(eco), eco);
assert(/plc=113233/.test(eco), 'keep evidenced plc');
assert(/utm_content=text-link_16yupj/.test(eco), 'economy promoter');
assert(!/tc_id=/.test(eco), 'no invented tc_id');
assert(!/target_circle/.test(eco), 'no foreign affiliate');
assert(!isHollowPartnerUrl(eco), 'economy results not hollow');

const ecoBare = buildEconomyBookingsResultsUrl({
  pickupDate: '2026-08-26',
  dropoffDate: '2026-08-29',
});
assert(!/plc=/.test(ecoBare), 'no invented plc');
assert(!/[&?]cr=/.test(ecoBare), 'no invented cr');

const ecoDirty = withEconomyBookingsTracking(
  'https://www.economybookings.com/de/cars/results?py=2026&pm=08&pd=26&plc=113233&tc_id=d7ed9960-d139-4ff0-9ebd-2add543ed916&utm_source=target_circle&reload=1',
);
assert(!/tc_id=/.test(ecoDirty), 'strip tc_id');
assert(!/target_circle/.test(ecoDirty), 'strip target_circle');
assert(/plc=113233/.test(ecoDirty), 'keep plc');
assert(/text-link_16yupj/.test(ecoDirty), 'stamp 16yupj');

const ecoRef = sanitizeEconomyBookingsUrl(
  'https://www.economybookings.com/de/referral/16yupj/l0j2ln',
);
assert(/\/cars\/results/.test(ecoRef), ecoRef);

assert(
  isHollowPartnerUrl(
    'https://www.economybookings.com/de/referral/16yupj/l0j2ln',
  ),
  'economy referral hollow',
);

const kiwi = buildKiwiResultsPageUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-09-12',
  adults: 2,
  bagsPerAdult: '0.1',
});
assert(/kiwi\.com\/de\/search\/results\/ham\/ath\/2026-09-12\/no-return/.test(kiwi), kiwi);
assert(/adults=2/.test(kiwi), 'kiwi adults');
assert(/bags=0\.1_0\.1/.test(kiwi), `kiwi bags: ${kiwi}`);
assert(!isHollowPartnerUrl(kiwi), 'kiwi results not hollow');

const avia = buildAviasalesCompactSearchUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-09-19',
  adults: 2,
  marker: '760293',
});
assert(/aviasales\.com\/search\/HAM1909ATH2/.test(avia), avia);
assert(/marker=760293/.test(avia), 'aviasales marker');
assert(!isHollowPartnerUrl(avia), 'aviasales compact not hollow');

assert(
  buildAiraloCountryPageUrl('greece-esim') === 'https://www.airalo.com/greece',
  'airalo strips -esim',
);
assert(
  !/selected-segment|greece-esim/.test(buildAiraloCountryPageUrl('Greece')),
  'airalo no unlimited segment',
);
const airaloTp = buildAiraloTravelpayoutsUrl(
  'https://www.airalo.com/greece',
  '760293',
);
assert(/tp\.media\/r\?/.test(airaloTp), airaloTp);
assert(/marker=760293/.test(airaloTp), 'airalo marker');
assert(/p=8310/.test(airaloTp), 'airalo program');
assert(
  decodeURIComponent(airaloTp).includes('https://www.airalo.com/greece'),
  'airalo country in u=',
);
assert(
  unwrapPartnerLandingUrl(airaloTp) === 'https://www.airalo.com/greece',
  'unwrap tp.media u=',
);
assert(!isHollowPartnerUrl(airaloTp), 'tracked airalo country not hollow');

assert(campingInfoCityHubPath('Athens') === 'campsite-athens', 'camp hub');
const camp = withCampingInfoStayParams(
  'https://www.camping.info/de/campingplatz/campsite-athens',
  { arrival: '2026-09-12', departure: '2026-09-14', adults: 2, flex: 3 },
);
assert(/arrival=2026-09-12/.test(camp), camp);
assert(/departure=2026-09-14/.test(camp), 'camp dep');
assert(/adults=2/.test(camp), 'camp adults');
assert(/flex=3/.test(camp), 'camp flex');
assert(!isHollowPartnerUrl(camp), 'camp hub not hollow');

assert(bounceStamp('2026-08-22') === '2026-08-22T0000', 'bounce stamp');
const bounce = buildBounceBookUrl({
  ref: 'FINDUS64751223710664',
  query: 'athen',
  locationId: 'db8919ef-3038-4988-b0a7-ed4380645b60',
  fromDate: '2026-08-22',
  toDate: '2026-08-22',
  standardBags: 2,
});
assert(/\/s\/location\/db8919ef-3038-4988-b0a7-ed4380645b60\/book/.test(bounce), bounce);
assert(/ref=FINDUS64751223710664/.test(bounce), 'bounce ref');
assert(/standardBags=2/.test(bounce), 'bounce bags');
assert(/from=2026-08-22T0000/.test(bounce), 'bounce from');
assert(/utm_source=affiliates/.test(bounce), 'bounce utm');
assert(!isHollowPartnerUrl(bounce), 'bounce book not hollow');

const konfettiEvent =
  'https://gokonfetti.com/de-de/e/graffiti-workshop-in-hamburg-perfekt-fuer-gruppen-xqgk9w/?qid=07b8db7fa546fd6dce93ed5f6807f227';
assert(isKonfettiEventUrl(konfettiEvent), 'konfetti event path');
const konfettiClean = sanitizeKonfettiUrl(konfettiEvent);
assert(
  /\/e\/graffiti-workshop-in-hamburg-perfekt-fuer-gruppen-xqgk9w/.test(
    konfettiClean,
  ),
  konfettiClean,
);
assert(!/[?&]qid=/.test(konfettiClean), 'strip konfetti qid');
assert(!isHollowPartnerUrl(konfettiClean), 'konfetti event not hollow');

console.log('partnerBookingDeepLink.test.ts: all ok');
