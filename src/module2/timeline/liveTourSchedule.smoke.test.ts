/**
 * Run: npx --yes tsx src/module2/timeline/liveTourSchedule.smoke.test.ts
 */

import {
  STATION_ARRIVE_BEFORE_MIN,
  STATION_ARRIVE_BEFORE_LARGE_MIN,
  stationArriveBufferMin,
} from '../../services/transit/stationArriveBuffer';
import { tidyHaltName } from '../../services/transit/haltName';
import { buildLiveTourSchedule } from './liveTourSchedule';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  tidyHaltName('Pinneberg, Schulenhörn') === 'Pinneberg, Schulenhörn',
  'Suburb-Halt bleibt erhalten',
);
assert(
  stationArriveBufferMin({ name: 'Bahnhof Prisdorf' }) ===
    STATION_ARRIVE_BEFORE_MIN,
  'kleiner Bahnhof: 3 Min',
);
assert(
  stationArriveBufferMin({ name: 'Hamburg Hbf' }) ===
    STATION_ARRIVE_BEFORE_LARGE_MIN,
  'Hbf: 7 Min',
);

const now = Date.parse('2026-08-19T20:30:00+02:00');
const dep = Date.parse('2026-08-19T20:40:00+02:00');

const out = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Prisdorf',
      lat: 53.676,
      lng: 9.763,
      role: 'walk',
      durationSec: 4 * 60,
      vehicleStartMs: dep,
      startMs: now,
      endMs: dep,
    },
    {
      name: 'Pinneberg',
      lat: 53.639,
      lng: 9.799,
      role: 'alight',
      line: 'RB61',
      vehicleStartMs: dep,
      startMs: dep,
      endMs: dep + 3 * 60_000,
    },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.68, lng: 9.75 },
  liveDistanceM: 280,
  liveEtaMin: 4,
  destName: 'Briefkasten',
});

const walkLeg = out.find((r) => r.kind === 'nav_leg' && r.transport === 'walk');
assert(walkLeg != null, 'Fußbein');
const halt = out.find((r) => r.kind === 'stop' && /Prisdorf/i.test(r.title ?? ''));
assert(halt != null, 'Halt Prisdorf');
const arriveBy = dep - STATION_ARRIVE_BEFORE_MIN * 60_000;
assert(
  walkLeg!.plannedEndMs === arriveBy,
  `Fußweg endet 3 Min vor Abfahrt, nicht zur Abfahrt (${walkLeg!.plannedEndMs} vs ${arriveBy})`,
);
assert(
  halt!.plannedStartMs === arriveBy,
  'am Halt um 20:37 bei Abfahrt 20:40',
);

const hbfZob = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Lübeck Hbf',
      lat: 53.867,
      lng: 10.669,
      role: 'alight',
      line: 'RE8',
      headsign: 'Lübeck-Travemünde Strand',
      platform: '3',
      vehicleMode: 'RAIL',
      durationSec: 20 * 60,
      startMs: Date.parse('2026-08-20T13:32:00+02:00'),
      endMs: Date.parse('2026-08-20T13:52:00+02:00'),
    },
    {
      name: 'Lübeck ZOB/Hauptbahnhof',
      lat: 53.868,
      lng: 10.671,
      role: 'transfer',
      durationSec: 7 * 60,
      distanceM: 245,
      platform: 'B',
      vehicleMode: 'BUS',
      vehicleStartMs: Date.parse('2026-08-20T14:01:00+02:00'),
      startMs: Date.parse('2026-08-20T13:52:00+02:00'),
      endMs: Date.parse('2026-08-20T13:58:00+02:00'),
    },
  ],
  nowMs: Date.parse('2026-08-20T13:20:00+02:00'),
  transport: 'walk',
  origin: { lat: 53.8, lng: 10.4 },
  destName: 'Alsterhaus',
});
const hbfIdx = hbfZob.findIndex((r) => r.kind === 'stop' && /Hbf/i.test(r.title ?? ''));
const zobIdx = hbfZob.findIndex((r) => r.kind === 'stop' && /ZOB/i.test(r.title ?? ''));
assert(hbfIdx >= 0 && zobIdx > hbfIdx, 'Hbf vor ZOB');
const between = hbfZob.slice(hbfIdx + 1, zobIdx);
assert(
  between.some((r) => r.kind === 'nav_leg' && r.transport === 'walk'),
  'zu Fuß zwischen Hbf und ZOB, nicht vor dem Hbf',
);
// Ort → Weg: Hbf zuerst (Ausstieg), dann Fußweg zum ZOB
assert(hbfZob[hbfIdx]!.kind === 'stop', 'Hbf ist Ort');
assert(
  (hbfZob[hbfIdx]?.badge || '').toLowerCase().includes('gleis') ||
    between.some((r) => (r.badge || '').toLowerCase().includes('gleis')),
  'Gleis am Bahn-Halt oder Folgebein',
);
assert(
  /gleis/i.test(hbfZob[hbfIdx]?.badge || ''),
  'Gleis am Hbf-Ort (Ausstieg)',
);
assert(
  /abfahrtsbereich\s*b/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Bus-ZOB: Abfahrtsbereich B, kein Fake-Gleis',
);
assert(
  !/gleis/i.test(hbfZob[zobIdx]?.badge || ''),
  'ZOB-Stop ohne Gleis-Label',
);
const hbfNotes = hbfZob[hbfIdx]?.notes ?? '';
assert(
  /Aussteigen|Umstieg/i.test(hbfNotes),
  `Ausstieg/Umstieg am Bahnhof in den Notizen (${hbfNotes})`,
);

