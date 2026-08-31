/**
 * Run: npx --yes tsx src/services/affiliate/partnerTpxDeepLink.test.ts
 */
import {
  withKlookAffiliate,
  withKkdayAffiliate,
  withWegotripPrefill,
  buildGoCityExplorerUrl,
  buildWelcomePickupsTransferUrl,
  buildGetTransferNewUrl,
  withKiwitaxiTracking,
  withIntuiTracking,
  buildLocalrentSearchUrl,
  buildGetRentacarRequestUrl,
  buildAutoEuropeResultsUrl,
  buildBikesbookingSearchUrl,
  stampTpxPartnerTracking,
  buildRadicalStorageUrl,
  buildAirhelpClaimUrl,
  buildCompensairCheckUrl,
  buildQeeqSearchMapUrl,
  buildSailyCountryPageUrl,
  withSailyAffiliate,
  buildYesimCountryPageUrl,
} from './partnerTpxDeepLink';
import { isHollowPartnerUrl, unwrapPartnerLandingUrl } from './hollowPartnerUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const klook = withKlookAffiliate(
  'https://www.klook.com/activity/163207-acropolis-of-athens-entry-ticket-with-optional-self-guided-audio-tours/',
);
assert(/affiliate\.klook\.com\/redirect/.test(klook), klook);
assert(/aff_pid=760293/.test(decodeURIComponent(klook)), 'klook aff_pid');
assert(/163207-acropolis/.test(decodeURIComponent(klook)), 'klook activity');
assert(!/selected-segment/.test(klook), 'klook no junk');
assert(
  unwrapPartnerLandingUrl(klook).includes('/activity/163207-'),
  'unwrap klook k_site',
);
assert(!isHollowPartnerUrl(klook), 'klook activity not hollow');

const kkday = withKkdayAffiliate(
  'https://www.kkday.com/en-us/product/133661-10-hour-private-charter-tour-osaka-kyoto-nara-japan',
);
assert(/invl\.me\/clndj1c/.test(kkday), kkday);
assert(/aff_sub=760293/.test(kkday), 'kkday aff_sub');
assert(
  unwrapPartnerLandingUrl(kkday).includes('/product/133661-'),
  'unwrap kkday',
);
assert(!isHollowPartnerUrl(kkday), 'kkday product not hollow');

const wego = withWegotripPrefill(
  'https://wegotrip.com/berlin-d2950159/berlin-highlights-tour-with-panoramapunkt-berlin-ticket-p12422/',
  { dateIso: '2026-08-23', adults: 2 },
);
assert(/date=2026-08-23/.test(wego), wego);
assert(/sub_id=760293/.test(wego), 'wego sub_id');
assert(!/id-7357=/.test(wego), 'no invented variant id');
assert(!isHollowPartnerUrl(wego), 'wego product not hollow');

