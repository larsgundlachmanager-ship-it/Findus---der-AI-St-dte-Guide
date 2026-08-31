/**
 * Partner Deep-Prefill — Smoke (tsx).
 * Run: npx --yes tsx src/services/affiliate/partnerDeepPrefill.test.ts
 */

import {
  resolveEsimCountry,
  slugifyCampingplatz,
  extractCampingplatzName,
  parseClockHmm,
  parseTravelDateYmd,
  addDaysYmd,
  roundClockHmmDownTo5,
  taxiDurationWithRushHour,
  encodeUriBrackets,
  parseLuggageBagCount,
} from './partnerDeepPrefill';
import { isHollowPartnerUrl, unwrapPartnerLandingUrl } from './hollowPartnerUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

assert(
  resolveEsimCountry({ text: 'Ich brauche eine eSIM für Spanien' })
    ?.airaloSlug === 'spain',
  'esim spain',
);

assert(
  /kuehlungsborn|kuhlungsborn/.test(
    slugifyCampingplatz('Campingpark Kühlungsborn'),
  ),
  'camping slug',
);

assert(
  extractCampingplatzName('Campingplatz Schlitz war toll') === 'Schlitz',
  'extract campsite',
);

assert(parseClockHmm('bestell mir das Taxi auf 17 Uhr') === '17:00', 'clock 17');
assert(parseClockHmm('um 17:30 bitte') === '17:30', 'clock 17:30');
assert(parseClockHmm('Taxi auf 4:22 Uhr') === '04:20', 'clock 4:22 rounds down to 5');
assert(roundClockHmmDownTo5('04:22') === '04:20', 'round 04:22 down');
assert(roundClockHmmDownTo5('04:20') === '04:20', 'round already-5');
assert(roundClockHmmDownTo5('23:59') === '23:55', 'round 23:59 down');
assert(
  taxiDurationWithRushHour(40, new Date(2026, 7, 18, 4, 20).getTime()) === 40,
  'night taxi no rush',
);
assert(
  taxiDurationWithRushHour(40, new Date(2026, 7, 18, 7, 10).getTime()) === 54,
  'weekday morning rush 40*1.35',
);
assert(
  taxiDurationWithRushHour(40, new Date(2026, 7, 16, 7, 10).getTime()) === 40,
  'sunday morning no rush',
);
assert(
  encodeUriBrackets(
    'https://m.uber.com/ul/?dropoff[latitude]=53.55&dropoff[longitude]=9.99',
  ) ===
    'https://m.uber.com/ul/?dropoff%5Blatitude%5D=53.55&dropoff%5Blongitude%5D=9.99',
  'uber brackets encoded',
);

const base = new Date(2026, 7, 13);
assert(
  parseTravelDateYmd('ab heute camping', { base }) === '2026-08-13',
  'heute ymd',
);
assert(addDaysYmd('2026-08-13', 2) === '2026-08-15', 'addDays');

assert(
  !isHollowPartnerUrl(
    'https://www.camping.info/de/campingplatz/campingplatz-schlitz',
  ),
  'camping detail not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://www.discovercars.com/?a_aid=Yorro-Ai&pickup_date=2026-08-20&pickup_location=Hamburg',
  ),
  'discovercars prefill not hollow',
);
assert(
  isHollowPartnerUrl('https://www.discovercars.com/?a_aid=Yorro-Ai'),
  'discovercars bare still hollow',
);
assert(
  unwrapPartnerLandingUrl(
    'https://c111.travelpayouts.com/click?shmarker=x&custom_url=https%3A%2F%2Fwww.kiwi.com%2Fde%2Fsearch%2Fresults%2Fham%2Fmuc%2F2026-08-20%2F',
  ) === 'https://www.kiwi.com/de/search/results/ham/muc/2026-08-20/',
  'unwrap kiwi custom_url',
);
assert(
  !isHollowPartnerUrl(
    'https://c111.travelpayouts.com/click?shmarker=x&promo_id=3791&custom_url=https%3A%2F%2Fwww.kiwi.com%2Fde%2Fsearch%2Fresults%2Fham%2Fmuc%2F2026-08-20%2F',
  ),
  'kiwi search via travelpayouts not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://www.kiwi.com/de/search/results/ham/ath/2026-09-12/no-return/?adults=2',
  ),
  'kiwi results not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://www.kiwi.com/deep?from=HAM&to=AYT&departure=2026-08-19',
  ),
  'kiwi deep not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://www.aviasales.com/search/HAM1909ATH2?marker=760293',
  ),
  'aviasales compact search not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://www.aviasales.com/?origin_iata=HAM&destination_iata=AYT&depart_date=2026-08-19&marker=760293',
  ),
  'aviasales search not hollow',
);
assert(
  isHollowPartnerUrl('https://www.aviasales.com/?marker='),
  'aviasales home marker-only is hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://m.uber.com/ul/?action=setPickup&client_id=x&dropoff%5Blatitude%5D=53.55&dropoff%5Blongitude%5D=9.99&pickup=my_location',
  ),
  'uber encoded dropoff not hollow',
);
assert(
  !isHollowPartnerUrl(
    'https://m.uber.com/go/product-selection?client_id=x&drop%5B0%5D=%7B%22latitude%22%3A53.55%7D&pickup=my_location',
  ),
  'uber go product-selection not hollow',
);
assert(
  !isHollowPartnerUrl('https://travsim.com/de/products/spain-esim'),
  'travsim product not hollow',
);
assert(
  !isHollowPartnerUrl('https://www.airalo.com/spain?ref=abc'),
  'airalo country not hollow',
);
assert(parseLuggageBagCount('2 Koffer in Athen') === 2, 'bags 2');
assert(parseLuggageBagCount('einen Koffer') === 1, 'bags one');

console.log('partnerDeepPrefill.test.ts: all ok');