// Prisdorf → Pinneberg → Bus → Schulenhörn → Ziel: klare Struktur, korrekte Wartezeit
const depRb = Date.parse('2026-09-02T12:40:00+02:00');
const arrRb = Date.parse('2026-09-02T12:42:00+02:00');
const depBus = Date.parse('2026-09-02T12:50:00+02:00');
const arrBus = Date.parse('2026-09-02T12:59:00+02:00');
const nowPin = Date.parse('2026-09-02T12:30:00+02:00');
const pinnebergFlow = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Bahnhof Prisdorf',
      lat: 53.676,
      lng: 9.763,
      role: 'walk',
      durationSec: 60,
      distanceM: 356,
      line: 'RB61',
      headsign: 'Pinneberg',
      platform: '1',
      vehicleMode: 'RAIL',
      vehicleStartMs: depRb,
      startMs: nowPin,
      endMs: depRb,
    },
    {
      name: 'Bahnhof Pinneberg',
      lat: 53.654,
      lng: 9.796,
      role: 'alight',
      line: 'RB61',
      headsign: 'Pinneberg',
      platform: '3',
      vehicleMode: 'RAIL',
      startMs: depRb,
      endMs: arrRb,
      durationSec: 120,
      stationCount: 1,
    },
    {
      name: 'Busbahnhof Pinneberg',
      lat: 53.655,
      lng: 9.798,
      role: 'transfer',
      durationSec: 5 * 60,
      distanceM: 319,
      line: '185',
      headsign: 'Kummerfeld, Bornbarg (Süd)',
      platform: '2',
      vehicleMode: 'BUS',
      vehicleStartMs: depBus,
      startMs: arrRb,
      endMs: Date.parse('2026-09-02T12:47:00+02:00'),
    },
    {
      name: 'Pinneberg, Schulenhörn',
      lat: 53.64,
      lng: 9.81,
      role: 'alight',
      line: '185',
      headsign: 'Kummerfeld, Bornbarg (Süd)',
      platform: '2',
      vehicleMode: 'BUS',
      startMs: depBus,
      endMs: arrBus,
      durationSec: 9 * 60,
      stationCount: 6,
    },
    {
      name: 'Ulmenallee 23',
      lat: 53.641,
      lng: 9.812,
      role: 'dest',
      durationSec: 4 * 60,
      distanceM: 242,
      startMs: arrBus,
      endMs: Date.parse('2026-09-02T13:03:00+02:00'),
    },
  ],
  nowMs: nowPin,
  transport: 'walk',
  origin: { lat: 53.677, lng: 9.762 },
  liveDistanceM: 356,
  liveEtaMin: 1,
  destName: 'Ulmenallee 23',
  tripTitle: 'Fahrt nach Ulmenallee 23',
});
const pinStops = pinnebergFlow.filter((r) => r.kind === 'stop');
const pinLegs = pinnebergFlow.filter((r) => r.kind === 'nav_leg');
assert(pinStops.length === 5, `5 Stopps, war ${pinStops.length}`);
const prisdorfStop = pinStops.find((r) => /Prisdorf/i.test(r.title ?? ''));
assert(prisdorfStop != null, 'Halt Prisdorf');
const waitMatch = /(\d+)\s*Min warten/.exec(prisdorfStop!.notes ?? '');
assert(waitMatch != null, `Wartezeit am Einstieg (${prisdorfStop!.notes})`);
assert(
  Number(waitMatch![1]) <= 5,
  `Wartezeit ≈ Puffer, nicht bis zum Bus (${prisdorfStop!.notes})`,
);
assert(
  !/RB61/.test(prisdorfStop!.notes ?? ''),
  'kein RB61 nochmal in den Halt-Notizen',
);
assert(
  pinLegs.some((r) => /RB61 nach Pinneberg/i.test(r.title ?? '')),
  'ein Fahrbein RB61 nach Pinneberg',
);
assert(
  pinLegs.filter((r) => /RB61/i.test(r.title ?? '')).length === 1,
  'RB61 nur einmal',
);
assert(
  pinStops.some((r) => /Schulenhörn/i.test(r.title ?? '')),
  'Ausstieg Schulenhörn mit vollem Namen',
);
assert(
  pinStops.some((r) => /Busbahnhof/i.test(r.title ?? '')),
  'Bus-Einstieg als Busbahnhof',
);
const alightPin = pinStops.find(
  (r) => /Bahnhof Pinneberg/i.test(r.title ?? '') && !/Bus/i.test(r.title ?? ''),
);
assert(
  /Aussteigen|Umstieg/i.test(alightPin?.notes ?? ''),
  `Ausstieg Pinneberg klar (${alightPin?.notes})`,
);
assert(
  !/^\d+\s*Min warten/i.test(alightPin?.notes ?? ''),
  'keine Fake-Wartezeit am Bahn-Ausstieg',
);
const walkLegsWithGleis = pinLegs.filter(
  (r) => r.transport === 'walk' && /gleis/i.test(r.badge ?? ''),
);
assert(walkLegsWithGleis.length === 0, 'kein Gleis-Badge auf Fußwegen');

