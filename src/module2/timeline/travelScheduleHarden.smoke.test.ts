/**
 * Travel schedule harden smokes — Bahn/Hotel/Kreuzfahrt Timeline-Helpers.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/travelScheduleHarden.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  detectTravelScheduleKind,
  detectAllTravelScheduleKinds,
  looksLikeTrainScheduleWrite,
  looksLikeHotelStammWrite,
  looksLikeCruiseScheduleWrite,
  looksLikeTravelScheduleWriteJob,
  normalizeTrainScheduleQuery,
  parseHotelStammFromText,
  parseCruisePortsFromText,
  upsertHotelStammToTimeline,
  upsertCruiseGlanceToTimeline,
} from './travelScheduleHarden';
import { inferCall1JobShape } from '../router/call1JobShape';

assert.equal(
  looksLikeTrainScheduleWrite('Morgen 12 Uhr Bahn nach Kiel'),
  true,
  'train clock+dest',
);
assert.equal(
  looksLikeTravelScheduleWriteJob('Morgen 12 Uhr Bahn nach Kiel'),
  false,
  'train without write → not schedule_write job',
);
assert.equal(
  looksLikeTravelScheduleWriteJob(
    'Trag die Bahn morgen 12 Uhr nach Kiel in die Timeline',
  ),
  true,
  'train with write → schedule_write job',
);
assert.equal(
  normalizeTrainScheduleQuery('Morgen 12 Uhr Bahn nach Kiel').startsWith(
    'Verbindung',
  ),
  true,
  'normalize adds Verbindung',
);

assert.equal(
  looksLikeHotelStammWrite(
    'Hotel Atlantic Check-in um 15 Uhr, Frühstück und Check-out um 11 eintragen',
  ),
  true,
  'hotel stamm',
);
const hotel = parseHotelStammFromText(
  'Hotel Atlantic Check-in um 15 Uhr, Frühstück und Check-out um 11',
);
assert.equal(hotel.hotelName.includes('Atlantic'), true, 'hotel name');
assert.equal(hotel.checkInHm, '15:00', 'check-in');
assert.equal(hotel.checkOutHm, '11:00', 'check-out');
assert.equal(hotel.breakfast, true, 'breakfast');

const hotelUp = upsertHotelStammToTimeline(hotel);
assert.equal(hotelUp.ok, true, 'hotel upsert');
assert.ok(hotelUp.bullets.length >= 2, 'hotel bullets');

assert.equal(
  looksLikeCruiseScheduleWrite(
    'Kreuzfahrt Programm und Zwischenhalte in die Timeline',
  ),
  true,
  'cruise write',
);
assert.equal(
  looksLikeCruiseScheduleWrite('Kreuzfahrt AIDA planen'),
  false,
  'cruise pitch must not steal timeline',
);
assert.equal(detectTravelScheduleKind('Kreuzfahrt Häfen Kiel, Oslo'), 'cruise_glance');

assert.ok(
  detectAllTravelScheduleKinds(
    'Trag LH400 und Hotel Check-in in die Timeline',
  ).includes('flight'),
  'multi includes flight',
);

const embark = '2026-06-10';
const ports = parseCruisePortsFromText(
  'Zwischenhalt Kiel um 10 Uhr ab 18 Uhr und Häfen: Oslo, Bergen',
  embark,
);
assert.ok(ports.length >= 1, 'portCalls parsed');
assert.ok(
  ports.some((p) => /kiel/i.test(p.portName)),
  'Kiel port',
);

const cruise = upsertCruiseGlanceToTimeline({
  portCity: 'Hamburg',
  embarkDate: embark,
  disembarkDate: '2026-06-17',
  embarkLatestTime: '16:00',
  shipArriveTime: '08:00',
  portCalls: [
    {
      dayKey: '2026-06-12',
      portName: 'Kiel',
      arriveAt: '10:00',
      departAt: '18:00',
    },
    {
      dayKey: '2026-06-14',
      portName: 'Oslo',
      arriveAt: '09:00',
      departAt: '17:00',
    },
  ],
});
assert.equal(cruise.ok, true, 'cruise upsert');
assert.ok(cruise.dayCount >= 3, 'cruise days with ports');
assert.ok(
  cruise.bullets.some((b) => /zwischenhafen/i.test(b)),
  'cruise glance bullets',
);

assert.equal(
  inferCall1JobShape(
    'Hotel Check-in 15 Uhr und Frühstück in die Timeline',
  ),
  'schedule_write',
  'jobShape hotel',
);
assert.equal(
  inferCall1JobShape('Kreuzfahrt Zwischenhalte eintragen'),
  'schedule_write',
  'jobShape cruise',
);
assert.notEqual(
  inferCall1JobShape('Morgen 12 Uhr Bahn nach Kiel'),
  'schedule_write',
  'plain train stays off schedule_write job (transit leave)',
);

// enrichOptionAsCruisePlan wires portCalls
{
  const { enrichOptionAsCruisePlan, buildCruiseDayPlans } = require('../../reisebuero/research/cruisePlan') as {
    enrichOptionAsCruisePlan: (
      opt: Record<string, unknown>,
      ledger: Record<string, unknown>,
      extras?: Record<string, unknown>,
    ) => { days?: Array<{ title: string; dayKey: string }> };
    buildCruiseDayPlans: (o: Record<string, unknown>) => Array<{ title: string }>;
  };
  const days = buildCruiseDayPlans({
    portCity: 'Hamburg',
    embarkDate: '2026-06-10',
    disembarkDate: '2026-06-17',
    preNight: false,
    embarkLatestTime: '16:00',
    shipArriveTime: '08:00',
    portCalls: [
      {
        dayKey: '2026-06-12',
        portName: 'Kiel',
        arriveAt: '10:00',
        departAt: '18:00',
      },
    ],
  });
  assert.ok(
    days.some((d) => /kiel/i.test(d.title)),
    'buildCruiseDayPlans port day',
  );
  const enriched = enrichOptionAsCruisePlan(
    {
      title: 'Test',
      placeName: 'Hamburg',
      days: [],
    },
    {
      adults: { value: 2 },
      destinationHint: { value: 'Hamburg' },
      dateStart: { value: '2026-06-10' },
      dateEnd: { value: '2026-06-17' },
    },
    {
      embarkLatestTime: '16:00',
      shipArriveTime: '08:00',
      portCalls: [
        {
          dayKey: '2026-06-12',
          portName: 'Kiel',
          arriveAt: '10:00',
          departAt: '18:00',
        },
      ],
    },
  );
  assert.ok(
    (enriched.days || []).some((d) => /kiel/i.test(d.title)),
    'enrichOptionAsCruisePlan portCalls',
  );
}

console.log('travelScheduleHarden.smoke.test.ts OK');
