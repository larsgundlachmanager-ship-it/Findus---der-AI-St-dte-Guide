/**
 * Live check: Expedia + Kiwi Deep-Link generation (Brief-Params).
 * Run: npx --yes tsx@4.19.4 .cursor/_link_gen_smoke.ts
 */
import {
  buildExpediaHotelPropertyDeepLink,
  finalizeHotelBookAffiliateUrl,
  extractExpediaPropertyId,
  isExpediaHotelPropertyUrl,
} from '../src/services/affiliate/hotelPropertyDeepLink';
import {
  isHollowPartnerUrl,
  unwrapPartnerLandingUrl,
} from '../src/services/affiliate/hollowPartnerUrl';
import { buildKiwiResultsPageUrl } from '../src/services/affiliate/partnerBookingDeepLink';
import { buildKiwiSearchPageUrl } from '../src/services/affiliate/travelpayoutsPartners';
import { buildCheapFlightBookActions } from '../src/services/flights/cheapFlightBook';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

console.log('=== EXPEDIA (Beispiel Athen) ===');
const exp = buildExpediaHotelPropertyDeepLink('106254548', {
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
  hotelName: 'Ermass Modern Living Apartments',
  city: 'Athens',
  priceEur: 110,
});
console.log(exp);
assert(
  /Athens-Hotels-Ermass-Modern-Living-Apartments\.h106254548\.Hotel-Beschreibung/.test(exp),
  'slug path',
);
assert(/chkin=2026-09-30/.test(exp) && /chkout=2026-10-01/.test(exp), 'dates');
assert(/rm1=a2/.test(exp), 'adults rm1');
assert(/top_dp=110/.test(exp) && /top_cur=EUR/.test(exp), 'price top_dp');
assert(!isHollowPartnerUrl(exp), 'not hollow');
assert(extractExpediaPropertyId(exp) === '106254548', 'extract id');
assert(isExpediaHotelPropertyUrl(exp), 'is property url');

console.log('\n=== EXPEDIA finalize (Property-ID) ===');
const fin = finalizeHotelBookAffiliateUrl({
  hotelName: 'Ermass Modern Living Apartments',
  city: 'Athens',
  checkin: '2026-09-30',
  checkout: '2026-10-01',
  adults: 2,
  expediaPropertyId: '106254548',
  priceEur: 110,
});
const land = unwrapPartnerLandingUrl(fin) || fin;
console.log(land);
assert(
  /\.h106254548\.Hotel-Beschreibung|\/go\/hotel\/info\/106254548/.test(land),
  'property in finalize',
);
assert(/2026-09-30/.test(land) && /2026-10-01/.test(land), 'dates in finalize');
assert(!isHollowPartnerUrl(fin), 'finalize not hollow');

console.log('\n=== KIWI (Beispiel HAM→ATH Direkt) ===');
const kiwi = buildKiwiResultsPageUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-11-12',
  adults: 2,
  bagsPerAdult: '0.1',
  directOnly: true,
});
console.log(kiwi);
assert(
  /kiwi\.com\/deep/.test(kiwi) && /from=HAM/.test(kiwi) && /to=ATH/.test(kiwi),
  'path',
);
assert(/adults=2/.test(kiwi), 'adults');
assert(/stopNumber=0(%7E|~)true/.test(kiwi), 'direct stopNumber');
assert(/bags=0\.1_0\.1-/.test(kiwi), 'bags');
assert(!isHollowPartnerUrl(kiwi), 'kiwi not hollow');

console.log('\n=== KIWI Roundtrip + Direkt ===');
const kiwi2 = buildKiwiSearchPageUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-11-12',
  returnDateKey: '2026-11-19',
  adults: 2,
  directOnly: true,
});
console.log(kiwi2);
assert(/departure=2026-11-12/.test(kiwi2) && /return=2026-11-19/.test(kiwi2), 'roundtrip dates');
assert(/stopNumber=0(%7E|~)true/.test(kiwi2), 'direct on search wrapper');

console.log('\n=== Modul-2 cheapFlightBook (Direkt aus Text) ===');
const acts = buildCheapFlightBookActions({
  originIata: 'HAM',
  destIata: 'ATH',
  dateKey: '2026-11-12',
  adults: 2,
  userText: 'Direktflug nach Athen bitte',
  kiwiPriceEur: 680,
});
const open = acts.filter((a) => a.type === 'OPEN_URL');
for (const a of open) {
  const u = String((a.payload as { url?: string })?.url || '');
  console.log(`- ${a.label}: ${u.slice(0, 160)}`);
}
assert(open.length >= 1, 'has OPEN_URL');
const kiwiAct = open.find((a) => {
  const u = String((a.payload as { url?: string })?.url || '');
  return /kiwi|buchen/i.test(a.label) || /kiwi\.com|travelpayouts|tp\.media|tpx\.li/i.test(u);
});
assert(kiwiAct, 'has kiwi-ish action');
const rawUrl = String((kiwiAct!.payload as { url?: string })?.url || '');
const inner = unwrapPartnerLandingUrl(rawUrl) || rawUrl;
console.log('unwrapped:', inner.slice(0, 220));
assert((/from=HAM/.test(inner) && /to=ATH/.test(inner)), 'route in kiwi action');
assert(
  /stopNumber=0(%7E|~)true/.test(inner) || /stopNumber=0(%7E|~)true/.test(rawUrl),
  'direct from userText',
);

console.log('\nALL LINK GENERATION TESTS PASSED');