const withHint = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Bahnhof Prisdorf',
      lat: 53.676,
      lng: 9.763,
      role: 'walk',
      vehicleStartMs: depRb,
      liveHint: 'Aufholen · ≥10 km/h',
      line: 'RB61',
      headsign: 'Pinneberg',
    },
    {
      name: 'Pinneberg',
      lat: 53.655,
      lng: 9.797,
      role: 'alight',
      line: 'RB61',
      startMs: depRb,
      endMs: arrRb,
    },
  ],
  nowMs: nowPin,
  transport: 'walk',
  origin: { lat: 53.677, lng: 9.762 },
  liveDistanceM: 200,
  liveEtaMin: 3,
  destName: 'Pinneberg',
});
assert(
  /Aufholen|km\/h/i.test(
    withHint.find((r) => r.kind === 'stop' && /Prisdorf/i.test(r.title ?? ''))
      ?.notes ?? '',
  ),
  'Live-Hinweis in Timeline-Notizen',
);

// Chronologie: Ausstieg vor Ziel (geplante Zeiten)
const orderCheck = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Bahnhof Pinneberg',
      lat: 53.654,
      lng: 9.796,
      role: 'alight',
      line: 'RB61',
      startMs: depRb,
      endMs: arrRb,
    },
    {
      name: 'Ulmenallee 23',
      lat: 53.641,
      lng: 9.812,
      role: 'dest',
      // absichtlich zu früh — darf Timeline nicht vor Ausstieg sortieren
      startMs: nowPin,
      endMs: nowPin + 60_000,
      durationSec: 240,
    },
  ],
  nowMs: nowPin,
  transport: 'walk',
  origin: { lat: 53.655, lng: 9.797 },
  liveDistanceM: 100,
  liveEtaMin: 2,
  destName: 'Ulmenallee 23',
});
const oStops = orderCheck.filter((r) => r.kind === 'stop');
assert(oStops.length === 2, '2 Stops');
assert(
  (oStops[0]!.plannedStartMs ?? 0) <= (oStops[1]!.plannedStartMs ?? 0),
  'Ausstieg nicht nach Ziel sortiert',
);
assert(/Pinneberg/i.test(oStops[0]!.title ?? ''), 'erster Stop = Ausstieg');

console.log('liveTourSchedule.smoke.test.ts OK');
