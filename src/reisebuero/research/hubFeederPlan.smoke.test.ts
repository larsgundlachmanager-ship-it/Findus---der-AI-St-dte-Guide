/**
 * Hub-Zubringer: Prisdorf → Hbf → Berlin → BER (+ Flix/DB).
 */
import assert from 'node:assert/strict';
import {
  buildHubFeederPlan,
  hubFeederChecklistItems,
  hubFeederToJourneyBeats,
  resolveBoardingCity,
} from './hubFeederPlan';
import { buildJourneyBeats } from './storyMagazine';
import { buildTimelineStopsFromOption } from '../timelineStopsFromOption';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';
import { parseBriefSlots } from '../parseBriefSlots';

const boarding = resolveBoardingCity({
  home: 'Prisdorf',
  hubCity: 'Berlin',
  homeLat: 53.6833,
  homeLng: 9.7667,
});
assert.equal(boarding, 'Hamburg', `boarding got ${boarding}`);

const led = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('wir starten in Prisdorf, fliegen nach Bukarest'),
);
led.originCities = { value: ['Berlin'], source: 'user', hardness: 'must' };
led.dateStart = entry('2026-10-16', 'user');
led.cabinBags = entry(1, 'user');
led.checkedBags = entry(0, 'user');

const tr = {
  id: 't1',
  kind: 'flight' as const,
  label: 'BER→OTP',
  departAt: '11:40',
  arriveAt: '15:10',
  priceEur: 89,
  bookUrl: 'https://www.kiwi.com/deep?from=BER&to=OTP',
  better: true,
  fromIata: 'BER',
  toIata: 'OTP',
  flightNumber: 'W63202',
  carrier: 'W6',
  departDateKey: '2026-10-16',
};

const plan = buildHubFeederPlan({ ledger: led, transport: tr });
assert.ok(plan?.needed, 'feeder needed');
assert.equal(plan!.hubCity, 'Berlin');
assert.equal(plan!.boardingCity, 'Hamburg');
assert.ok(
  plan!.legs.some((l) => l.role === 'local_rail' && /Prisdorf/i.test(l.title) && /Hamburg/i.test(l.title)),
  `local ${plan!.legs.map((l) => l.title).join('|')}`,
);
assert.ok(
  plan!.legs.some((l) => l.role === 'long_haul' && /Hamburg/i.test(l.title) && /Berlin/i.test(l.title)),
  `long ${plan!.legs.map((l) => l.title).join('|')}`,
);
assert.ok(
  plan!.legs.some((l) => l.role === 'airport_transit' && /BER/i.test(l.title)),
  `airport ${plan!.legs.map((l) => l.title).join('|')}`,
);
const long = plan!.legs.find((l) => l.role === 'long_haul')!;
assert.ok(long.choices?.some((c) => c.mode === 'flixbus'));
assert.ok(long.choices?.some((c) => c.mode === 'flixtrain'));
assert.ok(long.choices?.some((c) => c.mode === 'db'));
assert.ok(long.choices?.some((c) => c.preferred));

const items = hubFeederChecklistItems(plan);
const longBook = items.filter((i) => /long/i.test(i.id));
assert.equal(longBook.length, 1, `one long-haul book step, got ${longBook.map((i) => i.label).join('|')}`);
assert.ok(/flixbus/i.test(longBook[0]!.label), `pref flixbus ${longBook[0]!.label}`);
// Local + long + airport dürfen je einmal — keine Partner-Vergleichszeilen
assert.ok(items.length >= 2 && items.length <= 3, `step count ${items.length}`);

const beats = hubFeederToJourneyBeats(plan);
assert.equal(beats.length, plan!.legs.length);

const mag = buildJourneyBeats(
  {
    id: 'otp',
    placeName: 'Bukarest',
    title: 'Bukarest',
    matchScore: 80,
    gaps: [],
    facts: [],
    whyBlurb: '',
    selectedTransportId: 't1',
    transports: [tr],
    transferEur: 35,
    transferBookUrl: 'https://m.uber.com/ul/',
    stays: [
      {
        id: 's1',
        name: 'Hotel Centru',
        priceEur: 400,
        bookUrl: 'https://www.expedia.de/Hotel-Information?hotelId=999',
        photoUrl: null,
        why: 'Zentrum',
        expediaPropertyId: '999',
      },
    ],
    selectedStayId: 's1',
  } as any,
  { ledger: led },
);
assert.ok(
  mag.outbound.some((b) => /Prisdorf/i.test(b.title) && /Hamburg/i.test(b.title)),
  `mag local ${mag.outbound.map((b) => b.title).join('|')}`,
);
assert.ok(
  mag.outbound.some((b) => /Hamburg/i.test(b.title) && /Berlin/i.test(b.title)),
  `mag long ${mag.outbound.map((b) => b.title).join('|')}`,
);
assert.ok(
  mag.outbound.some((b) => /BER/i.test(b.title)),
  `mag apt ${mag.outbound.map((b) => b.title).join('|')}`,
);
assert.ok(mag.outbound.some((b) => b.kind === 'flight_out'));

const tl = buildTimelineStopsFromOption(
  {
    id: 'otp',
    placeName: 'Bukarest',
    title: 'Bukarest',
    matchScore: 80,
    gaps: [],
    facts: [],
    whyBlurb: '',
    selectedTransportId: 't1',
    transports: [tr],
    flightBookUrl: tr.bookUrl,
    transferEur: 35,
    transferBookUrl: 'https://m.uber.com/ul/',
    stays: [
      {
        id: 's1',
        name: 'Hotel Centru',
        priceEur: 400,
        bookUrl: 'https://expedia.test/h',
        photoUrl: null,
        why: '',
      },
    ],
    selectedStayId: 's1',
    lat: 44.4268,
    lng: 26.1025,
  } as any,
  led,
);
const titles = tl.map((s) => s.title).join(' → ');
assert.ok(/Prisdorf/i.test(titles), titles);
assert.ok(/Hamburg/i.test(titles), titles);
assert.ok(/Berlin/i.test(titles), titles);
assert.ok(/Flug|W63202|Bukarest/i.test(titles), titles);
assert.ok(/Taxi|Transfer|Unterkunft/i.test(titles), titles);
// Reihenfolge: Feeder vor Flug
const iLocal = tl.findIndex((s) => /Prisdorf/i.test(s.title));
const iFly = tl.findIndex((s) => /Flug/i.test(s.title));
const iStay = tl.findIndex((s) => /Hotel Centru/i.test(s.title));
assert.ok(iLocal >= 0 && iFly > iLocal && iStay > iFly, `order ${titles}`);

console.log('hubFeederPlan.smoke.test.ts: ok');