const gocity = buildGoCityExplorerUrl({
  citySlug: 'Paris',
  adults: 2,
  children: 0,
  plusDays: 2,
  standardChoices: 5,
});
assert(/gocity\.com\/en\/paris\/passes\/explorer/.test(gocity), gocity);
assert(/standard-choices=5/.test(gocity), 'gocity choices');
assert(/plus-days=2/.test(gocity), 'gocity days');
assert(/adults=2/.test(gocity), 'gocity adults');
assert(/prf\.hn\/click\/camref:1100l4xn8/.test(gocity), 'gocity partnerize');
assert(!/trip-planner\/itinerary\//.test(gocity), 'no invented itinerary uuid');
assert(!isHollowPartnerUrl(gocity), 'gocity explorer not hollow');

const wp = buildWelcomePickupsTransferUrl({
  citySlug: 'Munich',
  dateIso: '2026-08-23',
  timeHm: '10:00',
  passengers: 2,
  luggage: 2,
  fromName: 'Hotel Meier City München',
  fromAddress: 'Schützenstr. 12, 80335 Munich, Germany',
  fromLat: 48.139946,
  fromLng: 11.56248,
  fromType: 'hotel',
  toName: 'Munich International Airport (MUC)',
  toLat: 48.353662,
  toLng: 11.775028,
  toType: 'airport',
});
assert(/traveler\.welcomepickups\.com\/en\/munich\/transfer\/new/.test(wp), wp);
assert(/passengers=2/.test(wp) && /luggage=2/.test(wp), 'wp pax bags');
assert(/date=8%2F23%2F2026|date=8\/23\/2026/.test(wp), `wp date ${wp}`);
assert(/aff_track_id=760293/.test(wp), 'wp track');
assert(!/from_location_id=/.test(wp), 'no invented wp location id');
assert(!isHollowPartnerUrl(wp), 'wp transfer not hollow');

const gt = buildGetTransferNewUrl();
assert(/gettransfer\.com\/de\/transfers\/new/.test(gt), gt);
assert(/sub_id=760293/.test(gt), 'gt sub_id');
assert(!isHollowPartnerUrl(gt), 'gt new not hollow');

const kiwi = withKiwitaxiTracking('https://kiwitaxi.com/en/munich');
assert(/tpo=760293/.test(kiwi), kiwi);
assert(
  isHollowPartnerUrl('https://kiwitaxi.com/en/checkout'),
  'kiwitaxi checkout without token is hollow',
);

const intui = withIntuiTracking(
  'https://de.intui.travel/transfer/p_18202391/abc/',
);
assert(/partnerID=287737/.test(intui), intui);
assert(!isHollowPartnerUrl(intui), 'intui transfer not hollow');

const local = buildLocalrentSearchUrl({
  countrySlug: 'argentina',
  pickupDate: '2026-08-28',
  dropoffDate: '2026-08-30',
  pickupCode: 'POSADAS',
});
assert(/localrent\.com\/en\/argentina/.test(local), local);
assert(/pickup_date=2026-08-28/.test(local), 'local pick');
assert(/pc=POSADAS/.test(local), 'local pc');
assert(/r=2869/.test(local), 'local partner r');
assert(!/[?&]s=/.test(local), 'no invented localrent session');
assert(!isHollowPartnerUrl(local), 'localrent not hollow');

const gra = buildGetRentacarRequestUrl({
  pickupLocation: 'Ottobrunn bei München, Germany',
  pickupDate: '2026-08-27',
  returnDate: '2026-08-30',
});
assert(/getrentacar\.com\/de\/autovermietung\/request/.test(gra), gra);
assert(/pickup%5Blocation%5D|pickup\[location\]/.test(gra), 'gra brackets');
assert(/27\.08\.2026/.test(decodeURIComponent(gra)), 'gra de date');
assert(/track_id=760293/.test(gra), 'gra track');
assert(!isHollowPartnerUrl(gra), 'getrentacar request not hollow');

const ae = buildAutoEuropeResultsUrl();
assert(/autoeurope\.eu\/results/.test(ae), ae);
assert(/aff=travelpayoutseu/.test(ae), 'ae aff');
assert(!isHollowPartnerUrl(ae), 'ae results not hollow');

const bike = buildBikesbookingSearchUrl({
  beginIso: '2026-08-28',
  endIso: '2026-08-31',
});
assert(/bikesbooking\.com\/en\/search/.test(bike), bike);
assert(/begin=2026-08-28T08/.test(bike), 'bike begin');
assert(!/pickUpCity=/.test(bike), 'no invented bike city id');
assert(!isHollowPartnerUrl(bike), 'bikesbooking search not hollow');

assert(
  stampTpxPartnerTracking('https://www.klook.com/activity/1-x/').includes(
    'affiliate.klook.com',
  ),
  'stamp klook',
);

const radical = buildRadicalStorageUrl({
  citySlug: 'Hallbergmoos',
  lat: 48.3536407,
  lng: 11.7831852,
  dropOffIso: '2026-08-28',
  pickUpIso: '2026-08-28',
  dropOffTimeHm: '11:00',
  pickUpTimeHm: '16:00',
  bags: 2,
});
assert(/radicalstorage\.com\/luggage-storage\/hallbergmoos/.test(radical), radical);
assert(/dropOff=2026-08-28T11/.test(decodeURIComponent(radical)), 'radical drop');
assert(/track_id=760293/.test(radical), 'radical track');
assert(!/train-station/.test(radical), 'no invented radical spot');
assert(!isHollowPartnerUrl(radical), 'radical city not hollow');

const airhelp = buildAirhelpClaimUrl();
assert(/funnel\.airhelp\.com\/claims\/new\/trip-details/.test(airhelp), airhelp);
assert(/a_aid=Travelpayouts/.test(airhelp), 'airhelp a_aid');
assert(/data1=760293/.test(airhelp), 'airhelp data1');
assert(!isHollowPartnerUrl(airhelp), 'airhelp funnel not hollow');

const comp = buildCompensairCheckUrl();
assert(/compensair\.com\/de\/check-flight\.html/.test(comp), comp);
assert(/sub_id=760293/.test(comp), 'compensair sub');
assert(!isHollowPartnerUrl(comp), 'compensair check not hollow');

const qeeq = buildQeeqSearchMapUrl({ lat: 48.3538966, lng: 11.7880464 });
assert(/qeeq\.com\/car\/search_map/.test(qeeq), qeeq);
assert(/pickup_lat=48\.3538966/.test(qeeq), 'qeeq lat');
assert(/utm_source=travelpayouts/.test(qeeq), 'qeeq utm');
assert(!/[?&]id=/.test(qeeq), 'no invented qeeq listing id');
assert(!isHollowPartnerUrl(qeeq), 'qeeq map not hollow');

const sailyPage = buildSailyCountryPageUrl('spain');
assert(sailyPage === 'https://saily.com/de/esim-spain/', sailyPage);
const saily = withSailyAffiliate(sailyPage);
assert(/go\.saily\.site\/aff_c/.test(saily), saily);
assert(/aff_id=8014/.test(saily), 'saily aff_id');
assert(/esim-spain/.test(decodeURIComponent(saily)), 'saily country');
assert(!isHollowPartnerUrl(saily), 'saily country not hollow');

const yesim = buildYesimCountryPageUrl('turkey');
assert(/yesim\.tech\/country\/turkey/.test(yesim), yesim);
assert(/partner_id=636/.test(yesim), 'yesim partner');
assert(/sub_id=760293/.test(yesim), 'yesim sub');
assert(!isHollowPartnerUrl(yesim), 'yesim country not hollow');

console.log('partnerTpxDeepLink.test.ts: all ok');
