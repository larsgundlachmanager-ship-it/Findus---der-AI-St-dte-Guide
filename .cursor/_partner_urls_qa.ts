import { buildKiwiResultsPageUrl } from '../src/services/affiliate/partnerBookingDeepLink';
import { buildKiwiTravelpayoutsUrl, buildAviasalesSearchUrl } from '../src/services/affiliate/travelpayoutsPartners';
import {
  buildExpediaHotelPropertyDeepLink,
  finalizeHotelBookAffiliateUrl,
} from '../src/services/affiliate/hotelPropertyDeepLink';
import { unwrapPartnerLandingUrl, isHollowPartnerUrl } from '../src/services/affiliate/hollowPartnerUrl';
import { writeFileSync } from 'fs';

function stay22(address: string, opts: { checkin: string; checkout: string; adults: number }) {
  const q = new URLSearchParams({ address });
  q.set('checkin', opts.checkin);
  q.set('checkout', opts.checkout);
  q.set('adults', String(opts.adults));
  return `https://www.stay22.com/allez/findus?${q.toString()}`;
}

const kiwi = buildKiwiResultsPageUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-11-12',
  adults: 2,
  bagsPerAdult: '0.1',
  directOnly: true,
});
const kiwiTp = buildKiwiTravelpayoutsUrl(kiwi, { subId: 'qa' });
const kiwiInner = unwrapPartnerLandingUrl(kiwiTp);
const stayHotel = stay22('Ermass Modern Living Apartments, Athens', {
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
});
const stayCity = stay22('Athens', {
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
});
const exp = buildExpediaHotelPropertyDeepLink('106254548', {
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
  hotelName: 'Ermass Modern Living Apartments',
  city: 'Athens',
  priceEur: 110,
});
const expFin = finalizeHotelBookAffiliateUrl({
  hotelName: 'Ermass Modern Living Apartments',
  city: 'Athens',
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
  expediaPropertyId: '106254548',
  priceEur: 110,
});
const avia = buildAviasalesSearchUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-11-12',
  adults: 2,
});

const out = {
  kiwi,
  kiwiInner,
  kiwiHollow: isHollowPartnerUrl(kiwi),
  kiwiTpHollow: isHollowPartnerUrl(kiwiTp),
  stayHotel,
  stayHotelHollow: isHollowPartnerUrl(stayHotel),
  stayCity,
  stayCityHollow: isHollowPartnerUrl(stayCity),
  exp,
  expFin: unwrapPartnerLandingUrl(expFin) || expFin,
  expFinHollow: isHollowPartnerUrl(expFin),
  avia,
  aviaHollow: isHollowPartnerUrl(avia),
};
writeFileSync('c:/Users/larsf/Findus 2.0/.cursor/_partner_urls_qa.json', JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k + ':', v);
