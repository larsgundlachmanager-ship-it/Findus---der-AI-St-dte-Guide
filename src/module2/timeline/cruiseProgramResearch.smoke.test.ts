/**
 * Mein-Schiff / Cruise-Programm Parser-Smokes (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/cruiseProgramResearch.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractCruiseProgramFromBlob,
  voicePortHintsFromText,
} from './cruiseProgramResearch';
import { looksLikeCruiseScheduleWrite } from './travelScheduleHarden';
import { buildCruiseDayPlans } from '../../reisebuero/research/cruisePlan';

const official = extractCruiseProgramFromBlob(
  [
    'Mein Schiff Relax Kreuzfahrt ab Kiel.',
    'Für Gäste mit individueller An- und Abreise gelten folgende Zeitfenster:',
    'Abfahrten ab Deutschland: von 13:00 Uhr bis 16:00 Uhr.',
    'Der Einschiffungsvorgang muss in der Regel bis etwa 3 Stunden vor der Abfahrt abgeschlossen sein.',
    'Abfahrt Kiel 19:00 Uhr.',
    'Gdynia (Danzig) Ankunft 07:00 Abfahrt 19:00.',
    'Kopenhagen Ankunft 08:00 Abfahrt 17:00.',
    'Kiel Ankunft 06:30.',
    'Flexible Genusszeiten in allen Restaurants. Entertainment Shows Spa Sauna.',
    'Reisezeitraum 2026-09-27 – 2026-10-02.',
  ].join(' '),
  { embarkDate: '2026-09-27', voicePorts: ['Danzig', 'Bordesholm'] },
);

assert.equal(official.lineName, 'Mein Schiff');
assert.equal(official.checkInStartHm, '13:00', 'check-in start');
assert.equal(official.checkInEndHm, '16:00', 'check-in end');
assert.equal(official.sailDepartHm, '19:00', 'sail');
assert.equal(official.embarkLatestHm, '16:00', 'all-aboard = sail-3h');
assert.equal(official.shipArriveHm, '06:30', 'home arrive');
assert.ok(official.portCalls.length >= 1, 'ports');
const danzig = official.portCalls.find((p) => /danzig|gdynia/i.test(p.portName));
assert.ok(danzig, 'danzig/gdynia');
assert.equal(danzig!.arriveAt, '07:00');
assert.equal(danzig!.departAt, '19:00');
assert.ok(official.mealFlexNote, 'flex meals no fake clocks');
assert.equal(official.meals.length, 0, 'no invented meal clocks');
assert.ok(
  official.unresolvedHints.some((h) => /bordesholm/i.test(h)),
  'bordesholm not a port',
);
assert.ok(official.highlights.length >= 1, 'highlights');

const luggageBlob = extractCruiseProgramFromBlob(
  [
    'AIDA Rail&Cruise ab Kiel.',
    'Gepäckabgabe am Hauptbahnhof möglich.',
    'Kostenfreier Busshuttle vom Bahnhof zum Schiff.',
  ].join(' '),
);
assert.ok(luggageBlob.luggageLogistics, 'luggage logistics');
assert.equal(luggageBlob.luggageLogistics!.stationDropOff, true, 'station drop');
assert.equal(luggageBlob.luggageLogistics!.stationShuttle, true, 'station shuttle');
assert.equal(luggageBlob.luggageLogistics!.railAndCruise, true, 'rail cruise');
assert.ok(
  luggageBlob.evidenceNotes.some((n) => /gepäckabgabe|shuttle/i.test(n)),
  'luggage evidence note',
);

const luggageDays = buildCruiseDayPlans({
  portCity: 'Kiel',
  embarkDate: '2026-09-27',
  disembarkDate: '2026-10-02',
  preNight: false,
  stationLuggageDrop: true,
  stationShuttle: true,
  luggageLogisticsNote: 'Gepäckabgabe am Bahnhof · Shuttle Bahnhof–Terminal (belegt)',
});
assert.ok(
  luggageDays.some((d) => d.blocks.some((b) => /gepäckabgabe|shuttle/i.test(b.title))),
  'luggage day block',
);

const days = buildCruiseDayPlans({
  portCity: 'Kiel',
  embarkDate: '2026-09-27',
  disembarkDate: '2026-10-02',
  preNight: false,
  embarkLatestTime: official.embarkLatestHm,
  shipArriveTime: official.shipArriveHm,
  portCalls: official.portCalls,
  checkInStartHm: official.checkInStartHm,
  checkInEndHm: official.checkInEndHm,
  sailDepartHm: official.sailDepartHm,
  meals: official.meals,
  mealFlexNote: official.mealFlexNote,
  highlights: official.highlights,
});
assert.ok(days.some((d) => d.blocks.some((b) => /check-in/i.test(b.title))), 'check-in block');
assert.ok(days.some((d) => /Hafen/.test(d.title)), 'port day');

assert.deepEqual(
  voicePortHintsFromText('Mein Schiff über Danzig und Bordesholm Timeline'),
  ['Danzig', 'Bordesholm'],
);

assert.equal(
  looksLikeCruiseScheduleWrite(
    'Trag die Mein Schiff Kreuzfahrt mit Check-in und Häfen in den Terminkalender',
  ),
  true,
);

assert.equal(
  looksLikeCruiseScheduleWrite('Trag das AIDA Programm mit Check-in in die Timeline'),
  true,
  'aida program → timeline',
);
assert.equal(
  looksLikeCruiseScheduleWrite('Trag Adidia Bordprogramm in den Kalender'),
  true,
  'stt adidia → cruise write',
);

const aidaBlob = extractCruiseProgramFromBlob(
  [
    'AIDA nova ab Kiel.',
    'Check-in von 12:00 bis 15:00.',
    'Abfahrt 18:00 Uhr.',
    'Oslo Ankunft 09:00 Abfahrt 17:00.',
  ].join(' '),
  { embarkDate: '2026-08-10' },
);
assert.equal(aidaBlob.lineName, 'AIDA');
assert.equal(aidaBlob.shipName, 'AIDA nova');
assert.equal(aidaBlob.checkInStartHm, '12:00');
assert.equal(aidaBlob.sailDepartHm, '18:00');

const mealBlob = extractCruiseProgramFromBlob(
  'Frühstück ab 07:00 Uhr, Mittagessen um 12:30, Abendessen ab 18:00 bis 21:00.',
);
assert.equal(mealBlob.meals.length, 3, 'explicit meal clocks');
assert.equal(mealBlob.meals[0]!.startHm, '07:00');

console.log('cruiseProgramResearch.smoke.test.ts OK');
