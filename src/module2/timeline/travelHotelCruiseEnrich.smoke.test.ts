/**
 * Hotel/Cruise evidence enrich smokes (kein Live-Netz nötig für Parser).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/travelHotelCruiseEnrich.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractHotelPolicyTimesFromBlob,
  portCallsFromOptionDays,
} from './travelHotelCruiseEnrich';
import { extractCruiseProgramFromBlob } from './cruiseProgramResearch';
import { looksLikeHotelStammWrite, looksLikeCruiseScheduleWrite } from './travelScheduleHarden';

const times = extractHotelPolicyTimesFromBlob(
  'Hotel Atlantic: Check-in ab 15:00 Uhr, Check-out bis 11:00. Frühstück ab 07:00 inklusive Buffet.',
);
assert.equal(times.checkInHm, '15:00', 'ci');
assert.equal(times.checkOutHm, '11:00', 'co');
assert.equal(times.breakfastHm, '07:00', 'bf');
assert.equal(times.breakfastMentioned, true, 'bf mentioned');

const ports = portCallsFromOptionDays([
  {
    dayKey: '2026-06-10',
    title: 'Tag · Einschiffen',
    blocks: [{ title: 'Einschiffen', time: '16:00' }],
  },
  {
    dayKey: '2026-06-12',
    title: 'Hafen · Kiel',
    blocks: [
      { title: 'Schiff an · Kiel', time: '10:00' },
      { title: 'Landgang / Stadt', detail: 'Altstadt' },
      { title: 'Wieder an Bord', time: '18:00' },
    ],
  },
  {
    dayKey: '2026-06-17',
    title: 'Tag · Ausschiffen + Rückreise',
    blocks: [{ title: 'Schiff an', time: '08:00' }],
  },
]);
assert.equal(ports.length, 1, 'one port day');
assert.equal(ports[0]!.portName, 'Kiel');
assert.equal(ports[0]!.arriveAt, '10:00');
assert.equal(ports[0]!.departAt, '18:00');

assert.equal(
  looksLikeHotelStammWrite('Hotel Atlantic Check-in um 15 und Check-out um 11'),
  true,
);
assert.equal(
  looksLikeCruiseScheduleWrite('Kreuzfahrt Zwischenhalte in die Timeline'),
  true,
);
assert.equal(
  looksLikeCruiseScheduleWrite('Erzähl mir was zu Kreuzfahrten'),
  false,
  'no pitch steal',
);
assert.equal(
  looksLikeCruiseScheduleWrite('AIDA Programm in die Timeline eintragen'),
  true,
  'aida → timeline',
);

const prog = extractCruiseProgramFromBlob(
  'Mein Schiff ab Kiel. Check-in von 13:00 bis 16:00. Abfahrt 19:00. 3 Stunden vor Abfahrt einschiffen. Gdynia Ankunft 07:00 Abfahrt 18:00.',
  { embarkDate: '2026-09-27', voicePorts: ['Bordesholm'] },
);
assert.equal(prog.embarkLatestHm, '16:00');
assert.ok(prog.unresolvedHints.some((h) => /bordesholm/i.test(h)));

console.log('travelHotelCruiseEnrich.smoke.test.ts OK');
